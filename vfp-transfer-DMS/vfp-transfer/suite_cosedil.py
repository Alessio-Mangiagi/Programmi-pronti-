# "><(((º> sabusabu <º)))><"
"""
Aggancio al modulo condiviso della suite (``shared/suite/suite_link.py``): token di servizio, chiamate a
SkyTower, registro delle commesse. Da qui VFP Transfer usa SkyTower come DMS (``DMS_TIPO=skytower``) e vi
archivia gli allegati della posta (``MAIL_SKYTOWER``).
"""

import re
import sys
from pathlib import Path

_SHARED = Path(__file__).resolve().parents[2] / "shared" / "suite"
if str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))
import suite_link  # noqa: E402

_CON_CIFRE = re.compile(r"\d")


def codice_commessa(testo, solo_registro=False):
    """Il codice commessa aziendale dentro un testo libero ("101-003 SEDE ACIREALE", oggetto di un'email...).

    Prima il registro della suite (``shared/suite/commesse.json``): vince il codice piu' lungo contenuto nel
    testo (confronto senza spazi e maiuscole). Senza registro, se ``solo_registro`` e' falso, il primo pezzo
    del testo che contiene una cifra (es. "101-003"), altrimenti il testo intero. Stringa vuota se non c'e' niente.
    """
    testo = (testo or "").strip()
    if not testo:
        return ""
    norm = suite_link.normalizza_commessa(testo)
    migliore = ""
    for c in suite_link.commesse():
        k = suite_link.normalizza_commessa(c["code"])
        if k and k in norm and len(k) > len(suite_link.normalizza_commessa(migliore)):
            migliore = c["code"]
    if migliore or solo_registro:
        return migliore
    for pezzo in testo.split():
        if _CON_CIFRE.search(pezzo):
            return pezzo
    return testo


def percorso_commessa(codice):
    """Il codice nel percorso di una rotta /suite: spazi e caratteri speciali codificati."""
    from urllib.parse import quote
    return quote(codice, safe="")
