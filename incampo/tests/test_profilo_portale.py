# "><(((º> sabusabu <º)))><"
"""Il profilo del portale vale in InCampo (regola della suite dell'11/11/2026).

Decisione dell'utente: "Gli admin devono essere creati solo da me, io posso creare e cancellare gli admin.
2b 3b 4a" → collegamento stabile account↔username del portale, nome/email/amministratore come nel portale
(amministratore dato E tolto), controllo del portale al login anche con la password di InCampo (2b, 3b), ruoli
sotto admin decisi in InCampo (4a), amministratori dati o tolti solo dal proprietario della suite.
Il portale è sempre finto: /api/verify con urlopen finto (fixture portale_finto di test_suite), il profilo con
la fixture autouse profili_portale di conftest.
"""
import pytest

from app import models
from app.routers import suite as suite_router
from tests.conftest import PASSWORD, login, make_user
from tests import test_suite

# fixture del portale finto riusate da test_suite (/api/verify e password del portale)
portale_finto = test_suite.portale_finto
password_portale = test_suite.password_portale


def _entra(client, cookie="sid=x"):
    r = client.post("/auth/portale", headers={"Authorization": "", "Cookie": cookie})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def _utente(client, **filtro):
    with client.session_factory() as s:
        u = s.query(models.User).filter_by(**filtro).one()
        s.expunge(u)
        return u


def _registro(client, action, **filtro):
    with client.session_factory() as s:
        return [(e.details or {}) for e in s.query(models.AuditLog).filter_by(action=action, **filtro).all()]


# --------------------------------------------------------------------------- collegamento, nome, email

def test_collegamento_stabile_e_email_cambiata_nel_portale(client, portale_finto):
    portale_finto["risposta"] = {"ok": True, "username": "m.rossi", "nome": "Mario Rossi", "ruolo": "utente",
                                 "email": "mario.rossi@cosedilspa.com"}
    primo = _entra(client)
    assert primo["dal_portale"] is True
    assert _utente(client, id=primo["id"]).portale_username == "m.rossi"
    # nel portale cambiano email e nome: stesso account InCampo, aggiornato (prima nasceva un doppione)
    portale_finto["risposta"] = {"ok": True, "username": "m.rossi", "nome": "Mario Rossi Jr", "ruolo": "utente",
                                 "email": "m.rossi@nuovo.it"}
    secondo = _entra(client)
    assert secondo["id"] == primo["id"] and secondo["email"] == "m.rossi@nuovo.it" and secondo["name"] == "Mario Rossi Jr"
    with client.session_factory() as s:
        assert s.query(models.User).filter(models.User.email.in_(["mario.rossi@cosedilspa.com", "m.rossi@nuovo.it"])).count() == 1
    voci = _registro(client, "user.updated", entity_id=primo["id"])
    assert any(v.get("origine") == "profilo-del-portale" and v.get("email") == "m.rossi@nuovo.it" for v in voci)


def test_account_esistente_si_collega_al_primo_ingresso(client, portale_finto):
    with client.session_factory() as s:
        u = make_user(s, "l.verdi@cosedilspa.com", "field", name="Luca")
        uid = u.id
    portale_finto["risposta"] = {"ok": True, "username": "l.verdi", "nome": "Luca Verdi", "ruolo": "utente",
                                 "email": "l.verdi@cosedilspa.com"}
    d = _entra(client)
    assert d["id"] == uid and d["role"] == "field" and d["name"] == "Luca Verdi"   # ruolo sotto admin: resta (4a)
    assert _utente(client, id=uid).portale_username == "l.verdi"


def test_email_del_portale_gia_di_un_altro_account_non_si_prende(client, portale_finto):
    with client.session_factory() as s:
        make_user(s, "occupata@cosedilspa.com", "field", name="Altro")
    portale_finto["risposta"] = {"ok": True, "username": "p.uno", "nome": "P", "ruolo": "utente",
                                 "email": "p.uno@cosedilspa.com"}
    d = _entra(client)
    portale_finto["risposta"]["email"] = "occupata@cosedilspa.com"
    # l'email nuova è di un account InCampo NON collegato: quello viene agganciato? No, l'utente è già collegato
    d2 = _entra(client)
    assert d2["id"] == d["id"] and d2["email"] == "p.uno@cosedilspa.com"
    assert any("email_non_aggiornata" in v for v in _registro(client, "user.updated", entity_id=d["id"]))


# --------------------------------------------------------------------------- amministratore dato e tolto

def test_admin_dato_e_tolto_dal_portale_con_ruolo_di_prima(client, portale_finto):
    with client.session_factory() as s:
        uid = make_user(s, "a.capo@cosedilspa.com", "field", name="Anna").id
    portale_finto["risposta"] = {"ok": True, "username": "a.capo", "nome": "Anna Capo", "ruolo": "admin", "admin": True,
                                 "email": "a.capo@cosedilspa.com"}
    assert _entra(client)["role"] == "admin"
    assert _utente(client, id=uid).ruolo_prima_admin == "field"
    # il proprietario le toglie l'admin nel portale: al prossimo ingresso torna "field"
    portale_finto["risposta"].update(ruolo="utente", admin=False)
    d = _entra(client)
    assert d["role"] == "field" and _utente(client, id=uid).ruolo_prima_admin is None
    voci = _registro(client, "user.updated", entity_id=uid)
    assert any(v.get("origine") == "admin-tolto-dal-portale" and v.get("role") == {"da": "admin", "a": "field"} for v in voci)


def test_nato_admin_dal_portale_torna_al_ruolo_predefinito(client, portale_finto, monkeypatch):
    monkeypatch.setenv("INCAMPO_RUOLO_PORTALE", "field")
    portale_finto["risposta"] = {"ok": True, "username": "n.admin", "nome": "N", "ruolo": "admin", "admin": True,
                                 "email": "n.admin@cosedilspa.com"}
    assert _entra(client)["role"] == "admin"
    portale_finto["risposta"].update(ruolo="utente", admin=False)
    assert _entra(client)["role"] == "field"


def test_regola_ip_non_basta_neanche_alla_creazione(client, portale_finto):
    portale_finto["risposta"] = {"ok": True, "username": "ip.solo", "nome": "Ip", "ruolo": "utente", "admin": True,
                                 "email": "ip.solo@cosedilspa.com"}
    assert _entra(client)["role"] == "manager"


def test_account_solo_incampo_non_toccati(client, portale_finto):
    """Un admin di InCampo senza utente del portale (installazione, demo) resta admin: il portale non lo conosce."""
    portale_finto["risposta"] = {"ok": True, "username": "qualcuno", "nome": "Q", "ruolo": "utente",
                                 "email": "qualcuno@cosedilspa.com"}
    _entra(client)
    admin = _utente(client, email="admin@test.local")
    assert admin.role == models.UserRole.admin and admin.portale_username is None


def test_auth_me_toglie_l_admin_alla_stessa_persona(client, portale_finto):
    portale_finto["risposta"] = {"ok": True, "username": "c.token", "nome": "Carla", "ruolo": "admin", "admin": True,
                                 "email": "c.token@cosedilspa.com"}
    token = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=c"}).json()["access_token"]
    h = {"Authorization": "Bearer " + token}
    assert client.get("/auth/me", headers=h).json()["role"] == "admin"
    portale_finto["risposta"].update(ruolo="utente", admin=False)
    assert client.get("/auth/me", headers=h).json()["role"] == "admin"            # senza cookie: com'era
    assert client.get("/auth/me", headers={**h, "Cookie": "sid=c"}).json()["role"] == "manager"


# --------------------------------------------------------------------------- login con la password di InCampo (2b, 3b)

def test_login_locale_rifiutato_se_disattivato_o_non_abilitato_nel_portale(client, profili_portale):
    with client.session_factory() as s:
        make_user(s, "d.uno@cosedilspa.com", "field")
    cred = {"email": "d.uno@cosedilspa.com", "password": PASSWORD}
    profili_portale.aggiungi("d.uno", "d.uno@cosedilspa.com", disattivato=True)
    r = client.post("/auth/login", json=cred)
    assert r.status_code == 403 and "disattivato" in r.json()["detail"]
    assert any(v.get("reason") == "portale" for v in _registro(client, "auth.login_failed", actor_email="d.uno@cosedilspa.com"))
    profili_portale.aggiungi("d.uno", "d.uno@cosedilspa.com", abilitato=False)
    r = client.post("/auth/login", json=cred)
    assert r.status_code == 403 and "programmi del Portale" in r.json()["detail"]
    # riabilitato: entra, e l'account si collega allo username del portale
    profili_portale.aggiungi("d.uno", "d.uno@cosedilspa.com", nome="Dino Uno")
    r = client.post("/auth/login", json=cred)
    assert r.status_code == 200 and r.json()["user"]["dal_portale"] and r.json()["user"]["name"] == "Dino Uno"
    # tolto dal portale: l'account collegato non entra più neanche con la password di InCampo
    profili_portale.togli("d.uno")
    r = client.post("/auth/login", json=cred)
    assert r.status_code == 403 and "non esiste più" in r.json()["detail"]


def test_login_locale_allinea_l_admin_e_usa_il_ruolo_nuovo_nel_token(client, profili_portale):
    with client.session_factory() as s:
        u = make_user(s, "e.capo@cosedilspa.com", "admin")
        u.portale_username = "e.capo"
        u.ruolo_prima_admin = "manager"
        s.commit()
    profili_portale.aggiungi("e.capo", "e.capo@cosedilspa.com", ruolo="utente")
    r = client.post("/auth/login", json={"email": "e.capo@cosedilspa.com", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["user"]["role"] == "manager"
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    assert client.get("/users", params={"include_inactive": True}, headers=h).status_code == 403


def test_login_locale_portale_giu_o_account_solo_incampo(client, profili_portale):
    # account solo di InCampo: si entra come prima, il portale non lo conosce
    assert client.post("/auth/login", json={"email": "admin@test.local", "password": PASSWORD}).status_code == 200
    # portale irraggiungibile: si entra (la password di InCampo serve proprio allora) e il registro lo dice
    profili_portale.giu = True
    assert client.post("/auth/login", json={"email": "admin@test.local", "password": PASSWORD}).status_code == 200
    assert any(v.get("portale") == "non verificato" for v in _registro(client, "auth.login", actor_email="admin@test.local"))


def test_login_con_password_del_portale_toglie_l_admin(client, password_portale):
    with client.session_factory() as s:
        u = make_user(s, "mario.rossi@cosedilspa.com", "admin")
        u.portale_username = "mario.rossi"
        s.commit()
    r = client.post("/auth/login", json={"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "manager"


# --------------------------------------------------------------------------- solo il proprietario gestisce gli admin

def test_creare_un_admin_solo_il_proprietario(client, profili_portale):
    nuovo = {"email": "n.admin@test.local", "name": "Nuovo", "password": "123456789012", "role": "admin"}
    r = client.post("/users", json=nuovo)
    assert r.status_code == 403 and "proprietario" in r.json()["detail"]
    assert client.get("/users/gestione-admin").json()["puo_gestire_admin"] is False
    # un utente normale si crea come sempre
    assert client.post("/users", json={**nuovo, "role": "field"}).status_code == 201


def test_proprietario_crea_promuove_e_toglie_admin(client, proprietario, profili_portale):
    assert client.get("/users/gestione-admin").json() == {"puo_gestire_admin": True, "motivo": "", "portale": True}
    r = client.post("/users", json={"email": "z.admin@test.local", "name": "Z", "password": "123456789012", "role": "admin"})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    assert client.patch(f"/users/{uid}", json={"role": "manager"}).json()["role"] == "manager"
    assert client.patch(f"/users/{uid}", json={"role": "admin"}).json()["role"] == "admin"
    assert client.patch(f"/users/{uid}", json={"password": "999999999999"}).status_code == 200
    assert client.patch(f"/users/{uid}", json={"is_active": False}).json()["is_active"] is False
    # portale giù: non si può verificare, quindi no
    profili_portale.giu = True
    r = client.patch(f"/users/{uid}", json={"is_active": True})
    assert r.status_code == 403 and "non raggiungibile" in r.json()["detail"]
    assert client.get("/users/gestione-admin").json()["puo_gestire_admin"] is False


def test_altri_admin_non_toccano_gli_admin(client, proprietario, profili_portale):
    r = client.post("/users", json={"email": "altro.admin@test.local", "name": "Altro", "password": "123456789012",
                                    "role": "admin"})
    altro = r.json()["id"]
    vittima = client.post("/users", json={"email": "v@test.local", "name": "V", "password": "123456789012",
                                          "role": "admin"}).json()["id"]
    semplice = client.post("/users", json={"email": "s@test.local", "name": "S", "password": "123456789012",
                                           "role": "field"}).json()["id"]
    h = login(client, "altro.admin@test.local", "123456789012")                  # admin, ma non proprietario (non collegato)
    for corpo in ({"role": "manager"}, {"password": "000000000000"}, {"is_active": False}):
        r = client.patch(f"/users/{vittima}", json=corpo, headers=h)
        assert r.status_code == 403 and "proprietario" in r.json()["detail"], corpo
    assert client.patch(f"/users/{semplice}", json={"role": "admin"}, headers=h).status_code == 403
    # sotto admin si lavora come prima (4a)
    assert client.patch(f"/users/{semplice}", json={"role": "manager", "name": "S2"}, headers=h).status_code == 200
    assert client.patch(f"/users/{semplice}", json={"password": "111111111111"}, headers=h).status_code == 200
    assert altro


def test_admin_di_un_account_del_portale_si_decide_nel_portale(client, proprietario):
    with client.session_factory() as s:
        u = make_user(s, "f.portale@cosedilspa.com", "manager")
        u.portale_username = "f.portale"
        s.commit()
        uid = u.id
    users = {x["id"]: x for x in client.get("/users").json()}
    assert users[uid]["dal_portale"] is True
    r = client.patch(f"/users/{uid}", json={"role": "admin"})
    assert r.status_code == 409 and "Portale" in r.json()["detail"]
    assert client.patch(f"/users/{uid}", json={"role": "field"}).status_code == 200      # sotto admin: qui


def test_etichette_e_inviti_da_admin_solo_dal_proprietario(client, profili_portale):
    corpo = {"name": "Amministratore", "role": "admin"}
    r = client.post("/invite-labels", json=corpo)
    assert r.status_code == 403 and "proprietario" in r.json()["detail"]
    lab = client.post("/invite-labels", json={"name": "Operaio", "role": "field"}).json()
    assert client.patch(f"/invite-labels/{lab['id']}", json={"role": "admin"}).status_code == 403


def test_inviti_con_etichetta_admin_dal_proprietario(client, proprietario):
    lab = client.post("/invite-labels", json={"name": "Amministratore", "role": "admin"}).json()
    assert client.post("/invites", json={"email": "nuovo.admin@test.local", "label_id": lab["id"]}).status_code == 201
    # un altro admin (non proprietario) non può invitare con quell'etichetta
    client.post("/users", json={"email": "a2@test.local", "name": "A2", "password": "123456789012", "role": "admin"})
    h = login(client, "a2@test.local", "123456789012")
    r = client.post("/invites", headers=h, json={"email": "x.admin@test.local", "label_id": lab["id"]})
    assert r.status_code == 403


def test_senza_portale_vale_la_regola_di_prima(client, monkeypatch):
    """InCampo installato da solo (COSEDIL_SSO=off): nessun proprietario da chiedere, ogni admin gestisce gli admin."""
    monkeypatch.setattr(suite_router, "SSO_ATTIVO", False)
    r = client.post("/users", json={"email": "solo@test.local", "name": "S", "password": "123456789012", "role": "admin"})
    assert r.status_code == 201
    assert client.get("/users/gestione-admin").json() == {"puo_gestire_admin": True, "motivo": "", "portale": False}


@pytest.mark.parametrize("risposta, atteso", [
    ({"ok": True, "trovato": False}, {"raggiungibile": True, "trovato": False}),
    ({"ok": True, "trovato": True, "username": "X.Y", "ruolo": "admin", "proprietario": True, "abilitato": True},
     {"raggiungibile": True, "trovato": True, "username": "x.y", "proprietario": True, "abilitato": True,
      "email": "x.y@cosedilspa.com"}),
    ({"ok": False}, {"raggiungibile": False}),
])
def test_profilo_portale_legge_il_contratto(monkeypatch, risposta, atteso):
    """profilo_portale vero (non il finto): corpo, token e lettura della risposta di /api/suite/profilo."""
    import json
    import urllib.request
    chiamate = []

    class _Resp:
        def read(self):
            return json.dumps(risposta).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(req, timeout=0):
        chiamate.append((req.full_url, req.headers, json.loads(req.data)))
        return _Resp()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(suite_router.suite_link, "token", lambda: "tok")
    esito = _PROFILO_VERO("x.y@cosedilspa.com")
    for k, v in atteso.items():
        assert esito[k] == v, (k, esito)
    url, testata, corpo = chiamate[0]
    assert url.endswith("/api/suite/profilo") and corpo == {"login": "x.y@cosedilspa.com", "app": "incampo"}
    assert {k.lower(): v for k, v in testata.items()}["x-suite-token"] == "tok"


# la funzione vera, presa prima che la fixture autouse la sostituisca col finto
_PROFILO_VERO = suite_router.profilo_portale
