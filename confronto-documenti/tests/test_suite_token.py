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


def test_confronti_gestibili_solo_dal_proprietario_o_admin(monkeypatch):
    """Revisione di sicurezza del 03/11/2026: annullare/eliminare/annotare un confronto altrui non si può."""
    monkeypatch.setattr(server, "_identita", lambda: ("mrossi", False))
    assert server._puo_gestire({"proprietario": "mrossi"})
    assert not server._puo_gestire({"proprietario": "gverdi"})
    assert server._puo_gestire({"id": "vecchio"}), "confronti senza proprietario (prima della regola) restano gestibili"
    assert not server._puo_gestire(None)
    monkeypatch.setattr(server, "_identita", lambda: ("admin", True))
    assert server._puo_gestire({"proprietario": "gverdi"})


def test_eliminazione_altrui_403(client, monkeypatch):
    with server.JOBS_LOCK:
        server.JOBS["abc123def456"] = {"id": "abc123def456", "status": "done", "proprietario": "gverdi"}
    try:
        monkeypatch.setattr(server, "_identita", lambda: ("mrossi", False))
        r = client.delete("/api/jobs/abc123def456", headers={"X-Suite-Token": "token-di-prova"})
        assert r.status_code == 403
        r = client.post("/api/jobs/abc123def456/cancel", headers={"X-Suite-Token": "token-di-prova"})
        assert r.status_code == 403
    finally:
        with server.JOBS_LOCK:
            server.JOBS.pop("abc123def456", None)


def test_coda_piena_per_utente_429(client):
    """Oltre CODA_MAX_PER_UTENTE confronti in coda dello stesso utente il server rifiuta con 429."""
    finti = [f"coda{i:08d}" for i in range(server.CODA_MAX_PER_UTENTE)]
    with server.JOBS_LOCK:
        for j in finti:
            server.JOBS[j] = {"id": j, "status": "queued", "proprietario": "mrossi"}
    try:
        r = client.post("/api/compare", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi"})
        assert r.status_code == 429
        r = client.post("/api/compare", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "gverdi"})
        assert r.status_code == 400, "un altro utente non è bloccato (400 = mancano i due file)"
    finally:
        with server.JOBS_LOCK:
            for j in finti:
                server.JOBS.pop(j, None)


def test_in_rete_senza_login_non_parte():
    import pytest
    server._controlla_esposizione("127.0.0.1", True, "")           # in locale va bene anche senza login
    server._controlla_esposizione("0.0.0.0", False, "")            # in rete col portale va bene
    server._controlla_esposizione("0.0.0.0", True, "segreta")      # in rete con password va bene
    with pytest.raises(SystemExit):
        server._controlla_esposizione("0.0.0.0", True, "")
