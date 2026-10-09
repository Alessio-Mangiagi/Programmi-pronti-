# Document-ocr — Mappa dei File

> Riferimento rapido: cosa fa ogni file senza aprirlo.

---

## Frontend (`src/`)

| File | Cosa fa |
|------|---------|
| [src/main.tsx](../src/main.tsx) | Entry point React. Monta `<App>` nel DOM con StrictMode. |
| [src/lib/confronto.ts](../src/lib/confronto.ts) | Confronto bozza Word ↔ PDF firmato: diff di Myers a parole con chiave tollerante agli errori OCR, testo unito (vale il PDF, il Word dove coincidono), elenco differenze. Test in `src/lib/__tests__/confronto.test.ts`. |
| [src/VistaConfronto.tsx](../src/VistaConfronto.tsx) | Scheda «Confronto» del pannello risultato. |
| [src/App.tsx](../src/App.tsx) | Componente principale (~1790 righe). Tutta la UI: drag-drop upload, preview PDF/immagine/Word/Excel, OCR singolo/batch/range, quattro modalita' output (MD, JSON, Contratto, Alyante), export xlsx/docx/csv/xml, editing inline Alyante, riprocessa, template Primavera P6, schede Documento/JSON/Modifica/Originale, barra progress, coda di lavoro a tabella (stato, esito, azioni per riga, anteprima in hover), pannello risultato a destra. La libreria `docx` e' caricata con import dinamico solo negli handler di export. |
| [src/lib/testo-nativo.ts](../src/lib/testo-nativo.ts) | Percorso NATIVO: layer di testo dei PDF digitali e tabelle dei .docx ridotti allo stesso testo a righe che il server riceve dall'OCR, cosi' i parser non cambiano. Frammenti pdf.js raggruppati in righe con tolleranza legata al corpo del carattere; HTML di mammoth letto con un tokenizzatore senza DOM (gira anche in node) che espande colspan/rowspan. `layerUtile` scarta i layer che sono OCR di qualcun altro. CONDIVISO con tools/harness.ts: le euristiche stanno scritte una volta sola. |
| [src/index.css](../src/index.css) | Stile globale tema terminale scuro. Scanline overlay CRT. Scrollbar custom. Stili Markdown per il pannello output (titoli neon, tabelle, codice, blockquote). Range input senza frecce native. |

---

## Backend

| File | Cosa fa |
|------|---------|
| [server.ts](../server.ts) | Server Express (porta 3001). Proxy tra frontend e Ollama locale (modello `minicpm-v:latest`). Watchdog auto-shutdown dopo 2 min senza heartbeat. Endpoint `GET /api/ping` -- heartbeat. Endpoint `GET /api/health` -- controlla Ollama e disponibilita' modello. Endpoint `POST /api/ocr` -- riceve immagini base64 o testo, chiama il modello (temperature 0, num_ctx 4096/8192, keep_alive 30m), post-processa (strip fence, merge JSON multi-pagina, HTML->MD, JSON->MD leggibile, repair JSON malformato, retry se righe Alyante vuote), restituisce risultato. Elaborazione Alyante in due fasi (immagine->MD->JSON). Avvio robusto con retry su EADDRINUSE e shutdown pulito su SIGTERM/SIGINT. |

---

## Script di avvio

| File | Cosa fa |
|------|---------|
| [avvia.bat](../avvia.bat) | Launcher completo Windows. Installa automaticamente Node.js (winget) e Ollama se mancanti, verifica/scarica il modello `qwen2.5vl:7b` ⚠ (non allineato con server.ts che usa `minicpm-v`), installa `npm install` se serve, avvia `npm run dev` (frontend Vite + backend Express). |
| [avvia_backend.bat](../avvia_backend.bat) | Avvia solo il backend. Controlla/avvia Ollama, verifica/scarica `qwen2.5vl:7b` ⚠ (non allineato con server.ts), poi lancia il server Express su porta 3001 via `npx tsx server.ts`. |
| [avvia.vbs](../avvia.vbs) | Launcher VBScript: avvia `avvia.bat` senza finestra terminale visibile. |

---

## Configurazione

| File | Cosa fa |
|------|---------|
| [package.json](../package.json) | Dipendenze (Express, React, PDF.js, mammoth, xlsx, docx) e script npm (`dev`, `build`, `start`, `preview`). |
| [vite.config.ts](../vite.config.ts) | Config Vite: plugin React, proxy `/api` -> `localhost:3001`, ottimizzazione `pdfjs-dist`. |
| [tsconfig.json](../tsconfig.json) | Opzioni TypeScript: target ES2020, JSX React, strict mode, nessun emit (bundling via Vite). |
| [index.html](../index.html) | HTML root. Contiene `<div id="root">` e carica `src/main.tsx`. |

---

## Documentazione

| File | Cosa fa |
|------|---------|
| [README.md](../README.md) | Prerequisiti, avvio rapido, formati supportati, funzioni toolbar, risoluzione problemi. |
| [REPORT.md](REPORT.md) | Specifiche tecniche complete: architettura, funzionalita', schemi JSON, design system. |
| [STRUTTURA.md](STRUTTURA.md) | Questo file. Mappa rapida di tutti i file del progetto. |
| [GUIDA_UTILIZZO.md](../GUIDA_UTILIZZO.md) | Guida passo-passo per l'utente finale: come usare l'app per ogni caso d'uso. |
| [PIPELINE_ESTRAZIONE_CONTRATTI.md](PIPELINE_ESTRAZIONE_CONTRATTI.md) | Maschere di estrazione per famiglia di contratto (subappalto, subaffidamento, fornitura, fornitura e posa, nolo a caldo/freddo, incarico): riconoscimento del modello dalla sigla in calce, griglia dell'Art. 5 elenco prezzi, computo metrico "SOMMANO", tariffe in prosa, allegati Excel. |
| [PIPELINE_ESTRAZIONE_ARTICOLI.md](PIPELINE_ESTRAZIONE_ARTICOLI.md) | Catalogo articoli ANAS per opera d'arte (contratti a voci di tariffa senza prezzi). |
| [PIPELINE_ESTRAZIONE_PRESTAZIONI.md](PIPELINE_ESTRAZIONE_PRESTAZIONI.md) | Prestazioni in elenco a lettere degli incarichi/servizi professionali. |
| [CHAT_LOG.md](CHAT_LOG.md) | Log storico della conversazione di progettazione (giugno 2026). |

---

## Elenchi ufficiali (`Elenchi/`)

Anagrafiche Alyante caricate dal server all'avvio (riconosciute dal nome file, pattern tollerante alle date). Il JSON estratto viene normalizzato sui loro valori ESATTI; il frontend le riceve via `GET /api/elenchi`.

| File | Collegato a |
|------|-------------|
| `DIVISIONE.xlsx` | `testata.divisione` → codice 2 cifre (es. `03`), da tipologia contratto o fuzzy. |
| `cond_pagamento.json` (estratto da `COND PAGAMENTO.pdf`) | `testata.cond_pagamento` → codice elenco (es. `DA`, `132`); match per giorni/strumento/DF-FM/acconto. |
| `2025.04.02 - RIPARTIZIONE COMMESSE.xlsx` | `testata.codice_progetto` e colonne PROGETTO/EPU → cod. commessa esatto (es. `193-136_6`). |
| `DITTA.xlsx` | colonna DITTA → codice numerico gruppo (es. COSEDIL S.p.A. → `2`). |
| `famiglia e sottofamiglia.xlsx` | FAM/SFAM → validazione codici ufficiali (codice non in elenco → svuotato). |
| `260306-Piano dei conti-in corso.xlsx` | `righe[].conto` → codice voce di spesa (es. `101`). |

Endpoint: `GET /api/elenchi` (liste per il frontend) · `POST /api/normalizza` (ri-normalizza un JSON ALYANTE dopo modifiche manuali).

<!-- "><(((º> sabusabu <º)))><" -->

⚠ `COND PAGAMENTO.pdf` non è letto a runtime: se l'elenco cambia va rigenerato `Elenchi/cond_pagamento.json`.

---

## File extra

| File | Cosa fa |
|------|---------|
| [scontrini.html](scontrini.html) | App standalone separata (raccolta scontrini / nota spese trasferta) — non fa parte della webapp OCR. |
| [2026.06.08 - PROCEDURA INSERIMENTO CONTRATTI ALYANTE.pdf](.) | PDF di riferimento con la procedura manuale di inserimento contratti in Alyante. |

---

## Architettura in breve

```
Browser
  └─ Vite Dev Server (porta 5173)
       └─ React App (App.tsx)
            └─ fetch /api/* -> proxy Vite
                 └─ Express Server (porta 3001)  [server.ts]
                      └─ Ollama locale (porta 11434)
                           └─ minicpm-v:latest  (modello visione multimodale)
```

**Stack:** React 18 + TypeScript · Vite · Express.js · Ollama (minicpm-v:latest) · PDF.js · mammoth · xlsx · docx
