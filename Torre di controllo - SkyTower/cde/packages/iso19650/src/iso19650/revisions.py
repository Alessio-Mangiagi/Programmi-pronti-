# "><(((º> sabusabu <º)))><"
"""Codici di revisione ISO 19650 (Annex nazionale UK).

* WIP:        ``P01.01``, ``P01.02`` … (versione di lavoro della prossima revisione condivisa)
* Shared:     ``P01``, ``P02`` …       (revisione preliminare condivisa)
* Published:  ``C01``, ``C02`` …       (revisione contrattuale pubblicata)
"""
from __future__ import annotations

import re
from typing import Literal, NamedTuple

from .codes import SUITABILITY_CODES

WIP_RE = re.compile(r"^P(\d{2})\.(\d{2})$")
SHARED_RE = re.compile(r"^P(\d{2})$")
PUBLISHED_RE = re.compile(r"^C(\d{2})$")

Stage = Literal["WIP", "SHARED", "PUBLISHED"]


class Revision(NamedTuple):
    code: str
    stage: Stage
    major: int
    minor: int | None


def parse_revision(code: str) -> Revision:
    if m := WIP_RE.match(code):
        return Revision(code, "WIP", int(m.group(1)), int(m.group(2)))
    if m := SHARED_RE.match(code):
        return Revision(code, "SHARED", int(m.group(1)), None)
    if m := PUBLISHED_RE.match(code):
        return Revision(code, "PUBLISHED", int(m.group(1)), None)
    raise ValueError(f"Codice di revisione non valido: {code!r}")


def is_valid_revision(code: str) -> bool:
    try:
        parse_revision(code)
    except ValueError:
        return False
    return True


def next_wip_revision(previous: str | None) -> str:
    """Revisione WIP successiva.

    ``None`` → ``P01.01``; ``P01.03`` → ``P01.04``; dopo una condivisa ``P02`` → ``P03.01``;
    dopo una pubblicata ``C01`` si riparte dalla preliminare successiva alla più alta (gestito dal chiamante
    passando l'ultima ``P``) — se riceve ``C`` restituisce ``P01.01`` della nuova serie.
    """
    if previous is None:
        return "P01.01"
    rev = parse_revision(previous)
    if rev.stage == "WIP":
        if rev.minor >= 99:
            raise ValueError("Superato il numero massimo di versioni WIP (99)")
        return f"P{rev.major:02d}.{rev.minor + 1:02d}"
    if rev.stage == "SHARED":
        if rev.major >= 99:
            raise ValueError("Superato il numero massimo di revisioni (99)")
        return f"P{rev.major + 1:02d}.01"
    return "P01.01"


def shared_code_for(wip_code: str) -> str:
    """``P01.03`` condivisa diventa ``P01`` (Sprint 3)."""
    rev = parse_revision(wip_code)
    if rev.stage != "WIP":
        raise ValueError("Solo una revisione WIP può essere condivisa")
    return f"P{rev.major:02d}"


def published_code_for(previous_published: str | None) -> str:
    if previous_published is None:
        return "C01"
    rev = parse_revision(previous_published)
    if rev.stage != "PUBLISHED":
        raise ValueError("Atteso un codice C..")
    return f"C{rev.major + 1:02d}"


def suitability_stage(code: str) -> str:
    if code not in SUITABILITY_CODES:
        raise ValueError(f"Codice di idoneità sconosciuto: {code!r}")
    return SUITABILITY_CODES[code][0]
