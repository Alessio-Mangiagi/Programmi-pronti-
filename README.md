# Field View

Gestione cantiere tipo Trimble Field View: planimetrie con pin, moduli dinamici,
task, notifiche, dashboard. Backend FastAPI (SQLite in dev, Postgres in prod),
web React (`web/`), app Expo offline-first (`mobile/`), logica moduli condivisa
(`packages/form-core`). Stato: MVP a 30 giorni completato lato codice — vedi
`ROADMAP.md`, `docs/retrospettiva.md` (cosa manca prima del rilascio) e le guide
`docs/guida-utente.md` / `docs/guida-admin.md`.

## Avvio

```bash
python -m venv .venv
.venv\Scripts\activate       # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env         # DATABASE_URL, STORAGE_DIR, SECRET_KEY
alembic upgrade head         # crea/aggiorna le tabelle
python -m scripts.seed       # utenti, progetto, planimetria e template demo
uvicorn app.main:app --reload
cd web && npm install && npm run dev   # frontend su http://localhost:5173
```

Login demo (`POST /auth/login`, poi "Authorize" in Swagger con il token):
`admin@fieldview.local`, `manager@fieldview.local`, `field@fieldview.local` / `demo1234`.

Database: senza `.env` si usa `sqlite:///./fieldview.db`. Per Postgres:
`docker compose up -d` (Postgres 16 su :5432) e `DATABASE_URL` come in `.env.example`.
Le tabelle si creano SOLO con Alembic (`alembic upgrade head`); dopo ogni
modifica a `app/models.py`: `alembic revision --autogenerate -m "..."` e
controllare il file generato.

Test: `pytest -q` (SQLite in memoria, nessun setup). Con `TEST_DATABASE_URL`
impostata i test girano su quel DB (la CI lo fa su Postgres).
Smoke test browser: `cd web && npm run e2e` (Playwright: build di produzione +
`scripts/e2e_server.py` su SQLite usa-e-getta con seed demo, vedi `web/README.md`).

## Deploy unico (API + web sulla stessa porta)

`uvicorn app.server:app` monta l'API sotto `/api` (Swagger su `/api/docs`) e serve
`web/dist` alla radice con fallback a `index.html` per le route React. Serve la
build (`cd web && npm run build`), altrimenti `/` spiega cosa manca.

Tutto in container: `docker compose up --build` → Postgres + app su
`http://localhost:8000`. All'avvio il container esegue `alembic upgrade head` e,
con `SEED_DEMO=1` (default nel compose), il seed demo. Variabili: `SECRET_KEY`,
`ACCESS_TOKEN_HOURS`, `SEED_DEMO` (dal `.env` o dall'ambiente); i file caricati
finiscono nel volume `appdata` (`/data/storage`).

Poi apri `http://localhost:8000/docs` per la documentazione interattiva
(Swagger) e provare subito gli endpoint.

## Struttura

- `app/models.py` — modello dati (Project, Plan, Pin, FormTemplate, FormSubmission, Task, Attachment)
- `app/schemas.py` — schemi Pydantic per le API, incluso il payload di sync
- `app/forms.py` — validazione schema moduli e risposte (spec in `docs/form-schema.md`)
- `app/auth.py` — JWT, ruoli (`admin`/`manager`/`field`), accesso per progetto
- `app/stats.py` — aggregati SQL per `GET /projects/{id}/stats` (task per stato, aperti per planimetria, moduli per template, serie giornaliera creati/risolti, scaduti) + `tasks.resolved_at`
- `app/notify.py`, `app/worker.py` — template, sender SMTP/Expo/console, `process_pending`, loop del worker
- `app/events.py` — outbox eventi (`events`) + regole di notifica (`notifications` pending), scritti nella stessa transazione da web e sync push
- `scripts/seed.py` — dati demo idempotenti
- `app/main.py` — endpoint FastAPI: CRUD web (`/submissions` + `PATCH`, `/tasks`, `/pins/{id}`, `DELETE /attachments/{id}`) e `/sync/push` / `/sync/pull`
- `app/database.py` — engine/session; `DATABASE_URL` da `.env`/ambiente
- `app/server.py` — entry point di produzione: `/api` + statici di `web/dist` (SPA fallback)
- `scripts/e2e_server.py` — server per gli smoke test Playwright (SQLite temporaneo + seed + `app.server`)
- `Dockerfile`, `scripts/entrypoint.sh` — immagine unica (build web + API), migrazioni all'avvio
- `alembic/` — migrazioni (`alembic upgrade head`)
- `tests/conftest.py` — fixture condivise (client, project, pin, push)
- `app/storage.py` — storage file (filesystem `STORAGE_DIR`, default `./storage`), PDF → PNG, sniffing MIME
- `tests/test_sync.py` — test end-to-end del protocollo di sync
- `web/src/index.css` — design system Cosedil (palette `#0c4577`/`#65bc7b`, font Ubuntu/Inter/Open Sans, ombre blu, motion sobrio); token in `:root`, icone SVG in `web/src/components/Icon.tsx` (niente emoji nella UI)
- `tests/test_forms.py` — test del validatore moduli
- `tests/test_forms_fixtures.py` — gli stessi casi di `packages/form-core/fixtures/cases.json`
- `tests/test_tasks_submissions.py` — test endpoint web task/submission/pin
- `tests/test_files.py` — test upload planimetrie/allegati
- `tests/test_auth.py` — test login, ruoli, visibilità per progetto
- `tests/test_server.py` — test del mount `/api` e del fallback SPA
- `tests/test_events.py` — eventi e notifiche da web e da sync push, preferenze
- `web/` — frontend React (vedi `web/README.md`)
- `mobile/` — app Expo offline-first (vedi `mobile/README.md`)
- `web/src/forms/` — `DynamicForm` (renderer di tutti i tipi di campo) e `SubmissionForm` (compilazione + upload foto/firma)
- `packages/form-core/` — tipi schema modulo, `validateSchema`/`validateSubmission`, `defaults`, `zodSchema` (TS, condiviso web/mobile); parità con `app/forms.py` garantita da `fixtures/cases.json`
- `scripts/gen_form_fixtures.py` — rigenera i casi condivisi dal validatore Python
- `scripts/export_openapi.py` — esporta `web/openapi.json` per i tipi TS
- `ROADMAP.md` — piano giornaliero MVP
- `form_schema_example.json` — esempio di modulo dinamico (ispezione sicurezza)

## Autenticazione e permessi

Tutti gli endpoint tranne `/auth/login` richiedono `Authorization: Bearer <JWT>`
(`SECRET_KEY` e `ACCESS_TOKEN_HOURS` in `.env`). Ruolo globale per utente:

| Azione | admin | manager | field |
|--------|:-----:|:-------:|:-----:|
| Vedere un progetto | tutti | se membro | se membro |
| Creare progetti, planimetrie, template; gestire membri | ✓ | ✓ (membro) | – |
| Modificare, duplicare, archiviare template | ✓ | ✓ | – |
| Creare utenti | ✓ | – | – |
| Pin, moduli, task, foto nei progetti di cui si è membri | ✓ | ✓ | ✓ |
| Portare un task a `verified` | ✓ | ✓ | – |
| Cancellare un task | ✓ | ✓ | solo i propri |
| Modificare una submission, cancellare un allegato | ✓ | ✓ | solo i propri |

`created_by` / `submitted_by` vengono sempre dal token (anche nel sync push,
se il device li lascia vuoti). `assigned_to` deve essere un utente esistente.

Allegati da web: `POST /attachments` accetta un `id` UUID generato dal client (409 se
esiste già), così `data_json` di una submission può referenziare foto e firma prima
che i byte siano caricati — stesso principio del sync mobile.
Nel sync push le righe di progetti a cui l'utente non appartiene sono rifiutate
singolarmente con `reason: "forbidden: ..."`. Ruoli per-progetto: backlog.

## Strategia di sync per app native (iOS/Android)

Con app native separate, la logica di persistenza locale e sync va scritta
due volte (Core Data/SQLite su iOS, Room/SQLite su Android), ma il
**protocollo di sync verso il server è identico** per entrambe:

1. **Ogni entità creata offline ha un `id` UUID v4 generato sul device.**
   Non esiste un id server separato: così una submission/task creata
   offline può referenziare un pin creato offline nello stesso batch
   (stesso `id` ovunque), e il push è idempotente (se il pacchetto arriva
   due volte per un retry di rete, non si creano duplicati).

2. **Push**: quando torna la connessione, il device manda un batch di
   tutto ciò che ha creato/modificato/cancellato offline a `POST /sync/push`
   (`pins`, `submissions`, `tasks`, `attachments`). Il server applica i
   gruppi in quest'ordine con upsert per `id`. Le righe con FK verso
   entità inesistenti, o con `data_json` non valido rispetto al template,
   vengono rifiutate singolarmente (`rejected: [{id, reason}]`),
   il resto del batch passa. La risposta riporta per gruppo
   `inserted / updated / skipped / rejected` più `skipped_ids` (le righe più
   vecchie di quanto già sul server: il device le segnala come conflitto perso).

3. **Pull**: il device chiama
   `GET /sync/pull?project_id=<id>&since=<server_time precedente>`
   per scaricare le modifiche del progetto fatte da altri utenti/device
   dall'ultima sync (plans, form_templates, pins, submissions, tasks,
   attachments). Senza `since` scarica tutto (primo avvio). Salva il
   `server_time` ricevuto come prossimo `since`.

4. **Cancellazioni**: soft-delete via `deleted_at`. Il device cancella
   impostando `deleted_at` + `updated_at` e pushando; gli altri device
   ricevono la riga nel pull e la rimuovono localmente.

5. **Timestamp**: il server lavora in UTC naive. Il client può mandare
   ISO 8601 con qualsiasi offset (`+02:00`, `Z`): viene normalizzato.
   Usare sempre l'orologio UTC del device per `updated_at`.

6. **Conflitti**: "last write wins" basato su `updated_at`. Volutamente
   semplice per l'MVP. Se in futuro serve gestire meglio i conflitti (es.
   due persone modificano lo stesso task offline), aggiungere un campo
   `version` incrementale e rifiutare push con versione vecchia, mostrando
   il conflitto all'utente invece di sovrascrivere silenziosamente.

### Cosa serve lato iOS/Android

- Uno storage locale (Core Data o SQLite su iOS, Room su Android) con le
  stesse tabelle concettuali del backend (pins, submissions, tasks) più
  un flag `synced: bool` per sapere cosa deve ancora essere inviato.
- Un job di sync in background (es. `BackgroundTasks` su iOS,
  `WorkManager` su Android) che, quando c'è connessione, chiama prima
  `/sync/push` per mandare le modifiche locali, poi `/sync/pull` per
  scaricare quelle remote.
- Upload foto: le foto NON viaggiano nel payload JSON di sync. Flusso:
  1. il device crea l'`Attachment` offline (`file_url: null`) e lo pusha;
  2. chiama `POST /attachments/presign` → `{upload_url, method}`;
  3. manda i byte (multipart `file`) a `upload_url`, con retry: è idempotente;
  4. il server imposta `file_url`, che arriva agli altri device nel pull.
  Oggi `upload_url` punta a `POST /attachments/{id}/upload`; con S3 diventerà
  un presigned URL senza cambiare il flusso lato app.
- Planimetrie: `POST /plans` crea il record, `POST /plans/{id}/file` carica
  PNG/JPG/PDF (max 20 MB, tipo riconosciuto dal contenuto). Un PDF viene
  convertito in PNG (prima pagina, lato lungo ≤ 4000 px) e `width_px/height_px`
  vengono calcolati dal server. I file sono serviti da `GET /files/{key}`.

## Filtri pin della plan view

`GET /plans/{id}/pins` accetta filtri in AND, tutti sui soli record non cancellati:
`status` (ripetibile: `open|assigned|resolved|verified`) e `assigned_to` valgono
sullo **stesso task** ("task aperti di Mario"); `template_id` richiede almeno una
submission di quel template; `date_from`/`date_to` (data o datetime ISO, estremi
inclusi, `date_to` con sola data copre tutto il giorno) guardano la creazione del
pin o di una sua submission/task. I conteggi nella risposta restano i totali del pin.

## Produzione

`docker compose -f docker-compose.prod.yml up -d --build`: Postgres (non esposto),
`app` (API + web su `127.0.0.1:8000`, da mettere dietro un reverse proxy TLS),
`worker` notifiche, `backup` (dump + tar storage notturni in `./backups/`).
Storage S3-compatible attivabile con `STORAGE_S3_BUCKET` (+ endpoint per MinIO):
i file restano privati e vengono serviti dall'API via `/files/{key}` con il JWT,
quindi gli URL nel DB non cambiano tra filesystem e S3. Dettagli in `docs/guida-admin.md`.

## Prossimi passi

1. Giornata di test sul campo con build EAS (`docs/test-sul-campo.md`)
2. Backlog in `docs/retrospettiva.md`

## Template dei moduli

`GET /form-templates` restituisce solo i template attivi (`?include_archived=true`
anche quelli archiviati, per leggere vecchie submission); ogni template porta
`submissions_count`. `PATCH /form-templates/{id}` (manager): `name`, `category`,
`archived` sempre; `schema_def` solo se `submissions_count == 0`, altrimenti 409
(duplicare e modificare la copia: le submission esistenti non vengono ri-validate).
Un template archiviato non accetta nuove submission (409). Migrazione
`a16a6f709710` aggiunge `form_templates.archived_at`.

## Eventi e notifiche

Ogni modifica rilevante scrive un evento nella tabella `events` (outbox) nella stessa
transazione, sia dagli endpoint web sia da `/sync/push` (solo righe accettate, non i
retry): `submission.created`, `task.created`, `task.status_changed`, `task.assigned`.
Le regole MVP (`app/events.py`) generano righe `notifications` (`pending`) per canale
attivo dell'utente (`notify_email`/`notify_push`, `PATCH /auth/me/preferences`):
assegnatario su `task.assigned`; creatore del task su `resolved`; manager/admin
membri del progetto su `submission.created` con una scelta tipo "Non conforme".
L'autore non viene mai notificato. `GET /auth/me/notifications`, `GET /projects/{id}/events`
(manager). Migrazione `5d220dd1f4b7`.

Invio (`app/notify.py`, `app/worker.py`): il worker prende le notifiche `pending`,
compone soggetto/testo in italiano con link diretto alla plan view
(`WEB_URL/projects/{p}/plans/{plan}?pin={pin}`) e consegna via SMTP (`SMTP_*` in
`.env`; senza `SMTP_HOST` finisce nel log) o Expo Push API (token registrati dall'app
con `POST /auth/me/push-token`; `DeviceNotRegistered` rimuove il token). Esiti in
`notifications.status/error`, `events.processed_at` a fine consegna. Avvio: in
sviluppo `NOTIFY_WORKER=thread` (thread dentro uvicorn), in produzione il servizio
`worker` del compose (`python -m app.worker`, `NOTIFY_INTERVAL` secondi).
