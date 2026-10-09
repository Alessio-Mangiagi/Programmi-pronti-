# "><(((º> sabusabu <º)))><"
"""Ambiente dei test: database, allegati e backup in una cartella temporanea.

Va fatto PRIMA di importare app.py, che all'import crea il DB e monta il gate
SSO: col gate spento (COSEDIL_SSO=off) le API rispondono senza portale e
l'utente è l'admin fittizio di sviluppo.
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["COSEDIL_SSO"] = "off"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

_cartella = tempfile.mkdtemp(prefix="scadenzario_test_")
config.DB_PATH = os.path.join(_cartella, "test.db")
config.ALLEGATI_DIR = os.path.join(_cartella, "allegati")
config.BACKUP_DIR = os.path.join(_cartella, "backup")
