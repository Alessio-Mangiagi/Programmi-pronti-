# Field View — guida amministratore

## Ruoli
| Ruolo | Può |
|---|---|
| `admin` | tutto; vede tutti i progetti; crea utenti |
| `manager` | crea progetti/planimetrie/template, gestisce membri e task, verifica, dashboard |
| `field` | pin, moduli, task nei progetti di cui è membro |

## Spazio admin (web, sidebar → Amministrazione)
- **Utenti** (`/admin/users`): elenco con ruolo, stato, ultimo accesso e operazioni;
  **+ Nuovo utente** (email, nome, password iniziale, ruolo), **Modifica** (nome/ruolo),
  **Password** (reset: comunicarla di persona), **Disattiva/Riattiva** (l'utente non entra
  più, i suoi dati restano). Un admin non può disattivarsi né togliersi il ruolo.
- **Registro operazioni** (`/admin/audit`): chi ha fatto cosa, quando e da quale IP —
  accessi (anche falliti), gestione utenti, progetti/planimetrie/moduli, pin, compilazioni,
  task, foto, sincronizzazioni dal device. Filtri per utente, azione, progetto, periodo,
  testo; click su una riga → dettaglio JSON e "Storia di questa entità"; **Esporta CSV**
  (prime 500 righe del filtro). Le righe sono scritte nella stessa transazione
  dell'operazione (tabella `audit_log`) e non vengono mai cancellate.
- API equivalenti: `POST/GET/PATCH /users`, `GET /users/activity`, `GET /audit`, `GET /audit/actions`.

Membri di progetto: `POST /projects/{id}/members` con `user_id`. Preferenze notifica
per utente: `PATCH /auth/me/preferences` (`notify_email`, `notify_push`).

- **Parametri commessa** (`/admin/parametri`): campi a scelta multipla (o singola) personalizzati,
  es. "Tipologia lavori: Edilizia civile / Stradale / Impianti". Ogni commessa li valorizza;
  in Progetti compaiono come etichette e come filtri. Rinominare o togliere un'opzione la
  toglie anche dalle commesse che la usavano; eliminare il parametro cancella i suoi valori.

## Commesse e cantieri
La **barra in alto** seleziona la commessa; il suo sottomenù elenca i cantieri associati
(clic → planimetrie del cantiere; la sezione aperta — task, dashboard — si conserva cambiando
cantiere). Aprendo un cantiere da un link la commessa si allinea da sola. **Progetti** mostra
i cantieri raggruppati per commessa con codice, committente e parametri; **+ Nuova commessa**
(codice univoco, oggetto, committente, parametri), **Modifica/Archivia**, **+ Cantiere**
dentro la commessa. I cantieri senza commessa stanno nel gruppo "Cantieri non associati".
Chi non è manager vede solo le commesse in cui ha almeno un cantiere.
API: `GET/POST/PATCH /commesse`, `PATCH /projects/{id}` (`commessa_id`), `GET/POST/PATCH/DELETE /commessa-params`.

## Setup di un cantiere (web, come manager)
1. **Progetti → + Nuova commessa** (se non c'è) → **+ Cantiere** nella commessa.
2. **Planimetrie → + Nuova planimetria**: PNG/JPG/PDF (la prima pagina del PDF viene
   convertita). Una planimetria senza file si carica dopo dalla sua pagina.
3. **Moduli** (sidebar): i 3 template demo (ispezione sicurezza, punch list, diario)
   si duplicano e si adattano; un template già compilato non cambia più schema
   (duplica e modifica la copia). Un'opzione con "Non conforme" in un campo a scelta
   fa scattare la proposta di task e la notifica ai manager.
4. Aggiungere i membri; gli operai fanno login dall'app e sincronizzano.

## Operatività quotidiana (ufficio)
- **Dashboard**: aperti, scaduti, chiusi negli ultimi 7 giorni, trend; click su un
  grafico → task filtrati.
- **Task**: tabella con cambio stato/assegnatario/scadenza inline; l'icona pin apre la
  planimetria sul pin. **Verificato** chiude il ciclo (solo manager/admin).
- **Notifiche**: assegnatario su assegnazione; creatore del task su risoluzione;
  manager del progetto su non conformità. Registro eventi: `GET /projects/{id}/events`.

## Installazione (staging/produzione)
```bash
cp .env.example .env     # SECRET_KEY (openssl rand -hex 32), POSTGRES_PASSWORD, WEB_URL, SMTP_*, STORAGE_S3_* opzionali
docker compose -f docker-compose.prod.yml up -d --build
```
- L'app ascolta su `127.0.0.1:8000` (API `/api`, web alla radice): metterla dietro
  un reverse proxy con TLS (Caddy/nginx) su `WEB_URL`.
- Migrazioni automatiche all'avvio (`alembic upgrade head`). `SEED_DEMO=1` solo per demo.
- Primo admin: con `SEED_DEMO=0` il DB è vuoto → creare l'admin da shell:
  `docker compose -f docker-compose.prod.yml exec app python -c "from app.database import SessionLocal; from app import models, auth; s=SessionLocal(); s.add(models.User(email='admin@tuodominio.it', name='Admin', role=models.UserRole.admin, password_hash=auth.hash_password('CAMBIAMI'))); s.commit()"`
- **Worker notifiche**: servizio `worker` (email via `SMTP_*`; senza `SMTP_HOST` finisce nel log; push Expo automatiche).
- **Storage**: volume `appdata` (`/data/storage`) oppure S3-compatible con `STORAGE_S3_BUCKET`
  (+ `STORAGE_S3_ENDPOINT` per MinIO). I file sono serviti dall'API con il token, quindi
  il bucket può restare privato.
- **Backup**: servizio `backup` — ogni notte (`BACKUP_CRON`) dump Postgres + tar dello
  storage in `./backups/`, rotazione `BACKUP_KEEP` giorni. Ripristino in `scripts/backup.sh`.
- **App mobile**: `mobile/eas.json` profilo `preview` con `EXPO_PUBLIC_API_URL` = URL pubblico;
  `eas build --profile preview --platform android|ios`.

## Aggiornamenti
```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build   # migrazioni applicate all'avvio
```
Backup prima di ogni aggiornamento con migrazioni (`docker compose ... exec backup sh /backup.sh`).

## Diagnostica
- `GET /api/docs` — Swagger. Log: `docker compose -f docker-compose.prod.yml logs -f app worker`.
- Notifiche fallite: tabella `notifications` (`status='failed'`, colonna `error`).
- Sync rifiutati dall'app: l'utente li vede in "Non sincronizzati" con il motivo
  (es. template archiviato, campo non valido).
