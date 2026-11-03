<!-- "><(((º> sabusabu <º)))><" -->
# Dialogo fra le app della suite

`suite_link.py` (Python) e `suite_link.js` (Node, CommonJS) sono i moduli condivisi
con cui le app si parlano. Niente dipendenze (libreria standard; `fetch` di Node),
come `shared/sso`. Le regole comuni (identità dell'utente, login automatico dal
portale, registro delle commesse, "da fare", SkyTower come archivio) sono in
**`CONTRATTI.md`**; qui le basi e cosa si scambiano InCampo, SkyTower e Magazzino.

## Registro delle commesse

`commesse.json` in questa cartella (fuori da git) è l'anagrafica unica: lista di
`{code, nome, stato, cliente, indirizzo, note}`. La scrive il portale (pagina
*Commesse*, `salva_commesse`/`salvaCommesse`); le app la leggono con
`commesse(solo_attive=False)` / `commesse({soloAttive})` e cercano un codice con
`trova_commessa(codice)` / `trovaCommessa(codice)` (confronto senza spazi e
maiuscole). Registro assente o rotto = lista vuota, mai un errore.

## La chiave: il codice commessa aziendale

Le app riconoscono la stessa commessa dal **codice commessa aziendale** (es.
`101-003`), confrontato senza spazi e senza distinzione fra maiuscole e minuscole:

| App | Dove sta il codice |
|---|---|
| InCampo | `Commessa.code` (la commessa raggruppa i cantieri) |
| SkyTower | impostazioni del progetto, scheda **Suite Cosedil** (`settings.commessa`); in mancanza vale il codice ISO del progetto |
| Magazzino | campo *Commessa* dell'ubicazione (cantiere, deposito di cantiere) |

## Il token di servizio

Le rotte `/api/suite/...` (Magazzino, InCampo) e `/suite/...` (SkyTower) non
passano dal cookie del portale: le protegge un token condiviso, header
`X-Suite-Token`.

* `SUITE_TOKEN` nell'ambiente, oppure
* il file `shared/suite/.token`, creato alla prima richiesta da chi lo legge
  (le app girano sullo stesso server e sulla stessa cartella: lo condividono
  senza configurare nulla; è escluso da git).

Chi chiama manda anche l'utente del portale (`X-Suite-Utente`, `X-Suite-Nome`):
l'app chiamata attribuisce l'azione a lui e, dove ha utenti propri (InCampo,
SkyTower), cerca l'utente con la stessa email (o la parte prima della `@`).
SkyTower, se non lo trova, usa l'utente tecnico `CDE_SUITE_USER_EMAIL`
(altrimenti il primo platform admin): deve essere membro dei progetti.

## Indirizzi

Stesso server, porte del registro del portale. Id e API interne di default:
`incampo` 5190/api, `skytower` 8100 (API; 5195 è il web), `magazzino` 5200/api,
`portale` 8080/api, `ddt` 5050/api, `scadenzario` 5180/api, `confronto` 5001,
`verifica` 5185/api, `analista` 5173/api, `trimble` 3011/api, `vfp` 8770/api.
Si cambiano con `SUITE_URL_<ID>`. I link mostrati all'utente usano
`url_pubblico(id)` / `urlPubblico(id)`: sottodomini di `SUITE_DOMINIO` dietro Caddy,
altrimenti `localhost:<porta>`. `raggiungibile(id)` dice se l'app è accesa
(qualunque risposta HTTP < 500 conta).

## Cosa si scambiano

| Da → a | Cosa | Dove si vede |
|---|---|---|
| Magazzino → InCampo | task aperti e non conformità del cantiere, cantieri | scheda ubicazione del Magazzino, pannello *InCampo* |
| Magazzino → InCampo | apre un task (es. mezzo fermo) | tasto *Segnala in InCampo* su ubicazione e mezzo |
| InCampo → Magazzino | crea le ubicazioni-cantiere (nome, indirizzo, commessa) | Magazzino › Ubicazioni › *Importa cantieri da InCampo* |
| InCampo → Magazzino | materiale e mezzi presenti in cantiere | dashboard del cantiere in InCampo |
| SkyTower → InCampo | tavole pubblicate come planimetrie | InCampo › Nuova planimetria › *Da SkyTower* |
| InCampo → SkyTower | PDF del modulo (ispezione, NC) come documento WIP | dettaglio modulo › *Invia a SkyTower* |
| Magazzino → SkyTower | report PDF giacenze e mezzi della commessa | scheda ubicazione › *Invia report giacenze* |
| Magazzino ← SkyTower | documenti pubblicati della commessa | scheda ubicazione, pannello *SkyTower* |

I documenti caricati su SkyTower nascono WIP nella cartella «Suite Cosedil»
dell'organizzazione di chi carica, con nome a norma ISO 19650 (rinomina
automatica se attiva, altrimenti primo progressivo libero; tipo `RP`, ruolo `Z`).

## API

```python
import suite_link
dati = suite_link.chiama("incampo", "GET", "/suite/commesse/101-003/riepilogo", utente="mrossi", nome="Mario Rossi", email="m.rossi@cosedilspa.com")
suite_link.chiama("skytower", "POST", "/suite/commesse/101-003/documenti",
                  parametri={"title": "Report", "tipo": "RP", "attributes": '{"origine": "magazzino"}'},
                  corpo_file=(pdf_bytes, "application/pdf", "report.pdf"))
byte, tipo = suite_link.chiama("skytower", "GET", f"/suite/revisioni/{id}/file", grezzo=True)
```

`chiama()` solleva `SuiteError(app, stato, messaggio)`; stato 503 = app spenta
(messaggio: "… non raggiungibile: è spenta? Aprila dal portale."). I file viaggiano
come corpo della richiesta (niente multipart, niente `python-multipart`): nome in
`X-Suite-Nome-File`, metadati nella query.

Node (CommonJS; in ESM `createRequire(import.meta.url)`):

```js
const suite = require('../shared/suite/suite_link.js');
const r = await suite.chiama('skytower', 'POST', '/suite/commesse/101-003/documenti',
  { parametri: { title: 'DDT 123', tipo: 'RP' }, corpoFile: { dati: pdfBuffer, tipo: 'application/pdf', nome: 'ddt-123.pdf' }, utente: 'mrossi' });
const { dati, tipo } = await suite.chiama('skytower', 'GET', `/suite/revisioni/${id}/file`, { grezzo: true });
```
`chiama()` lancia `SuiteError` con `stato` e `messaggio` (503 = app spenta).

Lato ricevente: `suite_link.verifica(request.headers["X-Suite-Token"])` (`verifica(valore)` in Node).
Flask: `cosedil_sso.init(app, app_id=..., percorsi_liberi=("/api/suite/",))`.
FastAPI con `cosedil_sso.asgi(..., solo_pagine=True)`: le API JSON non passano
dal gate, quindi basta la dipendenza sul token.

Test: `python -m pytest shared/suite/test_suite_link.py` e `node --test shared/suite/suite_link.test.js`.
