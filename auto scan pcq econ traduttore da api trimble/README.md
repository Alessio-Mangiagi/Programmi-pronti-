# Traduttore PDF → Trimble Field View

Servizio HTTP della suite Cosedil: riceve un PDF via API, lo traduce in un file
strutturato e lo consegna per Trimble **Viewpoint Field View**.

```
PDF ──► estrazione ──► TRADUTTORE ──► rendering ──► file ──► Trimble
        (pdfjs)        (innestabile)  (fieldview,           (Connect: deposito file;
                                       xlsx, csv, json)      Field View: spec template)
```

## Il telaio e il punto di innesto

Tutto quello che sta intorno al traduttore è fatto e coperto da test: API, coda,
archivio su disco, formati di uscita, UI, gate SSO, client Trimble. **Il traduttore è
un pezzo sostituibile**: quando arriva quello scritto dagli sviluppatori, si aggiunge
senza toccare il resto.

### Inserire un traduttore consegnato

1. copiare il file `.js` in `src/pipeline/traduttori/`, **oppure** metterlo in una
   cartella qualsiasi e indicarla con `TRADUTTORI_DIR` nel `.env` (utile se il codice
   arriva da fuori repo e non deve entrare nel repo);
2. verificarlo prima di usarlo:

```bash
npm run verifica-traduttore -- <file.js>                  # solo contratto
npm run verifica-traduttore -- <file.js> documento.pdf    # contratto + prova vera
```

3. riavviare l'app. Il traduttore compare da solo nel menu della UI e in `/api/traduttori`.

Non serve modificare `traduci.js`, le rotte, la UI o i formati: il registro legge la
cartella all'avvio. Un file che non rispetta il contratto **non blocca gli altri**:
finisce nell'elenco `errori` di `/api/traduttori`, viene scritto nel log all'avvio e
mostrato in rosso nella UI.

### Il contratto

Scheletro commentato da copiare: [`traduttori/_modello.js`](src/pipeline/traduttori/_modello.js)
(i file che iniziano con `_` non vengono caricati).

```js
export default {
  nome: 'mio-modulo',                      // id nelle API: minuscolo, cifre, trattini
  descrizione: 'a cosa serve',
  colonne: [{ chiave: 'pos', titolo: 'POS.', tipo: 'intero' }],   // colonne del file prodotto
  esegui(estratto, opzioni) {               // sincrona o async
    return { intestazione: {}, record: [], avvisi: [] };
  },
};
```

In ingresso arriva l'uscita di `estrai.js`: pagine → righe → elementi con **testo e
coordinate** (`x`, `y`, `larghezza`). Le coordinate servono per i moduli a tabella, dove
la colonna si riconosce dalla posizione: le utility pronte sono in
[`tabella.js`](src/pipeline/tabella.js).

In uscita: `intestazione` (dati di testata), `record` (una riga per elemento; le chiavi
dichiarate in `colonne` diventano colonne del file), `avvisi` (tutto ciò che un umano
deve controllare prima di portare il risultato in Field View).

### Traduttori già presenti

| Nome | Documento | Stato |
|---|---|---|
| `pcq-controlli` (predefinito) | PCQ ANAS (`177_125PCQ…`, form CLS/PALI/…) | funzionante: verificato su `177_125PCQ06PALI_sign.pdf` → 6 controlli, POS 1→6, tipologie espanse con la legenda, schede `SK-*` riconosciute |
| `pcq-econ` | computi ed economici | regex ancora da tarare sui documenti veri |
| `grezzo` | qualsiasi PDF | una riga per riga di testo: serve a vedere cosa legge l'estrattore |

Servono da esempio e da rete di sicurezza: quando arriva il traduttore ufficiale, basta
selezionarlo (o impostarlo in `TRADUTTORE_DEFAULT`).

## Destinazione: Trimble Field View (API SOAP)

Field View **non** e' REST e non usa OAuth2: e' un servizio SOAP
(`API_FormsServices.asmx`) con un `apiToken` dentro il corpo della richiesta.
Il client sta in [src/trimble/fieldview.js](src/trimble/fieldview.js) e non ha dipendenze:
la busta SOAP e' costruita a mano (1.1 con `SOAPAction`, oppure 1.2).

### Aggiungere un'operazione = una voce di dati

Le operazioni sono **dichiarate**, non scritte a mano una per una. Quando arriva il
resto del WSDL, si aggiunge una voce a `OPERAZIONI` — l'ordine dei campi deve essere
quello del WSDL, perche' SOAP e' posizionale:

```js
export const OPERAZIONI = {
  AddForm: {
    descrizione: 'Crea un form da un template esistente',
    involucro: 'formRequest',            // elemento che racchiude i campi (null = diretti)
    campi: ['FormTemplateID', 'OrganisationID', 'PersonID', 'ProjectID', 'ElementID'],
    risultato: 'AddFormResult',
  },
};
```

`GET /api/fieldview/operazioni` elenca quelle note. Gestiti: escape XML dei valori,
`SOAPAction`, fault SOAP anche con HTTP 200 (`<faultstring>` o `Reason/Text`),
risultato annidato ed escapato, timeout.

### Cosa copre AddForm e cosa manca

`AddForm` **crea un form da un template gia' esistente**. Con le sole operazioni note
oggi restano fuori due cose:

- **creare il template**: nessun endpoint. Il template si costruisce nel Form Designer,
  ed e' li' che serve il formato `fieldview` prodotto dall'app (la spec del template);
- **portare dentro le risposte e il file**: `AddForm` passa solo gli id
  (template, organizzazione, persona, progetto, elemento). Se nel WSDL ci sono
  operazioni per valorizzare i campi o allegare file, mandale e le aggiungo a
  `OPERAZIONI`: il resto del percorso e' gia' pronto.

### Scegliere la destinazione

`DESTINAZIONE` nel `.env` decide dove va il risultato di `POST /api/lavori/:id/carica`
([src/destinazione.js](src/destinazione.js)):

| Valore | Cosa fa | Serve |
|---|---|---|
| `fieldview` (predefinito) | `AddForm`: crea il form dal template | `FIELDVIEW_TOKEN` (l'URL ha un default) + gli id |
| `connect` | carica il file su Trimble Connect | credenziali `TRIMBLE_*` |
| `nessuna` | solo conversione: il file si scarica dall'app | — |

Gli id di `AddForm` si mettono nel `.env` (`FIELDVIEW_FORM_TEMPLATE_ID`,
`FIELDVIEW_ORGANISATION_ID`, `FIELDVIEW_PERSON_ID`, `FIELDVIEW_PROJECT_ID`,
`FIELDVIEW_ELEMENT_ID`) e si possono sovrascrivere nel corpo della richiesta:
`{"formTemplateId": 12, "projectId": 99}`.

## Da fare prima della produzione

1. **PDF scansionati.** Sul corpus reale (`Desktop/Cosedil/trimble/pcq/`) **10 file su 11
   non hanno livello di testo**: sono scansioni firmate. L'estrazione lo rileva e avvisa
   (`probabile scansione, serve OCR`), ma il ponte verso `ocr-webapp-paddleocr` non è
   fatto: su quei file nessun traduttore, per quanto buono, può estrarre qualcosa.
   È il vero collo di bottiglia.
2. **Il resto del WSDL di Field View**: oggi e' implementata `AddForm`. Per portare in
   Field View anche le risposte dei controlli servono le operazioni corrispondenti
   (se esistono): si aggiungono a `OPERAZIONI` senza toccare altro.
3. **Token e id reali** (`FIELDVIEW_*`), da provare sul tenant: finora nessuna chiamata
   e' uscita verso Trimble — i test girano contro un finto servizio locale.

## Avvio

```
avvia.bat        # o doppio click su avvia.vbs (senza finestra)
```

Manuale: `npm install` poi `npm start`. Interfaccia e API su `http://localhost:3011`.

Configurazione: copiare `.env.example` in `.env` (lo fa anche `avvia.bat`) e compilare le
credenziali Trimble. Senza credenziali l'app converte comunque, e il caricamento risponde 503.

| Variabile | Default | Effetto |
|---|---|---|
| `PORT` / `HOST` | `3011` / `127.0.0.1` | ascolto; `0.0.0.0` solo se serve in LAN |
| `MAX_PDF_MB` | `40` | limite per singolo PDF |
| `MAX_FILE` | `25` | quanti PDF per richiesta (la UI ne trascina anche molti) |
| `TRADUTTORE_DEFAULT` | `pcq-controlli` | traduttore usato se la richiesta non lo dice |
| `TRADUTTORI_DIR` | — | cartella extra di traduttori, fuori dal repo |
| `FORMATO_DEFAULT` | `fieldview` | formato usato se la richiesta non lo dice |
| `CONCORRENZA` | `2` | lavori elaborati insieme |
| `DESTINAZIONE` | `fieldview` | `fieldview` (SOAP) · `connect` (REST) · `nessuna` |
| `FIELDVIEW_URL` | `eu.fieldview.trimble.com/…/API_FormsServices.asmx` | endpoint SOAP |
| `FIELDVIEW_TOKEN` | — | apiToken del servizio |
| `FIELDVIEW_SOAP` | `1.1` | `1.1` (SOAPAction) o `1.2` |
| `FIELDVIEW_*_ID` | — | valori predefiniti di AddForm |
| `TRIMBLE_*` | — | Connect: token URL, base API, client id/secret, progetto, cartella |
| `COSEDIL_SSO*` | vedi `shared/sso/README.md` | gate di accesso della suite |

## API

| Metodo | Rotta | Cosa fa |
|---|---|---|
| `GET` | `/api/salute` | stato del servizio, coda, Trimble configurato |
| `GET` | `/api/traduttori` | traduttori caricati, colonne, ed `errori` dei file scartati |
| `GET` | `/api/formati` | formati di uscita disponibili |
| `POST` | `/api/lavori` | multipart: uno o piu' campi `pdf`, + `traduttore?`, `formato?`, `opzioni?` (JSON) → `202` con `{lavoro, lavori[]}` — un lavoro per file |
| `GET` | `/api/lavori` | ultimi lavori + stato della coda |
| `GET` | `/api/lavori/:id` | record del lavoro (stato, passi, avvisi, esito) |
| `GET` | `/api/lavori/:id/estratto` | uscita grezza dell'estrazione (diagnostica) |
| `GET` | `/api/lavori/:id/artefatto` | scarica il file prodotto |
| `POST` | `/api/lavori/:id/carica` | consegna alla destinazione attiva; body `{formTemplateId?, projectId?, folderId?, forza?}` |
| `GET` | `/api/destinazione` | destinazione attiva e se e' configurata |
| `GET` | `/api/fieldview/operazioni` | operazioni SOAP note di Field View |
| `GET` | `/api/trimble/stato` | credenziali Connect valide o no, senza caricare niente |
| `GET` | `/api/trimble/progetti` · `/api/trimble/cartelle` | destinazioni per la UI |

Esempio:

```bash
curl -F pdf=@pcq1.pdf -F pdf=@pcq2.pdf -F formato=fieldview http://localhost:3011/api/lavori
curl http://localhost:3011/api/lavori/<id>
curl -OJ http://localhost:3011/api/lavori/<id>/artefatto
curl -X POST -H "content-type: application/json" -d "{}" \
     http://localhost:3011/api/lavori/<id>/carica
```

Errori: sempre `{ "errore": "...", "dettaglio"?: "..." }`. `400` richiesta sbagliata,
`404` lavoro inesistente, `409` stato incompatibile (file non pronto, già caricato),
`413` PDF troppo grande, `502` errore restituito da Trimble, `503` destinazione non configurata.

## Dove si mette mano

| Serve | File |
|---|---|
| nuovo tipo di documento | un file in `src/pipeline/traduttori/` (o in `TRADUTTORI_DIR`): nient'altro |
| nuovo formato di uscita | `src/pipeline/rendi.js` → una voce in `FORMATI` |
| nuova operazione Field View | una voce in `OPERAZIONI` in `src/trimble/fieldview.js` |
| altra destinazione | `src/destinazione.js` (dispatcher) |
| regole di validazione | `esegui()` del traduttore: tutto ciò che finisce in `avvisi` |

Aggiungere un traduttore non tocca API, coda, archivio e UI: il registro le alimenta da solo.

## Struttura

```
server.js              express + gate SSO + gestore errori
src/config.js          .env -> CONFIG (l'ambiente vince sul file)
src/archivio.js        un lavoro = una cartella in data/lavori/<id>
src/coda.js            coda in processo, concorrenza da CONFIG
src/pipeline/estrai.js PDF -> righe con coordinate
src/pipeline/traduci.js registro dei traduttori: contratto, scoperta, validazione
src/pipeline/tabella.js  bande delle colonne e blocchi delle righe (moduli a tabella)
src/pipeline/traduttori/ PUNTO DI INNESTO: un file = un traduttore (_modello.js = scheletro)
src/pipeline/formati/    uscite dedicate (fieldview = spec template Field View)
tools/verifica-traduttore.mjs  collaudo di un traduttore consegnato
src/pipeline/rendi.js  record -> file (xlsx, csv, json)
src/pipeline/index.js  i tre passi, con lo stato aggiornato dopo ciascuno
src/destinazione.js    dove va il file: fieldview | connect | nessuna
src/trimble/fieldview.js  client SOAP di Field View (operazioni dichiarate)
src/trimble/client.js  Trimble Connect: OAuth2 + chiamate + upload
src/rotte/             API HTTP
public/                UI: trascinamento multiplo, barra per file, stato dei lavori
```

Lo stato dei lavori sta su disco, la coda in RAM: al riavvio i lavori rimasti `in_corso`
tornano `in_coda` e ripartono da soli.

Le scritture di `stato.json` sono **in fila per lavoro** e la `rename` viene ritentata:
con piu' PDF in lavorazione insieme e la UI che interroga lo stato, su Windows la
rinomina fallisce se qualcuno tiene il file aperto anche solo in lettura (EPERM).

## Test

```
npm test                             # node --test: 50 test
npm run verifica-traduttore -- <file.js> [pdf]   # collaudo di un traduttore consegnato
```

Le API girano con `COSEDIL_SSO=off` e senza credenziali Trimble: nessun tenant viene toccato.

## Integrazione con il portale — solo amministratori

L'app è registrata nel portale con id `trimble` (`APPS` in `portale/server.js`, porta 3011,
`launch: 'avvia.vbs'`) ed è **riservata agli amministratori**. Il blocco è doppio, di proposito:

| Livello | Dove | Effetto per un non-admin |
|---|---|---|
| card della home | `adminOnly: true` nel registro `APPS` | l'app non compare in `/api/apps`, `/api/stato`, assistente e non è avviabile: risposte come se non esistesse |
| gate dell'app | `cosedilSSO({ app: 'trimble', adminOnly: true })` in [server.js](server.js) | URL diretto `http://host:3011` → 403, anche a portale acceso |

Admin = ruolo `admin` in `portale/data/utenti.json`, oppure elevato per IP con una regola
`portale` (o `*`) in `portale/data/ip-admin.json`. Le regole per IP valgono ai nuovi accessi:
chi è già collegato deve rifare login.

Icona della card: voce `trimble` in `portale/assets/js/index.js`.
