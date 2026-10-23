# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
avvisi.py — segnala un avviso agli amministratori del Portale.

Gemello di avvisi.js: un avviso è un file JSON lasciato nella cartella di arrivo
del Portale (SUITE_AVVISI_DIR, altrimenti portale/data/avvisi-in), che lo
raccoglie e lo mostra nella pagina Avvisi e alla plancia dell'admin.
Gli errori del log (logging) arrivano da soli con collega_log(app).

Uso, dopo aver messo shared/avvisi nel sys.path:

    import avvisi
    avvisi.segnala("scadenzario", "Email di riepilogo non inviata", dettaglio,
                   livello="errore", chiave="email")

segnala() non solleva mai: un avviso perso non deve far fallire il lavoro.
"""

import json
import logging
import os
import re
import secrets
import sys
import threading
import time
from datetime import datetime, timezone

LIVELLI = ("info", "attenzione", "errore")
# Lo stesso errore dal log non scrive più di un file a questo intervallo: un
# errore in un ciclo stretto non deve riempire la cartella del portale.
FRENO_SECONDI = 60


def _sotto_test():
    if "PYTEST_CURRENT_TEST" in os.environ:
        return True
    principale = getattr(sys.modules.get("__main__"), "__file__", "") or ""
    return principale.replace("\\", "/").endswith(("unittest/__main__.py", "pytest/__main__.py"))


def cartella_avvisi():
    env = os.environ.get("SUITE_AVVISI_DIR", "").strip()
    if env:
        return os.path.abspath(env)
    # Sotto test (pytest, python -m unittest) solo una cartella indicata
    # apposta: un test che prova un errore non deve finire nel portale vero.
    if _sotto_test():
        return ""
    qui = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(qui, "..", "..", "portale", "data", "avvisi-in"))


def segnala(app, titolo, testo="", livello="attenzione", chiave=""):
    """Lascia un avviso per gli admin. Ritorna True se il file è stato scritto."""
    try:
        if not app or not titolo:
            return False
        avviso = {
            "app": str(app)[:40],
            "titolo": str(titolo)[:200],
            "testo": str(testo or "")[:4000],
            "livello": livello if livello in LIVELLI else "attenzione",
            "chiave": str(chiave or "")[:200],
            "data": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        cartella = cartella_avvisi()
        if not cartella:
            return False
        os.makedirs(cartella, exist_ok=True)
        nome = f"{int(time.time() * 1000)}-{os.getpid()}-{secrets.token_hex(3)}"
        tmp = os.path.join(cartella, nome + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(avviso, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(cartella, nome + ".json"))
        return True
    except Exception:
        return False


# --------------------------------------------------------------------------- errori dal log

def chiave_da_messaggio(messaggio):
    """Chiave di accorpamento: prima riga, numeri e percorsi tolti, così
    "Job 12 fallito" e "Job 13 fallito" diventano un avviso solo col contatore."""
    riga = str(messaggio or "").strip().splitlines()[0] if str(messaggio or "").strip() else ""
    riga = re.sub(r"[A-Za-z]:\\[^\s'\"]+|/[^\s'\"]+/[^\s'\"]*", "<percorso>", riga)
    return "log:" + re.sub(r"\d+", "#", riga)[:150]


class GestoreAvvisi(logging.Handler):
    """Handler di logging: ogni ERROR/CRITICAL diventa un avviso per il portale."""

    def __init__(self, app, livello=logging.ERROR):
        super().__init__(livello)
        self.app = app
        self._ultimi = {}
        self._lock_freno = threading.Lock()

    def emit(self, record):
        try:
            messaggio = record.getMessage()
            chiave = chiave_da_messaggio(messaggio)
            ora = time.monotonic()
            with self._lock_freno:
                if ora - self._ultimi.get(chiave, -FRENO_SECONDI) < FRENO_SECONDI:
                    return
                self._ultimi[chiave] = ora
            testo = messaggio
            if record.exc_info:
                testo += "\n\n" + logging.Formatter().formatException(record.exc_info)
            titolo = messaggio.strip().splitlines()[0] if messaggio.strip() else record.levelname
            segnala(self.app, titolo, testo, livello="errore", chiave=chiave)
        except Exception:  # un handler di log non deve mai rompere chi logga
            pass


def collega_log(app, logger=None, livello=logging.ERROR):
    """Inoltra al portale gli errori del logger (default: root). Idempotente."""
    logger = logger if logger is not None else logging.getLogger()
    for h in logger.handlers:
        if isinstance(h, GestoreAvvisi) and h.app == app:
            return h
    h = GestoreAvvisi(app, livello)
    logger.addHandler(h)
    return h
