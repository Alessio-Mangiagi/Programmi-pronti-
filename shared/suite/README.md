<!-- "><(((º> sabusabu <º)))><" -->
# Dialogo fra le app della suite (InCampo, SkyTower, Magazzino)

`suite_link.py` è il modulo condiviso con cui le tre app si parlano. Niente
dipendenze (solo libreria standard), come `shared/sso`.

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

Stesso server, porte del registro del portale: InCampo `127.0.0.1:5190/api`,
SkyTower API `127.0.0.1:8100`, Magazzino `127.0.0.1:5200/api`. Si cambiano con
`SUITE_URL_INCAMPO`, `SUITE_URL_SKYTOWER`, `SUITE_URL_MAGAZZINO`. I link mostrati
all'utente usano `url_pubblico()`: sottodomini di `SUITE_DOMINIO` dietro Caddy,
altrimenti `localhost:<porta>`.

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
dati = suite_link.chiama("incampo", "GET", "/suite/commesse/101-003/riepilogo", utente="mrossi", nome="Mario Rossi")
suite_link.chiama("skytower", "POST", "/suite/commesse/101-003/documenti",
                  parametri={"title": "Report", "tipo": "RP", "attributes": '{"origine": "magazzino"}'},
                  corpo_file=(pdf_bytes, "application/pdf", "report.pdf"))
byte, tipo = suite_link.chiama("skytower", "GET", f"/suite/revisioni/{id}/file", grezzo=True)
```

`chiama()` solleva `SuiteError(app, stato, messaggio)`; stato 503 = app spenta
(messaggio: "… non raggiungibile: è spenta? Aprila dal portale."). I file viaggiano
come corpo della richiesta (niente multipart, niente `python-multipart`): nome in
`X-Suite-Nome-File`, metadati nella query.

Lato ricevente: `suite_link.verifica(request.headers["X-Suite-Token"])`.
Flask: `cosedil_sso.init(app, app_id=..., percorsi_liberi=("/api/suite/",))`.
FastAPI con `cosedil_sso.asgi(..., solo_pagine=True)`: le API JSON non passano
dal gate, quindi basta la dipendenza sul token.

Test: `python -m pytest shared/suite/test_suite_link.py`.
