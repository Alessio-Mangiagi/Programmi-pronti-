# "><(((º> sabusabu <º)))><"
"""
Utenti e sessioni dell'interfaccia web.

Ruoli:
  admin   vede e usa tutto (impostazioni, trasferimenti, posta, report, utenti)
  utente  vede solo la Panoramica e puo' farsi inviare il report via email

Gli utenti stanno nella cassaforte cifrata (cassaforte.py), con la password ridotta a impronta irreversibile
(PBKDF2-SHA256, 600.000 iterazioni, sale casuale). Il vecchio utenti.json viene importato e cancellato.
Le sessioni sono solo in memoria: chiudendo il programma tutti devono rientrare.

Password del portale: chi ha un utente qui entra anche con la password del Portale Suite Cosedil
(una password per tutti i programmi, scelta del 06/11/2026). Se la password di VFP Transfer non coincide,
login() chiede al portale (shared/sso/cosedil_sso.verifica_password) se e' quella del portale; l'utente di
qui e' quello collegato a quello username del portale (campo "portale"), altrimenti quello con lo stesso nome
o con la stessa email. Chi apre l'interfaccia con la sessione del portale entra da solo (ingresso_dal_portale,
un solo login nella suite, 09/11/2026).

Profilo del portale valido anche qui (decisione dell'utente dell'11/11/2026, "2b 3b 4a" e "gli admin li creo e
li cancello solo io"):
  - chi e' abilitato a VFP Transfer nel portale e non ha un utente qui lo riceve al primo ingresso dal portale
    (ruolo utente, area predefinita: le aree le assegna l'amministratore di qui), collegato per username;
  - per gli utenti collegati al portale il ruolo amministratore lo decide il portale: dato E tolto a ogni
    ingresso; nome ed email si aggiornano dal portale;
  - a ogni login, anche con la password di qui, si chiede il profilo al portale (POST /api/suite/profilo):
    utente disattivato o VFP Transfer non spuntato -> accesso rifiutato; portale spento -> si entra lo stesso
    e resta traccia nel registro (le password di qui restano valide). Le sessioni gia' aperte non si
    ricontrollano (scelta 2b: solo al login);
  - dare o togliere l'amministratore, creare, modificare o eliminare un amministratore: solo il proprietario
    della suite (utente del portale con "proprietario": true), chiesto al portale nel momento in cui agisce.

Ogni modifica a utenti e credenziali richiede un codice monouso inviato via email SOLO all'amministratore
(ADMIN_EMAIL): valido 10 minuti, legato a quella modifica, 5 tentativi. Finche' l'invio email non e'
configurato la protezione non e' attiva (serve per la prima configurazione) e l'interfaccia lo segnala.

Da riga di comando (la password viene chiesta senza mostrarla; serve il codice inviato all'amministratore):
  python auth.py aggiungi NOME --ruolo admin [--email indirizzo]
  python auth.py password NOME
  python auth.py elimina NOME
  python auth.py elenco
"""

import argparse
import getpass
import hashlib
import hmac
import json
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request

import attivita
import cassaforte
import env_config
import mail_send

# Modulo SSO condiviso della suite (shared/sso, due cartelle sopra): serve per la password del portale.
_SSO = env_config.BASE_DIR.resolve().parents[1] / "shared" / "sso"
APP_ID = "vfp-transfer"  # id del programma nel portale (spunta in Amministrazione > Utenti del portale)

MSG_SOLO_PROPRIETARIO = "Solo il proprietario della suite gestisce gli amministratori"
MSG_RUOLO_DAL_PORTALE = ("Ruolo deciso dal Portale: il proprietario della suite lo cambia in "
                         "Amministrazione > Utenti del Portale")

USERS_PATH = env_config.BASE_DIR / "utenti.json"
ROLES = {"admin": "Amministratore", "utente": "Utente"}
# area di lavoro di un utente normale (l'amministratore le vede tutte)
AREE = {"documenti": "Documenti", "posta": "Posta", "mezzi": "Mezzi"}
AREA_PREDEFINITA = "documenti"
PBKDF2_ITERATIONS = 600_000
MIN_PASSWORD = 8
SESSION_IDLE = 60 * 60  # un'ora senza richieste
SESSION_MAX = 12 * 60 * 60  # al massimo una giornata di lavoro, poi si rientra
MAX_FAILURES = 5  # tentativi sbagliati prima del blocco
LOCK_SECONDS = 15 * 60
_NAME_RE = re.compile(r"^[A-Za-z0-9._@-]{2,64}$")
_DUMMY_HASH = None  # per non far capire dai tempi di risposta se un utente esiste

APPROVAL_TTL = 10 * 60
APPROVAL_TRIES = 5
APPROVAL_SENDS = (5, 15 * 60)  # codici inviati al massimo per utente in 15 minuti
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # senza 0/O e 1/I, facili da confondere

_lock = threading.Lock()
_approvals = {}  # sessione (o "cli") -> codice in attesa
_approval_sends = {}
_sessions = {}  # token -> {"user", "role", "created", "seen"}
_failures = {}  # nome utente -> [istanti dei tentativi falliti]


class AuthError(Exception):
    """Accesso non riuscito: il messaggio si puo' mostrare all'utente."""


class ApprovalRequired(Exception):
    """Serve il codice inviato all'amministratore (risposta HTTP 428 all'interfaccia)."""


# --------------------------------------------------------------------------- password

def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(calc.hex(), digest)


def check_new_password(password, name=""):
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"La password deve avere almeno {MIN_PASSWORD} caratteri")
    if name and password.lower() == name.lower():
        raise ValueError("La password non puo' coincidere con il nome utente")


# --------------------------------------------------------------------------- archivio utenti

def _read_users_file():
    try:
        data = json.loads(USERS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data.get("users", {}) if isinstance(data, dict) else {}


def load_users():
    if cassaforte.available():
        if USERS_PATH.exists():  # vecchio archivio in chiaro: importato nella cassaforte e cancellato
            imported = _read_users_file()
            cassaforte.set_users({**imported, **cassaforte.users()})
            USERS_PATH.unlink()
        users = cassaforte.users()
    else:
        users = _read_users_file()
    return {k: v for k, v in users.items() if isinstance(v, dict) and v.get("role") in ROLES and v.get("hash")}


def _save_users(users):
    if cassaforte.available():
        cassaforte.set_users(users)
        return
    tmp = USERS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"users": users}, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(USERS_PATH)


# --------------------------------------------------------------------------- codici di autorizzazione

def _code_hash(code):
    clean = "".join(ch for ch in str(code).upper() if ch.isalnum())
    return hashlib.sha256(clean.encode()).hexdigest()


def _mask(address):
    name, _, domain = (address or "").partition("@")
    return f"{name[:1]}***@{domain}" if domain else "l'amministratore"


def approval_active(settings=None):
    """La protezione con codice e' attiva solo quando il programma sa inviare email all'amministratore."""
    return not mail_send.send_problems(settings or env_config.load_settings())


def require_approval(key, user, what, change, code=None):
    """
    Autorizza una modifica con il codice inviato all'amministratore. key: sessione che chiede la modifica;
    change: contenuto della modifica (il codice vale solo per quella). Ritorna se autorizzata, altrimenti
    solleva ApprovalRequired (codice inviato, sbagliato o scaduto).
    """
    settings = env_config.load_settings()
    if not approval_active(settings):
        return False  # prima configurazione: invio email non ancora pronto
    digest = hashlib.sha256(json.dumps(change, sort_keys=True, default=str).encode()).hexdigest()
    now = time.time()
    with _lock:
        pending = _approvals.get(key)
        if code and pending and pending["digest"] == digest and now < pending["expires"]:
            pending["tries"] += 1
            if hmac.compare_digest(_code_hash(code), pending["hash"]):
                _approvals.pop(key, None)
                attivita.record(user, "sicurezza", "Codice di autorizzazione confermato", what)
                return True
            attivita.record(user, "sicurezza", "Codice di autorizzazione errato", what, "fallito")
            if pending["tries"] >= APPROVAL_TRIES:
                _approvals.pop(key, None)
                raise ApprovalRequired("Troppi codici sbagliati: annulla e ripeti la modifica per riceverne uno nuovo")
            raise ApprovalRequired(f"Codice non corretto: riprova ({APPROVAL_TRIES - pending['tries']} tentativi rimasti)")
        recent = [t for t in _approval_sends.get(user, []) if now - t < APPROVAL_SENDS[1]]
        if len(recent) >= APPROVAL_SENDS[0]:
            raise ValueError("Troppi codici richiesti: riprovare tra qualche minuto")
        _approval_sends[user] = recent + [now]
        new_code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        _approvals[key] = {"hash": _code_hash(new_code), "digest": digest, "expires": now + APPROVAL_TTL, "tries": 0}
    pretty = f"{new_code[:4]}-{new_code[4:]}"
    attivita.record(user, "sicurezza", "Codice di autorizzazione richiesto", what)
    mail_send.send(settings, [settings["ADMIN_EMAIL"]], "Codice per autorizzare una modifica - trasferimento VFP", (
        f"Codice: {pretty}\n\n"
        f"Richiesto da: {user}\nModifica: {what}\nOra: {time.strftime('%d/%m/%Y %H:%M')}\n\n"
        "Il codice vale 10 minuti e solo per questa modifica.\n"
        "Se non hai chiesto tu questa modifica, non comunicare il codice a nessuno e cambia subito la password "
        "dell'utente indicato."))
    expired = " Il codice precedente era scaduto o riferito a un'altra modifica." if code else ""
    raise ApprovalRequired(f"Per confermare inserisci il codice inviato a {_mask(settings['ADMIN_EMAIL'])} "
                           f"(valido 10 minuti).{expired}")


def cli_approval(what, emergency=False):
    """Autorizzazione per i comandi da terminale: codice via email, oppure --emergenza (registrata nel log)."""
    if not load_users() or not approval_active():
        print("Attenzione: invio email non configurato, modifica senza codice (prima configurazione).")
        return
    if emergency:
        _log_line(f"EMERGENZA: {what} senza codice, utente Windows {getpass.getuser()}")
        attivita.record(f"terminale ({getpass.getuser()})", "sicurezza", "Modifica di emergenza senza codice", what)
        print("Modifica di emergenza senza codice: registrata in logs/vfp_servizio.log")
        return
    code = None
    for _ in range(APPROVAL_TRIES + 1):
        try:
            require_approval("cli", f"terminale ({getpass.getuser()})", what, {"what": what}, code)
            return
        except ApprovalRequired as e:
            print(e)
            code = input("Codice: ").strip()
            if not code:
                raise ValueError("Modifica annullata")
        except Exception as e:  # invio email non riuscito
            raise ValueError(f"Impossibile inviare il codice all'amministratore ({e}). "
                             "Se l'invio email non funziona, ripetere con --emergenza")
    raise ValueError("Modifica annullata")


def _log_line(text):
    path = env_config.BASE_DIR / "logs" / "vfp_servizio.log"
    path.parent.mkdir(exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} WARNING [terminale] {text}\n")


def list_users():
    # "portale": username del portale a cui l'utente e' collegato (vuoto = utente solo di qui); "nome": nome e
    # cognome dal portale. Servono alla pagina Utenti per mostrare "dal Portale" e bloccare il ruolo.
    return [{"name": n, "role": u["role"], "role_label": ROLES[u["role"]], "email": u.get("email", ""),
             "area": area_di(u), "area_label": AREE[area_di(u)],
             "created": u.get("created", ""), "last_login": u.get("last_login", ""),
             "portale": u.get("portale", ""), "nome": u.get("nome", ""), "origine": u.get("origine", "")}
            for n, u in sorted(load_users().items())]


def area_di(user):
    """Area di un utente normale; un valore mancante o sconosciuto vale l'area predefinita."""
    a = (user or {}).get("area")
    return a if a in AREE else AREA_PREDEFINITA


def _check_area(area):
    if area not in AREE:
        raise ValueError("Area non valida: " + " oppure ".join(AREE))


def _check_email(email):
    if email and not env_config.EMAIL_RE.match(email):
        raise ValueError("Indirizzo email non valido")


def add_user(name, password, role, email="", area=AREA_PREDEFINITA):
    name, email = name.strip(), (email or "").strip()
    if not _NAME_RE.match(name):
        raise ValueError("Nome utente: 2-64 caratteri tra lettere, numeri e . _ @ -")
    if role not in ROLES:
        raise ValueError("Ruolo non valido")
    _check_area(area)
    _check_email(email)
    check_new_password(password, name)
    with _lock:
        users = load_users()
        if name.lower() in {n.lower() for n in users}:
            raise ValueError(f"L'utente {name} esiste gia'")
        users[name] = {"role": role, "hash": hash_password(password), "email": email, "area": area,
                       "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
        _save_users(users)


def set_password(name, password):
    check_new_password(password, name)
    with _lock:
        users = load_users()
        if name not in users:
            raise ValueError("Utente non trovato")
        users[name]["hash"] = hash_password(password)
        _save_users(users)
    drop_sessions(name)  # chi era collegato con la vecchia password deve rientrare


def update_user(name, role=None, email=None, area=None):
    with _lock:
        users = load_users()
        if name not in users:
            raise ValueError("Utente non trovato")
        if role is not None:
            if role not in ROLES:
                raise ValueError("Ruolo non valido")
            if users[name]["role"] == "admin" and role != "admin" and _admins(users) == 1:
                raise ValueError("Deve restare almeno un amministratore")
            users[name]["role"] = role
        if email is not None:
            _check_email(email.strip())
            users[name]["email"] = email.strip()
        if area is not None:
            _check_area(area)
            users[name]["area"] = area
        _save_users(users)
    if role is not None:
        drop_sessions(name)


def delete_user(name):
    with _lock:
        users = load_users()
        if name not in users:
            raise ValueError("Utente non trovato")
        if users[name]["role"] == "admin" and _admins(users) == 1:
            raise ValueError("Deve restare almeno un amministratore")
        del users[name]
        _save_users(users)
    drop_sessions(name)


def _admins(users):
    return sum(1 for u in users.values() if u["role"] == "admin")


def get_user(name):
    return load_users().get(name)


# --------------------------------------------------------------------------- accesso e sessioni

def _sso():
    """Modulo SSO condiviso della suite (shared/sso/cosedil_sso.py), oppure None per una copia del programma fuori
    dalla suite (allora valgono solo gli utenti e le password di qui)."""
    try:
        if str(_SSO) not in sys.path:
            sys.path.insert(0, str(_SSO))
        import cosedil_sso
        return cosedil_sso
    except Exception:
        return None


def profilo_portale(login, timeout=3):
    """Profilo della persona nel Portale Suite Cosedil (POST /api/suite/profilo, contratto in
    shared/suite/CONTRATTI.md). ``login`` e' lo username del portale o la sua email.

    Chiamata da server a server con il token della suite (header X-Suite-Token): il browser non c'entra. Non
    solleva mai. Ritorna un dict con:
      raggiungibile  False se il portale e' spento, lo SSO e' spento (COSEDIL_SSO=off), il token e' rifiutato o
                     il portale e' di una versione senza questa rotta (404): chi chiama decide cosa fare;
      trovato        True se il portale conosce la persona; allora anche username, nome, email, ruolo,
                     admin (ruolo admin e non disattivato), proprietario, disattivato, must_change, abilitato
                     (puo' usare VFP Transfer: spunta del programma, o amministratore del portale);
      errore         il motivo quando raggiungibile e' False (per il registro).
    """
    esito = {"raggiungibile": False, "trovato": False, "errore": ""}
    sso = _sso()
    if sso is None:
        esito["errore"] = "modulo SSO della suite assente"
        return esito
    if not sso.ENABLED:
        esito["errore"] = "verifica col portale spenta (COSEDIL_SSO=off)"
        return esito
    login = (login or "").strip()
    if not login:
        esito["raggiungibile"] = True
        return esito
    corpo = json.dumps({"login": login, "app": APP_ID}).encode("utf-8")
    try:
        req = urllib.request.Request(sso.PORTAL + "/api/suite/profilo", data=corpo, method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              "X-Suite-Token": sso._token_suite()})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        esito["errore"] = {403: "token della suite rifiutato dal portale",
                           404: "il portale non ha ancora /api/suite/profilo (versione precedente)"}.get(
            e.code, f"risposta {e.code} del portale")
        return esito
    except Exception:  # portale spento, rete, JSON rotto, token della suite non leggibile
        esito["errore"] = "Portale non raggiungibile"
        return esito
    if not isinstance(dati, dict) or not dati.get("ok"):
        esito["errore"] = "risposta del portale non valida"
        return esito
    esito["raggiungibile"] = True
    if not dati.get("trovato") or not str(dati.get("username") or "").strip():
        return esito
    disattivato = bool(dati.get("disattivato"))
    esito.update(trovato=True, username=str(dati["username"]).strip(), nome=str(dati.get("nome") or "").strip(),
                 email=str(dati.get("email") or "").strip(), ruolo=dati.get("ruolo"),
                 admin=bool(dati.get("admin")) and dati.get("ruolo") == "admin" and not disattivato,
                 proprietario=bool(dati.get("proprietario")) and not disattivato, disattivato=disattivato,
                 must_change=bool(dati.get("mustChange")), abilitato=bool(dati.get("abilitato")))
    return esito


def _motivo_rifiuto(p):
    """Perche' il portale non lascia entrare questa persona in VFP Transfer (None = puo' entrare).
    ``abilitato`` None vuol dire "non si sa" (portale di una versione senza /api/suite/profilo)."""
    if p.get("disattivato"):
        return "Account del Portale disattivato: rivolgiti a un amministratore"
    if p.get("abilitato") is False:
        return ("VFP Transfer non è fra i tuoi programmi del Portale: chiedi l'abilitazione a un amministratore")
    return None


def _nome_per_portale(users, username, email):
    """Utente di qui per la persona del portale: prima quello collegato a quello username (campo "portale",
    cosi' un cambio di email nel portale non crea un secondo utente), poi lo stesso nome, poi la stessa email
    (una sola: un'email condivisa da due utenti non identifica nessuno)."""
    username, email = (username or "").lower(), (email or "").lower()
    collegati = [n for n, u in users.items() if username and (u.get("portale") or "").lower() == username]
    if collegati:
        return collegati[0]
    per_nome = [n for n in users if n.lower() == username]
    if per_nome:
        return per_nome[0]
    per_email = [n for n, u in users.items() if email and (u.get("email") or "").strip().lower() == email]
    return per_email[0] if len(per_email) == 1 else None


def _allinea_account(users, nome, p, identita):
    """Allinea l'utente di qui ``nome`` al profilo ``p`` del portale (trovato). Modifica ``users`` (che chi chiama
    salva) e ritorna gli eventi da scrivere nel registro, come coppie (azione, dettaglio).

    ``identita`` e' True solo quando il portale ha confermato chi e' la persona (sessione del portale o sua
    password). Allora l'utente si collega allo username del portale, nome ed email si aggiornano e il ruolo
    amministratore si puo' DARE. Con la sola password di qui (identita False) l'amministratore si puo' solo
    TOGLIERE: altrimenti un utente creato qui con il nome di un amministratore del portale diventerebbe
    amministratore senza che nessuno l'abbia deciso.

    Quando il portale promuove un utente nato qui (non creato dal portale), la sua password di qui viene sostituita
    con una casuale: chi l'aveva scelta o la conosceva (un altro amministratore che l'ha creato) non deve ritrovarsi
    amministratore. Si continua a entrare dal portale o con la password del portale.
    """
    u = users[nome]
    eventi = []
    if identita:
        if (u.get("portale") or "") != p["username"]:
            u["portale"] = p["username"]
            eventi.append(("Utente collegato al Portale", p["username"]))
        if p.get("email") and (u.get("email") or "").strip().lower() != p["email"].lower():
            u["email"] = p["email"]
            eventi.append(("Email aggiornata dal Portale", p["email"]))
        if p.get("nome"):
            u["nome"] = p["nome"]
        if p.get("admin") and u["role"] != "admin":
            u["role"] = "admin"
            eventi.append(("Ruolo amministratore dal Portale", "amministratore del Portale"))
            if u.get("origine") != "portale":
                u["hash"] = hash_password(secrets.token_urlsafe(32))
                eventi.append(("Password di qui sostituita", "diventato amministratore dal Portale: si entra dal "
                                                             "Portale o con la password del Portale"))
    if not p.get("admin") and u["role"] == "admin":
        u["role"] = "utente"
        eventi.append(("Ruolo amministratore tolto dal Portale", "non è amministratore nel Portale"))
    return eventi


def _registra(nome, eventi, role=""):
    for azione, dettaglio in eventi:
        attivita.record(nome, "sicurezza", azione, dettaglio, role=role or "")


def _utente_dal_portale(users, name, password, ip):
    """(nome dell'utente di qui, esito del portale) se ``password`` e' la password del portale di chi ha scritto
    ``name``, altrimenti None.

    Il portale riconosce la persona da cio' che ha scritto (username o email del portale), controlla la password
    con i suoi blocchi sull'IP della persona (e rifiuta chi e' disattivato o non abilitato) e risponde con username
    ed email: qui vale l'utente trovato da _nome_per_portale. Portale spento, COSEDIL_SSO=off, password sbagliata
    o nessun utente corrispondente: None, e il login fallisce come prima.
    """
    sso = _sso()
    if sso is None:  # copia del programma fuori dalla suite: solo password locale
        return None
    try:
        v = sso.verifica_password(name, password, APP_ID, ip=ip)
    except Exception:
        return None
    if not v.get("ok"):
        return None
    nome = _nome_per_portale(users, v.get("username"), v.get("email"))
    return (nome, v) if nome else None


def _controllo_al_login(nome, v=None):
    """Profilo del portale al login (scelte 2b e 3b dell'11/11/2026). Solleva AuthError se il portale non lascia
    entrare la persona; altrimenti allinea l'utente di qui e ritorna lo username del portale quando l'identita'
    e' confermata (va nella sessione: serve per riconoscere il proprietario), altrimenti None.

    ``v``: esito di cosedil_sso.verifica_password quando si e' entrati con la password del portale (identita'
    confermata). Senza ``v`` si e' entrati con la password di qui: si cerca nel portale l'utente collegato, poi lo
    stesso nome, poi la stessa email; se il portale non lo conosce l'utente e' solo di qui e nulla cambia.
    """
    users = load_users()
    u = users.get(nome) or {}
    if v:
        p = profilo_portale(v.get("username"))
        if not p["raggiungibile"]:
            # portale senza /api/suite/profilo: valgono i dati della verifica della password (il portale ha gia'
            # rifiutato chi e' disattivato o non abilitato)
            p = {"raggiungibile": False, "trovato": True, "username": v.get("username"), "nome": v.get("nome") or "",
                 "email": v.get("email") or "", "admin": v.get("ruolo") == "admin" and bool(v.get("admin")),
                 "disattivato": False, "abilitato": None}
        identita = True
    else:
        chiavi = [u.get("portale")] if u.get("portale") else [nome, u.get("email")]
        p = {"raggiungibile": True, "trovato": False}
        for chiave in [c for c in chiavi if c]:
            p = profilo_portale(chiave)
            if not p["raggiungibile"] or p["trovato"]:
                break
        identita = False
        if not p["raggiungibile"]:
            # 3b: le password di qui restano valide anche a portale spento, ma resta traccia
            _log_line(f"accesso di {nome} senza verifica del profilo nel Portale ({p.get('errore')})")
            attivita.record(nome, "sicurezza", "Accesso senza verifica del Portale", p.get("errore") or "")
            return None
        if not p["trovato"]:
            if u.get("portale"):  # era collegato a un utente che il portale non ha piu' (eliminato)
                attivita.record(nome, "sicurezza", "Accesso negato", "utente del Portale non piu' presente",
                                "negato")
                raise AuthError("Il tuo utente del Portale non esiste più: rivolgiti a un amministratore")
            return None  # utente solo di qui: nessun profilo da seguire
    motivo = _motivo_rifiuto(p)
    if motivo:
        attivita.record(nome, "sicurezza", "Accesso negato dal Portale", motivo, "negato")
        raise AuthError(motivo)
    with _lock:
        users = load_users()
        if nome not in users:
            raise AuthError("Nome utente o password non corretti")
        eventi = _allinea_account(users, nome, p, identita)
        if eventi:
            _save_users(users)
        role = users[nome]["role"]
    _registra(nome, eventi, role)
    return p["username"] if identita else None


def login(name, password, ip=None):
    """Restituisce (token, ruolo). Blocca l'utente per 15 minuti dopo 5 tentativi sbagliati.

    Vale la password di VFP Transfer oppure quella del portale (vedi _utente_dal_portale); ``ip`` e' l'indirizzo
    di chi entra, passato al portale per i suoi blocchi sui tentativi. Con la password giusta si chiede comunque
    il profilo al portale (_controllo_al_login): disattivato o non abilitato -> AuthError con il motivo.
    """
    global _DUMMY_HASH
    name = (name or "").strip()[:64]
    key = name.lower()
    now = time.time()
    with _lock:
        recent = [t for t in _failures.get(key, []) if now - t < LOCK_SECONDS]
        _failures[key] = recent
        if len(recent) >= MAX_FAILURES:
            wait = int((LOCK_SECONDS - (now - recent[0])) / 60) + 1
            raise AuthError(f"Troppi tentativi sbagliati: riprovare tra {wait} minuti")
    users = load_users()
    match = next((n for n in users if n.lower() == key), None)
    if match:
        ok = verify_password(password or "", users[match]["hash"])
    else:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = hash_password(secrets.token_hex(8))
        verify_password(password or "", _DUMMY_HASH)  # stesso tempo di risposta di un utente esistente
        ok = False
    v = None
    if not ok and password:
        # non e' la password di qui: puo' essere quella del portale (anche scrivendo username o email del portale)
        dal_portale = _utente_dal_portale(users, name, password, ip)
        if dal_portale:
            (match, v), ok = dal_portale, True
    if not ok:
        with _lock:
            _failures.setdefault(key, []).append(time.time())
        raise AuthError("Nome utente o password non corretti")
    with _lock:
        _failures.pop(key, None)
    # la password e' giusta: ora decide il profilo del portale (puo' rifiutare, togliere o dare l'admin)
    portale = _controllo_al_login(match, v)
    if v:
        attivita.record(match, "accesso", "Accesso con la password del Portale", "")
    with _lock:
        users = load_users()
        token = secrets.token_urlsafe(32)
        _sessions[token] = {"user": match, "role": users.get(match, {}).get("role", "utente"), "created": now,
                            "seen": now, "portale": portale}
        if match in users:
            users[match]["last_login"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _save_users(users)
    return token, users.get(match, {}).get("role", "utente")


def ingresso_dal_portale(cookie_header, ip=None):
    """Un solo login nella suite (09/11/2026): chi apre l'interfaccia con la sessione del Portale Suite Cosedil
    (cookie ``sid``, che il browser manda anche qui: stesso host) entra senza scrivere nulla.

    Dall'11/11/2026 (profilo del portale valido ovunque):
    - la persona deve essere abilitata a VFP Transfer nel portale (spunta del programma, o amministratore del
      portale) e non disattivata: altrimenti None e resta la pagina di accesso;
    - se non ha un utente qui viene creato, collegato al suo username del portale: amministratore se lo e' nel
      portale, altrimenti utente con l'area predefinita (le aree le assegna l'amministratore di qui). Password
      casuale che nessuno conosce: si entra dal portale o con la password del portale;
    - se ce l'ha (collegato, stesso nome o stessa email) il ruolo amministratore segue il portale, dato e tolto,
      e nome ed email si aggiornano (_allinea_account con identita' confermata).
    L'admin concesso da una regola IP del portale non basta: conta il ruolo "admin" del profilo.

    Al portale va solo ``sid=<valore>`` (non il cookie di sessione di VFP Transfer). Portale spento, COSEDIL_SSO=off
    o modulo condiviso assente (copia fuori dalla suite): None. Ritorna (token, ruolo, nome) oppure None.
    """
    sso = _sso()
    if sso is None:  # copia del programma fuori dalla suite: solo login locale
        return None
    sid = sso.leggi_sid(cookie_header or "")
    if not sso.ENABLED or not sid:
        return None
    v = sso.verifica_sessione(f"sid={sid}", APP_ID)
    username = (v.get("username") or "").strip()
    if not v.get("ok") or not username:
        return None
    p = profilo_portale(username)
    if not p["raggiungibile"]:
        # portale di una versione senza /api/suite/profilo: come prima dell'11/11 con i soli dati di /api/verify.
        # L'abilitazione non si conosce, quindi un utente nuovo nasce solo per l'amministratore del portale.
        p = {"raggiungibile": False, "trovato": True, "username": username, "nome": v.get("nome") or "",
             "email": v.get("email") or "", "admin": v.get("ruolo") == "admin" and bool(v.get("admin")),
             "disattivato": False, "abilitato": None}
    if not p["trovato"]:
        return None
    motivo = _motivo_rifiuto(p)
    if motivo:
        attivita.record(username, "accesso", "Ingresso dal Portale negato", motivo, "negato")
        return None
    with _lock:
        users = load_users()
        nome = _nome_per_portale(users, p["username"], p.get("email"))
        if nome is None:
            if not _NAME_RE.match(p["username"]) or (p["abilitato"] is None and not p["admin"]):
                return None
            nome = p["username"]
            users[nome] = {"role": "admin" if p["admin"] else "utente",
                           "hash": hash_password(secrets.token_urlsafe(32)),
                           "email": p.get("email") or "", "area": AREA_PREDEFINITA, "nome": p.get("nome") or "",
                           "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "origine": "portale",
                           "portale": p["username"]}
            eventi = [("Utente creato dal Portale",
                       "amministratore del Portale" if p["admin"] else "utente abilitato a VFP Transfer nel Portale")]
        else:
            eventi = _allinea_account(users, nome, p, identita=True)
        users[nome]["last_login"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _save_users(users)
        role = users[nome]["role"]
        token = secrets.token_urlsafe(32)
        now = time.time()
        _sessions[token] = {"user": nome, "role": role, "created": now, "seen": now, "portale": p["username"]}
    _registra(nome, eventi, role)
    attivita.record(nome, "accesso", "Accesso dal Portale", "", role=role)
    return token, role, nome


# --------------------------------------------------------------------------- amministratori: solo il proprietario

def e_proprietario(sess):
    """True se chi agisce e' il proprietario della suite, chiesto al portale adesso (non in cache).

    Serve una sessione aperta con l'identita' confermata dal portale (ingresso dal portale o password del portale:
    campo "portale" della sessione). Con la sola password di qui la risposta e' sempre False: un utente di qui
    con lo stesso nome del proprietario non e' il proprietario. Portale spento: False (si rifiuta)."""
    login = (sess or {}).get("portale")
    if not login:
        return False
    p = profilo_portale(login)
    return bool(p["raggiungibile"] and p["trovato"] and p.get("proprietario"))


def controlla_modifica_utente(sess, action, name, role=None):
    """Regole sugli amministratori (decisione dell'utente dell'11/11/2026: "gli admin li creo e li cancello solo
    io"). Solleva ValueError con il motivo da mostrare; non tocca nulla. Va chiamata PRIMA del codice di
    autorizzazione via email, cosi' non si manda un codice per una modifica che verra' rifiutata.

    - Ruolo di un utente collegato al portale: lo decide il portale, qui non si cambia (MSG_RUOLO_DAL_PORTALE).
    - Creare un amministratore, dare o togliere il ruolo amministratore, eliminare un amministratore, cambiare
      password, email o area di un altro amministratore: solo il proprietario della suite (MSG_SOLO_PROPRIETARIO).
      Altrimenti un amministratore qualsiasi potrebbe crearne altri, o prendere l'utente di un amministratore
      cambiandogli la password.
    - La propria password ognuno la cambia da se'.
    """
    users = load_users()
    target = users.get(name)
    if action == "update" and role is not None and target and role != target["role"] and target.get("portale"):
        raise ValueError(MSG_RUOLO_DAL_PORTALE)
    serve_proprietario = False
    if action == "add":
        serve_proprietario = role == "admin"
    elif target is not None:
        cambia_ruolo = action == "update" and role is not None and role != target["role"]
        if cambia_ruolo and "admin" in (role, target["role"]):
            serve_proprietario = True
        elif target["role"] == "admin" and name != (sess or {}).get("user"):
            serve_proprietario = action in ("update", "password", "delete")
    if serve_proprietario and not e_proprietario(sess):
        raise ValueError(MSG_SOLO_PROPRIETARIO)


def session(token):
    """Sessione valida per il token del cookie, oppure None. Il ruolo viene riletto dall'archivio utenti."""
    if not token:
        return None
    now = time.time()
    with _lock:
        s = _sessions.get(token)
        if not s:
            return None
        if now - s["seen"] > SESSION_IDLE or now - s["created"] > SESSION_MAX:
            _sessions.pop(token, None)
            return None
        s["seen"] = now
        s = dict(s)
    user = load_users().get(s["user"])
    if not user:  # utente eliminato nel frattempo (anche da riga di comando)
        logout(token)
        return None
    s["role"] = user["role"]
    s["area"] = area_di(user)  # riletta a ogni richiesta: un cambio d'area vale subito
    return s


def logout(token):
    with _lock:
        _sessions.pop(token, None)


def _session_id(token):
    """Identificativo mostrabile di una sessione: mai il token vero."""
    return hashlib.sha256(token.encode()).hexdigest()[:12]


def active_sessions():
    now = time.time()
    with _lock:
        live = [(t, s) for t, s in _sessions.items()
                if now - s["seen"] <= SESSION_IDLE and now - s["created"] <= SESSION_MAX]
    return [{"id": _session_id(t), "user": s["user"], "role": s["role"], "created": s["created"], "seen": s["seen"]}
            for t, s in sorted(live, key=lambda x: -x[1]["seen"])]


def close_session(session_id, current_token):
    """Chiude la sessione indicata (non quella di chi lo chiede: per quella c'e' 'Esci'). Ritorna l'utente."""
    with _lock:
        for t, s in list(_sessions.items()):
            if _session_id(t) == session_id:
                if t == current_token:
                    raise ValueError("Per chiudere la tua sessione usa Esci")
                _sessions.pop(t, None)
                return s["user"]
    raise ValueError("Sessione non trovata o gia' scaduta")


def drop_sessions(name):
    with _lock:
        for t in [t for t, s in _sessions.items() if s["user"] == name]:
            _sessions.pop(t, None)


# --------------------------------------------------------------------------- riga di comando

def _ask_password(name):
    while True:
        pw = getpass.getpass(f"Password per {name}: ")
        try:
            check_new_password(pw, name)
        except ValueError as e:
            print(e)
            continue
        if getpass.getpass("Ripetere la password: ") != pw:
            print("Le due password non coincidono")
            continue
        return pw


def main():
    parser = argparse.ArgumentParser(description="Gestione degli utenti dell'interfaccia trasferimento VFP.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("aggiungi", help="crea un utente")
    p.add_argument("nome")
    p.add_argument("--ruolo", choices=sorted(ROLES), default="utente")
    p.add_argument("--email", default="")
    p.add_argument("--area", choices=sorted(AREE), default=AREA_PREDEFINITA,
                   help="area dell'utente normale (l'amministratore le vede tutte)")
    sub.add_parser("password", help="cambia la password").add_argument("nome")
    sub.add_parser("elimina", help="elimina un utente").add_argument("nome")
    sub.add_parser("elenco", help="elenca gli utenti")
    for cmd in ("aggiungi", "password", "elimina"):
        sub.choices[cmd].add_argument("--emergenza", action="store_true",
                                      help="senza codice email (solo se l'invio non funziona; registrato)")
    args = parser.parse_args()
    try:
        if args.cmd != "elenco":
            cli_approval(f"{args.cmd} utente {args.nome} (da terminale)", args.emergenza)
        if args.cmd == "aggiungi":
            add_user(args.nome, _ask_password(args.nome), args.ruolo, args.email, args.area)
            print(f"Utente {args.nome} creato ({ROLES[args.ruolo]}" +
                  (f", area {AREE[args.area]})." if args.ruolo != "admin" else ")."))
        elif args.cmd == "password":
            if not get_user(args.nome):
                raise ValueError("Utente non trovato")
            set_password(args.nome, _ask_password(args.nome))
            print("Password aggiornata.")
        elif args.cmd == "elimina":
            delete_user(args.nome)
            print(f"Utente {args.nome} eliminato.")
        else:
            for u in list_users():
                area = "tutte" if u["role"] == "admin" else u["area_label"]
                print(f"{u['name']:<24} {u['role_label']:<16} {area:<10} {u['email']}")
    except ValueError as e:
        sys.exit(str(e))
    print("Se il programma e' gia' aperto, le modifiche valgono subito (la cassaforte viene riletta).")


if __name__ == "__main__":
    main()
