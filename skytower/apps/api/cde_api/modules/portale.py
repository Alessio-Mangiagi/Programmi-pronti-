# "><(((º> sabusabu <º)))><"
"""Login automatico dal portale della suite Cosedil (``POST /auth/portale``).

Chi è già entrato nel portale ha il cookie ``sid``; il browser lo manda anche a SkyTower
(stesso host, o stesso ``SUITE_DOMINIO`` dietro Caddy). Questa rotta gira **solo il valore di
``sid``** al portale (``/api/verify``) e apre la sessione SkyTower come dopo un login normale.

Regole (ADR-47, dopo la revisione di sicurezza del 03/11/2026): il portale è una sola
organizzazione, quella della suite (``CDE_SUITE_ORG_ID``, altrimenti quella dell'utente tecnico
``CDE_SUITE_USER_EMAIL``, altrimenti quella del primo platform admin). Quindi:

* l'utente SkyTower si cerca **solo per email esatta** e **solo in quell'organizzazione**: niente
  ripiego sulla parte prima della ``@`` (un admin del portale poteva scegliersi uno username e
  agganciare un account qualunque, anche di un altro tenant);
* un platform admin, un utente di un'altra organizzazione, uno con SSO obbligatorio o con l'account
  bloccato **non entra** da qui: con la password, se ce l'ha;
* se l'utente ha un fattore MFA attivo, o l'organizzazione lo pretende, la risposta è la stessa del
  login con password (``mfa_required`` / ``mfa_enrollment_required``): il portale non sostituisce
  il secondo fattore;
* se l'utente non esiste lo crea nell'organizzazione della suite, attivo e senza password, con
  l'email del portale (o ``<username>@CDE_SUITE_EMAIL_DOMINIO``); se quell'email appartiene già a
  un'altra organizzazione, niente account;
* lo rende membro dei soli progetti **di proprietà dell'organizzazione della suite** con codice
  commessa (``settings.commessa``), col ruolo ``CDE_SUITE_RUOLO_PORTALE`` (default ``DESIGNER``).
  L'inserimento gira a nome di un Project Admin del progetto, perché RLS lo pretende;
* **amministratore del portale** (ruolo ``admin`` in utenti.json; ADR-57, 09/11/2026: "le mie credenziali
  valgono come admin ovunque"): a ogni ingresso diventa amministratore dell'organizzazione della suite
  (``is_org_admin``) e Project Admin di tutti i progetti attivi di proprietà di quell'organizzazione, in
  aggiunta ai ruoli che ha. L'admin per l'app concesso da una regola IP del portale non basta, nemmeno alla
  creazione dell'account; il platform admin resta fuori da questa strada (password e secondo fattore).

**Il profilo del portale vale in SkyTower** (ADR-58, decisione dell'utente dell'11/11/2026: "il profilo del portale
vale per ogni programma", "gli admin li creo e li cancello solo io", scelte 2b 3b 4a):

* l'account resta **collegato** alla persona del portale per username (``users.portale_username``, migrazione 0046):
  a ogni ingresso nome, cognome ed email si allineano al portale, e un'email cambiata nel portale aggiorna l'account
  invece di crearne un secondo;
* l'admin dell'organizzazione di un account collegato è **dato e tolto** a ogni ingresso secondo il ruolo del portale;
  i Project Admin aggiunti dalla regola di ADR-57 sono segnati (``dal_portale_admin``) e al declassamento si tolgono,
  i ruoli che la persona aveva già restano (4a: i ruoli sotto l'admin si decidono in SkyTower);
* al **login con le credenziali di SkyTower** (password propria, passkey, single sign-on; reset della password) si
  chiede il profilo al portale (``POST /api/suite/profilo``, ``controlla_ingresso``): persona disattivata, SkyTower
  tolto dai suoi programmi o persona eliminata → login rifiutato; portale spento → login permesso (3b: le password
  di SkyTower restano) e annotato. Solo al login (2b): il rinnovo della sessione non chiede nulla, ma la catena dei
  rinnovi ha ora una scadenza assoluta (``auth._refresh_tx``), così il login torna almeno ogni 14 giorni (12 ore in HTTP);
* **dare o togliere l'admin** dentro SkyTower (pagina Organizzazione, in qualunque organizzazione) può solo il
  proprietario della suite: chi agisce deve essere collegato al portale e il portale deve dire ``proprietario``,
  verificato dal vivo (``richiedi_proprietario``); sugli account collegati l'admin non si cambia qui, lo decide il
  portale. Gli strumenti da riga di comando (tooling/) restano liberi.

Account solo-SkyTower (nessun profilo nel portale, platform admin, altre organizzazioni) non sono toccati.

La rotta è anonima: ha un limite per IP e una cache di 30 secondi dell'esito per ``sid``, così un
browser che la richiama (o chi la martella) non tiene occupati portale e database.

**Password del portale nel login normale** (06/11/2026, una password per tutti i programmi): se in
``POST /auth/login`` la password non è quella di SkyTower, ``auth._login_tx`` chiede al portale
(``verifica_password_portale`` → ``shared/sso/cosedil_sso.verifica_password``) se è quella del portale
per quell'email, prima di contare il tentativo fallito. Se sì, il login continua qui in ``entra``, con le
stesse regole dell'ingresso dal portale (stessa organizzazione, niente platform admin, MFA, account creato
se manca) e in più: contatore dei tentativi falliti azzerato (la password è stata provata) e SkyTower deve
essere fra i programmi della persona nel portale (il portale risponde 403 altrimenti). La password di
SkyTower resta valida.

Regole per le altre app in ``shared/suite/CONTRATTI.md`` §1-2.
"""
from __future__ import annotations

import json
import logging
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response

from ..deps import Services, client_ip, services
from ..errors import ApiError
from ..events import security_event
from . import auth

_SHARED = Path(__file__).resolve().parents[5] / "shared"
for _d in ("sso", "suite"):
    if str(_SHARED / _d) not in sys.path:
        sys.path.insert(0, str(_SHARED / _d))
import cosedil_sso
import suite_link

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
APP_ID = "skytower"
CACHE_TTL = 30                      # secondi: stesso sid → stessa risposta del portale, senza richiamarlo
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def verifica_portale(cookie_header: str) -> dict:
    """Chiede al portale chi è l'utente del cookie. Come cosedil_sso.verifica_sessione, ma tiene anche l'email.

    Al portale va **solo** ``sid=<valore>``: l'header Cookie del browser porta anche il refresh token di SkyTower
    (``cde_rt``, path ``/auth``), che non deve uscire da qui.
    Ritorna {"ok", "reachable", "username", "nome", "ruolo", "admin", "email"}."""
    esito = {"ok": False, "reachable": True, "username": None, "nome": None, "ruolo": None, "admin": False, "email": None}
    sid = cosedil_sso.leggi_sid(cookie_header)
    if not cosedil_sso.ENABLED or not sid:
        return esito
    with _cache_lock:
        hit = _cache.get(sid)
        if hit and hit[0] > time.monotonic():
            return dict(hit[1])
    try:
        url = cosedil_sso.PORTAL + "/api/verify?" + urllib.parse.urlencode({"app": APP_ID})
        req = urllib.request.Request(url, headers={"Cookie": f"sid={sid}"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
        esito.update(ok=True, username=dati.get("username"), nome=dati.get("nome"), ruolo=dati.get("ruolo"),
                     admin=bool(dati.get("admin")), email=dati.get("email"))
    except urllib.error.HTTPError:
        pass                                   # 401 = non loggato, 403 = app riservata: comunque niente accesso
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        esito["reachable"] = False
        return esito                           # un portale giù non si mette in cache: riproverà subito
    with _cache_lock:
        if len(_cache) > 5000:                 # sid casuali in massa non devono far crescere la memoria
            _cache.clear()
        _cache[sid] = (time.monotonic() + CACHE_TTL, dict(esito))
    return esito


PROFILO_TIMEOUT = 3                 # secondi: il login aspetta il portale al massimo così, poi entra senza (3b)
MSG_SOLO_PROPRIETARIO = "Solo il proprietario della suite gestisce gli amministratori"


def profilo_portale(login: str) -> dict:
    """La persona del portale per ``login`` (username del portale o email): ``POST <portale>/api/suite/profilo`` col
    token della suite (contratto in shared/suite/CONTRATTI.md, 11/11/2026). Lo chiama il server, mai il browser.

    Non solleva mai. Ritorna ``{"reachable", "trovato", "username", "nome", "email", "ruolo", "admin",
    "proprietario", "disattivato", "abilitato", "status"}``:

    * ``reachable=False`` se il portale non risponde, lo SSO è spento (``COSEDIL_SSO=off``), il token è rifiutato o il
      portale è di una versione senza questa rotta (404): chi chiama decide (il login entra lo stesso, la gestione
      degli admin no);
    * ``trovato=False`` se il portale non conosce nessuno con quel login;
    * ``admin`` = ruolo ``admin`` nel portale (mai la regola IP: qui non c'è nessun PC davanti, ADR-57);
    * ``abilitato`` = SkyTower è fra i programmi della persona (un portale che non lo dice vale come sì)."""
    esito = {"reachable": False, "trovato": False, "username": None, "nome": None, "email": None, "ruolo": None,
             "admin": False, "proprietario": False, "disattivato": False, "abilitato": False, "status": 0}
    login = (login or "").strip()
    if not cosedil_sso.ENABLED or not login:
        return esito
    corpo = json.dumps({"login": login, "app": APP_ID}).encode("utf-8")
    try:
        # COSEDIL_PORTAL viene dalla configurazione del server (http/https), mai dalla richiesta: S310 non si applica
        req = urllib.request.Request(cosedil_sso.PORTAL + "/api/suite/profilo", data=corpo, method="POST",  # noqa: S310
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              "X-Suite-Token": suite_link.token()})
        with urllib.request.urlopen(req, timeout=PROFILO_TIMEOUT) as resp:  # noqa: S310
            dati = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as errore:           # 403 token sbagliato, 404 portale vecchio: non verificabile
        esito["status"] = errore.code
        return esito
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return esito
    if not isinstance(dati, dict) or not dati.get("ok"):
        return esito
    esito.update(reachable=True, status=200)
    if not dati.get("trovato") or not dati.get("username"):
        return esito
    ruolo = dati.get("ruolo")
    esito.update(trovato=True, username=str(dati["username"]).strip().lower(), nome=dati.get("nome"),
                 email=str(dati.get("email") or "").strip().lower() or None, ruolo=ruolo, admin=ruolo == "admin",
                 proprietario=bool(dati.get("proprietario")), disattivato=bool(dati.get("disattivato")),
                 abilitato=dati.get("abilitato") is not False)
    return esito


def _nome_cognome(nome: str | None, username: str) -> tuple[str, str]:
    parti = (nome or "").strip().split()
    if len(parti) >= 2:
        return " ".join(parti[:-1]), parti[-1]
    if parti:
        return parti[0], "-"
    return username, "-"


def _nome_attuale(first: str | None, last: str | None) -> str:
    """Nome e cognome dell'account come li scrive il portale (un solo campo): "-" è il cognome di ripiego di
    _nome_cognome. Serve a non riscrivere a ogni ingresso un nome già giusto ma diviso diversamente (es. "Maria
    Grazia" / "De Luca" corretto a mano dalla persona: il portale ha "Maria Grazia De Luca")."""
    parti = [p for p in (first or "", last or "") if p.strip() and p.strip() != "-"]
    return " ".join(" ".join(parti).split()).lower()


def _attore_piattaforma(svc: Services) -> dict:
    """L'utente a nome del quale si crea l'account: platform admin (può inserire utenti in ogni organizzazione)."""
    with svc.db.auth_tx() as conn:
        row = conn.execute("""SELECT id, organization_id FROM cde.users WHERE is_platform_admin AND status = 'ACTIVE'
                              ORDER BY created_at LIMIT 1""").fetchone()
    if row is None:
        raise ApiError(503, "suite_user", "Nessun platform admin attivo: impossibile creare l'utente dal portale")
    return row


def organizzazione_suite(svc: Services, conn) -> uuid.UUID:
    """L'organizzazione della suite: l'unica in cui il portale può far entrare o creare utenti."""
    s = svc.settings
    if s.suite_org_id:
        return s.suite_org_id
    if s.suite_user_email:
        row = conn.execute("SELECT organization_id FROM cde.users WHERE lower(email) = lower(%s)", [s.suite_user_email]).fetchone()
        if row:
            return row["organization_id"]
    return _attore_piattaforma(svc)["organization_id"]


_COLONNE_UTENTE = """u.id, u.organization_id, u.email, u.status, u.is_org_admin, u.is_platform_admin, u.locked_until,
                      u.portale_username, u.first_name, u.last_name, o.mfa_required, o.status AS org_status"""


def _trova_utente(conn, email: str, username: str | None = None) -> dict | None:
    """L'account della persona del portale: prima quello COLLEGATO al suo username (ADR-58: l'email può cambiare nel
    portale), poi quello con l'email esatta, di qualunque organizzazione: chi lo chiama decide se è ammesso."""
    if username:
        row = conn.execute(f"""SELECT {_COLONNE_UTENTE} FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                               WHERE u.portale_username = %s""", [username.strip().lower()]).fetchone()
        if row is not None:
            return row
    return conn.execute(f"""SELECT {_COLONNE_UTENTE} FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                            WHERE lower(u.email) = lower(%s)""", [email]).fetchone()


def _crea_utente(svc: Services, request: Request, org: uuid.UUID, email: str, username: str, nome: str | None,
                 admin: bool) -> dict:
    attore = _attore_piattaforma(svc)
    first, last = _nome_cognome(nome, username)
    uid = uuid.uuid4()
    with svc.db.app_tx(attore["id"]) as conn:
        conn.execute("""INSERT INTO cde.users (id, organization_id, email, first_name, last_name, is_org_admin, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')""", [uid, org, email.lower(), first, last, admin])
        security_event(conn, "USER_CREATED_PORTALE", user_id=attore["id"], organization_id=org, ip=client_ip(request),
                        target=uid, email=email.lower(), username=username, admin=admin)
    # il collegamento al portale (portale_username) lo scrive subito dopo allinea_profilo, col servizio di autenticazione
    return {"id": uid, "organization_id": org, "email": email.lower(), "status": "ACTIVE", "is_org_admin": admin,
            "is_platform_admin": False, "locked_until": None, "mfa_required": False, "org_status": "ACTIVE",
            "portale_username": None, "first_name": first, "last_name": last}


def admin_del_portale(esito: dict) -> bool:
    """True se il portale dice che questa persona è amministratrice del portale (ruolo ``admin`` in utenti.json).
    ``admin`` da solo non basta: può venire da una regola IP del portale, valida solo davanti a quel PC (ADR-57)."""
    return esito.get("ruolo") == "admin" and bool(esito.get("admin"))


def _promuovi_org_admin(svc: Services, request: Request, user: dict, username: str) -> None:
    """Rende l'utente amministratore dell'organizzazione della suite (ADR-57). Gira a nome del platform admin, come
    la creazione: RLS su cde.users ammette l'aggiornamento di is_org_admin solo a lui o a un admin dell'org."""
    attore = _attore_piattaforma(svc)
    with svc.db.app_tx(attore["id"]) as conn:
        conn.execute("UPDATE cde.users SET is_org_admin = true WHERE id = %s AND NOT is_org_admin", [user["id"]])
        security_event(conn, "ORG_ADMIN_DAL_PORTALE", user_id=attore["id"], organization_id=user["organization_id"],
                       ip=client_ip(request), target=user["id"], username=username)
    user["is_org_admin"] = True


def _declassa_org_admin(svc: Services, request: Request, user: dict, username: str, motivo: str) -> None:
    """Toglie l'admin dell'organizzazione a un account collegato che nel portale non è (più) amministratore (ADR-58).
    Come la promozione, a nome del platform admin. Il portale decide anche se era l'ultimo admin dell'organizzazione:
    resta comunque il platform admin, e il portale non lascia togliere l'ultimo amministratore attivo."""
    attore = _attore_piattaforma(svc)
    with svc.db.app_tx(attore["id"]) as conn:
        conn.execute("UPDATE cde.users SET is_org_admin = false WHERE id = %s AND is_org_admin", [user["id"]])
        security_event(conn, "ORG_ADMIN_TOLTO_DAL_PORTALE", user_id=attore["id"], organization_id=user["organization_id"],
                       ip=client_ip(request), target=user["id"], username=username, motivo=motivo)
    user["is_org_admin"] = False


def _togli_project_admin_dal_portale(svc: Services, request: Request, user: dict, username: str) -> list[str]:
    """Toglie i Project Admin che la regola di ADR-57 aveva aggiunto (``dal_portale_admin``) e ritorna i codici dei
    progetti. Le altre righe della persona (il ruolo che aveva prima, o un Project Admin dato a mano) restano: la
    chiave della membership è progetto + utente + ruolo. Ogni DELETE gira a nome di un ALTRO Project Admin attivo del
    progetto (RLS: solo lui gestisce le membership); se la persona è l'unico Project Admin il ruolo resta, con un
    evento di sicurezza: una commessa senza amministratore non la gestirebbe più nessuno."""
    ip = client_ip(request)
    tolti: list[str] = []
    with svc.db.auth_tx() as conn:
        righe = conn.execute("""SELECT pm.project_id, pm.role_id, p.code FROM cde.project_memberships pm
                                JOIN cde.projects p ON p.id = pm.project_id
                                WHERE pm.user_id = %s AND pm.dal_portale_admin""", [user["id"]]).fetchall()
        if not righe:
            return tolti
        admin_di: dict = {}
        for r in conn.execute("""SELECT pm.project_id, pm.user_id FROM cde.project_memberships pm
                                 JOIN cde.roles r ON r.id = pm.role_id JOIN cde.users u ON u.id = pm.user_id
                                 WHERE r.code = 'PROJECT_ADMIN' AND u.status = 'ACTIVE' AND pm.user_id <> %s
                                   AND pm.project_id = ANY(%s) AND (pm.expires_at IS NULL OR pm.expires_at > now())
                                 ORDER BY pm.granted_at NULLS LAST""",
                              [user["id"], [r["project_id"] for r in righe]]).fetchall():
            admin_di.setdefault(r["project_id"], r["user_id"])
    for r in righe:
        attore = admin_di.get(r["project_id"])
        if attore is None:
            log.warning("%s non è più admin del portale ma è l'unico Project Admin di %s: il ruolo resta", username, r["code"])
            with svc.db.auth_tx() as conn:
                security_event(conn, "PROJECT_ADMIN_DAL_PORTALE_TENUTO", user_id=user["id"], project_id=r["project_id"],
                               ip=ip, username=username, motivo="unico_project_admin")
            continue
        try:
            with svc.db.app_tx(attore) as conn:
                n = conn.execute("""DELETE FROM cde.project_memberships
                                    WHERE project_id = %s AND user_id = %s AND role_id = %s AND dal_portale_admin""",
                                 [r["project_id"], user["id"], r["role_id"]]).rowcount
                if n:
                    security_event(conn, "MEMBER_REMOVED", user_id=attore, project_id=r["project_id"], ip=ip,
                                   target=user["id"], role=r["role_id"], portale=True,
                                   motivo="non più amministratore del portale")
            if n:
                tolti.append(r["code"])
        except Exception as e:   # noqa: BLE001 - un progetto storto non deve bloccare il login
            log.warning("Project Admin dal portale non tolto su %s: %s", r["code"], e)
    return tolti


def allinea_profilo(svc: Services, request: Request, user: dict, username: str, email: str | None, nome: str | None,
                    admin: bool, motivo: str = "ingresso") -> dict:
    """Il profilo del portale vale in SkyTower (ADR-58): collega l'account allo username del portale, allinea nome,
    cognome ed email, dà o toglie l'admin dell'organizzazione e i Project Admin della regola di ADR-57.

    ``user`` è l'account (dict con id, organization_id, email, is_org_admin, ...), aggiornato sul posto e ritornato.
    Si chiama fuori da ogni transazione che tenga bloccata la riga dell'utente (le modifiche girano su connessioni
    proprie). Se lo username è già collegato a un ALTRO account (es. un account nato prima con un'altra email) non si
    tocca nulla: si annota il conflitto, l'account collegato resta quello. Un'email che appartiene già a un altro
    account non si copia (l'email è unica in tutta la piattaforma)."""
    ip = client_ip(request)
    username = username.strip().lower()
    with svc.db.auth_tx() as conn:
        riga = conn.execute("""SELECT email, first_name, last_name, portale_username, is_org_admin FROM cde.users
                               WHERE id = %s FOR UPDATE""", [user["id"]]).fetchone()
        if riga is None:
            return user
        if riga["portale_username"] not in (None, username):
            log.warning("Account %s collegato a %s, non a %s: nessun allineamento", user["id"], riga["portale_username"], username)
            return user
        cambi: dict = {}
        if riga["portale_username"] is None:
            altro = conn.execute("SELECT id FROM cde.users WHERE portale_username = %s AND id <> %s",
                                 [username, user["id"]]).fetchone()
            if altro is not None:
                security_event(conn, "PROFILO_PORTALE_CONFLITTO", user_id=user["id"], organization_id=user["organization_id"],
                               ip=ip, username=username, collegato_a=altro["id"])
                return user
            cambi["portale_username"] = username
        if email and email.lower() != (riga["email"] or "").lower():
            if conn.execute("SELECT 1 FROM cde.users WHERE lower(email) = lower(%s) AND id <> %s", [email, user["id"]]).fetchone():
                security_event(conn, "PROFILO_PORTALE_EMAIL_OCCUPATA", user_id=user["id"], organization_id=user["organization_id"],
                               ip=ip, username=username)
            else:
                cambi["email"] = email.lower()
        if nome and nome.strip() and " ".join(nome.split()).lower() != _nome_attuale(riga["first_name"], riga["last_name"]):
            cambi["first_name"], cambi["last_name"] = _nome_cognome(nome, username)
        if cambi:
            conn.execute("UPDATE cde.users SET " + ", ".join(f"{k} = %({k})s" for k in cambi) + " WHERE id = %(_id)s",
                         {**cambi, "_id": user["id"]})
            security_event(conn, "PROFILO_DAL_PORTALE", user_id=user["id"], organization_id=user["organization_id"],
                           ip=ip, username=username, fields=sorted(cambi))
    user.update(cambi)
    user["is_org_admin"] = riga["is_org_admin"]
    if admin and not riga["is_org_admin"]:
        _promuovi_org_admin(svc, request, user, username)
    elif not admin and riga["is_org_admin"]:
        _declassa_org_admin(svc, request, user, username, motivo)
    if not admin:
        _togli_project_admin_dal_portale(svc, request, user, username)
    return user


def _rifiuta_ingresso(svc: Services, request: Request, user: dict, motivo: str, messaggio: str, via: str) -> ApiError:
    with svc.db.auth_tx() as conn:
        return _rifiuta(conn, request, user, motivo, messaggio, via=via)


def controlla_ingresso(svc: Services, request: Request, user_id: uuid.UUID, *, via: str,
                       allinea: bool = True) -> ApiError | None:
    """Scelte 2b e 3b dell'11/11/2026 (ADR-58): al login con le credenziali di SkyTower si chiede al portale il
    profilo della persona. Ritorna l'errore da dare (403) o None se può entrare.

    ``via``: "password", "passkey", "sso", "reset" (per il registro). Si controllano solo gli account
    dell'organizzazione della suite che non sono platform admin; il login è lo username collegato o, per un account
    non ancora collegato, l'email. Esiti:

    * portale non raggiungibile → entra (3b), annotato se l'account è collegato;
    * nessun profilo → entra se l'account non è collegato (account solo-SkyTower); se era collegato la persona è stata
      eliminata dal portale: admin tolti e login rifiutato;
    * persona disattivata nel portale o SkyTower non fra i suoi programmi → rifiutato;
    * altrimenti, con ``allinea``, il profilo si copia sull'account (allinea_profilo) e i progetti con commessa
      ricevono la persona come all'ingresso dal portale (assicura_membership). ``allinea=False`` quando chi chiama
      tiene bloccata la riga dell'utente in una transazione aperta (single sign-on) o per il reset della password."""
    with svc.db.auth_tx() as conn:
        user = conn.execute(f"""SELECT {_COLONNE_UTENTE} FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                                WHERE u.id = %s""", [user_id]).fetchone()
        if user is None or user["is_platform_admin"] or user["organization_id"] != organizzazione_suite(svc, conn):
            return None
    collegato = user["portale_username"]
    p = profilo_portale(collegato or user["email"])
    if not p["reachable"]:
        if collegato:
            log.warning("Profilo di %s non verificato col portale (%s): login permesso", collegato, p["status"] or "spento")
            with svc.db.auth_tx() as conn:
                security_event(conn, "PROFILO_PORTALE_NON_VERIFICATO", user_id=user["id"], organization_id=user["organization_id"],
                               ip=client_ip(request), username=collegato, via=via, status=p["status"])
        return None
    if not p["trovato"]:
        if not collegato:
            return None
        if allinea and user["is_org_admin"]:
            _declassa_org_admin(svc, request, user, collegato, "eliminato dal portale")
        if allinea:
            _togli_project_admin_dal_portale(svc, request, user, collegato)
        return _rifiuta_ingresso(svc, request, user, "eliminato",
                                 "Il tuo utente del Portale non esiste più: rivolgiti a un amministratore", via)
    if p["disattivato"]:
        return _rifiuta_ingresso(svc, request, user, "disattivato",
                                 "Il tuo account del Portale è disattivato: rivolgiti a un amministratore", via)
    if not p["abilitato"]:
        return _rifiuta_ingresso(svc, request, user, "non_abilitato",
                                 "SkyTower non è fra i tuoi programmi del Portale: chiedi l'abilitazione a un amministratore",
                                 via)
    if allinea:
        allinea_profilo(svc, request, user, p["username"], p["email"], p["nome"], p["admin"], motivo=f"login {via}")
        assicura_membership(svc, request, user, admin=p["admin"])
    return None


def stato_proprietario(svc: Services, user_id: uuid.UUID) -> dict:
    """Chi agisce è il proprietario della suite? (decisione dell'11/11/2026: "gli admin li creo e li cancello solo
    io"). Sì solo se l'account è collegato al portale (portale_username) e il portale, chiesto ADESSO, dice
    ``proprietario`` per una persona attiva. Ritorna {"proprietario", "collegato", "raggiungibile"}."""
    with svc.db.auth_tx() as conn:
        row = conn.execute("SELECT portale_username, status FROM cde.users WHERE id = %s", [user_id]).fetchone()
    if row is None or not row["portale_username"] or row["status"] != "ACTIVE":
        return {"proprietario": False, "collegato": bool(row and row["portale_username"]), "raggiungibile": True}
    p = profilo_portale(row["portale_username"])
    return {"proprietario": bool(p["reachable"] and p["trovato"] and p["proprietario"] and not p["disattivato"]),
            "collegato": True, "raggiungibile": p["reachable"]}


def richiedi_proprietario(svc: Services, user_id: uuid.UUID) -> None:
    """403 ``solo_proprietario`` se chi agisce non è il proprietario della suite; 503 se il portale non risponde e
    quindi non si può verificare (dare o togliere un admin si rifiuta, non si indovina)."""
    s = stato_proprietario(svc, user_id)
    if s["proprietario"]:
        return
    if s["collegato"] and not s["raggiungibile"]:
        raise ApiError(503, "portale_irraggiungibile",
                       "Il portale non risponde: non si può verificare che tu sia il proprietario della suite. Riprova più tardi")
    raise ApiError(403, "solo_proprietario", MSG_SOLO_PROPRIETARIO)


def _progetti_attivi(conn, org: uuid.UUID) -> list[dict]:
    """Tutti i progetti non archiviati **di proprietà dell'organizzazione della suite**: quelli in cui un
    amministratore del portale diventa Project Admin (ADR-57). Mai progetti di altri committenti (A3)."""
    return conn.execute("SELECT id, code, settings FROM cde.projects WHERE status <> 'ARCHIVED' AND owner_organization_id = %s",
                        [org]).fetchall()


def _progetti_con_commessa(conn, org: uuid.UUID) -> list[dict]:
    """I progetti **di proprietà dell'organizzazione della suite** con un codice commessa: solo in questi il portale
    iscrive i suoi utenti. Un progetto di un altro committente in cui l'azienda partecipa non si tocca (A3)."""
    rows = conn.execute("SELECT id, code, settings FROM cde.projects WHERE status <> 'ARCHIVED' AND owner_organization_id = %s",
                        [org]).fetchall()
    return [p for p in rows if ((p.get("settings") or {}).get("commessa") or "").strip()]


def assicura_membership(svc: Services, request: Request, user: dict, admin: bool = False) -> list[str]:
    """Rende l'utente membro dei progetti della sua organizzazione di cui non è ancora membro e ritorna i codici
    aggiunti.

    - Utente del portale: progetti con codice commessa, ruolo ``CDE_SUITE_RUOLO_PORTALE`` (mai PROJECT_ADMIN).
    - ``admin`` = amministratore del portale (admin_del_portale, ADR-57): PROJECT_ADMIN in tutti i progetti attivi
      dell'organizzazione della suite dove non lo è già, in aggiunta agli altri ruoli (la chiave della membership è
      progetto + utente + ruolo: nessun ruolo esistente viene tolto). Queste righe sono segnate ``dal_portale_admin``
      e si tolgono quando il portale non lo dà più (ADR-58, _togli_project_admin_dal_portale)."""
    ruolo = (svc.settings.suite_ruolo_portale or "DESIGNER").upper()
    if ruolo == "PROJECT_ADMIN" and not admin:
        log.warning("CDE_SUITE_RUOLO_PORTALE=PROJECT_ADMIN non ammesso: uso DESIGNER")
        ruolo = "DESIGNER"
    if admin:
        ruolo = "PROJECT_ADMIN"
    aggiunti = []
    with svc.db.auth_tx() as conn:
        progetti = (_progetti_attivi if admin else _progetti_con_commessa)(conn, user["organization_id"])
        if not progetti:
            return aggiunti
        role = conn.execute("SELECT id FROM cde.roles WHERE project_id IS NULL AND code = %s", [ruolo]).fetchone()
        if role is None:
            log.warning("Ruolo di sistema %s inesistente: nessuna membership dal portale", ruolo)
            return aggiunti
        if admin:   # già Project Admin = niente da fare; un altro ruolo nello stesso progetto non basta
            gia = {r["project_id"] for r in conn.execute(
                "SELECT project_id FROM cde.project_memberships WHERE user_id = %s AND role_id = %s",
                [user["id"], role["id"]]).fetchall()}
        else:
            gia = {r["project_id"] for r in conn.execute("SELECT project_id FROM cde.project_memberships WHERE user_id = %s",
                                                          [user["id"]]).fetchall()}
        # a nome di chi: un Project Admin del progetto (RLS: solo lui gestisce le membership)
        admin_di = {}
        for r in conn.execute("""SELECT pm.project_id, pm.user_id FROM cde.project_memberships pm
                                 JOIN cde.roles r ON r.id = pm.role_id JOIN cde.users u ON u.id = pm.user_id
                                 WHERE r.code = 'PROJECT_ADMIN' AND u.status = 'ACTIVE'
                                 AND (pm.expires_at IS NULL OR pm.expires_at > now()) ORDER BY pm.granted_at NULLS LAST""").fetchall():
            admin_di.setdefault(r["project_id"], r["user_id"])
    for p in progetti:
        if p["id"] in gia or p["id"] not in admin_di:
            continue
        try:
            with svc.db.app_tx(admin_di[p["id"]]) as conn:
                # dal_portale_admin: il Project Admin della regola di ADR-57 si toglie quando il portale non lo dà più
                conn.execute("""INSERT INTO cde.project_memberships (project_id, user_id, role_id, granted_by, dal_portale_admin)
                                VALUES (%s, %s, %s, cde.current_app_user(), %s)""", [p["id"], user["id"], role["id"], admin])
                security_event(conn, "MEMBER_ADDED", user_id=admin_di[p["id"]], project_id=p["id"], ip=client_ip(request),
                               target=user["id"], role=role["id"], portale=True)
            aggiunti.append(p["code"])
        except Exception as e:   # noqa: BLE001 - un progetto storto non deve bloccare il login
            log.warning("Membership dal portale non creata su %s: %s", p["code"], e)
    return aggiunti


def _rifiuta(conn, request: Request, user: dict | None, motivo: str, messaggio: str, **dettagli) -> ApiError:
    """Accesso dal portale negato: evento di sicurezza con il motivo e 403 con un messaggio che dice cosa fare."""
    security_event(conn, "LOGIN_PORTALE_RIFIUTATO", user_id=user["id"] if user else None,
                   organization_id=user["organization_id"] if user else None, ip=client_ip(request),
                   user_agent=auth._ua(request), reason=motivo, **dettagli)
    return ApiError(403, f"portale_{motivo}", messaggio)


def verifica_password_portale(email: str, password: str, ip: str | None) -> dict:
    """La password è quella del portale per questa email? (POST /api/verifica-password del portale, col token della
    suite; il portale conta i tentativi falliti sull'IP della persona). Vedi cosedil_sso.verifica_password."""
    return cosedil_sso.verifica_password(email, password, APP_ID, ip=ip)


@router.post("/portale")
def login_portale(request: Request, response: Response, svc: Services = Depends(services)):
    """Entra in SkyTower con la sessione del portale (cookie ``sid``). 401 se non c'è o il portale non risponde,
    403 se l'utente non è ammesso da questa strada (vedi docstring del modulo), ``mfa_required`` se serve il
    secondo fattore."""
    ip = client_ip(request)
    if not svc.limiter.hit("30/minute", "portale", ip or "-"):
        raise ApiError(429, "rate_limited", "Troppi tentativi: riprovare tra un minuto", {"Retry-After": "60"})
    esito = verifica_portale(request.headers.get("cookie", ""))
    if not esito["reachable"]:
        raise ApiError(401, "portale_irraggiungibile", "Il portale della suite non risponde: entra con email e password")
    if not esito["ok"] or not esito.get("username"):
        raise ApiError(401, "portale_no_sessione", "Nessuna sessione del portale")
    return entra(svc, request, response, esito)


def entra(svc: Services, request: Request, response: Response, esito: dict, via: str = "sessione") -> dict:
    """Apre la sessione SkyTower dell'utente del portale descritto da ``esito`` (username, email, nome, admin).

    ``via="sessione"``: dal cookie del portale (POST /auth/portale). ``via="password"``: dal login normale con la
    password del portale (auth.login); lì la password è stata provata, quindi il contatore dei tentativi falliti
    riparte da zero. Regole di ammissione uguali per le due strade (docstring del modulo)."""
    ip = client_ip(request)
    username = str(esito["username"]).strip().lower()
    email = ((esito.get("email") or "").strip() or f"{username}@{svc.settings.suite_email_dominio}").lower()
    # ADR-57/58: amministratore del portale (ruolo admin) = admin anche qui, dato e tolto a ogni ingresso. L'admin per
    # l'app dato da una regola IP del portale non basta, nemmeno quando l'account nasce (prima bastava: ADR-58).
    admin_portale = admin_del_portale(esito)
    creato = False
    with svc.db.auth_tx() as conn:
        org = organizzazione_suite(svc, conn)
        user = _trova_utente(conn, email, username)
        if user is not None:
            if user["portale_username"] not in (None, username):
                # l'email è di un account già collegato a un'altra persona del portale (che ne ha cambiato l'email)
                raise _rifiuta(conn, request, user, "collegato_ad_altro",
                               "Questo indirizzo è già di un'altra persona del portale: entra con email e password",
                               username=username)
            if user["organization_id"] != org:
                raise _rifiuta(conn, request, user, "altra_organizzazione",
                               "Questo indirizzo appartiene a un'altra organizzazione di SkyTower: entra con la tua password")
            if user["is_platform_admin"]:
                raise _rifiuta(conn, request, user, "platform_admin",
                               "Gli amministratori della piattaforma entrano solo con password e secondo fattore")
            if user["status"] != "ACTIVE" or user["org_status"] != "ACTIVE":
                raise _rifiuta(conn, request, user, "disattivato", "Il tuo account SkyTower è disattivato")
            if user["locked_until"] and user["locked_until"] > auth._now():
                raise _rifiuta(conn, request, user, "bloccato", "Account temporaneamente bloccato: riprova più tardi")
            if auth._sso_enforced(conn, user["id"]):
                raise _rifiuta(conn, request, user, "sso",
                               "La tua organizzazione usa il single sign-on: accedi con l'account aziendale")
    if user is None:
        user = _crea_utente(svc, request, org, email, username, esito.get("nome"), admin_portale)
        creato = True
    # collegamento per username, nome/email del portale, admin dato o tolto, Project Admin della regola tolti (ADR-58)
    allinea_profilo(svc, request, user, username, email, esito.get("nome"), admin_portale, motivo=f"ingresso {via}")
    progetti = assicura_membership(svc, request, user, admin=admin_portale)
    with svc.db.auth_tx() as conn:
        # il portale ha verificato la sessione, ma il secondo fattore resta di SkyTower: stessa risposta del login
        if auth._has_verified_factor(conn, user["id"]):
            security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                           user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti, next="mfa",
                           via=via)
            methods = [r["method"] for r in conn.execute(
                "SELECT DISTINCT method::text FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NOT NULL "
                "ORDER BY 1 DESC", [user["id"]]).fetchall()]
            return {"status": "mfa_required", "methods": [*methods, "RECOVERY_CODE"],
                    "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=False), "creato": creato,
                    "progetti_aggiunti": progetti, "email": user["email"]}
        if user["mfa_required"]:
            security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                           user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti,
                           next="mfa_enrollment", via=via)
            return {"status": "mfa_enrollment_required", "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=True),
                    "creato": creato, "progetti_aggiunti": progetti, "email": user["email"]}
        if via == "password":
            # la password del portale è una prova della password: il contatore riparte, come dopo un login riuscito
            conn.execute("UPDATE cde.users SET last_login_at = now(), failed_login_count = 0 WHERE id = %s", [user["id"]])
        else:
            # niente azzeramento di failed_login_count/locked_until: la sessione del portale non è una prova della password
            conn.execute("UPDATE cde.users SET last_login_at = now() WHERE id = %s", [user["id"]])
        security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"],
                       ip=ip, user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti, via=via)
        sessione = auth._start_session(svc, conn, response, user,
                                       amr=["pwd", "portale"] if via == "password" else ["portale"], request=request)
    return {**sessione, "creato": creato, "progetti_aggiunti": progetti, "email": user["email"]}


__all__ = ["MSG_SOLO_PROPRIETARIO", "admin_del_portale", "allinea_profilo", "assicura_membership", "controlla_ingresso",
           "entra", "organizzazione_suite", "profilo_portale", "richiedi_proprietario", "router", "stato_proprietario",
           "suite_link", "verifica_password_portale", "verifica_portale"]
