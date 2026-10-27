# "><(((º> sabusabu <º)))><"
"""Scansione antivirus: ClamAV (clamd, sidecar del worker in AWS) o scanner EICAR per dev/test."""
from __future__ import annotations

import io
from collections.abc import Iterable
from dataclasses import dataclass

from .config import Settings

EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


@dataclass(frozen=True)
class ScanResult:
    clean: bool
    detail: str


class EicarScanner:
    """Rileva solo la firma di test EICAR: sufficiente a provare quarantena e flussi in dev/CI."""

    def scan(self, chunks: Iterable[bytes]) -> ScanResult:
        tail = b""
        for chunk in chunks:
            window = tail + chunk
            if EICAR in window:
                return ScanResult(False, "Eicar-Test-Signature")
            tail = window[-len(EICAR):]
        return ScanResult(True, "OK")


class _ChunkStream(io.RawIOBase):
    """Adatta un iteratore di chunk a file-like per clamd.instream."""

    def __init__(self, chunks: Iterable[bytes]):
        self._it = iter(chunks)
        self._buf = b""

    def readable(self) -> bool:
        return True

    def read(self, n: int = -1) -> bytes:
        while n < 0 or len(self._buf) < n:
            try:
                self._buf += next(self._it)
            except StopIteration:
                break
        if n < 0:
            data, self._buf = self._buf, b""
        else:
            data, self._buf = self._buf[:n], self._buf[n:]
        return data


class ClamdScanner:  # pragma: no cover - richiede un demone clamd
    def __init__(self, host: str, port: int):
        import clamd

        self.client = clamd.ClamdNetworkSocket(host=host, port=port, timeout=300)

    def scan(self, chunks: Iterable[bytes]) -> ScanResult:
        status, signature = self.client.instream(_ChunkStream(chunks))["stream"]
        return ScanResult(status == "OK", signature or status)


def build_scanner(settings: Settings):
    if settings.scanner == "clamd":
        return ClamdScanner(settings.clamd_host, settings.clamd_port)
    if settings.env == "prod":
        raise RuntimeError("Scanner EICAR non ammesso in produzione")
    return EicarScanner()
