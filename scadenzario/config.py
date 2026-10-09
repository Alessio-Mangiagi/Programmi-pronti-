"""Configurazione Scadenzario Cosedil.

Costanti condivise da app.py, database.py, importer.py e notifiche.py.
"""
import os

# Cartella del progetto (posizione di questo file)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Indirizzo di ascolto. Default locale; in LAN il portale passa il proprio HOST
# alle app che avvia (HOST=0.0.0.0), così i PC della rete raggiungono davvero
# l'app invece di trovarsi un link morto. L'accesso resta protetto dal gate SSO.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5180"))

# Database SQLite (creato a runtime, in .gitignore)
DB_PATH = os.path.join(BASE_DIR, "scadenzario.db")

# Cartella per i file allegati alle scadenze (evidenze/documenti), in .gitignore
ALLEGATI_DIR = os.path.join(BASE_DIR, "allegati")
# Estensioni consentite per gli allegati e dimensione massima (byte)
ALLEGATI_ESTENSIONI = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg",
                       ".jpeg", ".txt", ".csv", ".eml", ".msg", ".p7m", ".zip")
ALLEGATI_MAX_BYTE = 20 * 1024 * 1024  # 20 MB

# Preavviso di default (giorni) per i tipi scadenza senza valore specifico
DEFAULT_PREAVVISO_GIORNI = 30

# Soglie di preavviso multi-step (giorni): a ogni soglia attraversata verso il
# basso viene generata una notifica dedicata (escalation), una sola volta per
# soglia e per scadenza. La soglia più vicina allo zero ha priorità.
SOGLIE_PREAVVISO_GIORNI = (180, 90, 60, 30, 14, 7, 1, 0)

# Canale email (opzionale). Attivo solo se EMAIL_ABILITATA=1 e SMTP_HOST valorizzato.
# Nessun default sensibile: tutto da variabili d'ambiente, così le credenziali
# non finiscono nel codice/versionate.
EMAIL_ABILITATA = os.environ.get("EMAIL_ABILITATA", "0") in ("1", "true", "True")
# "><(((º> sabusabu <º)))><"
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_STARTTLS = os.environ.get("SMTP_STARTTLS", "1") in ("1", "true", "True")
EMAIL_DA = os.environ.get("EMAIL_DA", SMTP_USER)
# Destinatari fissi delle notifiche (compliance/DPO), separati da virgola
EMAIL_A = tuple(x.strip() for x in os.environ.get("EMAIL_A", "").split(",") if x.strip())

# Amministratori dello Scadenzario: solo questi username del portale (oltre a
# essere admin per l'app nel portale) vedono la pagina Amministrazione e possono
# eliminare dati o gestire le utenze. Separati da virgola; vuoto = basta essere
# admin del portale per l'app.
ADMIN_UTENTI = tuple(
    x.strip().lower()
    for x in os.environ.get("SCADENZARIO_ADMIN", "a.mangiagi").split(",") if x.strip())

# Spegnimento automatico: il server esce quando la SPA smette di inviare
# heartbeat (ultima scheda chiusa). Il timeout deve restare ampiamente sopra
# l'intervallo di invio del client, altrimenti un refresh di pagina spegne
# il server proprio mentre l'utente lo sta ricaricando.
# Solo in locale: in LAN (HOST non loopback) la chiusura della scheda di un
# utente non deve spegnere l'app agli altri. SPEGNIMENTO_AUTOMATICO=0/1 forza.
_spegnimento = os.environ.get("SPEGNIMENTO_AUTOMATICO", "").strip()
SPEGNIMENTO_AUTOMATICO = (_spegnimento in ("1", "true", "True") if _spegnimento
                          else HOST in ("127.0.0.1", "localhost"))
HEARTBEAT_TIMEOUT_SECONDI = 15
HEARTBEAT_CONTROLLO_SECONDI = 5

# Giro notifiche automatico: una volta al giorno, dalla NOTIFICHE_ORA in poi,
# mentre il server è acceso. NOTIFICHE_AUTOMATICHE=0 lo disattiva.
NOTIFICHE_AUTOMATICHE = os.environ.get("NOTIFICHE_AUTOMATICHE", "1") in ("1", "true", "True")
NOTIFICHE_ORA = int(os.environ.get("NOTIFICHE_ORA", "7"))

# Backup automatico (DB + allegati) una volta al giorno all'avvio, in .gitignore
BACKUP_DIR = os.path.join(BASE_DIR, "backup")
BACKUP_DA_TENERE = int(os.environ.get("BACKUP_DA_TENERE", "14"))

# Versione applicazione (esposta da /api/health)
VERSIONE = "1.4.0"
