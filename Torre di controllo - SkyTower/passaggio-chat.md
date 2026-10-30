<!-- "><(((º> sabusabu <º)))>< -->
# Passaggio di consegne — SkyTower CDE, aggiornato al 29/10/2026

Riassume cinque sessioni di lavoro (27/10 mattina, 27/10 pomeriggio-sera, 28/10, 28/10 sera, 28–29/10) per
continuare in una nuova chat. Leggilo tutto prima di agire. Il file **non si committa**. Le sessioni più recenti
prevalgono sulle precedenti dove le contraddicono: **§8 (sessione 5)** > §7 (sessione 4) > §1–6.
**Per ripartire: fine di §8.**

---

## 1. Regole di sessione (si riattivano con `/avvio`)

- **Caveman ultra**: risposte telegrafiche in italiano, nessun riempitivo.
- **Auto-firma**: in cima a ogni file creato o modificato il commento `"><(((º> sabusabu <º)))><"` nella sintassi del
  linguaggio (`#`, `//`, `--`, `<!-- -->`). Non si firmano json, lock, csv, env, binari, file generati, file in scratchpad.
- **Auto-commit**: un commit per blocco logico, Conventional Commits in italiano (`feat(skytower): ...`), trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; path espliciti (mai `git add -A`), poi `git push`, mai force-push.
  - **Mai committare** `skytower/apps/web/tsconfig.tsbuildinfo` e `skytower/packages/iso19650/.coverage` (risultano sempre modificati).
- **Browser**: per mostrare un'app all'utente **Firefox** (`C:\Program Files\Mozilla Firefox\firefox.exe`), mai Chrome
  (Chromium solo headless, per Playwright).
- **Sicurezza**:
  - la password personale dell'utente non va mai scritta in file né nei commit: solo da variabile d'ambiente (es. `CDE_NUOVA_PWD`);
  - le policy password (minimo 12 caratteri) non si abbassano;
  - **non toccare l'istanza SkyTower reale (porta 8100) né il suo Postgres senza chiedere**;
  - non cambiare le credenziali: l'utente entra con il proprio account `a.mangiagi@nexora.srl` sull'istanza di prova.
- **Ritmo**: l'utente chiede di "continuare a implementare finché ci sono token"; le decisioni elencate in §6 vanno chieste,
  non prese.

## 2. Progetto

- **Repo** `C:\Users\a.mangiagi\Documents\Programmi\Programmi-pronti-`, branch `feat/estrazione-dms` (remote GitHub,
  allineato all'ultimo commit `2486d3a`).
- **Applicazione** `skytower/`: CDE ISO 19650 multi-tenant. Piano: `Torre di controllo - SkyTower/piano-sviluppo-cde.md`
  (6 sprint, G1–G60); stato aggiornato in `skytower/README.md` (sezione "Stato").
  `Torre di controllo - SkyTower/cde/` è una copia vecchia (Sprint 4): decisione aperta in §6.
- **Stack**:
  - backend FastAPI (Python 3.12), psycopg, PostgreSQL 16 con RLS (ruoli `cde_owner`, `cde_app`, `cde_auth`,
    `cde_worker`), funzioni SECURITY DEFINER, migrazioni yoyo `db/migrations/00NN_*.sql` con `-- depends:`
    (ultima: **0024**), worker Procrastinate;
  - storage S3 con Object Lock (in sviluppo moto); frontend React 18, Vite, MUI 6, TanStack Query;
  - pacchetto `packages/iso19650` (naming convention, 100% coverage);
  - infrastruttura Terraform (`infra/terraform`: `bootstrap`, `modules/cde-platform`, `envs/dev|staging|prod`), CI
    `.github/workflows/ci-skytower.yml`, deploy `deploy-skytower.yml`.
- **Istanza reale**: `skytower\avvia.bat` (API 8100, web 5195) o `.venv\Scripts\cde dev [--reset]`. Utenti demo con
  password `Cantiere-2026!` (es. `com.admin@com.example`, `des.lead@des.example`, `platform@com.example`).

### Comandi di verifica

```bash
cd skytower/apps/api
../../.venv/Scripts/python -m pytest -p no:warnings          # 405 passed, 11 skipped (~2 min)
../../.venv/Scripts/ruff check cde_api tests ../../packages/iso19650 --select E,F,W,B,S,UP,I --ignore S101,S311,E501,B008,S608
CDE_PERF=1 ../../.venv/Scripts/python -m pytest tests/test_db_permissions_perf.py   # benchmark 100k documenti

cd skytower/apps/web
npx tsc -b --noEmit && npm run build
npx playwright test                                           # 37 e2e (~2 min), ambiente usa-e-getta
```

Gli e2e avviano da soli: `cde dev --reset --data-dir %TEMP%\cde-e2e` su 8310 (S3 9310), `vite preview` su 4310 con la
CSP di produzione, IdP OIDC finto `e2e/mock-idp.mjs` su 4320. API ed e2e possono girare in parallelo (DB diversi).

## 3. Cronologia delle richieste dell'utente

1. UI: 10 varianti, poi layout a tre colonne (commesse e cartelle · contenuto con barra funzioni · "Per me"), avatar in alto.
2. Aree riservate accessibili solo da admin o su richiesta.
3. Dati di test per vedere le cartelle popolate (`cde demo-contenuti`).
4. "Non aprire Chrome, usa Firefox"; "non cambiare le credenziali".
5. Rinomina in caricamento secondo la naming convention, progressivo deciso dall'admin, nome originale nelle note;
   il "rinomina rapido" deve comparire nel riquadro d'errore del nome non conforme.
6. "Continua finché hai token, quando finiscono aspetta e ricomincia; a mezzanotte fermati" (27/10, rispettato).
7. 28/10: "continua ad implementare fino a che hai token" (due volte) → sessione 3 (§4).
8. "Riscrivi passaggio chat con le nuove info e passiamo su una nuova chat" → questo file.

## 4. Cosa è stato fatto

### Sessioni 1 e 2 (27/10) — in sintesi

- Layout a tre colonne, profilo (`PATCH /me`), aree riservate con richiesta di accesso, pagine RFI, designer workflow.
- Registro attività con hash chain, ancore giornaliere su S3 WORM + marca RFC 3161, export CSV/PDF firmati.
- Viewer in piattaforma: PDF (ricerca nel testo, confronto tra revisioni), immagini, testo modificabile, Word/Excel/CSV
  in anteprima, IFC 3D (web-ifc 0.0.77, funziona con la CSP di produzione — ADR-22); annotazioni su pagina ed elemento.
- Cruscotto KPI, transmittal con protocollo e PDF, report Excel in streaming.
- Rinomina automatica in caricamento (migrazioni 0015–0017): proposta subito per nomi non conformi, anteprima
  multi-file con numeri consecutivi, editor dello schema, prenotazione identificativi con scadenza (ADR-20).
- Sicurezza e rilascio: test OWASP + ZAP in CI, IP client da `CloudFront-Viewer-Address`, `cde bootstrap-db`,
  Terraform modulare (prod con DR, staging), Dockerfile ARM64, workflow di deploy con smoke test, runbook, piano UAT.
- E2E Playwright con accessibilità axe WCAG 2.1 AA (zero violazioni), layout desktop/tablet, tastiera.

### Sessione 3 (28/10)

| Commit | Contenuto |
|---|---|
| 1866097, b964b18, 6e88743 | **Filigrana sui PDF** negli stati scelti dal Project Admin (mig. 0018, `watermark.py` fpdf2+pypdf, ticket di download RS256 5', pannello nella scheda Naming, chip "Filigranato", ADR-23) |
| 409a602, ccc60f4, f991cdd | **Chiavi di sicurezza / passkey WebAuthn** come 2° fattore (mig. 0019 challenge monouso, `modules/passkeys.py`, profilo + login + enrollment, ADR-24) |
| 94cf5f8 | fix selettore e2e rinomina |
| b03380f, bc132a2, e9f41bb | **Pagina Organizzazione** (`/organizzazione`, dal menu profilo): utenti, inviti, admin, MFA obbligatoria, nuove org per il platform admin, ultimo admin non rimovibile, stato MFA e "Azzera MFA" (mig. 0020) |
| 742dd95, 9baec32, 2160b63, 179f608 | **Single sign-on OpenID Connect** per organizzazione (mig. 0021, `security/oidc.py`, `modules/sso.py`, PKCE, state/nonce monouso legati al browser contro il login CSRF, obbligo SSO, MFA dell'IdP; pulsante "Usa l'account aziendale (SSO)"; ADR-25, guida Entra nel runbook) |
| d6d0a20, 22b8cdf, 528d1d2 | **Cambio password e sessioni aperte** (`modules/sessions.py`, pagina Sicurezza) |
| (fix) | Etichette italiane nel Registro per i nuovi eventi |
| 1ed9fb0, b155bfb | **Registro "Accessi e sicurezza"** dell'organizzazione (mig. 0022, solo eventi senza commessa) |
| d2d3a11 | **Avvisi email di sicurezza** (`security/alerts.py`: dispositivo nuovo, password, 2° fattore; it/en, best effort) |
| 3b2633c, 6c4b7d2 | Perimetro pentest esteso; **guardia SSRF** sull'issuer SSO fuori da dev/test |
| 8f5b483, 2143c25, 2732dec | **Download multiplo in ZIP** (`modules/bundles.py`, streaming da S3, `elenco.csv` con SHA-256, filigrana; "Scarica cartella", "Scarica ZIP" nelle Aree CDE) |
| 0a6d829, ab19cf9, 8030526 | **Segui documento** (mig. 0023; il job `notify_state_changed`, prima solo un log, ora avvisa i follower; notifiche filtrate per visibilità; pulsante "Segui") |
| cfa548f, 09809ed, 2486d3a | **Ricerca nel contenuto** di PDF/Word/Excel/testo (mig. 0024, `textextract.py`, job `cde.index_text` ogni 10', RLS sul testo; "anche nel testo dei file" nelle Aree CDE; ADR-26) |

Docs aggiornate: `docs/adr.md` (fino ad ADR-26), `docs/uat.md` (scenari U01–U31, tutti con test automatico),
`docs/runbook.md` (azzeramento MFA, Entra ID), `docs/pentest.md` (SSO, WebAuthn, filigrana), `README.md`.
Dipendenze aggiunte: `pypdf 6.21.3`, `defusedxml` (già nel lock).

### File chiave della sessione 3

- API `apps/api/cde_api/`: `watermark.py`, `textextract.py`, `security/oidc.py`, `security/alerts.py`,
  `modules/passkeys.py`, `modules/sso.py`, `modules/sessions.py`, `modules/bundles.py`; aggiunte in
  `modules/documents.py` (filigrana, follow, ricerca), `modules/organizations.py` (MFA, registro), `modules/auth.py`,
  `worker.py` (follower, indicizzazione), `config.py` (`watermark_max_bytes`, `zip_max_bytes`, `public_api_prefix`,
  `webauthn_rp_id`, `webauthn_origins`).
- Web `apps/web/src/`: `pages/Organization.tsx`, `pages/project/Watermark.tsx`, `webauthn.ts`; modifiche a
  `pages/Login.tsx`, `pages/Security.tsx`, `pages/project/{Areas,Folder,Documents,Naming,Audit}.tsx`,
  `components/{FileViewer,ProfileMenu}.tsx`, `api.ts` (`apiDownload` con POST).
- Test: `tests/test_api_{watermark,passkeys,sso,sessions,alerts,zip,followers,textsearch}.py`;
  e2e `apps/web/e2e/{filigrana,passkey,organizzazione,sso,password,zip,segui,ricerca}.spec.ts`, `mock-idp.mjs`.

### Lezioni tecniche (da non ripetere)

- Transizioni di stato: l'API risponde **201**. Le revisioni SHARED/PUBLISHED **riusano il file della WIP**
  (`file_object_id` non è unico): tutto ciò che lavora "per file" deve gestire più revisioni.
- `security_events` è append-only: nei test non si cancellano utenti con eventi, si disattivano.
- Errori API: corpo `{"error": {"code", "message"}}`. Errori da far persistere (eventi) → `return ApiError` dalla
  transazione e `_raise_if_error` fuori.
- Postgres rifiuta i byte NUL nel testo: ripulire ogni testo estratto da file.
- Playwright: `getByLabel`/`getByRole` fanno match per sottostringa (es. "Attiva" ⊂ "Filigrana attiva"; un pulsante
  con "Accedi" nel nome rompe tutti i login) → `exact` o nomi distinti. Il `Tooltip` MUI sostituisce il nome
  accessibile del figlio: usare `describeChild`. Campi `required` → etichetta "Nome *". Analisi axe solo a
  dissolvenze finite (meglio `page.reload()` dopo un menu).
- MFA rate limit 10/min per utente; cambio password 10/min; `/auth/sso/start` 30/min per IP.
- Heredoc in bash: le sequenze `\\` e `\x00` si alterano → per patch non banali scrivere script Python con Write.
- Worker antivirus: confronta i magic bytes con il `content_type` dichiarato (IFC come `application/octet-stream`).
- openpyxl sempre `write_only=True`; web-ifc wasm con path relativo `?url`; console Windows cp1252 →
  `sys.stdout.reconfigure(errors="replace")`; Terraform con `TF_DATA_DIR` corto in `%TEMP%`.

### Prestazioni misurate (portatile)

Lista documenti 23–32 ms; cruscotto su 100k documenti 250–320 ms; Excel 50k righe 6,1 s; 150 utenti concorrenti
566 req/s p95 ≤ 196 ms (1 processo) / 726 req/s p95 338 ms (4 processi), 0 errori.

## 5. Istanza di prova (non è la 8100 reale)

Processi avviati nelle sessioni precedenti (potrebbero non sopravvivere alla chiusura della chat):

- **Vecchio stack** (sessione 1, scratchpad `…/8ae7d7ed-9d24-4bcd-9622-a2c62a92a098/scratchpad/stack/`): API **8200** con
  codice vecchio + **worker** + **S3 moto 9200 in memoria** + Postgres embedded in `pg/`. Non fermarlo: con lui
  spariscono i file caricati.
- **API nuova 8201** (sessione 3): `…/b7e02e6c-19e3-45d1-9464-bf223b1a5186/scratchpad/stack/run_api2.py`, stesso DB e S3,
  applica le migrazioni (ora fino alla 0024), `CDE_WEB_BASE_URL=http://localhost:5197`, origin WebAuthn anche 5198.
  Avvio: `cd skytower/apps/api && ../../.venv/Scripts/python -u <path>/run_api2.py`.
- **Web**: Vite **5197** e **5198** con `CDE_API_URL=http://127.0.0.1:8201` (`npx vite --port 5197 --strictPort --host 127.0.0.1`).
- Testo dei file indicizzato una volta con `…/b7e02e6c…/scratchpad/stack/index_once.py` (40 file).
- **Limite noto**: il worker è quello vecchio della 8200, quindi lì le notifiche "Segui documento" e l'indicizzazione
  dei nuovi caricamenti non partono. Si risolve solo ricreando lo stack (script `run_stack.py` sotto), che però
  svuota l'S3 in memoria: poi ripopolare con `cde demo-contenuti --api http://127.0.0.1:8200 --password Cantiere-2026!`.
- **Account dell'utente** `a.mangiagi@nexora.srl` (org COM, `is_org_admin`, `is_platform_admin`, PROJECT_ADMIN sulle
  commesse COM), creato con INSERT diretto sul DB owner, password da hash argon2 di `CDE_NUOVA_PWD`. Se lo stack si
  ricrea, va ricreato allo stesso modo chiedendo all'utente di impostare `CDE_NUOVA_PWD`.

Script dello stack completo (`run_stack.py`, venv di `skytower`, `--reset` per ricreare il DB):

```python
"""Stack SkyTower di prova, isolato: Postgres embedded in scratchpad, S3 moto 9200, API 8200 + worker."""
import os, sys, threading
from pathlib import Path
HERE = Path(__file__).parent
os.environ.update({"AWS_ACCESS_KEY_ID": "dev", "AWS_SECRET_ACCESS_KEY": "dev", "AWS_DEFAULT_REGION": "eu-south-1"})
import psycopg, uvicorn
from moto.server import ThreadedMotoServer
from cde_api.tooling import dbadmin, demo_seed
PW = {"cde_owner": "p-owner", "cde_app": "p-app", "cde_auth": "p-auth", "cde_worker": "p-worker"}
su = dbadmin.start_embedded(HERE / "pg", cleanup_mode=None)
urls = dbadmin.bootstrap(su, "cde", PW, recreate="--reset" in sys.argv)
print("migrazioni:", dbadmin.migrate(urls.owner), flush=True)
with psycopg.connect(urls.owner) as conn:
    empty = conn.execute("SELECT count(*) FROM cde.organizations").fetchone()[0] == 0
if empty:
    demo_seed.seed(urls.owner)
ThreadedMotoServer(ip_address="127.0.0.1", port=9200, verbose=False).start()
os.environ.update({
    "CDE_ENV": "dev", "CDE_DATABASE_URL_APP": urls.app, "CDE_DATABASE_URL_AUTH": urls.auth,
    "CDE_DATABASE_URL_WORKER": urls.worker, "CDE_LOCAL_SECRETS_DIR": str(HERE / "secrets"),
    "CDE_COOKIE_SECURE": "false", "CDE_REFRESH_COOKIE_PATH": "/api/auth", "CDE_S3_ENDPOINT_URL": "http://127.0.0.1:9200",
    "CDE_WEB_BASE_URL": "http://localhost:5197", "CDE_CORS_ORIGINS": '["http://localhost:5197"]',
})
from cde_api.config import get_settings
from cde_api.storage import Storage
get_settings.cache_clear()
Storage(get_settings()).ensure_bucket()
from cde_api.worker import run_worker
threading.Thread(target=run_worker, daemon=True).start()
uvicorn.run("cde_api.main:create_app", factory=True, host="127.0.0.1", port=8200, reload=False)
```

## 6. Da fare / decisioni aperte

**Decisioni dell'utente (chiedere, non decidere):**

1. **OnlyOffice o Collabora** per modificare Word ed Excel in piattaforma (oggi anteprima in sola lettura ≤ 25 MB).
2. **Autodesk APS** per il viewer DWG (licenza).
3. **TSA qualificata eIDAS** per `CDE_TSA_URL` (marca temporale delle ancore del registro).
4. **Copia vecchia `Torre di controllo - SkyTower/cde`** (istantanea Sprint 4, migrazioni fino alla 0007, nessun
   riferimento nel repo, `.venv` locale non versionato). Proposta: toglierla dal repository (resta nella storia git) e
   cancellare il `.venv`, tenendo `piano-sviluppo-cde.md`. Serve il via.
5. **Istanza reale 8100**: è ferma alle migrazioni di allora; per avere tutto va riavviata con `skytower\avvia.bat`
   (applica 0008–0024). Solo se l'utente lo chiede.

**Sviluppi possibili senza decisioni:**

- OCR per i PDF scansionati nella ricerca nel contenuto (ADR-26, limite noto).
- Conversione IFC → fragments lato worker per modelli > 500 MB.
- Login senza password con passkey residenti (ADR-24 lo indica come passo successivo).
- Notifiche "Segui" anche via digest giornaliero dedicato; etichette per tipo nel pannello notifiche.

**Resto dello Sprint 6 (richiede AWS e persone):** `terraform apply` di bootstrap e staging, test di carico su staging
(500 utenti, upload da 1 GB, 1M documenti), pentest esterno (perimetro in `docs/pentest.md`), UAT con gli utenti
pilota (`docs/uat.md`), poi produzione.

**Per ripartire nella nuova chat:** vedi la fine di §8.

---

## 7. Sessione 4 (28/10 sera) — prevale su quanto sopra

### Nuove regole dell'utente (memorizzate anche in memoria persistente)

- **PRIORITARIO — sempre la versione nuova**: dopo ogni modifica al programma far ripartire l'istanza che l'utente usa
  (5195, via `Torre di controllo - SkyTower\Avvia SkyTower.bat`); riscrivere il .bat se serve. Questo supera la vecchia
  regola "non toccare la 8100": ora 8100/5195 è l'istanza del lanciatore e va riavviata dopo ogni modifica.
- **Credenziali sempre valide**: "questa storia delle credenziali non valide deve finire". L'account
  `a.mangiagi@nexora.srl` non deve mai sparire con reset o riavvii (meccanismo sotto). Mai chiedere di nuovo la password.
- Documenti e modelli si aprono **sempre in una nuova scheda** del browser.

### Commit (tutti pushati, ultimo `dbae996`)

| Commit | Contenuto |
|---|---|
| fc9baa5, 1653536, bca5589 | **Accesso senza password con passkey residenti** (mig. **0025**: challenge anonimo `purpose='passwordless'`, colonna `webauthn_discoverable`; `passkeys.login_router` `/auth/passkey/options|verify`, UV obbligatoria, userHandle = user_id, rifiuta utenti non attivi e org con SSO obbligatorio, amr `hwk,mfa`; credProps in registrazione; pulsante "Usa una passkey (senza password)"; ADR-27, UAT U32) |
| 0f3e209 | `avvia.bat` ricompila sempre il frontend (prima la 5195 serviva un build vecchio) |
| fa431cf, 5494167, ce51260, b3e76fc | **BIM → tavole**: `modules/bim.py` `GET /projects/{id}/model-element/documents?name&guid&level&exclude` ("citato in" via full-text `phraseto_tsquery` + `ts_headline`, esclusi i modelli M2/M3/MR; "stesso livello" via `naming_fields->>'level'`); nel viewer IFC tabella **Misure** (OBB locale, volume dalla mesh) e **Tavole collegate**; tavole demo con legenda "Elementi BIM rappresentati"; ADR-28, UAT U33 |
| 2329b19, 104d1e8, 9070fb9, 32fa94e | **Lanciatore `Torre di controllo - SkyTower\Avvia SkyTower.bat`** (CRLF; non chiede password; libera 5195/8100/9100 con `libera-porta.bat`; reset solo se manca `.devdata\s3-state.pkl`; in background aspetta l'health, lancia `demo-contenuti`, apre Firefox su 5195/login) |
| 0958a46 | **Frecce Indietro/Avanti** nella barra (`components/HistoryArrows.tsx`, `history.state.idx`, sessionStorage `cde-nav-max`) |
| a30f14c | **S3 emulato persistente** (`tooling/dev_s3.py`: pickle dei bucket moto in `.devdata/s3-state.pkl`, salvataggio ogni 3 s) |
| 790dec1 | **Account personali che sopravvivono ai reset** (`tooling/personal_accounts.py`: export in `.devdata/account-personali.json` degli utenti ACTIVE non `.example` con hash argon2, restore dopo il seed; comando `cde utente-dev` con password solo da `CDE_NUOVA_PWD`) |
| 57ea8d7, e559b11, dbae996 | **Documenti e modelli sempre in nuova scheda**: `src/openDocument.ts` (`/documenti/:id?cerca&rev&compito`, `window.open(...,"_blank","noopener")`), `pages/DocumentPage.tsx` (titolo scheda = identificativo, "Dettagli e cronologia" apre `DocumentDrawer`, X/Esc chiudono la scheda); Folder, Documents, Tasks e link BIM non usano più il dialog; 11 e2e aggiornati con `openInTab` in `e2e/helpers.ts` |
| 4507e95, 7e4fd06 | **Modello IFC complesso** (`tooling/ifc_complex.py`, comando `cde genera-ifc FILE [--padiglioni N]`: 6 livelli, 616 elementi, aperture, scale, arredi, pensilina ruotata 15° 8×4,5×0,25) aggiunto in coda ai demo ("Modello completo Padiglione B" in DES → Modelli BIM); **sezioni** nel viewer: orizzontale + verticale (No/X/Y, inverti lato, piano guida azzurro, pick solo sul visibile); e2e `sezioni.spec.ts` |

Test: pytest completo verde; e2e toccati verdi (31). Nuovi test API: `test_api_passkey_login.py`, `test_api_bim.py`,
`test_dev_s3.py`, `test_personal_accounts.py`, `test_ifc_complex.py`; e2e `navigazione.spec.ts`, `sezioni.spec.ts`.

### Istanze in esecuzione (fine sessione 4)

- **5195 (web) / 8100 (API) / 9100 (S3)**: lanciatore, versione più recente. Dati in `skytower/.devdata` (DB, S3
  persistente, `account-personali.json`). 31 documenti demo + modello complesso, nessun doppione. Account personale
  ripristinato da solo a ogni avvio.
- **5197** Vite dev (codice live) + **API 8201** (`run_api2.py`, vedi §5): istanza di sviluppo.
- **8200**: vecchio stack con worker vecchio (§5).
- **Come riavviare la 5195 dopo una modifica**: lanciare il .bat in background vedendone l'output, es. da PowerShell
  `cmd.exe /c "\"...\Torre di controllo - SkyTower\Avvia SkyTower.bat\"" > <scratchpad>\launcher.log` (prima terminare
  il lanciatore precedente). Nel log attendere "SkyTower pronto su http://127.0.0.1:5195" e "Account personali pronti".
- Per la 8201 serve riavviare il processo per caricare endpoint nuovi (kill sulla porta, poi rilanciare `run_api2.py`).

### Lezioni della sessione 4

- I .bat vogliono **CRLF**; un .bat in esecuzione si rompe se modificato. Pattern per lavoro in background dal .bat:
  `start "" /b cmd /c ""%~f0" :dopo"`.
- **Mai inserire elementi in mezzo alla lista di `demo_content.py`**: la numerazione slitta e `demo-contenuti` ricarica
  doppioni (successo con 12 documenti; risolto cancellando `s3-state.pkl` → reset pulito). Aggiungere sempre in coda.
- Stati utente validi: INVITED, ACTIVE, LOCKED, DISABLED (non SUSPENDED).
- Sezioni three.js: piano "spento" = costante 1e9; filtrare il raycast con `planes.every(p => p.distanceToPoint(h.point) >= -1e-6)`.
- Playwright con nuove schede: `context.waitForEvent("page")`; la scheda che si chiude con Esc → attendere l'evento "close".
- La scheda nuova si autentica col cookie di refresh: nessun login ripetuto.

### File generati non versionati

`Torre di controllo - SkyTower/modelli-prova/ospedale-complesso.ifc` (0,6 MB) e `ospedale-4-padiglioni.ifc` (2,5 MB,
2464 elementi). Si rigenerano con `cde genera-ifc`; non si committano.

### In attesa di risposta dell'utente (risolto in sessione 5, vedi §8)

- **File .blend** (il viewer BIM legge solo IFC). Opzioni proposte:
  1. esportare in IFC da Blender con Bonsai (nessuna modifica);
  2. conversione lato server Blender → glTF (serve il permesso di installare Blender);
  3. supporto caricamento GLB/glTF nel viewer.
- Restano aperte le decisioni §6 punti 1–4 (OnlyOffice/Collabora, APS, TSA eIDAS, copia `cde/`). Il punto 5 è superato:
  la 8100 ora è l'istanza del lanciatore, già alla 0025.
- Dagli "sviluppi possibili" di §6 il login passkey è fatto; restano OCR, IFC → fragments, digest "Segui".

### Per ripartire nella nuova chat

Superato: vedi la fine di §8.

---

## 8. Sessione 5 (28/10 sera – 29/10) — prevale su quanto sopra

### Richieste e scelte dell'utente

1. "Leggi passaggio-chat e continua ad implementare" → chiesto il formato per i `.blend`: **scelto GLB/glTF nel viewer**.
2. A metà lavoro: "il naming delle cartelle deve poter essere deciso dalla scheda apposita e trasferito a tutte le
   cartelle che voglio tramite albero che si apre a popup" → schemi di naming per cartella.
3. "Continua ad implementare secondo la tabella di marcia" → G43 (derivato IFC), digest "Segui", OCR.
4. OCR: chiesto il motore → **scelto Tesseract** (già installato sul PC con `ita`).
5. "Committa e vai avanti", "aggiorna passaggio chat".

### Commit (tutti pushati su `feat/estrazione-dms`, ultimo `e2f2535`)

| Commit | Contenuto |
|---|---|
| 9c887bc, 1e33de0, 0c7a5a3 | **glTF/GLB da Blender nel viewer 3D**: `components/markup/ModelView.tsx` (ex `IfcView.tsx`, motore three.js generico) + lettori `ifcSource.ts` (web-ifc) e `gltfSource.ts` (GLTFLoader), contratto in `model3d.ts`, caricati a richiesta; texture con TextureLoader (niente fetch: CSP invariata); `.gltf` con data: URI ricomposto in `.glb`; un `.blend` spiega l'export; misure con la scala dell'oggetto; gruppi con nome di piano = piani. API: `model/gltf-binary` e `model/gltf+json` in `VIEWABLE`. `tooling/glb_model.py`, comando `cde genera-glb`, demo "Modello di studio Padiglione C (Blender)". ADR-29, UAT U34 |
| 2fa9d8f, e9c9b8a, c31ad2d | **Naming per cartella**: mig. **0026** (`naming_profiles`, `containers.naming_profile_id`, `cde.set_container_naming` SECURITY DEFINER), `modules/naming_profiles.py` (CRUD + `PUT /naming-profiles/{id}/containers` con elenco esatto), `load_naming()` in `documents.py` (validate/propose/upload/prenotazioni con `container_id`/`profile_id`), `GET /containers/{id}/naming`. Scheda Naming con tab "Commessa (predefinito)" + schemi, "Nuovo schema per cartelle" (copia della commessa), "Applica a cartelle…" con **albero a spunte nel popup** (sottocartelle incluse di serie). Scelte prese da me: **nessuna ereditarietà implicita**; i documenti già presenti tengono l'identificativo; negli schemi di cartella i campi fissi entrano nella serie del progressivo. ADR-30, UAT U35 |
| f9a52cf, e4cb477, ab5bc9c | **G43 — derivato .glb degli IFC pesanti**: `cde_api/ifc2glb.py` (IfcOpenShell 0.9, albero spaziale, GUID/tipo/Pset in `extras`, geometria locale in nodi figli `extras.part` con matrice, geometrie ripetute una volta), mig. **0027** `file_derivatives` (RLS = visibilità del file, funzioni `derivative_request/claim/done` per `cde_worker`, 3 tentativi, job ogni 5'), soglia `ifc_derivative_min_bytes` (100 MB prod, **2 MB in `cde dev`**), `Storage.put_file`, campo `derivative` nel download inline. Viewer: interruttore "Versione ottimizzata / IFC originale", etichetta "in preparazione". Demo "Modello campus 4 padiglioni". ADR-31, UAT U36 |
| 3f51ddf, 6c9d81d, 9adac16 | **Documenti seguiti nel riepilogo**: mig. **0028** `notification_preferences.follow_digest` (default **true**, scelto da me) e `cde.notify` aggiornata; `notifier.sections()` divide il digest per tipo (it/en); campanella con tipo per avviso e filtro; switch nel profilo. ADR-32, UAT U37 |
| 2425838, 7166d3c, e2f2535 | **OCR**: `cde_api/ocr.py` (pypdfium2 200 dpi + Tesseract `ita+eng`, 60 s/pagina, max 30 pagine, solo pagine con < 20 caratteri), configurazione `ocr_enabled`, `tesseract_cmd`, `ocr_languages`, `ocr_max_pages`; "Citato in" cerca anche la variante P0→PO; Dockerfile e CI installano `tesseract-ocr-ita`; demo "Verbale di sopralluogo (scansione)" (`scanned_pdf` in `demo_content.py`). ADR-33, UAT U38 |

Dipendenze nuove (in `pyproject.toml` e `requirements.lock`): `ifcopenshell==0.9.0.post1` (+ isodate, lark, numpy,
pyparsing, shapely), `pypdfium2==5.14.0`. Ruote presenti anche per Linux ARM64 (immagine Docker).

Test nuovi: `test_glb_model.py`, `test_api_folder_naming.py`, `test_ifc_derivative.py`, `test_api_follow_digest.py`,
`test_ocr.py`; e2e `gltf.spec.ts`, `naming-cartelle.spec.ts`, `derivato.spec.ts`, `ocr.spec.ts` (si salta senza
Tesseract); aggiornati `profilo.spec.ts`, `segui.spec.ts`. Esito finale: **pytest completo verde, e2e 44/44**
(`rinomina` è fallito una volta nel giro completo, verde da solo e al giro successivo: tenere d'occhio).

Docs: `docs/adr.md` fino ad **ADR-33**, `docs/uat.md` fino a **U38**, README (sezione Stato) aggiornato.

### Istanze (fine sessione 5)

- **5195 / 8100 / 9100** (lanciatore `Avvia SkyTower.bat`): riavviata con la versione finale, migrazioni fino alla
  **0028**, account personale `a.mangiagi@nexora.srl` ripristinato. Contenuti demo nuovi in coda: Padiglione C
  (GLB), campus 4 padiglioni (IFC con derivato), verbale scansionato (OCR).
- Riavvio dopo una modifica: da PowerShell
  `cmd.exe /c "\"...\Torre di controllo - SkyTower\Avvia SkyTower.bat\"" > <scratchpad>\launcherN.log` in background
  (il .bat libera da solo le porte); attendere nel log "Account personali pronti" e "SkyTower pronto su http://127.0.0.1:5195".
- Gli avvisi Vite "dynamically imported … but also statically imported" (Naming, Transmittals) sono vecchi e innocui.

### Lezioni della sessione 5

- Heredoc bash con `'''` annidati o testo lungo si troncano: per patch non banali **scrivere uno script Python con
  Write nello scratchpad** e lanciarlo con `.venv/Scripts/python`. `python` di sistema su Windows può bloccarsi (stub
  dello Store): usare sempre il python del venv.
- Un test con `mock_aws` (ordine alfabetico, es. `test_dbadmin_bootstrap.py`, `test_dev_s3.py`) azzera lo stato
  globale di moto: nei test successivi che usano S3 chiamare `api_app.state.services.storage.ensure_bucket()`.
- Il DB di test è condiviso tra moduli e tra esecuzioni: nomi/numeri casuali, pulizia nei fixture.
- Playwright: `getByLabel("Cartella X")` prende anche il pulsante "Apri Cartella X" → `getByRole("checkbox", { name, exact: true })`;
  secondo login nella stessa pagina → `page.context().clearCookies()` prima.
- Non ricompilare il frontend (`npm run build`) mentre gira un e2e completo: `vite preview` serve `dist`.
- IfcOpenShell 0.9: `ifcopenshell.util.shape.get_shape_matrix(shape)` (4×4 per righe), materiali con
  `m.diffuse.r()/g()/b()` e `m.transparency` (NaN = opaco), niente normali → le calcola il GLTFLoader (flat shading).
- OCR: Tesseract legge spesso lo zero dei codici come O ("P0" → "PO").

### Da fare / decisioni aperte (aggiornato)

**Decisioni dell'utente (chiedere, non decidere):**
1. OnlyOffice o Collabora per modificare Word/Excel in piattaforma.
2. Autodesk APS per il viewer DWG (licenza).
3. TSA qualificata eIDAS per `CDE_TSA_URL`.
4. Copia vecchia `Torre di controllo - SkyTower/cde` (proposta: toglierla dal repository, resta nella storia git).

**Richiedono AWS e persone:** `terraform apply` bootstrap e staging, test di carico su staging (500 utenti, upload
1 GB, 1M documenti), pentest esterno (`docs/pentest.md`), UAT con utenti pilota (`docs/uat.md`, U01–U38), produzione.

**Sviluppi possibili senza decisioni:** caricamento progressivo per piano dei modelli enormi (più file .glb per il
derivato); ri-OCR dei PDF già indicizzati con testo vuoto (comando o job); ereditarietà opzionale dello schema di
naming nelle sottocartelle create dopo (solo se l'utente la vuole).

### Per ripartire nella nuova chat

1. `/avvio`, poi leggere tutto questo file.
2. `git status` e `git log -5` (atteso `e2f2535` in cima, branch `feat/estrazione-dms`; restano sempre modificati e
   **non si committano** `skytower/apps/web/tsconfig.tsbuildinfo` e `skytower/packages/iso19650/.coverage`;
   non versionati `modelli-prova/` e questo file).
3. Controllare `http://127.0.0.1:8100/health` e la 5195; se spente, lanciare `Avvia SkyTower.bat` (non chiede password).
4. Chiedere all'utente cosa vuole fra le decisioni aperte o gli sviluppi possibili.
5. Dopo ogni modifica: test, commit per blocchi + push, **riavvio della 5195 con la versione nuova**.
