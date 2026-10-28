# "><(((º> sabusabu <º)))><"
"""Cambio password dal profilo e sessioni aperte: elenco, chiusura di una, "esci dagli altri dispositivi"."""
from __future__ import annotations

import uuid

import psycopg
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from test_api_auth import bearer, login

PASSWORD = "Ponteggio-Nord-2026"  # noqa: S105 - password di un utente di prova creato dal test


@pytest.fixture
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


@pytest.fixture
def person(api_world, owner):
    """Utente dedicato con password nota (le password demo servono agli altri test)."""
    _, w = api_world
    email = f"tecnico.{uuid.uuid4().hex[:8]}@sub2.example"
    uid = owner.execute(
        """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status)
           VALUES (%s, %s, 'Tecnico', 'Cantiere', %s, 'ACTIVE') RETURNING id""",
        [w.orgs["SUB2"], email, PasswordHasher().hash(PASSWORD)]).fetchone()[0]
    return email, uid


@pytest.fixture
def other_device(api_app):
    with TestClient(api_app, base_url="https://testserver") as c:
        yield c


def test_sessioni_elenco_e_chiusura(client, other_device, person):
    email, _ = person
    a = bearer(login(client, email, PASSWORD).json()["access_token"])
    login(other_device, email, PASSWORD)
    sessions = client.get("/auth/sessions", headers=a).json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    assert {"signed_in_at", "last_seen_at", "ip", "user_agent"} <= set(sessions[0])
    # un'altra persona non chiude le mie sessioni
    other = next(s for s in sessions if not s["current"])
    stranger = bearer(login(TestClient(client.app, base_url="https://testserver"), "sub2.user@sub2.example").json()["access_token"])
    assert client.delete(f"/auth/sessions/{other['family_id']}", headers=stranger).status_code == 404
    assert client.delete(f"/auth/sessions/{other['family_id']}", headers=a).status_code == 204
    assert other_device.post("/auth/refresh").status_code == 401          # l'altro dispositivo è fuori
    assert client.post("/auth/refresh").status_code == 200                # questo no
    # "esci da tutti gli altri dispositivi"
    login(other_device, email, PASSWORD)
    r = client.post("/auth/sessions/revoke-others", headers=a)
    assert r.json() == {"sessions_closed": 1}
    assert other_device.post("/auth/refresh").status_code == 401
    assert len(client.get("/auth/sessions", headers=a).json()) == 1


def test_cambio_password(client, other_device, api_world, owner, person):
    email, uid = person
    h = bearer(login(client, email, PASSWORD).json()["access_token"])
    login(other_device, email, PASSWORD)
    url = "/auth/password/change"
    wrong = client.post(url, headers=h, json={"current_password": "sbagliata", "new_password": "Gru-a-torre-2027!"})
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "wrong_password"
    assert owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'PASSWORD_CHANGE_FAIL' "
                         "AND user_id = %s", [uid]).fetchone()[0] == 1            # il tentativo resta nel registro
    for new in ("corta", PASSWORD, "aaaaaaaaaaaaaaaa", f"{email.split('@')[0]}-2026!"):
        r = client.post(url, headers=h, json={"current_password": PASSWORD, "new_password": new})
        assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password", new
    ok = client.post(url, headers=h, json={"current_password": PASSWORD, "new_password": "Gru-a-torre-2027!"})
    assert ok.status_code == 200 and ok.json() == {"status": "ok", "sessions_closed": 1}
    assert other_device.post("/auth/refresh").status_code == 401          # le altre sessioni sono chiuse
    assert client.post("/auth/refresh").status_code == 200
    assert login(other_device, email, PASSWORD).status_code == 401
    assert login(other_device, email, "Gru-a-torre-2027!").status_code == 200
    assert client.post(url, json={"current_password": "x", "new_password": "y"}).status_code == 401


def test_cambio_password_con_mfa_e_senza_password(client, owner, person):
    email, uid = person
    h = bearer(login(client, email, PASSWORD).json()["access_token"])
    # chi ha un secondo fattore deve aver fatto l'accesso con quello
    owner.execute("""INSERT INTO cde.user_mfa_factors (user_id, method, totp_secret_encrypted, verified_at)
                     VALUES (%s, 'TOTP', %s, now())""", [uid, bytes(1)])
    r = client.post("/auth/password/change", headers=h, json={"current_password": PASSWORD, "new_password": "Gru-a-torre-2027!"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"
    owner.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s", [uid])
    # account solo single sign-on
    owner.execute("UPDATE cde.users SET password_hash = NULL WHERE id = %s", [uid])
    r = client.post("/auth/password/change", headers=h, json={"current_password": PASSWORD, "new_password": "Gru-a-torre-2027!"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_password"
