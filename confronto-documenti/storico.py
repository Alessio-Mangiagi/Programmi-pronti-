# "><(((º> sabusabu <º)))><"
"""
Storico dei confronti su disco: ogni confronto finito resta consultabile
(report, anteprime, revisione) anche dopo un riavvio del server, per
STORICO_GIORNI giorni. I file caricati NON si conservano: solo il risultato
(testo estratto, differenze) e le anteprime JPEG.

Struttura: <DATI>/storico/<job_id>/job.json + <chiave>.jpg (es. 3a.jpg, 3ap.jpg)
<DATI> = variabile CONFRONTO_DATI, altrimenti la cartella dell'app (accanto
all'exe se congelato). In Docker si monta lì un volume.

Riservatezza: chi conosce l'id (12 caratteri casuali) può aprire il
confronto, come un link condiviso. L'elenco dello storico lo tiene il
browser di chi ha fatto i confronti: il server non espone un elenco di tutti.
"""

import json
import os
import re
import shutil
import threading
import time
from pathlib import Path

from confronta_pdf import DATA_DIR

DATI = DATA_DIR
CARTELLA = DATI / "storico"
GIORNI = int(os.environ.get("CONFRONTO_STORICO_GIORNI", "30"))

_ID = re.compile(r"^[0-9a-f]{12}$")
_CHIAVE = re.compile(r"^\d{1,5}[ab]p?$")
_LOCK = threading.Lock()


def _dir(job_id: str) -> Path | None:
    """Cartella del job, solo per id validi (niente percorsi arbitrari)."""
    return CARTELLA / job_id if _ID.match(job_id or "") else None


def salva(job_id: str, job: dict, anteprime: dict[str, bytes] | None = None):
    d = _dir(job_id)
    if d is None:
        return
    with _LOCK:
        d.mkdir(parents=True, exist_ok=True)
        for chiave, jpg in (anteprime or {}).items():
            if _CHIAVE.match(chiave):
                (d / f"{chiave}.jpg").write_bytes(jpg)
        dati = {k: v for k, v in job.items() if k != "cancel"}
        tmp = d / "job.json.tmp"
        tmp.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
        tmp.replace(d / "job.json")              # scrittura atomica


def carica(job_id: str) -> dict | None:
    d = _dir(job_id)
    if d is None or not (d / "job.json").is_file():
        return None
    try:
        return json.loads((d / "job.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def anteprima(job_id: str, chiave: str) -> bytes | None:
    d = _dir(job_id)
    if d is None or not _CHIAVE.match(chiave):
        return None
    f = d / f"{chiave}.jpg"
    return f.read_bytes() if f.is_file() else None


def aggiorna(job_id: str, **campi) -> dict | None:
    """Aggiorna campi del job salvato (es. revisione) e lo riscrive."""
    with _LOCK:
        job = carica(job_id)
    if job is None:
        return None
    job.update(campi)
    salva(job_id, job)
    return job


def elimina(job_id: str) -> bool:
    d = _dir(job_id)
    if d is None or not d.is_dir():
        return False
    with _LOCK:
        shutil.rmtree(d, ignore_errors=True)
    return True


def riassunti(ids: list[str]) -> list[dict]:
    """Dati essenziali dei confronti richiesti (quelli ancora presenti)."""
    out = []
    for job_id in ids[:200]:
        job = carica(job_id)
        if job:
            out.append({k: job.get(k) for k in
                        ("id", "name_a", "name_b", "message", "diff_count", "creato", "status")})
    return out


def pulisci():
    """Toglie i confronti più vecchi di GIORNI giorni (all'avvio del server)."""
    if not CARTELLA.is_dir():
        return
    limite = time.time() - GIORNI * 86400
    for d in CARTELLA.iterdir():
        f = d / "job.json"
        try:
            if d.is_dir() and (not f.is_file() or f.stat().st_mtime < limite):
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass
