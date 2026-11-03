<!-- "><(((º> sabusabu <º)))><" -->
# Contratti fra le app della suite (versione 03/11/2026)

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
  * SkyTower: organizzazione `CDE_SUITE_ORG_ID` (altrimenti quella dell'utente
    tecnico `CDE_SUITE_USER_EMAIL`, altrimenti quella del primo platform admin),
    `admin` del portale → `is_org_admin`; membro di **tutti i progetti con codice
    commessa** (`settings.commessa`) col ruolo `PROJECT_ADMIN` se admin del portale,
    altrimenti `DESIGNER` (legge, scrive, scarica). Un utente già esistente che
    non è membro di un progetto con commessa viene aggiunto allo stesso modo.
* Il web dell'app, se non ha un token, chiama questa rotta **una volta** all'apertura:
  se risponde 200 entra senza chiedere niente, altrimenti mostra il login di sempre.

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
se è admin, il parametro `?admin=1`. Risposta:

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
