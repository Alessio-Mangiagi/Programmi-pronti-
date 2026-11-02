# "><(((º> sabusabu <º)))><"
"""Ambiente dei test: database in una cartella temporanea, gate SSO spento,
importazioni automatiche disattivate. Va fatto PRIMA di importare app.py."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

os.environ["COSEDIL_SSO"] = "off"
os.environ["MAGAZZINO_IMPORT_SEC"] = "0"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

_cartella = tempfile.mkdtemp(prefix="magazzino_test_")
config.DB_PATH = os.path.join(_cartella, "test.db")
config.DDT_DATA_DIR = os.path.join(_cartella, "ddt")
config.MEZZI_VFP_DIR = os.path.join(_cartella, "mezzi")
os.environ["SUITE_AVVISI_DIR"] = os.path.join(_cartella, "avvisi")

import database  # noqa: E402


@pytest.fixture
def conn():
    """Database vuoto per ogni test."""
    if os.path.exists(config.DB_PATH):
        for suffisso in ("", "-wal", "-shm"):
            try:
                os.remove(config.DB_PATH + suffisso)
            except FileNotFoundError:
                pass
    database.init_db()
    c = database.get_db()
    yield c
    c.close()


@pytest.fixture
def client(conn):
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as t:
        yield t


@pytest.fixture
def cartella_tmp():
    return _cartella
