<!-- "><(((º> sabusabu <º)))><" -->
# Guida sviluppatore — DDTSuite

Manuale interno per manutenzione, aggiornamenti, sicurezza e versionamento.
**Non esposto dal server** — solo `README.md` e `MANUALE.md` sono raggiungibili via `/docs/`.

---

## Indice

1. [Prerequisiti di sviluppo](#1-prerequisiti-di-sviluppo)
2. [Setup ambiente locale](#2-setup-ambiente-locale)
3. [Comandi disponibili](#3-comandi-disponibili)
4. [Architettura e moduli](#4-architettura-e-moduli)
5. [Sicurezza — modello e implementazione](#5-sicurezza--modello-e-implementazione)
6. [Autenticazione e account](#6-autenticazione-e-account)
7. [Cifratura archivio utenti](#7-cifratura-archivio-utenti)
8. [Configurazione runtime e hosting](#8-configurazione-runtime-e-hosting)
9. [Aggiungere nuove route API](#9-aggiungere-nuove-route-api)
10. [Frontend: tab e componenti](#10-frontend-tab-e-componenti)
11. [Struttura dati progetto](#11-struttura-dati-progetto)
12. [Dipendenze](#12-dipendenze)
13. [Versionamento e rilascio](#13-versionamento-e-rilascio)
14. [Test](#14-test)
15. [Logging e debug](#15-logging-e-debug)
16. [Aree di attenzione](#16-aree-di-attenzione)
17. [Checklist rilascio](#17-checklist-rilascio)

---

## 1. Prerequisiti di sviluppo

| Strumento | Versione minima | Note |
|---|---|---|
| Node.js | 18 LTS | Richiesto anche in produzione |
| npm | 9+ | Incluso con Node 18 |
| TypeScript | 5.3+ | devDependency |
| Git | qualsiasi | Versionamento |
| Editor | VS Code | Plugin ESLint + Prettier |

---

## 2. Setup ambiente locale

```bash
cd "lettore-ddt"
npm install
npm run dev      # ts-node, NODE_ENV=development
```

In dev: Winston scrive su console con colori; gli errori Express includono lo stack nel JSON; nessuna build Vite necessaria per il backend.

Per testare il login serve almeno un utente: creane uno admin (vedi § 6) dopo un primo `npm run build`.

---

## 3. Comandi disponibili

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Avvia con `ts-node` |
| `npm run build` | `tsc` + build frontend Vite |
| `npm start` | Avvia `dist/server.js` |
| `npm test` | Suite Jest |
| `npm run test:watch` | Test in watch |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` | Prettier |
| `npm run type-check` | Solo verifica tipi |

---

## 4. Architettura e moduli

### Backend (`src/`)

| File | Responsabilità |
|---|---|
| `server.ts` | Avvio, selezione porta 5050–5059, apertura browser, lettura `config.json` (host/serverMode) |
| `app.ts` | Express, sessioni (store su file), cookie, `trust proxy`, segreto sessione, warning env in serverMode |
| `routes/index.ts` | Tutte le route: rate-limit, CORS, security headers, auth, admin, versioni, autosave, export, PDF/Claude |
| `middleware/auth.ts` | `requireAuth` (utente loggato) e `requireAdmin` |
| `models/users.ts` | Archivio utenti cifrato: login, CRUD, cambio/reset password, abilita/disabilita |
| `models/activityLog.ts` | Registro eventi (`activity_log.json`) accessi + gestione account |
| `models/database.ts` | PDF in pending |
| `utils/secureStore.ts` | Cifratura AES-256-GCM + gestione chiave (`DDT_USERS_KEY` / `.users.key`) |
| `services/pdfService.ts`, `excelService.ts` | PDF e XLSX |
| `utils/errorHandler.ts`, `logger.ts`, `metrics.ts` | Errori, log, metriche |

### Frontend (`static/`)

| File | Responsabilità |
|---|---|
| `main.tsx` | Root React; gestisce login/logout, passa `user` e `onLogout` ad `App` |
| `js/components/Login.tsx` | Schermata di accesso |
| `js/app.tsx` | App principale (Import, WBS, SAL, KPI) + modale cambio password |
| `js/store.ts` | Tipo `Project`, `EMPTY_PROJECT` |
| `js/enhancements.js`, `keepalive.js` | Script standalone (non passano da Vite) |

### Pannello admin
`templates/admin.html` + `static/admin.css` — pagina statica servita da `GET /admin` (solo sessione admin). Tre tab:
- **Account**: crea/revoca/reset/abilita account, importa batch da Excel/CSV.
- **Account attivi**: mostra account con almeno un login negli ultimi 30 giorni, ricerca, export CSV.
- **Log accessi**: eventi login/logout/gestione account, ricerca, export CSV.

Chiama le API `/admin/api/*`: `GET /users`, `POST /users`, `POST /users/import-excel`, `GET /users/active`, `DELETE /users/:id`, ecc.

---

## 5. Sicurezza — modello e implementazione

| Minaccia | Mitigazione | Dove |
|---|---|---|
| Furto credenziali a riposo | Password con bcrypt (cost 10); archivio utenti cifrato AES-256-GCM | `users.ts`, `secureStore.ts` |
| Lettura/modifica manuale utenti | File `users.enc` cifrato + integrità GCM | `secureStore.ts` |
| Brute-force login | Lockout 5 tentativi → 15 min per username (in-memory) | `routes/index.ts` |
| User-enumeration via timing | bcrypt fittizio quando l'utente non esiste | `users.ts` `verifyPassword` |
| Path traversal via `commessaId` | Whitelist `^[A-Za-z0-9_-]{1,64}$` + controllo percorso | `routes/index.ts` `commessaDataDir` |
| Lockout amministrativo | Non si elimina/disabilita l'ultimo admin attivo; no self-delete | route admin |
| XSS nel pannello | Escape di tutti i campi in `admin.html` | `admin.html` `esc()` |
| Sessioni perse al riavvio | Store sessioni su file (`sessions/`) + segreto persistente | `app.ts` |
| MITM su HTTPS | Cookie `httpOnly`, `sameSite=lax`, `secure` configurabile | `app.ts` |
| Race su scrittura concorrente | Scrittura autosave atomica e serializzata per path | `routes/index.ts` `writeFileAtomicSerial` |
| Esposizione di rete non voluta | Default bind `127.0.0.1`; `0.0.0.0` solo via config | `server.ts` |

> Regola: non esporre mai path di file reali nelle risposte d'errore; validare sempre input usati per costruire percorsi.

---

## 6. Autenticazione e account

### Sessione
`express-session` con store su file (`session-file-store`, cartella `sessions/`). Segreto da `SESSION_SECRET` o file `.session.key` (generato una volta). Cookie 12h, `rolling: true`.

Dati in sessione: `userId`, `username`, `commessaId`, `displayName`, `isAdmin`.

### Middleware
- `requireAuth` — richiede `userId` + `commessaId`; popola `req.commessaId`.
- `requireAdmin` — richiede `userId` + `isAdmin`.

### Endpoint
| Endpoint | Note |
|---|---|
| `POST /auth/login` | Lockout, controllo `disabled`, crea sessione |
| `POST /auth/logout` | Distrugge sessione |
| `GET /auth/me` | Utente corrente |
| `POST /auth/change-password` | Verifica password attuale, min 8 |
| `GET /admin/api/users` | Lista (senza hash) |
| `GET /admin/api/users/active` | Account con almeno un login negli ultimi 30 giorni |
| `POST /admin/api/users` | Crea (valida username/commessaId/password) |
| `POST /admin/api/users/import-excel` | Importa batch da Excel/CSV (multipart/form-data) |
| `DELETE /admin/api/users/:id` | Revoca (no self, no ultimo admin) |
| `POST /admin/api/users/:id/password` | Reset password |
| `POST /admin/api/users/:id/disabled` | Abilita/disabilita |

### Creare un utente da CLI
```bash
node scripts/create-user.js <username> <password> <commessaId> "<Nome>" [admin]
```
Riusa il modello compilato (`dist/models/users`) → stessa cifratura e chiave del server. **Richiede `npm run build`.**

> Attenzione cache: il server tiene gli utenti in memoria. Un utente creato da CLI mentre il server è in esecuzione **non** è visibile finché non si riavvia. Dal pannello admin (stesso processo) invece è immediato.

---

## 7. Cifratura archivio utenti

`secureStore.ts` cifra/decifra con **AES-256-GCM** (IV 12 byte + tag 16 byte + ciphertext, base64).

### Chiave
1. `process.env.DDT_USERS_KEY` (hash SHA-256 della stringa) — **preferito in produzione**.
2. altrimenti file `.users.key` (32 byte hex, generato una volta, `mode 0600`).

### File
- `users.enc` — archivio cifrato (sostituisce il vecchio `users.json`).
- Migrazione automatica: se esiste ancora `users.json` in chiaro, al primo accesso viene cifrato in `users.enc` e il file in chiaro **eliminato**.

### Avvertenze
- Perdere la chiave = archivio **non decifrabile** = account persi. Fare backup di `.users.key` (o conservare `DDT_USERS_KEY`).
- In hosting con filesystem effimero **usare `DDT_USERS_KEY`**, altrimenti ogni redeploy rigenera la chiave e invalida `users.enc`.
- Mai versionare `users.enc`, `.users.key`, `.session.key` (già in `.gitignore`).

---

## 8. Configurazione runtime e hosting

`config.json` (root), effetto al riavvio:

```json
{
  "inactivityTimeoutMinutes": 15,
  "maxJsonExports": 50,
  "maxVersionFiles": 100,
  "host": "127.0.0.1",
  "serverMode": false,
  "secureCookies": false,
  "trustProxy": false
}
```

| Parametro | Effetto |
|---|---|
| `inactivityTimeoutMinutes` | Auto-shutdown per inattività (disattivato se `serverMode`) |
| `maxJsonExports` / `maxVersionFiles` | Pruning file per commessa |
| `host` | `0.0.0.0` per accettare connessioni di rete |
| `serverMode` | `true` in hosting: no auto-shutdown, no apertura browser |
| `secureCookies` | `true` dietro HTTPS |
| `trustProxy` | `true` dietro reverse proxy (cookie secure + IP reali) |

### Profilo hosting tipico
```json
{ "host": "0.0.0.0", "serverMode": true, "secureCookies": true, "trustProxy": true }
```
+ env `DDT_USERS_KEY` e `SESSION_SECRET` fisse + reverse proxy HTTPS (Nginx/Caddy) davanti.

Per scalare oltre la singola istanza (Postgres/Redis) vedi [SCALING.md](SCALING.md).

---

## 9. Aggiungere nuove route API

Tutte le route sono in `src/routes/index.ts`, prima della sezione `// Serve static files`.

```typescript
router.get('/nuova-route', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: 'risultato' });
}));
```

Regole:
- Usare `asyncHandler` per route async.
- Proteggere con `requireAuth` (utente) o `requireAdmin` (admin) salvo route pubbliche.
- CORS consente `GET`, `POST`, `DELETE` — per altri metodi aggiornare il CORS (nota: le richieste same-origin non sono comunque bloccate dal CORS).
- Validare input; 400 se mancanti/non validi.
- Per percorsi su file derivati da input utente: validare con whitelist e verificare il path risolto.
- Aggiornare la tabella endpoint in `README.md` e i test.

---

## 10. Frontend: tab e componenti

`static/js/app.tsx` è un componente React monolitico.

- **Tab:** aggiungi all'array dei tab (`S.tabs` render, cerca `activeTab`) e il relativo `{activeTab === '...'}`.
- **Sezioni sidebar:** voci sotto `S.sidebarContent` con `activeSection`.
- **Modali:** rese in fondo accanto a `{notification && ...}` (vedi modale cambio password come riferimento).
- **Chiamate API:** sempre `credentials: 'include'` per inviare il cookie di sessione.
- Dopo modifiche frontend: `npm run build` (o `npx vite build`).

---

## 11. Struttura dati progetto

`Project` (in `store.ts`) è serializzato in `data/<commessaId>/versions/*.json` e nell'autosave.

- **Campo nuovo retrocompatibile:** aggiungilo con default in `EMPTY_PROJECT`.
- **Rinomina/rimozione (breaking):** bump MAJOR + funzione di migrazione al load.

Formato versione:
```json
{ "id": "uuid-v4", "name": "Nome", "timestamp": "ISO", "wbsItems": [...], "articles": [...] }
```

---

## 12. Dipendenze

### Runtime aggiunte (v2.4.0)
| Pacchetto | Uso |
|---|---|
| `express-session` | Sessioni |
| `session-file-store` | Persistenza sessioni su file |
| `bcryptjs` | Hash password |

(`crypto` è nativo Node → cifratura users.)

### Aggiornamento
```bash
npm outdated
npm update          # patch/minor
npm test && npm run type-check
```
Major con cura: `exceljs` (API), `multer` (v2 breaking filtro file), `express` (v5), `vite`. Testare sempre dopo.

---

## 13. Versionamento e rilascio

SemVer `MAJOR.MINOR.PATCH`. **Fonte unica della versione: `package.json`.**
`src/config.ts` la legge ed espone `VERSION`, usato da `GET /status` e dai test.
Aggiornare solo:

```
package.json            → "version": "x.y.z"   (unica modifica obbligatoria)
README.md (ultima riga) → Versione x.y.z — Mese Anno  (solo testo documentazione)
```

> Anche la configurazione runtime è centralizzata in `src/config.ts` (`config`, `APP_DIR`): non leggere più `config.json` a mano nei singoli file.

### File da NON consegnare / versionare
```
node_modules/  dist/(rigenerabile)  users.enc  .users.key  .session.key
sessions/  data/  activity_log.json  *.log  DEV_GUIDE.md
```
> `users.enc`, `.users.key`, `.session.key`, `sessions/`, `data/` contengono dati e segreti utente: mai sovrascrivere in aggiornamento, mai committare.

---

## 14. Test

Jest + Supertest in `src/__tests__/app.test.ts`.

```bash
npm test
npm run test:watch
npx jest -t "nome test"
```

Per route protette, nei test va simulata la sessione (agent supertest con login) oppure si testano i 401 senza sessione. Ogni nuova route: caso OK, parametri mancanti (400), non autorizzato (401) se protetta.

---

## 15. Logging e debug

| File | Contenuto |
|---|---|
| `error.log` | Errori (3×10 MB) |
| `combined.log` | Tutto (3×10 MB) |
| `activity_log.json` | Eventi accessi/account (login, logout, lockout, create/delete/disable/reset) |

```powershell
Get-Content combined.log -Tail 50 | ConvertFrom-Json | Format-List
```

Eventi `activity_log.json`: `login_success`, `login_failed`, `login_locked`, `logout`, `user_created`, `user_deleted`, `password_changed`, `password_reset`, `account_disabled`, `account_enabled`.

---

## 16. Aree di attenzione

### Percorsi (`__dirname`)
`app.ts`/`server.ts` stanno alla radice di `dist/` (e `src/`) → root = `path.join(__dirname, '..')`. I file annidati (`routes/`, `models/`, `utils/`) usano `'..','..'`. Non confondere i livelli: un errore manda i dati in cartelle sbagliate.

### `static/lib/`
Librerie offline (React 19, SheetJS, FontAwesome). Non aggiornare senza testare l'intera UI.

### Header `Content-Disposition`
Solo ASCII; usare `\x22` per le virgolette.

### MulterError
Il middateware globale risponde sempre 400 su `multer.MulterError`.

### Chiavi e sessioni
Non rigenerare `.users.key`/`.session.key` per errore: invaliderebbe account e sessioni. In produzione preferire env.

---

## 17. Checklist rilascio

```
PREPARAZIONE
[ ] npm test                         → OK
[ ] npm run type-check               → 0 errori
[ ] npm run lint                     → 0 warning
[ ] Versione aggiornata in package.json, /status, README.md
[ ] README.md / MANUALE.md aggiornati se ci sono cambi utente
[ ] GUIDA_UTENTE.md / GUIDA_ADMIN.md aggiornate se cambia il flusso account

BUILD
[ ] npm run build                    → tsc + vite senza errori

TEST
[ ] npm start → GET /status → versione corretta
[ ] Login con utente admin → /admin raggiungibile
[ ] Crea/disabilita/reset account dal pannello
[ ] Cambio password self-service dall'app
[ ] Import PDF/Claude → download XLSX

HOSTING (se applicabile)
[ ] config.json: host 0.0.0.0, serverMode/secureCookies/trustProxy true
[ ] env DDT_USERS_KEY e SESSION_SECRET impostate
[ ] reverse proxy HTTPS davanti
[ ] backup di users.enc + chiavi

CONSEGNA
[ ] Copia SENZA: node_modules/, users.enc, .users.key, .session.key,
    sessions/, data/, *.log, DEV_GUIDE.md
[ ] Il destinatario esegue npm install + npm run build + avvio
```

---

*DDTSuite — DEV_GUIDE.md — uso interno — Versione 2.4.0 · Giugno 2026*
