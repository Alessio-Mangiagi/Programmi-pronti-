"""Operazioni di rilascio: healthcheck e creazione del primo admin."""
import pytest

from scripts import create_admin


def test_healthz_without_login(client):
    r = client.get("/healthz", headers={"Authorization": ""})
    assert r.status_code == 200 and r.json() == {"status": "ok"}


@pytest.fixture()
def admin_script(client, monkeypatch):
    monkeypatch.setattr(create_admin, "SessionLocal", client.session_factory)
    return create_admin


def test_create_admin_then_login(client, admin_script, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "una-password-lunga")
    assert admin_script.main(["Capo@Azienda.it", "Capo Cantiere"]) == 0
    r = client.post("/auth/login", json={"email": "capo@azienda.it", "password": "una-password-lunga"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
    # già esistente: nessuna modifica
    assert admin_script.main(["capo@azienda.it", "Altro"]) == 1


def test_create_admin_rejects_short_password(admin_script, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "corta")
    assert admin_script.main(["x@azienda.it", "X"]) == 2
