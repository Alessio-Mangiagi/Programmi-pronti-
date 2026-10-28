# "><(((º> sabusabu <º)))><"
"""Avvisi di sicurezza via email: dispositivo nuovo, password cambiata, secondo fattore aggiunto o azzerato."""
from __future__ import annotations

import pyotp
from test_api_auth import bearer, login
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_sessions import PASSWORD, owner, person  # noqa: F401 - fixture riusate

FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"


def _mails(client, email):
    return [m for m in client.app.state.services.mailer.outbox if m.to == email]


def test_accesso_da_dispositivo_nuovo(client, person):  # noqa: F811
    email, _ = person
    login(client, email, PASSWORD)                                 # primo accesso in assoluto: nessun avviso
    login(client, email, PASSWORD)                                 # stesso dispositivo
    assert _mails(client, email) == []
    r = client.post("/auth/login", json={"email": email, "password": PASSWORD}, headers={"User-Agent": FIREFOX})
    assert r.status_code == 200
    [mail] = _mails(client, email)
    assert mail.subject == "Nuovo accesso al CDE"
    assert "Firefox · Windows" in mail.body and "/sicurezza" in mail.body and "Ciao Tecnico" in mail.body


def test_password_e_secondo_fattore(client, person, owner, as_user):  # noqa: F811
    email, uid = person
    h = bearer(login(client, email, PASSWORD).json()["access_token"])
    assert client.post("/auth/password/change", headers=h,
                       json={"current_password": PASSWORD, "new_password": "Gru-a-torre-2027!"}).status_code == 200
    enroll = client.post("/auth/mfa/totp/enroll", headers=h, json={}).json()
    client.post("/auth/mfa/totp/confirm", headers=h,
                json={"factor_id": enroll["factor_id"], "code": pyotp.TOTP(enroll["secret"]).now()})
    r = client.post(f"/organizations/{owner.execute('SELECT organization_id FROM cde.users WHERE id = %s', [uid]).fetchone()[0]}"
                    f"/users/{uid}/mfa/reset", headers=as_user("platform"))
    assert r.status_code == 200
    subjects = [m.subject for m in _mails(client, email)]
    assert subjects == ["La password del CDE è stata cambiata", "Nuovo secondo fattore sul CDE",
                        "Secondo fattore azzerato sul CDE"]
    assert "Platform" in _mails(client, email)[-1].body                   # chi l'ha azzerato


def test_avviso_in_inglese_e_servizio_email_guasto(client, person, owner, monkeypatch):  # noqa: F811
    email, uid = person
    owner.execute("UPDATE cde.users SET locale = 'en' WHERE id = %s", [uid])
    h = bearer(login(client, email, PASSWORD).json()["access_token"])
    client.post("/auth/password/change", headers=h, json={"current_password": PASSWORD, "new_password": "Gru-a-torre-2027!"})
    assert _mails(client, email)[-1].subject == "Your CDE password was changed"

    def broken(*_a, **_k):
        raise RuntimeError("SES non raggiungibile")
    monkeypatch.setattr(client.app.state.services.mailer, "send", broken)
    r = client.post("/auth/password/change", headers=h,
                    json={"current_password": "Gru-a-torre-2027!", "new_password": "Ponteggio-Sud-2028"})
    assert r.status_code == 200                                     # l'avviso non blocca l'operazione
