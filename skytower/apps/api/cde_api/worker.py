# "><(((º> sabusabu <º)))><"
"""Worker asincrono (Procrastinate su PostgreSQL, ruolo cde_worker).

Pipeline post-upload (G15): lettura in streaming dell'oggetto S3 → SHA-256 confrontato con quello
dichiarato → antivirus → tipo MIME reale. Esito su cde.file_objects; file non conformi in quarantena
(download bloccato dal DB, oggetto S3 marcato con tag).

Avvio: ``cde worker``.
"""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

import filetype
import procrastinate
import psycopg
from psycopg.rows import dict_row

from .anchoring import publish_pending
from .config import Settings, get_settings
from .events import security_event
from .mail import build_mailer
from .notifier import send_daily_digests, send_notification_email
from .scanner import build_scanner
from .storage import Storage

log = logging.getLogger("cde.worker")


@dataclass
class VerifyOutcome:
    status: str
    sha256_ok: bool | None
    detail: str


class _Tap:
    """Calcola l'hash e conserva l'intestazione mentre lo scanner consuma lo stream."""

    def __init__(self, chunks: Iterable[bytes]):
        self._chunks = iter(chunks)
        self.hasher = hashlib.sha256()
        self.head = b""
        self.size = 0
        self.exhausted = False

    def __iter__(self) -> Iterator[bytes]:
        for chunk in self._chunks:
            self.hasher.update(chunk)
            self.size += len(chunk)
            if len(self.head) < 8192:
                self.head += chunk[: 8192 - len(self.head)]
            yield chunk
        self.exhausted = True

    def drain(self) -> None:
        for _ in self:
            pass


def verify_file(conn: psycopg.Connection, storage: Storage, scanner, file_id: UUID) -> VerifyOutcome | None:
    """Idempotente: un file già verificato viene ignorato. Nessun lock tenuto durante la scansione."""
    f = conn.execute(
        "SELECT id, project_id, storage_key, storage_version_id, size_bytes, content_type, sha256, scan_status "
        "FROM cde.file_objects WHERE id = %s", [file_id],
    ).fetchone()
    conn.commit()
    if f is None or f["scan_status"] != "PENDING":
        return None

    tap = _Tap(storage.iter_object(f["storage_key"], f["storage_version_id"]))
    scan = scanner.scan(tap)
    tap.drain()  # lo scanner può fermarsi alla prima firma trovata

    kind = filetype.guess(tap.head)
    detected = kind.mime if kind else None
    sha_ok = tap.hasher.digest() == bytes(f["sha256"]) and tap.size == f["size_bytes"]
    if not scan.clean:
        outcome = VerifyOutcome("INFECTED", sha_ok, f"Antivirus: {scan.detail}")
    elif not sha_ok:
        outcome = VerifyOutcome("ERROR", False, "SHA-256 o dimensione non corrispondenti a quanto dichiarato")
    else:
        mismatch = detected and detected != f["content_type"] and not f["content_type"].startswith("application/octet")
        outcome = VerifyOutcome("CLEAN", True, f"MIME rilevato: {detected}" + (" (diverso dal dichiarato)" if mismatch else "")
                                if detected else "OK")

    with conn.transaction():
        n = conn.execute(
            """UPDATE cde.file_objects SET scan_status = %s, sha256_verified = %s, scan_detail = %s, scanned_at = now()
               WHERE id = %s AND scan_status = 'PENDING'""",
            [outcome.status, outcome.sha256_ok, outcome.detail, file_id],
        ).rowcount
        if n and outcome.status != "CLEAN":
            security_event(conn, "FILE_QUARANTINED", project_id=f["project_id"], file=file_id,
                           status=outcome.status, detail=outcome.detail)
    if n and outcome.status != "CLEAN":
        storage.tag_object(f["storage_key"], f["storage_version_id"], {"cde-quarantine": outcome.status.lower()})
    log.info("file %s → %s (%s)", file_id, outcome.status, outcome.detail)
    return outcome


# ---------------------------------------------------------------------
# Applicazione Procrastinate
# ---------------------------------------------------------------------
@lru_cache
def _runtime(settings: Settings | None = None):
    settings = settings or get_settings()
    return Storage(settings), build_scanner(settings), settings, build_mailer(settings)


# conninfo letto all'import: `cde worker` imposta l'ambiente prima di importare il modulo
app = procrastinate.App(connector=procrastinate.PsycopgConnector(conninfo=get_settings().database_url_worker))


@app.task(name="cde.verify_file", queue="default",
          retry=procrastinate.RetryStrategy(max_attempts=5, exponential_wait=10))
def verify_file_task(file_id: str) -> None:
    storage, scanner, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, row_factory=dict_row) as conn:
        verify_file(conn, storage, scanner, UUID(file_id))


def run_worker() -> None:  # pragma: no cover - processo di lunga durata
    import asyncio
    import sys
    import threading

    logging.basicConfig(level=logging.INFO)
    in_main_thread = threading.current_thread() is threading.main_thread()

    async def main() -> None:
        async with app.open_async():
            await app.run_worker_async(queues=["default"], concurrency=4,
                                       install_signal_handlers=in_main_thread)

    # psycopg async su Windows richiede il selector loop (il Proactor non è supportato)
    factory = asyncio.SelectorEventLoop if sys.platform == "win32" else None
    with asyncio.Runner(loop_factory=factory) as runner:
        runner.run(main())


@app.task(name="cde.notify_state_changed", queue="default",
          retry=procrastinate.RetryStrategy(max_attempts=5, exponential_wait=10))
def notify_state_changed(document_id: str, revision_id: str, to_state: str) -> None:
    """Evento revision.state_changed (outbox). Sprint 4: notifiche in-app ed email."""
    log.info("documento %s: revisione %s → %s", document_id, revision_id, to_state)


@app.task(name="cde.send_notification_email", queue="default",
          retry=procrastinate.RetryStrategy(max_attempts=8, exponential_wait=15))
def send_notification_email_task(notification_id: int) -> None:
    _, _, settings, mailer = _runtime()
    with psycopg.connect(settings.database_url_worker, row_factory=dict_row) as conn:
        send_notification_email(conn, mailer, settings.web_base_url, notification_id)


@app.periodic(cron="*/15 * * * *", periodic_id="deadlines")
@app.task(name="cde.check_deadlines", queue="default")
def check_deadlines(timestamp: int) -> None:
    """Promemoria −48h/−24h, scadenze superate ed escalation (task e RFI)."""
    _, _, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, autocommit=True) as conn:
        n = conn.execute("SELECT cde.process_deadlines(to_timestamp(%s))", [timestamp]).fetchone()[0]
    log.info("scadenze elaborate: %s notifiche", n)


@app.periodic(cron="* * * * *", periodic_id="audit-seal")
@app.task(name="cde.audit_seal", queue="default")
def audit_seal(timestamp: int) -> None:
    """Sigilla nella hash chain gli eventi del registro non ancora sigillati."""
    _, _, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, autocommit=True) as conn:
        n = conn.execute("SELECT cde.audit_seal()").fetchone()[0]
    if n:
        log.info("registro: %s eventi sigillati", n)


@app.periodic(cron="5 0 * * *", periodic_id="audit-anchor")
@app.task(name="cde.audit_anchor", queue="default")
def audit_anchor(timestamp: int) -> None:
    """Ancora giornaliera dell'hash di testa della catena (giorno UTC appena concluso)."""
    _, _, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, autocommit=True) as conn:
        seq = conn.execute("SELECT cde.audit_anchor((to_timestamp(%s) AT TIME ZONE 'UTC')::date - 1)",
                           [timestamp]).fetchone()[0]
    log.info("registro: ancora giornaliera fino all'evento %s", seq)
    audit_publish_anchors(timestamp)


@app.periodic(cron="15 * * * *", periodic_id="audit-publish-anchors")
@app.task(name="cde.audit_publish_anchors", queue="default")
def audit_publish_anchors(timestamp: int) -> None:
    """Copia le ancore su S3 WORM con marca temporale; ritenta ogni ora quelle rimaste indietro (es. TSA giù)."""
    storage, _, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, row_factory=dict_row) as conn:
        n = publish_pending(conn, storage, settings)
    if n:
        log.info("registro: %s ancore pubblicate su S3", n)


@app.periodic(cron="40 2 * * *", periodic_id="naming-reservations-expiry")
@app.task(name="cde.naming_release_expired", queue="default")
def naming_release_expired(timestamp: int) -> None:
    """Rilascia le prenotazioni di identificativi scadute (auto_number.reservation_days della commessa)."""
    _, _, settings, _ = _runtime()
    with psycopg.connect(settings.database_url_worker, autocommit=True) as conn:
        n = conn.execute("SELECT cde.naming_release_expired(to_timestamp(%s))", [timestamp]).fetchone()[0]
    if n:
        log.info("naming: %s prenotazioni scadute rilasciate", n)


@app.periodic(cron="0 7 * * *", periodic_id="daily-digest")
@app.task(name="cde.daily_digest", queue="default")
def daily_digest(timestamp: int) -> None:
    _, _, settings, mailer = _runtime()
    with psycopg.connect(settings.database_url_worker, row_factory=dict_row) as conn:
        n = send_daily_digests(conn, mailer, settings.web_base_url)
    log.info("digest inviati: %s", n)
