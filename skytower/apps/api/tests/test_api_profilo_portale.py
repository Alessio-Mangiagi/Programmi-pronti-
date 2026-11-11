# "><(((º> sabusabu <º)))><"
"""Il profilo del portale della suite vale in SkyTower (ADR-58, decisione dell'utente dell'11/11/2026: "il profilo del
portale vale per ogni programma", "gli admin li creo e li cancello solo io", scelte 2b 3b 4a). Il portale è finto.

* account collegato per username: un'email cambiata nel portale aggiorna l'account, niente doppioni;
* admin dell'organizzazione e Project Admin della regola di ADR-57 dati E TOLTI a ogni ingresso, i ruoli di prima restano;
* alla creazione la regola IP del portale non basta per diventare admin;
* login con la password di SkyTower: persona disattivata, SkyTower non fra i suoi programmi o eliminata → 403; portale
  spento → si entra (3b); il profilo si copia anche da qui;
* la catena dei rinnovi della sessione scade alla data del login (tetto assoluto: il login torna, 2b);
* dare o togliere l'admin dentro SkyTower: solo il proprietario della suite, verificato col portale;
* reset della password: niente link a chi il portale ha disattivato."""
import uuid

import psycopg
import pytest

from cde_api.modules import auth, portale
from cde_api.tooling.demo_seed import DEMO_PASSWORD

COMMESSA = "103-" + uuid.uuid4().hex[:5].upper()
PASSWORD = "Password-Prova-2026!"  # noqa: S105 - solo account di prova
NON_RAGGIUNGIBILE = {"reachable": False, "trovato": False, "username": None, "nome": None, "email": None, "ruolo": None,
                     "admin": False, "proprietario": False, "disattivato": False, "abilitato": False, "status": 0}


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
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


@pytest.fixture
def finto(monkeypatch, api_world):
    """Portale finto: ``sessione`` è la risposta di /api/verify per il cookie sid (POST /auth/portale), ``profili`` le
    persone che /api/suite/profilo conosce (per username e per email). ``persona(...)`` le scrive entrambe. Alla fine
    toglie membership e collegamenti e spegne gli account creati (il DB di test è condiviso fra i file)."""
    stato = {"sessione": None, "profili": {}, "chiamate": [], "raggiungibile": True, "usernames": []}

    def verifica(cookie_header):
        if stato["sessione"] is None:
            return {"ok": False, "reachable": True, "username": None, "nome": None, "ruolo": None, "admin": False, "email": None}
        return dict(stato["sessione"])

    def profilo(login):
        stato["chiamate"].append(login)
        if not stato["raggiungibile"]:
            return dict(NON_RAGGIUNGIBILE)
        p = stato["profili"].get((login or "").strip().lower())
        if p is None:
            return {**NON_RAGGIUNGIBILE, "reachable": True, "status": 200}
        return {**NON_RAGGIUNGIBILE, "reachable": True, "status": 200, "trovato": True, **p}

    monkeypatch.setattr(portale, "verifica_portale", verifica)
    monkeypatch.setattr(portale, "profilo_portale", profilo)

    def persona(username, nome="Prova Utente", email=None, admin=False, disattivato=False, abilitato=True,
                proprietario=False, ip_admin=False):
        email = (email or f"{username}@cosedilspa.com").lower()
        for k in [k for k, v in stato["profili"].items() if v["username"] == username]:
            del stato["profili"][k]                          # email cambiata: la vecchia non lo trova più
        p = {"username": username, "nome": nome, "email": email, "ruolo": "admin" if admin else "utente", "admin": admin,
             "proprietario": proprietario, "disattivato": disattivato, "abilitato": abilitato}
        stato["profili"][username] = p
        stato["profili"][email] = p
        stato["sessione"] = {"ok": True, "reachable": True, "username": username, "nome": nome, "email": email,
                             "ruolo": p["ruolo"], "admin": admin or ip_admin}
        if username not in stato["usernames"]:
            stato["usernames"].append(username)
        return p

    def elimina(username):
        for k in [k for k, v in stato["profili"].items() if v["username"] == username]:
            del stato["profili"][k]

    stato["persona"], stato["elimina"] = persona, elimina
    yield stato
    urls, w = api_world
    with psycopg.connect(urls.owner) as conn:      # account demo: scollegati, admin del seed (DB di test condiviso)
        from cde_api.tooling import demo_seed
        conn.execute("UPDATE cde.users SET portale_username = NULL WHERE email = ANY(%s)", [list(w.emails.values())])
        for chiave, (_, _, org_admin) in demo_seed.USERS.items():   # admin e nome del seed (il portale li allinea)
            conn.execute("UPDATE cde.users SET is_org_admin = %s, first_name = %s, last_name = %s WHERE id = %s",
                         [org_admin, chiave.split("_")[0].title(), chiave.split("_")[-1].title(), w.users[chiave]])
        conn.commit()
    if stato["usernames"]:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("""DELETE FROM cde.project_memberships WHERE user_id IN
                            (SELECT id FROM cde.users WHERE portale_username = ANY(%s))""", [stato["usernames"]])
            conn.execute("""UPDATE cde.users SET status = 'DISABLED', is_org_admin = false, portale_username = NULL
                            WHERE portale_username = ANY(%s)""", [stato["usernames"]])
            conn.commit()


def _entra(client):
    client.app.state.services.limiter.reset()
    return client.post("/auth/portale", headers={"Cookie": "sid=abc"})


def _login(client, email, password=PASSWORD):
    client.app.state.services.limiter.reset()
    return client.post("/auth/login", json={"email": email, "password": password})


def _me(client, r):
    return client.get("/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()


def _nuovo(prefisso: str) -> str:
    return prefisso + uuid.uuid4().hex[:5]


def _con_password(owner, username):
    owner.execute("UPDATE cde.users SET password_hash = %s WHERE portale_username = %s", [auth.ph.hash(PASSWORD), username])


# --------------------------------------------------------------------------- collegamento e dati anagrafici
def test_collegato_per_username_e_email_cambiata_senza_doppioni(client, finto, owner):
    u = _nuovo("f.rossi")
    finto["persona"](u, nome="Franco Rossi")
    r = _entra(client)
    assert r.status_code == 200 and r.json()["creato"] is True, r.text
    assert owner.execute("SELECT portale_username FROM cde.users WHERE email = %s", [f"{u}@cosedilspa.com"]).fetchone()[0] == u
    # nel portale cambiano email e nome: stesso account, aggiornato
    nuova = f"{u}.nuova@cosedilspa.com"
    finto["persona"](u, nome="Franco Rossi Bianchi", email=nuova)
    r = _entra(client)
    assert r.status_code == 200 and r.json()["creato"] is False and r.json()["email"] == nuova, r.text
    me = _me(client, r)
    assert me["email"] == nuova and me["first_name"] == "Franco Rossi" and me["last_name"] == "Bianchi" and me["dal_portale"]
    assert owner.execute("SELECT count(*) FROM cde.users WHERE email = %s", [f"{u}@cosedilspa.com"]).fetchone()[0] == 0
    assert owner.execute("SELECT count(*) FROM cde.users WHERE portale_username = %s", [u]).fetchone()[0] == 1
    # nome già giusto (anche se diviso diversamente a mano): nessuna riscrittura a ogni ingresso
    owner.execute("UPDATE cde.users SET first_name = 'Franco', last_name = 'Rossi Bianchi' WHERE portale_username = %s", [u])
    prima = owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'PROFILO_DAL_PORTALE' "
                          "AND details->>'username' = %s", [u]).fetchone()[0]
    assert _entra(client).status_code == 200
    dopo = owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'PROFILO_DAL_PORTALE' "
                         "AND details->>'username' = %s", [u]).fetchone()[0]
    assert dopo == prima
    assert owner.execute("SELECT first_name FROM cde.users WHERE portale_username = %s", [u]).fetchone()[0] == "Franco"


def test_email_di_un_account_collegato_a_un_altra_persona(client, finto, owner):
    """L'email del portale appartiene a un account già collegato a un altro username: niente aggancio (403)."""
    a, b = _nuovo("g.primo"), _nuovo("g.secondo")
    finto["persona"](a)
    assert _entra(client).status_code == 200
    finto["persona"](b, email=f"{a}@cosedilspa.com")
    r = _entra(client)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_collegato_ad_altro", r.text


# --------------------------------------------------------------------------- admin dato e tolto
def test_admin_dato_e_tolto_i_ruoli_di_prima_restano(client, progetto_collegato, finto, as_user, owner):
    w = progetto_collegato
    u = _nuovo("h.verdi")
    finto["persona"](u, nome="Elena Verdi")
    r = _entra(client)
    assert r.status_code == 200, r.text
    email = r.json()["email"]

    def ruoli():
        membri = client.get(f"/projects/{w.project_id}/members", headers=as_user("com_admin")).json()
        return {m["role_code"] for m in membri if m["email"] == email}
    assert ruoli() == {"DESIGNER"} and _me(client, r)["is_org_admin"] is False

    finto["persona"](u, nome="Elena Verdi", admin=True)
    r = _entra(client)
    assert _me(client, r)["is_org_admin"] is True and ruoli() == {"DESIGNER", "PROJECT_ADMIN"}
    assert owner.execute("""SELECT pm.dal_portale_admin FROM cde.project_memberships pm JOIN cde.roles r ON r.id = pm.role_id
                            JOIN cde.users u ON u.id = pm.user_id WHERE u.portale_username = %s AND pm.project_id = %s
                            AND r.code = 'PROJECT_ADMIN'""", [u, w.project_id]).fetchone()[0] is True

    finto["persona"](u, nome="Elena Verdi", admin=False)          # il proprietario le toglie l'admin nel portale
    r = _entra(client)
    assert r.status_code == 200, r.text
    assert _me(client, r)["is_org_admin"] is False
    assert ruoli() == {"DESIGNER"}, "il Project Admin della regola va via, il DESIGNER di prima resta"
    assert owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'ORG_ADMIN_TOLTO_DAL_PORTALE' "
                         "AND details->>'username' = %s", [u]).fetchone()[0] == 1
    p = client.get(f"/projects/{w.project_id}", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()
    assert p["my_permissions"]["ADMIN"]["PROJECT"] is False


def test_creato_non_admin_con_la_sola_regola_ip(client, finto):
    """Alla creazione dell'account la regola IP del portale (admin per l'app, ruolo utente) non basta (ADR-58)."""
    finto["persona"](_nuovo("i.neri"), ip_admin=True)
    r = _entra(client)
    assert r.status_code == 200 and r.json()["creato"] is True, r.text
    assert _me(client, r)["is_org_admin"] is False


# --------------------------------------------------------------------------- login con la password di SkyTower
def test_login_con_password_propria_segue_il_profilo(client, finto, owner):
    u = _nuovo("l.gialli")
    p = finto["persona"](u, nome="Luca Gialli")
    assert _entra(client).status_code == 200
    _con_password(owner, u)
    email = p["email"]

    finto["persona"](u, nome="Luca Gialli", disattivato=True)
    r = _login(client, email)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_disattivato", r.text
    assert "access_token" not in r.json() and "cde_rt=" not in (r.headers.get("set-cookie") or "")
    assert finto["chiamate"][-1] == u, "per un account collegato si chiede il profilo per username"

    finto["persona"](u, nome="Luca Gialli", abilitato=False)
    r = _login(client, email)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_non_abilitato", r.text

    finto["persona"](u, nome="Luca Gialli", admin=True)            # il profilo vale anche da qui: admin dato...
    r = _login(client, email)
    assert r.status_code == 200, r.text
    assert _me(client, r)["is_org_admin"] is True
    finto["persona"](u, nome="Luca Gialli")                        # ...e tolto
    r = _login(client, email)
    assert r.status_code == 200 and _me(client, r)["is_org_admin"] is False

    finto["raggiungibile"] = False                                  # portale spento: si entra (3b), annotato
    r = _login(client, email)
    assert r.status_code == 200, r.text
    assert owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'PROFILO_PORTALE_NON_VERIFICATO' "
                         "AND details->>'username' = %s", [u]).fetchone()[0] >= 1
    finto["raggiungibile"] = True

    finto["elimina"](u)                                             # eliminato dal portale
    r = _login(client, email)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_eliminato", r.text


def test_account_trovato_per_email_si_collega_e_quelli_solo_skytower_restano(client, api_world, finto, owner):
    _, w = api_world
    # account nato in SkyTower con la stessa email della persona del portale: al login si collega
    u = _nuovo("m.blu")
    email = f"{u}@cosedilspa.com"
    owner.execute("""INSERT INTO cde.users (id, organization_id, email, first_name, last_name, status, password_hash)
                     VALUES (%s, %s, %s, 'Mara', 'Blu', 'ACTIVE', %s)""", [uuid.uuid4(), w.orgs["COM"], email, auth.ph.hash(PASSWORD)])
    finto["persona"](u, nome="Mara Blu", email=email)
    r = _login(client, email)
    assert r.status_code == 200, r.text
    assert finto["chiamate"][-1] == email
    assert owner.execute("SELECT portale_username FROM cde.users WHERE email = %s", [email]).fetchone()[0] == u
    # account solo-SkyTower (il portale non lo conosce): entra e non si tocca
    r = _login(client, w.emails["com_dl"], DEMO_PASSWORD)
    assert r.status_code == 200, r.text
    assert owner.execute("SELECT portale_username FROM cde.users WHERE email = %s", [w.emails["com_dl"]]).fetchone()[0] is None


def test_reset_password_niente_link_a_chi_e_disattivato(client, finto, owner):
    u = _nuovo("n.viola")
    p = finto["persona"](u)                                         # entra una volta (attivo) per nascere collegato
    assert _entra(client).status_code == 200
    finto["persona"](u, disattivato=True)
    outbox = client.app.state.services.mailer.outbox
    prima = len([m for m in outbox if m.to == p["email"]])
    client.app.state.services.limiter.reset()
    assert client.post("/auth/password/forgot", json={"email": p["email"]}).status_code == 202
    assert len([m for m in outbox if m.to == p["email"]]) == prima, "nessun link a chi il portale ha disattivato"
    finto["persona"](u)
    client.app.state.services.limiter.reset()
    assert client.post("/auth/password/forgot", json={"email": p["email"]}).status_code == 202
    assert len([m for m in outbox if m.to == p["email"]]) == prima + 1


# --------------------------------------------------------------------------- tetto assoluto del rinnovo
def test_la_catena_dei_rinnovi_scade_alla_data_del_login(client, api_world, owner):
    _, w = api_world
    assert _login(client, w.emails["com_im"], DEMO_PASSWORD).status_code == 200
    utente = w.users["com_im"]
    primo = owner.execute("""SELECT family_id, expires_at FROM cde.refresh_tokens WHERE user_id = %s
                             ORDER BY issued_at DESC LIMIT 1""", [utente]).fetchone()
    r = client.post("/auth/refresh")
    assert r.status_code == 200, r.text
    secondo = owner.execute("""SELECT family_id, expires_at FROM cde.refresh_tokens WHERE user_id = %s
                               ORDER BY issued_at DESC LIMIT 1""", [utente]).fetchone()
    assert secondo[0] == primo[0] and secondo[1] == primo[1], "il rinnovo non allunga la scadenza fissata dal login"
    owner.execute("UPDATE cde.refresh_tokens SET expires_at = now() - interval '1 second' WHERE family_id = %s", [primo[0]])
    r = client.post("/auth/refresh")
    assert r.status_code == 401 and r.json()["error"]["message"] == "Sessione scaduta"


# --------------------------------------------------------------------------- admin solo dal proprietario
def test_dare_o_togliere_l_admin_solo_il_proprietario(client, api_world, finto, as_user, owner):
    _, w = api_world
    org = w.orgs["COM"]
    bersaglio = f"/organizations/{org}/users/{w.users['com_dl']}"
    try:
        # com.admin è admin dell'organizzazione ma non il proprietario della suite (non collegato al portale)
        r = client.patch(bersaglio, headers=as_user("com_admin"), json={"is_org_admin": True})
        assert r.status_code == 403 and r.json()["error"]["code"] == "solo_proprietario", r.text
        r = client.post(f"/organizations/{org}/users", headers=as_user("com_admin"),
                        json={"email": f"{_nuovo('o.x')}@com.example", "first_name": "O", "last_name": "X", "is_org_admin": True})
        assert r.status_code == 403 and r.json()["error"]["code"] == "solo_proprietario", r.text
        assert client.get("/me/proprietario", headers=as_user("com_admin")).json() == {
            "proprietario": False, "collegato": False, "raggiungibile": True}
        # anche il platform admin, se non è collegato al portale come proprietario
        r = client.patch(bersaglio, headers=as_user("platform"), json={"is_org_admin": True})
        assert r.status_code == 403, r.text

        # collegato al portale come proprietario: può, dopo la verifica dal vivo
        nome = _nuovo("proprietario.")
        owner.execute("UPDATE cde.users SET portale_username = %s WHERE id = %s", [nome, w.users["com_admin"]])
        finto["persona"](nome, email=w.emails["com_admin"], admin=True, proprietario=True)
        assert client.get("/me/proprietario", headers=as_user("com_admin")).json()["proprietario"] is True
        r = client.patch(bersaglio, headers=as_user("com_admin"), json={"is_org_admin": True})
        assert r.status_code == 200 and r.json()["is_org_admin"] is True, r.text
        r = client.patch(bersaglio, headers=as_user("com_admin"), json={"is_org_admin": False})
        assert r.status_code == 200 and r.json()["is_org_admin"] is False, r.text
        # portale spento: non si può verificare → rifiutato (503), mai indovinato
        finto["raggiungibile"] = False
        r = client.patch(bersaglio, headers=as_user("com_admin"), json={"is_org_admin": True})
        assert r.status_code == 503 and r.json()["error"]["code"] == "portale_irraggiungibile", r.text
        finto["raggiungibile"] = True
        # su un account collegato al portale l'admin lo decide il portale, anche per il proprietario
        u = _nuovo("p.grigi")
        finto["persona"](u)
        assert _entra(client).status_code == 200
        collegato = owner.execute("SELECT id FROM cde.users WHERE portale_username = %s", [u]).fetchone()[0]
        finto["persona"](nome, email=w.emails["com_admin"], admin=True, proprietario=True)
        r = client.patch(f"/organizations/{org}/users/{collegato}", headers=as_user("com_admin"), json={"is_org_admin": True})
        assert r.status_code == 409 and r.json()["error"]["code"] == "deciso_dal_portale", r.text
        listato = {x["id"]: x for x in client.get(f"/organizations/{org}/users", headers=as_user("com_admin")).json()}
        assert listato[str(collegato)]["dal_portale"] is True and listato[str(w.users["com_dl"])]["dal_portale"] is False
    finally:
        owner.execute("UPDATE cde.users SET is_org_admin = false WHERE id = %s", [w.users["com_dl"]])
        owner.execute("UPDATE cde.users SET portale_username = NULL WHERE id = %s", [w.users["com_admin"]])
