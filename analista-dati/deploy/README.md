# Deploy — uso interno, multi-utente (≤100), autonomo

Architettura target (un solo host Windows in LAN):

```
[client LAN] → Caddy (HTTPS interno) → Node/Express (servizio nssm, 1 processo)
                                         ├─ dist/ (frontend React buildato)
                                         ├─ scheduler (report pianificati)
                                         ├─ app.db (utenti, connessioni cifrate, job, run)
                                         └─ report-service Python (grafici Excel, opzionale)
```

Niente Redis, niente cluster: con ≤100 utenti un processo basta. Le richieste LLM
sono in coda (semaforo `LLM_CONCURRENCY`); le sessioni/rate-limit stanno in RAM.

---

## 1. Configurazione (`.env`)

Copia `.env.example` in `.env` e imposta almeno:

```
BIND_HOST=127.0.0.1                 # espone Caddy, non il nodo
AUTH_ENABLED=1
ADMIN_USER=admin
ADMIN_PASSWORD=<scegli-una-password-forte>
MASTER_PASSWORD=<passphrase>        # cifra chiave Claude E connessioni salvate
LLM_CONCURRENCY=3
DEFAULT_LLM=ollama                  # o claude / local
COOKIE_SECURE=1                     # se usi Caddy in HTTPS
ALLOWED_ORIGINS=https://agente.interno.lan
```

Al **primo avvio** viene creato l'utente admin (`ADMIN_USER`/`ADMIN_PASSWORD`).
Se non imposti `ADMIN_PASSWORD`, parte con `admin/admin` e stampa un avviso: cambiala.

## 2. Build + avvio

```
npm install
npm run build            # genera dist/ (frontend)
npm start                # backend: serve dist/ + API + scheduler
```

Oppure usa `deploy\run-service.bat` (fa la build se manca e avvia).

## 3. Servizio Windows con nssm (parte al boot, riavvio automatico)

Scarica nssm (https://nssm.cc). Da un prompt come Amministratore:

```
nssm install AgenteDB "C:\Windows\System32\cmd.exe" "/c C:\...\agente\deploy\run-service.bat"
nssm set AgenteDB AppDirectory C:\...\agente
nssm set AgenteDB AppStdout C:\...\agente\service.log
nssm set AgenteDB AppStderr C:\...\agente\service.log
nssm set AgenteDB Start SERVICE_AUTO_START
nssm start AgenteDB
```

Gestione: `nssm restart AgenteDB` · `nssm stop AgenteDB` · `nssm remove AgenteDB confirm`.

## 4. HTTPS interno con Caddy

Scarica Caddy (singolo .exe). Da `deploy/`:

```
caddy run --config Caddyfile
```

Caddy usa una **CA interna**: installa una volta il suo certificato radice sui
client per togliere l'avviso del browser (vedi commenti nel `Caddyfile`).
Anche Caddy può girare come servizio nssm.

## 5. Worker Python per grafici Excel (opzionale)

Vedi `../report-service/`: avvia `avvia.bat`. Se spento, i report escono
comunque (solo tabelle, motore SheetJS).

---

## Uso multi-utente

1. **Admin** accede → **Report pianificati / Admin** → **Utenti**: crea gli account.
2. **Admin** compila una connessione DB e preme **💾 Salva** (credenziali cifrate a riposo).
3. Gli **utenti** scelgono la connessione salvata dal menu a tendina (non vedono le password).
4. **Admin** crea **Report pianificati** (cron) sulle connessioni salvate: girano da soli
   e depositano gli `.xlsx` in `reports/`, scaricabili dalla tab **Esecuzioni recenti**.

## Backup

```
npm run backup
```

Scrive in `backup/<data>_<ora>/` una copia di `app.db` (utenti, connessioni
cifrate, job, run), `secret.enc` e `.env`, tenendo le ultime `BACKUP_KEEP`
(14 di default). `app.db` viene copiato con `VACUUM INTO`, non con una copia
di file: a server acceso il DB e' in WAL e una copia grezza puo' risultare
incompleta. Si puo' lanciare a servizio attivo.

<!-- "><(((º> sabusabu <º)))><" -->

Il backup contiene `.env`, cioe' `MASTER_PASSWORD` **in chiaro** — senza quella
`app.db` e `secret.enc` restano illeggibili, quindi va salvata, ma la cartella
va protetta come i segreti stessi. `backup/` e' in .gitignore.

Pianificazione notturna (prompt come Amministratore):

```
schtasks /create /tn "Backup agente" /sc daily /st 02:00 ^
  /tr "cmd /c cd /d C:\...\agente && npm run backup"
```

A parte: la cartella `reports/` (gli .xlsx generati dallo scheduler), se ti
servono gli storici — quelli il backup non li tocca.

## Gate SSO in produzione

Il gate del Portale Suite gira in **entrambe** le modalita': in sviluppo lo
monta `vite.config.ts`, in produzione il backend stesso. Prima era solo nel dev
server di Vite, quindi `npm start` — la modalita' descritta qui sopra — girava
senza gate, con il solo login interno dell'app.

Conseguenza operativa: **il Portale deve essere raggiungibile**, altrimenti col
default `COSEDIL_SSO_FAIL=closed` l'app risponde 503 a tutti. Su un PC isolato
senza Portale metti `COSEDIL_SSO_FAIL=open` (l'app resta usabile da sola) o
`COSEDIL_SSO=off` (gate spento del tutto).
