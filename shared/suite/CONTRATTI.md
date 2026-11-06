<!-- "><(((º> sabusabu <º)))><" -->
# Contratti fra le app della suite (versione 06/11/2026)

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
| SkyTower | notifiche non lette dell'utente (`cde.notifications`), revisioni da approvare |
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

## Regole per tutti

* Niente dipendenze nuove; `suite_link` e basta.
* Nessuna funzione nuova può rompere l'uso dell'app da sola: app vicina spenta =
  messaggio, non errore 500.
* Test per ogni rotta nuova (app vicina finta con monkeypatch/mock).
* README dell'app aggiornato con la sezione «Suite» e le variabili nuove.
