# "><(((º> sabusabu <º)))><"
"""Limiti sui campi JSON liberi dei modelli dell'API (metadati, impostazioni, definizioni).

Revisione di sicurezza del 03/11/2026, B5: ``attributes`` dei documenti e ``settings`` dei progetti erano
``dict`` senza tetto. Il middleware ferma solo i corpi oltre ``CDE_REQUEST_MAX_BYTES`` (16 MB): sotto quella
soglia un utente con permesso di scrittura poteva salvare in una riga JSON da megabyte, che poi viaggia in ogni
elenco, ricerca ed export e gonfia il database. Il tetto si misura sul JSON serializzato compatto (UTF-8), cioè
su quanto finisce davvero nella colonna ``jsonb``.
"""
from __future__ import annotations

import json
from typing import Annotated

from pydantic import AfterValidator

JSON_MAX_BYTES = 64 * 1024              # metadati di un documento, impostazioni di un progetto, JSON Schema
JSON_LARGE_MAX_BYTES = 256 * 1024       # definizione di un workflow a grafo (fino a 60 nodi con messaggi)


def json_size(value) -> int:
    """Byte del valore serializzato come lo salverebbe Postgres (compatto, UTF-8)."""
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode())


def check_json_size(value, limit: int = JSON_MAX_BYTES):
    """ValueError (→ 422 di validazione) se ``value`` serializzato supera ``limit`` byte. ``None`` passa."""
    if value is not None and json_size(value) > limit:
        raise ValueError(f"JSON troppo grande: al massimo {limit // 1024} KB")
    return value


def _limited(limit: int):
    return AfterValidator(lambda v: check_json_size(v, limit))


# Tipi da usare nei modelli pydantic al posto di ``dict``
JsonObject = Annotated[dict, _limited(JSON_MAX_BYTES)]
LargeJsonObject = Annotated[dict, _limited(JSON_LARGE_MAX_BYTES)]
