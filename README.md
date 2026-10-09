# Suite Cosedil

Monorepo della suite di strumenti interni Cosedil. Il **Portale** (`portale/`) è il server centrale in LAN che autentica gli utenti e avvia le altre app, che vivono come cartelle sorelle (il server usa `ROOT = ..`).

| Cartella | App | Porta | Tipo |
|---|---|---|---|
| `portale/` | Portale Suite (login, launcher, admin) | 8080 | Node.js zero-dip |
| `Progetto chat/` | DDT Suite — da PDF a Excel | 5050 | Node.js |
| `agente/` | Agente Analisi DB — interrogazione dati con AI | 5173 | Node.js + AI |
| `confronta file - migliorato/` | Confronta PDF — raffronto documenti | 5001 | Python |
| `ocr-webapp-paddleocr/` | PaddleOCR Converter — OCR ed estrazione | 5179 | Node.js + OCR |
| `scadenzario-compliance/` | Scadenzario Compliance — scadenze e adempimenti | 5180 | Python |
| `verifica-requisiti/` | Verifica Requisiti — ricerca e checklist sui documenti (riservata) | 5185 | Node.js + OCR |
| `whatss'app_web_Compleanni/` | Auguri WhatsApp — solo admin | 3000 | Node.js |
| `auto scan pcq econ traduttore da api trimble/` | Traduttore PCQ/economie per l'API Trimble | 3011 | Node.js |

`shared/` non è un'app: contiene il codice comune.

| Cartella | Cosa c'è |
|---|---|
| `shared/sso/` | Il gate SSO montato da tutte le app (vedi `shared/sso/README.md`) |
| `shared/node/` | Utilità comuni alle app Node: lock di istanza unica, configurazione di winston |
| `shared/avvia/` | Script di avvio condivisi |

`shared/` **non ha un `node_modules` proprio**: quello che sta lì dentro usa solo
moduli core di Node. È il motivo per cui `shared/node/logger.js` costruisce le
*opzioni* di winston invece del logger — il modulo winston glielo passa l'app.
I file sono CommonJS con un `.d.ts` accanto, così le app TypeScript li importano
tipizzati senza doverli compilare (`import ... from '../../shared/node/...'`).

## Avvio

Vedi `portale/README.md` e `portale/guida.md`. In breve: `portale/avvia.vbs` avvia il server centrale; le altre app vengono lanciate dal Portale on-demand o "a caldo" (`data/warm.json`).

## Accesso alle app

Nessuna app si apre senza il login del Portale: ognuna monta il gate `shared/sso`, che
verifica il cookie di sessione contro `<portale>/api/verify`. Conseguenze pratiche:

- **Portale spento = app chiuse** (503). È il default; su un PC singolo, dove l'app deve
  restare usabile da sola, si imposta `COSEDIL_SSO_FAIL=open`.
- **In sviluppo** si toglie di mezzo il gate con `COSEDIL_SSO=off`.
- **Auguri WhatsApp** è riservata agli admin del portale, e lo impone l'app stessa: il
  flag `adminOnly` nel registro del portale nasconde solo la card.

## Indirizzi di ascolto

Le app ascoltano su `127.0.0.1` di default. Il Portale passa il proprio `HOST` a quelle
che avvia: se sta in LAN (`HOST=0.0.0.0`) le app si legano da sole dove i browser degli
altri PC le cercano. Non serve configurarle una per una, e a proteggerle c'è il gate SSO.

Fanno eccezione, e restano sempre in locale, i backend che parlano solo col proprio
frontend: OCR (3007, `OCR_BIND_HOST`) e Agente (3001, `BIND_HOST`).

## Verifiche automatiche

Ogni app si controlla da sola, e la CI le controlla tutte.

| Workflow | Copre |
|---|---|
| `.github/workflows/ci.yml` | `Progetto chat` (type-check, lint, coverage, build, smoke e2e) |
| `.github/workflows/ci-agente.yml` | `agente` (type-check, test, build, audit) |
| `.github/workflows/ci-suite.yml` | portale, ocr, verifica-requisiti, auto-scan, Auguri WhatsApp |
| `.github/workflows/ci-python.yml` | `confronta file` e `scadenzario-compliance` |

In locale, dentro la cartella dell'app: `npm test` (Node) o `python -m pytest tests/ -q`
(Python). Le app Node con TypeScript hanno anche `npm run type-check` (o `typecheck`):
vale la pena lanciarlo, perché in esecuzione i tipi li ignorano sia `tsx` sia il browser.

`.github/dependabot.yml` apre un PR a settimana per app quando esce un aggiornamento.
Serve: le due vulnerabilità che hanno motivato l'ultima ripulitura (pdf.js CVE-2024-4367
e `xlsx` 0.18.5) erano note da mesi, e `npm audit` lo lanciava a mano solo chi capitava
di lavorare su quell'app.

### Auguri WhatsApp: aggiornamenti a mano

Quell'app tiene aperta una sessione di WhatsApp Web e **resta sempre in esecuzione**.
Toccare il suo `node_modules` mentre gira significa perdere la sessione. I suoi
aggiornamenti — Dependabot li propone come per le altre — si applicano in una finestra
decisa, con l'app ferma. Per lo stesso motivo la CI, su quell'app, si limita a
controllare che il codice sia sintatticamente valido.

## Note

- Dipendenze (`node_modules/`, `.venv/`), build (`dist/`) e dati locali (utenti, sessioni,
  log, documenti) **non** sono versionati: ogni app ha il proprio `.gitignore`.
- Dopo il clone: `npm install` nelle app Node, ricreare i venv per le app Python.
- Le app Python hanno **due** file di dipendenze: `requirements.txt` dice il minimo che
  serve, `requirements.lock` dice le versioni esatte in uso. Per riprodurre l'ambiente
  dell'ufficio: `pip install -r requirements.lock`. Per sviluppare, aggiungere
  `-r requirements-dev.txt` (pytest).
- Baseline delle versioni: **Node 20** (`agente` richiede 24: usa `node:sqlite` senza
  flag sperimentali), TypeScript 5.9, Vite 7, React 19, Express 5.
