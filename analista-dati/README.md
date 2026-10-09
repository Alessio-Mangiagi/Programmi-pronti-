<!-- "><(((º> sabusabu <º)))><" -->
# Analista Dati

Webapp locale per analizzare database con linguaggio naturale. Stesso stack della OCR webapp (React + Vite + Express + TS). **LLM: AI in locale** (Ollama o qualsiasi server OpenAI-compatibile: LM Studio, llama.cpp, vLLM…) oppure Claude.

## Cosa fa

- **Chat sui dati**: conversazione multi-turno in italiano → SQL → risultato (text-to-SQL). I follow-up ("e per il 2024?") usano il contesto della chat.
- **Report Excel automatici**: da un tema (es. "analisi vendite 2025") l'AI pianifica più analisi, le esegue e produce **un workbook multi-foglio** (un foglio per analisi + Riepilogo) — analisi su larga scala.
- **Export conversazione in Excel**: ogni risposta della chat diventa un foglio.
- **Statistiche**: aggregazioni, trend, raggruppamenti.
- **Anomalie / qualità dati**: nulli, duplicati, valori fuori range.
- **Schema explore**: tabelle, colonne, chiavi nella barra laterale.
- **Analisi documenti**: carica PDF, scansioni, immagini, testo/CSV o Excel → l'agente estrae il testo (OCR via Claude vision per PDF/immagini), classifica il tipo, estrae i campi e indicizza tutto. Poi ci chatti/interroghi con la stessa pipeline NL→SQL, **citando le fonti** (documento · pagina) e con **ricerca semantica** opzionale.

- **DB + Excel incrociati** (sorgente `DB + Excel`): un database SQL e uno o piu file Excel vengono copiati nella **stessa SQLite temporanea**, cosi una sola query puo fare **JOIN tra gestionale e fogli Excel** (ordini x listino, commesse x budget). Vedi *Sorgente multipla*.

DB supportati: **PostgreSQL, MySQL/MariaDB, SQLite, SQL Server** (SQL), **Redis** (NoSQL key-value), **MongoDB** (NoSQL documenti), **Documenti** (PDF, scansioni, immagini, testo/CSV, Excel) e **DB + Excel** (sorgente multipla).

### Funzioni avanzate
- **Sessioni per-client**: ogni PC/scheda (header `X-Session-Id`) ha la sua connessione isolata. Più utenti contemporaneamente senza calpestarsi. Connessioni inattive chiuse dopo 30 min.
- **Auto-retry**: se la query generata dà errore, l'LLM la corregge automaticamente (fino a 3 tentativi) usando il messaggio d'errore del DB. Anche su **risultato vuoto**: un retry con hint sui valori reali (spesso è un filtro con maiuscole/valore sbagliato). Il prompt di correzione elenca **tutti** i tentativi già falliti, non solo l'ultimo, così il modello non oscilla fra due query sbagliate. Tetto di tempo complessivo: `ANALYSIS_BUDGET_MS` (90s).
- **Memoria conversazione**: i follow-up ("e per il 2024?") usano le domande precedenti della sessione (troncate: `HISTORY_Q_CHARS` / `HISTORY_A_CHARS`).
- **Data di oggi nel prompt**: «questo mese», «ultimi 30 giorni» vengono risolti sulla data reale con le funzioni di data del dialetto — senza, il modello userebbe la data del proprio addestramento. Sta nel *prompt* e non nel contesto cachato, così la cache di Claude non si invalida.
- **Selezione tabelle (DB grandi)**: oltre `TABLE_SELECT_THRESHOLD` tabelle una pre-chiamata sceglie solo quelle necessarie. Gira sempre sul **modello locale gratuito** (mai Claude: partirebbe a ogni domanda), la scelta viene **chiusa di un salto sulle foreign key** — se il modello dimentica una tabella ponte il JOIN sarebbe impossibile e nemmeno il retry potrebbe salvarlo — e vengono tenute le tabelle già usate nei turni precedenti. Risultato in cache per `TABLE_SELECT_CACHE_MS`.
- **Schema ricco**: foreign key (per JOIN migliori) + righe d'esempio + **valori reali delle colonne** (distinti per colonne a bassa cardinalità, min/max per le date) nel contesto LLM → i WHERE usano i valori giusti.
- **Dry-run prima dell'esecuzione**: la query generata viene validata SENZA eseguirla (`EXPLAIN` su PostgreSQL/MySQL, `prepare` su SQLite, `sp_describe_first_result_set` su SQL Server) — errori di sintassi/nomi in millisecondi invece di consumare il timeout da 30s, auto-retry più rapido.
- **Few-shot auto-appreso**: le coppie domanda→query riuscite vengono salvate per DB e le più simili iniettate nel prompt delle domande successive — l'agente impara il lessico aziendale dal proprio storico. Il 👍 dell'utente **conferma** una coppia (pesa di più nel ranking e sopravvive alla retention), il 👎 la rimuove.
- **Glossario aziendale** (admin, in sidebar): mapping esplicito termine→colonna/formula ("SAL" → `stati_avanzamento`, "fatturato" → `SUM(ordini.importo)`), iniettato nel prompt insieme allo schema (con Claude finisce in cache).
- **Colonne sensibili / PII** (admin, lucchetto in sidebar): le colonne marcate **spariscono dallo schema mandato all'LLM** (nomi, valori profilati, righe esempio) e i valori escono **mascherati (`***`)** da ogni risultato: chat, query grezze, paginazione, report, export e job pianificati. Nota: il mascheramento aggancia il nome colonna del result set (un alias `AS x` lo aggira) — la barriera vera resta l'utente DB read-only con permessi minimi.
- **Output strutturato con Claude (tool use)**: quando serve JSON, con Claude il formato è **garantito dalla API** (tool use forzato) — niente estrazione euristica del JSON dal testo. Con Ollama/AI locale resta `format: json`.
- **Routing per compito**: modello coder veloce per generare SQL, modello grande (opzionale, `OLLAMA_MODEL_REASON`) per pianificare report e commentare risultati. Vedi [MODELLI-AI.md](MODELLI-AI.md).
- **Storico domande** riutilizzabili, **ricerca tabelle/colonne** nella sidebar.
- **Export** risultati in **CSV** ed **Excel**.
- **Grafici**: barre per categorie, linea per trend temporali (auto-detect).

## Sicurezza delle dipendenze

`xlsx` **non** arriva da npm: la 0.18.5 pubblicata li' e' l'ultima, ed e' ferma
su due advisory high (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS
GHSA-5pgg-2g8v-p4x9) senza fix. Dalla 0.19 SheetJS distribuisce solo dal
proprio CDN, quindi package.json punta al tarball ufficiale:

```
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Non e' un dettaglio estetico: il parser riceve file .xlsx **caricati dagli
utenti** (documenti, sorgente Excel, sorgente multipla). Chi aggiorna deve
prendere la versione dal CDN, non da npm. `npm audit --omit=dev` deve dare 0.

## Sorgente multipla: DB + Excel

Serve quando il dato vive in due posti: gli ordini nel gestionale, il listino o il budget di
cantiere in un `.xlsx`. Scegliendo la sorgente **DB + Excel** nella schermata di connessione,
il backend **copia** le tabelle del DB e i fogli Excel in un'unica SQLite in-memory:

- ogni tabella entra come `<sorgente>_<nome>` (`gest_ordini`, `listino_prezzi`) - niente
  collisioni fra sorgenti, e l'LLM vede da dove viene ogni dato;
- i **JOIN cross-sorgente** funzionano anche se il codice e `INTEGER` nel DB e testo in Excel
  (SQLite applica l'affinity numerica nel confronto);
- numeri e date dell'Excel restano tali (`SUM` e i confronti su data funzionano);
- da qui in poi e un normale DB SQL: chat, query, statistiche, **report Excel**, guard
  read-only, glossario, PII e paginazione funzionano senza modifiche.

**Da dove arrivano i file**: upload dalla schermata di connessione, oppure **percorso su
disco/LAN** - ma solo dentro le cartelle elencate in `XLSX_ROOTS`. Con `XLSX_ROOTS` vuota i
percorsi sono disabilitati e restano possibili i soli upload: senza allowlist un percorso
arbitrario nella richiesta farebbe leggere al server qualunque file della macchina.

**Il dato viene copiato in RAM**: da qui i tetti `MULTI_MAX_ROWS_PER_TABLE` e
`MULTI_MAX_TABLES`. Oltre il tetto la tabella e **troncata** e l'app lo dice in cima al
workspace (i totali sarebbero parziali senza avviso). Le sorgenti DB si scelgono fra le
**connessioni salvate**, cosi le credenziali restano cifrate lato server.

## Chat e report Excel

- **Chat**: scrivi la domanda in basso, la conversazione scorre nel thread. Ogni risposta mostra spiegazione, SQL/comando generato e tabella (con grafico auto per 2 colonne). I follow-up sfruttano lo storico della sessione.
- **📊 Report Excel**: scrivi un tema nella barra in alto e premi *Report Excel*. Il backend (`/api/report`) chiede all'AI un **piano di analisi** (4–8 analisi diverse: trend, top-N, aggregati, anomalie), esegue ogni query (con guard + auto-retry) e assembla un **`.xlsx` multi-foglio** (un foglio per analisi + *Riepilogo* con indice, righe e query). Download automatico.
- **⬇ Esporta chat**: `/api/export-chat` ri-esegue a piena scala le query già risposte e le impacchetta in un workbook (un foglio per domanda).
- **Larga scala**: gli export non sono tagliati a `MAX_ROWS` (anteprima) ma a `EXPORT_MAX_ROWS` (default 200.000).
- **Excel con grafici (ibrido)**: l'`.xlsx` è generato da un **worker Python** (`report-service/`, `xlsxwriter`) che aggiunge **grafici nativi, autofilter, freeze pane e formattazione** — cose che SheetJS community non fa. Se il worker è spento, il backend **ripiega automaticamente su SheetJS** (solo tabelle): l'app funziona comunque. Avvio worker: `report-service/avvia.bat` (o `uvicorn app:app --port 8000`). Badge *Grafici* in sidebar quando è attivo.

> Vedi tutto senza modello: `npm run demo` crea un DB SQLite d'esempio + una finta AI locale e genera due `.xlsx` reali (report + conversazione) in cartella temp.

## Analisi documenti

Sorgente **Documenti** nella schermata di connessione: dai un nome al set, trascina i file e premi *Analizza*.

- **Formati**: PDF, immagini (png/jpg/webp/gif), testo/CSV/markdown/JSON, Excel. **PDF e immagini scansionate richiedono Claude** (trascrizione/OCR via vision); testo/CSV/Excel funzionano anche solo in locale.
- **Cosa succede all'acquisizione** (`/api/docs/upload`): estrazione testo → **classificazione** del tipo (fattura, ddt, contratto, preventivo, ordine, rapportino, …) + **estrazione campi** (fornitore, importo, data, …) → indicizzazione **full-text (FTS5)** e divisione in **frammenti per pagina**. Idempotente per hash: lo stesso file non viene reinserito.
- **Interrogazione**: un set è un normale DB SQLite (tabelle `documenti`, `campi_estratti`, `frammenti`) → funziona con l'intera pipeline: chat, query, statistiche, report Excel, guard read-only, glossario e PII.
- **Citazioni**: le ricerche testuali restituiscono `nome` + `pagina` → l'agente cita la fonte `[documento · pag N]`.
- **Ricerca semantica** (opzionale, `DOCS_EMBED=1`): all'acquisizione calcola i vettori dei frammenti via **Ollama** (`nomic-embed-text`); l'endpoint `/api/docs/ask` risponde per **significato** (non solo parole) citando le fonti. Toggle *🔍 Ricerca semantica* in alto quando l'indice è disponibile. Se Ollama/il modello embed mancano, degrada senza errori sulla sola FTS.
- **Watcher cartella** (autonomia, `DOCS_WATCH_DIR`): la cartella indicata viene scandita a intervalli, i file nuovi acquisiti in un **set condiviso** e spostati in `_processati/`/`_errori/`. Dall'app ci si connette con set = `@sorvegliati`. Scansione manuale: `POST /api/docs/watch/scan` (admin).
- **Isolamento**: i set sono per-utente; un nome con prefisso `@` indica un set **condiviso**. I file dei set stanno in `docsets/` (mai versionati).

## Chiave API Claude dal pannello admin

Pannello admin → tab **Chiave AI**: l'admin incolla la chiave (`sk-ant-…`) e il server la **verifica** con una chiamata reale, la **attiva a caldo** (senza riavvio) e la **salva cifrata** (AES-256-GCM in `secret.enc`, stessa `MASTER_PASSWORD` delle connessioni).

Garanzie di sicurezza:
- l'inserimento è **rifiutato** se `MASTER_PASSWORD` non è impostata (la chiave non viene mai tenuta in chiaro né solo in memoria);
- una volta inserita è **irraggiungibile**: nessun endpoint la rilegge (le API espongono solo `configured: true/false`), non compare nei log, il campo della UI viene azzerato — si può solo **sostituire**;
- resta disponibile la via da terminale: `npm run set-key`.

## Agente operativo (usa le altre app della suite)

Oltre a interrogare i database, l'agente può **compiere azioni sulle app sorelle** della suite Cosedil. Attiva il toggle **🛠️ Azioni suite** in alto nella chat, **oppure** entra direttamente nella modalità agente dalla schermata di connessione con *«Usa l'agente operativo (senza connettere un database)»* — non serve un DB per usare le app della suite.

- **Come funziona**: l'agente ha degli *strumenti* (uno per capacità) e, col tool-use del modello (Claude nativo o Ollama function-calling), li usa in sequenza per rispondere. I **passi arrivano in streaming** (SSE): vedi in tempo reale «Uso scadenzario_dashboard…». Le chiamate alle app **inoltrano il cookie di sessione del Portale** (`sid`): l'azione è compiuta **con l'identità dell'utente** (audit corretto). Se un'app è spenta ed è registrata nel Portale, viene **avviata on-demand** (`POST <portale>/api/launch/<id>`).
- **Strumenti disponibili**:
  - *Scadenzario compliance*: panoramica, elenco scadenze filtrato, export Excel (lettura); creazione/rinnovo scadenza, invio notifiche (**azioni**).
  - *PaddleOCR*: estrazione testo da immagini/scansioni.
  - *Confronto Documenti*: raffronto di due documenti con report Word scaricabile (job asincrono gestito dall'agente).
  - *Lettore DDT*: metriche aggregate su dati DDT.
- **Tool locali** (girano nel backend dell'agente, senza chiamare un'app esterna):
  - **`apri_app`** — *«apri lo scadenzario»*: avvia l'app tramite il Portale (con l'identità dell'utente) e restituisce il link, mostrato in chat come **pulsante**. L'app va scelta da una **whitelist** delle app registrate: nessun percorso, comando o eseguibile arbitrario passa da qui. È un tool `read` perché non aggiunge capacità — `ensureOnline` accende già le stesse app da solo ogni volta che un tool le interroga.
  - **`crea_report_excel`** — *«fammi un report sulle vendite 2026»*: stessa pipeline di `/api/report` (l'AI pianifica 4–8 analisi, le esegue, assembla il workbook), qui raggiungibile a voce. Lavora sul DB **connesso nella sessione**; se non ce n'è uno lo dice invece di fallire. Il `.xlsx` arriva allegato alla risposta.
- **Allegati in chat**: in modalità agente la graffetta **📎** allega file al messaggio (immagini, PDF, Word — max 6 × 15 MB). L'LLM li vede come «allegato 1, 2…» e li passa agli strumenti **per numero**: il contenuto resta lato server, mai nel prompt. Es.: *«confronta i due PDF allegati»*, *«estrai il testo dalla scansione allegata»*.
- **Sicurezza — conferma delle azioni**: gli strumenti di **scrittura** (creare/rinnovare scadenze, inviare notifiche) **non vengono mai eseguiti in autonomia**. L'agente li *propone* con una card «Conferma azione»; l'esecuzione avviene solo dopo il clic dell'utente (`/api/agent/confirm`). Le letture invece girano da sole.
  L'azione proposta viene **registrata lato server** e al client va solo un `actionId` opaco: la conferma rimanda quell'id e il server esegue nome e argomenti **salvati**, mai quelli del body. L'id è **monouso**, legato all'utente che l'ha ricevuto e scade dopo `AGENT_ACTION_TTL_MS` (5 min). Senza questo vincolo un utente autenticato potrebbe chiamare `/api/agent/confirm` a mano con tool e argomenti arbitrari, scavalcando del tutto l'agente.
- **Contesto e memoria**: a ogni richiesta l'agente riceve la **data di oggi** (le scadenze relative — «il mese prossimo», «le scadute» — vanno risolte su quella, non sulla data di addestramento del modello) e gli **ultimi turni** della conversazione, così i follow-up tipo *«ok, rinnovala»* hanno un referente. Storico limitato da `AGENT_HISTORY_TURNS` / `AGENT_HISTORY_CHARS`; contiene solo testo, mai SQL, tabelle o allegati.
- **Costo del loop**: le istruzioni di sistema e gli schemi dei tool sono un **blocco in cache** (`cache_control`), quindi dai passi successivi al primo si pagano ~0.1x; i tool di lettura chiesti nello stesso passo girano in **parallelo**. Gli errori API transitori (429, 529) sono ritentati (`CLAUDE_MAX_RETRIES`) e, se persistono, l'agente risponde con un messaggio leggibile invece di fallire.
- **Config**: `SUITE_TOOLS=on|off`, `COSEDIL_PORTAL`, override `SUITE_<APP>_URL`, `AGENT_MAX_STEPS`, `AGENT_HISTORY_TURNS`, `AGENT_HISTORY_CHARS`, `AGENT_ACTION_TTL_MS`, `CLAUDE_MAX_RETRIES`, `CLAUDE_TIMEOUT_MS`. Endpoint: `POST /api/agent`, `POST /api/agent/stream` (SSE), `POST /api/agent/confirm` (`{ actionId }`), `GET /api/agent/tools`.

## Sicurezza (importante)

- **Rete chiusa di default**: il backend ascolta solo su `127.0.0.1` (`BIND_HOST`). Per usarlo in LAN imposta `BIND_HOST=0.0.0.0` (l'accesso è protetto dal login multi-utente).
- **Login multi-utente**: password scrypt, **token di sessione hashati** (sha256) nel DB — un leak di `app.db` non espone sessioni riusabili. Cookie HttpOnly.
- **Anti brute-force**: dopo `LOGIN_MAX_FAILS` tentativi errati l'utente è bloccato per `LOGIN_LOCK_MIN` minuti.
- **Cambio password forzato**: l'admin di default (`admin`/`cambiami0`) **deve** cambiare password al primo accesso prima di poter operare. Gli utenti creati da admin o importati partono anch'essi con **cambio password obbligatorio** al primo accesso. Se il server è **esposto in rete** con la password di default ancora attiva, l'avvio è **rifiutato**.
- **`trust proxy` sicuro**: di default NON si fida di `X-Forwarded-For` (spoofabile → falsifica IP di audit e bypassa il rate-limit). Attiva `TRUST_PROXY` solo dietro un reverse-proxy fidato.
- **CORS** ristretto a `ALLOWED_ORIGINS` (niente `*`).
- **Rate-limit** per IP su `/api/query` e `/api/analyze` (`RATE_MAX`/min) → protegge il credito Claude.
- **Budget token Claude per utente** (`CLAUDE_DAILY_TOKEN_BUDGET`): oltre il tetto giornaliero l'agente ripiega automaticamente sull'AI locale. Consumo tracciato per utente/giorno (tab **Consumo Claude** in Admin).
- **SOLO LETTURA**:
  - SQL → `SQL Guard` ([server/sqlGuard.ts](server/sqlGuard.ts)): blocca INSERT/UPDATE/DELETE/DROP/ALTER/SELECT INTO/multi-statement **e funzioni di lettura-file/esfiltrazione** (`pg_read_file`, `LOAD_FILE`, `OPENROWSET`, `xp_*`, `load_extension`…). Solo `SELECT`/`WITH`.
  - Redis → `Redis Guard` ([server/redisGuard.ts](server/redisGuard.ts)): whitelist di comandi di sola lettura (GET, HGETALL, LRANGE, SCAN…). Blocca SET/DEL/FLUSHALL ecc.
  - MongoDB → `Mongo Guard` ([server/mongoGuard.ts](server/mongoGuard.ts)): solo `find`/`aggregate` read-only. Blocca stage `$out`/`$merge` e operatori `$where`/`$function` (code exec).
  - Test automatici (guard, pipeline, auth/lockout/token, cron+catch-up): `npm test` (vitest, 60 casi).
- **Barriera forte**: connettiti SEMPRE con un **utente DB read-only** senza privilegi su file/sistema. Il guard applicativo è il secondo strato, non l'unico.
- **SQL Server**: cert validato di default (`MSSQL_TRUST_CERT=false`). Metti `true` solo per cert self-signed in locale.
- Timeout query: PostgreSQL/MySQL/SQL Server 30s. Limite righe `MAX_ROWS` (default 1000).

> ⚠ La cifratura della chiave (`secret.enc`) protegge da leak del repo/file, **non** da una compromissione completa dell'host: la `MASTER_PASSWORD` vive nel `.env`. Su host non fidati, valuta di passare la passphrase come variabile d'ambiente a runtime invece che nel file.

## Chiave Claude cifrata

La chiave API Claude **non va in chiaro**. È cifrata con AES-256-GCM in `secret.enc`:

```bash
npm run set-key        # chiede chiave + passphrase, scrive secret.enc
```

Poi metti in `.env` la stessa passphrase come `MASTER_PASSWORD`. All'avvio il server decifra in memoria. Se la passphrase è errata, Claude resta disattivato (fallback Ollama). `secret.enc` è in `.gitignore`.

## Log / audit (quale PC usa l'agente)

Ogni richiesta è loggata su `agente.log` (JSON, una riga per evento) e in console, con:
- `serverHost`/`serverUser` — PC e utente che ospitano l'agente
- `clientIp` — IP del PC che fa la richiesta
- `clientHost` — nome PC client (impostalo nel campo "Nome questo PC" → header `X-Client-Host`)

Eventi tracciati: `server_start`, `db_connect`, `query_run`, `analyze`, **`claude_usage`** (audit di chi consuma la chiave a pagamento).

## Setup

```bash
cd agente
npm install
cp .env.example .env   # poi modifica .env
npm run dev
```

Apri http://localhost:5173

## Configurazione `.env`

| Variabile | Default | Note |
|-----------|---------|------|
| `PORT` | 3001 | porta backend |
| `OLLAMA_BASE` | http://localhost:11434 | Ollama locale |
| `OLLAMA_MODEL` | gemma4:12b | modello per SQL (alternativa: un coder come `qwen2.5-coder:7b`) |
| `OLLAMA_MODEL_REASON` | _(vuoto)_ | modello GRANDE per pianificazione report + sintesi (vuoto = usa `OLLAMA_MODEL`). Vedi [MODELLI-AI.md](MODELLI-AI.md) |
| `LOCAL_LLM_MODEL_REASON` | _(vuoto)_ | idem per il server OpenAI-compatibile |
| `LOCAL_LLM_BASE` | _(vuoto)_ | base URL di un server **OpenAI-compatibile** locale (LM Studio, llama.cpp, vLLM, LocalAI…). Vuoto = disattivato |
| `LOCAL_LLM_MODEL` | local-model | nome modello sul server locale |
| `LOCAL_LLM_API_KEY` | _(vuoto)_ | chiave opzionale (i server locali di solito non la richiedono) |
| `LOCAL_LLM_TIMEOUT_MS` | 120000 | timeout richiesta LLM locale/Ollama (ms) |
| `ANTHROPIC_API_KEY` | _(vuoto)_ | se assente, usa solo l'AI locale |
| `CLAUDE_MODEL` | claude-sonnet-5 | modello Claude (alt.: `claude-sonnet-4-6`, `claude-opus-4-8`) |
| `CLAUDE_MAX_TOKENS` / `CLAUDE_MAX_TOKENS_REASON` | 2048 / 4096 | max_tokens Claude per generare query / per pianificare report e sintesi |
| `CLAUDE_DAILY_TOKEN_BUDGET` | 0 | tetto token/giorno per utente (0 = illimitato); oltre → fallback locale |
| `DEFAULT_LLM` | ollama | `ollama` \| `local` \| `claude` |
| `TRUST_PROXY` | _(off)_ | fidati di XFF solo dietro proxy fidato (`1`, `true`, IP/subnet) |
| `LOGIN_MAX_FAILS` / `LOGIN_LOCK_MIN` | 5 / 15 | lockout login: N errori → blocco di M minuti |
| `JOB_TIMEOUT_MS` | 600000 | timeout job pianificato (oltre → run in errore) |
| `RUNS_KEEP` | 20 | esecuzioni + file `.xlsx` conservati per job (retention) |
| `SCHEDULER_CATCHUP` | 1 | al riavvio recupera esecuzioni saltate (0 = off) |
| `MAX_ROWS` | 1000 | tetto righe per l'anteprima in chat |
| `EXPORT_MAX_ROWS` | 200000 | tetto righe per gli export Excel (report / conversazione) |
| `MULTI_MAX_ROWS_PER_TABLE` | 100000 | sorgente multipla: righe copiate per tabella/foglio (oltre = troncata + avviso) |
| `MULTI_MAX_TABLES` | 40 | sorgente multipla: tabelle/fogli materializzati in totale |
| `XLSX_ROOTS` | (vuoto) | cartelle da cui e lecito leggere .xlsx per **percorso** (`;` separa). Vuoto = solo upload |

**Modello Ollama**: default `gemma4:12b` (Q4_K_M, ~7,4 GB, richiede Ollama ≥ 0.30.5). Scarica con:
```bash
ollama pull gemma4:12b
```
In alternativa un modello "coder" (es. `qwen2.5-coder:7b`) resta valido per il solo SQL.
`llama3.2-vision` (usato dall'OCR) NON è adatto a SQL.

### AI in locale (100% offline, nessuna chiave)

L'agente funziona **interamente in locale** senza Claude. Due strade:

1. **Ollama** (default): `DEFAULT_LLM=ollama`. Zero configurazione oltre `ollama pull`.
2. **Qualsiasi server OpenAI-compatibile**: LM Studio, `llama.cpp` server, vLLM, LocalAI, Jan, text-generation-webui. Imposta:
   ```bash
   LOCAL_LLM_BASE=http://localhost:1234   # es. LM Studio (llama.cpp: :8080)
   LOCAL_LLM_MODEL=nome-del-modello-caricato
   DEFAULT_LLM=local
   ```
   Il backend chiama `POST {LOCAL_LLM_BASE}/v1/chat/completions` (`temperature=0`, `response_format: json_object` quando serve JSON). La chiave è opzionale.

Il provider si sceglie anche a runtime dal menu **LLM** in alto a destra; i badge in sidebar (Ollama / Locale / Claude) mostrano cosa è raggiungibile. Consigliato comunque un modello **coder** per generare SQL.

## Architettura

```
server.ts              entry Express + route /api/* (auth, CORS, rate-limit)
server/
  db.ts                connettori (pg, mysql2, node:sqlite, mssql, ioredis, mongodb) + introspection (FK + sample)
  sessions.ts          store sessioni per-client + sweep idle
  sqlGuard.ts          enforcement read-only SQL
  redisGuard.ts        enforcement read-only Redis (whitelist comandi)
  mongoGuard.ts        enforcement read-only MongoDB (find/aggregate)
  guards.test.ts       test vitest dei guard
  llm.ts               router Ollama / AI locale (OpenAI-compat) / Claude (+ streaming SSE) + loop tool-use
  agent.ts             agente operativo suite: orchestrazione tool, contesto (data/utente), proposta azioni
  suiteTools.ts        registry + executor HTTP dei tool (inoltra il cookie SSO, avvio app on-demand)
  suiteToolDefs.ts     definizioni dei tool concreti (scadenzario, OCR, confronta, DDT)
  pendingActions.ts    azioni di scrittura in attesa: id monouso, per utente, a scadenza
  usage.ts             consumo token Claude per utente/giorno (audit + budget)
  analysis.ts          text-to-query + dry-run + auto-retry + memoria + stats/anomalie
  fewshot.ts           few-shot bank (coppie domanda→query, conferma 👍)
  glossary.ts          glossario aziendale per DB (termine → colonna/formula)
  privacy.ts           colonne PII: strip dallo schema LLM + mascheratura risultati
  report.ts            report Excel: pianificatore analisi (LLM) + workbook (worker Python o fallback SheetJS)
report-service/        worker Python (FastAPI + xlsxwriter): Excel con grafici/formattazione
  crypto.ts            AES-256-GCM
  secrets.ts           carica/decifra chiave Claude
  logger.ts            audit log con identità PC + rotazione
  types.ts
scripts/set-key.ts     CLI cifratura chiave
src/                   frontend React (App.tsx, main.tsx, index.css)
```

## Novità (fase 3)

- ✅ **Streaming risposta LLM (SSE)** in modalità Chat: i token arrivano man mano (`/api/analyze/stream`).
- ✅ **Paginazione** risultati oltre `MAX_ROWS`: pulsante «Carica altre» (`/api/query/page`, LIMIT/OFFSET o skip Mongo).
- ✅ **Salvataggio connessioni preferite** (cifrate) + **report pianificati** con **retention**, **timeout** e **catch-up** al riavvio.
- ✅ **Chat più economica**: una sola chiamata combinata decide *e* genera la query (prima erano fino a 3 chiamate).
- ✅ **Budget token Claude** per utente + tab **Consumo Claude**.

## Novità (fase 4)

- ✅ **Dry-run** della query generata (EXPLAIN/prepare/`sp_describe_first_result_set`): errori in ms, retry più rapidi.
- ✅ **Output strutturato Claude (tool use forzato)**: JSON garantito dalla API per query, chat, selezione tabelle e piano report.
- ✅ **Glossario aziendale** per DB (sidebar, admin): termini → colonne/formule nel prompt.
- ✅ **Colonne PII** (sidebar, admin): escluse dal prompt LLM + mascherate in ogni risultato/export/report.
- ✅ **Few-shot con conferma**: 👍 = esempio confermato (boost nel ranking + retention protetta), query cambiata = conferma azzerata.
- ✅ **`max_tokens` per compito** (`CLAUDE_MAX_TOKENS_REASON`): i piani report non vengono più troncati.
- ✅ **Warning overflow contesto Ollama**: prompt > `num_ctx` non tronca più *in silenzio* (log `ollama_ctx_overflow` + warning console).
- ✅ **Trace domande** nel tab Log admin (evento `analyze_done`: domanda, tentativi, righe, esito).
- ✅ **Eval di regressione text-to-SQL** (`npm run eval`): 16 domande su DB d'esempio, confronto sui RISULTATI — punteggio ripetibile prima/dopo ogni modifica a prompt o modello (`EVAL_PROVIDER=…`, `EVAL_STRICT=1`).

Roadmap aperta:
- Grafici multi-serie e scelta tipo grafico.
- Keyset pagination + pagination per MSSQL.
