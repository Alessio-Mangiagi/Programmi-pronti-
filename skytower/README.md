<!-- "><(((º> sabusabu <º)))><" -->
# CDE ISO 19650

Common Data Environment multi-tenant per la gestione documentale di grandi cantieri.
Piano di riferimento: [`docs/piano-sviluppo.md`](docs/piano-sviluppo.md) · decisioni: [`docs/adr.md`](docs/adr.md).

## Stato

| Sprint | Contenuto | Stato |
|---|---|---|
| 1 | Multi-tenancy, RBAC, RLS, autenticazione + MFA (app TOTP, chiavi di sicurezza e passkey WebAuthn, recovery code), accesso senza password con passkey, single sign-on OpenID Connect per organizzazione (Entra ID), cambio password e sessioni aperte dal profilo, avvisi email di sicurezza (dispositivo nuovo, password, secondo fattore), API admin, UI | ✅ completato (`v0.1.0`) |
| 2 | Storage S3 immutabile, naming ISO 19650, revisioni, worker verifica file, UI upload | ✅ completato (`v0.2.0`) |
| 3 | Stati CDE WIP → SHARED → PUBLISHED → archiviazione, visibilità per stato, bulk, liste < 200 ms su 100k | ✅ completato (0.3.0) |
| 4 | Workflow di approvazione, scadenze, notifiche, RFI (API + designer workflow, inbox compiti, pagine RFI) · escalation dei compiti scaduti ai Project Admin ripetuta ogni 72 h, con solleciti visibili in inbox, cruscotto e nel "da fare" del portale (ADR-44, migrazione 0036) | ✅ completato |
| extra | Layout a tre colonne (commesse e cartelle · contenuto · "Per me"), profilo personale, aree riservate con richiesta di accesso, pagina Organizzazione (utenti, inviti, amministratori, MFA obbligatoria; nuove organizzazioni per il platform admin) | ✅ |
| 5 | Audit trail con hash chain, ancore giornaliere su S3 WORM + marca RFC 3161, export CSV e PDF firmati con verifica della firma in piattaforma (ADR-45) · viewer PDF (PDF.js, confronto tra revisioni), immagini, testo, modelli IFC (i pesanti nella versione .glb preparata dal worker e caricata un piano alla volta, ADR-31, ADR-36) e glTF/GLB da Blender in 3D (misure dell'elemento, tavole che lo citano e tavole del suo piano) · disegni CAD DWG/DXF nel browser senza licenza (DWG → DXF con ODA File Converter, DXF → SVG con ezdxf nel worker; layer, misure, annotazioni; ADR-41) · annotazioni su pagina ed elemento | ✅ completato |
| extra | Rinomina automatica in caricamento secondo la naming convention (progressivo deciso dal Project Admin, nome originale nelle note), scheda "Naming" con schemi per cartelle applicati dall'albero in un popup, ereditabili dalle sottocartelle nuove (ADR-30, ADR-35) · filigrana sui PDF scaricati e visualizzati negli stati scelti dal Project Admin (ADR-23) · download multiplo in ZIP con elenco.csv e impronte · "Segui documento" con notifiche filtrate per visibilità e raccolte nel riepilogo giornaliero (ADR-32) · nuovi progetti da un progetto esistente come template (cartelle, naming, ruoli, workflow; ADR-38) · import dei workflow da un altro progetto, adattati a persone e ruoli del progetto (ADR-39) · modifica di Word, Excel e PowerPoint con OnlyOffice Docs, salvata come WIP successiva (ADR-37) · timbri (firma, logo, «Approvato») sui PDF dal visualizzatore, salvati come WIP successiva (ADR-56) · ricerca nel testo di PDF (anche scansionati, con OCR Tesseract, anche per i PDF caricati prima: ADR-33, ADR-34), Word ed Excel (ADR-26) | ✅ |
| 6 | Cruscotto KPI per il Project Manager · transmittal con protocollo e PDF · report Excel (documenti, approvazioni, RFI, numeri prenotati) · pentest automatico OWASP + ZAP in CI (`docs/pentest.md`) · Terraform modulare (prod con DR, staging), immagine Docker, workflow di deploy con smoke test, runbook DR (`docs/runbook.md`) · test di carico pronti (`docs/prestazioni.md`) · 37 test e2e sotto la CSP di produzione, incl. accessibilità WCAG 2.1 AA, piano UAT (`docs/uat.md`) | ✅ funzionale (restano: apply in AWS e misure su staging, pentest esterno, UAT con gli utenti pilota) |

## Struttura

```
skytower/
├─ apps/
│  ├─ api/        FastAPI (Python 3.12) — auth (password, TOTP, WebAuthn), organizzazioni, progetti, container,
│  │              documenti (naming, rinomina, filigrana), stati, workflow, RFI, transmittal, audit, report;
│  │              worker Procrastinate (verifica SHA-256 + antivirus, notifiche, ancore del registro)
│  └─ web/        React 18 + Vite + MUI + TanStack Query · e2e/ test Playwright sotto la CSP di produzione
├─ packages/iso19650/  naming convention, revisioni, codici di idoneità (100% coverage)
├─ db/migrations/ SQL versionato (yoyo): schema, RBAC, RLS, documenti, stati, workflow, audit, naming, WebAuthn
├─ infra/terraform/  bootstrap · modules/cde-platform (piattaforma completa) · envs/prod · envs/staging · envs/dev
├─ infra/load/  test di carico · infra/smoke.py dopo i deploy · infra/zap/ regole del DAST
├─ docs/        adr.md, runbook.md, pentest.md, prestazioni.md, uat.md
└─ ../.github/workflows/  ci-skytower.yml (lint, test, Semgrep, audit, e2e, ZAP, Terraform) · deploy-skytower.yml
```

## Avvio locale (Windows/macOS/Linux, senza Docker)

```powershell
cd skytower
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r apps/api/requirements.lock -e "packages/iso19650[dev]" -e "apps/api[dev]"
.venv\Scripts\cde dev            # Postgres 16 embedded + S3 emulato (:9100) + worker + dati demo + API (:8100)

cd apps/web
npm ci
npm run dev                      # SPA su http://localhost:5195 (proxy /api → :8100)
```

Disegni CAD: i DXF si vedono subito; per i **DWG** serve [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
(gratuito) sul server: `CDE_DWG_CONVERTER_CMD` con l'eseguibile, oppure nel PATH o in `C:\Program Files\ODA\`.
`cde genera-dxf pianta.dxf --svg pianta.svg` fa una pianta di prova e la conversione del worker.

PDF firmati digitalmente (`.pdf.p7m`, ADR-55): il worker apre la busta e verifica la firma con il motore comune
della suite `shared/firma` (README lì). `avvia.bat` lo installa al primo avvio (`shared\firma\installa.bat`); senza,
i `.p7m` si caricano e si scaricano ma restano "da aprire" finché il motore non c'è. La revisione conserva la busta;
visualizzatore, ricerca, confronto e verifica requisiti usano il documento contenuto (derivato `P7M`, migrazione
0044), con l'esito della firma nel dettaglio (`firma_stato`, `firma`) e nel badge del visualizzatore.
`POST /revisions/{id}/firma/verifica` rifà la verifica. Variabili: `CDE_FIRMA_RETE` (false = niente download verso
enti ed elenchi: revoca "da verificare"), `CDE_FIRMA_MAX_BYTES` (200 MB); quelle del motore (`FIRMA_ELENCHI`,
`FIRMA_CACHE_DIR`, `FIRMA_PYTHON`) passano così come sono. Docker: librerie nel venv dell'API, `FIRMA_PYTHON` e
cache degli elenchi in `/tmp/firma-elenchi` (Dockerfile), codice da `/shared/firma`.

Timbri sui PDF (ADR-56, migrazione 0045): scheda **Timbri** della commessa con la libreria (personali, della propria
organizzazione, della commessa; PNG o JPG con lo sfondo reso trasparente come in Timbri per VFP, `cde_api/timbri.py`)
e, nel visualizzatore, **Timbra**: i timbri messi sulle pagine (con la didascalia «Timbrato da … il …» a richiesta)
diventano la WIP successiva del documento, con `REVISION_STAMPED` nel registro attività. Rotte: `GET/POST
/projects/{id}/stamps`, `PATCH /stamps/{id}`, `GET /stamps/{id}/image`, `POST /revisions/{id}/timbra`. Non sulle
buste `.p7m`; un PDF con firma PAdES solo con conferma. Variabili: `CDE_TIMBRI_PDF_MAX_BYTES` (100 MB),
`CDE_TIMBRO_IMMAGINE_MAX_BYTES` (8 MB).

`cde dev --reset` ricrea il database. `--data-dir` e `--s3-port` avviano un'istanza separata accanto a quella
in uso (lo fanno i test e2e). Dati demo: password `Cantiere-2026!` per tutti gli utenti, ad esempio

| Utente | Ruolo |
|---|---|
| `com.admin@com.example` | Committente — PROJECT_ADMIN, org admin |
| `des.admin@des.example` | Progettista — ORG_ADMIN (può condividere i container DES) |
| `des.lead@des.example` | Progettista — LEAD_DESIGNER |
| `sub1.user@sub1.example` | Subappaltatore — SUBCONTRACTOR (vede solo SUB1) |
| `platform@com.example` | Platform admin (crea organizzazioni) |

Le email (inviti, reset password) in sviluppo sono stampate nel log dell'API. L'S3 emulato (moto) salva i
file in `.devdata/s3-state.pkl` ogni pochi secondi e li ricarica all'avvio, con le stesse versioni: database e
file restano allineati tra un riavvio e l'altro; `--reset` cancella entrambi.

Avvio con un doppio clic: `Torre di controllo - SkyTower\Avvia SkyTower.bat` ricompila il frontend, avvia
API e worker, carica i documenti demo che mancano (`cde demo-contenuti`), crea o aggiorna l'account personale
(`cde utente-dev`, password chiesta nascosta o da `CDE_NUOVA_PWD`, mai su file) e apre Firefox.

## Rilascio sul server aziendale (Docker, senza AWS)

`infra/docker/` fa girare SkyTower sul server della suite con Docker Compose (ADR-43): niente account
cloud, i colleghi lo usano dal portale come le altre app.

| Container | Cosa fa |
|---|---|
| `db` | PostgreSQL 16 vero, volume `pgdata`, ruoli `cde_owner/app/auth/worker` |
| `minio` + `minio-init` | S3 compatibile con **Object Lock** (bucket creato con il lock, retention di default, utente dedicato) |
| `clamav` | antivirus `clamd` per il worker (le firme si scaricano al primo avvio: qualche minuto) |
| `api`, `worker` | immagine `apps/api/Dockerfile`; API pubblicata anche sulla **8100** per InCampo, Magazzino e portale |
| `web` | Caddy con la SPA compilata (`infra/docker/Dockerfile.web`), `/api` → API, stessa CSP della produzione, porta **5195** |
| `backup` | `pg_dump` ogni 24 ore in `infra/docker/backup/`, 30 giorni |

Prima installazione, da `skytower/infra/docker`:

```powershell
.\installa.ps1        # Linux: ./installa.sh
```

Lo script crea `.env` dal modello `.env.esempio` con i segreti generati (il file resta fuori da git),
chiede il nome del server e, se c'è, il dominio della suite, prende il token di servizio da
`shared/suite/.token`, costruisce le immagini, avvia database/MinIO/antivirus, lancia
`strumenti/prepara_db.py` (ruoli, migrazioni, organizzazione, primo platform admin e account personale
con le password chieste a video, mai su file) e poi tutto il resto, con `infra/smoke.py` alla fine.

- **Senza dominio** (`SUITE_DOMINIO` vuoto): HTTP in LAN, web `http://<server>:5195`, S3 `http://<server>:9100`
  (il browser carica e scarica da lì con URL firmati), cookie di sessione non `Secure`.
- **Con il Caddy della suite** (`deploy/Caddyfile`): `https://skytower.<dominio>` → 5195 c'è già; va aggiunto
  `s3-skytower.<dominio> { import suite; reverse_proxy 127.0.0.1:9100 }` e l'API deve fidarsi della CA
  interna di Caddy (`certs/root.crt`, `AWS_CA_BUNDLE`): lo script lo fa se trova il certificato.
- Le altre app della suite restano fuori dai container e si raggiungono via `host.docker.internal`
  (`SUITE_URL_*` nel `.env`); il **portale** vede la 5195 accesa e non lancia `avvia.vbs`: nel registro
  `APPS` di `portale/server.js` la voce `skytower` non cambia.
- `CDE_ENV=prod` con `CDE_KMS_PROVIDER=file` (ADR-46): le chiavi (Fernet e JWT) vivono nel volume `segreti`,
  che l'API accetta solo se esiste già e ha permessi 700 (lo prepara `prepara_db.py`); documentazione API
  spenta, antivirus obbligatorio.
- Email: `CDE_MAILER=smtp` con `CDE_SMTP_HOST`, `CDE_SMTP_PORT` (587), `CDE_SMTP_SECURITY` (`starttls` | `ssl`
  | `none`), `CDE_SMTP_USER`/`CDE_SMTP_PASSWORD` (vuoti se il relay autentica per IP) nel `.env`: inviti,
  reset, avvisi e notifiche partono davvero (ADR-46). Con `console` restano in `docker compose logs api`.
  Un invio fallito finisce nel log e non blocca l'operazione (l'invito resta valido).

Operazioni: `aggiorna.*` (nuove immagini dal commit corrente, backup, migrazioni, riavvio; `aggiorna.* <tag>`
per tornare indietro), `backup.*` (dump + volumi documenti e chiavi, da copiare fuori dal server),
`ripristina.*`. Dettagli e ripristino passo passo nel runbook (`docs/runbook.md` § 5).

## Demo parlante: due commesse complete

`tooling/demo_commesse.py` costruisce, passando dall'API come farebbero gli utenti, due commesse con
tutto quello che il CDE sa fare: servono a capire come funziona e a far girare la suite con dati veri.

| Commessa | Progetto | Cosa è |
|---|---|---|
| `101-003` Sede Acireale | `ACI003` | ristrutturazione uffici, Via Nazionale 120, Acireale (CT), cliente Cosedil S.p.A. |
| `C-2024-015` Scuola Via Roma | `SCU015` | nuova scuola primaria, Via Roma 45, Catania, committente Comune di Catania |

Sono gli stessi codici commessa del registro della suite, di InCampo e del Magazzino: InCampo prende le
tavole pubblicate come planimetrie «da SkyTower», il Magazzino manda qui i report di giacenza, il Lettore
DDT e VFP Transfer archiviano qui i loro documenti. Per ogni commessa:

- progetto copiato dal template `PRJ01` (5 organizzazioni con il loro ruolo di parte, 14 persone con ruoli
  diversi, cartelle, workflow), `settings.commessa` = codice, indirizzo, cliente, importo, filigrana sulle
  revisioni condivise, schema di nomenclatura ISO 19650 con il codice del progetto;
- 20 cartelle (piante, prospetti, dettagli, strutture, BIM, relazioni, computi, impianti, verbali, foto,
  sicurezza, direzione lavori, area riservata «Contratti e offerte»);
- 28-29 documenti con file veri: tavole architettoniche, strutturali e d'impianto con cartiglio, relazione
  tecnica, relazione di calcolo, computo metrico, cronoprogramma, piano di sicurezza, capitolato, elenco
  elaborati, modello IFC, foto di cantiere, verbali della DL (uno scansionato, per l'OCR), ordine di
  servizio, contratto in area riservata; 65-68 revisioni in tutto (fino a P03.01), 18 pubblicate, 9-10
  condivise, 1 in lavorazione, 1 archiviata con motivazione;
- documenti seguiti dal committente (= notifiche a ogni passaggio di stato), annotazioni con risposte e
  chiusura, 4 workflow di approvazione (uno appena avviato, uno a metà, uno approvato fino alla
  pubblicazione automatica, uno respinto dalla DL con commento), RFI con risposte e chiusura, transmittal
  con presa visione, due richieste di accesso all'area riservata (una decisa, una in attesa).

```powershell
.venv\Scripts\python tooling\demo_commesse.py                 # API su http://127.0.0.1:8100
.venv\Scripts\python tooling\demo_commesse.py --solo 101-003
.venv\Scripts\python tooling\demo_commesse.py --rimuovi       # archivia i progetti demo e li scollega
```

Si può rilanciare quante volte si vuole: trova quello che c'è (progetto per codice commessa, documento per
nome) e aggiunge solo ciò che manca. Tutto è marcato (`settings.demo`, attributo `demo` sui documenti).
Utenti: quelli del seed demo, password `Cantiere-2026!` (`com.admin@com.example` amministra, `com.dl@…`
Direzione Lavori con i compiti del workflow, `com.im@…` Information Manager con le notifiche,
`des.lead@des.example` progettista che carica e condivide, `sub1.user@sub1.example` impiantista). L'account
personale (l'unica email non `.example`) viene aggiunto come Project Admin ai due progetti, mai modificato.

## Suite Cosedil: dialogo con InCampo e Magazzino

Le altre app della suite trovano il progetto dal **codice commessa aziendale**, che il
Project Admin imposta nella scheda **Suite Cosedil** del progetto (`settings.commessa`;
in mancanza vale il codice ISO). Rotte `/suite/...` (`apps/api/cde_api/modules/suite.py`),
protette dal token di servizio di `shared/suite` (header `X-Suite-Token`), non dal JWT:

| Rotta | Cosa fa |
|---|---|
| `GET /suite/commesse` | progetti con codice commessa |
| `GET /suite/commesse/{codice}/documenti?area=PUBLISHED&q=` | documenti della commessa (default: pubblicati) con file e link |
| `GET /suite/revisioni/{id}/file` | i byte di una revisione (InCampo ne fa una planimetria), stessi controlli del download; per un PDF firmato `.p7m` il documento contenuto (`?originale=true`: la busta firmata), con l'esito della firma in `X-Firma-Esito` (ADR-55); 409 finché la busta non è aperta |
| `POST /suite/commesse/{codice}/documenti` | un file (corpo della richiesta, nome in `X-Suite-Nome-File`, metadati in query) diventa documento WIP nella cartella «Suite Cosedil» dell'organizzazione, nome a norma (rinomina automatica se attiva, altrimenti primo progressivo libero, tipo `RP`, ruolo `Z`) |

| `GET /suite/da-fare` | cosa aspetta l'utente del portale: approvazioni assegnate (compiti aperti, con «Chiarimento: …» e «Modifiche richieste: …» per i ritorni di ADR-51/54, link diretto al compito) e notifiche non lette, nel formato della home del portale |

Ogni chiamata gira come un utente SkyTower, perché RLS e permessi sono per utente:
quello con l'email dell'utente del portale (`X-Suite-Email`, poi `X-Suite-Utente` anche
come parte prima della `@`) se esiste, altrimenti l'utente tecnico `CDE_SUITE_USER_EMAIL`,
altrimenti il primo platform admin (che vede solo i progetti di cui è membro). Chi non
vede il progetto riceve 404. Regole comuni a tutte le app in `shared/suite/CONTRATTI.md`.

### Login automatico dal portale

`POST /auth/portale` (`modules/portale.py`): la SPA lo chiama una volta all'apertura se
non ha una sessione. L'API gira il cookie `sid` del portale a `<COSEDIL_PORTAL>/api/verify`
(`shared/sso`), trova l'utente SkyTower (email del portale, altrimenti parte prima della
`@` = username) e apre la sessione come dopo il login (`amr = ["portale"]`). Se l'utente
manca lo **crea**, attivo e senza password, e lo rende membro di tutti i progetti con
codice commessa; un utente già esistente non membro viene aggiunto allo stesso modo.
Con `COSEDIL_SSO=off` o portale spento risponde 401 e si vede il login di sempre.

| Variabile | Default | Effetto |
|---|---|---|
| `CDE_SUITE_ORG_ID` | organizzazione di `CDE_SUITE_USER_EMAIL`, altrimenti del primo platform admin | dove nascono gli utenti creati dal portale |
| `CDE_SUITE_RUOLO_PORTALE` | `DESIGNER` | ruolo di sistema sui progetti con commessa (admin del portale → `PROJECT_ADMIN` e org admin) |
| `CDE_SUITE_EMAIL_DOMINIO` | `cosedilspa.com` | email di ripiego `<username>@<dominio>` quando il portale non la dà |
| `COSEDIL_PORTAL` | `http://localhost:8080` | il portale da interrogare |

La membership viene inserita a nome di un Project Admin del progetto (RLS); la migrazione
`0034_suite_portale.sql` dà a `cde_auth` la lettura di progetti, ruoli e membership.

### Password del portale nel login

`POST /auth/login` accetta anche la **password del portale** (una password per tutti i programmi,
06/11/2026). Se la password di SkyTower non coincide, l'utente non ne ha una o non esiste,
`auth._login_tx` chiede al portale `POST /api/verifica-password` (`portale.verifica_password_portale`
→ `shared/sso/cosedil_sso.verifica_password`, col token della suite e l'IP della persona) **prima**
di contare il tentativo fallito. Se il portale la riconosce, il login prosegue in `portale.entra`
(`via="password"`): stesse regole dell'ingresso dal portale (ADR-47: organizzazione della suite,
niente platform admin né SSO obbligatorio, MFA come sempre, utente creato se manca), contatore dei
tentativi azzerato, `amr = ["pwd", "portale"]`. Il portale risponde 403 se SkyTower non è fra i
programmi della persona (`portale_non_abilitato`), se l'account del portale è disattivato o se la
password è ancora quella temporanea. Un account bloccato di SkyTower resta bloccato (il portale non
viene chiesto). La password di SkyTower resta valida; portale spento o `COSEDIL_SSO=off`: vale solo quella.

### Confronto Documenti e Verifica Requisiti dal dettaglio documento

Sezione «Suite Cosedil» del dettaglio documento (JWT):

| Rotta | Cosa fa |
|---|---|
| `POST /revisions/{id}/confronta` | manda la revisione e la precedente dello stesso documento a Confronto Documenti (`/api/compare`, token di servizio); l'esito resta in `documents.attributes.confronti[]` con `url` (`…/?job=<id>`) |
| `POST /revisions/{id}/verifica` `{set_id}` | carica il file in Verifica Requisiti, aspetta l'estrazione del testo, lancia la checklist; esito (`ok`/`ko`/`dubbio`, conteggi) in `attributes.verifiche[]` |
| `GET /suite/requisiti/set` | i set di Verifica Requisiti |
| `GET /suite/registro` | registro unico delle commesse (`shared/suite/commesse.json`) per il menu a tendina della scheda Suite Cosedil |

Basta poter scaricare la revisione; l'annotazione sui metadati passa da `cde_auth` (niente permesso WRITE,
niente schema dei metadati). App vicina spenta = 503 con messaggio, mai un errore generico.
Indirizzi delle app con `SUITE_URL_CONFRONTO`, `SUITE_URL_VERIFICA` (default porte 5001 e 5185).

## Test

```powershell
cd apps/api
..\..\.venv\Scripts\python -m pytest
```

- `tests/test_db_isolation.py` — 113 casi direttamente sul database come `cde_app` (scenari T1–T10, matrice ruolo × azione, escalation, append-only).
- `tests/test_api_auth.py` — login, lockout, rate limit, MFA TOTP/recovery, rotazione refresh e riuso (T9), inviti, reset.
- `tests/test_api_portale.py` — login automatico dal portale: utente trovato per email o username, creato se manca, membro dei progetti con commessa.
- `tests/test_api_suite.py` — rotte `/suite` per le altre app, registro commesse, da-fare, confronto e verifica di una revisione (app vicine finte).
- `tests/test_api_admin.py` — isolamento via HTTP (404 vs 403), grant, membri, ruoli, flusso completo del Project Admin.
- `tests/test_security_owasp.py` — OWASP API Top 10 su tutte le rotte dell'app (BOLA, token contraffatti, mass assignment, header); vedi `docs/pentest.md`.
- `tests/test_api_naming_auto.py` — rinomina automatica, serie, numeri consecutivi, prenotazioni.
- `tests/test_api_folder_naming.py` — schemi di naming per cartella, assegnazione, documenti esistenti.

In CI si usa un Postgres 16 di servizio (`CDE_TEST_SUPERUSER_URI`).

Test nel browser (Playwright): avviano da soli un ambiente usa-e-getta (`cde dev --reset` su una cartella
dati propria, porte 8310/4310), quindi non toccano `.devdata` né l'istanza su 8100.

```powershell
cd apps/web
npm run e2e        # flussi principali, MFA, isolamento, layout desktop/tablet, accessibilità WCAG 2.1 AA (axe)
```

Altri strumenti: `infra/load/carico.py` (utenti concorrenti) e `infra/load/upload.py` (upload paralleli),
risultati in `docs/prestazioni.md`; `infra/smoke.py` dopo ogni deploy (`docs/runbook.md`); collaudo utenti in `docs/uat.md`.

## Sicurezza: principi applicati

- Isolamento **doppio**: guard applicativo (404 se la risorsa non è visibile, 403 se manca l'azione) **e** Row-Level Security nel database.
- L'API si connette come `cde_app` (mai owner): senza `app.user_id` ogni tabella restituisce zero righe.
- `password_hash`, fattori MFA e sessioni non sono leggibili dall'API applicativa (privilegi di colonna, ruolo `cde_auth` separato).
- Access token RS256 15' solo in memoria nel browser; refresh token opaco in cookie `HttpOnly; Secure; SameSite=Strict`.
- `security_events` append-only anche per il proprietario delle tabelle (trigger su UPDATE/DELETE/TRUNCATE).
