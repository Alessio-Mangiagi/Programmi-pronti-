# "><(((º> sabusabu <º)))><"
"""
Ponte verso shared/avvisi: gli avvisi del programma arrivano agli admin del Portale (pagina Avvisi).

Il programma puo' girare anche fuori dalla suite (avvio automatico su un PC qualunque): se shared/avvisi non c'e',
segnala e collega_log non fanno niente e il resto funziona come prima.
"""

import os
import sys

APP = "vfp"  # nome nel Portale: "VFP Transfer"

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared", "avvisi"))
try:
    import avvisi as _avvisi
except ImportError:  # fuori dalla suite
    _avvisi = None


def segnala(titolo, testo="", livello="attenzione", chiave=""):
    return bool(_avvisi) and _avvisi.segnala(APP, titolo, testo, livello=livello, chiave=chiave)


def collega_log():
    """Errori e critici del registro diventano avvisi per il Portale."""
    return _avvisi.collega_log(APP) if _avvisi else None
