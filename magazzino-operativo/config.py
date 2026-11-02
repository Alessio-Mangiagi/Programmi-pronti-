# "><(((º> sabusabu <º)))><"
"""Configurazione del Magazzino Operativo Cosedil.

Costanti condivise da app.py, database.py, importa_ddt.py e importa_mezzi.py.
Tutto quello che dipende dalla macchina arriva da variabili d'ambiente, con un
default che funziona dentro la cartella della suite (cartelle sorelle).
"""
import os

# Cartella del progetto (posizione di questo file) e radice della suite
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SUITE_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))

# Indirizzo di ascolto. Default locale; in LAN il portale passa il proprio HOST
# alle app che avvia (HOST=0.0.0.0). L'accesso resta protetto dal gate SSO.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5200"))

# Database SQLite (creato a runtime, in .gitignore)
DB_PATH = os.environ.get("MAGAZZINO_DB", os.path.join(BASE_DIR, "magazzino.db"))

# Sorgente dei DDT: la cartella dati del Lettore DDT, con una sottocartella per
# commessa e dentro consegne.json (il registro delle consegne già normalizzato).
DDT_DATA_DIR = os.environ.get("MAGAZZINO_DDT_DIR", os.path.join(SUITE_DIR, "lettore-ddt", "data"))
# Sorgente dei mezzi a nolo: le pratiche di VFP Transfer (una cartella per
# pratica con record.json).
MEZZI_VFP_DIR = os.environ.get(
    "MAGAZZINO_MEZZI_DIR",
    os.path.join(SUITE_DIR, "vfp-transfer-DMS", "vfp-transfer", "moduli_compilati", "mezzi"))

# Ogni quanti secondi il thread di sfondo ricontrolla le due cartelle.
# 0 = nessuna importazione automatica (solo a mano dalla pagina Importazioni).
IMPORT_INTERVALLO_SEC = int(os.environ.get("MAGAZZINO_IMPORT_SEC", "120"))

# Cartelle del Lettore DDT che non sono commesse vere
COMMESSE_IGNORATE = {"__test__"}

# Prefissi dei codici a barre interni
PREFISSO_ARTICOLO = "MAG"
PREFISSO_MEZZO = "MEZ"
PREFISSO_UBICAZIONE = "UBI"

# Ubicazione predefinita dove finisce il materiale senza destinazione leggibile
UBICAZIONE_DEFAULT = "Deposito centrale"

# Limite upload JSON (byte)
UPLOAD_MAX_BYTE = 20 * 1024 * 1024

# Utenti admin del magazzino oltre agli admin del portale: lista separata da
# virgole (username). Vuota = basta essere admin dell'app nel portale.
ADMIN_UTENTI = {u.strip().lower() for u in os.environ.get("MAGAZZINO_ADMIN", "").split(",") if u.strip()}
