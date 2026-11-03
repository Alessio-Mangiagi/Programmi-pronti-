# "><(((º> sabusabu <º)))><"
"""Login automatico dal portale della suite (POST /auth/portale): sessione del portale → sessione SkyTower,
utente creato se manca, membro dei progetti con codice commessa (CONTRATTI.md §1-2). Il portale è finto."""
import uuid

import pytest

from cde_api.modules import portale
from cde_api.tooling.demo_seed import DEMO_PASSWORD

COMMESSA = "102-" + uuid.uuid4().hex[:5].upper()


@pytest.fixture
def as_user(client, api_world):
    _, w = api_world
    tokens: dict[str, str] = {}

    def headers(user: str) -> dict:
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": w.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = r.json()["access_token"]
        return {"Authorization": f"Bearer {tokens[user]}"}
    return headers


@pytest.fixture
def progetto_collegato(client, api_world, as_user):
    _, w = api_world
    r = client.patch(f"/projects/{w.project_id}", headers=as_user("com_admin"), json={"settings": {"commessa": COMMESSA}})
    assert r.status_code == 200, r.text
    return w


@pytest.fixture
def portale_finto(monkeypatch, api_world):
    """Il portale risponde quello che il test decide; registra i cookie ricevuti. Alla fine toglie le membership
    create (il DB di test è condiviso: un DESIGNER in più cambierebbe i quorum dei workflow) e spegne gli utenti."""
    stato = {"esito": {"ok": False, "reachable": True, "username": None, "nome": None, "ruolo": None, "admin": False, "email": None},
             "cookie": [], "creati": []}

    def verifica(cookie_header):
        stato["cookie"].append(cookie_header)
        return dict(stato["esito"])
    monkeypatch.setattr(portale, "verifica_portale", verifica)

    def loggato(username, nome="Mario Rossi", email=None, admin=False):
        stato["esito"].update(ok=True, username=username, nome=nome, email=email, admin=admin, ruolo="admin" if admin else "utente")
        if email is None:
            stato["creati"].append(f"{username}@cosedilspa.com")
    stato["loggato"] = loggato
    yield stato
    if stato["creati"]:
        import psycopg
        urls, _ = api_world
        with psycopg.connect(urls.owner) as conn:
            conn.execute("""DELETE FROM cde.project_memberships WHERE user_id IN (SELECT id FROM cde.users WHERE email = ANY(%s))""",
                         [stato["creati"]])
            conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE email = ANY(%s)", [stato["creati"]])
            conn.commit()


def _entra(client, cookie="sid=abc"):
    return client.post("/auth/portale", headers={"Cookie": cookie})


def test_senza_sessione_o_portale_spento(client, portale_finto):
    r = _entra(client)
    assert r.status_code == 401 and r.json()["error"]["code"] == "portale_no_sessione"
    assert portale_finto["cookie"] == ["sid=abc"]
    portale_finto["esito"]["reachable"] = False
    r = _entra(client)
    assert r.status_code == 401 and r.json()["error"]["code"] == "portale_irraggiungibile"


def test_utente_esistente_entra_per_email(client, api_world, portale_finto):
    _, w = api_world
    portale_finto["loggato"]("com.admin", email=w.emails["com_admin"])
    r = _entra(client)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "ok" and d["access_token"] and d["creato"] is False and d["email"] == w.emails["com_admin"]
    me = client.get("/me", headers={"Authorization": f"Bearer {d['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == w.emails["com_admin"]
    assert "cde_rt=" in (r.headers.get("set-cookie") or "")      # cookie di refresh come dopo il login


def test_utente_esistente_per_parte_prima_della_chiocciola(client, api_world, portale_finto):
    _, w = api_world
    portale_finto["loggato"]("des.designer")          # nessuna email dal portale: username = parte locale
    r = _entra(client)
    assert r.status_code == 200, r.text
    assert r.json()["creato"] is False and r.json()["email"] == w.emails["des_designer"]


def test_utente_nuovo_creato_e_membro_dei_progetti_con_commessa(client, progetto_collegato, portale_finto, as_user):
    w = progetto_collegato
    utente = "p.verdi" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Paola Verdi")
    r = _entra(client)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["creato"] is True and d["email"] == f"{utente}@cosedilspa.com"
    assert "PRJ01" in d["progetti_aggiunti"] or d["progetti_aggiunti"]      # il progetto demo con la commessa
    h = {"Authorization": f"Bearer {d['access_token']}"}
    me = client.get("/me", headers=h).json()
    assert me["first_name"] == "Paola" and me["last_name"] == "Verdi" and me["email"] == d["email"]
    p = client.get(f"/projects/{w.project_id}", headers=h)
    assert p.status_code == 200, p.text
    perm = p.json()["my_permissions"]
    assert (perm["READ"]["PROJECT"] or perm["READ"]["OWN_ORGANIZATION"]) and not perm["ADMIN"]["PROJECT"]
    membri = client.get(f"/projects/{w.project_id}/members", headers=as_user("com_admin")).json()
    assert next(m for m in membri if m["email"] == d["email"])["role_code"] == "DESIGNER"
    # il progetto senza commessa non viene toccato
    assert client.get(f"/projects/{w.project2_id}", headers=h).status_code in (403, 404)
    # secondo accesso: stesso utente, niente doppioni
    r2 = _entra(client)
    assert r2.status_code == 200 and r2.json()["creato"] is False and r2.json()["progetti_aggiunti"] == []
    # non può entrare con la password (non ne ha)
    client.app.state.services.limiter.reset()
    assert client.post("/auth/login", json={"email": d["email"], "password": "qualunque-cosa"}).status_code == 401


def test_admin_del_portale_diventa_project_admin(client, progetto_collegato, portale_finto):
    w = progetto_collegato
    utente = "a.bianchi" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Anna Bianchi", admin=True)
    r = _entra(client)
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=h).json()["is_org_admin"] is True
    assert client.get(f"/projects/{w.project_id}", headers=h).json()["my_permissions"]["ADMIN"]["PROJECT"] is True
