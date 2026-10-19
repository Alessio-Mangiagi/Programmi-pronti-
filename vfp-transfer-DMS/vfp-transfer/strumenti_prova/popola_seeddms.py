# "><(((º> sabusabu <º)))><"
"""
Riempie un SeedDMS DI PROVA con commesse finte (cartelle, documenti, piu' revisioni) per provare
l'estrazione (estrai_dms.py) senza toccare il DMS vero.

Scrive nel DMS: per sicurezza accetta solo indirizzi locali (127.0.0.1 / localhost).

    python strumenti_prova/popola_seeddms.py --url http://127.0.0.1:8780/restapi/index.php --user admin
La password si chiede a video (oppure variabile SEEDDMS_PASSWORD).
"""

import argparse
import getpass
import os
import sys
from urllib.parse import urlparse

import requests

RADICE = "Commesse di prova"

# commessa -> cartella -> [(nome documento, estensione, [commenti delle revisioni])]
COMMESSE = {
    "C-2024-015 Scuola Via Roma": {
        "Architettonico/Piante": [
            ("PL-001 Pianta piano terra", ".pdf", ["Prima emissione", "Aggiornamento quote", "Variante bagni"]),
            ("PL-002 Pianta primo piano", ".pdf", ["Prima emissione"]),
        ],
        "Architettonico/Prospetti": [
            ("PR-001 Prospetto nord", ".pdf", ["Prima emissione", "Colori facciata"]),
        ],
        "Strutture": [
            ("ST-010 Fondazioni", ".dwg", ["Emissione A", "Emissione B"]),
            ("Relazione di calcolo – rev. è/à", ".pdf", ["Caratteri speciali nel nome"]),
        ],
        "Impianti/Elettrico": [
            ("EL-100 Schema quadro generale", ".pdf", ["Prima emissione"]),
        ],
        "Impianti/Meccanico": [],  # cartella vuota: deve comparire lo stesso
    },
    "C-2025-003 Palazzina Bianchi": {
        "Contratti": [
            ("Contratto di appalto", ".pdf", ["Firmato"]),
            ("Computo metrico", ".xlsx", ["Bozza", "Definitivo"]),
        ],
        "Foto cantiere": [
            ("Sopralluogo 2025-03-12", ".jpg", ["Foto"]),
        ],
        "Documento grande": [
            ("Tavole complete", ".pdf", ["File da 12 MB per provare il download a blocchi"]),
        ],
    },
}


def contenuto_finto(nome, est, revisione, nota):
    """File finto ma riconoscibile; 'grande' per il caso del download a blocchi."""
    testo = f"{nome}\nRevisione {revisione}: {nota}\n"
    if est == ".pdf":
        corpo = (f"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
                 f"% {testo}trailer<</Root 1 0 R>>\n%%EOF\n").encode("utf-8")
    else:
        corpo = testo.encode("utf-8")
    if "12 MB" in nota:
        corpo += os.urandom(12 * 1024 * 1024)
    return corpo


class SeedDms:
    def __init__(self, url, user, password):
        host = urlparse(url).hostname
        if host not in ("127.0.0.1", "localhost", "::1"):
            sys.exit(f"Rifiutato: questo script scrive nel DMS e funziona solo su un SeedDMS locale di prova, non su {host}.")
        self.url = url.rstrip("/")
        self.s = requests.Session()
        self._call("post", "/login", data={"user": user, "pass": password})

    def _call(self, method, path, **kw):
        r = self.s.request(method, self.url + path, timeout=120, **kw)
        try:
            body = r.json()
        except ValueError:
            body = {}
        if r.status_code >= 400 or not body.get("success"):
            sys.exit(f"Errore SeedDMS {r.status_code} su {path}: {body.get('message') or r.text[:200]}")
        return body["data"]

    def figli(self, folder_id):
        return self._call("get", f"/folder/{folder_id}/children")

    def nuova_cartella(self, parent_id, nome):
        for f in self.figli(parent_id):
            if f["type"] == "folder" and f["name"] == nome:
                return f["id"]
        return self._call("post", f"/folder/{parent_id}/folder", data={"name": nome})["id"]

    def nuovo_documento(self, folder_id, nome, file_name, corpo, nota):
        data = {"name": nome, "comment": f"Documento di prova: {nome}", "version_comment": nota}
        return self._call("post", f"/folder/{folder_id}/document", data=data,
                          files={"file": (file_name, corpo)})["id"]

    def nuova_revisione(self, doc_id, file_name, corpo, nota):
        self._call("post", f"/document/{doc_id}/update", data={"comment": nota}, files={"file": (file_name, corpo)})

    def esci(self):
        self.s.get(self.url + "/logout", timeout=30)


def main():
    p = argparse.ArgumentParser(description="Riempie un SeedDMS locale di prova con commesse finte.")
    p.add_argument("--url", default="http://127.0.0.1:8780/restapi/index.php")
    p.add_argument("--user", default="admin")
    args = p.parse_args()
    password = os.environ.get("SEEDDMS_PASSWORD") or getpass.getpass(f"Password SeedDMS per {args.user}: ")

    dms = SeedDms(args.url, args.user, password)
    if any(f["type"] == "folder" and f["name"] == RADICE for f in dms.figli(1)):
        sys.exit(f"La cartella '{RADICE}' esiste gia': cancellarla dall'interfaccia di SeedDMS per ripopolare.")
    radice = dms.nuova_cartella(1, RADICE)
    documenti = revisioni = 0
    for commessa, cartelle in COMMESSE.items():
        id_commessa = dms.nuova_cartella(radice, commessa)
        for percorso, docs in cartelle.items():
            parent = id_commessa
            for parte in percorso.split("/"):
                parent = dms.nuova_cartella(parent, parte)
            for nome, est, note in docs:
                file_name = nome.split(" ")[0] + est
                doc_id = None
                for n, nota in enumerate(note, start=1):
                    corpo = contenuto_finto(nome, est, n, nota)
                    if doc_id is None:
                        doc_id = dms.nuovo_documento(parent, nome, file_name, corpo, nota)
                        documenti += 1
                    else:
                        dms.nuova_revisione(doc_id, file_name, corpo, nota)
                    revisioni += 1
        print(f"  {commessa}: fatto")
    dms.esci()
    print(f"Creati {documenti} documenti con {revisioni} revisioni in totale, sotto '{RADICE}' (cartella {radice}).")


if __name__ == "__main__":
    main()
