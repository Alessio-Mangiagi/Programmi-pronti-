# "><(((º> sabusabu <º)))><"
"""Backup automatico del database del Magazzino (magazzino.db).

Perché esiste: fino al 06/11/2026 il Magazzino non salvava copie del suo database; un disco rotto o un file
corrotto avrebbero fatto perdere giacenze, movimenti e anagrafiche (emerso scrivendo la guida il 04/11).

Come funziona:
- la copia usa l'API di backup di sqlite3 (`Connection.backup`), che legge il database pagina per pagina
  dentro una transazione: la copia è coerente anche mentre l'app scrive (WAL compreso), al contrario di una
  copia del file con il sistema operativo;
- ogni copia è un file `magazzino-AAAAMMGG-HHMMSS.db` nella cartella `config.BACKUP_DIR`
  (variabile MAGAZZINO_BACKUP_DIR, default `backup/` accanto al database);
- si tengono le ultime `config.BACKUP_TENERE` copie (MAGAZZINO_BACKUP_TENERE, default 14): le più vecchie si
  cancellano dopo ogni copia riuscita, mai prima;
- un thread di sfondo (avviato da app.py come le importazioni) fa una copia all'avvio se l'ultima è più vecchia
  dell'intervallo e poi una ogni `config.BACKUP_ORE` ore (MAGAZZINO_BACKUP_ORE, default 24; 0 = spento).
  L'amministratore può farne una subito da Amministrazione ("Fai un backup adesso", POST /api/admin/backup).

Ripristino: con l'app ferma si sostituisce magazzino.db con la copia scelta (README § Backup).
"""
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone

import config

log = logging.getLogger("magazzino.backup")

# nome dei file di backup: solo questi vengono contati e ruotati (mai altri file della cartella)
NOME_COPIA = re.compile(r"^magazzino-(\d{8})-(\d{6})\.db$")
_lock = threading.Lock()          # una copia alla volta (thread di sfondo e pulsante dell'admin)
_stato = {"ultimo_errore": None, "in_corso": False}


def _utc(locale):
    """Ora locale → ISO in UTC con la Z: la pagina (fmtData in app.js) legge tutte le date come UTC, come quelle
    di SQLite; i nomi dei file restano in ora locale perché li legge una persona."""
    return locale.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ora_della_copia(nome):
    m = NOME_COPIA.match(nome)
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")


def copie(cartella=None):
    """Le copie presenti, dalla più recente: [{nome, percorso, byte, quando (UTC, per la pagina)}]."""
    cartella = cartella or config.BACKUP_DIR
    if not os.path.isdir(cartella):
        return []
    out = []
    for nome in os.listdir(cartella):
        m = NOME_COPIA.match(nome)
        if not m:
            continue
        percorso = os.path.join(cartella, nome)
        out.append({"nome": nome, "percorso": percorso, "byte": os.path.getsize(percorso),
                    "quando": _utc(_ora_della_copia(nome))})
    return sorted(out, key=lambda c: c["nome"], reverse=True)


def esegui(db_path=None, cartella=None, tenere=None, adesso=None):
    """Fa una copia coerente del database e ruota le vecchie. Ritorna la copia fatta ({nome, percorso, byte, quando}).

    Solleva OSError/sqlite3.Error se la copia non riesce: in quel caso le copie vecchie restano tutte e il file
    parziale viene cancellato (meglio nessuna copia nuova che una copia a metà con un nome valido).
    """
    db_path = db_path or config.DB_PATH
    cartella = cartella or config.BACKUP_DIR
    tenere = config.BACKUP_TENERE if tenere is None else tenere
    adesso = adesso or datetime.now()
    os.makedirs(cartella, exist_ok=True)
    nome = f"magazzino-{adesso:%Y%m%d-%H%M%S}.db"
    destinazione = os.path.join(cartella, nome)
    temporaneo = destinazione + ".parziale"      # non corrisponde a NOME_COPIA: mai contato né ruotato
    with _lock:
        _stato["in_corso"] = True
        try:
            sorgente = sqlite3.connect(db_path, timeout=30)
            try:
                copia = sqlite3.connect(temporaneo)
                try:
                    sorgente.backup(copia)          # pagina per pagina, coerente anche con scritture in corso
                finally:
                    copia.close()
            finally:
                sorgente.close()
            os.replace(temporaneo, destinazione)
            _stato["ultimo_errore"] = None
        except Exception as e:
            _stato["ultimo_errore"] = {"quando": _utc(adesso), "testo": str(e)}
            try:
                os.remove(temporaneo)
            except OSError:
                pass
            raise
        finally:
            _stato["in_corso"] = False
        # rotazione solo dopo una copia riuscita: si tengono le `tenere` più recenti
        for vecchia in copie(cartella)[max(tenere, 1):]:
            try:
                os.remove(vecchia["percorso"])
            except OSError as e:
                log.warning("backup: copia vecchia %s non cancellata: %s", vecchia["nome"], e)
    fatta = next(c for c in copie(cartella) if c["nome"] == nome)
    log.info("backup del database: %s (%d byte)", nome, fatta["byte"])
    return fatta


def stato():
    """Per la pagina Amministrazione: configurazione, ultime copie ed eventuale errore dell'ultima prova."""
    elenco = copie()
    return {"attivo": config.BACKUP_ORE > 0, "ogni_ore": config.BACKUP_ORE, "tenere": config.BACKUP_TENERE,
            "cartella": config.BACKUP_DIR, "copie": elenco[:5], "totale_copie": len(elenco),
            "ultima": elenco[0] if elenco else None, "in_corso": _stato["in_corso"],
            "ultimo_errore": _stato["ultimo_errore"]}


def serve_copia(ore=None):
    """True se l'ultima copia è più vecchia di `ore` (o non ce n'è nessuna)."""
    ore = config.BACKUP_ORE if ore is None else ore
    elenco = copie()
    if not elenco:
        return True
    return (datetime.now() - _ora_della_copia(elenco[0]["nome"])).total_seconds() >= ore * 3600


def _ciclo():
    time.sleep(20)                         # lascia partire l'app e le prime importazioni
    while True:
        try:
            if serve_copia():
                esegui()
        except Exception as e:             # il thread non deve morire: riprova al giro dopo
            log.error("backup automatico non riuscito: %s", e)
        time.sleep(min(3600, config.BACKUP_ORE * 3600))    # controllo al massimo ogni ora


def avvia_di_sfondo():
    """Avviato da app.py all'avvio come servizio (non nei test). MAGAZZINO_BACKUP_ORE=0 lo spegne."""
    if config.BACKUP_ORE > 0:
        threading.Thread(target=_ciclo, daemon=True, name="backup").start()
