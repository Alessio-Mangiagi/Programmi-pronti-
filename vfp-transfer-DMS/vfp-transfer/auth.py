# "><(((º> sabusabu <º)))><"
"""
Utenti e sessioni dell'interfaccia web.

Ruoli:
  admin   vede e usa tutto (impostazioni, trasferimenti, posta, report, utenti)
  utente  vede solo la Panoramica e puo' farsi inviare il report via email

Gli utenti stanno nella cassaforte cifrata (cassaforte.py), con la password ridotta a impronta irreversibile
(PBKDF2-SHA256, 600.000 iterazioni, sale casuale). Il vecchio utenti.json viene importato e cancellato.
Le sessioni sono solo in memoria: chiudendo il programma tutti devono rientrare.

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

import attivita
import cassaforte
import env_config
import mail_send

USERS_PATH = env_config.BASE_DIR / "utenti.json"
ROLES = {"admin": "Amministratore", "utente": "Utente"}
# area di lavoro di un utente normale (l'amministratore le vede tutte)
AREE = {"documenti": "Documenti", "posta": "Posta"}
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
    return [{"name": n, "role": u["role"], "role_label": ROLES[u["role"]], "email": u.get("email", ""),
             "area": area_di(u), "area_label": AREE[area_di(u)],
             "created": u.get("created", ""), "last_login": u.get("last_login", "")}
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

def login(name, password):
    """Restituisce (token, ruolo). Blocca l'utente per 15 minuti dopo 5 tentativi sbagliati."""
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
    if not ok:
        with _lock:
            _failures.setdefault(key, []).append(time.time())
        raise AuthError("Nome utente o password non corretti")
    with _lock:
        _failures.pop(key, None)
        token = secrets.token_urlsafe(32)
        _sessions[token] = {"user": match, "role": users[match]["role"], "created": now, "seen": now}
        users = load_users()
        if match in users:
            users[match]["last_login"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            _save_users(users)
    return token, users.get(match, {}).get("role", "utente")


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
