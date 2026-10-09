<!-- "><(((º> sabusabu <º)))><" -->
# DDTSuite — PDF to Excel + WBS/SAL

Applicazione web per la gestione di commesse edili: importa DDT e documenti PDF tramite Claude AI, struttura la WBS, registra gli avanzamenti SAL e monitora i KPI di progetto su grafici interattivi.

Dalla versione **2.4.0** l'app è **multi-utente**: ogni utente accede con account proprio, i dati sono separati per commessa, l'archivio utenti è cifrato e c'è un pannello di amministrazione. Può girare in locale (uso single-user storico) oppure essere pubblicata online per più persone.

> **Guide per l'uso quotidiano:**
> - Utenti finali → [GUIDA_UTENTE.md](GUIDA_UTENTE.md)
> - Amministratori → [GUIDA_ADMIN.md](GUIDA_ADMIN.md)
> - Manuale completo funzionalità → [MANUALE.md](MANUALE.md)
> - Scalare oltre la singola istanza → [SCALING.md](SCALING.md)

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Backend | Node.js 18+, TypeScript, Express 4 |
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
| Account | Login con username/password, sessione con cookie `httpOnly` |
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
- Node.js 18+
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
| `npm test` | Esegue suite Jest |
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

---

## Avvio

```
avvia.vbs   → avvio silenzioso in background (consigliato)
avvia.bat   → avvio con finestra terminale (utile per debug)
```

Il server tenta le porte **5050–5059** in sequenza e apre automaticamente il browser (in locale).
In `serverMode` non apre il browser e non si spegne per inattività.

---

## Monitoraggio

- Health check: `GET /status` → `{ status: "ok", version: "2.4.0" }`
- Metriche Prometheus: `GET /metrics` (solo da localhost)
- Log applicativi: `error.log`, `combined.log` (max 10 MB × 3 file)
- Registro accessi/account: `activity_log.json`

---

## Requisiti

- Node.js 18+
- Browser moderno (Chrome, Edge)
- In locale: Windows 10/11, porta 5050–5059 disponibile
- In hosting: reverse proxy con HTTPS consigliato

---

*Versione 2.4.0 — Giugno 2026*
