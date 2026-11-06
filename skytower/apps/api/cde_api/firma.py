# "><(((º> sabusabu <º)))><"
"""PDF firmati digitalmente in busta .p7m (CAdES) dentro SkyTower (ADR-55, migrazione 0044).

Ponte verso il motore comune della suite `shared/firma` (README lì, contratto §10 di shared/suite/CONTRATTI.md):
il client `busta.py` esegue `firma.py` con l'ambiente Python del motore (`shared/firma/.venv`, oppure
FIRMA_PYTHON nell'immagine Docker), così le librerie di verifica (pyhanko-certvalidator, asn1crypto) non entrano
nell'ambiente dell'API. `shared/` si trova accanto a `skytower/` (in sviluppo) o montato in `/shared` (Docker),
come per suite_link e cosedil_sso.

Regole di SkyTower:
- la revisione conserva il .p7m originale (valore legale): il download "allegato" dà quel file;
- il worker apre la busta e mette il documento contenuto in un derivato P7M, con il rapporto della verifica;
- motore assente o busta rotta non fanno mai fallire il caricamento: il derivato resta FAILED con il motivo.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ESITI = ("valida", "non valida", "da verificare")
_CARTELLA = Path(__file__).resolve().parents[4] / "shared" / "firma"
_P7M = re.compile(r"\.p7m$", re.IGNORECASE)


class FirmaNonInstallata(RuntimeError):
    """Manca il motore della firma (shared/firma assente o senza .venv)."""


class BustaIllegibile(ValueError):
    """Il .p7m non si apre (rotto, troncato, firma staccata)."""


def e_p7m(filename: str | None) -> bool:
    """Una busta firmata, riconosciuta dal nome della revisione ("X.pdf.p7m", anche "X.pdf.p7m.p7m")."""
    return bool(filename and _P7M.search(filename.strip()))


def nome_contenuto(filename: str) -> str:
    """"PRJ01-…-0812.pdf.p7m" → "PRJ01-…-0812.pdf" (il nome del documento dentro la busta)."""
    nome = filename.strip()
    while _P7M.search(nome):
        nome = nome[:-4]
    return nome or "documento.pdf"


def _busta():
    """Il client Python del motore (import pigro: senza shared/firma SkyTower funziona lo stesso)."""
    if str(_CARTELLA) not in sys.path:
        sys.path.insert(0, str(_CARTELLA))
    try:
        import busta
    except ImportError as exc:
        raise FirmaNonInstallata(f"Motore della firma digitale non trovato in {_CARTELLA}") from exc
    return busta


def apri(dati: bytes, filename: str, *, rete: bool = True, timeout: float = 180) -> tuple[bytes, str, dict]:
    """(documento contenuto, suo nome, rapporto della verifica). Solleva FirmaNonInstallata o BustaIllegibile."""
    busta = _busta()
    try:
        contenuto, nome, rapporto = busta.apri(dati, filename, rete=rete, timeout=timeout)
    except busta.FirmaNonInstallata as exc:
        raise FirmaNonInstallata(str(exc)) from exc
    except busta.BustaIllegibile as exc:
        raise BustaIllegibile(str(exc)) from exc
    return contenuto, nome or nome_contenuto(filename), rapporto


def motore_installato() -> bool:
    """Vero se il client e l'interprete del motore ci sono (per riprendere le buste rimaste in attesa)."""
    try:
        return _busta().python_firma().exists()
    except FirmaNonInstallata:
        return False


def rapporto_errore(motivo: str) -> dict:
    """Rapporto di una busta che non si apre: per il visualizzatore è una firma "non valida" con il motivo."""
    return {"firmato": True, "esito": "non valida", "riepilogo": f"Busta firmata illeggibile: {motivo}", "firme": [],
            "livelli": 0, "errore": motivo}
