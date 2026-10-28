# "><(((º> sabusabu <º)))><"
"""S3 emulato (moto) per `cde dev` con i file conservati su disco tra un avvio e l'altro.

moto tiene tutto in memoria: chiusa la finestra, i file sparivano mentre il database (Postgres embedded)
restava, e i documenti si ritrovavano senza file. Qui lo stato dei bucket (oggetti, versioni, Object Lock,
upload multipart in corso) si salva con pickle in un file della cartella dati ogni pochi secondi, solo se
qualcosa è cambiato, e si ricarica all'avvio: identificativi di versione e date restano quelli salvati nel DB.

Il file lo scrive e lo legge solo questo processo, nella cartella dati locale (.devdata): pickle va bene qui,
non per dati che arrivano da fuori. Solo sviluppo: in produzione c'è S3 vero.
"""
from __future__ import annotations

import contextlib
import hashlib
import os
import pickle
import threading
from pathlib import Path

SAVE_EVERY_S = 3.0


def _backends():
    from moto.s3.models import s3_backends

    return s3_backends


def _fingerprint() -> str:
    """Impronta di oggetti e versioni: cambia a ogni scrittura, cancellazione o upload multipart."""
    h = hashlib.sha256()
    for acc, regions in sorted(_backends().items()):
        for part, backend in sorted(regions.items()):
            for name, bucket in sorted(dict(backend.buckets).items()):
                h.update(f"{acc}/{part}/{name}".encode())
                for key, versions in sorted(bucket.keys.lists()):
                    for v in versions:
                        h.update(f"{key}|{getattr(v, 'version_id', '')}|{getattr(v, 'size', '')}".encode())
                h.update(",".join(sorted(bucket.multiparts)).encode())
    return h.hexdigest()


def save(path: Path) -> None:
    s3 = _backends()
    state = {"buckets": {acc: {part: dict(be.buckets) for part, be in regions.items() if be.buckets}
                         for acc, regions in s3.items()},
             "accounts": dict(s3.bucket_accounts)}
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(pickle.dumps(state, protocol=pickle.HIGHEST_PROTOCOL))
    os.replace(tmp, path)                     # mai un file a metà, anche se il processo muore qui


def load(path: Path) -> int:
    if not path.exists():
        return 0
    state = pickle.loads(path.read_bytes())  # noqa: S301 - file locale scritto da save()
    s3 = _backends()
    n = 0
    for acc, regions in state["buckets"].items():
        for part, buckets in regions.items():
            s3[acc][part].buckets.update(buckets)
            n += sum(len(b.keys) for b in buckets.values())
    s3.bucket_accounts.update(state["accounts"])
    return n


def start(port: int, state_file: Path | None) -> str:
    """Avvia moto su 127.0.0.1:port; con state_file i bucket si ricaricano e si salvano su disco."""
    from moto.server import ThreadedMotoServer

    for k, v in {"AWS_ACCESS_KEY_ID": "dev", "AWS_SECRET_ACCESS_KEY": "dev", "AWS_DEFAULT_REGION": "eu-south-1"}.items():
        os.environ.setdefault(k, v)
    if state_file is not None:
        print(f"S3 emulato: {load(state_file)} oggetti ricaricati da {state_file}")
    ThreadedMotoServer(ip_address="127.0.0.1", port=port, verbose=False).start()
    if state_file is not None:
        threading.Thread(target=_saver, args=(state_file,), name="dev-s3-saver", daemon=True).start()
    return f"http://127.0.0.1:{port}"


def _saver(path: Path) -> None:  # pragma: no cover - ciclo di lunga durata
    last = _fingerprint() if path.exists() else ""
    stop = threading.Event()
    while not stop.wait(SAVE_EVERY_S):
        # una richiesta che modifica i bucket durante la lettura: si riprova al giro dopo
        with contextlib.suppress(RuntimeError):
            now = _fingerprint()
            if now != last:
                save(path)
                last = now
