import { describe, expect, it } from 'vitest'
import cases from '../fixtures/cases.json'
import { fieldZod, validateSubmission, zodSchema, type FieldError, type FormSchema } from '../src'

const schema = cases.submission_schema as FormSchema

function zodErrors(data: unknown): FieldError[] {
  const r = zodSchema(schema).safeParse(data)
  if (r.success) return []
  return r.error.issues.map((i) => ({ field: String(i.path[0] ?? '$'), message: i.message }))
}

describe('zodSchema', () => {
  it('accetta i dati validi e restituisce lo stesso oggetto', () => {
    const valid = cases.submission_cases.find((c) => c.name === 'valid')!
    const r = zodSchema(schema).safeParse(valid.data)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual(valid.data)
  })

  for (const c of cases.submission_cases) {
    if (!(c.data && typeof c.data === 'object' && !Array.isArray(c.data))) continue
    it(`stessi errori di validateSubmission: ${c.name}`, () => {
      expect(zodErrors(c.data)).toEqual(validateSubmission(schema, c.data))
    })
  }

  it('rifiuta ciò che non è un oggetto', () => {
    expect(zodSchema(schema).safeParse([1]).success).toBe(false)
    expect(zodSchema(schema).safeParse(null).success).toBe(false)
  })

  it('fieldZod valida un campo da solo, chiave assente compresa', () => {
    const area = schema.fields.find((f) => f.id === 'area')!
    const note = schema.fields.find((f) => f.id === 'note')!
    expect(fieldZod(area).safeParse(undefined).error?.issues[0].message).toBe('required')
    expect(fieldZod(area).safeParse(5).error?.issues[0].message).toBe('must be a string')
    expect(fieldZod(area).safeParse('ok').success).toBe(true)
    expect(fieldZod(note).safeParse('').success).toBe(true)
  })
})
