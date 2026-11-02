# "><(((º> sabusabu <º)))><"
"""Database SQLite del Magazzino Operativo.

Schema, connessione e inizializzazione. Eseguibile da solo:

    python database.py    -> crea/aggiorna il database

Le giacenze NON sono una tabella: sono la somma dei movimenti per articolo e
ubicazione (vista `giacenze`). Così un movimento sbagliato si corregge con una
rettifica e il totale torna da solo, senza contatori da riallineare.
"""
import sqlite3

import config

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ubicazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT NOT NULL UNIQUE,            -- barcode interno UBI-00001
  nome TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'cantiere'
    CHECK (tipo IN ('deposito','cantiere','officina','fornitore','altro')),
  commessa TEXT,                          -- commessa del Lettore DDT, se nasce da lì
  indirizzo TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articoli (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT NOT NULL UNIQUE,            -- barcode interno MAG-00001
  codice_esterno TEXT,                    -- EAN/codice del fornitore, se presente sul materiale
  descrizione TEXT NOT NULL,
  descrizione_norm TEXT NOT NULL,         -- descrizione normalizzata per il match dai DDT
  um TEXT NOT NULL DEFAULT 'pz',
  categoria TEXT,
  fornitore TEXT,
  scorta_minima REAL,
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (descrizione_norm, um)
);
CREATE INDEX IF NOT EXISTS idx_articoli_esterno ON articoli(codice_esterno);

CREATE TABLE IF NOT EXISTS mezzi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT NOT NULL UNIQUE,            -- barcode interno MEZ-00001
  tipo_mezzo TEXT NOT NULL,
  marca TEXT,
  modello TEXT,
  targa TEXT,
  matricola TEXT,
  proprieta TEXT NOT NULL DEFAULT 'proprio' CHECK (proprieta IN ('proprio','nolo')),
  ditta TEXT,                             -- proprietaria, per i noli
  piva TEXT,
  nolo_dal TEXT,
  nolo_al TEXT,
  pratica_vfp TEXT UNIQUE,                -- id della pratica in VFP Transfer
  stato TEXT NOT NULL DEFAULT 'disponibile'
    CHECK (stato IN ('disponibile','in_uso','manutenzione','fermo','restituito')),
  ubicazione_id INTEGER REFERENCES ubicazioni(id),
  attivo INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mezzi_targa ON mezzi(targa);
CREATE INDEX IF NOT EXISTS idx_mezzi_matricola ON mezzi(matricola);

CREATE TABLE IF NOT EXISTS movimenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT,                              -- data del documento (AAAA-MM-GG), se diversa dal ts
  tipo TEXT NOT NULL CHECK (tipo IN ('carico','scarico','trasferimento','rettifica','inventario')),
  articolo_id INTEGER NOT NULL REFERENCES articoli(id),
  quantita REAL NOT NULL,
  da_ubicazione_id INTEGER REFERENCES ubicazioni(id),
  a_ubicazione_id INTEGER REFERENCES ubicazioni(id),
  riferimento TEXT,                       -- "DDT 118 del 03/03/2026", ordine, ecc.
  fornitore TEXT,
  origine TEXT NOT NULL DEFAULT 'manuale' CHECK (origine IN ('manuale','scansione','ddt')),
  chiave_import TEXT,                     -- export DDT da cui viene la riga (sostituzione)
  chiave_riga TEXT UNIQUE,                -- identità della riga DDT (dedupe)
  utente TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_mov_articolo ON movimenti(articolo_id);
CREATE INDEX IF NOT EXISTS idx_mov_import ON movimenti(chiave_import);

CREATE TABLE IF NOT EXISTS movimenti_mezzi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  mezzo_id INTEGER NOT NULL REFERENCES mezzi(id),
  da_ubicazione_id INTEGER REFERENCES ubicazioni(id),
  a_ubicazione_id INTEGER REFERENCES ubicazioni(id),
  stato TEXT,
  origine TEXT NOT NULL DEFAULT 'manuale' CHECK (origine IN ('manuale','scansione','vfp')),
  utente TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_movm_mezzo ON movimenti_mezzi(mezzo_id);

CREATE TABLE IF NOT EXISTS importazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  sorgente TEXT NOT NULL CHECK (sorgente IN ('ddt','mezzi')),
  file TEXT NOT NULL,                     -- percorso o nome del file letto
  chiave TEXT,                            -- commessa/export (ddt) o pratica (mezzi)
  impronta TEXT,                          -- salvatoIl / mtime: se uguale non si rilegge
  righe INTEGER NOT NULL DEFAULT 0,
  nuove INTEGER NOT NULL DEFAULT 0,
  esito TEXT NOT NULL DEFAULT 'ok',
  dettaglio TEXT
);
CREATE INDEX IF NOT EXISTS idx_imp_chiave ON importazioni(sorgente, chiave);

CREATE TABLE IF NOT EXISTS attivita (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  utente TEXT,
  ip TEXT,
  azione TEXT NOT NULL,                   -- scansione, movimento, crea, modifica, elimina, disattiva, sposta, importazione...
  oggetto TEXT,                           -- articolo, mezzo, ubicazione, ddt, mezzi, upload
  oggetto_id INTEGER,
  descrizione TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_ts ON attivita(ts);
CREATE INDEX IF NOT EXISTS idx_att_utente ON attivita(utente);

CREATE VIEW IF NOT EXISTS giacenze AS
SELECT articolo_id, ubicazione_id, SUM(qta) AS quantita, MAX(ts) AS ultimo_movimento
FROM (
  SELECT articolo_id, a_ubicazione_id AS ubicazione_id, quantita AS qta, ts
    FROM movimenti WHERE a_ubicazione_id IS NOT NULL
  UNION ALL
  SELECT articolo_id, da_ubicazione_id AS ubicazione_id, -quantita AS qta, ts
    FROM movimenti WHERE da_ubicazione_id IS NOT NULL
)
GROUP BY articolo_id, ubicazione_id;
"""


def get_db(path=None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(path=None):
    conn = get_db(path)
    try:
        conn.executescript(SCHEMA_SQL)
        # Colonne aggiunte dopo la prima versione: ALTER solo se mancano
        # (SQLite non ha ADD COLUMN IF NOT EXISTS).
        colonne = {r[1] for r in conn.execute("PRAGMA table_info(mezzi)")}
        if "assegnato_a" not in colonne:
            conn.execute("ALTER TABLE mezzi ADD COLUMN assegnato_a TEXT")  # chi lo sta usando
        colonne = {r[1] for r in conn.execute("PRAGMA table_info(ubicazioni)")}
        if "lat" not in colonne:
            # Coordinate per aprire la mappa: opzionali, basta anche l'indirizzo.
            conn.execute("ALTER TABLE ubicazioni ADD COLUMN lat REAL")
            conn.execute("ALTER TABLE ubicazioni ADD COLUMN lng REAL")
        # Un deposito c'è sempre: è dove finisce il materiale senza destinazione.
        conn.execute(
            "INSERT OR IGNORE INTO ubicazioni (codice, nome, tipo) VALUES (?, ?, 'deposito')",
            (f"{config.PREFISSO_UBICAZIONE}-00001", config.UBICAZIONE_DEFAULT))
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Database pronto: {config.DB_PATH}")
