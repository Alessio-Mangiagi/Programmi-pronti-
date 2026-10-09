<!-- "><(((º> sabusabu <º)))><" -->
# Contesto sessioni — Analista Dati (Cosedil)

> Documento di passaggio di consegne. Caricalo a inizio chat per darmi il contesto
> di cosa è stato costruito e come ragionare sul codice. Aggiornalo quando cambiano
> architettura o convenzioni. Non è la documentazione utente (per quella → `README.md`).

## Cos'è questo progetto

`analista-dati/` (ex `agente/`) = **Analista Dati**, una delle app della **suite Cosedil** (monorepo in
`prototipo suite/`, radice `..`). Stack: **Node 24 + Express + React + Vite + TypeScript
(ESM)**. LLM: **AI locale** (Ollama o endpoint OpenAI-compatibile) oppure **Claude**.
Backend `server.ts` (porta 3001), frontend Vite (5173). Il **Portale** (porta 8080) è
il server centrale SSO che avvia le app in LAN.

Funzione originale: interrogare database in linguaggio naturale (text-to-SQL) con chat,
report Excel, guard read-only, few-shot, glossario, PII. Nelle sessioni recenti sono
state aggiunte 3 grosse capacità (sotto).

## Cosa abbiamo costruito (sessioni recenti)

### 1. Analisi documenti (sorgente `docs`)
Carichi PDF/scansioni/immagini/testo/Excel → estrazione testo → classificazione + campi
→ indicizzazione → interrogabile con la **stessa pipeline NL→SQL** (un set = file SQLite).
- `server/docs.ts` — `DocStore` (SQLite per set) con tabelle `documenti`, `campi_estratti`,
  `frammenti` (per pagina, per le CITAZIONI) + FTS5 (`documenti_fts`, `frammenti_fts`).
  Pipeline `ingestDocument`: `extractText` (txt/csv/xlsx locale; **PDF/immagini via Claude
  vision** in `llm.ts:extractDocumentText`), `classifyAndExtract` (LLM JSON), `splitIntoFragments`,
  embeddings opzionali. Set condivisi con prefisso `@`. Cartella `docsets/` (mai versionata).
- `server/embeddings.ts` — embeddings via **Ollama** (`nomic-embed-text`, opt-in `DOCS_EMBED=1`),
  `semanticSearch`, `answerFromDocs` (RAG con citazioni). Degrado morbido se Ollama assente.
- `server/docsWatch.ts` — watcher cartella (`DOCS_WATCH_DIR`) → acquisisce in un set condiviso.
- `server/db.ts` — `DocsConnector` (kind `docs`, sola lettura, schema curato).
- Frontend: sorgente "Documenti" in `ConnectPanel`, toggle 🔍 ricerca semantica, fonti in `MessageView`.
- Endpoint: `/api/docs/upload|/api/docs|DELETE /api/docs/:id|/api/docs/ask|/api/docs/watch/scan`.

### 2. Agente operativo (usa le altre app della suite)
Con toggle **🛠️ Azioni suite** (o entrando "senza DB"), l'agente usa strumenti sulle app sorelle.
- `server/suiteTools.ts` — registry app + executor HTTP che **inoltra il cookie `sid` del Portale**
  (azione con l'identità dell'utente) + **cache health** (TTL 30s/3s) + **avvio on-demand** via Portale.
  `Attachment`/`resolveAttachment` per gli allegati referenziati **per numero**.
- `server/suiteToolDefs.ts` — tool concreti: **Scadenzario** (dashboard, lista, export xlsx = lettura;
  crea, rinnova, invia notifiche = **azioni**), **OCR** (estrai_testo), **Confronto Documenti**
  (confronta_documenti = multipart→poll→report Word), **DDT** (statistiche).
  ⚠️ Importato per **side-effect da `agent.ts`**, MAI da `suiteTools.ts` (romperebbe un ciclo di import).
- `server/agent.ts` — orchestrazione: `runSuiteAgent`, `runSuiteAgentStream` (SSE: passi live), `confirmAction`.
- `server/llm.ts` — `completeAgent`: loop tool-use generico (Claude nativo + Ollama function-calling).
- Frontend: allegati in chat 📎 (referenziati per numero, base64 mai nel prompt), card conferma, passi live.
- Endpoint: `/api/agent`, `/api/agent/stream`, `/api/agent/confirm`, `/api/agent/tools`.
- **Sicurezza**: i tool `read` girano da soli; i tool `action` (scrittura) si FERMANO e vengono
  proposti → l'utente conferma → `confirmAction` esegue. Scelta attuale: azioni per **ogni utente autenticato**.

### 3. Chiave API Claude dal pannello admin
Tab **Chiave AI** (`ClaudeKeyTab`): l'admin incolla `sk-ant-…` → il server la **verifica** (chiamata
reale 1 token, `llm.ts:setClaudeApiKey`), la **attiva a caldo** (client sostituibile senza riavvio),
la **salva cifrata** (`secret.enc`, AES-256-GCM, richiede `MASTER_PASSWORD`).
Requisiti: rifiutata senza MASTER_PASSWORD (mai in chiaro); **irraggiungibile** una volta inserita
(nessun endpoint la rilegge, mai nei log); si può solo sostituire. Endpoint `/api/admin/claude-key`.

### 4. Ottimizzazioni prestazioni
- Report Excel: sezioni in **parallelo** (`REPORT_CONCURRENCY`, pool bounded).
- Upload documenti: ingest in **parallelo** (`DOCS_INGEST_CONCURRENCY`).
- `ExcelConnector` + ingest documenti: **transazioni SQLite** (30k righe: ~334 ms, prima decine di s).
- Cache **health** app suite + cache **introspezione** schema per i DB di rete (TTL 10 min).
- Frontend: **code-splitting** — `xlsx` (429 KB) e `recharts` (384 KB) lazy → bundle iniziale
  **1.017 KB → 215 KB**.

### 5. Filtro di pertinenza (anti-spreco credito Claude)
`server/scope.ts` — blocca le domande **troppo generaliste/fuori ambito** PRIMA di
chiamare l'LLM a pagamento. Due livelli a costo ZERO su Claude: **euristiche**
istantanee (intento-dati/saluti/capacità → sempre ammessi; cultura generale,
scrittura creativa, codice, traduzioni, matematica, meteo, consigli → bloccati) +
per i casi ambigui un **classificatore sul modello LOCALE gratuito** (`freeProvider()`
in `llm.ts`, mai Claude). **Fail-open**: qualsiasi dubbio/errore → ammette (+ backoff
sul classificatore). Attivo in `/api/analyze` (solo chat), `/api/analyze/stream`,
`/api/docs/ask`, `/api/agent` e `/api/agent/stream` (saltato se ci sono allegati).
Bloccato → risposta con `scopeMessage()` (nessun errore). Config `SCOPE_GUARD=off|heuristic|auto`.

## Convenzioni non ovvie (leggi prima di toccare il codice)

- **ESM con estensione**: gli import interni usano `.ts` (`from './db.ts'`). Necessario con `tsx`.
- **`node:sqlite`** (builtin, niente pacchetto npm) via `createRequire` — il resolver di Vite/vitest
  non gestisce il builtin negli import statici. `app.db` = stato applicativo; i DB analizzati e i set
  documenti sono file separati.
- **Test**: `vitest`, `server/**/*.test.ts`. Pattern: **finto server LLM locale** (HTTP OpenAI-compat)
  avviato in `beforeAll`, poi `await import()` dei moduli (leggono `LOCAL_LLM_BASE`/`SUITE_*_URL` a import).
  `server/test-setup.ts` isola l'ambiente in una cartella temp (`APP_DB_PATH`, `REPORTS_DIR`, `DOCS_DIR`,
  `SECRET_FILE`) → i test non toccano MAI i file reali. **Stato attuale: 134 test, 12 file, tutti verdi.**
  Comandi: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
  Nota: `scope.test.ts` forza `SCOPE_GUARD=heuristic` prima dell'import → deterministico, niente rete.
- **LLM** (`server/llm.ts`): provider `ollama` | `local` | `claude`, con fallback automatici. Con Claude:
  **prompt caching** dello schema (retry ~0.1×) e **tool use forzato** per il JSON. Semaforo `LLM_CONCURRENCY`.
- **Guard read-only** (`sqlGuard`/`redisGuard`/`mongoGuard`) su OGNI query prima dell'esecuzione.
- **Anti-spreco credito Claude**: due difese complementari — `scope.ts` (blocca le domande
  fuori ambito PRIMA dell'LLM) e `CLAUDE_DAILY_TOKEN_BUDGET` (oltre il tetto per-utente,
  `resolveProvider` in `llm.ts` ripiega su Ollama). `freeProvider()` = provider locale gratuito
  (`local` se configurato, altrimenti `ollama`): usato dal filtro, non tocca mai Claude.
- **Segreti**: `MASTER_PASSWORD` cifra sia `secret.enc` (chiave Claude) sia le connessioni salvate.
  `secret.enc`/`.env`/`app.db`/`docsets/`/`reports/` sono in `.gitignore`.

## Config (env principali — vedi `.env.example` per l'elenco completo)

`DEFAULT_LLM`, `CLAUDE_MODEL`, `OLLAMA_MODEL`, `LOCAL_LLM_BASE`, `LLM_CONCURRENCY`, `MASTER_PASSWORD`,
`DOCS_EMBED` + `OLLAMA_EMBED_MODEL`, `DOCS_WATCH_DIR`, `SUITE_TOOLS`, `COSEDIL_PORTAL`, `SUITE_<APP>_URL`,
`AGENT_MAX_STEPS`, `AGENT_MAX_FILES`/`AGENT_MAX_FILE_MB`, `REPORT_CONCURRENCY`, `DOCS_INGEST_CONCURRENCY`,
`SCHEMA_CACHE_TTL_MS`, `SUITE_HEALTH_TTL_MS`, `SCOPE_GUARD` (+ `SCOPE_GUARD_COOLDOWN_MS`),
`CLAUDE_DAILY_TOKEN_BUDGET`.

## Sicurezza — stato

- ✅ **Corretto**: bypass credenziali nella cache schema (la chiave ora include un hash di password/uri:
  un cache-hit salta l'introspezione = l'autenticazione DB, quindi deve legarsi alle credenziali esatte).
- 🟠 **Aperto**: `xlsx` (SheetJS) ha un avviso **ReDoS high** (GHSA-5pgg-2g8v-p4x9), **nessun fix su npm**.
  Il server parsa Excel caricati da utenti (autenticati). Da decidere: migrare alla build ufficiale
  SheetJS (CDN) o aggiungere limiti difensivi.
- Note di design (non falle): azioni suite eseguibili da ogni utente autenticato (scelta); errori di
  connessione DB mostrati all'utente autenticato (debug).

## Prossimi passi / idee aperte

1. **ReDoS `xlsx`**: migrazione build ufficiale o limiti dimensione/tempo sui parse.
2. Perf zero-codice: alzare `LLM_CONCURRENCY` con Claude; modello coder piccolo per l'SQL su Ollama.
3. Streaming dei **token** della risposta finale dell'agente (ora arrivano solo i *passi*).
4. DDT: il tool `statistiche` è stateless (l'app non conserva dati) → utile solo con dati passati.
5. Eventuale gating admin-only sulle azioni di scrittura, se cambia la policy.
6. **Tuning filtro pertinenza** (`scope.ts`): oggi conservativo (parole come "lista" contano come
   intento-dati → una richiesta borderline passa). Se serve più aggressività, estendere il ramo
   `auto` (classificatore locale) o affinare le regex in `OFFTOPIC_RE`/`ALLOW_RE`.

## Mappa file (dove sta cosa)

```
server.ts                 endpoint HTTP + gate auth + cache schema + wiring
server/llm.ts             provider LLM, completeAgent (tool loop), vision, setClaudeApiKey
server/analysis.ts        pipeline NL→SQL (runAnalysis, runChat, relevantSchema)
server/db.ts              connettori DB (pg/mysql/mssql/sqlite/redis/mongo/excel/docs)
server/report.ts          report Excel multi-foglio (sezioni in parallelo)
server/docs.ts            acquisizione documenti + DocStore + FTS
server/embeddings.ts      ricerca semantica + RAG (Ollama)
server/scope.ts           filtro pertinenza (blocca domande generaliste pre-LLM)
server/docsWatch.ts       watcher cartella
server/suiteTools.ts      registry/executor app suite + allegati
server/suiteToolDefs.ts   tool concreti (import side-effect da agent.ts)
server/agent.ts           orchestrazione agente operativo
server/{auth,secrets,crypto,sessions,usage,scheduler,fewshot,glossary,privacy}.ts
src/App.tsx               UI principale (chat, toggle, allegati)
src/components/           ConnectPanel, MessageView, ResultView/ResultChart(lazy), Sidebar
src/admin/                AdminPanel + tab (Users, Usage, ClaudeKey, Logs, Connections, Jobs)
```
