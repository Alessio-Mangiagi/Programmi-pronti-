# "><(((º> sabusabu <º)))><"
"""Fixture comuni: Postgres 16 embedded, schema migrato, dataset demo.

Variabile CDE_TEST_SUPERUSER_URI: usa un Postgres esistente (es. CI con service container)
invece di quello embedded.
"""
from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from cde_api.tooling import dbadmin, demo_seed

PASSWORDS = {"cde_owner": "owner-test", "cde_app": "app-test", "cde_auth": "auth-test", "cde_worker": "worker-test"}


@pytest.fixture(scope="session")
def db_urls() -> dbadmin.DbUrls:
    superuser = os.environ.get("CDE_TEST_SUPERUSER_URI")
    if not superuser:
        superuser = dbadmin.start_embedded(Path(tempfile.gettempdir()) / "cde_pg_tests")
    urls = dbadmin.bootstrap(superuser, "cde_test", PASSWORDS, recreate=True)
    dbadmin.migrate(urls.owner)
    return urls


@pytest.fixture(scope="session")
def world(db_urls) -> demo_seed.DemoWorld:
    return demo_seed.seed(db_urls.owner)


@pytest.fixture
def app_conn(db_urls, world):
    """Connessione come cde_app; ogni test gira in una transazione annullata alla fine."""
    with psycopg.connect(db_urls.app, row_factory=dict_row) as conn:
        yield conn
        conn.rollback()


@pytest.fixture
def owner_conn(db_urls, world):
    with psycopg.connect(db_urls.owner, row_factory=dict_row) as conn:
        yield conn
        conn.rollback()


@contextmanager
def savepoint(conn):
    """Isola un'istruzione che deve fallire senza invalidare la transazione del test.

    Garantisce una transazione esterna già aperta: altrimenti conn.transaction() farebbe COMMIT.
    """
    if conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
        conn.execute("SELECT 1")
    with conn.transaction():
        yield


@pytest.fixture(scope="session")
def api_world(db_urls, tmp_path_factory):
    """Database separato per i test HTTP (che committano davvero)."""
    superuser = os.environ.get("CDE_TEST_SUPERUSER_URI") or dbadmin.start_embedded(
        Path(tempfile.gettempdir()) / "cde_pg_tests")
    urls = dbadmin.bootstrap(superuser, "cde_api_test", PASSWORDS, recreate=True)
    dbadmin.migrate(urls.owner)
    return urls, demo_seed.seed(urls.owner)


@pytest.fixture(scope="session")
def s3_endpoint():
    """S3 emulato (moto) come server HTTP reale: gli URL presigned funzionano con qualsiasi client."""
    import socket

    from moto.server import ThreadedMotoServer

    for k, v in {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test", "AWS_DEFAULT_REGION": "eu-south-1"}.items():
        os.environ.setdefault(k, v)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=port, verbose=False)
    server.start()
    yield f"http://127.0.0.1:{port}"
    server.stop()


@pytest.fixture(scope="session")
def api_settings(api_world, s3_endpoint, tmp_path_factory):
    from cde_api.config import Settings

    urls, _ = api_world
    return Settings(env="test", database_url_app=urls.app, database_url_auth=urls.auth,
                    database_url_worker=urls.worker, local_secrets_dir=tmp_path_factory.mktemp("secrets"),
                    rate_limit_storage="memory://", db_pool_min=1, db_pool_max=4,
                    s3_endpoint_url=s3_endpoint, s3_bucket="cde-test-documents",
                    upload_part_size=5 * 1024 * 1024)


@pytest.fixture(scope="session")
def api_app(api_settings):
    from cde_api.main import create_app

    app = create_app(api_settings)
    app.state.services.storage.ensure_bucket()
    return app


@pytest.fixture
def client(api_app):
    from fastapi.testclient import TestClient

    api_app.state.services.limiter.reset()
    with TestClient(api_app, base_url="https://testserver") as c:
        yield c


def act_as(conn, user_id) -> None:
    conn.execute("SELECT set_config('app.user_id', %s, true)", [str(user_id) if user_id else ""])


@pytest.fixture(autouse=True)
def registro_commesse_vuoto(monkeypatch, tmp_path):
    """Il registro delle commesse della suite (shared/suite/commesse.json) è quello del PC su cui girano i test:
    qui si parte sempre da un registro vuoto, così i codici casuali dei test sono ammessi (ADR-47). Chi vuole
    provare il controllo scrive il suo registro in ``suite_link.FILE_COMMESSE``."""
    import sys
    from pathlib import Path

    cartella = str(Path(__file__).resolve().parents[4] / "shared" / "suite")
    if cartella not in sys.path:
        sys.path.insert(0, cartella)
    import suite_link

    monkeypatch.setattr(suite_link, "FILE_COMMESSE", tmp_path / "commesse.json")


@pytest.fixture(autouse=True)
def password_portale_spenta(monkeypatch):
    """Il login prova la password del portale quando quella di SkyTower non coincide (portale.entra): nei test il
    portale vero (localhost:8080) non va mai chiamato, né deve contare i tentativi sbagliati dei test. Di default
    "portale non raggiungibile"; i test della password del portale mettono il loro finto."""
    from cde_api.modules import portale

    monkeypatch.setattr(portale, "verifica_password_portale",
                        lambda *a, **k: {"ok": False, "reachable": False, "status": 0, "errore": "", "motivo": ""})


@pytest.fixture(autouse=True)
def profilo_portale_spento(monkeypatch):
    """ADR-58: ogni login con le credenziali di SkyTower chiede al portale il profilo della persona
    (portale.profilo_portale) e la pagina Organizzazione chiede se chi agisce è il proprietario della suite. Nei test
    il portale vero non va mai chiamato: di default "non raggiungibile" (il login entra, come col portale spento);
    i test del profilo mettono il loro finto (test_api_profilo_portale.py)."""
    from cde_api.modules import portale

    monkeypatch.setattr(portale, "profilo_portale",
                        lambda *a, **k: {"reachable": False, "trovato": False, "username": None, "nome": None,
                                         "email": None, "ruolo": None, "admin": False, "proprietario": False,
                                         "disattivato": False, "abilitato": False, "status": 0})
