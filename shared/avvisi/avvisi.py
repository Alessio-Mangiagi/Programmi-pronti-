# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
avvisi.py — segnala un avviso agli amministratori del Portale.

Gemello di avvisi.js: un avviso è un file JSON lasciato nella cartella di arrivo
del Portale (SUITE_AVVISI_DIR, altrimenti portale/data/avvisi-in), che lo
raccoglie e lo mostra nella pagina Avvisi e alla plancia dell'admin.

Uso, dopo aver messo shared/avvisi nel sys.path:

    import avvisi
    avvisi.segnala("scadenzario", "Email di riepilogo non inviata", dettaglio,
                   livello="errore", chiave="email")

segnala() non solleva mai: un avviso perso non deve far fallire il lavoro.
"""

import json
import os
import secrets
import time
from datetime import datetime, timezone

LIVELLI = ("info", "attenzione", "errore")


def cartella_avvisi():
    env = os.environ.get("SUITE_AVVISI_DIR", "").strip()
    if env:
        return os.path.abspath(env)
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
        os.makedirs(cartella, exist_ok=True)
        nome = f"{int(time.time() * 1000)}-{os.getpid()}-{secrets.token_hex(3)}"
        tmp = os.path.join(cartella, nome + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(avviso, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(cartella, nome + ".json"))
        return True
    except Exception:
        return False
