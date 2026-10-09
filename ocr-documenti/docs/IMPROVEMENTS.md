# Roadmap miglioramenti

Stato al 2026-09-18. La versione precedente di questo file descriveva un `server.ts` da
1500 righe e una cache OCR da fare: entrambe cose già risolte da tempo (backend in
`server/*.ts`, cache in `server/ocr.ts` → `.ocr-cache/`). Qui c'è quello che vale ancora.

## Fatto (2026-09-14)

| Cosa | Dove |
|------|------|
| Test di regressione dei parser sui contratti reali (`tests/baseline/`, fuori git) | `server/__tests__/baseline.test.ts`, `npm run baseline:aggiorna` |
| Unit test aggancio elenchi Alyante e righe Import_Contratti | `server/__tests__/alyante.test.ts`, `src/lib/__tests__/import-contratti.test.ts` |
| Regole di aggancio (commessa, ditta, FAM/SFAM) scritte una volta sola per backend e frontend | `src/lib/elenchi.ts` |
| `App.tsx` da 4500 a 3350 righe: I/O file, salvataggio, export, Import_Contratti in `src/lib/` | `file-input.ts`, `salvataggio.ts`, `export-*.ts`, `import-contratti.ts`, `formati.ts`, `elenchi-client.ts` |
| Elenchi ricaricabili senza riavvio (`fs.watch` + `POST /api/elenchi/ricarica`), cache token/feature | `server/alyante.ts` |
| ESLint (TS + react-hooks) in CI; `npm run check` = typecheck + lint + test | `eslint.config.js`, `.github/workflows/ci-suite.yml` |
| Gate SSO anche sul backend quando esposto (produzione / bind non locale); limite body per rotta | `server.ts` |
| SSL non verificato nel worker solo al primo scaricamento dei modelli | `ocr_worker.py` (`PADDLE_INSECURE_SSL`) |
| Import morti e cicli fra `parser-contratti` ↔ `ocr` ↔ `struttura` rimossi | `server/*.ts` |

## Fatto (2026-09-18)

| Cosa | Dove |
|------|------|
| Launcher in produzione: `dist/` servita dal backend sulla 5179, niente Vite dev né `tsx watch`; ricompila solo se `dist/` è vecchia, ripiega su `npm run dev` se la build fallisce | `tools/avvio-prod.mjs`, `avvia.bat` |
| Pagine a `/api/ocr` in corpo binario (PNG grezzi + meta) invece di base64 nel JSON; `toBlob` al posto di `toDataURL` (codifica fuori dal thread UI) | `server/immagine.ts`, `src/lib/file-input.ts`, `App.tsx` `corpoOcrBinario` |
| Risultato parziale durante la scansione aggiornato al massimo ogni 400 ms (era un re-render per pagina) | `App.tsx` `mostraParziale` |
| Launcher non muore più in silenzio se PaddleOCR non parte; `avvio.log`; `/api/health.ocrErrore` + pill "PaddleOCR bloccato" | `avvia.bat`, `avvia.vbs`, `ocr_worker.py`, `server/ocr.ts` |
| `libera-porta.bat` e `stopApp` del portale vedevano solo IPv4: le istanze Vite su `[::1]` non venivano mai chiuse | `shared/avvia/libera-porta.bat`, `portale/server.js` |
| "Apri in un'altra finestra" e Claude: finestra popup vera (con dimensioni), non nuova scheda | `App.tsx` `apriPopup` |
| Pagina Claude su IMPORT P6: il prompt fa creare a Claude l'`Import_Contratti.xlsx` (30 colonne, regole, elenchi ufficiali); niente JSON da incollare, si scarica dalla sua finestra | `src/lib/claude.ts` `promptClaudeExcel`, `App.tsx` `segnaExcelDaClaude` |

## Da fare

### 🔴 OCR bloccato da Windows App Control (WDAC)
Policy aziendale in vigore dal 31/08/2026: rifiuta le DLL non firmate dei venv Paddle
(`WinError 4551`, evento Code Integrity 3077). Nessuna scansione finché l'IT non autorizza
la cartella del programma. Quando l'OCR torna: misurare `PADDLE_WORKERS` (default 3) sulla
GPU da 16 GB — probabilmente regge 4-6 worker, ma senza misura non si tocca.

### 🟡 Rendering pdf.js in un Web Worker
Oggi `page.render` dipinge sul canvas del thread principale (la codifica PNG è già
fuori, via `toBlob`). Spostare tutto in un worker con `OffscreenCanvas` toglierebbe
anche quel blocco; va verificato con `npm run verifica-ui` (che è da riallineare alla UI
attuale: i passi su formato/coda/modifica falliscono anche sul codice vecchio).


### 🔴 Documenti aziendali tracciati in git
`contratti/*.pdf` (30+ contratti firmati) e il PDF ANAS in radice sono nel repository
nonostante `.gitignore` (committati prima della regola). Decidere: `git rm --cached` +
commit (restano su disco, spariscono dai commit futuri) ed eventualmente riscrittura
della storia se il repo è condiviso.

### 🟡 `App.tsx` ancora 3350 righe
Prossimi tagli, in ordine di resa:
1. **Stato della coda** (`queue`, `activeIdx`, `selezione`, meta, lavori server) →
   `useReducer` in `src/hooks/useCoda.ts`. È dove stanno la maggior parte dei 47
   `useState`.
2. **Client API** → `src/lib/api.ts`: le 9 `fetch(` sparse (`/api/ocr`, `/api/lavori*`,
   `/api/health`, `/api/normalizza`) con tipi di richiesta/risposta condivisi col server
   (`server/lavori.ts` esporta già `Lavoro`).
3. **Componenti JSX** (dalla riga ~2000): `Coda`, `PannelloRisultato`, `TabellaModifica`,
   `BarraAzioni`. Ognuno riceve solo ciò che usa.
4. **Export docx** (`handleDownloadDocx`, `handleDirectToDocx`, `handleDownloadContractDocx`,
   ~250 righe) → `src/lib/export-docx.ts`.

### 🟡 `docs/STRUTTURA.md` e `docs/REPORT.md` stantii
Descrivono il server sulla 3001 con Ollama `minicpm-v` e `App.tsx` da 1790 righe.
O si aggiornano o si tolgono: un documento sbagliato costa più di nessun documento.

### 🟡 Validazione del JSON in uscita
`strutturaAlyante`/`strutturaContratto` restituiscono `string` e ogni consumatore fa
`JSON.parse` + cast. Un tipo `Alyante` condiviso (in `src/lib/`) e un parser che lo
garantisce eviterebbero i `Record<string, unknown>` a catena in `import-contratti.ts`.
Zod è una scelta possibile ma non necessaria: bastano i tipi + una funzione di controllo.

### 🟢 `/api/ocr` con immagini
Percorso legacy: il browser manda le pagine in base64 (200 MB di body). Il percorso
`lavori` (PDF caricato una volta, pipeline sul server, SSE) copre lo stesso caso ed è
quello che sopravvive alla chiusura della scheda. Quando il frontend non lo usa più,
togliere il ramo `images` e il limite a 200 MB.

### 🟢 Bundle
`dist/assets/index-*.js` 1,35 MB (xlsx 870 KB a parte). Candidati per `import()`
dinamico come già fatto per `docx`: `react-markdown` + `remark-gfm` (solo pannello
Documento), `xlsx-js-style` (già dinamico), pdf.js worker.

## Flow dati (invariato)

```
File (PDF/img/docx) ─┬─ layer nativo ──┐
                     └─ render → OCR ──┴→ testo a righe → estrai() → Estratto
                                                              │
                        strutturaAlyante / strutturaContratto ┘ → JSON
                                                              │
                        normalizzaRisultatoAlyante (elenchi)  ┘
                                                              │
   frontend: import-contratti.ts → righe → Import_Contratti.xlsx
```

## Come aggiungere un formato di export

1. Colonne e riga in `src/lib/export-<nome>.ts` (vedi `export-contratto.ts`).
2. Handler in `App.tsx` che chiama `salvaFile(blob, nome, outDir)` da `lib/salvataggio.ts`.
3. Test in `src/lib/__tests__/` con un JSON minimo → righe attese.
