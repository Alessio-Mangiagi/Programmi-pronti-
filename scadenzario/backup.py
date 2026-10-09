# "><(((º> sabusabu <º)))><"
"""Backup dello Scadenzario: database + cartella allegati in un unico .zip.

Il DB si copia con l'API di backup di SQLite (copia coerente anche a server
acceso), mai copiando il file a mano mentre qualcuno scrive.
"""
import os
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime

import config

PREFISSO = "scadenzario_"


def crea_zip(destinazione: str) -> str:
    """Scrive in `destinazione` uno zip con scadenzario.db e allegati/. Ritorna il path."""
    fd, copia_db = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        sorgente = sqlite3.connect(config.DB_PATH)
        copia = sqlite3.connect(copia_db)
        try:
            sorgente.backup(copia)
        finally:
            copia.close()
            sorgente.close()
        with zipfile.ZipFile(destinazione, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(copia_db, "scadenzario.db")
            if os.path.isdir(config.ALLEGATI_DIR):
                for nome in sorted(os.listdir(config.ALLEGATI_DIR)):
                    percorso = os.path.join(config.ALLEGATI_DIR, nome)
                    if os.path.isfile(percorso):
                        zf.write(percorso, f"allegati/{nome}")
    finally:
        try:
            os.unlink(copia_db)
        except OSError:
            pass
    return destinazione


def elenco() -> list[dict]:
    """Backup presenti in BACKUP_DIR, dal più recente."""
    if not os.path.isdir(config.BACKUP_DIR):
        return []
    risultato = []
    for nome in os.listdir(config.BACKUP_DIR):
        if nome.startswith(PREFISSO) and nome.endswith(".zip"):
            percorso = os.path.join(config.BACKUP_DIR, nome)
            risultato.append({
                "nome": nome,
                "dimensione": os.path.getsize(percorso),
                "creato_il": datetime.fromtimestamp(os.path.getmtime(percorso)).isoformat(" ", "seconds"),
            })
    return sorted(risultato, key=lambda b: b["nome"], reverse=True)


def backup_giornaliero() -> str | None:
    """Crea il backup di oggi se manca e tiene solo gli ultimi BACKUP_DA_TENERE.

    Ritorna il path creato, None se quello di oggi c'era già.
    """
    os.makedirs(config.BACKUP_DIR, exist_ok=True)
    nome = f"{PREFISSO}{date.today().isoformat()}.zip"
    percorso = os.path.join(config.BACKUP_DIR, nome)
    creato = None
    if not os.path.exists(percorso):
        crea_zip(percorso)
        creato = percorso
    for vecchio in elenco()[max(config.BACKUP_DA_TENERE, 1):]:
        try:
            os.unlink(os.path.join(config.BACKUP_DIR, vecchio["nome"]))
        except OSError:
            pass
    return creato
