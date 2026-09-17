# Roadmap MVP Field View — piano giornaliero

Piano operativo in 30 giorni lavorativi (6 settimane) + settimana 0 di discovery.
Ogni giorno ha un obiettivo, i task concreti e una "definizione di fatto" (DoD)
verificabile. Si esegue in ordine: ogni giorno parte dallo stato lasciato dal precedente.

## Assunzioni (correggere prima di partire se sbagliate)

| Area | Scelta | Motivo |
|------|--------|--------|
| Backend | FastAPI + SQLAlchemy (esistente), Postgres in prod, SQLite nei test | Già presente in `app/` |
| Web | `web/` — Vite + React + TypeScript | Serve per form dinamici, drag&drop e dashboard |
| Mobile | `mobile/` — Expo (React Native) + expo-sqlite | Un solo codebase iOS/Android; condivide il renderer dei moduli con il web |
| Codice condiviso | `packages/form-core` — tipi schema modulo + validazione + default | Evita di scrivere 3 volte la logica dei form |
| File/foto | Filesystem locale in dev (`storage/`), S3-compatible in prod | Rimandare S3 non blocca nulla |
| Conflitti sync | Last-write-wins su `updated_at` (già implementato) | Sufficiente per MVP; `version` in backlog |
| Team | 1 sviluppatore + Claude | Le stime sono per questo setup |

Stato di partenza (già fatto): modello dati completo, endpoint progetti/planimetrie/template,
protocollo `/sync/push` + `/sync/pull` con test, esempio schema modulo.

---

## Settimana 0 — Discovery (in parallelo, lavoro umano)

Non blocca la settimana 1 (il backend si consolida comunque). Blocca il giorno 5 (seed dei template).

- [ ] Intervistare 2-3 utenti di cantiere (capocantiere, safety officer, assistente).
      Domande: quali fogli compilate ogni giorno? quali foto scattate e dove finiscono?
      chi deve sapere quando trovate un problema? quanto spesso siete senza rete?
- [ ] Scegliere i 3 moduli dell'MVP. Ipotesi: **ispezione sicurezza**, **punch list (difetto)**, **diario giornaliero**.
- [ ] Per ogni modulo: lista campi, obbligatorietà, chi lo compila, chi lo riceve.
- [ ] Definire ruoli minimi: `admin`, `manager` (ufficio), `field` (cantiere).
- [ ] Output: `docs/discovery.md` con moduli, campi, ruoli, flussi di notifica.

---

## Settimana 1 — Backend consolidato

### Giorno 1 — Specifica schema modulo + validatore ✅ (2026-09-14)
- Rinominare `schema_json` → `schema_def` in `models.py`/`schemas.py`/`main.py`/test (rimuove il warning Pydantic).
- Scrivere `docs/form-schema.md`: tipi supportati `text, textarea, number, checkbox, select, multiselect, date, photo, signature, geolocation`; proprietà comuni (`id, type, label, required, help`); proprietà specifiche (`options`, `min/max`, `multiple`, `default: "today"`); regole `id` univoco, snake_case.
- Creare `app/forms.py`: `validate_schema(schema)` e `validate_submission(schema, data)` → lista errori `[{field, message}]`.
- Aggiornare `form_schema_example.json` con tutti i tipi.
- Test `tests/test_forms.py`: schema valido/invalido, submission mancante required, tipo sbagliato, opzione fuori lista.
- **DoD**: `pytest` verde, `POST /form-templates` rifiuta schemi malformati con 422.

### Giorno 2 — Validazione submission + CRUD task ✅ (2026-09-14)
- Hook di `validate_submission` in `/sync/push` (submission invalide → `rejected` con motivo) e in nuovo `POST /submissions` (web).
- Endpoint REST task: `POST /tasks`, `GET /projects/{id}/tasks` (filtri `status, plan_id, assigned_to`), `PATCH /tasks/{id}` (transizioni consentite: `open→assigned→resolved→verified`, `resolved→open` per riapertura).
- `GET /pins/{id}` con submissions + tasks + attachments annidati (serve alla plan view).
- Test per transizioni illegali (409) e filtri.
- **DoD**: da Swagger si crea pin → submission → task e si porta il task a `verified`.

### Giorno 3 — Upload file (planimetrie e foto) ✅ (2026-09-14)
- `app/storage.py`: interfaccia `save(file) → url`, `open(url)`; implementazione filesystem `storage/`; route `GET /files/{path}`.
- `POST /plans/{id}/file`: accetta PNG/JPG/PDF; PDF → PNG prima pagina con `pypdfium2`; calcola `width_px/height_px` con Pillow.
- `POST /attachments/{id}/upload`: multipart, aggiorna `file_url`; `POST /attachments/presign` stub che oggi restituisce l'URL di upload diretto (in prod diventa presigned S3).
- Limiti: 20 MB, whitelist MIME.
- **DoD**: carico un PDF via Swagger, ottengo un PNG servito da `/files/...` con dimensioni corrette.

### Giorno 4 — Postgres, migrazioni, CI ✅ (2026-09-14, Postgres verificato solo in CI: niente Docker in locale)
- `docker-compose.yml` con Postgres 16; `DATABASE_URL` da `.env`.
- Alembic: init, migrazione iniziale generata dai modelli, `alembic upgrade head` nel README.
- `JSON` → `JSONB` su Postgres (tipo condizionale), indici su `updated_at` verificati.
- GitHub Actions: `pytest` su SQLite + job Postgres con service container.
- **DoD**: app parte su Postgres, test verdi in CI.

### Giorno 5 — Auth, membership, seed ✅ (2026-09-14, ruolo globale invece che per-progetto: per-progetto in backlog)
- Tabelle `users` (email, password hash, nome, ruolo) e `project_members` (user, project, ruolo).
- `POST /auth/login` → JWT; dipendenza `current_user`; tutti gli endpoint filtrano per progetti di cui l'utente è membro.
- `created_by / submitted_by / assigned_to` valorizzati dal token o validati come utenti esistenti.
- `scripts/seed.py`: 1 progetto demo, 1 planimetria, 3 utenti (admin/manager/field), i 3 template scelti nella discovery.
- **DoD**: senza token → 401; utente `field` non vede progetti altrui; seed ripetibile.

---

## Settimana 2 — Plan view web

### Giorno 6 — Scaffold web + login ✅ (2026-09-14, token in localStorage; nessun refresh token: al 401 si rifà login)
- `web/` con Vite + React + TS, router, client API tipizzato (generato da OpenAPI con `openapi-typescript`).
- Pagine: login, lista progetti, lista planimetrie del progetto.
- Layout base (sidebar progetto, header), gestione token in memoria + refresh.
- **DoD**: login con utente seed, navigo fino alla lista planimetrie.

### Giorno 7 — Viewer planimetria con pin ✅ (2026-09-14)
- Componente `PlanViewer`: immagine con pan/zoom (`react-zoom-pan-pinch`), overlay pin posizionati in coordinate relative 0-1.
- Pin colorati per stato del task più critico (aperto=rosso, assegnato=giallo, risolto=verde, verificato=grigio, solo submission=blu).
- Cluster non necessario: se >300 pin, mostrare solo pin filtrati (giorno 9).
- **DoD**: la planimetria demo si vede, zoom fluido, pin nella posizione corretta a ogni zoom.

### Giorno 8 — Interazione pin ✅ (2026-09-14)
- Click pin → pannello laterale con submissions, task, foto (da `GET /pins/{id}`).
- Aggiunta pin: modalità "aggiungi", click sulla planimetria, label, salvataggio.
- Spostamento pin con drag; cancellazione (soft-delete).
- **DoD**: creo/sposto/cancello un pin dal browser e lo ritrovo via API.

### Giorno 9 — Upload planimetrie e filtri ✅ (2026-09-17, filtri lato server su `GET /plans/{id}/pins`)
- Form upload planimetria (immagine/PDF), progress, anteprima.
- Filtri pin: stato task, template modulo, assegnatario, intervallo date.
- Cambio planimetria senza ricaricare la pagina.
- **DoD**: carico un PDF dal web e in 10 secondi ci metto un pin sopra.

### Giorno 10 — Rifinitura + smoke test + build ✅ (2026-09-17, Docker non verificato in locale: Dockerfile/compose scritti, da provare al primo `docker compose up`)
- Playwright: login → apri planimetria → crea pin → verifica in pannello.
- FastAPI serve `web/dist` come static (single deploy); CORS in dev.
- Gestione errori (toast), stati di caricamento, responsive tablet.
- **DoD**: `docker compose up` espone backend + web sulla stessa porta; smoke test verde.

---

## Settimana 3 — Moduli web

### Giorno 11 — `packages/form-core` ✅ (2026-09-17, mobile lo importerà al giorno 16; web lo usa dal giorno 12)
- Tipi TS dello schema modulo (specchio di `docs/form-schema.md`), `validate(schema, data)`, `defaults(schema)`, `zod` schema generato a runtime.
- Test unitari con gli stessi casi del giorno 1 (schemi condivisi in `packages/form-core/fixtures`).
- **DoD**: web e mobile importano `@fieldview/form-core`; validazione identica a quella server.

### Giorno 12 — Renderer modulo web ✅ (2026-09-17, include già "Compila modulo" dal pannello pin + salvataggio con allegati, previsto al giorno 13)
- `DynamicForm` che renderizza tutti i tipi: text/textarea/number/checkbox/select/multiselect/date, photo (upload multiplo con anteprima), signature (canvas → PNG), geolocation (Geolocation API + fallback manuale).
- Errori inline dal validatore, campi required evidenziati.
- **DoD**: il template "ispezione sicurezza" si compila e salva con foto e firma.

### Giorno 13 — Flusso submission e task ✅ (2026-09-17)
- Dal pannello pin: "Compila modulo" → scegli template → `DynamicForm` → `POST /submissions`.
- Dettaglio submission (sola lettura + foto), modifica.
- Regola MVP: campo `select` con valore "Non conforme" propone la creazione automatica di un task pre-compilato.
- **DoD**: da un'ispezione non conforme nasce un task assegnato in 3 click.

### Giorno 14 — Vista task progetto ✅ (2026-09-17, filtri/ordinamento client-side: paginazione server in backlog se un progetto supera le migliaia di task)
- Tabella task: filtri, ordinamento, cambio stato inline, assegnazione, scadenza; link "vedi sulla planimetria" (centra e apre il pin).
- Vista "i miei task".
- **DoD**: un manager smista 10 task senza aprire la planimetria.

### Giorno 15 — Form builder v1 (senza drag&drop) ✅ (2026-09-17; schema modificabile solo finché il template non ha compilazioni, poi "Duplica e modifica")
- Pagina template: lista, duplica, archivia.
- Editor: lista campi con aggiungi/rimuovi/sposta su-giù, proprietà per tipo, anteprima live con `DynamicForm`, validazione schema prima del salvataggio.
- Drag&drop rimandato al backlog: l'ordine con frecce è sufficiente per l'MVP.
- **DoD**: creo il template "diario giornaliero" dal browser e lo compilo su un pin.

---

## Settimane 4-5 — App mobile offline-first

### Giorno 16 — Scaffold Expo + DB locale ✅ (2026-09-17; DoD "parte su simulatore" NON verificata: nessun simulatore su questa macchina — verificati tsc, vitest sul DB e bundle Metro)
- `mobile/` con Expo (TS), navigazione, login (JWT in SecureStore).
- `expo-sqlite` + Drizzle: tabelle `projects, plans, form_templates, pins, form_submissions, tasks, attachments` con colonne extra `dirty: bool`, `local_file_path`.
- **DoD**: app parte su simulatore iOS e Android, login funziona, DB creato.

### Giorno 17 — Motore di sync ✅ (2026-09-17, verificato in Node contro il backend reale; LWW, sync_log e riprova/scarta del giorno 18 già inclusi)
- `sync/pull.ts`: primo avvio full, poi incrementale con `since = server_time` salvato per progetto; upsert locale; applica `deleted_at`.
- `sync/push.ts`: raccoglie righe `dirty`, invia `/sync/push`, azzera `dirty` sugli `inserted/updated/skipped`, marca `rejected` con motivo.
- Ordine: push poi pull. Mutex per evitare sync concorrenti.
- **DoD**: modifico un pin dal web, l'app lo riceve; creo un pin in app, il web lo vede.

### Giorno 18 — Conflitti e test sync ✅ (2026-09-17; LWW a livello di riga: un campo cambiato solo dal web può essere sovrascritto da una riga più recente dell'app — merge per campo in backlog)
- LWW: se il pull porta una riga con `updated_at` più recente di una riga locale `dirty`, la locale perde e viene loggata (`sync_log`).
- Righe `rejected`: schermata "Elementi non sincronizzati" con motivo e azione (elimina/riprova).
- Test Jest del motore contro un server mock + un test di integrazione contro il backend reale.
- **DoD**: scenario "stesso task modificato su web e app offline" termina senza duplicati né crash.

### Giorno 19 — Progetti e planimetrie offline ✅ (2026-09-17; "modalità aereo" verificata in Node: le schermate leggono solo dal DB e l'immagine è in cache locale)
- Schermate progetti e planimetrie; download immagini planimetria in cache (`expo-file-system`) al primo pull; indicatore "disponibile offline".
- **DoD**: in modalità aereo apro progetto e planimetria già scaricati.

### Giorno 20 — Plan view mobile ✅ (2026-09-17; gesture/pinch verificabili solo su device: tsc + bundle + test query)
- Viewer con `react-native-gesture-handler` + `reanimated` (pinch/pan), pin overlay in coordinate relative, tap su pin → bottom sheet.
- Aggiunta pin con long-press.
- **DoD**: stessa esperienza del web su tablet 10".

### Giorno 21 — Compilazione moduli mobile
- `DynamicForm` mobile su `form-core`: input nativi, `expo-camera`/`expo-image-picker` per foto, `react-native-signature-canvas` per firma, `expo-location` per geolocalizzazione.
- Salvataggio locale immediato (`dirty=true`), bozze.
- **DoD**: compilo un'ispezione con 3 foto e firma in modalità aereo.

### Giorno 22 — Foto: coda di upload separata
- Foto salvate su filesystem locale, `attachments.local_file_path`; coda upload con retry esponenziale, separata dal sync JSON (che viaggia sempre leggero).
- Compressione a max 1600px lato lungo prima dell'upload.
- Stati: `local → uploading → uploaded`; icona sul pin.
- **DoD**: 20 foto in coda, torna la rete, tutte caricate senza intervento.

### Giorno 23 — Task mobile
- Lista task del progetto e "i miei"; dettaglio; cambio stato con foto di risoluzione; tutto offline.
- **DoD**: un operaio chiude un task con foto senza rete; il manager lo vede al ritorno della rete.

### Giorno 24 — Sync automatico e stato
- Trigger: app in foreground, cambio connettività (`NetInfo`), ogni 15 min con `expo-background-fetch`, pull-to-refresh manuale.
- Barra di stato sync: ultima sync, elementi in attesa, errori.
- **DoD**: nessuna azione manuale necessaria per sincronizzare in uso normale.

### Giorno 25 — Giornata di test sul campo
- Checklist scenari: rete assente all'avvio, rete che cade a metà compilazione, app uccisa con coda piena, due device sullo stesso pin, cambio utente.
- Fix dei bug trovati; build interne (EAS) per iOS TestFlight e Android APK.
- **DoD**: checklist completata, build installabili distribuite agli intervistati.

---

## Settimana 6 — Notifiche, dashboard, rilascio

### Giorno 26 — Eventi e regole di notifica
- Tabella `events` (outbox): `submission.created`, `task.created`, `task.status_changed`, `task.assigned`; scritta nella stessa transazione della modifica (anche da sync push).
- Regole MVP: assegnatario notificato su `assigned`; creatore notificato su `resolved`; manager di progetto notificati su `submission.created` con esito non conforme.
- Preferenze utente minime (email sì/no, push sì/no).
- **DoD**: ogni cambio di stato produce la riga evento giusta (test).

### Giorno 27 — Invio email e push
- Worker (thread in-process in dev, processo separato in prod) che consuma `events` non processati.
- Email via SMTP (`.env`), template testuali con link diretto al task/pin sul web.
- Push via Expo Push API; registrazione token dall'app al login.
- **DoD**: assegno un task dal web, notifica push sul telefono entro 30 s + email.

### Giorno 28 — API dashboard
- `GET /projects/{id}/stats`: task per stato, task aperti per planimetria, submissions per template, serie giornaliera creati/risolti ultimi 30 giorni, task scaduti.
- Filtri: intervallo date, template, planimetria, assegnatario. Query SQL aggregate, non calcoli in Python.
- **DoD**: risposta < 300 ms sul dataset demo con 5.000 task.

### Giorno 29 — Dashboard web
- 4 grafici (Recharts): task per stato (barre), trend creati vs risolti (linee), aperti per zona/planimetria (barre orizzontali), submissions per template (barre). Card riassuntive: aperti, scaduti, chiusi negli ultimi 7 giorni.
- Click su grafico → vista task filtrata.
- **DoD**: un manager capisce lo stato del cantiere in 10 secondi.

### Giorno 30 — Rilascio MVP
- Dockerfile prod, `docker-compose.prod.yml` (backend+web, Postgres, worker), backup DB e `storage/` schedulati.
- Storage S3-compatible attivabile da env.
- Documentazione: `README` aggiornato, guida utente 1 pagina per cantiere, guida admin.
- Retrospettiva + backlog prioritizzato.
- **DoD**: ambiente di staging raggiungibile, utenti della discovery invitati.

---

## Backlog post-MVP (non in questi 30 giorni)

- Form builder con drag&drop e logica condizionale (mostra campo X se Y = ...).
- Conflitti con `version` incrementale e risoluzione manuale invece di LWW.
- Ruoli e permessi granulari per modulo.
- Export PDF di submission (report ispezione firmato) e CSV task.
- Pin su più pagine PDF / più livelli per planimetria.
- Notifiche in-app e digest giornaliero.
- Clustering pin per planimetrie con migliaia di segnalazioni.

## Come usare questo file

- Ogni giorno: aprire la sezione, eseguire i task, spuntare la DoD, commit con messaggio `giorno N: <obiettivo>`.
- Se un giorno sfora, non comprimere il successivo: spostare i task residui in cima al giorno dopo e annotarlo qui.
- Cambiare le assunzioni in testa al file prima di cambiare il piano.
