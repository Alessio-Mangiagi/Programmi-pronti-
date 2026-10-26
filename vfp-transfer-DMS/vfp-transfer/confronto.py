# "><(((º> sabusabu <º)))><"
"""
Confronto documenti dentro il programma, per tutti gli utenti (pagina "Confronta documenti").

Il motore e' l'app confronto-documenti (cartella sorella del repository: OCR, differenze, anteprime, report):
qui non c'e' una copia della sua logica. vfp_gui la avvia come processo figlio con il suo .venv:
  - solo su 127.0.0.1, su una porta libera scelta all'avvio;
  - con una password casuale (CONFRONTO_PASSWORD del motore, HTTP Basic) che conosce solo questo processo:
    gli altri programmi del PC non possono usarlo, gli utenti passano sempre da vfp_gui (login, permessi);
  - legato al programma con un Job Object di Windows: se vfp_gui si chiude o viene riavviato, il motore muore
    con lui (niente processi orfani dopo l'uscita del controllo di sorveglianza).

Chi puo' vedere cosa: ogni confronto ha un proprietario (REGISTRO, confronti/registro.json). L'utente vede e
apre solo i suoi, l'amministratore tutti. I file caricati restano solo il tempo del confronto (li cancella il
motore); il risultato e le anteprime restano nello storico del motore per 30 giorni (confronti/storico).
"""

import atexit
import ctypes
import json
import logging
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from base64 import b64encode
from datetime import datetime, timedelta
from http.client import HTTPConnection
from pathlib import Path

import env_config

log = logging.getLogger("confronto")

DATI = env_config.BASE_DIR / "confronti"
REGISTRO = DATI / "registro.json"
LOG_MOTORE = env_config.BASE_DIR / "logs" / "confronto_motore.log"
GIORNI = 30                       # come lo storico del motore (CONFRONTO_STORICO_GIORNI)
MAX_UPLOAD = 200 * 1024 * 1024    # come MAX_CONTENT_LENGTH del motore
MAX_PER_UTENTE = 200              # confronti elencati per utente
BLOCCO = 1024 * 1024
ID_RE = re.compile(r"^[0-9a-f]{12}$")
UTENTE_MOTORE = "vfp"


class MotoreNonDisponibile(Exception):
    """Motore assente, senza librerie o che non parte: la pagina lo spiega invece di dare un errore generico."""


def cartella_motore(settings=None):
    s = settings or env_config.load_settings()
    if s.get("CONFRONTO_DIR"):
        return env_config.resolve_path(s["CONFRONTO_DIR"])
    return env_config.BASE_DIR.parent.parent / "confronto-documenti"


def python_motore(settings=None):
    s = settings or env_config.load_settings()
    if s.get("CONFRONTO_PYTHON"):
        return env_config.resolve_path(s["CONFRONTO_PYTHON"])
    venv = cartella_motore(s) / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return venv if venv.is_file() else Path(sys.executable)


# --------------------------------------------------------------------------- legame con il processo padre

def _lega_al_programma(proc):
    """Job Object con KILL_ON_JOB_CLOSE: alla chiusura di questo processo Windows chiude anche il motore."""
    if os.name != "nt":
        return None
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = ctypes.c_void_p
        k32.OpenProcess.restype = ctypes.c_void_p
        job = k32.CreateJobObjectW(None, None)

        class LIMITI(ctypes.Structure):  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32),
                        ("SchedulingClass", ctypes.c_uint32), ("IoInfo", ctypes.c_uint64 * 6),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        info = LIMITI(LimitFlags=0x2000)  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(ctypes.c_void_p(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
            raise OSError(ctypes.get_last_error())
        handle = k32.OpenProcess(0x0101, False, proc.pid)  # PROCESS_TERMINATE | PROCESS_SET_QUOTA
        if not handle or not k32.AssignProcessToJobObject(ctypes.c_void_p(job), ctypes.c_void_p(handle)):
            raise OSError(ctypes.get_last_error())
        k32.CloseHandle(ctypes.c_void_p(handle))
        return job  # resta aperto fino all'uscita del programma
    except (OSError, AttributeError) as e:
        log.warning("Motore del confronto non legato al programma (%s): si chiude solo all'uscita normale", e)
        return None


# --------------------------------------------------------------------------- motore

class Motore:
    """Processo del motore e chiamate verso di lui (sempre su 127.0.0.1, con la password del processo)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.proc = None
        self.porta = None
        self.segreto = ""
        self._job = None
        self.errore = ""

    def collega(self, porta, segreto):
        """Motore gia' in ascolto (test): niente processo da avviare."""
        self.porta, self.segreto, self.proc = porta, segreto, None

    def _vivo(self):
        if self.porta is None:
            return False
        if self.proc is not None and self.proc.poll() is not None:
            return False
        return True

    def avvia(self):
        with self.lock:
            if self._vivo():
                return
            settings = env_config.load_settings()
            cartella, python = cartella_motore(settings), python_motore(settings)
            if not (cartella / "server.py").is_file():
                self.errore = f"motore del confronto non trovato in {cartella}"
                raise MotoreNonDisponibile(self.errore)
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                porta = s.getsockname()[1]
            segreto = secrets.token_urlsafe(32)
            env = dict(os.environ, HOST="127.0.0.1", PORT=str(porta), COSEDIL_SSO="off",
                       CONFRONTO_PASSWORD=segreto, CONFRONTO_UTENTE=UTENTE_MOTORE, CONFRONTO_DATI=str(DATI),
                       PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
            DATI.mkdir(parents=True, exist_ok=True)
            LOG_MOTORE.parent.mkdir(exist_ok=True)
            out = open(LOG_MOTORE, "ab")
            try:
                proc = subprocess.Popen([str(python), "-W", "ignore", "server.py"], cwd=cartella, env=env,
                                        stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError as e:
                self.errore = f"motore del confronto non avviato: {e}"
                raise MotoreNonDisponibile(self.errore)
            finally:
                out.close()
            self._job = _lega_al_programma(proc)
            self.proc, self.porta, self.segreto = proc, porta, segreto
            for _ in range(120):  # il primo avvio carica PyMuPDF e numpy: qualche secondo
                if proc.poll() is not None:
                    break
                try:
                    if self._chiama("GET", "/healthz", timeout=2)[0] == 200:
                        self.errore = ""
                        log.info("Motore del confronto attivo (porta %s, %s)", porta, python)
                        return
                except OSError:
                    pass
                time.sleep(0.25)
            self.ferma()
            self.errore = f"il motore del confronto non risponde (vedi {LOG_MOTORE.name})"
            raise MotoreNonDisponibile(self.errore)

    def ferma(self):
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc, self.porta = None, None

    def _intestazioni(self):
        cred = b64encode(f"{UTENTE_MOTORE}:{self.segreto}".encode()).decode()
        return {"Authorization": f"Basic {cred}"}

    def _chiama(self, metodo, path, corpo=None, intestazioni=None, timeout=60):
        conn = HTTPConnection("127.0.0.1", self.porta, timeout=timeout)
        try:
            conn.request(metodo, path, body=corpo, headers={**self._intestazioni(), **(intestazioni or {})})
            r = conn.getresponse()
            return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
        finally:
            conn.close()

    def chiama(self, metodo, path, corpo=None, intestazioni=None, timeout=60):
        """(stato, intestazioni, corpo) dal motore; lo avvia se serve, e lo riavvia una volta se e' caduto."""
        for tentativo in (1, 2):
            if not self._vivo():
                self.avvia()
            try:
                return self._chiama(metodo, path, corpo, intestazioni, timeout)
            except ConnectionError:
                if tentativo == 2 or self.proc is None:
                    raise MotoreNonDisponibile("il motore del confronto non risponde")
                self.ferma()

    def invia_file(self, content_type, lunghezza, sorgente):
        """Inoltra al motore i due file del confronto (multipart) a blocchi, senza tenerli tutti in memoria."""
        if not self._vivo():
            self.avvia()
        conn = HTTPConnection("127.0.0.1", self.porta, timeout=300)
        try:
            conn.putrequest("POST", "/api/compare")
            for k, v in {**self._intestazioni(), "Content-Type": content_type, "Content-Length": str(lunghezza)}.items():
                conn.putheader(k, v)
            conn.endheaders()
            resto = lunghezza
            while resto:
                blocco = sorgente.read(min(BLOCCO, resto))
                if not blocco:
                    raise ValueError("caricamento interrotto")
                conn.send(blocco)
                resto -= len(blocco)
            r = conn.getresponse()
            return r.status, r.read()
        except ConnectionError:
            raise MotoreNonDisponibile("il motore del confronto non risponde")
        finally:
            conn.close()


MOTORE = Motore()
atexit.register(MOTORE.ferma)


# --------------------------------------------------------------------------- registro: chi ha fatto cosa

_reg_lock = threading.Lock()


def _leggi():
    try:
        dati = json.loads(REGISTRO.read_text(encoding="utf-8"))
        return dati if isinstance(dati, dict) else {}
    except (OSError, ValueError):
        return {}


def _scrivi(dati):
    REGISTRO.parent.mkdir(parents=True, exist_ok=True)
    tmp = REGISTRO.with_suffix(".tmp")
    tmp.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, REGISTRO)


def registra(job_id, utente, nome_a, nome_b):
    limite = (datetime.now() - timedelta(days=GIORNI)).isoformat(timespec="seconds")
    with _reg_lock:
        dati = {k: v for k, v in _leggi().items() if v.get("creato", "") >= limite}  # scaduti anche nel motore
        dati[job_id] = {"utente": utente, "name_a": nome_a, "name_b": nome_b,
                        "creato": datetime.now().isoformat(timespec="seconds")}
        _scrivi(dati)


def togli(job_id):
    with _reg_lock:
        dati = _leggi()
        if dati.pop(job_id, None) is not None:
            _scrivi(dati)


def proprietario(job_id):
    return (_leggi().get(job_id) or {}).get("utente")


def puo_vedere(job_id, sess):
    """Solo id ben formati, e solo il proprietario o l'amministratore."""
    if not ID_RE.match(job_id or ""):
        return False
    chi = proprietario(job_id)
    return chi is not None and (sess["role"] == "admin" or chi == sess["user"])


def elenco(sess):
    """Confronti visibili da chi chiede, dal piu' recente, con l'esito letto dal motore."""
    voci = [(k, v) for k, v in _leggi().items() if sess["role"] == "admin" or v.get("utente") == sess["user"]]
    voci.sort(key=lambda kv: kv[1].get("creato", ""), reverse=True)
    voci = voci[:MAX_PER_UTENTE]
    salvati = {}
    if voci:
        stato, _, corpo = MOTORE.chiama("GET", "/api/storico?ids=" + ",".join(k for k, _ in voci))
        if stato == 200:
            salvati = {c["id"]: c for c in json.loads(corpo).get("confronti", [])}
    out = []
    for job_id, v in voci:
        c = salvati.get(job_id)
        if c is None:  # non ancora finito (in RAM nel motore), annullato o scaduto
            stato, _, corpo = MOTORE.chiama("GET", f"/api/jobs/{job_id}")
            c = json.loads(corpo) if stato == 200 else {"status": "scaduto"}
        out.append({"id": job_id, "utente": v.get("utente"), "name_a": v.get("name_a"), "name_b": v.get("name_b"),
                    "creato": v.get("creato"), "status": c.get("status"), "message": c.get("message", ""),
                    "diff_count": c.get("diff_count")})
    return out
