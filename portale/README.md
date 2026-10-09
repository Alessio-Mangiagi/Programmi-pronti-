<!-- "><(((º> sabusabu <º)))><" -->
# Portale Suite Cosedil

Portale locale che riunisce in un unico accesso le applicazioni della suite Cosedil: **login** utenti, **avvio** e **apertura** dei programmi, **registro degli accessi** e area di **amministrazione**. Scritto in Node.js **senza dipendenze esterne** (solo moduli core).

---

## Requisiti

- **Node.js 18 o superiore** (`node --version` per verificare).
- Windows (i launcher delle app usano `.vbs`/`.bat`, lo spegnimento usa `netstat`/`taskkill`). Il server in sé è multipiattaforma.

## Avvio e arresto

- **Avvia** (silenzioso, senza finestra): doppio clic su `avvia.vbs`.
- **Avvia** (con log a schermo): doppio clic su `avvia.bat`.
- **Ferma**: doppio clic su `ferma.vbs`.
- Da riga di comando: `node server.js` (oppure `npm start`).

All'avvio in locale il browser si apre da solo su `http://localhost:8080`.

### Primo accesso

Al primo avvio viene creato un amministratore predefinito:

- utente: `alessio_mangiagi`
- password: `10101010`

Verrà richiesto di **cambiare la password** al primo accesso.

## Configurazione (variabili d'ambiente)

- `PORT` — porta di ascolto (default `8080`).
- `HOST` — indirizzo di ascolto (default `127.0.0.1`). Per un **server centrale in LAN** usare `0.0.0.0`: gli altri PC si collegano a `http://IP-DEL-SERVER:8080`.
- `DATA_DIR` — cartella dei dati (default `./data`).
- `SUITE_DOMINIO` — dominio del server (es. `esempio.lan`): app su `https://<cartella>.<dominio>`, portale su `https://portale.<dominio>`, cookie di sessione per tutto il dominio. `SUITE_SCHEMA=http` solo se il proxy non fa TLS.
- `WARM_APPS` — app da **avviare a caldo** e tenere accese, separate da virgola (es. `ocr,agente`), oppure `all`. In alternativa si usa `data/warm.json`.
- `TRUST_PROXY` — impostare a `1` se il portale è dietro un reverse proxy (nginx/IIS): legge l'IP client da `X-Forwarded-For`.
- `TLS_CERT` / `TLS_KEY` — percorsi di certificato e chiave: se ci sono entrambi il portale parla **HTTPS** e marca il cookie di sessione `Secure`. Se sono indicati ma illeggibili il portale **non parte** (meglio fermo che in chiaro per sbaglio).
- `COOKIE_SECURE=1` — cookie `Secure` anche senza TLS_CERT, per quando è il reverse proxy a fare l'HTTPS.

## Test

```
npm test
```

`node --test`, nessuna dipendenza. Copre URL/CORS in LAN, freno al brute force, lettura di `netstat`, assistente, admin per-IP e import utenti. `server.js` importato come modulo non apre porte e non tocca `data/`.

## Le applicazioni della suite

- **Lettore DDT** — da PDF a Excel — porta `5050`
- **Analista Dati** — interrogazione dati con AI — porta `5173`
- **Confronto Documenti** — raffronto documenti con OCR — porta `5001`
- **OCR Documenti** — OCR ed estrazione — porta `5179`
- **Scadenzario** — scadenze e adempimenti — porta `5180`
- **Verifica Requisiti** — ricerca e checklist sui documenti — porta `5185` — *riservata*
- **Ponte Trimble** — PCQ, computi e SAL verso Trimble — porta `3011` — *solo admin*
- **Auguri** — compleanni su WhatsApp — porta `3000` — *solo admin*

Il portale verifica lo stato di ogni servizio (porta in ascolto) ogni pochi secondi. Gli indirizzi delle app seguono l'host da cui è aperto il portale: chi lo apre su `http://192.168.1.5:8080` viene mandato su `http://192.168.1.5:5050`, non su `localhost` (che sarebbe il suo PC). Con `SUITE_DOMINIO` impostata gli indirizzi diventano `https://<cartella>.<dominio>` (es. `https://scadenzario.esempio.lan`), serviti da Caddy (`deploy/Caddyfile`); vedi il README della suite. L'assistente le porte non le dice: chi usa il portale non ne ha bisogno.

### Fermare un'app

Sulle card, gli **amministratori del portale** vedono un pulsante quadrato **Ferma** accanto ad "Apri" (solo se l'app è accesa): chiude il processo in ascolto su quella porta, con conferma. Serve a liberare RAM sul server centrale. Un'app fermata a mano non viene riaccesa dall'avvio a caldo finché qualcuno non preme "Avvia" (o non si riavvia il portale).

### Chi vede quali programmi

Si decide dall'area **Amministrazione** (link in alto nella home, solo per gli admin), riquadro **Utenti**. Ogni riga ha la colonna *Programmi visibili*, una casella per programma: spuntare abilita, togliere revoca, il salvataggio è immediato. Le stesse caselle sono nel form di creazione, così un utente nasce già con i suoi programmi. Gli admin hanno *tutti (admin)*: entrano ovunque per ruolo, senza spunte.

Sotto il cofano è il campo `apps` in `data/utenti.json` — l'elenco esatto dei programmi di quell'utente:

```json
{ "username": "mrossi", "nome": "Mario Rossi", "ruolo": "utente", "apps": ["ddt", "requisiti"] }
```

Chi **non ha il campo** (utenti storici, import da Excel) segue il **default**: tutti i programmi tranne quelli riservati. Il campo è letto **da disco a ogni richiesta**, non dal cookie: una revoca vale subito, senza aspettare la scadenza della sessione né obbligare l'utente a rifare login (il gate SSO delle app ha però una cache di 30 secondi).

**Programmi riservati.** Un'app con `riservata: true` nel registro `APPS` resta fuori dal default: la vedono gli admin e i soli utenti a cui è stata spuntata. Oggi lo è **Verifica Requisiti**, che tratta documenti contrattuali (DURC, visure, certificati). Nelle caselle è marcata *riservato*. Le app `adminOnly` (Trimble, Auguri) non hanno casella: seguono il ruolo e basta.

Per chi non ha un programma, quel programma **non esiste**: sparisce dalle card e dallo stato, `avvia`/`apri` rispondono `404`, e l'assistente non ne parla. Chi ne conosce l'indirizzo e lo digita a mano non entra lo stesso: `GET /api/verify?app=<id>` risponde `403` e il gate SSO dell'app chiude la porta con "chiedi l'abilitazione a un amministratore". Nascondere la card senza chiudere il gate sarebbe stato un cartello, non una serratura.

Ogni modifica finisce nel registro accessi con azione `abilita`: chi ha cambiato cosa, a chi, e quando.

## Assistente della suite

In basso a destra nella home c'è un assistente che spiega **cosa fanno le app** e **quale usare**. È un motore locale **a regole**: nessuna AI, nessuna chiamata in rete, nessun costo, funziona anche senza internet. Sa solo quello che sta nel registro `APPS` di `server.js`, e fuori da lì risponde che non sa.

Gira sul **server** (`POST /api/chat`) e non nel browser, così le risposte passano dallo stesso filtro delle altre API: a un utente non-admin le app `adminOnly` non vengono nominate.

Per insegnargli una nuova app basta aggiungerla ad `APPS` con i suoi campi:

- `kw` — parole e frasi con cui la gente la cerca (`['scadenza', 'durc', 'rinnovo']`).
- `dettaglio` — la risposta lunga a "cosa fa X?" (se manca si usa `desc`).

## Accesso unico (SSO)

Le app della suite condividono la sessione del portale: inoltrano il cookie del browser a `GET /api/verify`, così chi è loggato nel portale è riconosciuto anche nelle app. Se il portale è spento, le app restano usabili in autonomia (fail-open). Vedi `cosedil-sso.mjs` / `cosedil-sso.ts` nelle singole app.

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
- `apps`: `ddt`, `agente`, `confronta`, `ocr`, `scadenzario`, `requisiti`, `trimble`, `auguri`, `portale`, oppure `*` (tutte).
- Le modifiche valgono ai **nuovi accessi**: chi è già loggato deve rifare login.

## Avvio a caldo (pre-warm)

Per non far aspettare l'utente, il portale può avviare all'accensione le app più lente e tenerle accese (le riavvia se cadono). Configurazione in `data/warm.json`:

```
{ "apps": ["ocr", "agente"] }
```

Oppure con la variabile `WARM_APPS`. Attenzione al consumo di RAM/VRAM: attivarlo solo sulle app che si vogliono davvero sempre pronte.

## PATH delle app avviate

Quando avvia un'app, il portale non le passa il proprio `PATH` così com'è: lo **rilegge dal registro** (chiave macchina + chiave utente) e ci accoda quello del processo. Su Windows un processo eredita l'ambiente di chi lo ha creato, e il portale su un server resta acceso per giorni o settimane: senza questa rilettura, un programma installato nel frattempo — Tesseract, poppler, Node aggiornato — resterebbe invisibile alle app fino al riavvio della macchina, con errori del tipo *"pdftoppm non trovato"* pur avendolo appena installato.

La funzione è `pathDalRegistro()` in `server.js`; fuori da Windows restituisce il `PATH` così com'è.

## Struttura

- `server.js` — server HTTP, login, sessioni, avvio app, API.
- `pages/` — pagine HTML (login, portale, cambio password, amministrazione, documentazione).
- `assets/` — CSS, JavaScript e font.
- `data/` — dati a runtime (creati automaticamente):
  - `utenti.json` — utenti (password con hash scrypt).
  - `accessi.log` — registro accessi (NDJSON).
  - `ip-admin.json` — regole admin per-IP.
  - `warm.json` — app da avviare a caldo.
  - `.session-secret` — chiave di firma delle sessioni.
  - `server.log` — errori a runtime (oltre 5 MB diventa `server.log.1`).
- `server.test.js` — test (`npm test`).

## Note di sicurezza

- Le password sono salvate con hash **scrypt** + salt; nessuna password in chiaro.
- Le sessioni sono cookie **HttpOnly** firmati **HMAC-SHA256** (nessuno stato in RAM).
- Dopo **5 tentativi di login falliti** quella coppia utente+PC resta bloccata **15 minuti**. Il conteggio sta in RAM: si azzera al riavvio del portale.
- **Su HTTP le password viaggiano in chiaro sulla LAN.** Chi vuole cifrarle imposta `TLS_CERT`/`TLS_KEY` (basta un certificato interno) oppure mette davanti un reverse proxy HTTPS con `COOKIE_SECURE=1`. Le app della suite restano su HTTP: il link dal portale è una normale navigazione e il browser non la blocca.
- `GET /api/verify` risponde in CORS solo alle app sullo **stesso host del portale** (o su IP privati di LAN), mai a un sito su internet.
- L'IP **non è una password**: chi usa una postazione "fidata" ne eredita i privilegi. Usare IP fissi/prenotazione DHCP per le postazioni admin, e mantenere comunque il login.

---

_Cosedil S.p.A. — Portale Suite. Per l'uso quotidiano vedi `guida.md`._
