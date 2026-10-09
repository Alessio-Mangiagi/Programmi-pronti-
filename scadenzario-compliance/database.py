"""Database SQLite dello Scadenzario Compliance Cosedil.

Contiene lo schema (identico alla SPEC), get_db() e init_db() con il seed
dei tipi di scadenza. Eseguibile standalone:

    python database.py    -> crea/aggiorna il database
"""
import sqlite3

import config

# Schema DB — NON modificare senza aggiornare SPEC.md
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS dipendenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  codice_fiscale TEXT UNIQUE,          -- può essere NULL, se presente uppercase
  mansione TEXT,
  cantiere TEXT,
  telefono TEXT,
  email TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,   -- 0/1
  note TEXT
);

CREATE TABLE IF NOT EXISTS subappaltatori (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ragione_sociale TEXT NOT NULL,
  partita_iva TEXT UNIQUE,
  referente TEXT,
  telefono TEXT,
  email TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS attrezzature (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descrizione TEXT NOT NULL,
  matricola TEXT,
  cantiere TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS tipi_scadenza (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  categoria TEXT NOT NULL CHECK (categoria IN
    ('formazione','visita_medica','patentino','durc','attrezzatura','assicurazione','certificazione','ai_act','altro')),
  soggetto TEXT NOT NULL CHECK (soggetto IN ('dipendente','subappaltatore','attrezzatura','sistema_ia','azienda')),
  validita_mesi INTEGER,               -- durata tipica; NULL = non calcolabile automaticamente
  preavviso_giorni INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS scadenze (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_id INTEGER NOT NULL REFERENCES tipi_scadenza(id),
  soggetto_tipo TEXT NOT NULL CHECK (soggetto_tipo IN ('dipendente','subappaltatore','attrezzatura','sistema_ia','azienda')),
  soggetto_id INTEGER,                 -- NULL solo se soggetto_tipo='azienda'
  data_rilascio TEXT,                  -- ISO date, opzionale
  data_scadenza TEXT NOT NULL,         -- ISO date
  documento_rif TEXT,                  -- riferimento attestato/certificato
  referente TEXT,                      -- responsabile/owner dell'adempimento (nome o ruolo, es. DPO)
  note TEXT,
  chiusa INTEGER NOT NULL DEFAULT 0,   -- 1 = rinnovata/archiviata, esclusa da alert
  creata_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sistemi_ia (      -- registro/inventario dei sistemi di IA usati in azienda (AI Act)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  fornitore TEXT,
  finalita TEXT,                        -- a cosa serve / dove è usato
  classe_rischio TEXT NOT NULL DEFAULT 'da_valutare' CHECK (classe_rischio IN
    ('vietato','alto_rischio','limitato','minimo','gpai','da_valutare')),
  ruolo TEXT NOT NULL DEFAULT 'deployer' CHECK (ruolo IN
    ('deployer','provider','importatore','distributore')),
  stato_conformita TEXT NOT NULL DEFAULT 'da_valutare' CHECK (stato_conformita IN
    ('da_valutare','in_corso','conforme','non_conforme','dismesso')),
  referente TEXT,
  cantiere TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS adempimenti (     -- checklist di sotto-adempimenti collegati a una scadenza
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scadenza_id INTEGER NOT NULL REFERENCES scadenze(id) ON DELETE CASCADE,
  descrizione TEXT NOT NULL,
  fatto INTEGER NOT NULL DEFAULT 0,
  fatto_il TEXT,                        -- timestamp ISO di completamento
  ordine INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS allegati (        -- evidenze/documenti allegati a una scadenza
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scadenza_id INTEGER NOT NULL REFERENCES scadenze(id) ON DELETE CASCADE,
  nome_file TEXT NOT NULL,              -- nome originale del file
  percorso TEXT NOT NULL,               -- nome del file salvato nella cartella allegati/
  dimensione INTEGER,                   -- byte
  caricato_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessioni_corso (   -- da import Calendario Corsi
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titolo TEXT NOT NULL,                -- es. "Corso 45h — AULA 1"
  aula TEXT,
  ciclo TEXT,
  n_persone INTEGER,
  giorno_settimana TEXT,
  docente TEXT,
  sede TEXT,
  data_inizio TEXT,                    -- prima lezione ISO
  data_fine TEXT,                      -- ultima lezione ISO
  lezioni_json TEXT                    -- JSON array di date ISO
);

CREATE TABLE IF NOT EXISTS notifiche_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scadenza_id INTEGER REFERENCES scadenze(id),
  canale TEXT NOT NULL,                -- 'in_app' | 'email' | 'whatsapp'
  messaggio TEXT,
  esito TEXT NOT NULL,                 -- 'ok' | 'errore' | 'disabilitato'
  contesto TEXT,                       -- banda di preavviso (es. 'soglia_30','scaduta') per il dedup multi-step
  inviata_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meta (      -- coppie chiave/valore per marcatori interni (es. seed una-tantum)
  chiave TEXT PRIMARY KEY,
  valore TEXT
);
"""

# Seed tipi_scadenza (inserito da init_db se la tabella è vuota)
# (nome, categoria, soggetto, validita_mesi, preavviso_giorni)
SEED_TIPI = [
    ("Formazione generale + specifica lavoratori (agg.)", "formazione", "dipendente", 60, 60),
    ("Aggiornamento Preposto", "formazione", "dipendente", 24, 60),
    ("Primo Soccorso (agg.)", "formazione", "dipendente", 36, 60),
    ("Antincendio (agg.)", "formazione", "dipendente", 60, 60),
    ("Ponteggi — agg. teorico-pratico", "formazione", "dipendente", 48, 60),
    ("Lavori in quota / DPI III cat.", "formazione", "dipendente", 60, 60),
    ("Visita medica idoneità", "visita_medica", "dipendente", 12, 45),
    ("Patentino gru", "patentino", "dipendente", 60, 60),
    ("Patentino PLE", "patentino", "dipendente", 60, 60),
    ("Patentino carrello elevatore", "patentino", "dipendente", 60, 60),
    ("DURC", "durc", "subappaltatore", 4, 30),
    ("Verifica periodica attrezzatura", "attrezzatura", "attrezzatura", 12, 30),
    ("Polizza RCT/RCO", "assicurazione", "azienda", 12, 45),
    ("Attestazione SOA", "certificazione", "azienda", 60, 120),
    ("Certificazione ISO 9001", "certificazione", "azienda", 12, 60),
]

# ---------------------------------------------------------------------------
# Seed AI Act (Regolamento UE 2024/1689 + Legge 23/09/2025 n. 132)
#
# Sono adempimenti/milestone normativi a livello aziendale (soggetto='azienda',
# soggetto_id NULL). Le date UE sono fisse e pubbliche; le milestone già in
# vigore vengono create come chiuse (esclude gli alert: sono "già applicabili",
# non "scadute"), quelle future restano aperte così da comparire in dashboard e
# notifiche man mano che si avvicinano.
#
# Categoria dedicata 'ai_act' (vedi CHECK in tipi_scadenza) per raggrupparle e
# filtrarle a parte rispetto alle scadenze di cantiere.
# ---------------------------------------------------------------------------

# (nome, categoria, soggetto, validita_mesi, preavviso_giorni)
SEED_TIPI_AI_ACT = [
    ("AI Act — Divieto pratiche IA vietate (art. 5)", "ai_act", "azienda", None, 60),
    ("AI Act — Alfabetizzazione IA del personale (art. 4)", "ai_act", "azienda", 12, 60),
    ("AI Act — Obblighi modelli GPAI e governance", "ai_act", "azienda", None, 90),
    ("AI Act — Applicazione generale: alto rischio All. III + trasparenza (art. 50)", "ai_act", "azienda", None, 120),
    ("AI Act — Sistemi ad alto rischio Allegato I", "ai_act", "azienda", None, 120),
    ("L. 132/2025 — Informativa ai lavoratori su uso IA", "ai_act", "azienda", 12, 60),
    ("L. 132/2025 — Decreti legislativi attuativi (monitoraggio)", "ai_act", "azienda", None, 90),
    # Alfabetizzazione IA tracciata anche per singolo lavoratore (art. 4): collega
    # l'obbligo aziendale alle persone effettivamente formate. Validità 24 mesi = refresh.
    ("AI Act — Formazione alfabetizzazione IA (lavoratore)", "ai_act", "dipendente", 24, 60),
]

# Checklist precaricate su alcune scadenze AI Act (una-tantum, marcatore in `meta`).
# { nome_tipo scadenza aziendale : [descrizioni voci checklist in ordine] }
SEED_CHECKLIST_AI_ACT = {
    "AI Act — Divieto pratiche IA vietate (art. 5)": [
        "Nessun uso di tecniche subliminali/manipolative o ingannevoli",
        "Nessuno sfruttamento di vulnerabilità (età, disabilità, condizione socioeconomica)",
        "Nessun punteggio sociale (social scoring) dei lavoratori o terzi",
        "Nessun riconoscimento delle emozioni sul luogo di lavoro (salvo motivi medici/sicurezza)",
        "Nessuna categorizzazione biometrica per dedurre dati sensibili",
        "Nessuna identificazione biometrica remota 'in tempo reale' in spazi accessibili al pubblico",
        "Nessuna raccolta massiva non mirata di immagini facciali per creare database",
    ],
    "AI Act — Applicazione generale: alto rischio All. III + trasparenza (art. 50)": [
        "Inventario dei sistemi IA in uso compilato nel registro Sistemi IA",
        "Sistemi ad alto rischio usati secondo le istruzioni del fornitore (art. 26)",
        "Sorveglianza umana designata e persone competenti/formate",
        "Monitoraggio del funzionamento e procedura di segnalazione malfunzionamenti",
        "Conservazione dei log generati dal sistema (almeno 6 mesi)",
        "Informativa ai lavoratori interessati (art. 26 + L. 132/2025)",
        "Valutazione d'impatto sui diritti fondamentali (FRIA, art. 27) dove richiesta",
        "Coordinamento con la valutazione d'impatto privacy (DPIA, GDPR art. 35)",
        "Adempimenti di trasparenza verso gli utenti per i sistemi dell'art. 50",
    ],
}

# (nome_tipo, data_rilascio, data_scadenza, chiusa, note)
# Le milestone con data già trascorsa sono chiuse=1 ("già in vigore", niente alert).
SEED_SCADENZE_AI_ACT = [
    ("AI Act — Divieto pratiche IA vietate (art. 5)",
     "2024-08-01", "2025-02-02", 1,
     "In vigore dal 02/02/2025. Verificare che nessun sistema IA usato in azienda "
     "rientri nelle pratiche vietate dall'art. 5 del Regolamento UE 2024/1689."),
    ("AI Act — Alfabetizzazione IA del personale (art. 4)",
     "2025-02-02", "2026-08-02", 0,
     "Obbligo in vigore dal 02/02/2025: garantire un livello sufficiente di competenza "
     "sull'IA al personale che usa o gestisce sistemi IA. Verifica/aggiornamento periodico."),
    ("AI Act — Obblighi modelli GPAI e governance",
     "2024-08-01", "2025-08-02", 1,
     "In vigore dal 02/08/2025: obblighi per i modelli IA per finalità generali (GPAI), "
     "designazione delle autorità nazionali e regime sanzionatorio."),
    ("AI Act — Applicazione generale: alto rischio All. III + trasparenza (art. 50)",
     None, "2026-08-02", 0,
     "Piena applicazione del Regolamento UE 2024/1689: obblighi per i sistemi ad alto "
     "rischio dell'Allegato III (es. selezione e gestione del personale) e obblighi di "
     "trasparenza dell'art. 50. Mappare gli usi IA in azienda entro questa data."),
    ("AI Act — Sistemi ad alto rischio Allegato I",
     None, "2027-08-02", 0,
     "Obblighi per i sistemi ad alto rischio dell'Allegato I (IA come componente di "
     "prodotti soggetti a normativa di armonizzazione UE, es. macchine/attrezzature)."),
    ("L. 132/2025 — Informativa ai lavoratori su uso IA",
     "2025-10-10", "2026-10-10", 0,
     "Legge 23/09/2025 n. 132 (in vigore dal 10/10/2025): informare i lavoratori "
     "sull'uso di sistemi di IA nel rapporto di lavoro. Verifica annuale dell'informativa."),
    ("L. 132/2025 — Decreti legislativi attuativi (monitoraggio)",
     "2025-10-10", "2026-10-10", 0,
     "Delega al Governo: decreti legislativi di adeguamento entro 12 mesi dall'entrata "
     "in vigore della L. 132/2025 (entro ~10/10/2026). Monitorare i nuovi obblighi."),
]

# Valori ammessi per i CHECK di tipi_scadenza — DEVONO restare allineati a SCHEMA_SQL.
# Servono alla migrazione dei DB creati prima di 'ai_act'/'sistema_ia'.
CATEGORIE_AMMESSE = (
    "formazione", "visita_medica", "patentino", "durc", "attrezzatura",
    "assicurazione", "certificazione", "ai_act", "altro",
)
SOGGETTI_AMMESSI = ("dipendente", "subappaltatore", "attrezzatura", "sistema_ia", "azienda")


def get_db() -> sqlite3.Connection:
    """Apre una connessione al database con row_factory a dizionario e FK attive."""
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _estendi_check_categoria(conn: sqlite3.Connection) -> None:
    """Estende i CHECK di tipi_scadenza (categoria 'ai_act', soggetto 'sistema_ia').

    Solo per i DB creati prima: SQLite non consente di modificare un CHECK, quindi
    si ricrea la tabella preservando id e dati (le FK di scadenze.tipo_id restano
    valide perché gli id sono copiati). Idempotente: no-op se già aggiornata.
    """
    riga = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='tipi_scadenza'"
    ).fetchone()
    if riga and "'ai_act'" in riga[0] and "'sistema_ia'" in riga[0]:
        return  # già aggiornato (o DB creato con lo schema nuovo)

    categorie = ",".join(f"'{c}'" for c in CATEGORIE_AMMESSE)
    soggetti = ",".join(f"'{s}'" for s in SOGGETTI_AMMESSI)
    # Ricostruzione fuori transazione implicita: PRAGMA foreign_keys non è
    # modificabile dentro una transazione, quindi si passa in autocommit.
    conn.commit()
    livello = conn.isolation_level
    conn.isolation_level = None
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        conn.execute(f"""
            CREATE TABLE tipi_scadenza_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              nome TEXT NOT NULL UNIQUE,
              categoria TEXT NOT NULL CHECK (categoria IN ({categorie})),
              soggetto TEXT NOT NULL CHECK (soggetto IN ({soggetti})),
              validita_mesi INTEGER,
              preavviso_giorni INTEGER NOT NULL DEFAULT 30
            )""")
        conn.execute(
            "INSERT INTO tipi_scadenza_new "
            "(id, nome, categoria, soggetto, validita_mesi, preavviso_giorni) "
            "SELECT id, nome, categoria, soggetto, validita_mesi, preavviso_giorni "
            "FROM tipi_scadenza")
        conn.execute("DROP TABLE tipi_scadenza")
        conn.execute("ALTER TABLE tipi_scadenza_new RENAME TO tipi_scadenza")
        conn.execute("COMMIT")
    finally:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.isolation_level = livello


def _migra_scadenze_v13(conn: sqlite3.Connection) -> None:
    """Aggiorna la tabella `scadenze` allo schema v1.3: soggetto_tipo 'sistema_ia'
    ammesso nel CHECK + nuova colonna `referente`.

    SQLite non consente di modificare un CHECK né di aggiungere in modo pulito
    una colonna al centro dello schema: si ricrea la tabella preservando id e dati
    (le FK di notifiche_log/adempimenti/allegati restano valide perché gli id sono
    copiati). Idempotente: no-op se lo schema è già aggiornato.
    """
    riga = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='scadenze'"
    ).fetchone()
    colonne = [r[1] for r in conn.execute("PRAGMA table_info(scadenze)")]
    if riga and "'sistema_ia'" in riga[0] and "referente" in colonne:
        return  # già aggiornato (o DB creato con lo schema nuovo)

    conn.commit()
    livello = conn.isolation_level
    conn.isolation_level = None
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("BEGIN")
        conn.execute("""
            CREATE TABLE scadenze_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tipo_id INTEGER NOT NULL REFERENCES tipi_scadenza(id),
              soggetto_tipo TEXT NOT NULL CHECK (soggetto_tipo IN
                ('dipendente','subappaltatore','attrezzatura','sistema_ia','azienda')),
              soggetto_id INTEGER,
              data_rilascio TEXT,
              data_scadenza TEXT NOT NULL,
              documento_rif TEXT,
              referente TEXT,
              note TEXT,
              chiusa INTEGER NOT NULL DEFAULT 0,
              creata_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )""")
        conn.execute(
            "INSERT INTO scadenze_new "
            "(id, tipo_id, soggetto_tipo, soggetto_id, data_rilascio, data_scadenza, "
            " documento_rif, note, chiusa, creata_il) "
            "SELECT id, tipo_id, soggetto_tipo, soggetto_id, data_rilascio, data_scadenza, "
            " documento_rif, note, chiusa, creata_il FROM scadenze")
        conn.execute("DROP TABLE scadenze")
        conn.execute("ALTER TABLE scadenze_new RENAME TO scadenze")
        conn.execute("COMMIT")
    finally:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.isolation_level = livello


def _assicura_colonna(conn: sqlite3.Connection, tabella: str, colonna: str, ddl: str) -> None:
    """Aggiunge una colonna se assente (ALTER TABLE ADD COLUMN, idempotente)."""
    colonne = [r[1] for r in conn.execute(f"PRAGMA table_info({tabella})")]
    if colonna not in colonne:
        conn.execute(f"ALTER TABLE {tabella} ADD COLUMN {colonna} {ddl}")
        conn.commit()


def migra_ai_act(conn: sqlite3.Connection) -> None:
    """Assicura tipi e scadenze AI Act. Idempotente (fresh e DB esistenti).

    - Estende il CHECK categoria a 'ai_act' e lo schema scadenze a v1.3 se serve.
    - Aggiunge notifiche_log.contesto (dedup escalation) sui DB pre-esistenti.
    - Inserisce i tipi AI Act mancanti (UNIQUE su nome → INSERT OR IGNORE).
    - Precarica le scadenze con le date note UNA SOLA VOLTA (marcatore in `meta`),
      così eventuali eliminazioni manuali non vengono resuscitate ad ogni avvio.
    - Precarica le checklist su alcune scadenze (marcatore separato).
    """
    _estendi_check_categoria(conn)
    _migra_scadenze_v13(conn)
    _assicura_colonna(conn, "notifiche_log", "contesto", "TEXT")

    conn.executemany(
        "INSERT OR IGNORE INTO tipi_scadenza "
        "(nome, categoria, soggetto, validita_mesi, preavviso_giorni) VALUES (?, ?, ?, ?, ?)",
        SEED_TIPI_AI_ACT,
    )
    conn.commit()

    gia_fatto = conn.execute(
        "SELECT 1 FROM meta WHERE chiave = 'seed_scadenze_ai_act_v1'").fetchone()
    if not gia_fatto:
        for nome_tipo, data_rilascio, data_scadenza, chiusa, note in SEED_SCADENZE_AI_ACT:
            tipo = conn.execute(
                "SELECT id FROM tipi_scadenza WHERE nome = ?", (nome_tipo,)).fetchone()
            if tipo is None:
                continue
            conn.execute(
                "INSERT INTO scadenze "
                "(tipo_id, soggetto_tipo, soggetto_id, data_rilascio, data_scadenza, note, chiusa) "
                "VALUES (?, 'azienda', NULL, ?, ?, ?, ?)",
                (tipo[0], data_rilascio, data_scadenza, note, chiusa),
            )
        conn.execute(
            "INSERT OR REPLACE INTO meta (chiave, valore) "
            "VALUES ('seed_scadenze_ai_act_v1', datetime('now','localtime'))")
        conn.commit()

    # Checklist precaricate (una-tantum, marcatore separato): agganciate alle
    # scadenze aziendali AI Act già seminate sopra.
    gia_checklist = conn.execute(
        "SELECT 1 FROM meta WHERE chiave = 'seed_checklist_ai_act_v1'").fetchone()
    if not gia_checklist:
        for nome_tipo, voci in SEED_CHECKLIST_AI_ACT.items():
            scad = conn.execute(
                "SELECT s.id FROM scadenze s JOIN tipi_scadenza t ON t.id = s.tipo_id "
                "WHERE t.nome = ? AND s.soggetto_tipo = 'azienda' ORDER BY s.id LIMIT 1",
                (nome_tipo,)).fetchone()
            if scad is None:
                continue
            for ordine, descrizione in enumerate(voci):
                conn.execute(
                    "INSERT INTO adempimenti (scadenza_id, descrizione, ordine) VALUES (?, ?, ?)",
                    (scad[0], descrizione, ordine))
        conn.execute(
            "INSERT OR REPLACE INTO meta (chiave, valore) "
            "VALUES ('seed_checklist_ai_act_v1', datetime('now','localtime'))")
        conn.commit()


def init_db() -> None:
    """Crea/aggiorna lo schema e inserisce il seed dei tipi scadenza se la tabella è vuota."""
    conn = get_db()
    try:
        conn.executescript(SCHEMA_SQL)
        n_tipi = conn.execute("SELECT COUNT(*) FROM tipi_scadenza").fetchone()[0]
        if n_tipi == 0:
            conn.executemany(
                "INSERT INTO tipi_scadenza (nome, categoria, soggetto, validita_mesi, preavviso_giorni) "
                "VALUES (?, ?, ?, ?, ?)",
                SEED_TIPI,
            )
        conn.commit()
        # Adempimenti AI Act: idempotente, va eseguito anche sui DB già esistenti.
        migra_ai_act(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Database creato/aggiornato: {config.DB_PATH}")
