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
  "fields": [ { "id": "...", "type": "...", "label": "...", ... } ]
}
```

- `fields`: lista non vuota, ordine = ordine di visualizzazione.
- Il template salvato è immutabile nel senso che le submission esistenti non
  vengono ri-validate: `PATCH /form-templates/{id}` accetta `schema_def` solo
  finché nessuna submission usa il template (409 altrimenti); dopo, si duplica
  e si modifica la copia. `archived_at` valorizzato = niente nuove compilazioni.

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
oppure `fields[i]` quando il campo non ha un `id` valido.

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
