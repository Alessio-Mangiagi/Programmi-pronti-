<!-- "><(((º> sabusabu <º)))><" -->
# Contratti fra le app della suite (versione 09/11/2026)

Regole comuni che ogni app rispetta per far lavorare l'operatore su una suite sola.
Le funzioni citate stanno in `suite_link.py` (Python) e `suite_link.js` (Node,
CommonJS: `require('../shared/suite/suite_link.js')`, in ESM con `createRequire`).

## 1. Identità dell'utente

* L'utente è quello del portale. Il portale, in `/api/verify` e `/api/me`, dà
  `username`, `nome`, `ruolo` (`admin` | `utente`), `admin` e ora anche **`email`**:
  il campo `email` dell'utente se l'admin l'ha impostato, altrimenti
  `<username>@<SUITE_EMAIL_DOMINIO>` (default `cosedilspa.com`).
* Nelle chiamate fra app chi chiama manda `X-Suite-Utente` (username),
  `X-Suite-Nome`, **`X-Suite-Email`** (`chiama(..., utente=, nome=, email=)`).
* Le app con utenti propri (InCampo, SkyTower) cercano l'utente **prima per email**,
  poi per parte prima della `@` uguale allo username. Se manca, lo creano (punto 2).

## 2. Login automatico dal portale (InCampo, SkyTower)

Rotta `POST /auth/portale` (InCampo sotto `/api`, SkyTower sull'API), senza corpo.
Legge l'header `Cookie` della richiesta (il cookie `sid` del portale arriva perché
stesso host o stesso `SUITE_DOMINIO`) e lo verifica con
`cosedil_sso.verifica_sessione(cookie, app_id)`.

* portale irraggiungibile o sessione non valida → `401 {"errore": "..."}`;
  con `COSEDIL_SSO=off` risponde 401 senza chiamare nessuno;
* utente trovato (punto 1) → emette la sessione dell'app come dopo un login normale;
* utente assente → lo **crea** attivo, senza password usabile, con nome ed email
  del portale e ruolo dal ruolo del portale:
  * InCampo: `admin` → `admin`, altrimenti `INCAMPO_RUOLO_PORTALE` (default `manager`);
  * SkyTower: organizzazione della suite `CDE_SUITE_ORG_ID` (altrimenti quella
    dell'utente tecnico `CDE_SUITE_USER_EMAIL`, altrimenti quella del primo platform
    admin), `admin` del portale → `is_org_admin`; membro dei **progetti di proprietà
    di quell'organizzazione con codice commessa** (`settings.commessa`) col ruolo
    `CDE_SUITE_RUOLO_PORTALE` (default `DESIGNER`: legge, scrive, scarica), **anche
    se è admin del portale** (i ruoli forti li dà un Project Admin). Un utente già
    esistente che non è membro di un progetto con commessa viene aggiunto allo stesso modo.
* **Regole di sicurezza di SkyTower** (ADR-47, revisione del 03/11/2026):
  * l'utente si cerca **solo per email esatta** e solo nell'organizzazione della suite:
    niente ripiego sulla parte prima della `@` per agganciare un account esistente;
  * non entrano da qui (403, entrano con la password): utenti di **altre organizzazioni**,
    **platform admin**, utenti con **SSO obbligatorio**, account **bloccati o disattivati**;
  * se l'utente ha un fattore MFA, o l'organizzazione lo pretende, la risposta è quella del
    login con password (`mfa_required` / `mfa_enrollment_required` con `mfa_token`): il web
    passa al login di sempre; il portale non sostituisce il secondo fattore;
  * al portale va solo `sid=<valore>`, non l'intero header Cookie (che porta il refresh
    token di SkyTower); limite 30 richieste/minuto per IP, esito in cache 30 s per `sid`;
  * `settings.commessa` deve stare nel registro (§3) quando il registro c'è, ed è univoco
    fra i progetti attivi della stessa organizzazione (migrazione 0038: altrimenti 409).
* Il web dell'app, se non ha un token, chiama questa rotta **una volta** all'apertura:
  se risponde 200 entra senza chiedere niente, altrimenti mostra il login di sempre.

## 2b. Una password per tutti i programmi (06/11/2026)

La password del portale vale in ogni programma; le password proprie dei programmi
restano valide come riserva.

* **Lettore DDT e Analista Dati**: chi arriva dal portale è già dentro, senza seconda
  password. Il gate SSO mette in `req.cosedil` l'utente del portale e un middleware apre
  la sessione dell'account **con lo stesso username**:
  * Analista Dati (`sessioneDalPortale`, `server/auth.ts`): se l'account manca lo crea,
    `admin` solo se il portale lo dice admin dell'agente, password casuale non usata;
  * Lettore DDT (`ingressoDalPortale`, `src/middleware/auth.ts`): lo aggancia ma **non lo
    crea**, perché ogni account DDT porta la sua commessa (`commessaId`) scelta dall'admin
    DDT; senza account con quel nome resta il login (es. account della commessa);
  * la sessione ricorda chi l'ha aperta nel portale: se nel portale entra un'altra persona
    sullo stesso browser, la sessione dell'app si chiude. Un login a mano su un altro
    account dell'app, col portale aperto, resta valido finché c'è la stessa persona.
* **SkyTower, InCampo (anche l'app per telefono), VFP Transfer**: il loro login accetta
  anche la password del portale. Quando la loro password non coincide, il **backend**
  chiama `cosedil_sso.verifica_password(login, password, app_id, ip)`, cioè:

  `POST <portale>/api/verifica-password` con header `X-Suite-Token` (§ regole) e corpo
  `{"login", "password", "app", "ip"}`:
  * `login` = username del portale o la sua email (impostata dall'admin, altrimenti
    `<username>@<SUITE_EMAIL_DOMINIO>`); `ip` = indirizzo della persona visto dall'app;
  * `app` = id del registro APPS del portale, oppure `vfp-transfer` (fuori registro);
  * `200 {ok, username, nome, ruolo, email, admin}` (`admin` = ruolo admin del portale,
    mai l'elevazione per IP); `401` credenziali; `403 {motivo}` con `disattivato`,
    `cambia-password` (password temporanea non ancora cambiata nel portale) o
    `non-abilitato` (programma non fra i suoi nel portale); `429` bloccato; `400` campi o
    programma sconosciuto; senza token `403`;
  * stessi contatori del login del portale (15 errori per utente da quel PC, 50 per PC,
    15 minuti) e stesso sblocco dell'admin; nel Registro accessi `login-app`.

  Poi ogni app apre la sessione come se fosse entrata con la sua password:
  * SkyTower (`auth._login_tx` → `portale.entra(via="password")`): la domanda al portale
    parte **prima** di contare il tentativo fallito; stesse regole di §2 (organizzazione
    della suite, niente platform admin, MFA, account bloccato resta fuori), contatore dei
    tentativi azzerato, `amr` = `pwd, portale`;
  * InCampo (`suite.login_con_password_portale`): stesso utente di §2 (creato se manca);
    i tentativi sbagliati ovunque contano come prima;
  * VFP Transfer (`auth._utente_dal_portale`): **solo utenti già creati lì** (con il codice
    dell'amministratore), con lo stesso nome dello username del portale o la stessa email;
    ruolo e area restano quelli di VFP Transfer.
* Portale spento o `COSEDIL_SSO=off`: vale solo la password dell'app, nessun errore in più.

## 3. Registro unico delle commesse

`shared/suite/commesse.json` (fuori da git), letto con `suite_link.commesse()` /
`commesse()`: lista di `{code, nome, stato: attiva|sospesa|chiusa, cliente, indirizzo, note}`.
Lo scrive solo il portale (`salva_commesse`): pagina *Commesse* degli admin,
`PUT /api/commesse`, `POST /api/commesse/importa` (unione di quello che le app
sanno già: `/suite/commesse` di InCampo, SkyTower, Magazzino, più CPM/Alyante via
VFP Transfer quando c'è).

Ogni app, dove si scrive un codice commessa, offre un **menu a tendina** dal
registro (solo attive, ma il codice già salvato resta valido) e lascia il testo
libero solo se il registro è vuoto. Rotta per il proprio web:
InCampo `GET /commesse/registro`, SkyTower `GET /suite/registro` (JWT),
Magazzino `GET /api/commesse`.

## 4. "Da fare" per utente (home del portale)

Ogni app espone `GET /api/suite/da-fare` (SkyTower `/suite/da-fare`), protetta dal
token di servizio, con `X-Suite-Utente`, `X-Suite-Email`, `X-Suite-Nome` e, per sapere
se è admin, il parametro `?admin=1`. Chi chiama manda anche `X-Suite-App: <id app>`
(es. `portale`, `incampo`): SkyTower lo registra, con l'utente dichiarato, in un evento
di sicurezza `SUITE_CALL` per ogni chiamata `/suite/*`.

**SkyTower e il token di servizio** (ADR-47): l'utente dichiarato vale solo se è un
utente attivo dell'organizzazione della suite e non un platform admin (email esatta da
`X-Suite-Email`, oppure `X-Suite-Utente` come `<username>@CDE_SUITE_EMAIL_DOMINIO`);
altrimenti si usa l'utente tecnico `CDE_SUITE_USER_EMAIL` con le stesse regole;
altrimenti **403** `suite_user` (prima si ripiegava sul primo platform admin). Il token
resta uno solo per tutte le app: un token per app è il passo successivo proposto.

Risposta:

```json
{"voci": [{"id": "task:12", "titolo": "Gru ferma", "testo": "Cantiere Augusta · scade 05/11",
           "url": "http://localhost:5190/projects/p1/tasks/12", "tipo": "task",
           "priorita": 1, "data": "2026-11-05"}]}
```

`tipo`: `task` | `nc` | `documento` | `scadenza` | `magazzino` | `avviso`;
`priorita` 1 (alta) – 3; `data` = scadenza o data dell'evento (ISO, opzionale);
`url` = indirizzo pubblico (`url_pubblico`). Massimo 50 voci, le più urgenti prima.
Cosa mette ogni app:

| App | Voci |
|---|---|
| InCampo | task assegnati all'utente aperti/assegnati (scaduti prima); per manager/admin anche NC aperte dei cantieri |
| SkyTower | notifiche non lette dell'utente (`cde.notifications`), compiti aperti: revisioni da approvare, «Chiarimento: …» (domanda da un altro passo), «Modifiche richieste: …», compito in attesa di chiarimento a priorità 3; `url` apre il compito |
| Magazzino | mezzi fermi/guasti, importazioni fallite (admin), ubicazioni senza commessa (admin) |
| Scadenzario | scadenze aperte entro il preavviso (tutti); scadute prima |

Il portale le raccoglie in `GET /api/da-fare` (in parallelo, 3 s di attesa per app,
cache 60 s per utente; app spenta = sezione con "spenta", mai errore) e le mostra
nella home come **Da fare oggi**, raggruppate per app, clic → `url`.

## 5. SkyTower come archivio unico

* **Lettore DDT**: finito un DDT (registro consegne), se c'è il PDF lo manda a
  SkyTower con `POST /suite/commesse/{codice}/documenti` (`tipo` `DDT` se lo schema
  lo ammette, altrimenti `RP`; `attributes` `{"origine":"ddt","ddt":n,"data":...,
  "fornitore":...}`). Il codice commessa è quello del registro: l'utente del Lettore
  DDT ha un campo `codiceCommessa` (admin) e in mancanza vale il suo `commessaId`
  se esiste nel registro. Spento con `DDT_SKYTOWER=0`; mai un errore per l'utente.
* **VFP Transfer**: `DMS_TIPO=skytower` → `estrai_dms` legge da SkyTower
  (`SorgenteSkyTower`: commesse = cartelle, documenti pubblicati = voci, file da
  `/suite/revisioni/{id}/file`) e `archivia_nel_dms` scrive su SkyTower
  (`ScritturaSkyTower`, un documento per file, `attributes` con pratica e mezzo).
  Posta: `MAIL_SKYTOWER=1` → gli allegati delle email la cui oggetto contiene un codice
  del registro (`trova_commessa` su ogni pezzo dell'oggetto) vanno su SkyTower
  (`attributes` `{"origine":"posta","mittente":...,"oggetto":...}`).
* I documenti caricati così nascono WIP nella cartella «Suite Cosedil», nome a norma.

## 6. Scadenze automatiche (Scadenzario)

Ogni `SCADENZARIO_IMPORT_SEC` (default 900 s) e all'avvio, legge le pratiche mezzi
(`MEZZI_VFP_DIR`, default `../vfp-transfer-DMS/vfp-transfer/moduli_compilati/mezzi`)
e crea/aggiorna le scadenze: fine nolo (`data_fine`), assicurazione e verifiche
(`documenti[].scadenza`), white list (`white_list_dal` + 12 mesi). Soggetto =
attrezzatura creata dalla pratica (tipo marca modello, matricola/targa);
`documento_rif` = id pratica + tipo, chiave di aggiornamento. Mai doppioni, mai
riaprire una scadenza chiusa a mano.

## 7. Confronto e Verifica Requisiti dentro SkyTower

* Confronto Documenti e Verifica Requisiti accettano il token di servizio
  (`X-Suite-Token`) al posto della sessione sulle rotte API usate da SkyTower
  (`/api/compare`, `/api/jobs/*`; `/api/documenti*`, `/api/verifiche*`, `/api/requisiti`).
* SkyTower: `POST /revisions/{id}/confronta` (JWT, permesso READ) prende i byte di
  quella revisione e della precedente dello stesso documento, li manda a Confronto,
  salva in `documents.attributes.confronti[]` `{revision_id, precedente, job_id,
  url, data, stato}` e risponde con `url` della pagina del confronto.
  `POST /revisions/{id}/verifica {set_id}` manda il file a Verifica Requisiti,
  aspetta `pronto`, lancia la verifica e salva in `attributes.verifiche[]`
  `{revision_id, set_id, nome_set, esito, verifica_id, url, data}`;
  `GET /suite/requisiti/set` elenca i set. Bottoni nel dettaglio documento.

## 8. Analista Dati

Strumenti dell'agente (lettura) sulla suite via token: `commesse_registro`,
`magazzino_giacenze(commessa)`, `incampo_riepilogo(commessa)`,
`skytower_documenti(commessa, q)`, `scadenzario_prossime(giorni)`; l'utente del
portale viaggia negli header. Le app spente danno un messaggio chiaro, non un errore.

## 9. Ponte Trimble

Oltre all'upload: scelta "Da SkyTower" (commessa dal registro → documenti pubblicati
→ uno o più) e `POST /api/lavori/da-skytower {revision_id, traduttore, formato,
opzioni}` che scarica i byte e crea il lavoro come con l'upload.

## 10. PDF firmati digitalmente (.p7m) (06/11/2026)

Ogni programma che apre PDF (Lettore DDT, OCR Documenti, SkyTower, Confronto Documenti,
Verifica Requisiti, Ponte Trimble) accetta anche le buste CAdES `.p7m` attraverso il motore
unico `shared/firma` (README lì): `firma.js` per Node, `busta.py` per Python.

* Riconoscimento: `eBustaFirmata(buffer, nome)` / `e_busta_firmata(dati, nome)` (estensione
  `.p7m` o contenuto, anche base64); nessun processo, si può chiamare su ogni file.
* Apertura: `apri(...)` dà il documento contenuto (si elabora come un PDF qualunque) e il
  rapporto JSON (`esito` `valida` | `non valida` | `da verificare`, `riepilogo`, `firme[]` con
  firmatario, codice fiscale, ente, tipo, marca temporale, motivi).
* L'interfaccia mostra `riepilogo` accanto al documento (verde valida, rosso non valida,
  giallo da verificare); una firma non valida non blocca la lettura, la segnala.
* Chi archivia con valore legale conserva il `.p7m` originale (SkyTower); gli altri tengono
  il rapporto insieme al risultato.
* SkyTower (ADR-55): la revisione è il `.p7m`; il worker ne estrae il documento (derivato
  P7M) e salva il rapporto. `GET /suite/revisioni/{id}/file` dà il **PDF contenuto** (header
  `X-Firma-Esito`), con `?originale=true` la busta; le altre app che archiviano in SkyTower
  (Lettore DDT, VFP Transfer) mandano la busta originale.
* Motore non installato (`shared/firma/.venv` assente) = messaggio «Componente firma digitale
  non installato», mai errore 500. Gli `avvia.bat` e `InstallaSuite.exe` lo installano; se
  manca lo stesso, la prima busta avvia `installa.bat` in disparte («in installazione,
  riprovare fra qualche minuto»).
* Dove sta il motore: `FIRMA_DIR` → `<cartella dell'eseguibile>\shared\firma` → cartella del
  client. Un programma impacchettato in `.exe` (ConfrontaPDF.exe, server.exe del Lettore DDT)
  si distribuisce con `shared\firma` accanto, copiata da `shared\firma\copia-motore.bat`.

## 11. Programma unico "DDT e Magazzino" (09/11/2026)

Lettore DDT e Magazzino Operativo sono **un solo programma per chi lo usa**: una tessera nel
portale, un indirizzo (quello del Lettore DDT), la commessa chiesta **una volta all'accesso**.
Dentro restano i due motori (Node e Python Flask), avviati insieme; nessuna riscrittura.

* **C1 — avvio.** Il Magazzino resta in ascolto su `127.0.0.1:5200`; le rotte `/api/suite/*`
  dirette restano per portale, InCampo e Analista. Lo avvia il Lettore DDT se `GET /health`
  sulla 5200 non risponde (`/health` è fuori dal gate: `{"ok": true, "app": "magazzino"}`):
  `python app.py` in `../magazzino-operativo` come il suo `avvia.bat` (prima `database.py` se il
  database manca), con le variabili che il portale passa al DDT (`COSEDIL_EVENTI`,
  `SUITE_AVVISI_DIR`, `COSEDIL_PORTAL`, `HOST` di ascolto loopback). Allo spegnimento del DDT si
  ferma anche il Magazzino, solo se l'ha avviato lui.
* **C2 — proxy.** Il server del Lettore DDT inoltra `/magazzino/*` → `http://127.0.0.1:5200/*`
  togliendo il prefisso (metodo, corpo anche multipart, cookie, intestazioni) e aggiunge
  `X-Forwarded-Prefix: /magazzino`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For` e
  `X-Suite-Commessa: <codice della commessa di sessione>` (si può codificare per URL). Riscrive
  sotto `/magazzino` i `Location` dei redirect. Le richieste al proxy contano come attività per lo
  spegnimento automatico (i telefoni in cantiere usano `/magazzino/`). Magazzino spento → pagina
  di cortesia "sto avviando il magazzino…" che riprova da sola.
  Il Magazzino (`prefisso.py`) crede a queste intestazioni **solo da loopback** e con valori
  sani: il prefisso va in `SCRIPT_NAME` (link della pagina, `url_for`, manifest e service worker
  con scope `/magazzino/`), la commessa diventa il filtro proposto (giacenze, movimenti,
  ubicazioni, arrivo dei movimenti a mano) e compare nella testata con le linguette
  **DDT | Magazzino** (DDT = la parte sopra il prefisso, `/`). Aperto direttamente sulla 5200 il
  Magazzino resta alla radice com'era.
* **C3 — carico immediato.** Dopo ogni export salvato (`registraExport`: `/claude-to-excel` e
  conversione automatica) il DDT chiama `POST http://127.0.0.1:5200/api/suite/ddt/consegne` con
  `X-Suite-Token` e il JSON `{cartella, export, codiceCommessa, salvatoIl, righe:[Consegna…]}`
  (righe = quelle appena scritte in `data/<cartella>/consegne.json`, stessi campi e ordine).
  Risposta `{righe, nuove, scartate, commessa, ubicazione, avvisi:[], gia_importato}`. Il
  Magazzino usa le chiavi dell'importazione periodica (`chiave_import` `<cartella>/<export>`,
  impronta = `salvatoIl`, `chiave_riga` per indice): il giro di sfondo da `consegne.json` salta
  l'export già arrivato e, se lo rilegge, sostituisce le righe — **nessun doppione** in nessun
  ordine; lo stesso invio ripetuto risponde `gia_importato: true`. Il DDT mostra "N carichi
  registrati in magazzino (cantiere X)"; Magazzino spento o errore → nessun errore per
  l'utente, solo "il magazzino li registrerà appena acceso". Tetto 5000 righe (413).
* **C4 — accesso.** Una sola tessera nel portale, "DDT e Magazzino" (id `ddt`); la tessera
  `magazzino` non si vede in home ma l'id resta nel registro (abilitazioni, `DA_FARE_APP`,
  `FONTI_COMMESSE`, avvio interno). La tessera si vede a chi è abilitato a `ddt` **o** a
  `magazzino`. Parte DDT solo a chi ha l'account DDT, come prima; parte Magazzino a chi è
  abilitato a `ddt` o `magazzino`: il gate Python accetta più id
  (`cosedil_sso.init(app, app_id=("magazzino", "ddt"))`, il primo che il portale accetta dà
  l'esito e il flag admin).
* **Link verso il Magazzino** (da fare del portale, InCampo, task, Analista): `<Lettore DDT>/magazzino`.
  La regola sta in `suite_link.url_pubblico("magazzino")` / `urlPubblico('magazzino')`, così vale per
  tutte le app; il Magazzino la chiama con la sua configurazione (`suite_rotte.url_magazzino`).
  `SUITE_URL_PUBBLICO_MAGAZZINO` o `MAGAZZINO_URL_PUBBLICO` li forzano, `MAGAZZINO_PROGRAMMA_UNICO=0`
  torna all'indirizzo proprio del Magazzino.
* **Lato Lettore DDT.** Commessa di sessione: rotte `GET /guscio/stato`, `GET /guscio/commesse`,
  `POST /guscio/commessa` (registro della suite + cartelle precedenti dell'account; l'admin le vede
  tutte); la commessa diventa cartella dati (`C/2024/15` → `C_2024_15`), destinazione dei carichi e
  `X-Suite-Commessa`. Esito del carico immediato al browser nell'intestazione `X-Magazzino` di
  `/claude-to-excel`. Barra comune `static/guscio/barra.js`: se la pagina ha già `.testata-programma`
  (la testata del Magazzino) non si duplica e rende cliccabile `.testata-commessa` per "Cambia commessa".
  Il proxy non inoltra WebSocket (il Magazzino non li usa).
* **Accesso e commesse (09/11/2026).** Un solo login: chi entra dalla tessera non vede mai un secondo
  accesso; il Lettore DDT crea da sé l'account a chi `/api/verify?app=ddt` dice `diretto: true` (abilitato
  proprio al DDT, non solo al Magazzino che la tessera comprende). Admin del portale = admin in tutte e due
  le parti. Commesse: gli admin tutte; gli altri account DDT solo quelle abilitate sull'account (pagina admin
  del Lettore DDT), controllate sul server su ogni rotta dei dati; chi entra solo per il Magazzino sceglie la
  commessa liberamente, come filtro del Magazzino.
* **Riepilogo in SkyTower.** In SkyTower va "tutto": PDF del DDT ed Excel della conversione
  (Lettore DDT, § 5) e, per ogni commessa con movimenti nel giorno, il **riepilogo di
  magazzino** — un PDF e un Excel (movimenti del giorno con DDT di provenienza, giacenze del
  cantiere) caricati con `POST /suite/commesse/{codice}/documenti` (tipo `RP`, attributi
  `{"origine": "magazzino", "tipo": "riepilogo_giornaliero", ...}`). Automatico una volta al
  giorno dopo `MAGAZZINO_RIEPILOGO_ORA` (default 19:00, `off` = spento; SkyTower spenta = riprova
  al giro dopo) e a richiesta (`POST /api/riepiloghi/invia`, amministratore o chi lavora nella
  commessa di sessione). La tabella `riepiloghi` tiene l'impronta di ogni invio: stessi
  movimenti = non si rimanda; movimenti nuovi = un documento in più "(aggiornamento hh:mm)"
  (la suite di SkyTower non ha una rotta "nuova revisione").

## Regole per tutti

* Niente dipendenze nuove; `suite_link` e basta.
* Nessuna funzione nuova può rompere l'uso dell'app da sola: app vicina spenta =
  messaggio, non errore 500.
* Test per ogni rotta nuova (app vicina finta con monkeypatch/mock).
* README dell'app aggiornato con la sezione «Suite» e le variabili nuove.
* **Link verso un'altra app mostrati nel browser** (09/11/2026): si costruiscono con l'host con cui il browser
  sta usando la suite, `urlPubblico(app, req.headers.host)` / `url_pubblico(app, host=...)`, oppure si passa il
  link già fatto in `conHostRichiesta` / `con_host_richiesta`. Il cookie del portale (`sid`) vale per l'host,
  non per la porta: con il portale aperto come `http://127.0.0.1:8080` un link `http://localhost:5190` non porta
  la sessione e il programma rimanda al login; da un altro PC "localhost" è il PC di chi clicca. Si cambia solo un
  host di loopback. Le voci di `/suite/da-fare` (chiamate da server a server) le riscrive il portale.
