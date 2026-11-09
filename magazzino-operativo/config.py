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

# Backup automatico del database (backup.py): cartella delle copie (default backup/ accanto al database,
# in .gitignore), ogni quante ore farne una (0 = spento) e quante tenerne (le più vecchie si cancellano).
# Per stare al sicuro da un disco rotto conviene puntare MAGAZZINO_BACKUP_DIR su un altro disco o sul NAS.
BACKUP_DIR = os.environ.get("MAGAZZINO_BACKUP_DIR", os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "backup"))
BACKUP_ORE = float(os.environ.get("MAGAZZINO_BACKUP_ORE", "24"))
BACKUP_TENERE = max(1, int(os.environ.get("MAGAZZINO_BACKUP_TENERE", "14")))

# Sorgente dei DDT: la cartella dati del Lettore DDT, con una sottocartella per
# commessa e dentro consegne.json (il registro delle consegne già normalizzato).
DDT_DATA_DIR = os.environ.get("MAGAZZINO_DDT_DIR", os.path.join(SUITE_DIR, "lettore-ddt", "data"))
# Sorgente dei mezzi a nolo: le pratiche di VFP Transfer (una cartella per
# pratica con record.json).
MEZZI_VFP_DIR = os.environ.get(
    "MAGAZZINO_MEZZI_DIR",
    os.path.join(SUITE_DIR, "vfp-transfer-DMS", "vfp-transfer", "moduli_compilati", "mezzi"))

# Riepilogo giornaliero dei movimenti caricato in SkyTower per ogni commessa (riepilogo.py):
# ora del giro automatico, HH:MM. Vuoto, "off" o "0" = solo a richiesta dal pulsante della pagina.
RIEPILOGO_ORA = os.environ.get("MAGAZZINO_RIEPILOGO_ORA", "19:00")

# Programma unico "DDT e Magazzino" (09/11/2026): gli utenti aprono il Magazzino dentro il Lettore
# DDT, all'indirizzo <Lettore DDT>/magazzino. I link che il Magazzino manda fuori (da fare del
# portale, InCampo, task) puntano lì. MAGAZZINO_URL_PUBBLICO li forza a un altro indirizzo;
# MAGAZZINO_PROGRAMMA_UNICO=0 torna all'indirizzo proprio del Magazzino (uso da solo, senza DDT).
URL_PUBBLICO = os.environ.get("MAGAZZINO_URL_PUBBLICO", "").strip().rstrip("/")
PROGRAMMA_UNICO = os.environ.get("MAGAZZINO_PROGRAMMA_UNICO", "1").strip().lower() not in ("0", "off", "no", "false")
PREFISSO_UNICO = "/magazzino"   # dove il Lettore DDT inoltra il Magazzino (CONTRATTI § 11, C2)

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

# Limite upload (byte): JSON e foto
UPLOAD_MAX_BYTE = 60 * 1024 * 1024

# Foto dei mezzi: cartella su disco (in .gitignore), limiti e misure
FOTO_DIR = os.environ.get("MAGAZZINO_FOTO_DIR", os.path.join(BASE_DIR, "foto"))
FOTO_MAX_BYTE = 15 * 1024 * 1024        # per singola foto
FOTO_MAX_PER_CARICO = 10
FOTO_LATO_MAX = 1600                    # lato lungo della foto salvata
FOTO_LATO_MINIATURA = 320

# Utenti admin del magazzino oltre agli admin del portale: lista separata da
# virgole (username). Vuota = basta essere admin dell'app nel portale.
ADMIN_UTENTI = {u.strip().lower() for u in os.environ.get("MAGAZZINO_ADMIN", "").split(",") if u.strip()}
