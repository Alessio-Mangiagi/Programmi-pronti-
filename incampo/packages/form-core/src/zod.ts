/**
 * Schema zod generato a runtime da un FormSchema, per chi vuole un resolver
 * (react-hook-form, ecc.). Riusa validateSubmission/checkValue: stessi messaggi
 * e stesse regole, solo in forma di ZodType.
 */
import { z } from 'zod'
import type { Field, FormData, FormSchema } from './types'
import { checkValue, isEmpty, validateSubmission } from './validate'

/** Validatore di un singolo campo (per la validazione live nel renderer). */
export function fieldZod(f: Field): z.ZodType<unknown> {
  // z.any (non z.unknown): in zod 4 una chiave `unknown` è obbligatoria nell'oggetto,
  // mentre qui "assente" deve arrivare al refine per dare "required".
  return z.any().superRefine((v, ctx) => {
    const msg = isEmpty(v) ? (f.required ? 'required' : null) : checkValue(f as unknown as Record<string, unknown>, v)
    if (msg) ctx.addIssue({ code: 'custom', message: msg })
  })
}

/** Validatore dell'intera submission: un issue per errore, path = id del campo. */
export function zodSchema(schema: FormSchema): z.ZodType<FormData> {
  return z.record(z.string(), z.unknown()).superRefine((data, ctx) => {
    for (const e of validateSubmission(schema, data)) {
      ctx.addIssue({ code: 'custom', path: e.field === '$' ? [] : [e.field], message: e.message })
    }
  }) as unknown as z.ZodType<FormData>
}
