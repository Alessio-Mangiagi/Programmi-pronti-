<!-- "><(((º> sabusabu <º)))>< -->
# Controllo di sicurezza della suite — 13 novembre 2026

Seconda revisione, dieci giorni dopo quella del 3 novembre (`sicurezza-2026-11-03.md`) e 216 commit più tardi.
Fatta in sola lettura sul codice, con attenzione a ciò che è nato in questi giorni e tocca l'accesso: una
password per tutti i programmi (`/api/verifica-password`), l'ingresso automatico dal portale in ogni app,
"amministratore del portale = amministratore ovunque", il programma unico DDT e Magazzino col suo proxy, i
timbri in SkyTower, il motore della firma `.p7m`, Timbri per VFP, i link costruiti con l'host del browser.
In più: audit delle dipendenze (`npm audit` su 11 pacchetti, `pip-audit` su 7 ambienti) e ricerca mirata in
tutta la suite di comandi di shell composti con stringhe, SQL composto a mano, percorsi file presi dalla
richiesta, deserializzazione e XML, limiti di dimensione, HTML non protetto nelle pagine del portale,
CSRF, CORS, segreti nel repository.

Esito in breve: **nessuna falla grave nuova.** Una debolezza strutturale nel controllo d'accesso comune,
chiusa in via preventiva, e qualche dipendenza da aggiornare. Il resto regge.

## Cosa è stato corretto

1. **Il controllo d'accesso comune lasciava passare per nome di file.** La scorciatoia per i file statici
   (`eAsset` in `shared/sso/cosedil-sso.js`, `e_asset` in `cosedil_sso.py`) guardava solo l'estensione: un
   percorso che finiva per `.png`, `.jpg`, `.txt`, `.js`… passava senza login anche sotto `/api/` e anche
   in POST, PUT o DELETE. Con rotte come `GET /api/lavori/<id>` (OCR Documenti), `DELETE /api/jobs/<id>`
   (Confronto Documenti) o `DELETE /api/admin/utenti/<username>` (Scadenzario; gli username del portale
   ammettono il punto, quindi `m.txt` è un nome valido) una richiesta a `…/<id>.png` arrivava al gestore
   senza che il gate la vedesse. Non è stato trovato uno sfruttamento concreto: gli id sono casuali, e
   Scadenzario e Portale ricontrollano l'amministratore da soli. Chiusa comunque alla radice: la scorciatoia
   vale **solo per GET e HEAD** e **mai per un percorso con un segmento `api`** (anche `/API/`, anche
   `/magazzino/api/`). Nuovo parametro `metodo` di `decidi()` in Python, retrocompatibile. Test aggiunti in
   `cosedil-sso.test.js` e `test_cosedil_sso.py`; README del gate aggiornato.
2. **Dipendenze con una correzione senza salti di versione.** `zod` sotto la 4.6.6 (esaurimento di memoria
   su collezioni enormi) in `incampo/web` e `incampo/packages/form-core` → 4.6.7; `source-map-js` e il
   `launch-editor` di Vite in form-core; `basic-ftp` in Auguri → 6.2.6. Il sito di InCampo (`web/dist`,
   quello servito dall'app) è stato ricompilato.

## Cosa è stato controllato e regge

- **Portale.** CSRF a tre controlli (Content-Type JSON, Origin, Sec-Fetch-Site) su ogni scrittura; cookie
  HttpOnly, SameSite=Lax, Secure con TLS; freno ai tentativi anche su `/api/verifica-password` e sul cambio
  password; IP preso dal socket, X-Forwarded-For solo dietro proxy e sempre l'ultimo elemento; CORS su
  `/api/verify` solo per le origini della suite; nessun path traversal su `/assets/` e `/docs/`; ogni dato
  di utente o di app messo in pagina passa da `esc()` (plancia, richieste di aiuto scritte prima del login,
  "da fare" che arriva dalle app, registro, avvisi, utenti, commesse); le eccezioni non fanno cadere il
  processo; tutta l'area amministrazione sta dietro `isAdmin`; corpi JSON limitati (1 MB, 12 MB l'import).
- **Novità dal 3 novembre.** `/api/verifica-password` risponde solo col token della suite, usa gli stessi
  contatori del login e non concede l'elevazione per IP. L'ingresso dal portale in InCampo, SkyTower, VFP
  Transfer e Lettore DDT lega l'account per email esatta o username, crea account senza password usabile e
  (DDT) rigenera la sessione al cambio di persona. Il proxy `/magazzino` del Lettore DDT butta le
  intestazioni `X-Suite-*` e `X-Forwarded-*` arrivate dal browser, toglie le hop-by-hop e mette l'IP vero;
  `prefisso.py` del Magazzino si fida solo da loopback e con espressioni regolari strette. Il motore della
  firma `.p7m` chiama Python con `execFile`/argv (mai una shell), lavora in una cartella temporanea che
  poi cancella, con timeout. I timbri di SkyTower hanno limiti di dimensione, protezione dalle immagini
  "bomba" e un tetto per revisione. Timbri per VFP serve un elenco chiuso di file, con CSP e solo GET/HEAD.
  I link con l'host del browser passano da `hostDaRichiesta` (solo nomi e IP validi) e sostituiscono
  soltanto un host di loopback.
- **In tutta la suite.** Nessun `exec`/`shell=True` con stringhe; SQL sempre parametrico (le f-string
  interpolano solo nomi di tabelle e colonne scritti nel codice); nessun percorso di file preso dalla
  richiesta; XML con `defusedxml` in SkyTower, libreria standard altrove su file Word e ricevute PEC
  (l'expat di Python 3.12 limita l'espansione delle entità); limiti ai corpi e agli upload in ogni app;
  nessun segreto nel repository (solo chiavi finte nei test).
- **Dipendenze in esercizio.** Zero vulnerabilità per portale, Lettore DDT, Analista Dati, OCR Documenti,
  Verifica Requisiti, Ponte Trimble, Timbri per VFP, sito di SkyTower e ora anche sito di InCampo.
  `pip-audit` pulito su Confronto Documenti, Scadenzario, Magazzino, InCampo e VFP Transfer (SkyTower e
  OCR non sono analizzabili così: pacchetto locale `cde_api` e `paddlepaddle-gpu` da indice esterno).

## Rimandato, e perché

- **Auguri: restano 7 vulnerabilità alte** (`extract-zip`, `zod` 3 dentro `chromium-bidi`,
  `@puppeteer/browsers`, `proxy-agent`). `whatsapp-web.js` 1.34.8 fissa `puppeteer` a 24.38.0 esatto; la
  correzione sta in puppeteer 25.12.1 o più, che whatsapp-web.js non ha ancora adottato. Forzare la
  versione rischia di rompere l'aggancio a WhatsApp Web, che non si può verificare in automatico.
  L'esposizione reale è bassa: i difetti stanno nello scarico di Chromium (archivi presi da Google) e nel
  dialogo locale col browser, non in ciò che arriva dalla rete. Da ricontrollare a ogni release di
  whatsapp-web.js con `npm audit` in `auguri/`.
- **Strumenti di sviluppo** (`vitest`, `tinypool`, `vite`, `eslint`) in Analista Dati, OCR Documenti e
  form-core: non girano in esercizio (Analista e OCR servono `dist/` da Express, non il dev server). La
  correzione è un salto a vitest 5: da fare con calma, coi test.
- **`/api/verifica-password`: l'IP della persona lo dichiara il programma che chiama.** Chi ha il token
  della suite può aggirare i blocchi per tentativi cambiando `ip` a ogni chiamata. È la conseguenza del
  token unico per tutta la suite (decisione aperta dal 3 novembre: un token per app). Rete di sicurezza
  possibile senza cambiare le regole: un tetto per programma chiamante, per esempio 500 errori in 15 minuti.
- **Cookie del portale nelle app** (area admin): invariato dal 3 novembre. Lo Scadenzario amministra gli
  utenti del portale inoltrando il cookie dell'amministratore; funziona perché il portale ricontrolla, ma
  un'app compromessa potrebbe fare lo stesso. Decisione aperta: secondo cookie o identità firmata per app.
- **InCampo: ruolo predefinito `manager`** per chi entra dal portale la prima volta
  (`INCAMPO_RUOLO_PORTALE`): un utente qualunque del portale può creare cantieri. Valutare `field`.
- **Magazzino dietro Caddy.** `prefisso.py` si fida di `X-Forwarded-Host`/`-Prefix` da loopback; Caddy
  riscrive `X-Forwarded-Host`, quindi dal browser non si falsifica; vale solo per processi locali, che
  possono già tutto. Nessuna azione.
- CSP del portale con `style-src 'unsafe-inline'`: bassa priorità.

## Verifiche fatte

| Cosa | Esito |
|---|---|
| `node --test shared/sso/*.test.js shared/suite/suite_link.test.js` | 22 test, tutti passati (2 nuovi) |
| `python shared/sso/test_cosedil_sso.py` | tutti passati (12 controlli nuovi) |
| Lettore DDT: `sicurezza`, `portale`, `loginUnico`, `ddtMagazzino` | 4 suite, 46 test passati |
| form-core `npm test` | 187 passati |
| Auguri `npm test` | 14 passati |
| Magazzino, Scadenzario, Confronto Documenti `pytest` | 92 + 69 + 57 passati |

## Azioni manuali

- Le app caricano il gate all'avvio: **riavviare dal portale** quelle accese (Lettore DDT, OCR, Analista
  Dati, Verifica Requisiti, Ponte Trimble, Timbri, Auguri, Confronto, Scadenzario, Magazzino, InCampo),
  altrimenti la correzione del gate non vale finché non ripartono.
- Restano valide le azioni del 3 novembre: permessi NTFS su `shared\suite\.token`, sui `.env` delle app,
  su `portale\data` e sulle chiavi del Lettore DDT (`.users.key`, `.session.key`).
