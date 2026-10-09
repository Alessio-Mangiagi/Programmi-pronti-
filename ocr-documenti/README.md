<!-- "><(((º> sabusabu <º)))><" -->
# OCR Documenti — PaddleOCR + assist Ollama

Web app COSEDIL per estrarre contratti edili scansionati (PDF/immagini) e compilare
**`Import_Contratti.xlsx`** per l'ERP TeamSystem Alyante. Tutto in locale, nessun dato in cloud.

Variante **PaddleOCR** della webapp Tesseract: stessa interfaccia, stessi parser e stessa
ricostruzione geometrica delle tabelle — cambia solo il motore OCR.

Pipeline ibrida:

- **PaddleOCR** (modelli PP-OCR più recenti, v5/v6) fa l'OCR vero e proprio via worker Python persistente
  (`ocr_worker.py`): il modello si carica una volta sola, ogni pagina restituisce testo
  **e coordinate** dei blocchi, convertite nello stesso TSV usato dalla ricostruzione tabelle.
- **Ollama** (`qwen2.5:3b`) è un **assist opzionale**: interviene solo per riempire i campi che i
  parser non hanno trovato. Spento, l'app funziona lo stesso.

## Prerequisiti

- [Node.js](https://nodejs.org/) ≥ 18
- [Python](https://www.python.org/) ≥ 3.10 con venv locale `.venv` e PaddleOCR:
  ```
  python -m venv .venv
  .venv\Scripts\pip install paddlepaddle paddleocr --trusted-host pypi.org --trusted-host files.pythonhosted.org
  ```
  Al **primo avvio** PaddleOCR scarica i modelli (~30 MB) nella home utente (`.paddlex`):
  serve la connessione solo quella volta.
- [Ollama](https://ollama.com/) — **opzionale**, solo per l'assist:
  ```
  ollama pull qwen2.5:3b
  ```

### Variabili d'ambiente (opzionali)

| Var | Default | Uso |
|-----|---------|-----|
| `PYTHON_BIN` | `./.venv/Scripts/python.exe` | interprete Python col PaddleOCR |
| `PADDLE_DET_MODEL` | `PP-OCRv5_mobile_det` | modello detection (più preciso ma ~3× più lento: `PP-OCRv6_medium_det`) |
| `PADDLE_REC_MODEL` | `latin_PP-OCRv5_mobile_rec` | modello recognition (alternativa: `PP-OCRv6_medium_rec`) |
| `PADDLE_WORKERS` | `3` | processi OCR in parallelo (~1 GB RAM ciascuno); partono solo se la coda li richiede |
| `PORT` | `3007` | porta backend Express |
| `OLLAMA_BASE` | `http://localhost:11434` | endpoint Ollama |
| `ASSIST_MODEL` | `qwen2.5:3b` | modello assist |
| `OCR_CACHE` | `1` | `0` spegne la cache dei blocchi OCR (`.ocr-cache/`, per hash di pagina) |
| `OCR_BIND_HOST` | `127.0.0.1` | interfaccia del backend; se non locale (o `NODE_ENV=production`) il gate SSO del portale si attiva anche qui |
| `PADDLE_INSECURE_SSL` | auto | `1`/`0` forza/vieta il download dei modelli senza verifica dei certificati (reti con ispezione SSL). Auto = solo finché `~/.paddlex` non esiste |

## Avvio

Doppio clic su **`avvia.bat`** — apre il browser su `http://localhost:5179`.
Parte in **produzione** (`npm run start:prod`, [tools/avvio-prod.mjs](tools/avvio-prod.mjs)):
il backend serve il frontend compilato da `dist/` sulla 5179, senza dev server. `dist/` viene
ricompilata da sola quando è più vecchia dei sorgenti; se la build fallisce si ripiega su `npm run dev`.

Sviluppo:

```bash
npm install
npm run dev     # concurrently: tsx watch server.ts (backend :3007) + vite (frontend :5179, HMR)
```

`avvia_backend.bat` avvia il solo backend con `tsx watch` (ricarica automatica).

**Non parte?** `avvia.vbs` (usato dal Portale) gira nascosto e scrive tutto in `avvio.log`:
leggere quello. Se la pagina mostra **"PaddleOCR bloccato"**, il motivo è nel tooltip: tipico
è Windows App Control (WDAC) che rifiuta le DLL non firmate del venv (`WinError 4551`) — non si
risolve reinstallando, serve l'IT. Il resto del programma (PDF con testo, .docx, elenchi) funziona.

## Formati di input

| Tipo | Estensioni |
|------|-----------|
| PDF (scansionato o nativo) | `.pdf` |
| Immagine | `.jpg`, `.png`, `.webp`, `.gif` |
| Word | `.docx`, `.doc` |
| Excel | `.xlsx`, `.xls` |
| Testo | `.md`, `.txt` |

Multi-file: si possono trascinare più file insieme, ognuno tiene il proprio risultato in coda.

## Formati di output

- **MD** — trascrizione fedele (titoli, tabelle GFM). Per i contratti include in fondo la sezione
  `### TABELLA ARTICOLI (ricostruita dalla scansione)` generata dalle coordinate dei blocchi.
- **JSON** — DDT calcestruzzo strutturato.
- **CONTRATTO** — campi compatibili Primavera P6, export `.xlsx`/`.docx`/`.csv`.
- **ALYANTE** — 4 sezioni (Testata, Righe, Anagrafiche, Importi) → **`Import_Contratti.xlsx`**
  allineato al gold `Import_Contratti (2).xls`. **Elabora → Excel** in barra (o **Scansiona**
  sulla riga della coda) = scan completo + compilazione + salvataggio in un colpo.

## Pipeline OCR (dettaglio)

1. **Render PDF** (frontend, pdf.js): scala max 4.0, lato lungo ≤ 3300 px ≈ 300 DPI reali su A4,
   PNG lossless con grayscale + contrasto ([src/App.tsx](src/App.tsx) `renderPdfPage`/`canvasToPng`).
2. **PaddleOCR** ([server.ts](server.ts) `ocrPaddle` + [ocr_worker.py](ocr_worker.py)): worker
   Python persistente, una sola inferenza per pagina; i blocchi rilevati (testo + rettangolo)
   diventano righe visuali → testo scorrevole + TSV formato Tesseract.
3. **Ricostruzione geometrica** (`tabellaColonne`): righe visuali per Y, colonna descrizione per X,
   filtri header/piè di pagina/clausole/sotto-prezzi, riga-totali che corregge i numeri spuri.
4. **Parser righe in gara** (vince chi trova più voci): riga-singola, pipe (`estraiRighePipe`,
   con fusione righe spezzate), blocchi (`estraiRigheTabellari`). Log backend:
   `[Righe] singola:N pipe:N blocchi:N` e `[Tabella TSV] ricostruiti N articoli`.
5. **Imbuto finale**: `normalizzaCodice` (storpiature OCR tipo SIC24, Ø, segmenti puntati),
   `recuperaCodiciRighe`, `pulisciDescrArticolo`, riparazione qta/prezzo/importo slittati
   (solo se importo = qta × prezzo esatto), dedup.
6. **Assist Ollama** (opzionale): riempie solo i campi vuoti; sostituisce le righe solo se ne
   trova di più.

## Export Import_Contratti (regole)

- Gold di riferimento: **`Import_Contratti (2).xls`** nella root → colonne, tipi (date serial,
  numeri veri), valori.
- Liste ufficiali in **`Elenchi/`**: DITTA, DIVISIONE, `cond_pagamento.json`, RIPARTIZIONE
  COMMESSE (→ PROGETTO), famiglie/sottofamiglie, Piano dei conti. Un file aggiornato viene
  riletto da solo (`fs.watch`); in alternativa `POST /api/elenchi/ricarica`. Le regole di
  aggancio sono in `src/lib/elenchi.ts`, condivise fra server e browser.
- **PROGETTO/EPU**: match a prefisso sull'elenco commesse; nessuna corrispondenza → valore
  estratto + **cella rossa** nell'xlsx (da verificare a mano).
- Regole fisse: **EPU = PROGETTO**; COLL=1, FIRMATO=1, NODO=0; FORNITORE = P.IVA;
  DITTA 2 = COSEDIL S.p.A.; RG/RI da % ritenuta garanzia (5% → RG05 + R005).

## Architettura

```
Browser (Vite :5179)
  └─ React + TypeScript (App.tsx: UI e coda; src/lib/: file-input, export-*, import-contratti, salvataggio)
       └─ fetch /api/*
            └─ Express (:3007) [server.ts]
                 ├─ ocr_worker.py  (PaddleOCR, worker persistente, blocchi+coordinate)
                 └─ Ollama :11434 (qwen2.5:3b — assist opzionale)
```

### Percorso nativo: l'OCR è il ripiego, non la regola

Un PDF generato al computer e un `.docx` portano già il testo esatto — e il Word porta
anche le tabelle come tabelle. Rasterizzarli per darli all'OCR butta via entrambe le cose
e le rilegge peggio. `src/lib/testo-nativo.ts` li riduce allo stesso testo a righe che il
server riceve dall'OCR, spedito a `/api/ocr` nel campo `text`: **i parser non cambiano**,
cambia solo da dove arrivano le righe.

| Input | Percorso |
|---|---|
| PDF, pagina con layer di testo | `page.getTextContent()` → righe → `text` |
| PDF, pagina scansionata | rendering 3300px → PaddleOCR (come prima) |
| `.docx` | `mammoth.convertToHtml` → righe, tabelle comprese |
| `.doc` (Word 97-2003) | **non supportato** — mammoth legge solo OOXML: da salvare come `.docx` |

La scelta è **per pagina**, non per file: un contratto firmato con l'elenco prezzi
esportato in digitale porta le due nature nello stesso PDF (misurato sul dataset: Beton
Strade è nativo su 25 pagine e scansione sulle 3 delle firme).

Guardia: un layer di testo può essere l'OCR di qualcun altro (scansione passata per
Acrobat), non migliore del nostro e senza confidenza per riga. `layerUtile` applica la
stessa metrica di `testoGarbled` più una soglia di densità; se non passa, la pagina torna
all'OCR. "Scansiona con AI" resta una richiesta esplicita e scavalca la scorciatoia.

## Test (`npm test`, `npm run check`)

`npm test` (vitest) copre le librerie condivise (`src/lib/__tests__/`), l'aggancio agli
elenchi Alyante e le righe Import_Contratti (`server/__tests__/`, `src/lib/__tests__/`).
`npm run check` = typecheck (frontend + server) + ESLint + test: è quello che gira in CI.

**Regressione sui contratti reali**: `server/__tests__/baseline.test.ts` rigioca la parte
deterministica della pipeline (testo → `estrai` → struttura → elenchi) su ogni cartella di
`tests/baseline/<contratto>/` (`ocr.txt` + `alyante.json` + `contratto.json`, prodotti dal
banco di prova qui sotto e **fuori da git**: sono documenti aziendali) e pretende lo stesso
JSON. Senza baseline la suite si salta. Dopo una modifica voluta ai parser:
`npm run baseline:aggiorna` riscrive i JSON — guardare prima il diff di vitest.

## Banco di prova offline (`npm run harness`)

Passa tutti i `.pdf` e `.docx` di `contratti/` per la pipeline REALE (stesse funzioni
della route `/api/ocr`, e lo stesso `src/lib/testo-nativo.ts` del frontend) senza browser, e **mette in cache su disco i blocchi OCR**: la prima volta
costa come una scansione normale, dopo ogni prova di parser costa secondi.

```bash
npm run harness                 # tutti i contratti
npm run harness -- Warm MADA    # solo i file col nome che contiene Warm o MADA
npm run harness -- --no-cache   # rifà anche l'OCR
npm run harness -- --no-nativo  # ignora il layer di testo: tutto all'OCR (misura di controllo)
npm run harness -- --assist     # abilita l'assist LLM (default OFF: non deterministico)
```

Output in `tests/out/<contratto>/`: `ocr.txt` (input esatto dei parser), `alyante.json`,
`contratto.json`; più `tests/out/_report.json` con pagine, righe, campi vuoti per file.
Per confrontare un prima/dopo basta copiare `tests/out` prima di modificare i parser.

In cache vanno i **blocchi** dell'inferenza, non il testo: il testo contiene già la
tabella ricostruita, quindi cachearlo congelerebbe proprio ciò che si sta modificando.

Strumenti di supporto:

| Comando | A cosa serve |
|---|---|
| `npx tsx tools/dbg_pagina.ts <nome> <pagina>` | Geometria OCR di una pagina: ogni riga con Y, X inizio/fine, testo, poi il testo ricomposto. Serve quando una tabella esce sbagliata |
| `node tools/dump_xlsx.mjs <file.xlsx>` | Legge un Import_Contratti compilato per confrontarlo con l'output |
| `DBG_TABELLA=1` / `DBG_FORN=1` | Diagnostica su stderr: confini di cella calcolati / candidati ragione sociale |

## Risoluzione problemi

| Problema | Soluzione |
|----------|-----------|
| PaddleOCR non trovato | Ricreare il venv (vedi Prerequisiti) o impostare `PYTHON_BIN` |
| Primo scan lentissimo | Normale una volta sola: download modelli (~30 MB) + caricamento |
| 0 articoli sempre (`[Tabella TSV] ricostruiti 0`) | Layout non ancora tarato: guardare la sezione `### TABELLA ARTICOLI` in MD |
| Assist AI spento | Normale: è opzionale. Per attivarlo: `ollama serve` + `ollama pull qwen2.5:3b` |
| Porta 3007 occupata | Il server riprova da solo fino a 10 volte |
| PROGETTO/EPU in rosso nell'xlsx | Commessa non in elenco → aggiornare `Elenchi/2025.04.02 - RIPARTIZIONE COMMESSE.xlsx` |
| Tabella articoli sbagliata | Copiare la sezione `### TABELLA ARTICOLI` dal risultato MD e tarare i parser sul layout |
