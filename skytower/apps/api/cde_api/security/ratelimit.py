# "><(((º> sabusabu <º)))><"
"""Rate limiting a finestra mobile (libreria `limits`; storage memory:// o redis://), uso dei ticket nei link
e posti per gli stream SSE."""
from __future__ import annotations

import threading

from limits import parse
from limits.storage import storage_from_string
from limits.strategies import MovingWindowRateLimiter


class StreamSlots:
    """Contatore in memoria degli stream aperti per chiave (utente), nel singolo processo dell'API.

    Revisione di sicurezza del 03/11/2026, B11: ogni stream SSE delle notifiche interroga il database ogni 3";
    senza tetto un utente poteva aprirne a centinaia. Basta la memoria del processo: uno stream vive dentro il
    processo che lo serve e l'API gira con un solo processo uvicorn (Dockerfile)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._open: dict[str, int] = {}

    def acquire(self, key: str, limit: int) -> bool:
        """True e un posto in meno se ``key`` ha meno di ``limit`` stream aperti."""
        with self._lock:
            n = self._open.get(key, 0)
            if n >= limit:
                return False
            self._open[key] = n + 1
            return True

    def release(self, key: str) -> None:
        with self._lock:
            n = self._open.get(key, 0) - 1
            if n > 0:
                self._open[key] = n
            else:
                self._open.pop(key, None)

    def count(self, key: str) -> int:
        with self._lock:
            return self._open.get(key, 0)

    def reset(self) -> None:
        with self._lock:
            self._open.clear()


class RateLimiter:
    def __init__(self, storage_uri: str):
        self._limiter = MovingWindowRateLimiter(storage_from_string(storage_uri))
        self.streams = StreamSlots()

    def hit(self, rule: str, *keys: str) -> bool:
        """True se la richiesta è ammessa."""
        return self._limiter.hit(parse(rule), *keys)

    def use_ticket(self, jti: str, ttl_s: int, *, ip: str | None, max_uses: int = 1) -> bool:
        """Registra un uso del ticket ``jti`` (link con ``?ticket=``); False se non è più ammesso.

        Revisione di sicurezza del 03/11/2026, B6: i ticket viaggiano nella query string (EventSource e i link
        aperti dal browser non mandano l'header Authorization), quindi finiscono in cronologia, log dei proxy,
        segnalibri. Prima valevano quante volte si voleva fino alla scadenza. Ora:
          * ``max_uses=1``: monouso (stream SSE, download come allegato);
          * ``max_uses>1``: al massimo tanti usi e tutti dallo stesso IP del primo (visualizzatore PDF, che
            riapre lo stesso URL dalla cache del frontend). Un uso da un altro IP brucia il ticket per tutti:
            meglio un "riaprire il documento" in più che un link rubato che funziona.
        I contatori stanno nello storage del rate limit (memoria del processo o Redis) e scadono col ticket."""
        ttl = max(int(ttl_s), 1) + 5
        storage = self._limiter.storage
        total = storage.incr(f"ticket:{jti}", ttl)
        if total > max_uses:
            return False
        if max_uses == 1:
            return True
        from_ip = storage.incr(f"ticket:{jti}:{ip or '-'}", ttl)
        return from_ip == total          # tutti gli usi finora vengono da questo IP

    def reset(self) -> None:
        self._limiter.storage.reset()
        self.streams.reset()
