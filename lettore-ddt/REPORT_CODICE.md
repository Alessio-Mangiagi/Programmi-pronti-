# Report tecnico — Funzionamento foglio di codice per foglio di codice

**Progetto:** Gestione Progetto — PDF → Excel Converter (COSEDIL)
**Stack:** Node.js + TypeScript + Express (backend) · React + Vite + Zustand (frontend)
**Data report:** 23/06/2026

---

## 1. Architettura in breve

L'applicazione è un convertitore PDF → Excel basato su un flusso manuale con Claude.ai:
l'utente carica un PDF, copia un prompt preimpostato, lo incolla in Claude.ai insieme al PDF,
riceve un JSON strutturato, lo reincolla nell'app, e l'app genera un file Excel formattato e
costruisce un modello di progetto (WBS / articoli / SAL / avanzamenti).

Due metà:

- **Backend (`src/`):** server Express in TypeScript. Autenticazione a sessione, multi-commessa,
  archiviazione cifrata degli utenti, generazione Excel, metriche Prometheus, watchdog di
  inattività.
- **Frontend (`static/`):** SPA React compilata con Vite. Gestione progetto, import/export,
  grafici di avanzamento, flusso Claude.ai.

---

## 2. Backend — `src/`

### 2.1 `server.ts` — Avvio del processo
Entry point. Cerca una porta libera nell'intervallo **5050–5059** (riprova alla successiva se
`EADDRINUSE`). All'avvio scrive `port.js` (così il frontend sa su che porta gira) e, in modalità
desktop su Windows, apre il browser automaticamente. Gestisce lo spegnimento pulito su
`SIGINT`/`SIGTERM` con timeout di sicurezza a 5 secondi.

### 2.2 `app.ts` — Composizione dell'app Express
Costruisce l'istanza `express`. Punti chiave:
- **Segreto di sessione persistente:** da `SESSION_SECRET` se presente, altrimenti generato una
  volta e salvato in `.session.key` (così i riavvii non invalidano le sessioni).
- **Store sessioni su file** (`session-file-store`): TTL 12h, pulizia oraria, cookie `httpOnly` +
  `sameSite=lax`, `secure` solo se servito via HTTPS, `rolling` (rinnova la scadenza ad ogni
  richiesta attiva).
- Limite body **50 MB** (JSON e urlencoded).
- Monta il middleware metriche e tutte le route (`./routes`), poi l'error handler finale.
- Avvisi se `serverMode` è attivo senza `SESSION_SECRET` / `DDT_USERS_KEY` (rischio dati
  illeggibili dopo redeploy con filesystem effimero).

### 2.3 `config.ts` — Configurazione unica
Legge `config.json` una sola volta all'avvio e lo fonde con i default tipizzati
(`inactivityTimeoutMinutes`, `maxJsonExports`, `maxVersionFiles`, `host`, `serverMode`,
`secureCookies`, `trustProxy`). Espone anche `VERSION` (da `package.json`) e `APP_DIR` (gestisce
sia esecuzione normale che eseguibile `pkg`). Fonte unica di verità per la config.

### 2.4 `middleware/auth.ts` — Guardie di accesso
Estende i tipi di `express-session` (`userId`, `commessaId`, `isAdmin`, …). Due middleware:
- `requireAuth` — richiede sessione con `userId` + `commessaId`; copia `commessaId` su `req`.
- `requireAdmin` — richiede `userId` + flag `isAdmin`.
Rispondono 401 se non autorizzati.

### 2.5 Modelli — `src/models/`

**`users.ts`** — Archivio utenti **cifrato** (`users.enc`).
- Decifra all'avvio; migra automaticamente un vecchio `users.json` in chiaro al formato cifrato e
  rimuove il file in chiaro.
- Password con **bcrypt** (cost 10). `verifyPassword` confronta sempre con un hash fittizio quando
  l'utente non esiste → tempo costante, anti-enumerazione via timing.
- CRUD utenti: `createUser` (min 8 caratteri, username univoco), `listUsers` (senza hash),
  `deleteUser`, `updatePassword`, `setUserDisabled` (disabilitazione soft). Scrittura su coda
  serializzata + file temporaneo + rename atomico.

**`database.ts`** — PDF in attesa (`data.json`).
- Cache in memoria + coda di scrittura asincrona serializzata (tmp + rename atomico).
- Backup giornaliero all'avvio (`data.json.bak`).
- CRUD `pending_pdfs` per commessa, con `commessaId` di fallback `default` per record legacy.
- `cleanupOldPendingPdfs` elimina i PDF più vecchi di una soglia.

**`activityLog.ts`** — Registro accessi (`activity_log.json`).
- Eventi tipizzati: `login_success`, `login_failed`, `logout`, `user_created`, `login_locked`,
  `password_changed`, ecc.
- Massimo 5000 eventi (ruota i più vecchi). `getRecentActivity(limit)` per il pannello admin;
  `getActiveAccounts(days)` aggrega l'ultimo login per utente.

### 2.6 Utility — `src/utils/`

**`secureStore.ts`** — Cifratura a riposo. **AES-256-GCM** (riservatezza + integrità). Chiave da
`DDT_USERS_KEY` (hash SHA-256) o keyfile locale `.users.key` generato una volta (permessi `600`).
Formato file: `base64(iv[12] + authTag[16] + ciphertext)`.

**`logger.ts`** — Winston. File `error.log` (solo errori) e `combined.log`, rotazione a 10 MB ×3.
Console colorata solo fuori produzione.

**`metrics.ts`** — Prometheus (`prom-client`). Istogrammi per durata richieste HTTP e durata
elaborazione PDF, gauge connessioni attive. Middleware che cronometra ogni richiesta.

**`errorHandler.ts`** — Classe `AppError` (con `statusCode`), handler globale che logga e
risponde JSON (stack solo in development), wrapper `asyncHandler` per propagare gli errori async,
e handler per `uncaughtException` / `unhandledRejection`.

<!-- "><(((º> sabusabu <º)))><" -->

### 2.7 Route — `src/routes/`

**`index.ts`** — Composizione delle route. Catena di middleware comuni:
- **Rate limit** (`express-rate-limit`): 60 req/min per IP esterno, 10000 per localhost.
- **Logging** richieste + risposte.
- **CORS** ristretto agli origin locali (porte 5050–5059).
- **Helmet** + header di sicurezza (`X-Frame-Options: DENY`, `nosniff`, HSTS, `no-store`).
- Monta i moduli per dominio; `systemRoutes` per ultimo (contiene statici e catch-all `/`).

**`helpers.ts`** — Utilità condivise:
- Regex `COMMESSA_ID_RE` / `UUID_RE`.
- **Isolamento per commessa:** `commessaDataDir` con difesa contro path traversal (valida l'id e
  verifica che il path resti dentro `data/`). Cartelle `versions/`, `json_exports/`, autosave.
- `pruneFolder` — tiene solo gli ultimi N file.
- `writeFileAtomicSerial` — scrittura **serializzata per path** (tmp + rename) per evitare race
  tra utenti della stessa commessa.
- Limiti payload (`MAX_PDF_SIZE` 50 MB, `MAX_ARRAY_ITEMS` 10000), helper CSV con escaping.

**`validation.ts`** — Validatori leggeri senza dipendenze (no zod: il build blocca il registry SSL).
`requireString`, `boundedArray`, `firstError` e middleware `validateBody` (risponde 400).

**`auth.routes.ts`** — Autenticazione:
- `POST /auth/login` — verifica credenziali, blocca account disabilitati, **protezione
  brute-force**: lockout temporaneo per username dopo 5 tentativi falliti (15 min). Logga ogni
  esito.
- `POST /auth/change-password` — cambio password self-service (verifica quella attuale).
- `POST /auth/logout` — distrugge la sessione.
- `GET /auth/me` — utente corrente.

**`admin.routes.ts`** — Gestione account (solo admin):
- Lista/crea/elimina utenti, reset password, abilita/disabilita. Protezioni: non puoi
  revocare/disabilitare te stesso né l'ultimo admin attivo.
- `GET /admin/api/users` lista account; `POST /admin/api/users` crea.
- `POST /admin/api/users/import-excel` importa batch da file Excel/CSV.
- `GET /admin/api/users/active` account con login negli ultimi 30 giorni.
- `GET /admin/api/logs` registro accessi (login, cambio password, gestione account).
- `GET /admin` serve `templates/admin.html` (HTML) + `static/admin.css` (stili).

**`data.routes.ts`** — Dati progetto:
- `POST /stats` — calcola totali (WBS, articoli, budget, avanzamento medio).
- `POST /export/csv` e `POST /export/json` — download.
- `GET/POST/DELETE /project/autosave` — autosave per commessa su file (scrittura atomica).

**`claude.routes.ts`** — Cuore del flusso Claude.ai:
- `POST /prepare-claude` — upload multiplo PDF (`multer` in memoria, max 10 file, filtro
  estensione+MIME). Valida ogni PDF, salva su disco, registra in `pending_pdfs`. Pulisce i PDF
  più vecchi di 24h.
- `POST /claude-to-excel` — riceve la risposta JSON di Claude, la pulisce (rimuove i fence
  ` ```json `), la fa il parse, **salva una copia JSON** per commessa, e genera l'Excel via
  `ExcelService`. Restituisce il file in download. Cronometra l'operazione (metrica).

**`versions.routes.ts`** — CRUD versioni progetto per commessa (snapshot di `wbsItems`/`articles`).
Salvataggio atomico + pruning; lettura/elenco/eliminazione con validazione UUID.

**`system.routes.ts`** — Endpoint di sistema:
- **Watchdog inattività:** se non arrivano ping per N minuti (config), chiude il processo (solo
  in modalità desktop). `POST /ping` resetta il timer.
- `GET /status` — health check (archivio utenti decifrabile? cartella dati scrivibile?).
- `GET /metrics` — Prometheus, solo da localhost.
- `GET /docs/readme`, `/docs/manual` — servono i markdown.
- File statici (`/assets`, `/js`, `/lib`, …) e catch-all `/` che serve la build Vite.

### 2.8 Servizi — `src/services/`

**`pdfService.ts`** — Validazione PDF: esistenza, dimensione (>0, ≤50 MB), **magic number**
`%PDF-`, presenza di `%%EOF`. Genera nomi file sicuri (UUID + estensione, sanitizzazione).

**`excelService.ts`** — Generazione Excel con **ExcelJS**. Da `{ sheets, summary }` produce un
workbook formattato: intestazioni colorate, righe alternate, bordi, larghezza colonne automatica,
riga descrizione unita, riconoscimento numeri/percentuali (`numFmt`), riga d'intestazione
congelata, e foglio "Riepilogo" finale.

---

## 3. Frontend — `static/`

### 3.1 `main.tsx` — Root React
Punto d'ingresso. Avvolge tutto in `ErrorBoundary`. Controlla la sessione (`GET /auth/me`): se non
loggato mostra `<Login>`, altrimenti `<App>`. Gestisce il logout.

### 3.2 `js/app.tsx` — Applicazione principale (~2000 righe)
Il componente centrale. Contiene:
- **Stato progetto** con autosave debounced su `localStorage` **e** server (`/project/autosave`),
  ripristino dal server se il locale è vuoto, scadenza dati a 30 giorni.
- **Flusso Claude.ai:** bottoni preset che copiano il prompt e aprono claude.ai; upload PDF
  (`/prepare-claude`); incolla risposta → anteprima (`PreviewModal`) → genera Excel
  (`/claude-to-excel`) → popola WBS.
- **Import/Export:** Excel (`Output C.D.` via `XLSX`), CSV, JSON di backup.
- **Archivio file recenti** (TTL 48h, su localStorage) con ri-download.
- **Tab WBS:** alberatura gruppi → WBS → articoli, ricerca, barre di avanzamento.
- **Tab SAL:** crea/chiudi periodi, inserisci avanzamenti per quantità o percentuale.
- **Calcoli:** `getArticleProgress`, `getWbsProgress`, `totals` (memoizzati).
- **Cambio password**, **dark mode**, **undo/redo**, **scorciatoie tastiera** (Ctrl+S/Z/Y).

### 3.3 `js/store.ts` — Stato globale (Zustand)
Definisce il tipo `Project`, `EMPTY_PROJECT`, e uno store con progetto, loading, errori e sistema
toast. (Usato in parte; gran parte dello stato vive in `app.tsx`.)

### 3.4 `js/parsers.ts` — Parsing dati
- `parseOutputCD` — legge il foglio Excel "Output C.D." riga per riga, ricostruendo
  gruppi → WBS (`NNN NNN`) → articoli con tutti i campi economici (ricavi, costi diretti, MDC1,
  manodopera, materiali, ecc.).
- `parseQuadroRiepilogo` — arricchisce le descrizioni WBS dal foglio riepilogo.
- `convertJsonToProject` — converte un JSON generico (output Claude `{sheets}`) in modello
  progetto, mappando le intestazioni ai campi tramite regex euristiche (`FIELD_MAP`).

### 3.5 `js/formatters.ts` — Formattazione
Helper `fmt` (numeri it-IT 2 decimali), `fmtPct`, `fmtInt`, palette `COLORS`, array `MONTHS`.

### 3.6 `js/prompts.ts` — Prompt preimpostati
Tre prompt per Claude.ai: **DDT calcestruzzo** (4 fogli F1–F4), **WBS/piano di progetto**,
**Fattura**. Ciascuno impone a Claude di rispondere SOLO con un JSON `{summary, sheets}` dallo
schema preciso.

### 3.7 `js/styles.ts` — Stili condivisi
Oggetto `S` con stili inline (app, header, tab, card, bottoni, tabelle, badge). Nessuna logica.

### 3.8 `js/keepalive.js` — Ping watchdog
Manda `POST /ping` ogni 10s per tenere vivo il server desktop.

### 3.9 `js/enhancements.js` — Miglioramenti UI (vanilla JS)
Moduli globali (`window.Enhancements`): **ToastSystem**, **DarkMode**, **UndoRedo**, scorciatoie,
ricerca, conferme. Richiamati da `app.tsx`.

### 3.10 Componenti — `js/components/`
- **`Login.tsx`** — form di accesso (username/password → `/auth/login`).
- **`Bar2.tsx`** — barra di avanzamento (percentuale).
- **`ErrorBoundary.tsx`** — cattura errori UI e mostra schermata di recupero.
- **`PreviewModal.tsx`** — anteprima dei fogli estratti (max 6 righe per foglio) prima del
  download Excel.

---

## 4. Flussi principali

**Login →** `Login.tsx` → `POST /auth/login` → sessione cifrata su file → `app.tsx`.

**PDF → Excel (Claude):**
1. `app.tsx`: scegli prompt → copia + apri claude.ai; upload PDF → `POST /prepare-claude`.
2. Incolla risposta JSON → anteprima `PreviewModal`.
3. Conferma → `POST /claude-to-excel` → `ExcelService` genera `.xlsx` → download; dati nel tab WBS.

**Import Excel locale →** `parseOutputCD` / `parseQuadroRiepilogo` → modello progetto.

**Autosave →** debounce 1,5s → `localStorage` + `POST /project/autosave` (file per commessa).

---

## 5. Note di sicurezza (positive)
- Utenti cifrati a riposo (AES-256-GCM), password bcrypt, anti-timing.
- Rate limiting, lockout brute-force, header di sicurezza (Helmet, HSTS, anti-clickjacking).
- Difesa path traversal sul `commessaId`, scritture atomiche serializzate.
- Validazione PDF (magic number) e limiti payload.
- Isolamento dati per commessa.
