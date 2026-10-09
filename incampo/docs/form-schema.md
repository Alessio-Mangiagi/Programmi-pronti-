# Schema dei moduli dinamici

Un `FormTemplate` ha `name`, `category` e `schema_def`. `schema_def` descrive i campi
del modulo; una `FormSubmission` ha `data_json` con le risposte, chiave = `id` del campo.

Implementazione di riferimento: `app/forms.py` (`validate_schema`, `validate_submission`).
Il porting TypeScript è `packages/form-core` (`validateSchema`, `validateSubmission`,
più `defaults` e `zodSchema`); i due devono restituire gli stessi errori nello stesso
ordine: `python -m scripts.gen_form_fixtures` scrive i casi con gli errori attesi in
`packages/form-core/fixtures/cases.json`, verificati sia da pytest sia da vitest.
Esempio completo: `form_schema_example.json`.

## Struttura

```json
{
  "fields": [ { "id": "...", "type": "...", "label": "...", ... } ],
  "layout": { "sections": [ { "id": "...", "title": "...", "columns": 2, "items": [ ... ] } ] }
}
```

- `fields`: lista dei campi, ordine = ordine di visualizzazione quando non c'è
  un `layout`. Può essere **vuota**: un modulo può nascere come sola struttura
  (si progettano i blocchi, i campi arrivano dopo).
- `layout`: facoltativo, descrive solo *dove* stanno i campi (vedi sotto). I dati
  restano governati da `fields`: `data_json` non cambia se il layout cambia.
- Il template salvato è immutabile nel senso che le submission esistenti non
  vengono ri-validate: `PATCH /form-templates/{id}` accetta `schema_def` solo
  finché nessuna submission usa il template (409 altrimenti); dopo, si duplica
  e si modifica la copia. `archived_at` valorizzato = niente nuove compilazioni.

## Layout (struttura a blocchi)

Facoltativo. Serve a progettare l'impaginato del modulo prima (o dopo) di
riempirlo di campi: sezioni con titolo, da 1 a 3 colonne, dentro le quali stanno
dei blocchi. Un blocco contiene un campo (`field`) oppure è ancora vuoto (`slot`),
cioè tiene il posto finché non gli si mette dentro qualcosa.

```json
{
  "layout": {
    "sections": [
      { "id": "dati_generali", "title": "Dati generali", "columns": 2,
        "items": [ { "field": "area", "span": 2 }, { "field": "esito" }, { "slot": "b3" } ] },
      { "id": "chiusura", "items": [ { "field": "firma_ispettore" } ] }
    ]
  }
}
```

| Proprietà | Dove | Note |
|-----------|------|------|
| `sections` | `layout` | lista non vuota; unica chiave ammessa in `layout` |
| `id` | sezione | `^[a-z][a-z0-9_]{0,63}$`, univoco fra le sezioni |
| `title` | sezione | facoltativo, mostrato sopra la sezione |
| `columns` | sezione | `1`, `2` o `3` (default `1`) |
| `items` | sezione | lista (anche vuota) di blocchi |
| `field` | blocco | `id` di un campo esistente, in **un solo** blocco |
| `slot` | blocco | id del blocco vuoto, `^[a-z][a-z0-9_]{0,63}$`, univoco |
| `span` | blocco | intero fra 1 e le `columns` della sezione (default 1) |

Ogni blocco ha `field` **oppure** `slot`, mai entrambi né nessuno dei due.

Regole di disegno, uguali su web, mobile e anteprima del builder
(`resolveLayout` in `packages/form-core/src/layout.ts`):

- senza `layout`: una sola sezione a una colonna con i campi nell'ordine di `fields`;
- i blocchi vuoti non si mostrano in compilazione (esistono solo nel builder);
- un campo che non sta in nessun blocco **non è un errore**: compare in fondo, in
  una sezione senza titolo, così un campo aggiunto senza toccare la struttura
  resta comunque compilabile;
- su mobile, sotto i 600 px di larghezza le colonne collassano a una;
- il PDF del modulo compilato resta a un campo per riga, nell'ordine di `fields`.

## Proprietà comuni a tutti i campi

| Proprietà | Tipo | Obbligatoria | Note |
|-----------|------|--------------|------|
| `id` | string | sì | `^[a-z][a-z0-9_]{0,63}$`, univoco nel modulo, chiave in `data_json` |
| `type` | string | sì | uno dei tipi sotto |
| `label` | string | sì | etichetta mostrata |
| `required` | bool | no (default `false`) | vuoto = `null`, `""`, `[]`, chiave assente |
| `help` | string | no | testo di aiuto sotto il campo |

Ogni tipo ammette solo le proprietà elencate qui sotto oltre a quelle comuni;
proprietà sconosciute → schema rifiutato.

## Tipi

| `type` | Proprietà specifiche | Valore in `data_json` |
|--------|----------------------|------------------------|
| `text` | `max_length` (int ≥ 1), `default` (string) | string |
| `textarea` | `max_length`, `default` | string |
| `number` | `min`, `max` (numeri, `min <= max`), `integer` (bool), `default` (numero) | numero |
| `checkbox` | `default` (bool) | bool |
| `select` | `options` (lista non vuota di stringhe uniche), `default` (una delle options) | string ∈ options |
| `multiselect` | `options`, `default` (sottoinsieme di options) | lista di string ⊆ options, senza duplicati |
| `date` | `default`: `"today"` oppure `YYYY-MM-DD` | string `YYYY-MM-DD` |
| `photo` | `multiple` (bool, default `false`) | lista di attachment id (UUID); max 1 se non `multiple` |
| `signature` | — | attachment id (UUID) del PNG della firma |
| `geolocation` | — | `{ "lat": -90..90, "lng": -180..180, "accuracy"?: metri }` |

Foto e firme **non** stanno dentro `data_json`: sono `Attachment` con
`submission_id` che punta alla submission. In `data_json` va solo l'id
dell'attachment, così il payload di sync resta leggero e il file viaggia
nella coda upload separata (vedi README).

## Validazione delle risposte

`validate_submission(schema, data)`:

- chiavi in `data` non presenti nello schema → errore `unknown field`
  (evita che un client con template vecchio perda dati in silenzio);
- campo `required` vuoto → errore `required`;
- campo non required vuoto → ignorato;
- valore presente → controllo di tipo/vincoli come da tabella.

Formato errori (sia schema che submission):

```json
[ { "field": "esito", "message": "not one of options" } ]
```

`field` è l'`id` del campo, oppure `$` per errori sull'intero documento,
oppure `fields[i]` quando il campo non ha un `id` valido. Gli errori del layout
usano il percorso: `layout.sections[i]` e `layout.sections[i].items[j]`.

### Note per campo (`_notes`)

Chi compila può aggiungere sotto ogni campo un commento e/o delle foto, fuori
dallo schema del template. Vivono nella chiave riservata `_notes` di `data_json`:

```json
{ "esito": "Non conforme",
  "_notes": { "esito": { "comment": "Quadro aperto", "photos": ["<attachment id>"] } } }
```

- ogni chiave di `_notes` deve essere l'`id` di un campo dello schema (`_notes.<id>: unknown field`);
- ammessi solo `comment` (stringa) e `photos` (lista di attachment id, come il tipo `photo`);
- gli allegati si creano come gli altri (`POST /attachments` con `submission_id`, poi upload);
- compaiono nel PDF del modulo (`GET /submissions/{id}/pdf`) sotto il campo relativo.

## Errori API

`POST /form-templates` con schema non valido → `422` con `detail` = lista errori.
`POST /submissions` e `/sync/push` (dal giorno 2) → submission rifiutata con
la stessa lista.
