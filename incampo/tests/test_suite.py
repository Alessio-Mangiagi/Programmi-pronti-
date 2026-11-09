# "><(((º> sabusabu <º)))><"
"""Dialogo con Magazzino e SkyTower: rotte offerte (token di servizio) e rotte utente che chiamano
le altre app (finte con monkeypatch su suite_link.chiama)."""
import io
import json
import os

import pytest
from PIL import Image

from app.routers import suite as suite_router

os.environ["SUITE_TOKEN"] = "token-di-prova"
TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "admin@test.local", "X-Suite-Nome": "Amministratore"}


def png_bytes(w=640, h=480) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def commessa(client, project):
    """Commessa 101-003 con il cantiere del fixture project, un pin con task aperto e una NC."""
    c = client.post("/commesse", json={"code": "101-003", "name": "Porto di Augusta", "client": "Autorità portuale"}).json()
    pid = project["project"]["id"]
    assert client.patch(f"/projects/{pid}", json={"commessa_id": c["id"]}).status_code == 200
    pin = client.post("/pins", json={"plan_id": project["plan"]["id"], "x": 0.5, "y": 0.5, "label": "Pilastro 3"}).json()
    task = client.post("/tasks", json={"pin_id": pin["id"], "title": "Gru da verificare"}).json()
    io_ = client.get("/auth/me").json()["id"]
    # open → assigned → resolved: le transizioni ammesse dal web
    chiuso = client.post("/tasks", json={"project_id": pid, "title": "Già risolto", "assigned_to": io_}).json()
    assert client.patch(f"/tasks/{chiuso['id']}", json={"status": "resolved"}).status_code == 200
    sub = client.post("/submissions", json={"template_id": project["template"]["id"], "pin_id": pin["id"],
                                            "data_json": {"esito": "Non conforme"}}).json()
    ok = client.post("/submissions", json={"template_id": project["template"]["id"], "pin_id": pin["id"],
                                           "data_json": {"esito": "Conforme"}}).json()
    return {"commessa": c, "project_id": pid, "pin": pin, "task": task, "nc": sub, "ok": ok}


# --------------------------------------------------------------------------- offerto alle altre app

def test_suite_richiede_token(client, commessa):
    assert client.get("/suite/commesse", headers={"Authorization": ""}).status_code == 403
    assert client.get("/suite/commesse/101-003/riepilogo", headers={"X-Suite-Token": "no"}).status_code == 403


def test_suite_commesse_e_cantieri(client, commessa):
    r = client.get("/suite/commesse", headers=TOKEN)
    assert r.status_code == 200
    lista = r.json()
    assert lista[0]["code"] == "101-003" and lista[0]["cantieri"][0]["name"] == "Cantiere A"
    assert lista[0]["cantieri"][0]["url"].endswith(f"/projects/{commessa['project_id']}/plans")


def test_suite_riepilogo_task_e_nc(client, commessa):
    r = client.get("/suite/commesse/ 101-003 /riepilogo", headers=TOKEN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["commessa"]["name"] == "Porto di Augusta"
    assert d["cantieri"][0]["task_aperti"] == 1 and d["cantieri"][0]["nc_aperte"] == 1
    assert [t["title"] for t in d["task"]] == ["Gru da verificare"]
    assert d["task"][0]["plan_name"] == "Piano terra" and d["task"][0]["pin_label"] == "Pilastro 3"
    assert d["task"][0]["url"].endswith(f"/plans/{commessa['pin']['plan_id']}?pin={commessa['pin']['id']}")
    assert d["nc"][0]["value"] == "Non conforme" and d["nc"][0]["template_name"] == "Ispezione"
    assert client.get("/suite/commesse/999/riepilogo", headers=TOKEN).status_code == 404


def test_suite_nc_con_task_chiuso_sparisce(client, commessa):
    io_ = client.get("/auth/me").json()["id"]
    t = client.post("/tasks", json={"pin_id": commessa["pin"]["id"], "submission_id": commessa["nc"]["id"], "title": "Sistemare",
                                    "assigned_to": io_}).json()
    assert client.patch(f"/tasks/{t['id']}", json={"status": "resolved"}).status_code == 200
    d = client.get("/suite/commesse/101-003/riepilogo", headers=TOKEN).json()
    assert d["nc"] == [] and d["cantieri"][0]["nc_aperte"] == 0


def test_suite_crea_task_attribuito(client, commessa):
    r = client.post("/suite/commesse/101-003/task", json={"title": "Escavatore fermo", "description": "Perde olio"}, headers=TOKEN)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "open" and t["project_id"] == commessa["project_id"] and t["url"].endswith("/tasks")
    dett = client.get(f"/tasks/{t['id']}").json()
    assert dett["created_by"] is not None and dett["description"] == "Perde olio"
    # utente del portale senza corrispondenza in InCampo: niente autore, ma resta scritto chi era
    r2 = client.post("/suite/commesse/101-003/task", json={"title": "Materiale finito"},
                     headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi", "X-Suite-Nome": "Mario Rossi"})
    assert r2.status_code == 201
    assert "Segnalato da Mario Rossi" in client.get(f"/tasks/{r2.json()['id']}").json()["description"]
    assert client.post("/suite/commesse/101-003/task", json={"title": "x", "project_id": "nope"}, headers=TOKEN).status_code == 404


# --------------------------------------------------------------------------- verso Magazzino e SkyTower

@pytest.fixture
def altre_app(monkeypatch):
    chiamate = []

    def chiama(app, metodo, percorso, **kw):
        chiamate.append((app, metodo, percorso, kw))
        if app == "magazzino":
            return {"commessa": "101-003", "articoli": [{"codice": "MAG-00001", "descrizione": "Sabbia", "quantita": 12, "um": "ton"}],
                    "mezzi": [], "totali": {"articoli": 1, "mezzi": 0, "mezzi_in_uso": 0}, "url": "http://localhost:5200/#giacenze"}
        if app == "skytower" and percorso.endswith("/file"):
            return png_bytes(), "image/png"
        if app == "skytower" and metodo == "POST":
            return {"document_id": "d1", "identifier": "PRJ-COS-ZZ-ZZ-RP-Z-0002", "revision_code": "P01.01", "url": "http://localhost:5195/documenti/d1"}
        if app == "skytower":
            return {"items": [{"id": "d0", "identifier": "PRJ-COS-ZZ-00-DR-A-0001", "title": "Pianta piano terra", "revision_id": "r1"}]}
        raise AssertionError((app, percorso))

    monkeypatch.setattr(suite_router.suite_link, "chiama", chiama)
    return chiamate


def test_magazzino_del_cantiere(client, commessa, altre_app):
    r = client.get(f"/projects/{commessa['project_id']}/magazzino")
    assert r.status_code == 200, r.text
    assert r.json()["articoli"][0]["descrizione"] == "Sabbia" and r.json()["commessa_code"] == "101-003"
    app, metodo, percorso, kw = altre_app[0]
    assert (app, metodo, percorso) == ("magazzino", "GET", "/suite/commesse/101-003/giacenze")
    assert kw["utente"] == "admin@test.local"


def test_cantiere_senza_commessa(client, project, altre_app):
    r = client.get(f"/projects/{project['project']['id']}/magazzino")
    assert r.status_code == 409 and "commessa" in r.json()["detail"]


def test_app_spenta(client, commessa, monkeypatch):
    def giu(*a, **k):
        raise suite_router.suite_link.SuiteError("magazzino", 503, "Magazzino Operativo non raggiungibile")
    monkeypatch.setattr(suite_router.suite_link, "chiama", giu)
    r = client.get(f"/projects/{commessa['project_id']}/magazzino")
    assert r.status_code == 503 and "non raggiungibile" in r.json()["detail"]


def test_documenti_skytower_e_planimetria(client, commessa, altre_app):
    r = client.get(f"/projects/{commessa['project_id']}/skytower/documenti?q=pianta")
    assert r.status_code == 200 and r.json()["items"][0]["title"] == "Pianta piano terra"
    assert altre_app[0][3]["parametri"] == {"q": "pianta", "area": "PUBLISHED"}
    r = client.post("/plans/da-skytower", json={"project_id": commessa["project_id"], "revision_id": "r1", "name": "Pianta da SkyTower"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["name"] == "Pianta da SkyTower" and p["width_px"] == 640 and p["height_px"] == 480 and p["file_url"]
    assert altre_app[1][2] == "/suite/revisioni/r1/file" and altre_app[1][3]["grezzo"] is True
    nomi = [x["name"] for x in client.get(f"/projects/{commessa['project_id']}/plans").json()]
    assert "Pianta da SkyTower" in nomi


def test_planimetria_da_skytower_solo_manager(client, commessa, users, altre_app):
    r = client.post("/plans/da-skytower", json={"project_id": commessa["project_id"], "revision_id": "r1", "name": "X"},
                    headers=users["field"]["headers"])
    assert r.status_code == 403


def test_modulo_su_skytower(client, commessa, altre_app):
    r = client.post(f"/submissions/{commessa['nc']['id']}/skytower", json={})
    assert r.status_code == 201, r.text
    assert r.json()["identifier"].endswith("RP-Z-0002")
    app, metodo, percorso, kw = altre_app[0]
    assert (app, metodo, percorso) == ("skytower", "POST", "/suite/commesse/101-003/documenti")
    dati, tipo, nome = kw["corpo_file"]
    assert nome.startswith("incampo-ispezione-") and dati.startswith(b"%PDF") and tipo == "application/pdf"
    assert kw["parametri"]["title"].startswith("NC Ispezione Cantiere A") and json.loads(kw["parametri"]["attributes"])["non_conformita"] is True
    r2 = client.post(f"/submissions/{commessa['ok']['id']}/skytower", json={"title": "Ispezione pilastro 3"})
    assert r2.status_code == 201 and altre_app[1][3]["parametri"]["title"] == "Ispezione pilastro 3"
    assert json.loads(altre_app[1][3]["parametri"]["attributes"])["non_conformita"] is False


# --------------------------------------------------------------------------- login automatico dal portale

@pytest.fixture
def portale_finto(monkeypatch):
    """Il portale risponde a /api/verify con l'utente di `risposta` (dict), o con l'errore impostato."""
    import urllib.error
    import urllib.request
    stato = {"risposta": {"ok": True, "username": "m.rossi", "nome": "Mario Rossi", "ruolo": "utente", "admin": False,
                          "email": "mario.rossi@cosedilspa.com"}, "http": None, "giu": False, "chiamate": []}

    class _Resp:
        def __init__(self, dati):
            self._d = json.dumps(dati).encode()

        def read(self):
            return self._d

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(req, timeout=0):
        stato["chiamate"].append((req.full_url, req.headers.get("Cookie")))
        if stato["giu"]:
            raise urllib.error.URLError("spento")
        if stato["http"]:
            raise urllib.error.HTTPError(req.full_url, stato["http"], "no", {}, None)
        return _Resp(stato["risposta"])

    monkeypatch.setattr(suite_router, "SSO_ATTIVO", True)
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return stato


def test_login_portale_crea_utente_e_entra(client, portale_finto):
    r = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=abc.def"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["email"] == "mario.rossi@cosedilspa.com" and d["user"]["role"] == "manager" and d["user"]["name"] == "Mario Rossi"
    assert portale_finto["chiamate"][0][0].endswith("/api/verify?app=incampo") and portale_finto["chiamate"][0][1] == "sid=abc.def"
    # il token funziona e il secondo accesso ritrova lo stesso utente (nessun doppione)
    me = client.get("/auth/me", headers={"Authorization": "Bearer " + d["access_token"]})
    assert me.status_code == 200 and me.json()["id"] == d["user"]["id"]
    r2 = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=abc.def"})
    assert r2.json()["user"]["id"] == d["user"]["id"]
    with client.session_factory() as s:
        assert s.query(suite_router.models.User).filter_by(email="mario.rossi@cosedilspa.com").count() == 1


def test_login_portale_admin_e_username_senza_email(client, portale_finto, monkeypatch):
    monkeypatch.setattr(suite_router, "EMAIL_DOMINIO", "cosedil.it")
    portale_finto["risposta"] = {"ok": True, "username": "g.verdi", "nome": "Giulia Verdi", "ruolo": "admin", "admin": True}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"}).json()
    assert d["user"]["email"] == "g.verdi@cosedil.it" and d["user"]["role"] == "admin"
    # utente già esistente nel dominio della suite con la parte prima della @ uguale allo username: lo ritrova
    with client.session_factory() as s:
        from tests.conftest import make_user
        make_user(s, "l.bianchi@cosedil.it", "field", name="Luca")
        make_user(s, "m.rossi@altrodominio.it", "field", name="Mario")
        make_user(s, "capo@cosedil.it", "admin", name="Capo")
    portale_finto["risposta"] = {"ok": True, "username": "l.bianchi", "nome": "Luca Bianchi", "ruolo": "utente"}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=y"}).json()
    assert d["user"]["email"] == "l.bianchi@cosedil.it" and d["user"]["role"] == "field"
    # stesso username ma account di un altro dominio: non lo aggancia, crea l'utente della suite
    # (prima entrava come quell'account senza password: revisione di sicurezza del 03/11/2026)
    portale_finto["risposta"] = {"ok": True, "username": "m.rossi", "nome": "Mario Rossi", "ruolo": "utente"}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=z"}).json()
    assert d["user"]["email"] == "m.rossi@cosedil.it"
    # username uguale alla parte locale di un admin: mai agganciato per username
    portale_finto["risposta"] = {"ok": True, "username": "capo", "nome": "Capo", "ruolo": "utente",
                                 "email": "capo.cantiere@cosedil.it"}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=w"}).json()
    assert d["user"]["email"] == "capo.cantiere@cosedil.it" and d["user"]["role"] != "admin"


# Regola della suite del 09/11/2026: "le mie credenziali valgono come admin ovunque". Prima il ruolo dal
# portale valeva solo alla creazione dell'utente InCampo; ora un amministratore del portale diventa admin a
# ogni ingresso (cookie, password del portale, /auth/me con un token già salvato). Solo promozione.

def test_admin_del_portale_promuove_utente_esistente(client, portale_finto):
    from tests.conftest import make_user
    with client.session_factory() as s:
        make_user(s, "a.capo@cosedilspa.com", "field", name="Anna Capo")
    portale_finto["risposta"] = {"ok": True, "username": "a.capo", "nome": "Anna Capo", "ruolo": "admin", "admin": True,
                                 "email": "a.capo@cosedilspa.com"}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=a"}).json()
    assert d["user"]["role"] == "admin"
    with client.session_factory() as s:
        ev = s.query(suite_router.models.AuditLog).filter_by(action="user.updated", actor_email="a.capo@cosedilspa.com").all()
        assert any((e.details or {}).get("origine") == "admin-del-portale"
                   and (e.details or {}).get("role") == {"da": "field", "a": "admin"} for e in ev)


def test_admin_solo_da_regola_ip_o_utente_normale_non_promossi(client, portale_finto):
    from tests.conftest import make_user
    with client.session_factory() as s:
        make_user(s, "b.campo@cosedilspa.com", "field", name="Bruno Campo")
    # admin per l'app concesso da una regola IP del portale (ruolo utente): il ruolo qui non cambia
    portale_finto["risposta"] = {"ok": True, "username": "b.campo", "nome": "Bruno Campo", "ruolo": "utente", "admin": True,
                                 "email": "b.campo@cosedilspa.com"}
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=b"}).json()
    assert d["user"]["role"] == "field"
    portale_finto["risposta"]["admin"] = False
    d = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=b"}).json()
    assert d["user"]["role"] == "field"


def test_auth_me_promuove_chi_ha_gia_il_token_solo_se_e_la_stessa_persona(client, portale_finto):
    from tests.conftest import login, make_user
    with client.session_factory() as s:
        make_user(s, "c.token@cosedilspa.com", "manager", name="Carla Token")
        make_user(s, "d.altro@cosedilspa.com", "field", name="Dario Altro")
    # token di Dario, ma nel browser c'è la sessione del portale di Carla (admin): Dario NON diventa admin
    h = login(client, "d.altro@cosedilspa.com")
    portale_finto["risposta"] = {"ok": True, "username": "c.token", "nome": "Carla Token", "ruolo": "admin", "admin": True,
                                 "email": "c.token@cosedilspa.com"}
    assert client.get("/auth/me", headers={**h, "Cookie": "sid=c"}).json()["role"] == "field"
    # token di Carla e sessione del portale di Carla, admin nel portale: promossa all'apertura del web
    h = login(client, "c.token@cosedilspa.com")
    assert client.get("/auth/me", headers=h).json()["role"] == "manager"            # senza cookie del portale: com'era
    assert client.get("/auth/me", headers={**h, "Cookie": "sid=c"}).json()["role"] == "admin"
    # un admin non richiama più il portale
    chiamate = len(portale_finto["chiamate"])
    client.get("/auth/me", headers={**h, "Cookie": "sid=c"})
    assert len(portale_finto["chiamate"]) == chiamate


def test_login_portale_rifiuti(client, portale_finto, monkeypatch):
    assert client.post("/auth/portale", headers={"Authorization": ""}).status_code == 401          # niente cookie
    portale_finto["http"] = 403
    r = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"})
    assert r.status_code == 401 and "abilitato" in r.json()["detail"]
    portale_finto["http"] = 401
    assert client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"}).status_code == 401
    portale_finto["http"] = None
    portale_finto["giu"] = True
    r = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"})
    assert r.status_code == 401 and "raggiungibile" in r.json()["detail"]
    portale_finto["giu"] = False
    monkeypatch.setattr(suite_router, "SSO_ATTIVO", False)
    r = client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"})
    assert r.status_code == 401 and "COSEDIL_SSO" in r.json()["detail"]
    # utente disattivato: niente accesso
    monkeypatch.setattr(suite_router, "SSO_ATTIVO", True)
    with client.session_factory() as s:
        u = s.query(suite_router.models.User).filter_by(email="admin@test.local").one()
        u.is_active = False
        s.commit()
    portale_finto["risposta"] = {"ok": True, "username": "admin", "nome": "Admin", "ruolo": "utente", "email": "admin@test.local"}
    assert client.post("/auth/portale", headers={"Authorization": "", "Cookie": "sid=x"}).status_code == 401


# --------------------------------------------------------------------------- password del portale al login
@pytest.fixture()
def password_portale(monkeypatch):
    """Finto cosedil_sso.verifica_password: "Portale-2026!" è la password del portale di mario.rossi."""
    stato = {"chiamate": [], "esito": None}

    def verifica(login, password, app_id, ip=None, timeout=4):
        stato["chiamate"].append({"login": login, "app": app_id, "ip": ip})
        if stato["esito"] is not None:
            return stato["esito"]
        if login == "mario.rossi@cosedilspa.com" and password == "Portale-2026!":
            return {"ok": True, "reachable": True, "status": 200, "errore": "", "motivo": "", "username": "mario.rossi",
                    "nome": "Mario Rossi", "email": "mario.rossi@cosedilspa.com", "ruolo": "utente", "admin": False}
        return {"ok": False, "reachable": True, "status": 401, "errore": "Credenziali non valide", "motivo": ""}

    monkeypatch.setattr(suite_router.cosedil_sso, "verifica_password", verifica)
    return stato


def test_login_con_password_del_portale_crea_e_ritrova_l_utente(client, password_portale):
    r = client.post("/auth/login", json={"email": "Mario.Rossi@cosedilspa.com", "password": "Portale-2026!"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["email"] == "mario.rossi@cosedilspa.com" and d["user"]["role"] == "manager"
    assert password_portale["chiamate"][0]["app"] == "incampo" and password_portale["chiamate"][0]["ip"]
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + d["access_token"]}).status_code == 200
    # secondo login: stesso utente, nessun doppione; nel registro l'origine
    assert client.post("/auth/login", json={"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"}).json()["user"]["id"] == d["user"]["id"]
    with client.session_factory() as s:
        assert s.query(suite_router.models.User).filter_by(email="mario.rossi@cosedilspa.com").count() == 1
        voci = s.query(suite_router.models.AuditLog).filter_by(action="auth.login").all()
        assert any((v.details or {}).get("origine") == "password-portale" for v in voci)


def test_login_password_propria_resta_valida_e_non_chiama_il_portale(client, password_portale):
    from tests.conftest import PASSWORD
    assert client.post("/auth/login", json={"email": "admin@test.local", "password": PASSWORD}).status_code == 200
    assert password_portale["chiamate"] == [], "con la password di InCampo il portale non serve"


def test_login_password_sbagliata_ovunque_conta_come_errore(client, password_portale, monkeypatch):
    from app.routers import users as users_router
    monkeypatch.setattr(users_router, "LOGIN_MAX_FAILS_PER_IP", 2)
    bad = {"email": "mario.rossi@cosedilspa.com", "password": "sbagliata"}
    assert client.post("/auth/login", json=bad).status_code == 401
    assert client.post("/auth/login", json=bad).status_code == 401
    # il blocco di InCampo vale anche per la password del portale
    good = {"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"}
    assert client.post("/auth/login", json=good).status_code == 429


def test_login_password_portale_rifiuti_del_portale(client, password_portale):
    password_portale["esito"] = {"ok": False, "reachable": True, "status": 403, "motivo": "non-abilitato",
                                 "errore": "InCampo non è fra i tuoi programmi del Portale"}
    r = client.post("/auth/login", json={"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"})
    assert r.status_code == 403 and "programmi" in r.json()["detail"]
    password_portale["esito"] = {"ok": False, "reachable": True, "status": 429, "motivo": "",
                                 "errore": "Troppi tentativi falliti. Riprova tra 15 minuti."}
    assert client.post("/auth/login", json={"email": "x@y.it", "password": "z"}).status_code == 429
    # portale spento: resta la password di InCampo, l'errore è quello solito
    password_portale["esito"] = {"ok": False, "reachable": False, "status": 0, "motivo": "", "errore": ""}
    r = client.post("/auth/login", json={"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"})
    assert r.status_code == 401 and r.json()["detail"] == "Email o password errati"
    # utente InCampo disattivato: la password del portale non lo riaccende
    password_portale["esito"] = None
    with client.session_factory() as s:
        from tests.conftest import make_user
        u = make_user(s, "mario.rossi@cosedilspa.com", "field")
        u.is_active = False
        s.commit()
    r = client.post("/auth/login", json={"email": "mario.rossi@cosedilspa.com", "password": "Portale-2026!"})
    assert r.status_code == 401 and "disattivato" in r.json()["detail"]


# --------------------------------------------------------------------------- registro commesse

def test_commesse_registro(client, monkeypatch, tmp_path):
    monkeypatch.setattr(suite_router.suite_link, "FILE_COMMESSE", tmp_path / "commesse.json")
    assert client.get("/commesse/registro").json() == []
    suite_router.suite_link.salva_commesse([{"code": "101-003", "nome": "Porto di Augusta"}, {"code": "C-1", "stato": "chiusa"}])
    lista = client.get("/commesse/registro").json()
    assert [c["code"] for c in lista] == ["101-003", "C-1"] and lista[0]["nome"] == "Porto di Augusta"
    assert [c["code"] for c in client.get("/commesse/registro?solo_attive=true").json()] == ["101-003"]
    assert client.get("/commesse/registro", headers={"Authorization": ""}).status_code == 401


# --------------------------------------------------------------------------- da fare

def test_suite_da_fare(client, commessa, users, monkeypatch):
    """Task assegnati all'utente (scaduti prima), NC aperte per i manager, niente per chi non c'è."""
    # X-Suite-Utente trova l'utente per parte locale solo nel dominio della suite: qui quello dei test
    monkeypatch.setattr(suite_router, "EMAIL_DOMINIO", "test.local")
    pid = commessa["project_id"]
    field = users["field"]
    client.post("/tasks", json={"project_id": pid, "title": "Transenne da sistemare", "assigned_to": field["id"], "due_date": "2030-01-01T00:00:00"})
    client.post("/tasks", json={"project_id": pid, "title": "Scaduto", "assigned_to": field["id"], "due_date": "2020-01-01T00:00:00"})
    client.post("/tasks", json={"project_id": pid, "title": "Di un altro", "assigned_to": users["manager"]["id"]})
    r = client.get("/suite/da-fare", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Email": field["email"]})
    assert r.status_code == 200, r.text
    voci = r.json()["voci"]
    assert [v["titolo"] for v in voci] == ["Scaduto", "Transenne da sistemare"]
    assert voci[0]["priorita"] == 1 and "scaduto" in voci[0]["testo"] and voci[0]["tipo"] == "task"
    assert voci[1]["data"] == "2030-01-01" and voci[1]["url"].endswith("/projects/" + pid + "/tasks") and "Cantiere A" in voci[1]["testo"]
    # manager: il suo task + la NC aperta del cantiere
    r = client.get("/suite/da-fare", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "manager"})
    tipi = [(v["tipo"], v["titolo"]) for v in r.json()["voci"]]
    assert ("task", "Di un altro") in tipi and any(t == "nc" and "Non conforme" in titolo for t, titolo in tipi)
    # sconosciuto: lista vuota, non errore; senza token 403
    assert client.get("/suite/da-fare", headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "nessuno"}).json() == {"voci": []}
    assert client.get("/suite/da-fare", headers={"X-Suite-Token": "no"}).status_code == 403
