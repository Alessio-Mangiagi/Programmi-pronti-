# "><(((º> sabusabu <º)))><"
"""
Posta in arrivo -> Viewpoint For Projects.

Controlla di continuo le caselle attivate nel .env (MAIL_SOURCES):
  graph  Microsoft 365 / Outlook, tramite Microsoft Graph (app Azure con permesso Mail.ReadWrite)
  imap   qualsiasi casella IMAP (Aruba, Gmail con password per app, ...)
  pec    casella PEC via IMAP: i documenti veri sono dentro l'allegato postacert.eml

Per ogni email con allegati:
  1. salva gli allegati in MAIL_ARCHIVE_DIR (copia locale);
  2. li carica in VFP nella cartella MAIL_VFP_FOLDER, con la stessa logica di vfp_transfer
     (stato di ripresa e report condivisi con i trasferimenti manuali);
  3. sposta l'email in MAIL_DONE_FOLDER; se fallisce MAIL_MAX_ATTEMPTS volte, in MAIL_ERROR_FOLDER.
Le email senza allegati utili restano dove sono e non vengono piu' riesaminate.

Sicurezza: prima di caricare qualcosa ogni email viene controllata. Finisce in MAIL_QUARANTINE_FOLDER, senza
nessun caricamento, se: supera MAIL_MAX_MB; ha un allegato pericoloso (eseguibili, script, macro: BLOCKED_EXT);
il mittente non e' in MAIL_ALLOWED_SENDERS (se compilato); il server di posta ha segnato il mittente come
falsificato (SPF/DKIM/DMARC, con MAIL_REQUIRE_AUTH); l'antivirus (Windows Defender, MAIL_ANTIVIRUS) trova
una minaccia. Gli allegati con estensioni non in MAIL_ALLOWED_EXT vengono scartati.
Le connessioni IMAP verificano sempre il certificato del server.

Il controllo gira in un thread che non termina mai: ogni errore viene registrato e si riprova al giro dopo.
Avviato da vfp_gui.py; da solo: python vfp_mail.py (senza interfaccia).
"""

import csv
import email
import email.utils
import hashlib
import imaplib
import json
import logging
import os
import re
import shutil
import ssl
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from email import policy
from pathlib import Path
from urllib.parse import quote

import requests

import env_config
import pec
import protocollo
import vfp_transfer as vt

log = logging.getLogger("vfp_mail")

MAX_PER_CYCLE = 20  # email elaborate per casella a ogni giro (le altre al giro dopo)
HISTORY_LEN = 300
IGNORED_LEN = 5000
PEC_SERVICE_FILES = {"daticert.xml", "smime.p7s", "postacert.eml"}

# registro permanente di tutte le email viste (anche senza allegati), base del report Excel.
# Le colonne nuove si aggiungono in fondo: il file esistente viene riscritto con la nuova intestazione.
MAIL_LOG_FIELDS = ["data", "casella", "tipo_casella", "indirizzo_casella", "mittente", "oggetto", "ricevuta",
                   "allegati", "esito", "dettaglio", "chiave", "message_id", "chiave_casella", "documenti",
                   "pec_tipo", "pec_id", "pec_gestore", "pec_firma", "pec_destinatari"]
OUTCOME_LABELS = {"trasferita": "Trasferita", "riprovo": "In nuovo tentativo", "errore": "Errore",
                  "bloccata": "Bloccata (sicurezza)", "ignorata": "Ignorata (senza allegati)",
                  "ricevuta": "Ricevuta PEC", "rimessa": "Rimessa in coda"}


def read_mail_log(path, settings=None):
    """Righe del registro posta, dalla piu' vecchia alla piu' recente (con il protocollo delle PEC)."""
    path = Path(path)
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        rows = [{k: vt.csv_plain(v) for k, v in r.items() if k} for r in csv.DictReader(f, delimiter=";")]
    rule = (settings or env_config.load_settings()).get("PEC_PROTOCOL_REGEX", "")
    overrides = protocollo.load_overrides()
    for r in rows:
        subject = r.get("oggetto")
        if r.get("esito") == "ricevuta":
            subject = pec.clean_receipt_subject(subject)
        r["protocollo"], r["protocollo_origine"] = protocollo.resolve(
            r.get("tipo_casella"), subject, r.get("ricevuta") or r.get("data"), r.get("chiave"), rule, overrides)
    return rows


def group_mail_log(rows):
    """Una riga per email (l'ultimo tentativo), con il numero di tentativi; la piu' recente per prima."""
    groups = {}
    for r in rows:
        key = r.get("chiave") or f"{r.get('casella')}|{r.get('mittente')}|{r.get('oggetto')}|{r.get('ricevuta')}"
        g = groups.get(key)
        attempts = (g["tentativi"] if g else 0) + (1 if r.get("esito") != "ignorata" else 0)
        groups[key] = {**r, "chiave": key, "tentativi": attempts, "prima_elaborazione": g["prima_elaborazione"] if g else r.get("data")}
    return sorted(groups.values(), key=lambda r: r.get("data") or "", reverse=True)


if "MOVE" not in imaplib.Commands:  # Python vecchi non conoscono il comando MOVE (RFC 6851)
    imaplib.Commands["MOVE"] = ("SELECTED",)


@dataclass
class Attachment:
    name: str
    data: bytes


@dataclass
class MailMessage:
    ref: str  # identificativo stabile nella casella (UIDVALIDITY:UID per IMAP, id per Graph)
    raw_id: str  # UID IMAP o id Graph, usato per spostare il messaggio
    sender: str
    subject: str
    received: datetime
    attachments: list
    blocked: str = ""  # motivo per cui l'email va in quarantena invece che in VFP
    rejected: list = field(default_factory=list)  # allegati scartati: [(nome, motivo)]
    msg_id: str = ""  # intestazione Message-ID: serve a ritrovare l'email per "Riprova adesso"
    pec: dict = field(default_factory=dict)  # dati della busta PEC (pec.summary), vuoto per le altre caselle


# --------------------------------------------------------------------------- utilita'

_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10))}


def _classify(name, allowed_ext):
    """'' se l'allegato si puo' caricare, altrimenti il motivo dello scarto ('pericoloso' blocca l'email)."""
    ext = Path(name).suffix.lower().lstrip(".")
    if ext in env_config.BLOCKED_EXT:
        return "pericoloso"
    if ext not in allowed_ext:
        return "estensione non ammessa"
    return ""


def _safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    if Path(name).stem.split(".")[0].lower() in _RESERVED:  # CON, NUL, COM1...: nomi riservati di Windows
        name = "_" + name
    return name[:150] or "allegato"


def _allowed_senders(s):
    return [x.strip().lower() for x in re.split(r"[,;\s]+", s.get("MAIL_ALLOWED_SENDERS") or "") if x.strip()]


def sender_allowed(sender, s):
    """MAIL_ALLOWED_SENDERS: indirizzi completi o domini (@azienda.it o azienda.it, sottodomini compresi)."""
    rules = _allowed_senders(s)
    if not rules:
        return True
    sender = (sender or "").lower()
    domain = sender.rsplit("@", 1)[-1] if "@" in sender else ""
    for r in rules:
        if "@" in r and not r.startswith("@"):
            if sender == r:
                return True
        else:
            d = r.lstrip("@")
            if domain == d or domain.endswith("." + d):
                return True
    return False


def auth_failed(auth_results):
    """
    Esito SPF/DKIM/DMARC scritto dal server che ha ricevuto l'email (primo header Authentication-Results:
    quelli piu' in basso possono essere stati aggiunti dal mittente). '' se va bene o non e' valutabile.
    """
    h = (auth_results or "").lower()
    if not h or "dmarc=pass" in h:
        return ""
    for check in ("dmarc=fail", "compauth=fail", "spf=fail"):
        if check in h:
            return check
    return ""


def screen(message, auth_results, size, s, pec):
    """Motivo per mettere l'email in quarantena, oppure ''."""
    max_mb = _max_mb(s)
    if size and size > max_mb * 1024 * 1024:
        return f"email di {size / 1048576:.1f} MB, oltre il limite di {max_mb} MB"
    dangerous = [n for n, why in message.rejected if why == "pericoloso"]
    if dangerous:
        return "allegato pericoloso: " + ", ".join(dangerous[:5])
    if not sender_allowed(message.sender, s):
        return f"mittente non autorizzato: {message.sender or 'sconosciuto'}"
    if not pec and env_config.as_bool(s.get("MAIL_REQUIRE_AUTH")):
        failed = auth_failed(auth_results)
        if failed:
            return f"mittente non verificato dal server di posta ({failed}): possibile falsificazione"
    return ""


def _max_mb(s):
    try:
        return max(1, int(s.get("MAIL_MAX_MB") or 50))
    except ValueError:
        return 50


# --------------------------------------------------------------------------- antivirus

class AntivirusUnavailable(RuntimeError):
    pass


def _defender_path():
    candidates = sorted(Path(os.environ.get("ProgramData", r"C:\ProgramData"), "Microsoft", "Windows Defender",
                             "Platform").glob("*/MpCmdRun.exe"))
    if candidates:
        return candidates[-1]  # versione piu' recente della piattaforma
    p = Path(os.environ.get("ProgramFiles", r"C:\Program Files"), "Windows Defender", "MpCmdRun.exe")
    return p if p.exists() else None


def scan_folder(folder):
    """'' se pulita, altrimenti il dettaglio della minaccia. Solleva AntivirusUnavailable se non si puo' controllare."""
    exe = _defender_path()
    if not exe:
        raise AntivirusUnavailable("Windows Defender non trovato: installarlo o disattivare MAIL_ANTIVIRUS "
                                   "se il PC usa un altro antivirus che controlla la cartella degli allegati")
    try:
        r = subprocess.run([str(exe), "-Scan", "-ScanType", "3", "-File", str(folder), "-DisableRemediation"],
                           capture_output=True, text=True, timeout=900,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise AntivirusUnavailable(f"controllo antivirus non riuscito: {e}")
    if r.returncode == 0:
        return ""
    if r.returncode == 2:
        lines = [l.strip() for l in (r.stdout or "").splitlines() if "Threat" in l or "threat" in l]
        return "minaccia rilevata dall'antivirus" + (f": {lines[0][:200]}" if lines else "")
    raise AntivirusUnavailable(f"controllo antivirus non riuscito (codice {r.returncode})")


def _local_naive(dt):
    return dt.astimezone().replace(tzinfo=None) if dt.tzinfo else dt


def _filters(s):
    raw = s.get("MAIL_ALLOWED_EXT") or env_config.DEFAULT_ALLOWED_EXT  # vuoto = elenco predefinito, mai "tutte"
    allowed = {x.strip().lower().lstrip(".") for x in raw.split(",") if x.strip()} - env_config.BLOCKED_EXT
    if not allowed:  # es. elenco con sole estensioni bloccate: si torna a quello predefinito
        allowed = set(env_config.DEFAULT_ALLOWED_EXT.split(","))
    return allowed, env_config.as_bool(s.get("MAIL_SKIP_INLINE"))


def pec_envelope(msg):
    """Il messaggio originale dentro la busta PEC (postacert.eml), oppure None per le ricevute."""
    for part in msg.walk():
        if (part.get_filename() or "").lower() != "postacert.eml":
            continue
        if part.get_content_type() == "message/rfc822":
            return part.get_payload(0)
        payload = part.get_payload(decode=True)
        return email.message_from_bytes(payload, policy=policy.default) if payload else None
    return None


def extract_attachments(msg, pec, skip_inline, allowed_ext, rejected=None):
    """
    Allegati utili di un messaggio MIME. Per la PEC si apre prima la busta (postacert.eml).
    Gli allegati scartati per estensione finiscono in rejected come (nome, motivo).
    """
    if pec:
        msg = pec_envelope(msg)
        if msg is None:
            return []  # ricevuta di accettazione/consegna: nessun documento da trasferire
    rejected = [] if rejected is None else rejected
    out, used = [], set()
    for part in msg.walk():
        if part.is_multipart():
            continue
        name = part.get_filename()
        if not name or name.lower() in PEC_SERVICE_FILES:
            continue
        if skip_inline and part.get_content_disposition() == "inline" and part.get_content_maintype() == "image":
            continue  # loghi e immagini della firma
        why = _classify(_safe_name(name), allowed_ext)
        if why:
            rejected.append((_safe_name(name), why))
            continue
        data = part.get_payload(decode=True)
        if not data:
            continue
        out.append(Attachment(_unique(_safe_name(name), used), data))
    return out


def _unique(name, used):
    stem, suffix, n, candidate = Path(name).stem, Path(name).suffix, 1, name
    while candidate.casefold() in used:
        n += 1
        candidate = f"{stem} ({n}){suffix}"
    used.add(candidate.casefold())
    return candidate


# --------------------------------------------------------------------------- IMAP e PEC

def _imap_quote(name):
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


class ImapMailbox:
    def __init__(self, kind, host, port, user, password, folder):
        self.kind, self.pec = kind, kind == "pec"
        self.address = user
        self.host, self.port, self.user, self.password = host, int(port or 993), user, password
        self.folder = folder or "INBOX"
        self.key = f"{kind}:{user}@{host}"
        self.label = f"{'PEC' if self.pec else 'IMAP'} {user}"
        self.conn = None
        self.uidvalidity = "0"

    def __enter__(self):
        # contesto esplicito: di serie imaplib non verifica il certificato (password esposte a un intermediario)
        self.conn = imaplib.IMAP4_SSL(self.host, self.port, ssl_context=ssl.create_default_context(), timeout=60)
        self.conn.login(self.user, self.password)
        typ, data = self.conn.select(_imap_quote(self.folder))
        if typ != "OK":
            raise RuntimeError(f"cartella '{self.folder}' non trovata nella casella")
        _, uv = self.conn.response("UIDVALIDITY")
        if uv and uv[0]:
            self.uidvalidity = uv[0].decode() if isinstance(uv[0], bytes) else str(uv[0])
        return self

    def __exit__(self, *exc):
        try:
            self.conn.logout()
        except Exception:
            pass

    def count(self):
        typ, data = self.conn.uid("SEARCH", None, "ALL")
        return len(data[0].split()) if typ == "OK" and data and data[0] else 0

    def list_messages(self, ignored, limit, s):
        allowed, skip_inline = _filters(s)
        typ, data = self.conn.uid("SEARCH", None, "ALL")
        uids = data[0].split() if typ == "OK" and data and data[0] else []
        done = 0
        for uid in uids:
            uid = uid.decode()
            ref = f"{self.uidvalidity}:{uid}"
            if ref in ignored:
                continue
            typ, d = self.conn.uid("FETCH", uid, "(RFC822.SIZE)")
            m = re.search(rb"RFC822\.SIZE (\d+)", b" ".join(x if isinstance(x, bytes) else x[0] for x in d or [] if x))
            size = int(m.group(1)) if m else 0
            # le email troppo grandi non si scaricano: bastano le intestazioni per registrarle
            part = "BODY.PEEK[HEADER]" if size > _max_mb(s) * 1024 * 1024 else "BODY.PEEK[]"  # PEEK: non segna come letto
            typ, d = self.conn.uid("FETCH", uid, f"({part})")
            raw = next((x[1] for x in d or [] if isinstance(x, tuple)), None)
            if typ != "OK" or raw is None:
                continue
            msg = email.message_from_bytes(raw, policy=policy.default)
            try:
                received = _local_naive(email.utils.parsedate_to_datetime(msg["Date"]))
            except (TypeError, ValueError):
                received = datetime.now()
            sender = email.utils.parseaddr(str(msg["From"] or ""))[1]
            if self.pec:  # il mittente vero e' nella busta, non "posta-certificata@gestore"
                inner = pec_envelope(msg) if part == "BODY.PEEK[]" else None
                sender = email.utils.parseaddr(str((inner or {}).get("From") or msg.get("Reply-To") or msg["From"] or ""))[1]
            message = MailMessage(ref=ref, raw_id=uid, sender=sender, subject=str(msg["Subject"] or ""),
                                  received=received, attachments=[], msg_id=str(msg["Message-ID"] or "").strip())
            info = {}
            if part == "BODY.PEEK[]":
                message.attachments = extract_attachments(msg, self.pec, skip_inline, allowed, message.rejected)
                if self.pec:
                    info = pec.analyze(raw, msg)
                    message.pec = pec.summary(info)
            message.blocked = screen(message, str(msg.get("Authentication-Results") or ""), size, s, self.pec)
            if not message.blocked and info.get("firma", {}).get("stato") == "non valida":
                message.blocked = f"firma del gestore PEC non valida: {info['firma']['dettaglio']}"
            if message.blocked:
                message.attachments = [Attachment(a.name, b"") for a in message.attachments]  # solo i nomi, per il registro
            yield message
            done += 1
            if done >= limit:
                return

    def move(self, message, folder):
        target = _imap_quote(folder)
        self.conn.create(target)  # se esiste gia' il server risponde NO: va bene
        if "MOVE" in self.conn.capabilities:
            typ, _ = self.conn.uid("MOVE", message.raw_id, target)
            if typ == "OK":
                return
        typ, _ = self.conn.uid("COPY", message.raw_id, target)
        if typ != "OK":
            raise RuntimeError(f"impossibile spostare il messaggio nella cartella '{folder}'")
        self.conn.uid("STORE", message.raw_id, "+FLAGS", r"(\Deleted)")
        if "UIDPLUS" in self.conn.capabilities:
            self.conn.uid("EXPUNGE", message.raw_id)  # elimina solo questo messaggio
        else:
            self.conn.expunge()

    def restore(self, msg_id, from_folder):
        """Rimette nella cartella controllata un'email spostata in from_folder ("Riprova adesso")."""
        typ, _ = self.conn.select(_imap_quote(from_folder))
        if typ != "OK":
            raise RuntimeError(f"cartella '{from_folder}' non trovata nella casella")
        try:
            typ, data = self.conn.uid("SEARCH", None, "HEADER", "Message-ID", _imap_quote(msg_id))
            uids = data[0].split() if typ == "OK" and data and data[0] else []
            if not uids:
                raise RuntimeError(f"email non trovata nella cartella '{from_folder}': forse e' gia' stata spostata")
            message = MailMessage(ref="", raw_id=uids[-1].decode(), sender="", subject="", received=datetime.now(),
                                  attachments=[])
            self.move(message, self.folder)
        finally:
            self.conn.select(_imap_quote(self.folder))


# --------------------------------------------------------------------------- Microsoft 365

def _graph_error(resp):
    try:
        err = resp.json().get("error", {})
        if isinstance(err, dict):
            return f"{err.get('code', '')} {err.get('message', '')}".strip()
        return f"{err} {resp.json().get('error_description', '')}".strip()
    except ValueError:
        return resp.text[:300]


class GraphMailbox:
    BASE = "https://graph.microsoft.com/v1.0"

    def __init__(self, tenant, client_id, secret, mailbox, folder):
        self.tenant, self.client_id, self.secret = tenant, client_id, secret
        self.mailbox, self.folder = mailbox, folder or "inbox"
        self.kind = "graph"
        self.address = mailbox
        self.key = f"graph:{mailbox}"
        self.label = f"Microsoft 365 {mailbox}"
        self.session = requests.Session()
        self._token, self._exp, self._folders = None, 0, {}

    def __enter__(self):
        self._auth()
        return self

    def __exit__(self, *exc):
        self.session.close()

    def _auth(self):
        if self._token and self._exp > time.time() + 60:
            return self._token
        r = requests.post(
            f"https://login.microsoftonline.com/{quote(self.tenant)}/oauth2/v2.0/token",
            data={"grant_type": "client_credentials", "client_id": self.client_id,
                  "client_secret": self.secret, "scope": "https://graph.microsoft.com/.default"},
            timeout=60,
        )
        if not r.ok:
            raise RuntimeError(f"accesso a Microsoft 365 non riuscito: {_graph_error(r)}")
        body = r.json()
        self._token, self._exp = body["access_token"], time.time() + int(body.get("expires_in", 3600))
        return self._token

    def _req(self, method, path, **kwargs):
        url = self.BASE + path
        for attempt in range(4):
            r = self.session.request(method, url, headers={"Authorization": f"Bearer {self._auth()}"}, timeout=120, **kwargs)
            if r.status_code in (429, 503, 504):
                try:
                    wait = int(r.headers.get("Retry-After", ""))
                except ValueError:
                    wait = 2 ** attempt
                time.sleep(min(wait, 60))
                continue
            if not r.ok:
                raise RuntimeError(f"Microsoft 365 {method} -> {r.status_code}: {_graph_error(r)}")
            return r
        raise RuntimeError(f"Microsoft 365 {method}: troppe richieste, riprovo al prossimo giro")

    @property
    def _mbx(self):
        return f"/users/{quote(self.mailbox, safe='@')}"

    def count(self):
        data = self._req("GET", f"{self._mbx}/mailFolders/{quote(self.folder)}").json()
        return data.get("totalItemCount", 0)

    def list_messages(self, ignored, limit, s):
        allowed, skip_inline = _filters(s)
        data = self._req("GET", f"{self._mbx}/mailFolders/{quote(self.folder)}/messages", params={
            "$filter": "hasAttachments eq true", "$top": "50",
            "$select": "id,subject,from,receivedDateTime,internetMessageId",
        }).json()
        done = 0
        for m in sorted(data.get("value", []), key=lambda m: m.get("receivedDateTime", "")):
            if m["id"] in ignored:
                continue
            try:
                received = _local_naive(datetime.fromisoformat(m["receivedDateTime"].replace("Z", "+00:00")))
            except (KeyError, ValueError):
                received = datetime.now()
            message = MailMessage(
                ref=m["id"], raw_id=m["id"],
                sender=((m.get("from") or {}).get("emailAddress") or {}).get("address", ""),
                subject=m.get("subject") or "",
                received=received, attachments=[], msg_id=m.get("internetMessageId") or "",
            )
            meta = self._attachment_list(m["id"], allowed, skip_inline, message.rejected)
            auth = ""
            if env_config.as_bool(s.get("MAIL_REQUIRE_AUTH")):
                hdrs = self._req("GET", f"{self._mbx}/messages/{m['id']}",
                                 params={"$select": "internetMessageHeaders"}).json().get("internetMessageHeaders") or []
                auth = next((h.get("value", "") for h in hdrs if (h.get("name") or "").lower() == "authentication-results"), "")
            message.blocked = screen(message, auth, sum(a.get("size") or 0 for a in meta), s, False)
            used = set()
            for a in meta:
                name = _unique(_safe_name(a.get("name") or "allegato"), used)
                data = b"" if message.blocked else self._req(
                    "GET", f"{self._mbx}/messages/{m['id']}/attachments/{a['id']}/$value").content
                message.attachments.append(Attachment(name, data))
            yield message
            done += 1
            if done >= limit:
                return

    def _attachment_list(self, mid, allowed, skip_inline, rejected):
        """Allegati da caricare (solo dati descrittivi: il contenuto si scarica dopo i controlli)."""
        data = self._req("GET", f"{self._mbx}/messages/{mid}/attachments",
                         params={"$select": "id,name,contentType,size,isInline"}).json()
        out = []
        for a in data.get("value", []):
            name = _safe_name(a.get("name") or "allegato")
            if a.get("@odata.type") != "#microsoft.graph.fileAttachment":
                if a.get("@odata.type") == "#microsoft.graph.referenceAttachment":
                    rejected.append((name, "collegamento a file esterno"))
                continue  # email o elementi di calendario allegati
            if skip_inline and a.get("isInline") and (a.get("contentType") or "").startswith("image/"):
                continue
            why = _classify(name, allowed)
            if why:
                rejected.append((name, why))
                continue
            out.append(a)
        return out

    def _folder_id(self, name):
        if name not in self._folders:
            escaped = name.replace("'", "''")
            data = self._req("GET", f"{self._mbx}/mailFolders", params={"$filter": f"displayName eq '{escaped}'"}).json()
            if data.get("value"):
                self._folders[name] = data["value"][0]["id"]
            else:
                self._folders[name] = self._req("POST", f"{self._mbx}/mailFolders", json={"displayName": name}).json()["id"]
        return self._folders[name]

    def move(self, message, folder):
        self._req("POST", f"{self._mbx}/messages/{message.raw_id}/move", json={"destinationId": self._folder_id(folder)})

    def restore(self, msg_id, from_folder):
        """Rimette nella cartella controllata un'email spostata in from_folder ("Riprova adesso")."""
        escaped = msg_id.replace("'", "''")
        data = self._req("GET", f"{self._mbx}/mailFolders/{self._folder_id(from_folder)}/messages",
                         params={"$filter": f"internetMessageId eq '{escaped}'", "$select": "id"}).json()
        if not data.get("value"):
            raise RuntimeError(f"email non trovata nella cartella '{from_folder}': forse e' gia' stata spostata")
        self._req("POST", f"{self._mbx}/messages/{data['value'][0]['id']}/move", json={"destinationId": self.folder})


def make_mailbox(kind, s):
    if kind == "graph":
        return GraphMailbox(s["GRAPH_TENANT_ID"], s["GRAPH_CLIENT_ID"], s["GRAPH_CLIENT_SECRET"], s["GRAPH_MAILBOX"], s["GRAPH_FOLDER"])
    p = "PEC" if kind == "pec" else "IMAP"
    return ImapMailbox(kind, s[f"{p}_HOST"], s[f"{p}_PORT"], s[f"{p}_USER"], s[f"{p}_PASSWORD"], s[f"{p}_FOLDER"])


def test_mailbox(kind, s):
    """Prova di connessione dall'interfaccia: restituisce un messaggio leggibile."""
    missing = env_config.mail_missing(s, kind)
    if missing:
        raise ValueError(f"campi da compilare: {', '.join(missing)}")
    mbx = make_mailbox(kind, s)
    with mbx:
        n = mbx.count()
    return f"Connessione riuscita a {mbx.label}: {n} messaggi nella cartella."


# --------------------------------------------------------------------------- controllo continuo

class _NoBrowser:
    """Il servizio automatico non deve mai aprire il browser per il login Viewpoint."""

    def __init__(self, tokens):
        self.tokens = tokens

    def get(self):
        return self.tokens.get(interactive=False)

    def invalidate(self):
        self.tokens.invalidate()


class MailWatcher(threading.Thread):
    def __init__(self, tokens_for, transfer_lock, state_path, report_path, mail_state_path, mail_log_path=None):
        super().__init__(name="controllo-posta", daemon=True)
        self.tokens_for = tokens_for  # funzione cfg -> TokenManager condiviso
        self.transfer_lock = transfer_lock  # condiviso con i trasferimenti manuali
        self.state_path = Path(state_path)
        self.report_path = Path(report_path)
        self.mail_state_path = Path(mail_state_path)
        self.mail_log_path = Path(mail_log_path) if mail_log_path else self.mail_state_path.with_name("registro_posta.csv")
        self.log_lock = threading.Lock()
        self.wake = threading.Event()
        self._seed_mail_log()
        self.lock = threading.Lock()
        self.status = {"enabled": False, "busy": False, "last_cycle": None, "next_cycle": None,
                       "login_needed": "", "problems": [], "sources": {}, "current": None, "heartbeat": time.time()}
        self.retries = {}  # chiave email -> utente che ha chiesto "Riprova adesso"

    # ---- registro permanente delle email

    def _seed_mail_log(self):
        """Primo avvio con il registro: vi copia la cronologia gia' presente nello stato."""
        if self.mail_log_path.exists():
            return
        for h in self.load_state()["history"]:
            source = h.get("source", "")
            self._append_log({
                "data": h.get("time", ""), "casella": source, "tipo_casella": h.get("kind", ""),
                "indirizzo_casella": source.split(" ")[-1] if source else "", "mittente": h.get("sender", ""),
                "oggetto": h.get("subject", ""), "ricevuta": h.get("received", ""),
                "allegati": " | ".join(h.get("files", [])), "esito": h.get("outcome", ""),
                "dettaglio": h.get("detail", ""), "chiave": h.get("key", ""),
            })

    def _append_log(self, row):
        with self.log_lock:
            self._upgrade_log()
            new = not self.mail_log_path.exists()
            with open(self.mail_log_path, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=MAIL_LOG_FIELDS, delimiter=";", extrasaction="ignore")
                if new:
                    w.writeheader()
                w.writerow({k: vt.csv_cell(v) for k, v in row.items()})

    def _upgrade_log(self):
        """Registro scritto da una versione precedente (meno colonne): riscritto con l'intestazione nuova."""
        if not self.mail_log_path.exists():
            return
        with open(self.mail_log_path, newline="", encoding="utf-8") as f:
            header = next(csv.reader(f, delimiter=";"), [])
        if header == MAIL_LOG_FIELDS:
            return
        with open(self.mail_log_path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f, delimiter=";"))
        tmp = self.mail_log_path.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=MAIL_LOG_FIELDS, delimiter=";", extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow({k: v for k, v in r.items() if k})  # valori gia' resi sicuri quando sono stati scritti
        tmp.replace(self.mail_log_path)
        log.info("Registro della posta aggiornato con le nuove colonne")

    def _log_message(self, mbx, message, outcome, detail, key, docs=()):
        p = message.pec or {}
        self._append_log({
            "data": datetime.now().isoformat(timespec="seconds"), "casella": mbx.label, "tipo_casella": mbx.kind,
            "indirizzo_casella": mbx.address, "mittente": message.sender, "oggetto": message.subject,
            "ricevuta": message.received.isoformat(timespec="minutes"),
            "allegati": " | ".join(a.name for a in message.attachments), "esito": outcome,
            "dettaglio": detail[:500], "chiave": key, "message_id": message.msg_id[:300], "chiave_casella": mbx.key,
            "documenti": " | ".join(f"{d['name']}={d['doc_id']}" for d in docs if d.get("doc_id")),
            "pec_tipo": p.get("tipo", ""), "pec_id": p.get("identificativo", ""), "pec_gestore": p.get("gestore", ""),
            "pec_firma": p.get("firma", ""), "pec_destinatari": ", ".join(p.get("destinatari") or []),
        })

    def _entry(self, mbx, message, digest, outcome, detail, files=None, docs=()):
        """Elemento della cronologia (Flusso posta, Caselle email)."""
        return {
            "time": datetime.now().isoformat(timespec="seconds"), "key": digest, "kind": mbx.kind, "source": mbx.label,
            "mbx": mbx.key, "msg_id": message.msg_id[:300], "sender": message.sender, "subject": message.subject,
            "received": message.received.isoformat(timespec="minutes"),
            "files": [a.name for a in message.attachments] if files is None else files,
            "outcome": outcome, "detail": detail[:500], "docs": list(docs), "pec": message.pec or {},
        }

    # ---- stato su disco (email ignorate, tentativi, cronologia)

    def load_state(self):
        try:
            st = json.loads(self.mail_state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            st = {}
        st.setdefault("ignored", {})
        st.setdefault("attempts", {})
        st.setdefault("history", [])
        return st

    def _save_state(self, st):
        st["history"] = st["history"][-HISTORY_LEN:]
        tmp = self.mail_state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.mail_state_path)

    def snapshot(self):
        with self.lock:
            snap = json.loads(json.dumps(self.status))
        snap["history"] = list(reversed(self.load_state()["history"][-100:]))
        rule = env_config.load_settings().get("PEC_PROTOCOL_REGEX", "")
        overrides = protocollo.load_overrides()
        for h in snap["history"] + ([snap["current"]] if snap.get("current") else []):
            h["protocol"], h["protocol_source"] = protocollo.resolve(
                h.get("kind"), h.get("subject"), h.get("received") or h.get("time"), h.get("key"), rule, overrides)
        return snap

    def trigger(self):
        self.wake.set()

    def request_retry(self, key, user):
        """
        "Riprova adesso" dall'interfaccia. Per un'email in attesa di nuovo tentativo basta controllare subito;
        un'email in errore viene rimessa nella cartella controllata dal thread della posta (l'unico che scrive
        lo stato), al giro di controllo che parte subito.
        """
        st = self.load_state()
        h = next((x for x in reversed(st["history"]) if x.get("key") == key), None)
        if not h:
            raise ValueError("Email non trovata nella cronologia recente")
        if h.get("outcome") == "riprovo":
            self.trigger()
            return "Controllo della posta avviato: l'email viene ritentata subito"
        if h.get("outcome") != "errore":
            raise ValueError("Si possono ritentare solo le email in errore o in attesa di un nuovo tentativo")
        if not h.get("msg_id") or not h.get("mbx"):
            raise ValueError("Email elaborata da una versione precedente del programma: spostarla a mano dalla "
                             "cartella degli errori alla cartella controllata")
        with self.lock:
            self.retries[key] = user
        self.trigger()
        return "Email rimessa in coda: viene ricaricata al giro di controllo che parte adesso"

    def _do_retries(self, s, st):
        with self.lock:
            pending, self.retries = self.retries, {}
        for key, user in pending.items():
            h = next((x for x in reversed(st["history"]) if x.get("key") == key), None)
            if not h:
                continue
            entry = {**h, "time": datetime.now().isoformat(timespec="seconds")}
            try:
                if h.get("kind") not in env_config.mail_sources(s):
                    raise RuntimeError("la casella non e' piu' attiva")
                mbx = make_mailbox(h["kind"], s)
                if mbx.key != h.get("mbx"):
                    raise RuntimeError("la casella e' cambiata nelle impostazioni")
                with mbx:
                    mbx.restore(h["msg_id"], s["MAIL_ERROR_FOLDER"])
                entry.update(outcome="rimessa", detail=f"rimessa in coda da {user}: viene ricaricata come nuova email")
                log.warning("Email da %s rimessa in coda da %s", h.get("sender"), user)
            except Exception as e:
                entry.update(outcome="errore", detail=f"Riprova non riuscita: {e}"[:500])
                log.error("Riprova dell'email da %s non riuscita: %s", h.get("sender"), e)
            st["history"].append(entry)
            self._save_state(st)
            self._append_log({"data": entry["time"], "casella": h.get("source", ""), "tipo_casella": h.get("kind", ""),
                              "mittente": h.get("sender", ""), "oggetto": h.get("subject", ""),
                              "ricevuta": h.get("received", ""), "allegati": " | ".join(h.get("files", [])),
                              "esito": entry["outcome"], "dettaglio": entry["detail"], "chiave": key,
                              "message_id": h.get("msg_id", ""), "chiave_casella": h.get("mbx", "")})

    # ---- ciclo principale

    def run(self):
        log.info("Controllo posta avviato")
        while True:  # non termina mai: ogni errore viene registrato e si riprova
            wait = 15
            try:
                s = env_config.load_settings()
                enabled = env_config.as_bool(s.get("MAIL_ENABLED"))
                problems = env_config.mail_problems(s) + (env_config.vfp_problems(s) if enabled else [])
                with self.lock:
                    self.status.update(enabled=enabled, problems=problems)
                if enabled:
                    try:
                        wait = max(30, int(s.get("MAIL_POLL_SECONDS") or 120))
                    except ValueError:
                        wait = 120
                    if not problems:
                        self.check_once(s)
            except Exception:
                log.exception("Errore nel controllo posta, si riprova al prossimo giro")
            finally:
                with self.lock:
                    self.status["busy"] = False
                    self.status["next_cycle"] = time.time() + wait
                    self.status["heartbeat"] = time.time()  # il controllo di salute verifica che il ciclo giri
                    self.status["wait"] = wait
            self.wake.wait(wait)
            self.wake.clear()

    def check_once(self, s):
        with self.lock:
            self.status["busy"] = True
        cfg = env_config.vfp_config(s)
        tokens = _NoBrowser(self.tokens_for(cfg))
        st = self.load_state()
        self._do_retries(s, st)
        active = set()
        for kind in env_config.mail_sources(s):
            mbx = make_mailbox(kind, s)
            active.add(mbx.key)
            with self.lock:
                src = self.status["sources"].setdefault(mbx.key, {"label": mbx.label, "kind": kind, "last_check": None,
                                                                   "last_error": "", "transferred": 0})
            try:
                with mbx:
                    ignored = set(st["ignored"].get(mbx.key, []))
                    for message in mbx.list_messages(ignored, MAX_PER_CYCLE, s):
                        if message.blocked:
                            self._quarantine(mbx, message, s, st, message.blocked)
                            continue
                        if message.pec.get("tipo") in pec.RECEIPT_TYPES:
                            self._receipt(mbx, message, st)
                            continue
                        if not message.attachments:
                            detail = "nessun allegato da trasferire"
                            if message.rejected:
                                detail = "allegati scartati: " + ", ".join(f"{n} ({why})" for n, why in message.rejected[:10])
                            self._log_message(mbx, message, "ignorata", detail,
                                              hashlib.sha1(f"{mbx.key}|{message.ref}".encode()).hexdigest()[:10])
                            self._ignore(mbx, message, st)
                            continue
                        self._process(mbx, message, s, cfg, tokens, st, src)
                with self.lock:
                    src["last_error"] = ""
            except vt.LoginError as e:
                with self.lock:
                    self.status["login_needed"] = str(e)
                    src["last_error"] = "Accesso a Viewpoint necessario"
                log.error("Posta in attesa: %s", e)
                break  # senza accesso a VFP inutile controllare le altre caselle
            except Exception as e:
                with self.lock:
                    src["last_error"] = str(e)
                log.error("Casella %s: %s", mbx.label, e)
            finally:
                with self.lock:
                    src["last_check"] = time.time()
        with self.lock:
            self.status["sources"] = {k: v for k, v in self.status["sources"].items() if k in active}
            self.status["last_cycle"] = time.time()

    def _ignore(self, mbx, message, st):
        """L'email resta dov'e' e non viene piu' riesaminata."""
        lst = st["ignored"].setdefault(mbx.key, [])
        lst.append(message.ref)
        st["ignored"][mbx.key] = lst[-IGNORED_LEN:]
        self._save_state(st)

    def _receipt(self, mbx, message, st):
        """Ricevuta PEC (accettazione, consegna...): registrata per il tracciamento, l'email resta dov'e'."""
        p = message.pec
        detail = pec.RECEIPT_TYPES.get(p.get("tipo"), p.get("tipo"))
        if p.get("consegna"):
            detail += f" a {p['consegna']}"
        elif p.get("destinatari"):
            detail += " per " + ", ".join(p["destinatari"][:5])
        if p.get("data"):
            detail += f" il {p['data']}"
        if p.get("errore"):
            detail += f". {p['errore']}"
        self._log_message(mbx, message, "ricevuta", detail, hashlib.sha1(f"{mbx.key}|{message.ref}".encode()).hexdigest()[:10])
        self._ignore(mbx, message, st)
        log.info("Ricevuta PEC: %s (%s)", detail, message.subject)

    def _quarantine(self, mbx, message, s, st, reason):
        """Email sospetta: niente caricamento, spostata nella cartella di quarantena per un controllo umano."""
        key = f"{mbx.key}|{message.ref}"
        digest = hashlib.sha1(key.encode()).hexdigest()[:10]
        folder = s.get("MAIL_QUARANTINE_FOLDER") or "Bloccate VFP"
        mbx.move(message, folder)
        st["attempts"].pop(key, None)
        detail = f"{reason}. Spostata in '{folder}', nessun file caricato"
        st["history"].append(self._entry(mbx, message, digest, "bloccata", detail,
                                         files=[a.name for a in message.attachments] + [n for n, _ in message.rejected]))
        self._save_state(st)
        self._log_message(mbx, message, "bloccata", detail, digest)
        log.warning("Email da %s BLOCCATA: %s", message.sender, reason)

    def _process(self, mbx, message, s, cfg, tokens, st, src):
        key = f"{mbx.key}|{message.ref}"
        digest = hashlib.sha1(key.encode()).hexdigest()[:10]
        # cartella stabile per messaggio: ai tentativi successivi i file gia' caricati vengono riconosciuti
        folder_dir = archive_dir(s) / f"{message.received:%Y%m%d_%H%M%S}_{digest}"
        folder_dir.mkdir(parents=True, exist_ok=True)
        vfp_folder = tuple(p.strip() for p in s["MAIL_VFP_FOLDER"].replace("\\", "/").split("/") if p.strip())
        prefix = f"{message.received:%Y-%m-%d %H%M} " if env_config.as_bool(s.get("MAIL_DATE_PREFIX")) else ""
        prot, _ = protocollo.resolve(mbx.kind, message.subject, message.received.isoformat(), digest,
                                     s.get("PEC_PROTOCOL_REGEX", ""))
        # il protocollo nella descrizione rende il documento ricercabile anche da Viewpoint
        description = ((f"Prot. {prot} - " if prot else "") + f"Email da {message.sender}: {message.subject}")[:200]

        items = []
        for att in message.attachments:
            path = folder_dir / att.name
            if not path.exists() or path.stat().st_size != len(att.data):
                path.write_bytes(att.data)
            items.append(vt.SourceItem(file=path, folder=vfp_folder, name=prefix + path.stem,
                                       revision=cfg["default_revision"], description=description))
        threat = ""
        if any(not it.file.exists() for it in items):  # l'antivirus in tempo reale lo ha gia' tolto
            threat = "allegato rimosso dall'antivirus appena salvato"
        elif env_config.as_bool(s.get("MAIL_ANTIVIRUS")):
            threat = scan_folder(folder_dir)  # AntivirusUnavailable risale: l'email resta e si riprova
        if threat:
            shutil.rmtree(folder_dir, ignore_errors=True)  # nessuna copia locale di file infetti
            self._quarantine(mbx, message, s, st, threat)
            return
        log.info("Email da %s (%s): %s allegati da trasferire", message.sender, message.subject, len(items))
        with self.lock:  # email in lavorazione, mostrata nella colonna "In caricamento"
            self.status["current"] = {"key": digest, "source": mbx.label, "kind": mbx.kind, "sender": message.sender,
                                      "subject": message.subject, "received": message.received.isoformat(timespec="minutes"),
                                      "files": [a.name for a in message.attachments], "started": time.time()}

        results = []
        with self.transfer_lock:  # mai in parallelo con un trasferimento manuale
            client = vt.VfpClient(cfg["base_url"], tokens)
            transfer = vt.Transfer(client, cfg, self.state_path, self.report_path, False,
                                   on_event=lambda item, status, doc_id, msg: results.append((item.file.name, status, msg, doc_id)))
            try:
                transfer.run(items)  # LoginError risale: il messaggio resta dov'e'
            finally:
                transfer.close()
                with self.lock:
                    self.status["current"] = None
        with self.lock:
            self.status["login_needed"] = ""

        docs = [{"name": name, "status": status, "doc_id": doc_id or ""} for name, status, _, doc_id in results]
        errors = [f"{name}: {msg}" for name, status, msg, _ in results if status == "errore"]
        if not errors:
            mbx.move(message, s["MAIL_DONE_FOLDER"])
            st["attempts"].pop(key, None)
            outcome, detail = "trasferita", f"spostata in '{s['MAIL_DONE_FOLDER']}'"
            with self.lock:
                src["transferred"] += 1
        else:
            attempts = st["attempts"].get(key, 0) + 1
            try:
                max_attempts = max(1, int(s.get("MAIL_MAX_ATTEMPTS") or 3))
            except ValueError:
                max_attempts = 3
            if attempts >= max_attempts:
                mbx.move(message, s["MAIL_ERROR_FOLDER"])
                st["attempts"].pop(key, None)
                outcome, detail = "errore", f"spostata in '{s['MAIL_ERROR_FOLDER']}' dopo {attempts} tentativi. " + "; ".join(errors)
            else:
                st["attempts"][key] = attempts
                outcome, detail = "riprovo", f"tentativo {attempts} di {max_attempts}. " + "; ".join(errors)
        st["history"].append(self._entry(mbx, message, digest, outcome, detail, docs=docs))
        self._save_state(st)
        self._log_message(mbx, message, outcome, detail, digest, docs)
        log.info("Email da %s: %s (%s)", message.sender, outcome, detail[:200])


def archive_dir(s):
    """Cartella con la copia locale degli allegati (una sottocartella per email: data_chiave)."""
    return env_config.resolve_path(s["MAIL_ARCHIVE_DIR"])


def archived_files(s, key):
    """Cartella degli allegati di un'email (chiave del registro), None se non c'e' (es. email bloccate)."""
    if not re.fullmatch(r"[0-9a-f]{10}", key or ""):
        return None
    base = archive_dir(s)
    found = sorted(base.glob(f"*_{key}")) if base.is_dir() else []
    return found[-1] if found and found[-1].is_dir() else None


def main():
    """Solo controllo posta, senza interfaccia (l'interfaccia vfp_gui.py lo avvia gia' da sola)."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    base = env_config.BASE_DIR
    cache = {}

    def tokens_for(cfg):
        key = (cfg["token_cache"], cfg["auth"]["client_id"], cfg["auth"]["token_url"])
        if key not in cache:
            cache.clear()
            cache[key] = vt.TokenManager(cfg["auth"], cfg["token_cache"], interactive=False)
        return cache[key]

    watcher = MailWatcher(tokens_for, threading.Lock(), base / "stato_trasferimento.json",
                          base / "report_trasferimento.csv", base / "stato_posta.json")
    watcher.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
