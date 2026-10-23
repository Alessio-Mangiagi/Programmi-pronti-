# "><(((º> sabusabu <º)))><"
"""
Impostazioni e credenziali del programma, lette dal file .env (senza librerie esterne).

Ordine di precedenza: variabili d'ambiente di Windows > cassaforte cifrata > file .env > valori predefiniti.
Credenziali e identificativi delle API (VAULT_KEYS) stanno solo nella cassaforte (cassaforte.py): se compaiono
nel .env vengono spostati la' e cancellati dal file alla prima lettura.
Il vecchio config.json, se presente e se .env non esiste ancora, viene convertito una volta sola.
"""

import json
import os
import re
from pathlib import Path

import cassaforte

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
LEGACY_JSON_PATH = BASE_DIR / "config.json"

# estensioni ammesse per gli allegati email: elenco chiuso, quello che non c'e' non entra in VFP
DEFAULT_ALLOWED_EXT = ("pdf,p7m,dwg,dxf,dwf,ifc,rvt,doc,docx,xls,xlsx,ppt,pptx,odt,ods,rtf,txt,csv,xml,"
                       "jpg,jpeg,png,tif,tiff,zip")
# mai ammesse, qualunque cosa dica MAIL_ALLOWED_EXT: eseguibili, script, pagine web, documenti con macro
BLOCKED_EXT = {
    "exe", "com", "scr", "pif", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta",
    "msi", "msp", "dll", "cpl", "jar", "lnk", "reg", "inf", "url", "iso", "img", "vhd", "vhdx", "html", "htm",
    "svg", "xhtml", "mht", "chm", "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam", "one",
}

DEFAULTS = {
    # ---- Viewpoint For Projects
    "VFP_BASE_URL": "https://api-uk.vfp.viewpoint.com",
    "VFP_AUTH_URL": "https://identity-uk.team.viewpoint.com/connect/authorize",
    "VFP_TOKEN_URL": "https://api-uk.vfp.viewpoint.com/token",
    "VFP_CLIENT_ID": "",
    "VFP_CLIENT_SECRET": "",
    "VFP_REDIRECT_URI": "http://localhost:8765/callback",
    "VFP_SCOPE": "vfp.fullaccess offline_access",
    "VFP_TARGET_TYPE": "project",
    "VFP_TARGET_ID": "",
    "VFP_DEFAULT_REVISION": "1",
    "VFP_IF_EXISTS": "new_revision",
    "VFP_NOTIFY_EMAIL": "false",
    "VFP_DOCUMENT_DEFAULTS": "{}",
    "VFP_TOKEN_CACHE": ".vfp_token.json",
    "VFP_DOC_URL": "",  # indirizzo web di un documento VFP, con {id} al posto dell'ID (link dall'interfaccia)
    "GUI_PORT": "8770",
    # ---- accesso all'interfaccia da altri PC (facoltativo: di serie solo da questo PC)
    "GUI_BIND": "127.0.0.1",
    "GUI_HOSTNAME": "",
    "GUI_TLS_CERT": "",
    "GUI_TLS_KEY": "",
    # ---- posta in arrivo
    "MAIL_ENABLED": "false",
    "MAIL_SOURCES": "",
    "MAIL_POLL_SECONDS": "120",
    "MAIL_VFP_FOLDER": "Posta in arrivo",
    "MAIL_DONE_FOLDER": "Trasferite a VFP",
    "MAIL_ERROR_FOLDER": "Errori VFP",
    "MAIL_MAX_ATTEMPTS": "3",
    "MAIL_ALLOWED_EXT": DEFAULT_ALLOWED_EXT,
    "MAIL_SKIP_INLINE": "true",
    "MAIL_DATE_PREFIX": "true",
    "MAIL_ARCHIVE_DIR": "posta_in_arrivo",
    # ---- sicurezza della posta
    "MAIL_ALLOWED_SENDERS": "",
    "MAIL_REQUIRE_AUTH": "true",
    "MAIL_ANTIVIRUS": "true",
    "MAIL_MAX_MB": "50",
    "MAIL_QUARANTINE_FOLDER": "Bloccate VFP",
    # ---- protocollo delle PEC: regola personalizzata (vuota = regole predefinite, vedi protocollo.py)
    "PEC_PROTOCOL_REGEX": "",
    # ---- invio del report via email
    "ADMIN_EMAIL": "",
    "REPORT_SEND_METHOD": "smtp",
    "REPORT_FROM": "",
    "REPORT_EMAIL_DOMAINS": "",
    "SMTP_HOST": "",
    "SMTP_PORT": "587",
    "SMTP_SECURITY": "starttls",
    "SMTP_USER": "",
    "SMTP_PASSWORD": "",
    # ---- smistamento con Claude (Anthropic)
    "ANTHROPIC_API_KEY": "",
    "CLAUDE_MODEL": "claude-opus-5-5",
    # ---- moduli autocompilati: no = mai Claude, conferma = Claude solo su richiesta, auto = se i campi mancano
    "MODULI_AI": "conferma",
    "MODULI_DIR": "moduli",
    "MODULI_ARCHIVIO": "moduli_compilati",
    # ---- DMS di origine (sola lettura, vedi estrai_dms.py)
    "DMS_TIPO": "seeddms",
    "DMS_URL": "",
    "DMS_USER": "",
    "DMS_PASSWORD": "",
    # ---- Microsoft 365 (Graph)
    "GRAPH_TENANT_ID": "",
    "GRAPH_CLIENT_ID": "",
    "GRAPH_CLIENT_SECRET": "",
    "GRAPH_MAILBOX": "",
    "GRAPH_FOLDER": "inbox",
    # ---- IMAP generico
    "IMAP_HOST": "",
    "IMAP_PORT": "993",
    "IMAP_USER": "",
    "IMAP_PASSWORD": "",
    "IMAP_FOLDER": "INBOX",
    # ---- PEC (IMAP)
    "PEC_HOST": "",
    "PEC_PORT": "993",
    "PEC_USER": "",
    "PEC_PASSWORD": "",
    "PEC_FOLDER": "INBOX",
    # ---- archivio SQL in sola lettura (sorgente_sql.py)
    "SQL_SERVER": "",
    "SQL_DATABASE": "",
    "SQL_DRIVER": "",  # vuoto = il migliore installato (ODBC Driver 18, 17, poi "SQL Server")
    "SQL_AUTH": "sql",
    "SQL_USER": "",
    "SQL_PASSWORD": "",
    "SQL_TRUST_CERT": "false",
    "SQL_VIEW": "",
    "SQL_FILE_MODE": "contenuto",
    "SQL_PATH_ROOT": "",
    "SQL_CACHE_DIR": "specchio_sql",
}

SECRET_KEYS = {"VFP_CLIENT_SECRET", "GRAPH_CLIENT_SECRET", "IMAP_PASSWORD", "PEC_PASSWORD", "SMTP_PASSWORD",
               "ANTHROPIC_API_KEY", "DMS_PASSWORD", "SQL_PASSWORD"}
# una password resta valida solo per il server a cui era destinata: se cambia uno di questi campi va reinserita,
# altrimenti chi modifica l'indirizzo del server si farebbe mandare la password vera
SECRET_BINDINGS = {
    "VFP_CLIENT_SECRET": ("VFP_AUTH_URL", "VFP_TOKEN_URL", "VFP_BASE_URL", "VFP_CLIENT_ID"),
    "GRAPH_CLIENT_SECRET": ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID"),
    "IMAP_PASSWORD": ("IMAP_HOST", "IMAP_PORT", "IMAP_USER"),
    "PEC_PASSWORD": ("PEC_HOST", "PEC_PORT", "PEC_USER"),
    "SMTP_PASSWORD": ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_SECURITY"),
    "ANTHROPIC_API_KEY": (),  # indirizzo di Anthropic fisso nel codice: la chiave non puo' essere dirottata
    "DMS_PASSWORD": ("DMS_URL", "DMS_USER", "DMS_TIPO"),
    "SQL_PASSWORD": ("SQL_SERVER", "SQL_DATABASE", "SQL_USER", "SQL_AUTH", "SQL_DRIVER"),
}
# credenziali e identificativi delle API: stanno nella cassaforte cifrata, mai nel .env in chiaro
VAULT_KEYS = SECRET_KEYS | {"VFP_CLIENT_ID", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "IMAP_USER", "PEC_USER", "SMTP_USER",
                            "DMS_USER", "SQL_USER"}
# impostazioni che si possono cambiare solo con il codice inviato via email all'amministratore
OTP_KEYS = VAULT_KEYS | {
    "ADMIN_EMAIL", "REPORT_SEND_METHOD", "REPORT_FROM", "REPORT_EMAIL_DOMAINS", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY",
    "VFP_BASE_URL", "VFP_AUTH_URL", "VFP_TOKEN_URL", "VFP_REDIRECT_URI", "VFP_TOKEN_CACHE", "VFP_SCOPE",
    "GRAPH_MAILBOX", "IMAP_HOST", "IMAP_PORT", "PEC_HOST", "PEC_PORT",
    "MAIL_ALLOWED_SENDERS", "MAIL_REQUIRE_AUTH", "MAIL_ANTIVIRUS", "MAIL_ALLOWED_EXT", "MAIL_MAX_MB", "CLAUDE_MODEL",
    "VFP_DOC_URL", "GUI_BIND", "GUI_HOSTNAME", "GUI_TLS_CERT", "GUI_TLS_KEY",
    "MODULI_AI", "DMS_URL", "DMS_TIPO",  # MODULI_AI decide se il contenuto dei documenti puo' andare ad Anthropic
    "SQL_SERVER", "SQL_DATABASE", "SQL_DRIVER", "SQL_AUTH", "SQL_TRUST_CERT", "SQL_VIEW", "SQL_FILE_MODE", "SQL_PATH_ROOT",
}
# campi che, se cambiano, rendono inutilizzabile l'accesso Viewpoint salvato (il token va rifatto)
TOKEN_BINDINGS = ("VFP_AUTH_URL", "VFP_TOKEN_URL", "VFP_BASE_URL", "VFP_CLIENT_ID", "VFP_REDIRECT_URI")
# Viewpoint e Trimble: le credenziali VFP possono andare solo verso questi domini, in https
VFP_HOSTS = ("viewpoint.com", "4projects.com", "trimble.com")
MAIL_SOURCE_NAMES = ("graph", "imap", "pec")

_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_HOST_RE = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")


def _host_allowed(host, domains):
    host = (host or "").lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in domains)


def validate_settings(values, current):
    """
    Controlli prima di scrivere il .env dall'interfaccia. values: nuove impostazioni (password gia' risolte);
    current: impostazioni attuali. Solleva ValueError con un messaggio leggibile.
    """
    from urllib.parse import urlparse

    for k, v in values.items():
        if _CONTROL_RE.search(v):  # un "a capo" aggiungerebbe righe al .env (es. un altro VFP_TOKEN_URL)
            raise ValueError(f"{k}: caratteri non ammessi (a capo o caratteri di controllo)")
        if len(v) > 2000:
            raise ValueError(f"{k}: valore troppo lungo")
    for k in ("VFP_BASE_URL", "VFP_AUTH_URL", "VFP_TOKEN_URL"):
        u = urlparse(values.get(k, current.get(k, "")))
        if u.scheme != "https" or not _host_allowed(u.hostname, VFP_HOSTS) or u.username or u.password:
            raise ValueError(f"{k}: ammessi solo indirizzi https su {', '.join(VFP_HOSTS)}")
    u = urlparse(values.get("VFP_REDIRECT_URI", current.get("VFP_REDIRECT_URI", "")))
    if u.scheme != "http" or u.hostname not in ("localhost", "127.0.0.1") or not u.port:
        raise ValueError("VFP_REDIRECT_URI: deve essere http://localhost:PORTA/... (solo questo PC)")
    for k in ("IMAP_HOST", "PEC_HOST", "SMTP_HOST"):
        if values.get(k) and not _HOST_RE.match(values[k]):
            raise ValueError(f"{k}: nome del server non valido")
    for k in ("IMAP_PORT", "PEC_PORT", "SMTP_PORT", "GUI_PORT", "MAIL_POLL_SECONDS", "MAIL_MAX_ATTEMPTS", "MAIL_MAX_MB"):
        if values.get(k) and not values[k].isdigit():
            raise ValueError(f"{k} deve essere un numero")
    token_cache = values.get("VFP_TOKEN_CACHE", current.get("VFP_TOKEN_CACHE", ""))
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", token_cache) or token_cache.startswith(".."):
        raise ValueError("VFP_TOKEN_CACHE: solo un nome di file nella cartella del programma")
    if values.get("SMTP_SECURITY", "starttls") not in ("starttls", "ssl"):
        raise ValueError("SMTP_SECURITY: starttls oppure ssl")
    if values.get("REPORT_SEND_METHOD", "smtp") not in ("smtp", "graph"):
        raise ValueError("REPORT_SEND_METHOD: smtp oppure graph")
    for k in ("ADMIN_EMAIL", "REPORT_FROM", "GRAPH_MAILBOX"):
        if values.get(k) and not EMAIL_RE.match(values[k]):
            raise ValueError(f"{k}: indirizzo email non valido")
    if values.get("CLAUDE_MODEL") and not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{2,63}", values["CLAUDE_MODEL"]):
        raise ValueError("CLAUDE_MODEL: nome del modello non valido")
    if values.get("MODULI_AI", "conferma") not in ("no", "conferma", "auto"):
        raise ValueError("MODULI_AI: no, conferma oppure auto")
    if values.get("DMS_TIPO", "seeddms") not in ("seeddms",):
        raise ValueError("DMS_TIPO: per ora solo seeddms")
    if values.get("DMS_URL"):
        u = urlparse(values["DMS_URL"])
        if u.username or u.password or not (u.scheme == "https" or (u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost", "::1"))):
            raise ValueError("DMS_URL: serve https (http solo per un DMS di prova su questo PC)")
    for k in ("MODULI_DIR", "MODULI_ARCHIVIO"):
        if k in values and (not re.fullmatch(r"[A-Za-z0-9 _.\-]{1,80}", values[k]) or values[k].startswith("..")):
            raise ValueError(f"{k}: solo il nome di una cartella dentro quella del programma")
    for k in ("MAIL_DONE_FOLDER", "MAIL_ERROR_FOLDER", "MAIL_QUARANTINE_FOLDER"):
        if k in values and not values[k].strip():
            raise ValueError(f"{k}: indicare il nome della cartella")
    if values.get("PEC_PROTOCOL_REGEX"):
        import protocollo  # qui: protocollo importa env_config
        protocollo.compile_rule(values["PEC_PROTOCOL_REGEX"])
    doc_url = values.get("VFP_DOC_URL", "")
    if doc_url:
        u = urlparse(doc_url.replace("{id}", "x"))
        if u.scheme != "https" or not _host_allowed(u.hostname, VFP_HOSTS) or "{id}" not in doc_url:
            raise ValueError(f"VFP_DOC_URL: indirizzo https su {', '.join(VFP_HOSTS)} con {{id}} al posto dell'ID")
    validate_sql(values)
    validate_network(values.get("GUI_BIND", current.get("GUI_BIND", "")), values.get("GUI_HOSTNAME", current.get("GUI_HOSTNAME", "")),
                     values.get("GUI_TLS_CERT", current.get("GUI_TLS_CERT", "")), values.get("GUI_TLS_KEY", current.get("GUI_TLS_KEY", "")))


def validate_sql(values):
    """Archivio SQL: i valori finiscono nella stringa di connessione e nella SELECT, quindi formati chiusi."""
    import sorgente_sql as sq  # qui: sorgente_sql importa env_config

    checks = (("SQL_SERVER", sq._SERVER_RE, "nome del server non valido (es. srv-sql, srv-sql\\ISTANZA, srv-sql,1433)"),
              ("SQL_DATABASE", sq._DATABASE_RE, "nome del database non valido"),
              ("SQL_DRIVER", sq._DRIVER_RE, "nome del driver non valido (es. ODBC Driver 18 for SQL Server)"),
              ("SQL_VIEW", sq._VIEW_RE, "nome della vista non valido (es. dbo.vfp_documenti)"))
    for k, rx, msg in checks:
        if values.get(k) and not rx.match(values[k]):
            raise ValueError(f"{k}: {msg}")
    if values.get("SQL_AUTH", "sql") not in sq.AUTH_MODES:
        raise ValueError(f"SQL_AUTH: {' oppure '.join(sq.AUTH_MODES)}")
    if values.get("SQL_FILE_MODE", "contenuto") not in sq.FILE_COLS:
        raise ValueError("SQL_FILE_MODE: contenuto oppure percorso")


def is_local_bind(bind):
    return (bind or "127.0.0.1") in ("127.0.0.1", "localhost", "::1")


def validate_network(bind, hostname, cert, key):
    """
    Accesso dall'interfaccia da altri PC: solo in HTTPS, con certificato e nome del server. Di serie (bind locale)
    nessun controllo. Solleva ValueError con il motivo.
    """
    import ipaddress

    if is_local_bind(bind):
        return
    try:
        ipaddress.ip_address(bind)
    except ValueError:
        raise ValueError("GUI_BIND: indirizzo IP del PC (es. 0.0.0.0 per tutte le schede di rete) oppure 127.0.0.1")
    if not hostname or not _HOST_RE.match(hostname):
        raise ValueError("GUI_HOSTNAME: nome con cui gli altri PC raggiungono questo (es. vfp.cosedil.local)")
    for k, v in (("GUI_TLS_CERT", cert), ("GUI_TLS_KEY", key)):
        if not v or not resolve_path(v).is_file():
            raise ValueError(f"{k}: per l'accesso dalla rete serve il file del certificato HTTPS (e della sua chiave)")


def _unquote(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        inner = raw[1:-1]
        if raw[0] == '"':
            inner = inner.replace('\\"', '"').replace("\\\\", "\\")
        return inner
    # commento in coda solo se preceduto da spazio: "valore  # nota"
    return re.split(r"\s+#", raw, maxsplit=1)[0].strip()


def _quote(value):
    value = str(value)
    if _CONTROL_RE.search(value):  # difesa ulteriore: nessun valore puo' spezzare la riga
        raise ValueError("valore con caratteri non ammessi (a capo o caratteri di controllo)")
    if value == "" or re.search(r"[\s#\"'\\=]", value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def read_env_file(path=ENV_PATH):
    values = {}
    path = Path(path)
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        m = _LINE_RE.match(line)
        if m and not line.lstrip().startswith("#"):
            values[m.group(1)] = _unquote(m.group(2))
    return values


def write_env_file(updates, path=ENV_PATH):
    """Aggiorna le chiavi indicate mantenendo commenti e ordine delle righe esistenti."""
    path = Path(path)
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    pending = dict(updates)
    out = []
    for line in lines:
        m = _LINE_RE.match(line)
        if m and not line.lstrip().startswith("#") and m.group(1) in pending:
            key = m.group(1)
            out.append(f"{key}={_quote(pending.pop(key))}")
        else:
            out.append(line)
    if pending:
        if out and out[-1].strip():
            out.append("")
        out.extend(f"{k}={_quote(v)}" for k, v in pending.items())
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def save_settings(values, path=ENV_PATH):
    """Credenziali nella cassaforte cifrata, il resto nel .env (dove le credenziali restano vuote)."""
    if not cassaforte.available():
        write_env_file(values, path)
        return
    cassaforte.set_secrets({k: v for k, v in values.items() if k in VAULT_KEYS})
    write_env_file({**{k: v for k, v in values.items() if k not in VAULT_KEYS},
                    **{k: "" for k in VAULT_KEYS if k in values}}, path)


def overridden_by_os():
    """Chiavi impostate come variabili d'ambiente di Windows (hanno la precedenza sul file)."""
    return sorted(k for k in DEFAULTS if os.environ.get(k))


def load_settings(path=ENV_PATH):
    default_env = Path(path).resolve() == ENV_PATH
    if default_env:  # il vecchio config.json si converte solo nel .env predefinito
        migrate_legacy_json(path)
    settings = dict(DEFAULTS)
    file_values = read_env_file(path)
    if default_env and cassaforte.available():
        moved = {k: v for k, v in file_values.items() if k in VAULT_KEYS and v}
        if moved:  # credenziali scritte nel .env (prima versione o a mano): spostate nella cassaforte
            cassaforte.set_secrets(moved)
            write_env_file({k: "" for k in moved}, path)
            file_values.update({k: "" for k in moved})
        settings.update(file_values)
        settings.update({k: v for k, v in cassaforte.secrets().items() if k in DEFAULTS})
    else:
        settings.update(file_values)
    for key in DEFAULTS:
        if os.environ.get(key):
            settings[key] = os.environ[key]
    return settings


def as_bool(value):
    return str(value).strip().lower() in ("1", "true", "si", "sì", "yes", "on")


def resolve_path(value):
    p = Path(value)
    return p if p.is_absolute() else BASE_DIR / p


def vfp_config(s):
    """Converte le impostazioni piatte nel dizionario usato da vfp_transfer (TokenManager, Transfer)."""
    try:
        extra = json.loads(s.get("VFP_DOCUMENT_DEFAULTS") or "{}")
    except ValueError:
        raise ValueError("VFP_DOCUMENT_DEFAULTS nel file .env non e' un JSON valido")
    if not isinstance(extra, dict):
        raise ValueError("VFP_DOCUMENT_DEFAULTS deve essere un oggetto JSON")
    extra["IsNotifyRecipientsByEmail"] = as_bool(s.get("VFP_NOTIFY_EMAIL"))
    return {
        "base_url": s["VFP_BASE_URL"],
        "auth": {
            "authorization_url": s["VFP_AUTH_URL"],
            "token_url": s["VFP_TOKEN_URL"],
            "client_id": s["VFP_CLIENT_ID"],
            "client_secret": s["VFP_CLIENT_SECRET"],
            "redirect_uri": s["VFP_REDIRECT_URI"],
            "scope": s["VFP_SCOPE"],
        },
        "target": {"type": s["VFP_TARGET_TYPE"], "id": s["VFP_TARGET_ID"]},
        "default_revision": s["VFP_DEFAULT_REVISION"] or "1",
        "if_exists": s["VFP_IF_EXISTS"],
        "document_defaults": extra,
        "token_cache": str(resolve_path(s["VFP_TOKEN_CACHE"])),
    }


def vfp_problems(s):
    """Campi ancora da compilare: finche' ce ne sono, il trasferimento reale non parte."""
    problems = []
    if not s.get("VFP_CLIENT_ID"):
        problems.append("Client ID Viewpoint non impostato")
    if not s.get("VFP_TARGET_ID") or set(s["VFP_TARGET_ID"].replace("-", "")) <= {"0"}:
        problems.append("ID della destinazione (progetto o cartella) non impostato")
    return problems


def mail_sources(s):
    return [x.strip().lower() for x in (s.get("MAIL_SOURCES") or "").split(",") if x.strip().lower() in MAIL_SOURCE_NAMES]


MAIL_REQUIRED = {
    "graph": ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_MAILBOX"),
    "imap": ("IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"),
    "pec": ("PEC_HOST", "PEC_USER", "PEC_PASSWORD"),
}


def mail_missing(s, source):
    return [k for k in MAIL_REQUIRED[source] if not s.get(k)]


def mail_problems(s):
    problems = []
    if not as_bool(s.get("MAIL_ENABLED")):
        return problems
    sources = mail_sources(s)
    if not sources:
        problems.append("Nessuna casella email attivata")
    for src in sources:
        missing = mail_missing(s, src)
        if missing:
            problems.append(f"Casella {src.upper()}: mancano {', '.join(missing)}")
    if s.get("VFP_TARGET_TYPE") == "project" and not (s.get("MAIL_VFP_FOLDER") or "").strip("/ "):
        problems.append("Con destinazione 'progetto' serve la cartella VFP per gli allegati email")
    return problems


def mail_warnings(s):
    """Impostazioni ammesse ma poco sicure: mostrate in evidenza nell'interfaccia."""
    if not as_bool(s.get("MAIL_ENABLED")):
        return []
    warnings = []
    if not (s.get("MAIL_ALLOWED_SENDERS") or "").strip():
        warnings.append("nessun elenco di mittenti autorizzati: chiunque puo' far entrare documenti in Viewpoint")
    if not as_bool(s.get("MAIL_ANTIVIRUS")):
        warnings.append("controllo antivirus degli allegati disattivato")
    if not as_bool(s.get("MAIL_REQUIRE_AUTH")):
        warnings.append("controllo SPF/DKIM/DMARC del mittente disattivato")
    return warnings


def migrate_legacy_json(path=ENV_PATH):
    """Se esiste solo il vecchio config.json, lo converte in .env (il json resta come copia)."""
    path = Path(path)
    if path.exists() or not LEGACY_JSON_PATH.exists():
        return False
    cfg = json.loads(LEGACY_JSON_PATH.read_text(encoding="utf-8"))
    auth = cfg.get("auth", {})
    extra = dict(cfg.get("document_defaults", {}))
    notify = extra.pop("IsNotifyRecipientsByEmail", False)
    client_id = auth.get("client_id", "")
    target_id = cfg.get("target", {}).get("id", "")
    values = {
        "VFP_BASE_URL": cfg.get("base_url", DEFAULTS["VFP_BASE_URL"]),
        "VFP_AUTH_URL": auth.get("authorization_url", DEFAULTS["VFP_AUTH_URL"]),
        "VFP_TOKEN_URL": auth.get("token_url", DEFAULTS["VFP_TOKEN_URL"]),
        "VFP_CLIENT_ID": "" if client_id.startswith("INSERISCI") else client_id,
        "VFP_CLIENT_SECRET": auth.get("client_secret", ""),
        "VFP_REDIRECT_URI": auth.get("redirect_uri", DEFAULTS["VFP_REDIRECT_URI"]),
        "VFP_SCOPE": auth.get("scope", DEFAULTS["VFP_SCOPE"]),
        "VFP_TARGET_TYPE": cfg.get("target", {}).get("type", "project"),
        "VFP_TARGET_ID": "" if set(target_id.replace("-", "")) <= {"0"} else target_id,
        "VFP_DEFAULT_REVISION": cfg.get("default_revision", "1"),
        "VFP_IF_EXISTS": cfg.get("if_exists", "new_revision"),
        "VFP_NOTIFY_EMAIL": "true" if notify else "false",
        "VFP_DOCUMENT_DEFAULTS": json.dumps(extra),
        "VFP_TOKEN_CACHE": cfg.get("token_cache", DEFAULTS["VFP_TOKEN_CACHE"]),
    }
    example = BASE_DIR / ".env.example"
    if example.exists():
        path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    write_env_file(values, path)
    return True
