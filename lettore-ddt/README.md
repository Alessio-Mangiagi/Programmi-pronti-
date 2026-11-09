# Lettore DDT — da PDF a Excel, fornitori, WBS/SAL

Applicazione web per la gestione di commesse edili: importa DDT e documenti PDF tramite Claude AI, struttura la WBS, registra gli avanzamenti SAL e monitora i KPI di progetto su grafici interattivi.

<!-- "><(((º> sabusabu <º)))><" -->

Dalla versione **2.4.0** l'app è **multi-utente**: ogni utente accede con account proprio, i dati sono separati per commessa, l'archivio utenti è cifrato e c'è un pannello di amministrazione. Può girare in locale (uso single-user storico) oppure essere pubblicata online per più persone.

> **Dal 09/11/2026 è "DDT e Magazzino"**: un programma solo con il Magazzino Operativo (vedi
> [DDT e Magazzino](#ddt-e-magazzino-programma-unico) qui sotto). Commessa scelta all'ingresso, Magazzino sotto
> `/magazzino/`, PDF + Excel su SkyTower, carico immediato in magazzino.

> **Guide per l'uso quotidiano:**
> - Chi usa il programma (e amministratori) → [guida con immagini](docs/guida/README.md): è anche quella
>   che si apre con **LEGGI MANUALE** nell'app. `GUIDA_UTENTE.md` e `MANUALE.md` sono superati e rimandano lì.
> - Amministratori → [GUIDA_ADMIN.md](GUIDA_ADMIN.md)
> - Scalare oltre la singola istanza → [SCALING.md](SCALING.md)

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Backend | Node.js 20+, TypeScript, Express 5 |
| Frontend | React 19, TypeScript, Vite |
| Autenticazione | express-session + store su file (sessioni persistenti) |
| Hash password | bcryptjs (cost 10) |
| Cifratura dati | AES-256-GCM (archivio utenti `users.enc`) |
| State management | Zustand |
| Excel | ExcelJS (backend), SheetJS xlsx (frontend) |
| Logging | Winston |
| Metrics | Prometheus (prom-client) |
| AI | Claude.ai — flusso manuale, nessuna API key obbligatoria |
| Persistenza | File JSON locali (per commessa) + `users.enc` cifrato |

---

## Sicurezza (sintesi)

| Area | Misura |
|---|---|
| DDT firmati (.p7m) | Busta CAdES aperta e firma verificata (catena fino a un ente qualificato degli elenchi eIDAS, revoca, scadenza, marca temporale) dal motore comune `shared/firma` (`src/services/firmaDigitale.ts`); conversione singola e automatica, esito con bollino, nel registro attività e nell'export archiviato; a SkyTower va la busta originale (PDF estratto se la rifiuta). Firma non valida = segnalazione, non blocco |
| Account | Login con username/password, sessione con cookie `httpOnly`. Dal Portale Suite si entra senza seconda password se c'è un account DDT con lo stesso username (`ingressoDalPortale`, `src/middleware/auth.ts`); gli account non si creano da soli perché ognuno ha la sua commessa |
| Password | Hash bcrypt, mai in chiaro; lunghezza minima 8 caratteri |
| Archivio utenti | File `users.enc` cifrato AES-256-GCM (chiave da env o keyfile locale) |
| Brute-force | Lockout temporaneo dopo 5 tentativi falliti (15 min) |
| Account disabilitati | Login bloccato senza cancellare dati/storico |
| Separazione dati | Ogni commessa ha la propria cartella `data/<commessaId>/` |
| Path traversal | `commessaId` validato (whitelist) + controllo percorso |
| XSS pannello admin | Output sempre escapato |
| Audit | Log eventi accessi e gestione account (`activity_log.json`) |
| HTTPS / hosting | Cookie `secure` e `trust proxy` configurabili |

Dettagli e modello completo in [DEV_GUIDE.md](DEV_GUIDE.md) § Sicurezza.

---

## Sviluppo

### Prerequisiti
- Node.js 20+ (come `engines` in package.json)
- npm

### Installazione
```bash
npm install
```

### Comandi disponibili

| Comando | Descrizione |
|---|---|
| `npm run dev` | Avvia server in modalità sviluppo (ts-node) |
| `npm run build` | Compila TypeScript + build frontend Vite |
| `npm start` | Avvia server di produzione (`dist/`) |
| `npm test` | Esegue suite Jest. I test scrivono solo in cartelle temporanee (`src/__tests__/env.ts`: archivio utenti, sessioni, log, dati delle commesse, convalide, registro attività), mai nei file dell'installazione |
| `npm run test:watch` | Test in modalità watch |
| `npm run lint` | Controllo ESLint |
| `npm run lint:fix` | Corregge automaticamente errori ESLint |
| `npm run format` | Formatta codice con Prettier |
| `npm run type-check` | Controllo tipi TypeScript senza compilare |

### Creare il primo utente admin (CLI)
```bash
node scripts/create-user.js <username> <password> <commessaId> "<Nome>" admin
```
Richiede un build precedente (`npm run build`). La password deve avere almeno 8 caratteri.

---

## Struttura progetto

```
lettore-ddt/
├── src/
│   ├── server.ts              # Entry point — avvio Express, fallback porte 5050-5059
│   ├── app.ts                 # Setup Express, sessioni, cookie, config hosting
│   ├── config.ts              # Variabili d'ambiente
│   ├── prompts.ts             # Prompt Claude per DDT, WBS, fatture
│   ├── routes/
│   │   └── index.ts           # Tutte le route API (auth, admin, versioni, export…)
│   ├── middleware/
│   │   └── auth.ts            # requireAuth / requireAdmin
│   ├── services/
│   │   ├── pdfService.ts      # Validazione e conversione PDF
│   │   └── excelService.ts    # Generazione file XLSX
│   ├── models/
│   │   ├── users.ts          # Archivio utenti cifrato (CRUD, login, password)
│   │   ├── activityLog.ts    # Log eventi (accessi + gestione account)
│   │   └── database.ts       # PDF pending
│   └── utils/
│       ├── secureStore.ts    # Cifratura AES-256-GCM + gestione chiave
│       ├── errorHandler.ts   # Middleware errori + asyncHandler
│       ├── logger.ts         # Winston (error.log, combined.log)
│       └── metrics.ts        # Prometheus metrics
├── static/
│   ├── index.html             # Entry point HTML
│   ├── admin.css              # Stili pannello admin (separato)
│   ├── main.tsx               # React root
│   ├── js/
│   │   ├── app.tsx            # Componente principale (Import, WBS, SAL, KPI, cambio password)
│   │   ├── components/Login.tsx  # Schermata di login
│   │   ├── store.ts           # Zustand store
│   │   ├── enhancements.js    # Toast, dark mode, shortcuts, undo/redo
│   │   └── keepalive.js       # Ping watchdog
│   └── lib/                   # Librerie offline (React, xlsx, FontAwesome)
├── templates/
│   └── admin.html             # Pannello amministrazione (account + log + account attivi)
├── data/<commessaId>/         # Dati separati per commessa (versions, json_exports, autosave)
├── dist/                      # Output build (generato da npm run build)
├── users.enc                  # Archivio utenti CIFRATO (non versionare)
├── .users.key                 # Chiave di cifratura (non versionare; meglio env DDT_USERS_KEY)
├── .session.key               # Segreto sessioni (non versionare; meglio env SESSION_SECRET)
├── sessions/                  # Sessioni persistenti (non versionare)
├── activity_log.json          # Log accessi e gestione account
├── config.json                # Configurazione runtime (host, hosting, limiti)
├── avvia.vbs / avvia.bat      # Avvio app
└── package.json / tsconfig.json / vite.config.js / jest.config.js
```

---

## API Endpoints

### Autenticazione
| Metodo | Endpoint | Descrizione |
|---|---|---|
| POST | `/auth/login` | Login (username + password) |
| POST | `/auth/logout` | Logout (distrugge la sessione) |
| GET | `/auth/me` | Utente corrente |
| POST | `/auth/change-password` | Cambio password del proprio account |

### DDT e Magazzino (barra comune, commessa di sessione)
| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/guscio/stato` | Chi è entrato (portale), account DDT sì/no, commessa corrente, `scelta` |
| GET | `/guscio/commesse` | Commesse del registro della suite, cartelle precedenti (dell'account; tutte per l'admin), proposta |
| POST | `/guscio/commessa` | `{codice}` → commessa della sessione (cartella dati, SkyTower, magazzino) |
| * | `/magazzino/*` | Proxy verso il Magazzino Operativo (127.0.0.1:5200), con barra comune nella pagina principale |
| GET | `/guscio/barra.js` | La barra comune (static/guscio), caricata anche nella pagina del Magazzino |
| POST | `/batch/sorveglianza/commessa` | (admin) `{input, commessa}` → commessa di una cartella sorvegliata dal registro |

### Amministrazione (solo admin)
| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/admin` | Pannello HTML di amministrazione |
| GET | `/admin/api/logs` | Ultimi eventi del registro accessi |
| GET | `/admin/api/users` | Lista account |
| GET | `/admin/api/users/active` | Account con almeno un login negli ultimi 30 giorni |
| POST | `/admin/api/users` | Crea account |
| POST | `/admin/api/users/import-excel` | Importa batch utenti da Excel/CSV |
| DELETE | `/admin/api/users/:id` | Revoca (elimina) account |
| POST | `/admin/api/users/:id/password` | Reset password account |
| POST | `/admin/api/users/:id/disabled` | Abilita / disabilita account |
| POST | `/admin/api/users/:id/codice-commessa` | Codice commessa aziendale dell'account (`{codiceCommessa}`, vuoto = nessun invio a SkyTower) |

### App / dati (richiedono login)
| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/` | Frontend React |
| GET | `/status` | Stato server e versione |
| POST | `/ping` | Keep-alive watchdog |
| GET | `/metrics` | Metriche Prometheus (solo localhost) |
| POST | `/prepare-claude` | Upload PDF → validazione → `temp_id` |
| POST | `/claude-to-excel` | JSON Claude → XLSX + salva JSON per commessa |
| POST | `/export/csv` | Esporta CSV (UTF-8 BOM, separatore `;`) |
| POST | `/export/json` | Esporta JSON |
| GET / POST / DELETE | `/versions[/:id]` | Versioni progetto (per commessa) |
| GET / POST / DELETE | `/project/autosave` | Autosave progetto (per commessa) |
| POST | `/stats` | Statistiche budget/avanzamento |
| GET | `/docs/readme` · `/docs/manual` | Contenuto README / MANUALE |

### Fornitori (solo admin)
Consegne lette dai DDT e raggruppate per fornitore (P.IVA, altrimenti nome normalizzato), su tutte le commesse. `?commessa=<id>` restringe a una.

| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/fornitori` | Elenco: DDT, periodo, totali per u.m., commesse, anomalie |
| GET | `/fornitori/dettaglio?chiave=` | Consegne del fornitore, materiali, totali per mese |
| GET | `/fornitori/excel[?chiave=]` | Lo stesso in Excel (elenco o singolo fornitore) |

Il registro sta in `data/<commessa>/consegne.json`: si aggiorna a ogni export salvato (manuale e batch), si ricostruisce dagli export al primo accesso e **non** segue la potatura di `json_exports` (`maxJsonExports`), quindi lo storico resta intero. Ogni riga salvata porta anche `codiceCommessa` (facoltativo): il codice commessa aziendale dell'account che ha convertito o, senza, la commessa se è già un codice del registro della suite (`services/skytower.codiceCommessaPer`). Lo legge il Magazzino Operativo (`importa_ddt.py`) per mettere i carichi nel cantiere con lo stesso codice di InCampo e SkyTower.

---

## Configurazione (`config.json`)

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

| Parametro | Default | Descrizione |
|---|---|---|
| `inactivityTimeoutMinutes` | 15 | Minuti senza ping → spegnimento automatico (ignorato se `serverMode`) |
| `maxJsonExports` | 50 | Max file in `json_exports/` per commessa |
| `maxVersionFiles` | 100 | Max file in `versions/` per commessa |
| `host` | `127.0.0.1` | `0.0.0.0` per accettare connessioni di rete (hosting) |
| `serverMode` | `false` | `true` in hosting: disabilita auto-shutdown e apertura browser |
| `secureCookies` | `false` | `true` quando servito via HTTPS |
| `trustProxy` | `false` | `true` dietro reverse proxy (Nginx/Caddy) per cookie secure e IP reali |

### Variabili d'ambiente (consigliate in produzione)
| Variabile | Scopo |
|---|---|
| `DDT_USERS_KEY` | Chiave di cifratura archivio utenti. **Obbligatoria in hosting** con filesystem effimero, altrimenti gli account non sono più decifrabili dopo un redeploy. |
| `SESSION_SECRET` | Segreto di firma delle sessioni; mantiene valide le sessioni tra deploy/istanze. |
| `DDT_SKYTOWER` | `0` spegne l'invio dei DDT a SkyTower (default acceso). |
| `DDT_SKYTOWER_TIPO` | Tipo documento ISO 19650 (2 lettere) con cui SkyTower nomina i DDT, default `RP`. |
| `SUITE_TOKEN`, `SUITE_URL_SKYTOWER` | Token e indirizzo API di SkyTower (vedi `shared/suite`); senza, token dal file condiviso e `127.0.0.1:8100`. |
| `SUITE_URL_MAGAZZINO` | Indirizzo API del Magazzino (default `http://127.0.0.1:5200/api`): proxy, avvio e carico immediato. |
| `DDT_MAGAZZINO` | `0` spegne il carico immediato in magazzino (resta il giro periodico del Magazzino su `consegne.json`). |
| `DDT_MAGAZZINO_TIMEOUT_MS`, `DDT_MAGAZZINO_ATTESA_MS` | Attesa massima della risposta del Magazzino (5000) e di `/claude-to-excel` prima di far partire l'Excel (6000). |
| `DDT_MAGAZZINO_AVVIO` | `0` = il Lettore DDT non avvia mai il Magazzino (default: lo avvia se spento e lo ferma con sé). |
| `DDT_MAGAZZINO_DIR`, `DDT_MAGAZZINO_PYTHON`, `DDT_MAGAZZINO_HOST` | Cartella del Magazzino (default `../magazzino-operativo`), interprete (default il suo `.venv`), indirizzo di ascolto (default `127.0.0.1`). |

---

## Suite: i DDT finiscono in SkyTower

Ogni DDT elaborato (flusso manuale con PDF caricato da *Carica PDF* e flusso
batch) viene mandato anche a **SkyTower**, il CDE della suite, come documento WIP
della commessa (`services/skytower.ts`, `POST /suite/commesse/<codice>/documenti`
di `shared/suite`). Titolo = numeri DDT e fornitore; `attributes` =
`{origine:"ddt", ddt:[…], fornitori, data_prima, data_ultima, righe}`.

Dal 09/11/2026 la commessa si sceglie all'ingresso dal registro della suite e la
cartella dati è il codice (`data/101-003`): il codice per SkyTower è quella
cartella (`codiceCommessaPer` → `commessaSessione.codiceDaCartella`). Per le
cartelle precedenti (`demo-augusta`) resta il **codice commessa aziendale**
scritto sull'account (pannello admin, colonna *Codice aziendale*); senza, il DDT
resta solo qui (riga nel log, nessun errore per l'utente). SkyTower spenta =
riga nel log e basta. Nel flusso manuale il PDF viaggia solo se caricato con
*Carica PDF* (un file per volta: il `temp_id` accompagna l'export).

Oltre al PDF va anche l'**Excel** della conversione (`inviaExcelASkyTower`): nel
flusso manuale i byte dell'Excel appena creato, nella conversione automatica
l'Excel di ogni file o quello cumulativo della *tabella unica*. SkyTower crea un
documento nuovo a ogni invio dalla suite, quindi il Lettore DDT ricorda
l'impronta dei dati di ogni export (`data/<commessa>/skytower-inviati.json`) e
non rimanda lo stesso Excel (succedeva con *Riscarica* dalla cronologia); dati
cambiati = documento nuovo con `attributes.sostituisce` = identificativo di prima.

---

## DDT e Magazzino (programma unico)

Decisione del 09/11/2026: il Lettore DDT e il Magazzino Operativo sono **un solo
programma per chi li usa**, con dentro i due motori di sempre (questo, Node, e il
Magazzino, Flask). Contratto fra i due lati: `shared/suite/CONTRATTI.md`.

- **Una tessera nel portale** (`ddt`, "DDT e Magazzino", `comprende: ['magazzino']`):
  la vede chi è abilitato al Lettore DDT o al Magazzino. Il gate SSO accetta i due
  id (`cosedilSSO({ app: ['ddt', 'magazzino'] })`); l'admin resta quello di `ddt`.
  La sezione DDT chiede sempre l'account DDT (il DDT non crea account); chi non ce
  l'ha usa il Magazzino e il login lo dice.
- **Commessa all'ingresso** (`services/commessaSessione.ts`, rotte `/guscio/*`):
  scelta una volta dal registro della suite, in sessione (`commessaId` = cartella,
  `commessaCodice`, `commessaScelta`); proposta l'ultima scelta
  (`data/.ultime-commesse.json`). Vale per cartella dati, conversioni, SkyTower,
  carichi in magazzino e `X-Suite-Commessa` verso il Magazzino.
- **Barra comune** (`static/guscio/barra.js`, JavaScript senza build): sezioni
  *Lettore DDT* / *Magazzino*, commessa, *Cambia commessa*, finestra di scelta.
  La carica `static/index.html`; il proxy la aggiunge alla pagina principale del
  Magazzino.
- **Proxy `/magazzino/*`** (`services/proxyMagazzino.ts`, montato in `app.ts` prima
  dei parser del corpo): verso `127.0.0.1:5200` senza prefisso, con
  `X-Forwarded-Prefix: /magazzino`, `X-Forwarded-Host/-Proto/-For` e
  `X-Suite-Commessa`; le `X-Suite-*`/`X-Forwarded-*` del browser si buttano;
  redirect riscritti; ogni richiesta conta come attività (spegnimento per
  inattività). Magazzino spento → lo avvia e risponde "Sto avviando il magazzino…".
- **Avvio del Magazzino** (`services/magazzinoProcesso.ts`): all'avvio del server e
  alla prima richiesta del proxy, se `/api/health` non risponde: `database.py` poi
  `app.py` (HOST `127.0.0.1`). Si ferma con il Lettore DDT (anche per inattività
  o "Ferma" della plancia, che chiude l'albero dei processi) solo se l'ha avviato lui.
- **Carico immediato** (`services/magazzino.ts`): dopo ogni export salvato
  (`registraEsportazione`) `POST /api/suite/ddt/consegne` col token della suite e
  `{cartella, export, codiceCommessa, salvatoIl, righe}`. Esito all'utente
  nell'intestazione `X-Magazzino` di `/claude-to-excel` (il corpo è l'Excel) e nel
  diario dei lavori. Magazzino spento = "il magazzino li registrerà appena acceso":
  il suo giro periodico su `consegne.json` recupera senza doppioni.
- **Cartelle sorvegliate**: la commessa la sceglie l'admin dal registro nella card
  *Conversione automatica delle cartelle* (`POST /batch/sorveglianza/commessa`,
  scrive `batch.config.json`).

---

## Avvio

```
avvia.vbs   → avvio silenzioso in background (consigliato)
avvia.bat   → avvio con finestra terminale (utile per debug)
```

Il server tenta le porte **5050–5059** in sequenza e apre automaticamente il browser (in locale).
In `serverMode` non apre il browser e non si spegne per inattività.

**Pacchetto con `server.exe`** (`installer-pkg\build-installer-pkg.bat`, pkg + Inno Setup): Node è dentro
l'eseguibile, ma il motore della firma digitale per i DDT firmati `.p7m` no. Lo script lo copia in
`installer-pkg\build\shared\firma` (`shared\firma\copia-motore.bat`), l'installer lo mette in
`{app}\shared\firma` e lancia `installa.bat` a fine installazione; il watchdog (`_avvia_server.bat`) ci riprova a
ogni avvio e il server alla prima busta. Sul PC serve Python 3.12 solo per i `.p7m`: senza, il resto funziona e
il DDT firmato dà un messaggio con cosa fare (vedi `shared/firma/README.md`).

---

## Monitoraggio

- Health check: `GET /status` → `{ status: "ok", version: "2.4.0" }`
- Metriche Prometheus: `GET /metrics` (solo da localhost)
- Log applicativi: `error.log`, `combined.log` (max 10 MB × 3 file)
- Registro accessi/account: `activity_log.json`

---

## Requisiti

- Node.js 20+ (come `engines` in package.json)
- Browser moderno (Chrome, Edge)
- In locale: Windows 10/11, porta 5050–5059 disponibile
- In hosting: reverse proxy con HTTPS consigliato

---

*Versione 2.4.0 — Giugno 2026*
