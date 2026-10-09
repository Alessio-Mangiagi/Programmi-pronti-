# Gate SSO condiviso

Unica fonte del controllo d'accesso delle app della suite. Prima ne esistevano quattro
copie (una per app), già divergenti tra loro: la versione Python non sapeva fare l'admin
per-app che le altre facevano. Ora ci sono due file, uno per linguaggio, con lo stesso
comportamento e le stesse variabili d'ambiente.

| File | Chi lo usa |
|---|---|
| `cosedil-sso.js` | il codice vero (CommonJS): Auguri (`require`), Lettore DDT (import TS) |
| `cosedil-sso.mjs` | facciata ESM per Agente e OCR (`vite.config.ts`) |
| `cosedil-sso.d.ts` | tipi per le app TypeScript |
| `cosedil_sso.py` | Confronto Documenti, Scadenzario (Flask, `init`); InCampo (FastAPI, `asgi`) |

**Non aggiungere un `package.json` in `shared/`**: senza campo `type` Node legge `.js`
come CommonJS, ed è quello che serve perché lo stesso file valga per le app CJS e per
quelle ESM.

<!-- "><(((º> sabusabu <º)))><" -->

## Come funziona

Il gate intercetta navigazioni (`Accept: text/html`) e chiamate `/api`, e inoltra il
cookie `sid` del browser a `<portale>/api/verify`. Gli asset statici passano sempre.

| Situazione | Esito |
|---|---|
| Loggato nel portale | passa; identità in `req.cosedil` (JS) o `g.cosedil` (Python) |
| Non loggato, portale raggiungibile | pagina → 302 al portale; API → 401 |
| Portale irraggiungibile | 503 (**fail-closed**, default) oppure passa se `COSEDIL_SSO_FAIL=open` |
| Rotta admin e utente non admin | 403 |

Il fail-closed è il default perché in LAN il fail-open significava: spegni il portale,
usi le app senza login. Su un PC singolo, dove l'app deve restare autonoma, si torna
indietro con `COSEDIL_SSO_FAIL=open`.

Gli esiti sono in cache 30 secondi, ma un portale irraggiungibile solo 3: col gate chiuso
un blip di rete bloccherebbe l'app per l'intera TTL.

## Programmi riservati

Se il portale risponde `403` a `GET /api/verify?app=<id>` — sessione valida, ma app riservata a cui quell'utente non è abilitato — il gate **non** rimanda al login (l'utente il login lo ha già fatto): risponde `403` con *"Accesso riservato: questa app è abilitata solo ad alcuni utenti"*, sia sulle pagine sia sulle API, e lo stesso vale per l'handshake Socket.IO. Le abilitazioni si danno dal portale, in Amministrazione > Utenti.

L'esito è in cache 30 secondi come gli altri: una revoca può metterci fino a mezzo minuto ad arrivare all'app.

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `COSEDIL_SSO` | `on` | `off` disattiva il gate (sviluppo) |
| `COSEDIL_PORTAL` | `http://localhost:8080` | URL del portale |
| `COSEDIL_SSO_FAIL` | `closed` | `open`: portale giù → l'app resta usabile |

## Uso

```js
// Express / Vite (JS, ESM: importa da cosedil-sso.mjs)
const cosedilSSO = require('../../shared/sso/cosedil-sso');
app.use(cosedilSSO({ app: 'ddt' }));                       // identità + admin per-app
app.use(cosedilSSO({ app: 'auguri', adminOnly: true }));   // intera app agli admin
app.use(cosedilSSO({ app: 'ocr', adminPaths: ['/api/admin'] }));

// Socket.IO: i websocket non passano dal middleware HTTP, vanno gattati a parte
const { cosedilSocketIO } = cosedilSSO;
io.use(cosedilSocketIO({ app: 'auguri', adminOnly: true }));
```

```python
# Flask — shared/sso non è un pacchetto installato: va aggiunto al sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "sso"))
import cosedil_sso
cosedil_sso.init(app, app_id="scadenzario")

# ASGI (FastAPI, Starlette): avvolge l'app e ritorna quella da servire.
# Flask non serve: il modulo lo importa solo dentro init().
app = cosedil_sso.asgi(app, app_id="incampo",
                       solo_pagine=True,                 # API lasciate al JWT dell'app
                       percorsi_liberi=("/invito/",))    # pagine pubbliche
```

`solo_pagine=True` è per le app che hanno già un loro login sulle API e le fanno usare
anche a chi il cookie del portale non ce l'ha (l'app mobile di InCampo): il gate guarda
solo le navigazioni HTML. Senza, il comportamento è identico a quello Flask.

L'`app` passato è l'id nel registro `APPS` del portale (`ddt`, `agente`, `confronta`,
`ocr`, `scadenzario`, `auguri`): serve al portale per rispondere se quella sessione è
admin **per quell'app**, in base al ruolo utente o all'IP di provenienza
(`portale/data/ip-admin.json`).

## Attenzione a

- **Confronto Documenti** viene impacchettato con PyInstaller: `ConfrontaPDF.spec` ha
  `pathex=['../shared/sso']`, senza cui l'exe non risolve `import cosedil_sso`.
- **Lettore DDT** compila in `dist/`: `src/` e `dist/` stanno entrambi un livello sotto la
  radice dell'app, quindi `../../shared/sso/cosedil-sso` risolve identico prima e dopo il
  build.
