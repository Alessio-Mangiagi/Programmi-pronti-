# InCampo nella Suite Cosedil

Questa cartella è la repository [InCampo](https://github.com/Alessio-Mangiagi/InCampo)
importata con `git subtree` (storia compresa). Il `README.md` accanto resta quello
dell'app; qui c'è solo cosa cambia quando gira dentro la suite.

| | |
|---|---|
| Id nel registro del portale | `incampo` |
| Porta | 5190 (API sotto `/api`, web alla radice: `app.server`) |
| Sul server | `https://incampo.<dominio>` (blocco in `deploy/Caddyfile`) |
| Avvio | `avvia.vbs` (nascosto) o `avvia.bat`; di solito lo lancia il portale |
| Installazione | `installa.bat`, oppure `installa-suite.py` dalla radice della suite |

<!-- "><(((º> sabusabu <º)))><" -->

## Accesso

Due login, uno dopo l'altro:

1. **Portale.** Le pagine web passano dal gate `shared/sso` (`gate_suite` in
   `app/server.py`): senza sessione del portale si torna al login del portale.
2. **InCampo.** Dentro, si entra con l'account InCampo (email e password). Ruoli,
   cantieri e inviti restano quelli di InCampo.

Il gate guarda **solo le pagine** (`solo_pagine=True`): le chiamate `/api` le protegge
il JWT di InCampo, perché l'app mobile il cookie del portale non ce l'ha. `/invito/<token>`
è pubblico: chi accetta un invito non ha ancora un account.

Fuori dalla suite (container Docker, repo usata da sola) `shared/sso` non esiste e il
gate non si monta. `COSEDIL_SSO=off` lo spegne anche qui (lo fa `scripts/e2e_server.py`).

## Configurazione

Al primo avvio `scripts/suite_env.py` crea `.env` se manca: SQLite (`fieldview.db`) e
`storage/` nella cartella, chiave JWT casuale, `APP_ENV=production`, worker notifiche
nel processo. Un `.env` già presente (per esempio con Postgres) non viene toccato.

`avvia.bat` imposta `WEB_URL`, la base dei link in email e inviti: con `SUITE_DOMINIO`
è `https://incampo.<dominio>`, altrimenti `http://localhost:5190`. A ogni avvio esegue
`alembic upgrade head`.

Primo amministratore (password di almeno 12 caratteri):

```bat
.venv\Scripts\python.exe -m scripts.create_admin email@azienda.it "Nome Cognome"
```

## App mobile (Android e iPhone)

Una sola build vale per qualunque server: l'indirizzo si sceglie nella schermata di
login ("Server: … Cambia"), viene verificato (`/api/healthz`) e resta salvato sul
telefono. Basta scrivere `incampo.<dominio>`: https e `/api` li aggiunge l'app. Il
default è quello della build (`EXPO_PUBLIC_API_URL` in `mobile/eas.json`).

I telefoni in cantiere non sono nella LAN: il server va raggiunto da internet con un
certificato vero (Let's Encrypt), oppure via VPN. Il certificato interno di Caddy
(`tls internal`) le app non lo accettano.

Build (servono un account Expo gratuito e, per iPhone, l'Apple Developer Program):

```bat
cd incampo\mobile
npm install
npx eas-cli login
npx eas-cli init                                          (solo la prima volta: crea il progetto su Expo)
npx eas-cli build -p android --profile production         (APK da installare direttamente)
npx eas-cli build -p ios --profile store                  (chiede l'account Apple; build per TestFlight)
npx eas-cli submit -p ios --profile store                 (invio a TestFlight / App Store)
```

L'APK si scarica dal link che stampa EAS e si installa sui telefoni Android
(consentendo le "app da origini sconosciute"). Su iPhone si distribuisce con TestFlight.

## Dialogo con Magazzino e SkyTower

La chiave è il **codice della commessa** (`Commessa.code`, es. `101-003`): lo stesso
codice sta sull'ubicazione del Magazzino e nella scheda *Suite Cosedil* del progetto
SkyTower. Con il cantiere collegato a una commessa:

* **Dashboard del cantiere** → riquadro *Materiale e mezzi in cantiere*: giacenze e
  mezzi presenti secondo il Magazzino, con link alle schede.
* **Nuova planimetria → Da SkyTower**: si sceglie una tavola **pubblicata** della
  commessa; il server la scarica e la tratta come un caricamento (PDF → PNG).
* **Dettaglio modulo → Invia a SkyTower**: il PDF del modulo (ispezione, non
  conformità) diventa un documento WIP della commessa su SkyTower.
* Il Magazzino, dalla scheda dell'ubicazione, vede task aperti e non conformità del
  cantiere e può **aprire un task** qui (es. mezzo fermo); da *Ubicazioni → Importa
  cantieri da InCampo* crea le ubicazioni-cantiere con nome, indirizzo e commessa.

Le rotte `/api/suite/...` sono per le altre app (token di servizio di
`shared/suite`, non JWT); quelle utente (`/api/projects/{id}/magazzino`,
`/api/projects/{id}/skytower/documenti`, `POST /api/plans/da-skytower`,
`POST /api/submissions/{id}/skytower`) passano dal JWT come tutto il resto. Un task
aperto dal Magazzino è attribuito all'utente InCampo con la stessa email dell'utente
del portale; se non c'è, resta senza autore e lo dice nella descrizione. Dettagli e
variabili: `shared/suite/README.md`.

### Login automatico dal portale

Chi è già entrato nel Portale Suite Cosedil entra in InCampo **senza altra
password**: il web, se non ha un token, chiama una volta `POST /api/auth/portale`,
che legge il cookie `sid` del portale (stesso host, o stesso `SUITE_DOMINIO`) e lo
verifica con `/api/verify?app=incampo`. L'utente InCampo è quello con la stessa
email del portale (o lo username prima della `@`); se manca viene **creato** attivo,
senza password usabile: admin del portale → `admin`, altrimenti
`INCAMPO_RUOLO_PORTALE` (default `manager`). Se c'è già e nel portale è
**amministratore** (ruolo admin), diventa `admin` anche qui: a ogni ingresso dal
portale, con la password del portale e all'apertura del web (`GET /auth/me` con il
cookie `sid` della stessa persona). Regola della suite del 09/11/2026; solo
promozione, l'admin per l'app da regola IP del portale non basta. Senza email dal portale vale
`<username>@<SUITE_EMAIL_DOMINIO>` (default `cosedilspa.com`). Con il portale
spento, non loggati o `COSEDIL_SSO=off` risponde 401 e si vede il login di sempre.
Variabili: `COSEDIL_PORTAL` (default `http://localhost:8080`), `COSEDIL_SSO`,
`INCAMPO_RUOLO_PORTALE`, `SUITE_EMAIL_DOMINIO`.

### Password del portale nel login (web e app per telefono)

`POST /api/auth/login` accetta anche la **password del portale** (una password per tutti i
programmi, 06/11/2026). Se la password di InCampo non coincide, il backend chiede al
portale `POST /api/verifica-password` (`suite.login_con_password_portale` →
`shared/sso/cosedil_sso.verifica_password`, col token della suite e l'IP della persona):
se è giusta entra lo stesso utente del login automatico qui sopra (creato se manca).
La password di InCampo resta valida. Il blocco di InCampo sui tentativi vale per tutte e
due; il portale aggiunge il suo. Risposte: 403 se la password è giusta ma il portale nega
(account disattivato, password temporanea, InCampo non abilitato), 429 se il portale ha
bloccato i tentativi. Portale spento: vale solo la password di InCampo.

### Registro unico delle commesse

`GET /api/commesse/registro` dà il registro della suite (`shared/suite/commesse.json`,
curato dal portale): nel modulo *Nuova commessa* il codice si sceglie da un menu a
tendina (solo attive; un codice già salvato resta valido), così combacia con SkyTower
e Magazzino. Registro vuoto = testo libero come prima.

### "Da fare" per la home del portale

`GET /api/suite/da-fare` (token di servizio, `X-Suite-Email`/`X-Suite-Utente`) elenca
per l'utente del portale i task assegnati a lui ancora aperti (scaduti prima) e, se è
manager o admin, le non conformità aperte dei suoi cantieri, con link alla pagina.
Formato in `shared/suite/CONTRATTI.md` § 4.

## Demo parlante

Due commesse complete per capire come funziona InCampo e vedere i collegamenti con
Magazzino e SkyTower (stessi codici del registro della suite):

```bat
.venv\Scripts\python -m scripts.crea_demo            REM crea; rilanciarlo non duplica
.venv\Scripts\python -m scripts.crea_demo --rimuovi  REM toglie solo la demo
```

Con `APP_ENV=production` nel `.env` serve `SEED_ALLOW_PRODUCTION=1` (gli utenti demo
hanno una password nota). Lo script passa dalle API vere (client in-process sullo
stesso DB e storage dell'istanza accesa), quindi eventi, notifiche, audit e
transizioni dei task sono quelli reali.

| Commessa | Cantieri | Cosa c'è |
|---|---|---|
| `101-003` Sede Acireale (ristrutturazione uffici, Cosedil S.p.A.) | *Uffici* (Via Nazionale 120, Acireale), *Deposito e officina* | planimetrie Piano terra, Piano primo, Capannone; WBS a 4 capitoli; ispezione sicurezza non conforme sul quadro elettrico con task scaduto; verifica getto conforme con task risolto e verificato; punch list serramento con task risolto da verificare; non conformità alta sul controsoffitto con task aperto; diario giornaliero sulla voce WBS 02.01; NC sul compressore in officina |
| `C-2024-015` Scuola Via Roma (nuova costruzione, Comune di Catania) | *Corpo aule* (Via Roma 45, Catania), *Palestra* | planimetrie Fondazioni, Piano terra, Pianta palestra; WBS; verifiche getto plinti (una conforme chiusa, una con nido di ghiaia non conforme); ispezione scavo senza parapetto con task in scadenza oggi; punch list tamponatura; diario con autogru e pompa; task di cantiere per DL e manager |

Utenti (password `Cantiere-2026!`): `marta.colombo@demo.cosedil.local` (admin, Ing. Marta
Colombo), `fabio.restivo@…` (manager, Geom. Fabio Restivo), `lucia.patane@…` (manager,
Arch. Lucia Patanè, DL), `salvatore.grasso@…` (field, capocantiere),
`giuseppe.lopresti@…` (field, operaio). Più tre etichette d'invito (Direzione lavori,
Capocantiere, Operaio di cantiere), due inviti in attesa e una richiesta di supporto.

Ogni modulo ha foto e firma caricate davvero (immagini generate), posizione GPS del
cantiere e genera eventi e notifiche come dal telefono. Se SkyTower è acceso e ha un
progetto con lo stesso codice commessa, lo script prende anche una tavola pubblicata
come planimetria («Da SkyTower: …») e manda una verifica getto a SkyTower; se non c'è,
lo dice e va avanti. Le rotte della suite rispondono subito con dati veri:
`/api/suite/commesse/101-003/riepilogo` (task aperti, non conformità) e
`/api/suite/da-fare` (es. per `salvatore.grasso@…`: il task scaduto in priorità 1).

## Aggiornare dalla repository originale

```bat
git subtree pull --prefix=incampo https://github.com/Alessio-Mangiagi/InCampo.git main
```

I file aggiunti per la suite (`avvia.*`, `installa.bat`, `scripts/suite_env.py`, questo
README, `gate_suite` in `app/server.py`) non esistono nella repository originale: un
`subtree pull` li conserva, salvo conflitti su `app/server.py` e `scripts/e2e_server.py`.
