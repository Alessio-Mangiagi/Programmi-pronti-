# "><(((º> sabusabu <º)))><"
"""Rate limiting a finestra mobile (libreria `limits`; storage memory:// o redis://)."""
from __future__ import annotations

from limits import parse
from limits.storage import storage_from_string
from limits.strategies import MovingWindowRateLimiter


class RateLimiter:
    def __init__(self, storage_uri: str):
        self._limiter = MovingWindowRateLimiter(storage_from_string(storage_uri))

    def hit(self, rule: str, *keys: str) -> bool:
        """True se la richiesta è ammessa."""
        return self._limiter.hit(parse(rule), *keys)

    def reset(self) -> None:
        self._limiter.storage.reset()
