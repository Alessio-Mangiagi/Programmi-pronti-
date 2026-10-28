<!-- "><(((º> sabusabu <º)))><" -->
# CDE ISO 19650

Common Data Environment multi-tenant per la gestione documentale di grandi cantieri.
Piano di riferimento: [`docs/piano-sviluppo.md`](docs/piano-sviluppo.md) · decisioni: [`docs/adr.md`](docs/adr.md).

## Stato

| Sprint | Contenuto | Stato |
|---|---|---|
| 1 | Multi-tenancy, RBAC, RLS, autenticazione + MFA (app TOTP, chiavi di sicurezza e passkey WebAuthn, recovery code), single sign-on OpenID Connect per organizzazione (Entra ID), cambio password e sessioni aperte dal profilo, avvisi email di sicurezza (dispositivo nuovo, password, secondo fattore), API admin, UI | ✅ completato (`v0.1.0`) |
| 2 | Storage S3 immutabile, naming ISO 19650, revisioni, worker verifica file, UI upload | ✅ completato (`v0.2.0`) |
| 3 | Stati CDE WIP → SHARED → PUBLISHED → archiviazione, visibilità per stato, bulk, liste < 200 ms su 100k | ✅ completato (0.3.0) |
| 4 | Workflow di approvazione, scadenze, notifiche, RFI (API + designer workflow, inbox compiti, pagine RFI) | ✅ completato |
| extra | Layout a tre colonne (commesse e cartelle · contenuto · "Per me"), profilo personale, aree riservate con richiesta di accesso, pagina Organizzazione (utenti, inviti, amministratori, MFA obbligatoria; nuove organizzazioni per il platform admin) | ✅ |
| 5 | Audit trail con hash chain, ancore giornaliere su S3 WORM + marca RFC 3161, export CSV firmato · viewer PDF (PDF.js, confronto tra revisioni), immagini, testo, modelli IFC 3D · annotazioni su pagina ed elemento | ✅ (manca il viewer DWG: richiede licenza Autodesk APS) |
| extra | Rinomina automatica in caricamento secondo la naming convention (progressivo deciso dal Project Admin, nome originale nelle note), scheda "Naming" · filigrana sui PDF scaricati e visualizzati negli stati scelti dal Project Admin (ADR-23) · download multiplo in ZIP con elenco.csv e impronte · "Segui documento" con notifiche filtrate per visibilità | ✅ |
| 6 | Cruscotto KPI per il Project Manager · transmittal con protocollo e PDF · report Excel (documenti, approvazioni, RFI, numeri prenotati) · pentest automatico OWASP + ZAP in CI (`docs/pentest.md`) · Terraform modulare (prod con DR, staging), immagine Docker, workflow di deploy con smoke test, runbook DR (`docs/runbook.md`) · test di carico pronti (`docs/prestazioni.md`) · 36 test e2e sotto la CSP di produzione, incl. accessibilità WCAG 2.1 AA, piano UAT (`docs/uat.md`) | ✅ funzionale (restano: apply in AWS e misure su staging, pentest esterno, UAT con gli utenti pilota) |

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

`cde dev --reset` ricrea il database. `--data-dir` e `--s3-port` avviano un'istanza separata accanto a quella
in uso (lo fanno i test e2e). Dati demo: password `Cantiere-2026!` per tutti gli utenti, ad esempio

| Utente | Ruolo |
|---|---|
| `com.admin@com.example` | Committente — PROJECT_ADMIN, org admin |
| `des.admin@des.example` | Progettista — ORG_ADMIN (può condividere i container DES) |
| `des.lead@des.example` | Progettista — LEAD_DESIGNER |
| `sub1.user@sub1.example` | Subappaltatore — SUBCONTRACTOR (vede solo SUB1) |
| `platform@com.example` | Platform admin (crea organizzazioni) |

Le email (inviti, reset password) in sviluppo sono stampate nel log dell'API. L'S3 emulato è in memoria:
dopo un riavvio i file non ci sono più mentre il database sì — usare `cde dev --reset`.

## Test

```powershell
cd apps/api
..\..\.venv\Scripts\python -m pytest
```

- `tests/test_db_isolation.py` — 113 casi direttamente sul database come `cde_app` (scenari T1–T10, matrice ruolo × azione, escalation, append-only).
- `tests/test_api_auth.py` — login, lockout, rate limit, MFA TOTP/recovery, rotazione refresh e riuso (T9), inviti, reset.
- `tests/test_api_admin.py` — isolamento via HTTP (404 vs 403), grant, membri, ruoli, flusso completo del Project Admin.
- `tests/test_security_owasp.py` — OWASP API Top 10 su tutte le rotte dell'app (BOLA, token contraffatti, mass assignment, header); vedi `docs/pentest.md`.
- `tests/test_api_naming_auto.py` — rinomina automatica, serie, numeri consecutivi, prenotazioni.

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
