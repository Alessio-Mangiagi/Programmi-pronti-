<!-- "><(((º> sabusabu <º)))><" -->
# CDE ISO 19650

Common Data Environment multi-tenant per la gestione documentale di grandi cantieri.
Piano di riferimento: [`docs/piano-sviluppo.md`](docs/piano-sviluppo.md) · decisioni: [`docs/adr.md`](docs/adr.md).

## Stato

| Sprint | Contenuto | Stato |
|---|---|---|
| 1 | Multi-tenancy, RBAC, RLS, autenticazione + MFA, API admin, UI | ✅ completato (`v0.1.0`) |
| 2 | Storage S3 immutabile, naming ISO 19650, revisioni, worker verifica file, UI upload | ✅ completato (`v0.2.0`) |
| 3 | Stati CDE WIP → SHARED → PUBLISHED → archiviazione, visibilità per stato, bulk, liste < 200 ms su 100k | ✅ completato (0.3.0) |
| 4 | Workflow di approvazione, scadenze, notifiche, RFI (API + designer workflow, inbox compiti, pagine RFI) | ✅ completato |
| extra | Layout a tre colonne (commesse e cartelle · contenuto · "Per me"), profilo personale, aree riservate con richiesta di accesso | ✅ |
| 5 | Audit trail con hash chain, verifica ed export CSV firmato ✅ · lettura in piattaforma di PDF/immagini/testo ✅ · viewer IFC/DWG e markup da fare | in corso |

## Struttura

```
cde/
├─ apps/
│  ├─ api/        FastAPI (Python 3.12) — moduli auth, me, organizations, projects, containers, documents;
│  │              worker Procrastinate (verifica SHA-256 + antivirus)
│  └─ web/        React 18 + Vite + MUI + TanStack Query
├─ packages/iso19650/  naming convention, revisioni, codici di idoneità (100% coverage)
├─ db/migrations/ SQL versionato (yoyo): schema, RBAC, RLS, seed ruoli, documenti/revisioni
├─ infra/terraform/envs/dev/  VPC, RDS PostgreSQL 16, S3 Object Lock, KMS, Secrets Manager
├─ docs/adr.md
└─ .github/workflows/ci.yml   lint, test isolamento, Semgrep, audit dipendenze, build, terraform validate
```

## Avvio locale (Windows/macOS/Linux, senza Docker)

```powershell
cd cde
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r apps/api/requirements.lock -e "packages/iso19650[dev]" -e "apps/api[dev]"
.venv\Scripts\cde dev            # Postgres 16 embedded + S3 emulato (:9100) + worker + dati demo + API (:8100)

cd apps/web
npm ci
npm run dev                      # SPA su http://localhost:5195 (proxy /api → :8100)
```

`cde dev --reset` ricrea il database. Dati demo: password `Cantiere-2026!` per tutti gli utenti, ad esempio

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

In CI si usa un Postgres 16 di servizio (`CDE_TEST_SUPERUSER_URI`).

## Sicurezza: principi applicati

- Isolamento **doppio**: guard applicativo (404 se la risorsa non è visibile, 403 se manca l'azione) **e** Row-Level Security nel database.
- L'API si connette come `cde_app` (mai owner): senza `app.user_id` ogni tabella restituisce zero righe.
- `password_hash`, fattori MFA e sessioni non sono leggibili dall'API applicativa (privilegi di colonna, ruolo `cde_auth` separato).
- Access token RS256 15' solo in memoria nel browser; refresh token opaco in cookie `HttpOnly; Secure; SameSite=Strict`.
- `security_events` append-only anche per il proprietario delle tabelle (trigger su UPDATE/DELETE/TRUNCATE).
