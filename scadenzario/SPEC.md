# Scadenzario Cantiere — SPEC v1

Webapp locale Cosedil per tracciare e notificare scadenze normative: formazione sicurezza (D.Lgs 81/08), visite mediche, patentini/abilitazioni, DURC subappaltatori, verifiche attrezzature, polizze/certificazioni aziendali.

<!-- "><(((º> sabusabu <º)))><" -->

Questo file è il **contratto vincolante** tra backend, frontend e moduli: nomi di campi, endpoint e firme NON vanno cambiati senza aggiornare la SPEC.

## Stack

- Backend: Python 3.10+, Flask, sqlite3 (stdlib), waitress per il serving. Porta **5180**, bind `127.0.0.1`.
- Frontend: SPA vanilla JS (no build step), servita da Flask (`templates/index.html` + `static/`).
- Import/export Excel: `openpyxl`.
- Nessuna dipendenza cloud. Tutto locale, pattern delle altre webapp Cosedil (`avvia.bat`, auto-apertura browser).

## Mappa file

```
scadenzario/
├── SPEC.md                  # questo file
├── README.md                # manuale utente + installazione
├── requirements.txt         # flask, waitress, openpyxl
├── config.py                # costanti: PORT=5180, HOST, DB_PATH, DEFAULT_PREAVVISO_GIORNI=30
├── database.py              # schema, get_db(), init_db(), seed tipi scadenza; eseguibile: python database.py → crea/aggiorna DB
├── app.py                   # Flask app + tutte le API REST + serving frontend
├── importer.py              # import xlsx Calendario Corsi + CSV dipendenti/scadenze
├── notifiche.py             # motore notifiche (in-app sempre; email/WhatsApp stub disattivati)
├── scadenzario.db           # SQLite (creato a runtime, in .gitignore)
├── templates/index.html     # shell SPA
├── static/css/style.css     # design system Cosedil
├── static/js/app.js         # SPA (router hash, viste, fetch API)
├── installa.bat             # crea venv .venv + pip install -r requirements.txt
├── avvia.bat                # attiva venv, avvia waitress, apre browser su http://127.0.0.1:5180
└── .gitignore               # .venv/, *.db, __pycache__/, *.pyc
```

## Schema DB (SQLite)

Tutte le date come TEXT ISO `YYYY-MM-DD`. Timestamp TEXT ISO 8601.

```sql
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
  referente TEXT,                      -- responsabile/owner dell'adempimento (v1.3)
  note TEXT,
  chiusa INTEGER NOT NULL DEFAULT 0,   -- 1 = rinnovata/archiviata, esclusa da alert
  creata_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- v1.3 — registro sistemi IA (soggetto delle scadenze AI Act), checklist e allegati
CREATE TABLE IF NOT EXISTS sistemi_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  fornitore TEXT,
  finalita TEXT,
  classe_rischio TEXT NOT NULL DEFAULT 'da_valutare' CHECK (classe_rischio IN
    ('vietato','alto_rischio','limitato','minimo','gpai','da_valutare')),
  ruolo TEXT NOT NULL DEFAULT 'deployer' CHECK (ruolo IN
    ('deployer','provider','importatore','distributore')),
  stato_conformita TEXT NOT NULL DEFAULT 'da_valutare' CHECK (stato_conformita IN
    ('da_valutare','in_corso','conforme','non_conforme','dismesso')),
  referente TEXT, cantiere TEXT,
  attivo INTEGER NOT NULL DEFAULT 1, note TEXT
);

CREATE TABLE IF NOT EXISTS adempimenti (   -- checklist di sotto-attività di una scadenza
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scadenza_id INTEGER NOT NULL REFERENCES scadenze(id) ON DELETE CASCADE,
  descrizione TEXT NOT NULL,
  fatto INTEGER NOT NULL DEFAULT 0,
  fatto_il TEXT, ordine INTEGER NOT NULL DEFAULT 0, note TEXT
);

CREATE TABLE IF NOT EXISTS allegati (      -- evidenze/documenti di una scadenza (file su disco in allegati/)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scadenza_id INTEGER NOT NULL REFERENCES scadenze(id) ON DELETE CASCADE,
  nome_file TEXT NOT NULL, percorso TEXT NOT NULL,
  dimensione INTEGER, caricato_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  inviata_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS meta (      -- coppie chiave/valore interne (marcatori seed una-tantum)
  chiave TEXT PRIMARY KEY,
  valore TEXT
);
```

> **Categoria `ai_act`**: aggiunta in v1.2 per gli adempimenti normativi sull'IA
> (Regolamento UE 2024/1689 + Legge 132/2025), tutti a soggetto `azienda`.
> `database.migra_ai_act()` è idempotente: estende il CHECK dei DB pre-esistenti
> (ricreando `tipi_scadenza` con id preservati), inserisce i tipi AI Act mancanti
> (`INSERT OR IGNORE` su `nome`) e precarica **una sola volta** le scadenze con le
> date note (marcatore `meta.seed_scadenze_ai_act_v1`), così le eliminazioni
> manuali non vengono ripristinate ad ogni avvio. Le milestone già in vigore sono
> precaricate come `chiusa=1` (escluse dagli alert).

### Stato scadenza (MAI salvato, sempre calcolato server-side)

```
chiusa=1                              → stato = "chiusa"
data_scadenza <  oggi                 → stato = "scaduta"
oggi <= data_scadenza <= oggi+preavviso_giorni (del tipo) → stato = "in_scadenza"
altrimenti                            → stato = "valida"
giorni_rimanenti = data_scadenza - oggi (int, negativo se scaduta)
```

### Seed `tipi_scadenza` (inserire in init_db se tabella vuota)

| nome | categoria | soggetto | validita_mesi | preavviso_giorni |
|---|---|---|---|---|
| Formazione generale + specifica lavoratori (agg.) | formazione | dipendente | 60 | 60 |
| Aggiornamento Preposto | formazione | dipendente | 24 | 60 |
| Primo Soccorso (agg.) | formazione | dipendente | 36 | 60 |
| Antincendio (agg.) | formazione | dipendente | 60 | 60 |
| Ponteggi — agg. teorico-pratico | formazione | dipendente | 48 | 60 |
| Lavori in quota / DPI III cat. | formazione | dipendente | 60 | 60 |
| Visita medica idoneità | visita_medica | dipendente | 12 | 45 |
| Patentino gru | patentino | dipendente | 60 | 60 |
| Patentino PLE | patentino | dipendente | 60 | 60 |
| Patentino carrello elevatore | patentino | dipendente | 60 | 60 |
| DURC | durc | subappaltatore | 4 | 30 |
| Verifica periodica attrezzatura | attrezzatura | attrezzatura | 12 | 30 |
| Polizza RCT/RCO | assicurazione | azienda | 12 | 45 |
| Attestazione SOA | certificazione | azienda | 60 | 120 |
| Certificazione ISO 9001 | certificazione | azienda | 12 | 60 |

### Seed `tipi_scadenza` AI Act (inseriti da `migra_ai_act`, `INSERT OR IGNORE` su `nome`)

| nome | categoria | soggetto | validita_mesi | preavviso_giorni |
|---|---|---|---|---|
| AI Act — Divieto pratiche IA vietate (art. 5) | ai_act | azienda | — | 60 |
| AI Act — Alfabetizzazione IA del personale (art. 4) | ai_act | azienda | 12 | 60 |
| AI Act — Obblighi modelli GPAI e governance | ai_act | azienda | — | 90 |
| AI Act — Applicazione generale: alto rischio All. III + trasparenza (art. 50) | ai_act | azienda | — | 120 |
| AI Act — Sistemi ad alto rischio Allegato I | ai_act | azienda | — | 120 |
| L. 132/2025 — Informativa ai lavoratori su uso IA | ai_act | azienda | 12 | 60 |
| L. 132/2025 — Decreti legislativi attuativi (monitoraggio) | ai_act | azienda | — | 90 |

Scadenze precaricate (una-tantum) sui tipi qui sopra, soggetto `azienda`: 02/02/2025 (chiusa), 02/08/2026, 02/08/2025 (chiusa), 02/08/2026, 02/08/2027, 10/10/2026, 10/10/2026.

## API REST (tutte JSON, prefisso /api)

Errori: status 4xx/5xx con body `{"errore": "messaggio"}`. Successo delete: `{"ok": true}`.

### Health & dashboard
- `GET /api/health` → `{"stato":"ok","versione":"1.0.0"}`
- `GET /api/dashboard` →
```json
{
  "contatori": {"scadute": 3, "in_scadenza": 7, "valide": 42, "chiuse": 10},
  "per_categoria": [{"categoria":"formazione","scadute":1,"in_scadenza":2,"valide":20}],
  "prossime": [ <scadenza arricchita, max 15, ordinate per data_scadenza asc, escluse chiuse> ],
  "totali": {"dipendenti": 25, "subappaltatori": 8, "attrezzature": 12}
}
```

### CRUD anagrafiche (pattern identico per le 3 risorse)
- `GET /api/dipendenti?q=&attivo=1` → array. `q` cerca in nome+cognome+cantiere (LIKE, case-insensitive).
- `POST /api/dipendenti` body = campi tabella senza id → oggetto creato (201)
- `PUT /api/dipendenti/<id>` → oggetto aggiornato
- `DELETE /api/dipendenti/<id>` → 409 con `{"errore": ...}` se ha scadenze collegate, altrimenti `{"ok":true}`
- Idem `/api/subappaltatori`, `/api/attrezzature`.

### Tipi scadenza
- `GET /api/tipi` → array completo
- `POST /api/tipi`, `PUT /api/tipi/<id>`, `DELETE /api/tipi/<id>` (409 se usato da scadenze)

### Scadenze
- `GET /api/scadenze?stato=&categoria=&soggetto_tipo=&soggetto_id=&q=&includi_chiuse=0`
  → array di **scadenze arricchite**:
```json
{
  "id": 1, "tipo_id": 7, "tipo_nome": "Visita medica idoneità", "categoria": "visita_medica",
  "soggetto_tipo": "dipendente", "soggetto_id": 3, "soggetto_nome": "Mario Rossi",
  "cantiere": "Ponte Agrò",
  "data_rilascio": "2025-07-01", "data_scadenza": "2026-07-01",
  "documento_rif": null, "note": null, "chiusa": 0,
  "stato": "in_scadenza", "giorni_rimanenti": 18, "preavviso_giorni": 45
}
```
  `soggetto_nome`: dipendente → "Nome Cognome"; subappaltatore → ragione_sociale; attrezzatura → "descrizione (matricola)"; azienda → "Cosedil S.p.A.". `cantiere` dal soggetto se presente, altrimenti null. Ordinamento default: data_scadenza ASC.
- `POST /api/scadenze` body: `{tipo_id, soggetto_tipo, soggetto_id, data_rilascio?, data_scadenza?, documento_rif?, note?}` — se `data_scadenza` assente ma `data_rilascio` presente e il tipo ha `validita_mesi`, il server la calcola (rilascio + validita_mesi). Se entrambe assenti → 400.
- `PUT /api/scadenze/<id>` — stessi campi + `chiusa`.
- `POST /api/scadenze/<id>/rinnova` body `{data_rilascio, data_scadenza?}` → chiude la scadenza corrente (chiusa=1) e ne crea una nuova stesso tipo/soggetto; risponde con la nuova arricchita.
- `DELETE /api/scadenze/<id>` → `{"ok":true}`

### Sessioni corso
- `GET /api/sessioni` → array righe sessioni_corso, `lezioni` come array (parse di lezioni_json)
- `DELETE /api/sessioni/<id>`

### Import / export
- `POST /api/import/calendario` multipart `file`=xlsx → chiama `importer.importa_calendario_corsi(path)` → `{"importate": N, "sessioni": [...]}`  (re-import: svuota e ricarica sessioni_corso)
- `POST /api/import/dipendenti` multipart `file`=csv → `{"importati": N, "saltati": M, "errori": [...]}` (legacy; usare l'import massivo generico)
- `GET /api/export/scadenze.xlsx?stato=&categoria=` → download xlsx (stesse colonne della scadenza arricchita)
- `GET /api/export/calendario_modello.xlsx` → **maschera** vuota del Calendario Corsi (struttura attesa dall'import).

**Maschere Excel + import massivo (v1.3)** — ovunque si inseriscano più elementi. Base comune: `importer.leggi_righe_tabellari(path)` (xlsx primo foglio o csv; intestazione = prima riga con ≥2 celle; `importer.chiave_intestazione` normalizza le intestazioni; celle-data → ISO). Per ogni risorsa:
- Anagrafiche `dipendenti|subappaltatori|attrezzature|sistemi_ia`: `GET /api/<risorsa>/modello.xlsx` e `POST /api/<risorsa>/import` (multipart `file`, xlsx/csv) → `{"importati","saltati","errori"}`. Dedup su chiavi naturali (`cfg["import_chiavi"]`); enum di `sistemi_ia` accettati per chiave o etichetta IT.
- Tipi: `GET /api/tipi/modello.xlsx`, `POST /api/tipi/import` (dedup su `nome`).
- Scadenze: `GET /api/scadenze/modello.xlsx`, `POST /api/scadenze/import` — risolve il **tipo per nome** e il **soggetto per nome** (dipendente = "Nome Cognome", subappaltatore = ragione sociale, attrezzatura = descrizione, sistema IA = nome; vuoto = azienda); `data_scadenza` vuota → calcolata da rilascio + validità. Righe non risolvibili tornano in `errori`.
- Le maschere hanno righe 1–2 di titolo/istruzioni (celle singole, ignorate dal lettore) e intestazione a riga 4; l'accoppiamento colonna→campo accetta intestazione completa, senza suggerimento tra parentesi, o nome campo.

### Notifiche
- `GET /api/notifiche/riepilogo` → `{"da_notificare": [ <scadenze arricchite stato scaduta|in_scadenza non chiuse> ]}`
- `POST /api/notifiche/esegui` → esegue `notifiche.esegui_notifiche()` → `{"inviate": N, "log": [...]}`
- `GET /api/notifiche/log?limit=50` → array notifiche_log (join scadenza per contesto)

Notifiche v1.3: **preavviso multi-step** — a ogni soglia di `config.SOGLIE_PREAVVISO_GIORNI` attraversata (180/90/60/30/14/7/1/0 gg) parte una notifica dedicata, una sola volta per soglia (colonna `notifiche_log.contesto = 'soglia_<T>'`); le scadute rinotificano una volta al giorno (`contesto='scaduta'`). Il canale **email** è reale se configurato via env (`EMAIL_ABILITATA`, `SMTP_*`, `EMAIL_DA`, `EMAIL_A`), altrimenti logga `disabilitato`; whatsapp resta stub.

### v1.3 — Registro Sistemi IA, checklist, allegati, dossier

- **Sistemi IA** (`sistema_ia`): CRUD identico alle altre anagrafiche su `/api/sistemi_ia` (campi: nome*, fornitore, finalita, `classe_rischio`, `ruolo`, `stato_conformita`, referente, cantiere, attivo, note; gli enum sono validati server-side, vuoto = default). È un `soggetto_tipo` valido per le scadenze (richiede `soggetto_id`).
- **Checklist adempimenti** (sotto-attività di una scadenza):
  - `GET /api/scadenze/<id>/adempimenti` → array (ordinati per `ordine`,`id`)
  - `POST /api/scadenze/<id>/adempimenti` body `{descrizione*, note?, fatto?}`
  - `PUT /api/adempimenti/<id>` body `{descrizione?, fatto?, note?}` (settare `fatto=1` timestampa `fatto_il`)
  - `DELETE /api/adempimenti/<id>`
- **Allegati** (evidenze, file in `config.ALLEGATI_DIR`, estensioni/limite da config):
  - `GET /api/scadenze/<id>/allegati` → array (senza `percorso` interno)
  - `POST /api/scadenze/<id>/allegati` multipart `file` → 201 (nome salvato = uuid + estensione)
  - `GET /api/allegati/<id>/download` → file con `nome_file` originale
  - `DELETE /api/allegati/<id>` → rimuove riga + file
- **Scadenza arricchita** (aggiunte v1.3): `referente`, `adempimenti_totali`, `adempimenti_fatti`, `allegati_totali`.
- **Dossier**: `GET /api/export/ai_act.xlsx` → xlsx a 3 fogli (Scadenze AI Act incluse le chiuse · Registro Sistemi IA · Checklist).
- Eliminare una scadenza fa CASCADE su `adempimenti`/`allegati` e rimuove i file dal disco.

## Firme moduli (contratto per app.py)

```python
# importer.py
def importa_calendario_corsi(xlsx_path: str) -> dict: ...
    # legge foglio "Calendario Corsi": header a riga 4 (index 3): AULA|CICLO|N° PERS.|GIORNO|LEZ. 1..6|DOCENTE|SEDE
    # righe dati = quelle con cella AULA che inizia per "AULA"; ignora righe separatore (es. "▸ AULE 1-3 …")
    # LEZ. colonne = datetime → ISO; ritorna {"importate": N, "sessioni": [...]}
def importa_dipendenti_csv(csv_path: str) -> dict: ...
    # colonne accettate (header ; o ,): nome;cognome;codice_fiscale;mansione;cantiere;telefono;email
    # dedup su codice_fiscale (se presente) o nome+cognome

# notifiche.py
def scadenze_da_notificare() -> list[dict]: ...       # arricchite, stato in (scaduta, in_scadenza), chiusa=0
def esegui_notifiche() -> dict: ...                   # canale in_app: logga su notifiche_log; email/whatsapp: stub → esito 'disabilitato'
def formatta_messaggio(scadenza: dict) -> str: ...    # es. "⚠ Visita medica di Mario Rossi scade il 01/07/2026 (18 giorni)"
```

## Frontend (SPA, hash routing)

Viste (nav sidebar sinistra, ordine):
1. `#/dashboard` — 4 stat card (Scadute rosso / In scadenza giallo / Valide verde / Soggetti navy), tabella "Prossime scadenze" con badge stato, grafico a barre orizzontali per categoria (CSS puro, niente librerie).
2. `#/scadenze` — filtri (stato, categoria, testo, includi chiuse) + tabella; azioni riga: Rinnova (modale), Modifica, Elimina; bottone "+ Nuova scadenza" (modale con select tipo → soggetto filtrato per tipo.soggetto; se scelgo data_rilascio autocompila data_scadenza da validita_mesi).
3. `#/dipendenti`, `#/subappaltatori`, `#/attrezzature`, `#/sistemi_ia` — tabella + ricerca + CRUD modale; colonna "Scadenze" con conteggio per stato (click → vista scadenze filtrata sul soggetto). `#/sistemi_ia` (v1.3) è il registro AI Act con badge di classe di rischio e stato di conformità.
   - Vista Scadenze (v1.3): colonna "Adempimenti" (checklist x/y + n° allegati) e azione **Checklist e allegati** → modale con checklist spuntabile e upload evidenze; bottone **Dossier AI Act** (`/api/export/ai_act.xlsx`); campo **Referente** nella modale scadenza.
4. `#/corsi` — upload xlsx Calendario Corsi + tabella sessioni con date lezioni.
5. `#/impostazioni` — CRUD tipi_scadenza; sezione notifiche: bottone "Esegui notifiche ora", riepilogo da notificare, log.

Badge stato: scaduta = rosso, in_scadenza = giallo, valida = verde, chiusa = grigio muted. Date visualizzate `DD/MM/YYYY`, inviate all'API sempre ISO.

**Stile: OBBLIGATORIO il design system Cosedil** — leggere `C:\Users\Alessio\.claude\skills\cosedil-style\SKILL.md` e rispettare la checklist finale (palette navy #0c4577 / azzurro #198fd9, Ubuntu headings + Open Sans body via Google Fonts, sfondo #f2f3f5, pannelli bianchi bordo #dfe4ea radius 8px, label uppercase muted, niente emoji-icone → SVG inline stroke stile Lucide, una sola CTA primaria navy per vista, light theme only).

Header app: barra navy con logo testuale "COSEDIL" bianco + titolo "Scadenzario"; sidebar bianca; voce attiva navy bold + indicatore 2px azzurro.

## Convenzioni

- Codice, commenti e UI in italiano (come gli altri tool Cosedil).
- `app.py` monta le API sopra e serve `index.html` su `/`; nessuna auth in v1 (rete locale).
- CORS non necessario (stessa origine).
- Validazione input server-side: date ISO valide, FK esistenti, enum rispettati → 400 con messaggio chiaro in italiano.

> **Autenticazione e pagina admin**: definite in [SPEC-ADMIN.md](SPEC-ADMIN.md) (estensione v1.1 di questo contratto).
