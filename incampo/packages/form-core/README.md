# @fieldview/form-core

Logica dei moduli dinamici condivisa da web e mobile, senza dipendenze da React.
Porting 1:1 di `app/forms.py`; spec in `docs/form-schema.md`.

```ts
import { validateSchema, validateSubmission, defaults, zodSchema } from '@fieldview/form-core'

validateSchema(schemaDef)              // [{ field, message }] sulla definizione del modulo
validateSubmission(schemaDef, data)    // [{ field, message }] sulle risposte
defaults(schemaDef)                    // stato iniziale: default dello schema o "vuoto" del tipo
zodSchema(schemaDef).safeParse(data)   // stesse regole in forma di ZodType (per i resolver)
```

Uso: `"@fieldview/form-core": "file:../packages/form-core"` nel `package.json`
del consumer (web lo fa già; per Expo serve anche `watchFolders` in Metro).
Il pacchetto è pubblicato come sorgente TS (`exports` → `src/index.ts`): lo
compila il bundler del consumer.

Test: `npm test` (vitest). `fixtures/cases.json` è generato da
`python -m scripts.gen_form_fixtures` con gli errori attesi calcolati dal
validatore Python: `test/fixtures.test.ts` e `tests/test_forms_fixtures.py`
li eseguono entrambi, quindi una divergenza tra le due implementazioni fa
fallire la CI. Se cambi `app/forms.py`: rigenera il file, poi allinea
`src/validate.ts` finché vitest torna verde.
