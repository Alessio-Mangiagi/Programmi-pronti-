# "><(((º> sabusabu <º)))><"
"""Login automatico dal portale della suite (POST /auth/portale): sessione del portale → sessione SkyTower,
utente creato se manca, membro dei progetti con codice commessa (CONTRATTI.md §1-2). Il portale è finto.

Regole di ADR-47 (revisione di sicurezza del 03/11/2026): solo email esatta e solo nell'organizzazione della
suite (nei test: COM, quella del platform admin del seed); niente platform admin, altre organizzazioni, account
bloccati; MFA come nel login con password; solo progetti dell'organizzazione. ADR-57 (09/11/2026): un amministratore
del portale (ruolo admin) diventa admin dell'organizzazione e Project Admin dei suoi progetti; nessun altro."""
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
    client.app.state.services.limiter.reset()       # 30/minuto per IP: qui tutte le chiamate vengono da testclient
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


def test_parte_prima_della_chiocciola_non_aggancia_account_esistenti(client, api_world, portale_finto):
    """Lo username del portale "des.designer" non diventa l'utente des.designer@des.example (altra organizzazione):
    si crea un utente nuovo dell'organizzazione della suite con l'email <username>@dominio (A2)."""
    _, w = api_world
    portale_finto["loggato"]("des.designer")          # nessuna email dal portale
    r = _entra(client)
    assert r.status_code == 200, r.text
    assert r.json()["creato"] is True and r.json()["email"] == "des.designer@cosedilspa.com"
    assert r.json()["email"] != w.emails["des_designer"]


def test_altre_organizzazioni_e_platform_admin_non_entrano(client, api_world, portale_finto):
    _, w = api_world
    portale_finto["loggato"]("des.designer", email=w.emails["des_designer"])   # utente di DES, non della suite
    r = _entra(client)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_altra_organizzazione", r.text
    portale_finto["loggato"]("platform", email=w.emails["platform"])          # platform admin della suite
    r = _entra(client)
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_platform_admin", r.text
    assert "access_token" not in r.json()


def test_account_bloccato_non_entra_e_il_blocco_resta(client, api_world, portale_finto):
    import psycopg
    urls, w = api_world
    portale_finto["loggato"]("com.dl", email=w.emails["com_dl"])
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.users SET locked_until = now() + interval '10 minutes', failed_login_count = 7 "
                     "WHERE email = %s", [w.emails["com_dl"]])
    try:
        r = _entra(client)
        assert r.status_code == 403 and r.json()["error"]["code"] == "portale_bloccato", r.text
        with psycopg.connect(urls.owner) as conn:
            fails = conn.execute("SELECT failed_login_count FROM cde.users WHERE email = %s", [w.emails["com_dl"]]).fetchone()[0]
        assert fails == 7, "il portale non azzera i tentativi falliti"
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET locked_until = NULL, failed_login_count = 0 WHERE email = %s", [w.emails["com_dl"]])


def test_mfa_richiesta_come_nel_login(client, api_world, portale_finto):
    """Organizzazione con MFA obbligatoria: dal portale arriva il token parziale, non la sessione."""
    import psycopg
    urls, w = api_world
    utente = "m.neri" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Marco Neri")
    assert _entra(client).status_code == 200                       # creato senza MFA obbligatoria
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.organizations SET mfa_required = true WHERE id = %s", [w.orgs["COM"]])
    try:
        r = _entra(client)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "mfa_enrollment_required" and d["mfa_token"] and "access_token" not in d
        assert "cde_rt=" not in (r.headers.get("set-cookie") or "")
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.organizations SET mfa_required = false WHERE id = %s", [w.orgs["COM"]])


def test_al_portale_va_solo_il_sid(monkeypatch):
    """Il refresh token di SkyTower (cde_rt) e gli altri cookie non escono verso il portale (M3); esito in cache."""
    from cde_api.modules import portale as mod

    inviati = []

    class Risposta:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"username": "x", "email": "x@cosedilspa.com"}'

    def urlopen(req, timeout=None):
        inviati.append(req.get_header("Cookie"))
        return Risposta()
    monkeypatch.setattr(mod.cosedil_sso, "ENABLED", True)
    monkeypatch.setattr(mod.urllib.request, "urlopen", urlopen)
    mod._cache.clear()
    sid = "sid-" + uuid.uuid4().hex
    cookie = f"cde_rt=SEGRETO; altro=1; sid={sid}"
    assert mod.verifica_portale(cookie)["username"] == "x"
    assert mod.verifica_portale(cookie)["username"] == "x"          # seconda volta dalla cache
    assert inviati == [f"sid={sid}"]


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


def test_admin_del_portale_diventa_org_admin_e_project_admin(client, progetto_collegato, portale_finto):
    """ADR-57 (decisione dell'utente del 09/11/2026, "le mie credenziali valgono come admin ovunque"): amministratore
    del portale → admin dell'organizzazione della suite e Project Admin dei suoi progetti; mai quelli di altri."""
    w = progetto_collegato
    utente = "a.bianchi" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Anna Bianchi", admin=True)
    r = _entra(client)
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=h).json()["is_org_admin"] is True
    perm = client.get(f"/projects/{w.project_id}", headers=h).json()["my_permissions"]
    assert perm["ADMIN"]["PROJECT"] is True
    # il progetto di un'altra organizzazione resta chiuso (A3)
    assert client.get(f"/projects/{w.project2_id}", headers=h).status_code in (403, 404)
    # secondo accesso: niente doppioni
    assert _entra(client).json()["progetti_aggiunti"] == []


def test_utente_esistente_promosso_quando_e_admin_del_portale(client, progetto_collegato, portale_finto, as_user):
    """Prima il ruolo dal portale valeva solo alla creazione: ora un account nato DESIGNER, se nel portale è
    amministratore, al suo ingresso diventa admin dell'organizzazione e Project Admin, senza perdere il DESIGNER."""
    w = progetto_collegato
    utente = "c.rossi" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Carlo Rossi")
    r = _entra(client)
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=h).json()["is_org_admin"] is False
    assert client.get(f"/projects/{w.project_id}", headers=h).json()["my_permissions"]["ADMIN"]["PROJECT"] is False
    portale_finto["loggato"](utente, nome="Carlo Rossi", admin=True)
    r = _entra(client)
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=h).json()["is_org_admin"] is True
    assert client.get(f"/projects/{w.project_id}", headers=h).json()["my_permissions"]["ADMIN"]["PROJECT"] is True
    membri = client.get(f"/projects/{w.project_id}/members", headers=as_user("com_admin")).json()
    ruoli = {m["role_code"] for m in membri if m["email"] == r.json()["email"]}
    assert {"DESIGNER", "PROJECT_ADMIN"} <= ruoli, ruoli


def test_admin_solo_da_regola_ip_non_promosso(client, progetto_collegato, portale_finto):
    """L'admin per l'app concesso da una regola IP del portale (ruolo utente) non basta: vale solo davanti a quel PC,
    mentre il ruolo in SkyTower resterebbe ovunque (ADR-57)."""
    w = progetto_collegato
    utente = "d.neri" + uuid.uuid4().hex[:4]
    portale_finto["loggato"](utente, nome="Dario Neri")
    assert _entra(client).status_code == 200
    portale_finto["esito"]["admin"] = True                  # admin per l'app, ma ruolo "utente" nel portale
    r = _entra(client)
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/me", headers=h).json()["is_org_admin"] is False
    assert client.get(f"/projects/{w.project_id}", headers=h).json()["my_permissions"]["ADMIN"]["PROJECT"] is False


def test_progetti_di_altri_committenti_non_ricevono_membri(client, api_world, portale_finto):
    """Un progetto di un'altra organizzazione con codice commessa non riceve gli utenti del portale (A3)."""
    import psycopg
    urls, w = api_world
    codice = "EXT-" + uuid.uuid4().hex[:5].upper()
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.projects SET settings = settings || jsonb_build_object('commessa', %s::text) WHERE id = %s",
                     [codice, w.project2_id])
    try:
        utente = "e.galli" + uuid.uuid4().hex[:4]
        portale_finto["loggato"](utente, nome="Elena Galli")
        r = _entra(client)
        assert r.status_code == 200, r.text
        assert "EXT01" not in r.json()["progetti_aggiunti"]
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert client.get(f"/projects/{w.project2_id}", headers=h).status_code in (403, 404)
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.projects SET settings = settings - 'commessa' WHERE id = %s", [w.project2_id])


# --------------------------------------------------------------------------- password del portale nel login normale
@pytest.fixture
def password_portale(monkeypatch, api_world):
    """Finto portale.verifica_password_portale: ``conti[email] = (password, esito)``. Registra le chiamate; alla fine
    spegne gli utenti creati e toglie le loro membership (DB di test condiviso)."""
    stato = {"conti": {}, "chiamate": [], "creati": [], "rifiuto": None}

    def verifica(email, password, ip):
        stato["chiamate"].append(email)
        if stato["rifiuto"]:
            return dict(stato["rifiuto"])
        conto = stato["conti"].get(email.lower())
        if conto and conto[0] == password:
            return {"ok": True, "reachable": True, "status": 200, "errore": "", "motivo": "", **conto[1]}
        return {"ok": False, "reachable": True, "status": 401, "errore": "Credenziali non valide", "motivo": ""}
    monkeypatch.setattr(portale, "verifica_password_portale", verifica)
    yield stato
    if stato["creati"]:
        import psycopg
        urls, _ = api_world
        with psycopg.connect(urls.owner) as conn:
            conn.execute("DELETE FROM cde.project_memberships WHERE user_id IN (SELECT id FROM cde.users WHERE email = ANY(%s))",
                         [stato["creati"]])
            conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE email = ANY(%s)", [stato["creati"]])
            conn.commit()


def _login(client, email, password):
    client.app.state.services.limiter.reset()
    return client.post("/auth/login", json={"email": email, "password": password})


def _fallimenti(api_world, email):
    import psycopg
    urls, _ = api_world
    with psycopg.connect(urls.owner) as conn:
        return conn.execute("SELECT failed_login_count FROM cde.users WHERE email = %s", [email]).fetchone()[0]


def test_password_del_portale_vale_nel_login_e_non_conta_errori(client, api_world, password_portale):
    _, w = api_world
    email = w.emails["com_dl"]
    password_portale["conti"][email] = ("Portale-2026!", {"username": "com.dl", "email": email, "nome": "DL", "admin": False})
    r = _login(client, email, "Portale-2026!")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok" and r.json()["access_token"]
    assert "cde_rt=" in (r.headers.get("set-cookie") or "")
    me = client.get("/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()
    assert me["email"] == email and "portale" in me["amr"]
    assert _fallimenti(api_world, email) == 0, "la password del portale non è un tentativo fallito"


def test_password_di_skytower_resta_valida_senza_chiamare_il_portale(client, api_world, password_portale):
    _, w = api_world
    assert _login(client, w.emails["com_dl"], DEMO_PASSWORD).status_code == 200
    assert password_portale["chiamate"] == []


def test_password_sbagliata_ovunque_conta_come_prima(client, api_world, password_portale):
    import psycopg
    urls, w = api_world
    email = w.emails["com_dl"]
    try:
        r = _login(client, email, "sbagliata-ovunque")
        assert r.status_code == 401 and r.json()["error"]["message"] == "Credenziali non valide"
        assert password_portale["chiamate"] == [email]
        assert _fallimenti(api_world, email) == 1
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET failed_login_count = 0, locked_until = NULL WHERE email = %s", [email])


def test_utente_nuovo_entra_con_la_password_del_portale(client, api_world, password_portale):
    email = f"n.rossi{uuid.uuid4().hex[:4]}@cosedilspa.com"
    password_portale["conti"][email] = ("Portale-2026!", {"username": email.split("@")[0], "email": email,
                                                          "nome": "Nadia Rossi", "admin": False})
    password_portale["creati"].append(email)
    r = _login(client, email, "Portale-2026!")
    assert r.status_code == 200, r.text
    assert r.json()["creato"] is True and r.json()["email"] == email
    # utente senza password di SkyTower: la seconda volta lo ritrova (nessun doppione)
    r2 = _login(client, email, "Portale-2026!")
    assert r2.status_code == 200 and r2.json()["creato"] is False


def test_password_giusta_ma_accesso_negato_dal_portale(client, api_world, password_portale):
    _, w = api_world
    email = w.emails["com_dl"]
    password_portale["rifiuto"] = {"ok": False, "reachable": True, "status": 403, "motivo": "non-abilitato",
                                   "errore": "SkyTower non è fra i tuoi programmi del Portale"}
    r = _login(client, email, "Portale-2026!")
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_non_abilitato", r.text
    assert _fallimenti(api_world, email) == 0


def test_password_del_portale_non_apre_altre_organizzazioni_ne_account_bloccati(client, api_world, password_portale):
    import psycopg
    urls, w = api_world
    des = w.emails["des_designer"]
    password_portale["conti"][des] = ("Portale-2026!", {"username": "des.designer", "email": des, "nome": "D", "admin": False})
    r = _login(client, des, "Portale-2026!")
    assert r.status_code == 403 and r.json()["error"]["code"] == "portale_altra_organizzazione", r.text
    # account bloccato: il blocco di SkyTower vale anche per la password del portale (il portale non viene chiesto)
    dl = w.emails["com_dl"]
    password_portale["conti"][dl] = ("Portale-2026!", {"username": "com.dl", "email": dl, "nome": "DL", "admin": False})
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.users SET locked_until = now() + interval '10 minutes' WHERE email = %s", [dl])
    try:
        password_portale["chiamate"].clear()
        assert _login(client, dl, "Portale-2026!").status_code == 401
        assert password_portale["chiamate"] == []
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET locked_until = NULL, failed_login_count = 0 WHERE email = %s", [dl])
