# "><(((º> sabusabu <º)))><"
"""
Interfaccia web locale per vfp_transfer.py, pensata per il personale non tecnico,
e servizio sempre attivo che carica in VFP gli allegati delle email in arrivo (vfp_mail.py).

Avvio:  python vfp_gui.py   (oppure doppio clic su avvia_interfaccia.bat)
Avvio automatico con Windows: installa_avvio_automatico.ps1 (usa --service: niente browser all'avvio).
Si apre il browser su http://127.0.0.1:8770. Di serie il server ascolta solo sul PC locale; con GUI_BIND,
GUI_HOSTNAME e un certificato (GUI_TLS_CERT, GUI_TLS_KEY) e' raggiungibile dagli altri PC, solo in HTTPS.
Impostazioni e credenziali: file .env (vedi .env.example). Registro: logs/vfp_servizio.log.

Accesso con nome utente e password (utenti.json, vedi auth.py). Ruoli:
  admin   tutto;  utente  solo Panoramica e invio del report via email (all'amministratore e all'indirizzo scelto).

Le pagine stanno in ui/ (HTML, CSS, JS senza dipendenze); questo file espone una piccola API JSON
(tutte le chiamate richiedono la sessione; [U] = consentita anche al ruolo utente, le altre solo admin):
  POST /api/session/login | /api/session/logout [U]     GET /api/session [U]
  GET  /api/users  POST /api/users                      gestione utenti
  GET  /api/activity (.xlsx)  POST /api/activity/session-close   attivita' degli utenti e sessioni attive
  POST /api/ai/analyze | /api/ai/start   GET /api/ai/status   smistamento dei file nelle cartelle VFP con Claude
  POST /api/report/send [U]   invia il report Excel via email     POST /api/notify/test   email di prova
  GET  /api/config            impostazioni dal .env (password mascherate)
  POST /api/config            salva le impostazioni nel .env
  GET  /api/mail [U]  /api/mail/log  /api/mail/file   POST /api/mail/check | /api/mail/test | /api/mail/retry
  GET  /api/protocol/check  /api/protocolli.xlsx   POST /api/protocol/test | /api/protocol/set   (api_posta.py)
  GET  /api/search            ricerca unica in email, protocolli e documenti
  GET  /api/salute            stato del programma, senza accesso (solo da questo PC): 200 se tutto gira, 503 se no
  GET  /api/browse?path=&files=csv   sfoglia cartelle del PC (selettore cartella/manifest)
  POST /api/preview           anteprima dei file che verrebbero trasferiti
  POST /api/start             avvia prova o trasferimento in background
  POST /api/stop              interrompe dopo il file in corso
  GET  /api/status?since=N    avanzamento, esiti e log del lavoro in corso
  GET  /api/report [U]        righe di report_trasferimento.csv  (/api/report.csv = download)
  GET  /api/auth              stato del login Viewpoint
  POST /api/login | /api/logout | /api/state/reset
"""

import argparse
import csv
import hashlib
import hmac
import io
import json
import logging
import logging.handlers
import os
import secrets
import socket
import ssl
import string
import sys
import threading
import time
import webbrowser
from collections import deque
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import ai_smistamento
import api_posta
import attivita
import auth
import avvisi_portale
import cassaforte
import env_config
import mail_send
import modelli_protetti
import report_excel
import vfp_mail
import vfp_transfer as vt

BASE_DIR = env_config.BASE_DIR
UI_DIR = BASE_DIR / "ui"
REPORT_PATH = BASE_DIR / "report_trasferimento.csv"
STATE_PATH = BASE_DIR / "stato_trasferimento.json"
MAIL_STATE_PATH = BASE_DIR / "stato_posta.json"
MAIL_LOG_PATH = BASE_DIR / "registro_posta.csv"
LOG_PATH = BASE_DIR / "logs" / "vfp_servizio.log"
SECRET_MASK = "********"
PREVIEW_LIMIT = 1000  # righe massime mandate al browser per l'anteprima
CSRF_HEADER = "X-VFP-UI"  # header custom: un sito esterno non puo' inviarlo senza preflight CORS
SESSION_COOKIE = "vfp_sessione"
MAX_BODY = 1024 * 1024  # le richieste dell'interfaccia sono piccole: oltre si rifiuta
INSTANCE_PATH = BASE_DIR / ".vfp_istanza"  # chiave per chiudere l'istanza attiva quando parte una versione nuova
INSTANCE_KEY = secrets.token_urlsafe(32)
REPORT_SEND_LIMIT = (5, 15 * 60)  # invii di report per utente in 15 minuti
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",  # niente pagine esterne che mostrano l'interfaccia in un riquadro (clickjacking)
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

log = logging.getLogger("vfp_gui")
api_posta.PATHS.update(mail_log=MAIL_LOG_PATH, report=REPORT_PATH)


# --------------------------------------------------------------------------- configurazione

def rel_path(file, source):
    """Percorso del file relativo alla cartella di origine (piu' leggibile in tabella)."""
    try:
        return str(Path(file).relative_to(source))
    except ValueError:
        return str(file)


def current_cfg():
    return env_config.vfp_config(env_config.load_settings())


_TOKENS = {"key": None, "tm": None}
_TOKENS_LOCK = threading.Lock()
# un trasferimento alla volta: manuale (GUI) o da email, mai in parallelo sugli stessi file di stato
TRANSFER_LOCK = threading.Lock()


def tokens_for(cfg):
    """Un solo TokenManager condiviso da GUI e posta, ricreato se cambiano le credenziali."""
    key = (cfg["token_cache"], cfg["auth"]["client_id"], cfg["auth"]["client_secret"], cfg["auth"]["token_url"])
    with _TOKENS_LOCK:
        if _TOKENS["key"] != key:
            _TOKENS.update(key=key, tm=vt.TokenManager(cfg["auth"], cfg["token_cache"]))
        return _TOKENS["tm"]


# --------------------------------------------------------------------------- lavoro in background

class LogBuffer(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = deque(maxlen=2000)
        self.seq = 0
        self.buf_lock = threading.Lock()  # non "lock": quello e' gia' usato da logging.Handler

    def emit(self, record):
        with self.buf_lock:
            self.seq += 1
            self.lines.append({"n": self.seq, "t": time.strftime("%H:%M:%S", time.localtime(record.created)),
                               "level": record.levelname, "msg": record.getMessage()})

    def since(self, n):
        with self.buf_lock:
            return [l for l in self.lines if l["n"] > n]


class Job:
    """Un solo lavoro (prova o trasferimento) alla volta."""

    def __init__(self):
        self.lock = threading.Lock()
        self.thread = None
        self.stop_event = threading.Event()
        self.reset(dry_run=False, total=0)

    def reset(self, dry_run, total, source=""):
        self.dry_run = dry_run
        self.source = Path(source) if source else None
        self.total = total
        self.done = 0
        self.counts = {"caricato": 0, "saltato": 0, "errore": 0, "prova": 0, "interrotto": False}
        self.events = []
        self.current = ""
        self.current_part = ""
        self.started_at = time.time()
        self.finished_at = None
        self.fatal = ""

    @property
    def running(self):
        return self.thread is not None and self.thread.is_alive()

    def on_event(self, item, status, doc_id, msg):
        with self.lock:
            self.done += 1
            self.counts[status] += 1
            rel = rel_path(item.file, self.source) if self.source else str(item.file)
            self.events.append({"file": str(item.file), "rel": rel, "folder": "/".join(item.folder) or "(radice)",
                                "name": item.name, "revision": item.revision,
                                "status": status, "doc_id": doc_id, "msg": msg})
            self.current = ""
            self.current_part = ""

    def on_item(self, item):
        with self.lock:
            self.current = f"{item.file.name}  ->  {'/'.join(item.folder) or '(radice)'}"
            self.current_part = ""

    def snapshot(self, since):
        with self.lock:
            return {
                "running": self.running, "dry_run": self.dry_run, "total": self.total, "done": self.done,
                "counts": dict(self.counts), "current": self.current, "current_part": self.current_part, "fatal": self.fatal,
                "started_at": self.started_at, "finished_at": self.finished_at,
                "events": self.events[since:], "events_total": len(self.events),
            }


JOB = Job()
LOGS = LogBuffer()
LOGIN = {"running": False, "error": ""}


class _UploadPartFilter(logging.Filter):
    """Ricava dal log del modulo la parte in caricamento dei file grandi (upload multipart)."""

    def filter(self, record):
        msg = record.getMessage()
        if msg.startswith("  parte "):
            JOB.current_part = msg.strip()
        return True


def run_job(items, cfg, dry_run):
    try:
        if not TRANSFER_LOCK.acquire(blocking=False):
            JOB.current = "In attesa: e' in corso il caricamento degli allegati di un'email..."
            TRANSFER_LOCK.acquire()
            JOB.current = ""
        try:
            client = vt.VfpClient(cfg["base_url"], tokens_for(cfg))
            transfer = vt.Transfer(client, cfg, STATE_PATH, REPORT_PATH, dry_run,
                                   on_event=JOB.on_event, stop_event=JOB.stop_event, on_item=JOB.on_item)
            try:
                counts = transfer.run(items)
            finally:
                transfer.close()
        finally:
            TRANSFER_LOCK.release()
        JOB.counts["interrotto"] = counts["interrotto"]
        log.info("Lavoro terminato")
    except vt.LoginError as e:
        JOB.fatal = f"Login Viewpoint non riuscito: {e}"
        log.error(JOB.fatal)
    except Exception as e:  # errore imprevisto: lo si mostra in pagina invece di far morire il thread in silenzio
        JOB.fatal = f"Errore imprevisto: {e}"
        log.exception("Errore imprevisto")
    finally:
        JOB.finished_at = time.time()


def run_login(cfg):
    LOGIN.update(running=True, error="")
    try:
        tokens = tokens_for(cfg)
        tokens.invalidate()  # forza refresh o nuovo login, cosi' si verifica davvero l'accesso
        tokens.get(interactive=True)
        log.info("Accesso a Viewpoint riuscito")
        if MAIL:
            MAIL.trigger()  # la posta in attesa dell'accesso riparte subito
    except Exception as e:
        LOGIN["error"] = str(e)
        log.error("Accesso a Viewpoint non riuscito: %s", e)
    finally:
        LOGIN["running"] = False


# --------------------------------------------------------------------------- funzioni API

def api_get_config():
    s = env_config.load_settings()
    env = {k: (SECRET_MASK if k in env_config.SECRET_KEYS and s.get(k) else s.get(k, "")) for k in env_config.DEFAULTS
           if k not in env_config.SOLO_SVILUPPATORI}
    return {"env": env, "saved": env_config.ENV_PATH.exists(), "problems": env_config.vfp_problems(s),
            "mail_problems": env_config.mail_problems(s), "mail_warnings": env_config.mail_warnings(s),
            "send_problems": mail_send.send_problems(s), "approval_active": not mail_send.send_problems(s),
            "vault": cassaforte.available(), "from_os": env_config.overridden_by_os()}


def api_save_config(body, user, token=""):
    values = {k: str(v) for k, v in (body.get("env") or {}).items() if k in env_config.DEFAULTS}
    current = env_config.load_settings()  # valori in uso (file + variabili di Windows)
    vietate = sorted(k for k in env_config.SOLO_SVILUPPATORI & set(values) if values[k] != current.get(k, ""))
    if vietate:
        raise ValueError(f"{', '.join(vietate)}: si cambia solo nel file .env, a cura degli sviluppatori")
    for k in env_config.SOLO_SVILUPPATORI:
        values.pop(k, None)
    try:
        extra = json.loads(values.get("VFP_DOCUMENT_DEFAULTS") or "{}")
        if not isinstance(extra, dict):
            raise ValueError
        values["VFP_DOCUMENT_DEFAULTS"] = json.dumps(extra, ensure_ascii=False)  # su una riga sola
    except ValueError:
        raise ValueError("I campi extra del documento devono essere un oggetto JSON")
    for k in env_config.SECRET_KEYS:
        if values.get(k) != SECRET_MASK:
            continue  # password scritta di nuovo (o cancellata) nel form
        changed = [b for b in env_config.SECRET_BINDINGS[k] if b in values and values[b] != current.get(b, "")]
        if changed and current.get(k):
            raise ValueError(f"Hai cambiato {', '.join(changed)}: per sicurezza reinserisci anche {k}")
        values[k] = current.get(k, "")
    if values.get("VFP_TARGET_TYPE", "project") not in ("project", "folder"):
        raise ValueError("Tipo destinazione non valido")
    if values.get("VFP_IF_EXISTS", "new_revision") not in ("new_revision", "skip"):
        raise ValueError("Comportamento per documenti esistenti non valido")
    env_config.validate_settings(values, current)
    if not env_config.ENV_PATH.exists():
        example = BASE_DIR / ".env.example"
        if example.exists():  # si parte dal modello commentato
            env_config.ENV_PATH.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    changed = sorted(k for k, v in values.items() if v != current.get(k, ""))
    protected = [k for k in changed if k in env_config.OTP_KEYS]
    if protected:  # credenziali e impostazioni di sicurezza: serve il codice inviato all'amministratore
        auth.require_approval(token, user, "impostazioni " + ", ".join(protected),
                              {k: values[k] for k in protected}, body.get("otp"))
    env_config.save_settings(values)  # credenziali nella cassaforte cifrata, il resto nel .env
    # nessun valore nel registro, solo quali impostazioni sono cambiate e chi le ha cambiate
    log.warning("Impostazioni modificate da %s: %s", user, ", ".join(changed) or "nessuna modifica")
    if changed:
        attivita.record(user, "modifica", "Impostazioni modificate", ", ".join(changed), role="admin")
    if any(k in changed for k in env_config.TOKEN_BINDINGS):
        token = Path(env_config.vfp_config(current)["token_cache"])
        if token.exists():
            token.unlink()  # l'accesso salvato valeva per il server o l'app precedente
            log.warning("Cambiato il server o l'app Viewpoint: accesso salvato eliminato, va rifatto")
    if MAIL:
        MAIL.trigger()
    return api_get_config()


def api_browse(query):
    raw = (query.get("path") or [""])[0].strip()
    want_csv = (query.get("files") or [""])[0] == "csv"
    if not raw:
        if os.name == "nt":
            drives = [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
            return {"path": "", "parent": None, "dirs": [{"name": d, "path": d} for d in drives], "files": []}
        raw = str(Path.home())
    path = Path(raw)
    if not path.is_dir():
        raise ValueError(f"Cartella non trovata: {raw}")
    dirs, files = [], []
    try:
        for p in sorted(path.iterdir(), key=lambda p: p.name.casefold()):
            if p.name.startswith(".") or p.name.startswith("$"):
                continue
            try:
                if p.is_dir():
                    dirs.append({"name": p.name, "path": str(p)})
                elif want_csv and p.suffix.lower() == ".csv":
                    files.append({"name": p.name, "path": str(p)})
            except OSError:
                continue
    except PermissionError:
        raise ValueError(f"Accesso negato a {raw}")
    parent = str(path.parent) if path.parent != path else ""
    return {"path": str(path), "parent": parent, "dirs": dirs, "files": files}


def api_preview(body):
    cfg = current_cfg()
    source = (body.get("source") or "").strip()
    manifest = (body.get("manifest") or "").strip() or None
    if not source:
        raise ValueError("Indicare la cartella di origine")
    items = vt.load_items(source, manifest, cfg.get("default_revision", "1"))
    state = vt.load_state(STATE_PATH)
    rows, folders, total_size = [], set(), 0
    summary = {"pronto": 0, "trasferito": 0, "ripresa": 0, "mancante": 0, "radice": 0}
    for item in items:
        size = None
        if item.key in state["completati"]:
            status = "trasferito"
        elif not item.file.is_file():
            status = "mancante"
        elif not item.folder and cfg["target"]["type"] == "project":
            status = "radice"
        elif item.key in state["in_sospeso"]:
            status = "ripresa"
        else:
            status = "pronto"
        if item.file.is_file():
            size = item.file.stat().st_size
            total_size += size
        summary[status] += 1
        folders.add(item.folder)
        if len(rows) < PREVIEW_LIMIT:
            rows.append({"file": str(item.file), "rel": rel_path(item.file, source), "folder": "/".join(item.folder) or "(radice)",
                         "name": item.name, "revision": item.revision, "description": item.description,
                         "size": size, "status": status})
    return {"total": len(items), "rows": rows, "truncated": len(items) > PREVIEW_LIMIT,
            "folders": len(folders - {()}), "size": total_size, "summary": summary,
            "target": cfg["target"], "if_exists": cfg.get("if_exists", "new_revision")}


def api_start(body):
    if JOB.running:
        raise ValueError("C'e' gia' un lavoro in corso")
    dry_run = bool(body.get("dry_run"))
    settings = env_config.load_settings()
    cfg = env_config.vfp_config(settings)
    if not dry_run:
        problems = env_config.vfp_problems(settings)
        if problems:
            raise ValueError("Completare le impostazioni: " + "; ".join(problems))
    source = (body.get("source") or "").strip()
    manifest = (body.get("manifest") or "").strip() or None
    items = vt.load_items(source, manifest, cfg.get("default_revision", "1"))
    if not items:
        raise ValueError("Nessun file da trasferire nella sorgente indicata")
    JOB.stop_event.clear()
    JOB.reset(dry_run=dry_run, total=len(items), source=source)
    log.info("%s avviato: %s file da %s%s", "Prova" if dry_run else "Trasferimento", len(items), source,
             f" (manifest {manifest})" if manifest else "")
    JOB.thread = threading.Thread(target=run_job, args=(items, cfg, dry_run), daemon=True)
    JOB.thread.start()
    return {"ok": True}


def api_stop():
    if JOB.running:
        JOB.stop_event.set()
        log.warning("Richiesta interruzione: si ferma dopo il file in corso")
    return {"ok": True}


# --------------------------------------------------------------------------- smistamento con Claude

AI = {"running": False, "phase": "", "done": 0, "total": 0, "error": "", "source": "", "folders": [], "rows": [],
      "finished_at": None}


def run_ai(source, settings):
    try:
        cfg = env_config.vfp_config(settings)
        AI["phase"] = "Lettura delle cartelle in Viewpoint"
        client = vt.VfpClient(cfg["base_url"], tokens_for(cfg))
        folders = ai_smistamento.folder_tree(client, cfg["target"]["type"], cfg["target"]["id"])
        files = [(str(i.file), rel_path(i.file, source)) for i in vt.items_from_folder(source, "1")]
        if not files:
            raise ValueError("Nessun file nella cartella indicata")
        if len(files) > ai_smistamento.MAX_FILES:
            raise ValueError(f"Troppi file ({len(files)}): massimo {ai_smistamento.MAX_FILES} per analisi, "
                             "scegliere una sottocartella")
        AI.update(folders=folders, total=len(files), phase="Claude sta leggendo i nomi dei file")
        log.info("Smistamento AI: %s file, %s cartelle VFP", len(files), len(folders))
        AI["rows"] = ai_smistamento.classify(settings, files, folders, progress=lambda n: AI.update(done=n))
        AI["phase"] = "Proposte pronte"
    except vt.LoginError as e:
        AI["error"] = f"Accesso a Viewpoint necessario: {e}"
    except Exception as e:  # mostrato in pagina
        AI["error"] = str(e)
        log.error("Smistamento AI non riuscito: %s", e)
    finally:
        AI.update(running=False, finished_at=time.time())


def api_ai_analyze(body):
    if AI["running"]:
        raise ValueError("Analisi gia' in corso")
    settings = env_config.load_settings()
    problems = env_config.vfp_problems(settings)
    if problems:
        raise ValueError("Completare le impostazioni: " + "; ".join(problems))
    if not settings.get("ANTHROPIC_API_KEY"):
        raise ValueError("Inserire la chiave API di Claude nelle Impostazioni")
    source = (body.get("source") or "").strip()
    if not source or not Path(source).is_dir():
        raise ValueError("Cartella di origine non trovata")
    AI.update(running=True, phase="Avvio", done=0, total=0, error="", source=source, folders=[], rows=[], finished_at=None)
    threading.Thread(target=run_ai, args=(source, settings), daemon=True, name="smistamento-ai").start()
    return {"ok": True}


def api_ai_status():
    return {k: (list(v) if isinstance(v, list) else v) for k, v in AI.items()}


def api_ai_start(body):
    """Trasferisce i file con le cartelle confermate dall'amministratore (solo file e cartelle dell'analisi)."""
    if JOB.running:
        raise ValueError("C'e' gia' un lavoro in corso")
    if AI["running"] or not AI["rows"]:
        raise ValueError("Nessuna proposta da trasferire: eseguire prima l'analisi")
    dry_run = bool(body.get("dry_run"))
    settings = env_config.load_settings()
    cfg = env_config.vfp_config(settings)
    known_files = {r["file"] for r in AI["rows"]}
    known_folders = {f.casefold(): f for f in [*AI["folders"], ai_smistamento.FALLBACK_FOLDER]}
    items = []
    for r in body.get("rows") or []:
        file, folder = str(r.get("file") or ""), known_folders.get(str(r.get("folder") or "").casefold())
        if file not in known_files:
            raise ValueError("File non compreso nell'analisi")
        if not folder:
            raise ValueError(f"Cartella non esistente in Viewpoint: {r.get('folder')}")
        p = Path(file)
        items.append(vt.SourceItem(file=p, folder=tuple(folder.split("/")), name=p.stem,
                                   revision=cfg.get("default_revision", "1"), description="Smistato con Claude"))
    if not items:
        raise ValueError("Nessun file selezionato")
    JOB.stop_event.clear()
    JOB.reset(dry_run=dry_run, total=len(items), source=AI["source"])
    log.info("%s smistamento AI: %s file da %s", "Prova" if dry_run else "Trasferimento", len(items), AI["source"])
    JOB.thread = threading.Thread(target=run_job, args=(items, cfg, dry_run), daemon=True)
    JOB.thread.start()
    return {"ok": True}


def api_status(query):
    since = int((query.get("since") or ["0"])[0])
    log_since = int((query.get("log") or ["0"])[0])
    snap = JOB.snapshot(since)
    snap["logs"] = LOGS.since(log_since)
    return snap


def api_report():
    if not REPORT_PATH.exists():
        return {"rows": [], "exists": False}
    rows = report_excel._read_report(REPORT_PATH)
    rows.reverse()  # i piu' recenti per primi
    return {"rows": rows[:5000], "total": len(rows), "exists": True}


def api_auth():
    cfg = current_cfg()
    path = Path(cfg["token_cache"])
    info = {"logged_in": False, "expires_at": None, "has_refresh": False,
            "login_running": LOGIN["running"], "login_error": LOGIN["error"],
            "mail_login_needed": MAIL.status.get("login_needed", "") if MAIL else ""}
    if path.exists():
        try:
            tok = cassaforte.load_json(path.read_bytes())
            info.update(logged_in=bool(tok.get("access_token")), expires_at=tok.get("expires_at"),
                        has_refresh=bool(tok.get("refresh_token")))
        except (OSError, ValueError, cassaforte.VaultError):
            pass
    state = vt.load_state(STATE_PATH)
    info["state"] = {"completati": len(state["completati"]), "in_sospeso": len(state["in_sospeso"])}
    return info


def api_login():
    if LOGIN["running"]:
        return {"ok": True}
    cfg = current_cfg()
    if not cfg["auth"]["client_id"]:
        raise ValueError("Impostare prima il Client ID Viewpoint")
    threading.Thread(target=run_login, args=(cfg,), daemon=True).start()
    return {"ok": True}


def api_logout():
    path = Path(current_cfg()["token_cache"])
    if path.exists():
        path.unlink()
    log.info("Disconnesso da Viewpoint (token locale eliminato)")
    return {"ok": True}


def api_state_reset():
    if JOB.running:
        raise ValueError("Impossibile durante un lavoro in corso")
    if STATE_PATH.exists():
        backup = STATE_PATH.with_name(f"stato_trasferimento_{time.strftime('%Y%m%d_%H%M%S')}.bak.json")
        STATE_PATH.rename(backup)
        log.warning("Stato di ripresa azzerato (copia in %s)", backup.name)
    return {"ok": True}


def report_csv():
    """Report dei trasferimenti in CSV, con i valori resi sicuri per Excel (anche le righe scritte prima)."""
    out = io.StringIO()
    rows = report_excel._read_report(REPORT_PATH)
    w = csv.writer(out, delimiter=";")
    w.writerow(["data", "file", "cartella", "nome", "revisione", "esito", "id_documento", "messaggio"])
    for r in rows:
        w.writerow([vt.csv_cell(r.get(k)) for k in ("data", "file", "cartella", "nome", "revisione", "esito",
                                                    "id_documento", "messaggio")])
    return ("\ufeff" + out.getvalue()).encode("utf-8")  # BOM: Excel riconosce gli accenti


# --------------------------------------------------------------------------- utenti, sessioni, invio report

_SEND_LOG = {}  # utente -> istanti degli ultimi invii di report
_SEND_LOCK = threading.Lock()


def api_session_info(sess):
    user = auth.get_user(sess["user"]) or {}
    return {"user": sess["user"], "role": sess["role"], "role_label": auth.ROLES.get(sess["role"], ""),
            "email": user.get("email", ""), "area": sess.get("area", auth.AREA_PREDEFINITA), "areas": auth.AREE}


def api_users():
    return {"users": auth.list_users(), "roles": auth.ROLES, "areas": auth.AREE, "min_password": auth.MIN_PASSWORD}


def api_users_save(body, sess, token=""):
    action, name = body.get("action"), str(body.get("name") or "").strip()
    what = {"add": f"nuovo utente {name} ({body.get('role')})", "password": f"nuova password per {name}",
            "update": f"modifica dell'utente {name}", "delete": f"eliminazione dell'utente {name}"}.get(action)
    if not what:
        raise ValueError("Operazione non valida")
    auth.require_approval(token, sess["user"], what,
                          {k: body.get(k) for k in ("action", "name", "role", "email", "password", "area")}, body.get("otp"))
    if action == "add":
        area = body.get("area") or auth.AREA_PREDEFINITA
        auth.add_user(name, str(body.get("password") or ""), body.get("role"), str(body.get("email") or ""), area)
        log.warning("Utente %s creato da %s (ruolo %s, area %s)", name, sess["user"], body.get("role"), area)
        attivita.record(sess["user"], "modifica", "Utente creato",
                        f"{name} ({auth.ROLES.get(body.get('role'), '')}, area {auth.AREE.get(area, area)})", role="admin")
    elif action == "password":
        auth.set_password(name, str(body.get("password") or ""))
        log.warning("Password dell'utente %s cambiata da %s", name, sess["user"])
        attivita.record(sess["user"], "modifica", "Password cambiata", name, role="admin")
    elif action == "update":
        if name == sess["user"] and body.get("role") not in (None, "admin"):
            raise ValueError("Non puoi togliere a te stesso il ruolo di amministratore")
        auth.update_user(name, role=body.get("role"), email=body.get("email"), area=body.get("area"))
        log.warning("Utente %s modificato da %s", name, sess["user"])
        dettaglio = name
        if body.get("role"):
            dettaglio = f"{name}: ruolo {auth.ROLES.get(body.get('role'), '-')}"
        elif body.get("area"):
            dettaglio = f"{name}: area {auth.AREE.get(body.get('area'), '-')}"
        attivita.record(sess["user"], "modifica", "Utente modificato", dettaglio, role="admin")
    elif action == "delete":
        if name == sess["user"]:
            raise ValueError("Non puoi eliminare il tuo stesso utente")
        auth.delete_user(name)
        log.warning("Utente %s eliminato da %s", name, sess["user"])
        attivita.record(sess["user"], "modifica", "Utente eliminato", name, role="admin")
    else:
        raise ValueError("Operazione non valida")
    return api_users()


def api_report_send(body, sess):
    """Report Excel via email: sempre all'amministratore, piu' l'indirizzo scritto da chi lo chiede."""
    settings = env_config.load_settings()
    problems = mail_send.send_problems(settings)
    if problems:
        raise ValueError("Invio non ancora configurato dall'amministratore: " + "; ".join(problems))
    recipient = mail_send.check_recipient(body.get("email"), settings)
    days = str(body.get("days") or "0")
    if days not in ("0", "1", "7", "30"):
        raise ValueError("Periodo non valido")
    now = time.time()
    with _SEND_LOCK:
        recent = [t for t in _SEND_LOG.get(sess["user"], []) if now - t < REPORT_SEND_LIMIT[1]]
        if len(recent) >= REPORT_SEND_LIMIT[0]:
            raise ValueError("Troppi invii ravvicinati: riprovare tra qualche minuto")
        _SEND_LOG[sess["user"]] = recent + [now]
    dal = None
    if days != "0":
        from datetime import date, timedelta
        dal = date.today() - timedelta(days=int(days) - 1)
    area = None if sess["role"] == "admin" else sess.get("area")  # l'utente riceve solo la sua area
    data = report_excel.build_report(MAIL_LOG_PATH, REPORT_PATH, env_config.resolve_path(settings["MAIL_ARCHIVE_DIR"]),
                                     dal, None, None, area=area)
    period = {"0": "tutto il periodo", "1": "oggi", "7": "ultimi 7 giorni", "30": "ultimi 30 giorni"}[days]
    name = f"report_vfp_{time.strftime('%Y%m%d_%H%M')}.xlsx"
    body_text = (f"In allegato il report delle email ricevute e dei documenti trasferiti in Viewpoint ({period}).\n\n"
                 f"Richiesto da: {sess['user']}\nInviato a: {recipient}\nCopia all'amministratore: {settings['ADMIN_EMAIL']}\n"
                 f"Generato il {time.strftime('%d/%m/%Y alle %H:%M')}.\n\n"
                 "Messaggio automatico del programma di trasferimento documenti verso Viewpoint For Projects.")
    mail_send.send(settings, [settings["ADMIN_EMAIL"], recipient], f"Report documenti Viewpoint - {period}", body_text,
                   [(name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")])
    log.warning("Report (%s) inviato da %s a %s e all'amministratore", period, sess["user"], recipient)
    attivita.record(sess["user"], "report", "Report inviato via email", f"{period}, a {recipient}", role=sess["role"])
    return {"ok": True, "to": [settings["ADMIN_EMAIL"], recipient]}


def api_activity(query, token):
    arg = lambda k: (query.get(k) or [""])[0].strip()
    days = int(arg("days")) if arg("days") in ("0", "1", "7", "30") else 7
    rows, events, integrity = attivita.query(arg("user"), arg("cat"), days, arg("q"), arg("esito"))
    sessions = auth.active_sessions()
    mine = auth._session_id(token) if token else ""
    online = {x["user"] for x in sessions}
    last = attivita.last_seen_by_user(events)
    users = [{**u, "last_activity": last.get(u["name"]), "online": u["name"] in online} for u in auth.list_users()]
    return {"events": rows[:1000], "total": len(rows), "sessions": [{**x, "mine": x["id"] == mine} for x in sessions],
            "users": users, "stats": {**attivita.stats(events), "online": len(online)}, "integrity": integrity,
            "categories": attivita.CATEGORIES, "outcomes": attivita.OUTCOMES, "now": time.time()}


def activity_xlsx(query):
    arg = lambda k: (query.get(k) or [""])[0].strip()
    days = int(arg("days")) if arg("days") in ("0", "1", "7", "30") else 7
    rows, _, integrity = attivita.query(arg("user"), arg("cat"), days, arg("q"), arg("esito"))
    sheet = report_excel.Sheet("Attivita", widths=[19, 20, 15, 15, 34, 60, 13])
    sheet.add(["Data", "Utente", "Ruolo", "Categoria", "Azione", "Dettaglio", "Esito"])
    for e in rows:
        sheet.add([report_excel._dt(e.get("t")), e.get("u"), auth.ROLES.get(e.get("r"), e.get("r") or ""),
                   attivita.CATEGORIES.get(e.get("c"), e.get("c")), e.get("a"), e.get("d"),
                   attivita.OUTCOMES.get(e.get("o"), e.get("o"))], 3)
    if not integrity["ok"]:
        sheet.add([])
        sheet.add([f"ATTENZIONE: registro modificato dall'esterno alla riga {integrity['broken_at']}"])
    return report_excel.write_xlsx([sheet])


def api_session_close(body, sess, token):
    target = auth.close_session(str(body.get("id") or ""), token)
    log.warning("Sessione di %s chiusa dall'amministratore %s", target, sess["user"])
    attivita.record(sess["user"], "sicurezza", "Sessione chiusa dall'amministratore", target, role="admin")
    return {"ok": True}


def api_notify_test(sess):
    settings = env_config.load_settings()
    mail_send.send(settings, [settings["ADMIN_EMAIL"]], "Prova di invio - trasferimento VFP",
                   f"Email di prova inviata da {sess['user']}: l'invio dei report funziona.")
    return {"ok": True, "message": f"Email di prova inviata a {settings['ADMIN_EMAIL']}"}


def api_modelli_avvisi():
    return modelli_protetti.avvisi_aperti() | {"impostata": bool(env_config.load_settings().get("MODELLI_SORGENTE"))}


def api_modelli_visto(body, sess):
    a = modelli_protetti.segna_visto(str(body.get("id") or ""), sess["user"])
    attivita.record(sess["user"], "modifica", "Avviso modelli trasporti segnato come visto", a["id"], role="admin")
    return api_modelli_avvisi()


def _controllo_modelli():
    """Ogni ora guarda se e' dovuto il controllo mensile dei modelli nella cartella condivisa (sola lettura)."""
    time.sleep(90)  # lascia partire prima interfaccia e posta
    while True:
        try:
            modelli_protetti.controlla_modelli(env_config.load_settings())
        except Exception:
            log.exception("Controllo mensile dei modelli non riuscito")
        time.sleep(3600)


# --------------------------------------------------------------------------- server HTTP

STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml"}


class Handler(BaseHTTPRequestHandler):
    server_version = "VfpGui/1.0"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in {**SECURITY_HEADERS, **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        # blocca il DNS rebinding: si accetta solo chi chiama localhost (o il nome configurato per la rete)
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in NET["hosts"]

    def _local(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _token(self):
        try:
            c = SimpleCookie(self.headers.get("Cookie") or "")
        except CookieError:
            return ""
        return c[SESSION_COOKIE].value if SESSION_COOKIE in c else ""

    def _session(self):
        return auth.session(self._token())

    def _guard(self, fn, *args):
        """True se la chiamata e' andata a buon fine (risposta 200)."""
        try:
            self._send(200, fn(*args))
            return True
        except auth.AuthError as e:
            self._send(401, {"error": str(e)})
        except auth.ApprovalRequired as e:
            self._send(428, {"error": str(e), "approval_required": True})
        except (ValueError, OSError, KeyError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            log.exception("Errore API")
            self._send(500, {"error": f"Errore interno: {e}"})
        return False

    def _allowed(self, sess, role):
        """None se la chiamata e' permessa, altrimenti la risposta di rifiuto gia' inviata."""
        if sess is None:
            self._send(401, {"error": "Sessione scaduta o assente: accedere di nuovo", "login": True})
            return False
        if role.startswith("area:") and sess["role"] != "admin" and sess.get("area") != role[5:]:
            log.warning("Accesso negato a %s per l'utente %s (area %s)", urlparse(self.path).path, sess["user"], sess.get("area"))
            attivita.record(sess["user"], "sicurezza", "Area non assegnata", urlparse(self.path).path, "negato", sess["role"])
            self._send(403, {"error": "Funzione di un'area non assegnata a questo utente"})
            return False
        if role == "admin" and sess["role"] != "admin":
            log.warning("Accesso negato a %s per l'utente %s", urlparse(self.path).path, sess["user"])
            attivita.record(sess["user"], "sicurezza", "Funzione riservata negata", urlparse(self.path).path,
                            "negato", sess["role"])
            self._send(403, {"error": "Funzione riservata all'amministratore"})
            return False
        return True

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "host non ammesso"})
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/api/info":  # usata da un nuovo avvio per capire che versione e' attiva
            return self._guard(api_info) if self._local() else self._send(403, {"error": "solo da questo PC"})
        if url.path == "/api/salute":  # controllo esterno dello stato, senza accesso: solo da questo PC
            if not self._local():
                return self._send(403, {"error": "solo da questo PC"})
            info = health()
            return self._send(200 if info["stato"] == "ok" else 503, info)
        sess = self._session()
        routes = {
            "/api/session": ("utente", lambda: api_session_info(sess)),
            "/api/report": ("area:documenti", lambda: api_report()),  # utente: solo chi ha l'area documenti
            "/api/mail": ("area:posta", lambda: api_posta.mail_status()),  # utente: solo chi ha l'area posta
            "/api/config": ("admin", lambda: api_get_config()),
            "/api/browse": ("admin", lambda: api_browse(q)),
            "/api/status": ("admin", lambda: api_status(q)),
            "/api/auth": ("admin", lambda: api_auth()),
            "/api/mail/log": ("admin", lambda: api_posta.mail_log(q)),
            "/api/protocol/check": ("admin", lambda: api_posta.protocol_check(q)),
            "/api/search": ("admin", lambda: api_posta.search(q)),
            "/api/users": ("admin", lambda: api_users()),
            "/api/activity": ("admin", lambda: api_activity(q, self._token())),
            "/api/ai/status": ("admin", lambda: api_ai_status()),
            "/api/modelli/avvisi": ("admin", lambda: api_modelli_avvisi()),
        }
        if url.path in routes:
            role, fn = routes[url.path]
            return self._allowed(sess, role) and self._guard(fn)
        if url.path == "/api/report.xlsx":
            if not self._allowed(sess, "admin"):
                return
            try:
                data = api_posta.report_xlsx(q)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            name = f"report_vfp_{time.strftime('%Y%m%d_%H%M')}.xlsx"
            log.info("Report Excel scaricato da %s", sess["user"])
            attivita.record(sess["user"], "report", "Report Excel scaricato", "", role=sess["role"])
            return self._send(200, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              {"Content-Disposition": f'attachment; filename="{name}"'})
        if url.path == "/api/activity.xlsx":
            if not self._allowed(sess, "admin"):
                return
            attivita.record(sess["user"], "report", "Registro attività scaricato", "", role=sess["role"])
            return self._send(200, activity_xlsx(q), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              {"Content-Disposition": f'attachment; filename="attivita_utenti_{time.strftime("%Y%m%d_%H%M")}.xlsx"'})
        if url.path == "/api/protocolli.xlsx":
            if not self._allowed(sess, "admin"):
                return
            try:
                data = api_posta.protocol_xlsx(q)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            attivita.record(sess["user"], "report", "Registro protocolli PEC scaricato", "", role=sess["role"])
            return self._send(200, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              {"Content-Disposition": f'attachment; filename="protocolli_pec_{time.strftime("%Y%m%d_%H%M")}.xlsx"'})
        if url.path == "/api/mail/file":
            if not self._allowed(sess, "admin"):
                return
            try:
                data, ctype, headers = api_posta.mail_file(q)
            except (ValueError, OSError) as e:
                return self._send(404, {"error": str(e)})
            return self._send(200, data, ctype, headers)
        if url.path == "/api/report.csv":
            if not self._allowed(sess, "admin"):
                return
            attivita.record(sess["user"], "report", "Report CSV scaricato", "", role=sess["role"])
            return self._send(200, report_csv(), "text/csv; charset=utf-8",
                              {"Content-Disposition": 'attachment; filename="report_trasferimento.csv"'})
        if url.path.startswith("/api/"):
            return self._send(404, {"error": "non trovato"})
        # pagine: senza sessione si va al login, con la sessione il login rimanda alla pagina principale
        if url.path in ("/", "", "/index.html") and sess is None:
            return self._send(302, b"", "text/plain", {"Location": "/login.html"})
        if url.path == "/login.html" and sess is not None:
            return self._send(302, b"", "text/plain", {"Location": "/"})
        rel = "index.html" if url.path in ("/", "") else url.path.lstrip("/")
        target = (UI_DIR / rel).resolve()
        if UI_DIR.resolve() not in target.parents or not target.is_file():
            return self._send(404, {"error": "non trovato"})
        self._send(200, target.read_bytes(), STATIC_TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self):
        if not self._host_ok() or self.headers.get(CSRF_HEADER) != "1":
            return self._send(403, {"error": "richiesta non ammessa"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self._send(413, {"error": "richiesta troppo grande"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "JSON non valido"})
        path = urlparse(self.path).path
        if path == "/api/session/login":
            return self._login(body)
        if path == "/api/shutdown":  # solo dal nuovo avvio del programma, che conosce la chiave dell'istanza
            key = self.headers.get("X-VFP-Shutdown") or ""
            if not hmac.compare_digest(key.encode(), INSTANCE_KEY.encode()):
                return self._send(403, {"error": "richiesta non ammessa"})
            return self._guard(api_shutdown)
        sess = self._session()
        if path == "/api/session/logout":
            auth.logout(self._token())
            if sess:
                log.info("Uscita dell'utente %s", sess["user"])
                attivita.record(sess["user"], "accesso", "Uscita", "", role=sess["role"])
            return self._send(200, {"ok": True}, extra={"Set-Cookie": f"{SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"})
        user = sess["user"] if sess else ""
        routes = {
            "/api/report/send": ("utente", lambda: api_report_send(body, sess)),
            "/api/config": ("admin", lambda: api_save_config(body, user, self._token())),
            "/api/preview": ("admin", lambda: api_preview(body)),
            "/api/start": ("admin", lambda: api_start(body)),
            "/api/stop": ("admin", lambda: api_stop()),
            "/api/login": ("admin", lambda: api_login()),
            "/api/logout": ("admin", lambda: api_logout()),
            "/api/state/reset": ("admin", lambda: api_state_reset()),
            "/api/mail/check": ("admin", lambda: api_posta.mail_check()),
            "/api/mail/test": ("admin", lambda: api_posta.mail_test(body)),
            "/api/mail/retry": ("admin", lambda: api_posta.mail_retry(body, sess)),
            "/api/protocol/test": ("admin", lambda: api_posta.protocol_test(body)),
            "/api/protocol/set": ("admin", lambda: api_posta.protocol_set(body, sess)),
            "/api/users": ("admin", lambda: api_users_save(body, sess, self._token())),
            "/api/notify/test": ("admin", lambda: api_notify_test(sess)),
            "/api/ai/analyze": ("admin", lambda: api_ai_analyze(body)),
            "/api/ai/start": ("admin", lambda: api_ai_start(body)),
            "/api/activity/session-close": ("admin", lambda: api_session_close(body, sess, self._token())),
            "/api/modelli/avvisi/visto": ("admin", lambda: api_modelli_visto(body, sess)),
        }
        if path not in routes:
            return self._send(404, {"error": "non trovato"})
        role, fn = routes[path]
        if self._allowed(sess, role) and self._guard(fn):
            event = _post_event(path, body)
            if event:
                attivita.record(sess["user"], event[0], event[1], event[2], role=sess["role"])

    def _login(self, body):
        name = str(body.get("username") or "")
        try:
            token, role = auth.login(name, str(body.get("password") or ""))
        except auth.AuthError as e:
            log.warning("Accesso all'interfaccia non riuscito per '%s': %s", name[:64], e)
            attivita.record(name[:64] or "(vuoto)", "accesso", "Accesso non riuscito", str(e), "fallito")
            time.sleep(1)  # rallenta i tentativi a raffica
            return self._send(401, {"error": str(e)})
        log.info("Accesso all'interfaccia: %s (%s)", name, role)
        attivita.record(auth.session(token)["user"], "accesso", "Accesso", "", role=role)
        cookie = f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict{'; Secure' if NET['tls'] else ''}"
        self._send(200, {"ok": True, "role": role}, extra={"Set-Cookie": cookie})


def _post_event(path, body):
    """(categoria, azione, dettaglio) da registrare per le chiamate andate a buon fine senza un evento proprio."""
    dry = bool(body.get("dry_run"))
    events = {
        "/api/start": ("trasferimento", "Prova avviata" if dry else "Trasferimento avviato", f"da {body.get('source', '')}"),
        "/api/stop": ("trasferimento", "Trasferimento interrotto", ""),
        "/api/ai/analyze": ("trasferimento", "Smistamento AI: analisi avviata", f"da {body.get('source', '')}"),
        "/api/ai/start": ("trasferimento", "Smistamento AI: prova avviata" if dry else "Smistamento AI: trasferimento avviato",
                          f"{len(body.get('rows') or [])} file"),
        "/api/login": ("modifica", "Accesso a Viewpoint avviato", ""),
        "/api/logout": ("modifica", "Disconnessione da Viewpoint", ""),
        "/api/state/reset": ("modifica", "Ripresa dei trasferimenti azzerata", ""),
        "/api/mail/check": ("trasferimento", "Controllo posta manuale", ""),
        "/api/mail/test": ("modifica", "Prova di connessione a una casella", str(body.get("kind", ""))),
        "/api/notify/test": ("modifica", "Email di prova inviata", ""),
    }
    return events.get(path)


MAIL = None  # MailWatcher, avviato in main()
SERVER = None
NET = {"hosts": {"127.0.0.1", "localhost", "::1"}, "tls": False, "scheme": "http"}


def _code_version():
    """Impronta dei file del programma: cambia a ogni aggiornamento del codice o dell'interfaccia."""
    h = hashlib.sha1()
    for f in sorted([*BASE_DIR.glob("*.py"), *UI_DIR.rglob("*")]):
        if f.is_file():
            st = f.stat()
            h.update(f"{f.relative_to(BASE_DIR)}|{st.st_mtime_ns}|{st.st_size}".encode())
    return h.hexdigest()[:12]


CODE_VERSION = _code_version()


def _busy():
    return JOB.running or bool(MAIL and MAIL.status.get("busy"))


WATCHDOG_GRACE = 30 * 60  # oltre questo ritardo del ciclo della posta (fuori da un caricamento) il programma si riavvia


def health():
    """Stato per i controlli esterni: il ciclo della posta gira? l'accesso a Viewpoint c'e'? Nessun dato sensibile."""
    problems = []
    mail = {"attiva": False}
    if MAIL:
        st = MAIL.status
        late = time.time() - (st.get("heartbeat") or 0)
        limit = max(WATCHDOG_GRACE, 5 * (st.get("wait") or 120))
        mail = {"attiva": bool(st.get("enabled")), "thread_vivo": MAIL.is_alive(), "ultimo_giro": st.get("last_cycle"),
                "secondi_dall_ultimo_ciclo": int(late), "in_caricamento": bool(st.get("busy"))}
        if not MAIL.is_alive():
            problems.append("controllo posta fermo")
        elif late > limit and not st.get("busy"):
            problems.append(f"controllo posta bloccato da {int(late // 60)} minuti")
        if st.get("login_needed"):
            problems.append("accesso a Viewpoint da rifare")
        if st.get("enabled") and st.get("problems"):
            problems.append("impostazioni della posta incomplete")
    return {"stato": "ok" if not problems else "problema", "problemi": problems, "versione": CODE_VERSION,
            "posta": mail, "trasferimento_in_corso": JOB.running, "ora": time.time()}


def _watchdog():
    """Se il ciclo della posta si blocca (thread morto o fermo da troppo), il programma esce con errore:
    l'operazione pianificata di Windows lo riavvia dopo un minuto (vedi installa_avvio_automatico.ps1)."""
    while True:
        time.sleep(60)
        if not MAIL or JOB.running:
            continue
        info = health()
        stuck = [p for p in info["problemi"] if p.startswith("controllo posta")]
        if stuck:
            log.critical("Sorveglianza: %s. Riavvio del programma", "; ".join(stuck))
            logging.shutdown()
            os._exit(3)


def api_info():
    return {"version": CODE_VERSION, "busy": _busy()}


def api_shutdown():
    """Chiusura richiesta da un nuovo avvio con codice aggiornato: mai durante un caricamento."""
    if _busy():
        raise ValueError("Caricamento in corso: chiusura rimandata")
    log.warning("Chiusura richiesta da un avvio con versione aggiornata del programma")
    threading.Thread(target=SERVER.shutdown, daemon=True).start()
    return {"ok": True}


def _call_running(port, path, post=False):
    try:
        key = INSTANCE_PATH.read_text(encoding="utf-8").strip()  # scritta dall'istanza attiva all'avvio
    except OSError:
        key = ""
    req = Request(f"{NET['scheme']}://127.0.0.1:{port}{path}", data=b"{}" if post else None, method="POST" if post else "GET",
                  headers={"X-VFP-UI": "1", "Content-Type": "application/json", "X-VFP-Shutdown": key})
    ctx = None
    if NET["tls"]:  # l'istanza attiva su questo stesso PC: il certificato e' per il nome di rete, non per 127.0.0.1
        ctx = ssl.create_default_context()
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    with urlopen(req, timeout=5, context=ctx) as r:
        return json.loads(r.read() or b"{}")


def _replace_old_instance(port):
    """
    True se si puo' avviare questa istanza: la porta e' libera, oppure l'istanza attiva aveva codice
    vecchio ed era ferma, e si e' chiusa da sola. False se l'istanza attiva va lasciata dov'e'.
    """
    try:
        info = _call_running(port, "/api/info")
    except Exception:
        log.warning("Sulla porta %s gira una versione vecchia del programma che non si puo' riavviare da qui: "
                    "chiudere la sua finestra (o riavviare il PC) e rilanciare.", port)
        return False
    if info.get("version") == CODE_VERSION:
        return False  # stessa versione gia' attiva
    if info.get("busy"):
        log.warning("Versione vecchia attiva ma occupata in un caricamento: aggiornamento rimandato al prossimo avvio")
        return False
    try:
        _call_running(port, "/api/shutdown", post=True)
    except Exception as e:
        log.warning("Impossibile chiudere la versione vecchia: %s", e)
        return False
    for _ in range(30):  # attende che la porta si liberi
        if not _already_running(port):
            log.info("Versione vecchia chiusa: avvio della versione aggiornata")
            return True
        time.sleep(0.5)
    return False


def _setup_logging():
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if sys.stderr:  # con pythonw (avvio automatico) non c'e' console
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        root.addHandler(console)
    LOG_PATH.parent.mkdir(exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)
    root.addHandler(LOGS)
    avvisi_portale.collega_log()  # errori anche nella pagina Avvisi del Portale
    logging.getLogger("vfp_transfer").addFilter(_UploadPartFilter())
    # eccezioni non gestite in qualunque thread finiscono nel registro invece di sparire
    sys.excepthook = lambda *exc: logging.critical("Errore non gestito", exc_info=exc)
    threading.excepthook = lambda a: logging.critical("Errore non gestito nel thread %s", a.thread and a.thread.name,
                                                      exc_info=(a.exc_type, a.exc_value, a.exc_traceback))


def _network_setup(settings):
    """Indirizzo su cui ascoltare. Fuori da questo PC solo in HTTPS con certificato valido, altrimenti si resta locali."""
    bind = settings.get("GUI_BIND") or "127.0.0.1"
    if env_config.is_local_bind(bind):
        return "127.0.0.1"
    try:
        env_config.validate_network(bind, settings.get("GUI_HOSTNAME", ""), settings.get("GUI_TLS_CERT", ""),
                                    settings.get("GUI_TLS_KEY", ""))
    except ValueError as e:
        log.error("Accesso dalla rete non attivato (%s): interfaccia solo da questo PC", e)
        return "127.0.0.1"
    NET.update(tls=True, scheme="https")
    NET["hosts"] = NET["hosts"] | {settings["GUI_HOSTNAME"].lower()}
    return bind


def _already_running(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def main():
    global MAIL, SERVER
    parser = argparse.ArgumentParser(description="Interfaccia web locale e servizio posta per il trasferimento verso VFP.")
    parser.add_argument("--port", type=int, default=None, help="porta (predefinita: GUI_PORT nel .env, 8770)")
    parser.add_argument("--no-browser", action="store_true", help="non aprire il browser all'avvio")
    parser.add_argument("--service", action="store_true", help="modalita' avvio automatico: niente browser")
    args = parser.parse_args()

    _setup_logging()
    settings = env_config.load_settings()
    port = args.port or int(settings.get("GUI_PORT") or 8770)
    bind = _network_setup(settings)
    url = f"{NET['scheme']}://127.0.0.1:{port}/"
    if _already_running(port) and not _replace_old_instance(port):
        # c'e' gia' un'istanza attiva e aggiornata (es. avvio automatico): si apre solo la pagina
        log.info("Programma gia' attivo su %s", url)
        if not (args.no_browser or args.service):
            webbrowser.open(url)
        return

    server = SERVER = ThreadingHTTPServer((bind, port), Handler)
    if NET["tls"]:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(env_config.resolve_path(settings["GUI_TLS_CERT"]), env_config.resolve_path(settings["GUI_TLS_KEY"]))
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        log.warning("Interfaccia raggiungibile dalla rete: https://%s:%s/ (indirizzo %s)", settings["GUI_HOSTNAME"], port, bind)
    INSTANCE_PATH.write_text(INSTANCE_KEY, encoding="utf-8")
    if not auth.load_users():
        log.warning("Nessun utente configurato: creare l'amministratore con  python auth.py aggiungi NOME --ruolo admin")
    MAIL = vfp_mail.MailWatcher(tokens_for, TRANSFER_LOCK, STATE_PATH, REPORT_PATH, MAIL_STATE_PATH, MAIL_LOG_PATH)
    MAIL.start()
    api_posta.WATCHER = MAIL
    threading.Thread(target=_watchdog, name="sorveglianza", daemon=True).start()
    threading.Thread(target=_controllo_modelli, name="controllo-modelli", daemon=True).start()
    log.info("Interfaccia trasferimento VFP attiva su %s", url)
    if sys.stdout:
        print(f"Interfaccia trasferimento VFP attiva su {url}\nLasciare aperta questa finestra; per chiuderla premere Ctrl+C.")
    if not (args.no_browser or args.service):
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
