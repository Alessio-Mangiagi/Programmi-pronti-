# Field View Starter

Backend di partenza (FastAPI + SQLite/Postgres) per il sistema di gestione
cantiere tipo Trimble Field View: planimetrie con pin, moduli dinamici,
task, sync offline-first per app native.

## Avvio

```bash
python -m venv .venv
.venv\Scripts\activate       # Windows  (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Test: `pytest -q` (SQLite in memoria, nessun setup).

Poi apri `http://localhost:8000/docs` per la documentazione interattiva
(Swagger) e provare subito gli endpoint.

## Struttura

- `app/models.py` — modello dati (Project, Plan, Pin, FormTemplate, FormSubmission, Task, Attachment)
- `app/schemas.py` — schemi Pydantic per le API, incluso il payload di sync
- `app/forms.py` — validazione schema moduli e risposte (spec in `docs/form-schema.md`)
- `app/main.py` — endpoint FastAPI: CRUD web (`/submissions`, `/tasks`, `/pins/{id}`) e `/sync/push` / `/sync/pull`
- `app/database.py` — engine/session; `DATABASE_URL` da variabile d'ambiente
- `tests/test_sync.py` — test end-to-end del protocollo di sync
- `tests/test_forms.py` — test del validatore moduli
- `tests/test_tasks_submissions.py` — test endpoint web task/submission/pin
- `ROADMAP.md` — piano giornaliero MVP
- `form_schema_example.json` — esempio di modulo dinamico (ispezione sicurezza)

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
   `inserted / updated / skipped / rejected`.

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
- Upload foto: consiglio di NON mandare le foto dentro il payload JSON di
  sync. Meglio: al push, il server crea un `Attachment` con uno
  `upload_url` presigned (es. S3), la foto viene caricata separatamente
  in background, e solo l'URL finale finisce nel sync.

## Prossimi passi consigliati

1. Passare da SQLite a Postgres (`DATABASE_URL=postgresql://...` in ambiente)
   e introdurre Alembic per le migrazioni
2. Aggiungere autenticazione (JWT) e permessi per progetto/utente
3. Aggiungere endpoint per upload allegati con presigned URL
4. Costruire la plan view web (planimetria + pin cliccabili) che consuma
   `/projects/{id}/plans` e i pin associati
5. Definire 2-3 `FormTemplate` fissi (partendo da `form_schema_example.json`)
   prima di costruire un form builder visuale
