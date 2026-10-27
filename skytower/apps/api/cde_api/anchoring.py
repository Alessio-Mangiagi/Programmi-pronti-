# "><(((º> sabusabu <º)))><"
"""Ancoraggio esterno del registro attività (G48): l'ancora giornaliera diventa un documento JSON scritto su
S3 con Object Lock (WORM) e, se è configurata una TSA, marcato temporalmente secondo RFC 3161.
Il client TSA è minimale: costruisce la TimeStampReq in DER e conserva il token restituito; la verifica
crittografica del token si fa con strumenti standard (es. `openssl ts -verify`)."""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import psycopg

from .config import Settings
from .storage import Storage

log = logging.getLogger("cde.anchoring")

SHA256_OID = "2.16.840.1.101.3.4.2.1"


# ---------------------------------------------------------------------
# DER minimale per RFC 3161
# ---------------------------------------------------------------------
def _len(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _tlv(tag: int, content: bytes) -> bytes:
    return bytes([tag]) + _len(len(content)) + content


def _int(n: int) -> bytes:
    return _tlv(0x02, n.to_bytes(n.bit_length() // 8 + 1, "big", signed=True))


def _oid(dotted: str) -> bytes:
    parts = [int(p) for p in dotted.split(".")]
    body = bytes([parts[0] * 40 + parts[1]])
    for p in parts[2:]:
        chunk = [p & 0x7F]
        while p := p >> 7:
            chunk.append(0x80 | (p & 0x7F))
        body += bytes(reversed(chunk))
    return _tlv(0x06, body)


def _seq(*items: bytes) -> bytes:
    return _tlv(0x30, b"".join(items))


def timestamp_request(digest: bytes, nonce: int) -> bytes:
    """TimeStampReq v1: imprint SHA-256, nonce, certReq = TRUE."""
    imprint = _seq(_seq(_oid(SHA256_OID), b"\x05\x00"), _tlv(0x04, digest))
    return _seq(_int(1), imprint, _int(nonce), b"\x01\x01\xff")


def _read(data: bytes, pos: int) -> tuple[int, int, int]:
    """(tag, inizio contenuto, fine contenuto) dell'elemento DER in pos."""
    tag, n = data[pos], data[pos + 1]
    pos += 2
    if n & 0x80:
        k = n & 0x7F
        n = int.from_bytes(data[pos:pos + k], "big")
        pos += k
    return tag, pos, pos + n


def timestamp_token(response: bytes) -> bytes:
    """Estrae il token (ContentInfo) da una TimeStampResp; errore se la TSA non l'ha concesso."""
    tag, start, end = _read(response, 0)
    if tag != 0x30:
        raise ValueError("Risposta TSA non valida")
    _, s_start, s_end = _read(response, start)                 # PKIStatusInfo
    st_tag, v_start, v_end = _read(response, s_start)
    status = int.from_bytes(response[v_start:v_end], "big") if st_tag == 0x02 else -1
    if status not in (0, 1) or s_end >= end:
        raise ValueError(f"Marca temporale rifiutata dalla TSA (stato {status})")
    return response[s_end:end]


def request_timestamp(url: str, digest: bytes) -> bytes:
    if not url.startswith(("https://", "http://")):
        raise ValueError("URL della TSA non valido")
    # URL da configurazione, schema verificato sopra
    req = urllib.request.Request(url, data=timestamp_request(digest, secrets.randbits(63)), method="POST",  # noqa: S310
                                 headers={"Content-Type": "application/timestamp-query"})
    with urllib.request.urlopen(req, timeout=20) as res:  # noqa: S310
        return timestamp_token(res.read())


# ---------------------------------------------------------------------
# Pubblicazione delle ancore
# ---------------------------------------------------------------------
def anchor_document(a: dict) -> bytes:
    return json.dumps({
        "type": "cde-audit-anchor", "version": 1, "day": a["day"].isoformat(), "chain_seq": a["chain_seq"],
        "head_hash": a["head_hash"], "anchored_at": a["created_at"].astimezone(UTC).isoformat(),
    }, sort_keys=True, separators=(",", ":")).encode()


def publish_pending(conn: psycopg.Connection, storage: Storage, settings: Settings, *,
                    tsa: Callable[[str, bytes], bytes] = request_timestamp) -> int:
    """Pubblica su S3 (e marca, se c'è la TSA) le ancore senza prova. Un errore TSA rimanda l'ancora al giro dopo."""
    done = 0
    for a in conn.execute("SELECT * FROM cde.audit_anchors_pending(30)").fetchall():
        doc = anchor_document(a)
        digest = hashlib.sha256(doc).digest()
        token = None
        if settings.tsa_url:
            try:
                token = tsa(settings.tsa_url, digest)
            except Exception:
                log.exception("marca temporale non ottenuta per l'ancora del %s", a["day"])
                continue
        retain = datetime.now(UTC) + timedelta(days=settings.audit_lock_days)
        key = f"{settings.audit_anchor_prefix}/{a['day'].isoformat()}.json"
        version = storage.put_locked(key, doc, "application/json", settings.audit_lock_mode, retain)
        if token:
            storage.put_locked(key.removesuffix(".json") + ".tsr", token, "application/timestamp-reply",
                               settings.audit_lock_mode, retain)
        conn.execute("SELECT cde.audit_anchor_proof_add(%s, %s, %s, %s, %s, %s, %s, %s)",
                     [a["day"], key, version, settings.audit_lock_mode, retain, digest,
                      settings.tsa_url if token else None, token])
        conn.commit()
        done += 1
    return done
