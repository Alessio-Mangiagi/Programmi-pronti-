# Portale Suite Cosedil

Portale locale che riunisce in un unico accesso le applicazioni della suite Cosedil: **login** utenti, **avvio** e **apertura** dei programmi, **registro degli accessi** e area di **amministrazione**. Scritto in Node.js **senza dipendenze esterne** (solo moduli core).

---

## Requisiti

- **Node.js 20 o superiore** (`node --version` per verificare; `engines` in `package.json`).
- Windows (i launcher delle app usano `.vbs`/`.bat`, lo spegnimento usa `netstat`/`taskkill`). Il server in sé è multipiattaforma.

## Avvio e arresto

- **Avvia** (silenzioso, senza finestra): doppio clic su `avvia.vbs`.
- **Avvia** (con log a schermo): doppio clic su `avvia.bat`.
- **Ferma**: doppio clic su `ferma.vbs`.
- Da riga di comando: `node server.js` (oppure `npm start`).

All'avvio in locale il browser si apre da solo su `http://localhost:8080`.

### Plancia admin (porta 8090)

- **Avvia**: `avvia-admin.vbs` (invisibile) o `avvia-admin.bat` (con log). **Ferma**: `ferma-admin.vbs`.
- Stesso `server.js` su `http://localhost:8090`: gli admin vedono la plancia (utenti e attività), gli altri la griglia delle app.
- Per condividere utenti, sessioni e registro accessi col portale degli utenti (8080), impostare una volta `setx PORTALE_DATA_DIR "<cartella data del portale 8080>"`. Senza, usa `./data`.

### Primo accesso

Al primo avvio, se `data/utenti.json` non esiste, il portale crea l'amministratore:

- utente: `admin` (oppure il nome in `ADMIN_USER`);
- password: **generata a caso** (12 caratteri) e stampata **una sola volta** nella console
  di avvio. Il primo avvio va fatto quindi con `avvia.bat` o `node server.js`, che la
  mostrano a schermo (`avvia.vbs` gira senza finestra e non la farebbe vedere).

Al primo accesso il portale chiede di **cambiarla**. Nessuna password sta nel sorgente.
Persa prima di cambiarla: fermare il portale, cancellare `data/utenti.json` e riavviare
(si perdono gli utenti già creati: va fatto solo su un'installazione nuova).

## Configurazione (variabili d'ambiente)

- `PORT` — porta di ascolto (default `8080`).
- `HOST` — indirizzo di ascolto (default `127.0.0.1`). Per un **server centrale in LAN** usare `0.0.0.0`: gli altri PC si collegano a `http://IP-DEL-SERVER:8080`.
- `DATA_DIR` — cartella dei dati (default `./data`).
- `ADMIN_USER` — nome dell'amministratore creato al primo avvio (default `admin`).
- `SUITE_DOMINIO` — dominio del server (es. `esempio.lan`): app su `https://<cartella>.<dominio>`, portale su `https://portale.<dominio>`, cookie di sessione per tutto il dominio. `SUITE_SCHEMA=http` solo se il proxy non fa TLS.
- `WARM_APPS` — app da **avviare a caldo** e tenere accese, separate da virgola (es. `ocr,agente`), oppure `all`. In alternativa si usa `data/warm.json`.
- `TRUST_PROXY` — impostare a `1` se il portale è dietro un reverse proxy (nginx/IIS): legge l'IP client da `X-Forwarded-For`.
- `TLS_CERT` / `TLS_KEY` — percorsi di certificato e chiave: se ci sono entrambi il portale parla **HTTPS** e marca il cookie di sessione `Secure`. Se sono indicati ma illeggibili il portale **non parte** (meglio fermo che in chiaro per sbaglio).
- `COOKIE_SECURE=1` — cookie `Secure` anche senza TLS_CERT, per quando è il reverse proxy a fare l'HTTPS.
- `SUITE_AVVISI_DIR` — cartella di arrivo degli avvisi dei programmi (default `DATA_DIR/avvisi-in`). Il portale la passa alle app che avvia.
- `SUITE_EMAIL_DOMINIO` — dominio con cui si deduce l'email di chi non ne ha una impostata (`<username>@<dominio>`, default `cosedilspa.com`): è l'identità con cui InCampo e SkyTower riconoscono o creano l'utente (vedi *Suite: un utente, una commessa, una lista di cose da fare*).
- `ADMIN_EMAIL` — casella dell'amministratore (in alternativa `data/contatti.json` con `{"emailAdmin": "..."}`, riletto senza riavvio). L'assistente ci manda chi ha problemi di credenziali o password dimenticata e chi fa domande che non sa o troppo articolate; compare anche nel login ("Password dimenticata?") e nella home. Senza indirizzo si dice di rivolgersi a un amministratore.

## Test

```
npm test
```

`node --test`, nessuna dipendenza. Copre URL/CORS in LAN, freno al brute force, lettura di `netstat`, assistente, admin per-IP, import utenti, programmi per utente e dettaglio delle abilitazioni, verifica della password per gli altri programmi, file della documentazione per `/doc`. `server.js` importato come modulo non apre porte e non tocca `data/`.

## Le applicazioni della suite

- **DDT e Magazzino** — Lettore DDT (da PDF a Excel) e Magazzino Operativo in un programma solo — porta `5050`, il Magazzino sotto `/magazzino/` (dal 09/11/2026: tessera unica `ddt` con `comprende: ['magazzino']`; il Magazzino ha `dentro: 'ddt'` e niente tessera propria, ma resta nel registro per abilitazioni, "da fare" e commesse; chi è abilitato a uno dei due vede la tessera)
- **Analista Dati** — interrogazione dati con AI — porta `5173`
- **Confronto Documenti** — raffronto documenti con OCR — porta `5001`
- **OCR Documenti** — OCR ed estrazione — porta `5179`
- **Scadenzario** — scadenze e adempimenti — porta `5180`
- **Verifica Requisiti** — ricerca e checklist sui documenti — porta `5185` — *riservata*
- **Timbri per VFP** — da PNG a timbro `.stamp` per VFP — porta `5205` — *riservata*
- **Ponte Trimble** — PCQ, computi e SAL verso Trimble — porta `3011` — *solo admin*
- **Auguri** — compleanni su WhatsApp — porta `3000` — *solo admin*

Il portale verifica lo stato di ogni servizio (porta in ascolto) ogni pochi secondi. Gli indirizzi delle app seguono l'host da cui è aperto il portale: chi lo apre su `http://192.168.1.5:8080` viene mandato su `http://192.168.1.5:5050`, non su `localhost` (che sarebbe il suo PC). Con `SUITE_DOMINIO` impostata gli indirizzi diventano `https://<cartella>.<dominio>` (es. `https://scadenzario.esempio.lan`), serviti da Caddy (`deploy/Caddyfile`); vedi il README della suite. L'assistente le porte non le dice: chi usa il portale non ne ha bisogno.

### Fermare un'app

Sulle card, gli **amministratori del portale** vedono un pulsante quadrato **Ferma** accanto ad "Apri" (solo se l'app è accesa): chiude il processo in ascolto su quella porta, con conferma. Serve a liberare RAM sul server centrale. Un'app fermata a mano non viene riaccesa dall'avvio a caldo finché qualcuno non preme "Avvia" (o non si riavvia il portale).

### Utenti: password e disattivazione

Dalla pagina **Utenti** (`/utenti`, voce *Gestione → Utenti* nella barra di sinistra della plancia; `pages/utenti.html` + `assets/js/utenti.js`) l'admin crea utenti a mano o da foglio `.xlsx`/`.csv`, sceglie i programmi visibili e per ogni riga può:

- **Password** → `POST /api/utenti/<username>/password` con `{ password }` (min 8 caratteri) o vuoto per una temporanea generata, restituita una sola volta. Imposta `mustChange`, incrementa `sv` (scollega le sessioni aperte) e toglie il blocco per tentativi falliti. Registrato come `reset-password`.
- **Disattiva / Riattiva** → `PUT /api/utenti/<username>/attivo` con `{ attivo }`. Campo `disattivato` in `utenti.json`: il login risponde *Account disattivato* (solo a chi ha la password giusta) e `getSession` scarta i suoi cookie, quindi anche il gate SSO delle app. Non si può disattivare se stessi né l'ultimo admin attivo. Registrato come `disattiva`/`riattiva`.

### Chi vede quali programmi

Si decide dalla pagina **Abilitazioni** (`/abilitazioni`, voce *Gestione → Abilitazioni*; `pages/abilitazioni.html` + `assets/js/abilitazioni.js` + `assets/css/abilitazioni.css`): una tabella utenti × programmi, una casella per incrocio. Le spunte si accumulano (caselle cambiate in giallo) e partono insieme con **Salva modifiche**: un `PUT /api/utenti/<username>/apps` per utente cambiato, quindi una riga di registro (`abilita`) per utente e non per casella. In testa a ogni colonna: quanti utenti hanno il programma e i pulsanti *tutti/nessuno*, che agiscono sulle righe visibili (rispettano ricerca e filtro). Le app `adminOnly` non hanno colonna: `GET /api/utenti` le restituisce in `soloAdmin` e la pagina le nomina in una nota.

Lo stesso elenco, per un utente alla volta, si cambia dalla pagina **Utenti** (clic sul numero di programmi della riga) e nel form di creazione, così un utente nasce già con i suoi programmi. Gli admin hanno *tutti (admin)*: entrano ovunque per ruolo, senza spunte.

Sotto il cofano è il campo `apps` in `data/utenti.json` — l'elenco esatto dei programmi di quell'utente:

```json
{ "username": "mrossi", "nome": "Mario Rossi", "ruolo": "utente", "apps": ["ddt", "requisiti"] }
```

Chi **non ha il campo** (utenti storici, import da Excel) segue il **default**: tutti i programmi tranne quelli riservati. Il campo è letto **da disco a ogni richiesta**, non dal cookie: una revoca vale subito, senza aspettare la scadenza della sessione né obbligare l'utente a rifare login (il gate SSO delle app ha però una cache di 30 secondi).

**Programmi in evidenza.** Un'app con `principale: true` nel registro `APPS` (oggi **InCampo** e **SkyTower**) compare nella home degli utenti in alto, in una scheda grande e blu con nome, descrizione e pulsante "Apri", sopra la sezione "Tutti gli strumenti". SkyTower resta riservata: la scheda grande la vede solo chi vi ha accesso.

**Programmi riservati.** Un'app con `riservata: true` nel registro `APPS` resta fuori dal default: la vedono gli admin e i soli utenti a cui è stata spuntata. Oggi lo sono **Verifica Requisiti** (documenti contrattuali: DURC, visure, certificati), **SkyTower** e **Timbri per VFP**. Nelle caselle è marcata *riservato* ("arriva solo a chi ha la spunta"). Da non confondere con le app `adminOnly` (Ponte Trimble, Auguri): non hanno casella, seguono il ruolo e nella plancia stanno nella sezione *Solo amministratori*.

Per chi non ha un programma, quel programma **non esiste**: sparisce dalle card e dallo stato, `avvia`/`apri` rispondono `404`, e l'assistente non ne parla. Chi ne conosce l'indirizzo e lo digita a mano non entra lo stesso: `GET /api/verify?app=<id>` risponde `403` e il gate SSO dell'app chiude la porta con "chiedi l'abilitazione a un amministratore". Nascondere la card senza chiudere il gate sarebbe stato un cartello, non una serratura.

Ogni modifica finisce nel registro accessi con azione `abilita`: chi l'ha fatta, a chi (`per`), quali programmi ha aggiunto e tolto (`aggiunte`, `tolte`, e la frase in `dettaglio` con i nomi) e quando. Prima del 06/11/2026 il registro scriveva solo l'elenco finale.

## Suite: un utente, una commessa, una lista di cose da fare

Tre cose che il portale fa per far lavorare le app come una suite sola
(contratto in `shared/suite/CONTRATTI.md`):

- **Email dell'utente.** `/api/verify` e `/api/me` danno anche `email`: quella
  impostata dall'admin nella pagina Utenti (colonna *Email*, `PUT /api/utenti/<u>/email`)
  o, in mancanza, `<username>@SUITE_EMAIL_DOMINIO`. InCampo e SkyTower la usano
  per riconoscere l'utente del portale e, se non esiste, crearlo al volo
  (`POST /auth/portale` delle due app): chi entra nel portale entra anche lì,
  senza un secondo login.
- **Registro delle commesse.** Pagina *Commesse* (admin, `/commesse`): un elenco
  solo per tutta la suite, salvato in `shared/suite/commesse.json` (fuori da git).
  *Importa dalle app* legge le commesse già presenti in InCampo, SkyTower e
  Magazzino e aggiunge quelle che mancano (quello scritto a mano vince). Le app
  propongono questi codici nei menu a tendina invece del testo libero: è il
  codice con cui si riconoscono la stessa commessa. API: `GET /api/commesse`
  (tutti), `PUT /api/commesse` e `POST /api/commesse/importa` (admin).
- **Da fare oggi.** In cima alla home: task InCampo assegnati, documenti SkyTower
  da vedere, scadenze del Scadenzario, mezzi fermi del Magazzino, raggruppati per
  app, clic → la pagina giusta. `GET /api/da-fare` chiede a ogni app
  (`/suite/da-fare`, token di servizio di `shared/suite`) in parallelo, 3 s di
  attesa, cache di 60 s per utente (`?aggiorna=1` la svuota); un'app spenta
  compare come "non raggiungibile", mai come errore.

## Registro accessi

Pagina **`/admin`** (solo admin; voce *Gestione → Registro accessi* della plancia; `pages/admin.html` +
`assets/js/admin.js`), dati da `GET /api/accessi` (`data/accessi.log`, una riga JSON per evento, le più
recenti in cima). Colonne: data e ora, utente, programma, **azione** e **dettaglio**. Le azioni hanno un
nome leggibile (`AZIONI_PORTALE` in `assets/js/common.js`, lo stesso della plancia) e il filtro elenca
quelle presenti nel registro: accesso, uscita, apertura, avvio, riavvio, arresto, chiusura, azione nel
programma (`evento`), accesso con la password del Portale (`login-app`), accesso bloccato o rifiutato,
richiesta di aiuto e richiesta gestita, password reimpostata, disattivazione e riattivazione,
abilitazioni, cambio email, registro commesse. Il dettaglio (`dettaglioAzione`) dice a chi, cosa è
cambiato o da quale PC. Un'azione nuova sul server va aggiunta anche lì.

## Assistente della suite

In basso a destra nella home c'è un assistente che spiega **cosa fanno le app** e **quale usare**. È un motore locale **a regole**: nessuna AI, nessuna chiamata in rete, nessun costo, funziona anche senza internet. Sa solo quello che sta nel registro `APPS` di `server.js`, e fuori da lì risponde che non sa.

Gira sul **server** (`POST /api/chat`) e non nel browser, così le risposte passano dallo stesso filtro delle altre API: a un utente non-admin le app `adminOnly` non vengono nominate.

Per insegnargli una nuova app basta aggiungerla ad `APPS` con i suoi campi:

- `kw` — parole e frasi con cui la gente la cerca (`['scadenza', 'durc', 'rinnovo']`).
- `dettaglio` — la risposta lunga a "cosa fa X?" (se manca si usa `desc`).

## Accesso unico (SSO)

Le app della suite condividono la sessione del portale: inoltrano il cookie del browser a `GET /api/verify`, così chi è loggato nel portale è riconosciuto anche nelle app. Se il portale è spento le app non fanno entrare nessuno (gate chiuso); su un PC singolo `COSEDIL_SSO_FAIL=open` le lascia usabili da sole. Codice comune in `shared/sso/`.

### Una password per tutti i programmi

La password del portale vale in ogni programma (06/11/2026); le password proprie dei programmi restano valide come riserva.

- **Analista Dati** e **Lettore DDT** aprono da soli la sessione dell'account con lo stesso username del portale (Analista lo crea se manca; DDT no: gli account DDT li crea l'amministratore). In **DDT e Magazzino** la commessa si sceglie all'ingresso dal registro della suite.
- **SkyTower**, **InCampo** (anche l'app per telefono) e **VFP Transfer**, quando la loro password non coincide, chiedono al portale `POST /api/verifica-password` (header `X-Suite-Token`, corpo `{ login, password, app, ip }`; funzione `verificaPasswordApp` in `server.js`). Il portale riconosce la persona da username o email, applica gli stessi blocchi del login (sull'IP della persona, passato dal programma), rifiuta account disattivati, password temporanee non ancora cambiate e programmi non abilitati, e scrive `login-app` nel registro accessi.
- Dettagli e codici di risposta: `shared/suite/CONTRATTI.md` §2b; guida utente §1.8.

## Amministratore in base all'IP (per-app)

Su un server centrale in LAN, certe postazioni possono **elevare ad amministratore** l'utente già loggato, ma solo in alcune app. Le regole stanno in `data/ip-admin.json`:

```
{
  "rules": [
    { "ip": "192.168.1.50",   "apps": ["portale"],    "nota": "PC direzione" },
    { "ip": "192.168.1.0/24", "apps": ["ddt", "ocr"], "nota": "rete uffici" },
    { "ip": "10.0.0.7",       "apps": ["*"],           "nota": "admin ovunque" }
  ]
}
```

- `ip`: esatto (`192.168.1.10`), CIDR (`192.168.1.0/24`) o `*`.
- `apps`: `ddt`, `agente`, `confronta`, `ocr`, `scadenzario`, `requisiti`, `incampo`, `skytower`, `magazzino`, `timbri`, `trimble`, `auguri`, `portale`, oppure `*` (tutte).
- Le modifiche valgono ai **nuovi accessi**: chi è già loggato deve rifare login.

## Avvisi dei programmi

Ogni programma della suite lascia i suoi avvisi al portale (modulo `shared/avvisi`, vedi il suo README): errori dei log, lavori automatici falliti, scadenze nuove dello Scadenzario, modelli Word cambiati in VFP Transfer, allarmi di Auguri. Il portale stesso segnala le app cadute e riavviate dal keep-alive, gli avvii a caldo falliti e i login bloccati per troppi tentativi.

Per gli admin:

- pagina **`/avvisi`** — avvisi da vedere (filtri per programma e gravità) e storico dei visti con chi e quando. Un avviso resta aperto finché un admin non lo segna come visto; le ripetizioni dello stesso problema si accorpano con un contatore;
- sulla **plancia** — contatore accanto al link *Avvisi* (rosso se ci sono errori) e, appena ci si collega, un riquadro con i primi avvisi da vedere (una volta per accesso).

API (solo admin): `GET /api/avvisi`, `GET /api/avvisi/conteggio`, `POST /api/avvisi/visto` con `{ id }` o `{ tutti: true }`.

## Avvio a caldo (pre-warm)

Per non far aspettare l'utente, il portale può avviare all'accensione le app più lente e tenerle accese (le riavvia se cadono). Configurazione in `data/warm.json`:

```
{ "apps": ["ocr", "agente"] }
```

Oppure con la variabile `WARM_APPS`. Attenzione al consumo di RAM/VRAM: attivarlo solo sulle app che si vogliono davvero sempre pronte.

## PATH delle app avviate

Quando avvia un'app, il portale non le passa il proprio `PATH` così com'è: lo **rilegge dal registro** (chiave macchina + chiave utente) e ci accoda quello del processo. Su Windows un processo eredita l'ambiente di chi lo ha creato, e il portale su un server resta acceso per giorni o settimane: senza questa rilettura, un programma installato nel frattempo — Tesseract, poppler, Node aggiornato — resterebbe invisibile alle app fino al riavvio della macchina, con errori del tipo *"pdftoppm non trovato"* pur avendolo appena installato.

La funzione è `pathDalRegistro()` in `server.js`; fuori da Windows restituisce il `PATH` così com'è.

<!-- "><(((º> sabusabu <º)))><" -->

## Struttura

- `server.js` — server HTTP, login, sessioni, avvio app, API.
- `pages/` — pagine HTML (login, portale, plancia, utenti, abilitazioni, commesse, avvisi, registro accessi, cambio password, documentazione).
- `docs/guida/` — guida utente con le immagini (capitoli `NN-nome.md`, immagini in `img/`). La pagina `/doc` (*Guida all'uso*) la mostra con i link fra i capitoli; `guida.md` nella radice è solo un rimando.
- `assets/` — CSS, JavaScript e font.
- `data/` — dati a runtime (creati automaticamente):
  - `utenti.json` — utenti (password con hash scrypt, programmi, email, disattivazione, `sessioniDa`).
  - `login-fails.json` — tentativi di accesso falliti (condiviso con la plancia 8090).
  - `richieste.json` — richieste di aiuto dal login.
  - `presenze.json` — programmi aperti adesso (per la plancia).
  - `contatti.json` — email dell'amministratore per l'assistente e il login.
  - `app-extra.json` — programmi aggiunti dagli admin.
  - `accessi.log` — registro accessi (NDJSON).
  - `ip-admin.json` — regole admin per-IP.
  - `warm.json` — app da avviare a caldo.
  - `avvisi.json` — avvisi dei programmi (aperti + ultimi 300 visti).
  - `avvisi-in/` — cartella di arrivo degli avvisi dalle app.
  - `.session-secret` — chiave di firma delle sessioni.
  - `server.log` — errori a runtime (oltre 5 MB diventa `server.log.1`).
- `server.test.js` — test (`npm test`).

## Note di sicurezza

- Le password sono salvate con hash **scrypt** + salt; nessuna password in chiaro.
- Le sessioni sono cookie **HttpOnly** firmati **HMAC-SHA256**. **Esci** chiude tutte le sessioni dell'utente su tutti i PC (istante salvato in `sessioniDa` in `utenti.json`: i cookie emessi prima non valgono più); lo stesso fa il cambio password.
- Dopo **15 tentativi di login falliti** quella coppia utente+PC resta bloccata **15 minuti** (dallo stesso PC, 50 tentativi in tutto su username diversi). Chi resta bloccato chiede aiuto dal login ("Password dimenticata o account bloccato?") e l'admin lo sblocca dalla plancia reimpostando la password. Il conteggio sta in `data/login-fails.json`: sopravvive al riavvio ed è condiviso con la plancia 8090. Lo stesso freno vale sul cambio password e su `/api/verifica-password` (la password del portale usata dagli altri programmi).
- **Su HTTP le password viaggiano in chiaro sulla LAN.** Chi vuole cifrarle imposta `TLS_CERT`/`TLS_KEY` (basta un certificato interno) oppure mette davanti un reverse proxy HTTPS con `COOKIE_SECURE=1`. Le app della suite restano su HTTP: il link dal portale è una normale navigazione e il browser non la blocca.
- `GET /api/verify` risponde in CORS solo alle app sullo **stesso host del portale** (o su IP privati di LAN), mai a un sito su internet.
- L'IP **non è una password**: chi usa una postazione "fidata" ne eredita i privilegi. Usare IP fissi/prenotazione DHCP per le postazioni admin, e mantenere comunque il login.

---

_Cosedil S.p.A. — Portale Suite. Per l'uso quotidiano vedi la guida in [`docs/guida/`](docs/guida/README.md) (dal portale: *Guida all'uso*)._
