<!-- "><(((º> sabusabu <º)))><" -->
# Verifica Requisiti

App della Suite Cosedil che fa due cose sui documenti scansionati che si caricano:

1. **ricerca** — cerca parole e frasi dentro il testo dei documenti, anche quando il
   documento è una fotografia (il testo lo tira fuori l'OCR);
2. **controllo requisiti** — applica una checklist ("il DURC è scaduto?", "c'è la partita
   IVA?", "compare la dicitura X?") e produce un esito per requisito, con il riscontro
   nel testo e il report Excel.

Stessa impalcatura di **lettore-ddt** (Express + TypeScript, gate SSO condiviso, lock di
istanza singola, watchdog di inattività), così chi conosce quella app ritrova le stesse cose
negli stessi posti.

## Avvio

```
avvia.vbs            # avvio normale (finestra nascosta, apre il browser)
npm install && npm run build && npm start
npm run dev          # sviluppo, senza build
```

Porta: **5185** (fallback fino a 5189). Accesso attraverso il Portale Suite: senza login

**Programma riservato**: nel Portale la vedono e la usano gli amministratori e i soli utenti abilitati (Amministrazione > Utenti, colonna *Accessi riservati*). Chi non è abilitato non trova la card e, se digita l'indirizzo a mano, riceve 403 dal gate SSO.
del portale l'app risponde con il gate SSO. In sviluppo: `set COSEDIL_SSO=off`.

## Come funziona

```
upload  ->  archivio (data/archivio)  ->  estrazione testo  ->  indice + verifiche
                                            |
                                  PDF con testo? lo legge
                                  scansione?     OCR
```

- **estrazione** (`src/services/estrazione.ts`): se il PDF ha meno di
  `sogliaTestoNativo` caratteri selezionabili è una scansione e passa dall'OCR. Coda
  seriale: l'OCR satura la CPU, farne tre insieme non fa finire prima.
  Il testo nativo si legge con `pdfjs-dist` e **non** con `pdf-parse`: quest'ultimo
  impacchetta un pdf.js del 2018 che, se express/multer/exceljs vengono caricati prima
  di lui, fallisce con "bad XRef entry" su PDF validi.
  All'avvio pdf.js stampa due avvisi (`Cannot polyfill DOMMatrix/Path2D: cannot find
  module 'canvas'`): sono innocui, riguardano il disegno delle pagine e qui si estrae
  solo testo.
- **OCR** (`src/services/ocr/`): motori intercambiabili, si sceglie con `motoreOcr` in
  `config.json`.
  - `tesseract` — funzionante; per i PDF serve `pdftoppm` (poppler) nel PATH;
  - `paddle` — segnaposto, da collegare al worker di `ocr-documenti`;
  - `claude` — segnaposto, vision a pagamento: serve chiave API e tetto di spesa.
- **indice** (`src/services/indice.ts`): full-text in memoria, ricostruito all'avvio.
  Normalizzazione a lunghezza costante, così l'offset trovato punta al carattere giusto
  del testo originale e il riscontro si può mostrare com'era scritto.
- **regole** (`src/services/regole.ts`): il motore degli esiti. Sei tipi di regola —
  `presenza`, `assenza`, `regex`, `scadenza`, `numero`, `manuale`.
- **confronto con Claude** (`src/prompts.ts` + `src/services/importaEsito.ts`): i prompt
  dei bottoni della scheda "Analisi Claude" stanno tutti in `src/prompts.ts` — per
  aggiungerne uno si tocca solo quel file. Il frontend li prende da `GET /api/prompts`,
  sostituisce `{{REQUISITI}}` con i requisiti della checklist scelta, copia il prompt e
  apre claude.ai; la risposta JSON incollata torna indietro da
  `POST /api/verifiche/importa` e diventa una verifica identica a quelle calcolate dalle
  regole (stesso storico, stesso report Excel). Il documento va allegato a mano in chat:
  il browser non può passarlo a claude.ai.
  Oltre ai confronti ci sono i sei prompt di estrazione presi da "lettore-ddt" (DDT
  calcestruzzo/scansione/inerti, WBS, fattura, registro FIR): quelli rispondono con
  tabelle e la risposta incollata diventa un .xlsx (`src/services/fogliExcel.ts`). Sono
  una copia del file dell'altra app: se lì cambiano, qui restano fermi.

Gli esiti sono `ok` / `ko` / `dubbio` / `non-applicabile`. Il `dubbio` non è pigrizia: su
una scansione con OCR incerto un `ko` automatico manderebbe indietro un fornitore in regola.

## API

| Metodo | Rotta | Cosa fa |
|---|---|---|
| POST | `/api/documenti` | carica file (multipart `files`, max 20) |
| GET | `/api/documenti` | elenco con stato di lavorazione |
| GET | `/api/documenti/:id/testo` | testo estratto, pagina per pagina |
| GET | `/api/documenti/:id/file` | il file originale |
| POST | `/api/documenti/:id/rielabora` | rifà l'estrazione |
| DELETE | `/api/documenti/:id` | elimina documento e sue verifiche |
| GET | `/api/ricerca?q=` | ricerca full-text (AND fra i termini, `"frase"` esatta) |
| GET/POST/PUT/DELETE | `/api/requisiti[/:id]` | checklist di requisiti |
| POST | `/api/verifiche` | esegue `{ setId, documentoIds }` |
| POST | `/api/verifiche/importa` | importa `{ risposta, documentoId?, setId? }` incollata da Claude |
| GET | `/api/prompts` | i prompt dei bottoni (confronto ed estrazione) |
| POST | `/api/fogli/excel` | risposta "a fogli" (DDT, WBS, fattura, FIR) → file .xlsx |
| GET | `/api/verifiche[/:id]` | storico ed esiti |
| GET | `/api/verifiche/:id/report.xlsx` | report Excel |
| GET | `/status`, `/metrics` | health check e metriche Prometheus |

## Dati

Tutto sotto `data/` (mai versionato):

```
data/archivio/        file originali
data/documenti.json   metadati + testo estratto
data/requisiti.json   checklist
data/verifiche.json   storico esiti
```

## Da fare (lo scheletro si ferma qui)

- collegare PaddleOCR e/o Claude vision (i due adattatori segnaposto);
- confidenza per pagina: Tesseract la sa dare (`tsv`), ora non viene letta e la soglia
  `CONFIDENZA_MINIMA` in `regole.ts` lavora quindi solo sui motori che la forniranno;
- editor a campi per le checklist (oggi si modifica il JSON);
- test di integrazione delle rotte (ci sono quelli del motore regole, della ricerca e
  dell'import da Claude: `npm test`, 43 casi).
