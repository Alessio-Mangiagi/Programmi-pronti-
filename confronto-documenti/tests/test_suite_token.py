# "><(((º> sabusabu <º)))><"
"""Le API del confronto accettano il token di servizio della suite (shared/suite)
al posto della sessione del portale: SkyTower le chiama senza cookie."""
import os
import sys
from pathlib import Path

import pytest

os.environ.pop("COSEDIL_SSO", None)             # gate acceso: è quello che si vuole provare
os.environ["SUITE_TOKEN"] = "token-di-prova"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    assert server.cosedil_sso is not None and server.suite_link is not None
    # Portale finto: raggiungibile, nessuna sessione valida.
    monkeypatch.setattr(server.cosedil_sso, "verifica_sessione",
                        lambda cookie, app_id="": {"ok": False, "reachable": True, "admin": False,
                                                   "username": "", "nome": "", "ruolo": "", "vietato": False})
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_senza_token_ne_sessione_401(client):
    assert client.get("/api/jobs/abc123").status_code == 401
    assert client.post("/api/compare").status_code == 401


def test_token_sbagliato_401(client):
    assert client.get("/api/jobs/abc123", headers={"X-Suite-Token": "altro"}).status_code == 401


def test_token_giusto_passa(client):
    # Job inesistente: la rotta risponde 404 (non 401) → il gate ha lasciato passare.
    r = client.get("/api/jobs/abc123", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi"})
    assert r.status_code == 404
    # /api/compare senza file: 400 della rotta, non 401 del gate.
    r = client.post("/api/compare", headers={"X-Suite-Token": "token-di-prova"})
    assert r.status_code == 400


def test_token_non_apre_le_altre_rotte(client):
    assert client.get("/api/storico", headers={"X-Suite-Token": "token-di-prova"}).status_code == 401
