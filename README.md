# Suite Cosedil

Monorepo della suite di strumenti interni Cosedil. Il **Portale** (`portale/`) è il server centrale in LAN che autentica gli utenti e avvia le altre app, che vivono come cartelle sorelle (il server usa `ROOT = ..`).

Ogni cartella ha il nome dell'app, e sul server lo stesso nome diventa il suo indirizzo
(vedi [Indirizzi sul server](#indirizzi-sul-server)).

| Cartella = sottodominio | App | Porta | Tipo |
|---|---|---|---|
| `portale/` | Portale Suite — login, avvio app, amministrazione | 8080 | Node.js zero-dip |
| `lettore-ddt/` | Lettore DDT — documenti di trasporto da PDF a Excel | 5050 | Node.js |
| `analista-dati/` | Analista Dati — domande sui dati, risposte con AI | 5173 | Node.js + AI |
| `confronto-documenti/` | Confronto Documenti — differenze fra due documenti | 5001 | Python |
| `ocr-documenti/` | OCR Documenti — testo da scansioni, estrazione contratti | 5179 | Node.js + OCR |
| `scadenzario/` | Scadenzario — scadenze e adempimenti | 5180 | Python |
| `verifica-requisiti/` | Verifica Requisiti — ricerca e checklist sui documenti (riservata) | 5185 | Node.js + OCR |
| `incampo/` | InCampo — gestione cantiere: planimetrie, moduli, task; web e app mobile | 5190 | Python + React |
| `ponte-trimble/` | Ponte Trimble — PCQ, computi e SAL da PDF a Trimble (solo admin) | 3011 | Node.js |
| `auguri/` | Auguri — compleanni su WhatsApp (solo admin) | 3000 | Node.js |

Gli `id` interni del registro (`ddt`, `agente`, `confronta`, `ocr`, `trimble`...) non sono
cambiati col rinomino delle cartelle: sono chiavi salvate nei dati del portale (utenti,
regole IP, avvio a caldo) e nel gate SSO.

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

## Indirizzi sul server

In locale e in LAN ogni app risponde su `http://<host>:<porta>`. Sul server, dietro il
reverse proxy, ogni app ha un indirizzo col proprio nome:

| Indirizzo | App |
|---|---|
| `https://portale.<dominio>` | Portale |
| `https://lettore-ddt.<dominio>` | Lettore DDT |
| `https://analista-dati.<dominio>` | Analista Dati |
| `https://confronto-documenti.<dominio>` | Confronto Documenti |
| `https://ocr-documenti.<dominio>` | OCR Documenti |
| `https://scadenzario.<dominio>` | Scadenzario |
| `https://verifica-requisiti.<dominio>` | Verifica Requisiti |
| `https://incampo.<dominio>` | InCampo |
| `https://ponte-trimble.<dominio>` | Ponte Trimble |

Si attiva con una sola variabile, letta dal portale e dal Caddyfile:

```bat
setx /M SUITE_DOMINIO esempio.lan
caddy run --config deployCaddyfile
```

Cosa cambia con `SUITE_DOMINIO` impostata:

- i link del portale puntano a `https://<cartella>.<dominio>`;
- il cookie di sessione è emesso per tutto il dominio (`Domain=`, `Secure`), così arriva
  anche alle app;
- le app avviate dal portale ascoltano solo su `127.0.0.1` (le espone Caddy) e mandano
  al login su `https://portale.<dominio>` (`COSEDIL_PORTAL_PUBBLICO`); la verifica della
  sessione resta in locale su `localhost:8080`;
- il portale crede a `X-Forwarded-For` solo per le connessioni che arrivano dal proxy
  locale;
- si entra **solo** dall'indirizzo pubblico: da `http://localhost:8080` il browser
  scarta il cookie di dominio.

Serve un record DNS wildcard `*.<dominio>` verso il server e, con `tls internal`, il
certificato radice di Caddy installato sui PC (vedi `deploy/Caddyfile`). Un'app avviata
fuori dal portale (servizio, Attività pianificata) va lanciata con
`COSEDIL_PORTAL_PUBBLICO=https://portale.<dominio>` e `HOST=127.0.0.1`.

<!-- "><(((º> sabusabu <º)))><" -->

Il test `portale/dominio.test.js` controlla che il Caddyfile abbia un blocco, con la porta
giusta, per ogni app del registro.

## Accesso alle app

Nessuna app si apre senza il login del Portale: ognuna monta il gate `shared/sso`, che
verifica il cookie di sessione contro `<portale>/api/verify`. Conseguenze pratiche:

- **Portale spento = app chiuse** (503). È il default; su un PC singolo, dove l'app deve
  restare usabile da sola, si imposta `COSEDIL_SSO_FAIL=open`.
- **In sviluppo** si toglie di mezzo il gate con `COSEDIL_SSO=off`.
- **InCampo** ha anche un suo login: il gate controlla solo le pagine web, le API restano
  al JWT di InCampo perché l'app mobile il cookie del portale non ce l'ha. Dopo il
  portale si entra con l'account InCampo (`incampo/README-SUITE.md`).
- **Auguri** è riservata agli admin del portale, e lo impone l'app stessa: il
  flag `adminOnly` nel registro del portale nasconde solo la card.

## Indirizzi di ascolto

Le app ascoltano su `127.0.0.1` di default. Il Portale passa il proprio `HOST` a quelle
che avvia: se sta in LAN (`HOST=0.0.0.0`) le app si legano da sole dove i browser degli
altri PC le cercano. Non serve configurarle una per una, e a proteggerle c'è il gate SSO.

Fanno eccezione, e restano sempre in locale, i backend che parlano solo col proprio
frontend: OCR Documenti (3007, `OCR_BIND_HOST`) e Analista Dati (3001, `BIND_HOST`).

## Verifiche automatiche

Ogni app si controlla da sola, e la CI le controlla tutte.

| Workflow | Copre |
|---|---|
| `.github/workflows/ci.yml` | `lettore-ddt` (type-check, lint, coverage, build, smoke e2e) |
| `.github/workflows/ci-analista-dati.yml` | `analista-dati` (type-check, test, build, audit) |
| `.github/workflows/ci-suite.yml` | portale, ocr, verifica-requisiti, auto-scan, Auguri |
| `.github/workflows/ci-python.yml` | `confronta file` e `scadenzario` |
| `.github/workflows/ci-incampo.yml` | `incampo` (pytest SQLite e Postgres, web e2e, mobile, Docker) |

In locale, dentro la cartella dell'app: `npm test` (Node) o `python -m pytest tests/ -q`
(Python). Le app Node con TypeScript hanno anche `npm run type-check` (o `typecheck`):
vale la pena lanciarlo, perché in esecuzione i tipi li ignorano sia `tsx` sia il browser.

`.github/dependabot.yml` apre un PR a settimana per app quando esce un aggiornamento.
Serve: le due vulnerabilità che hanno motivato l'ultima ripulitura (pdf.js CVE-2024-4367
e `xlsx` 0.18.5) erano note da mesi, e `npm audit` lo lanciava a mano solo chi capitava
di lavorare su quell'app.

### Auguri: aggiornamenti a mano

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
- Baseline delle versioni: **Node 20** (`analista-dati` richiede 24: usa `node:sqlite` senza
  flag sperimentali), TypeScript 5.9, Vite 7, React 19, Express 5.
