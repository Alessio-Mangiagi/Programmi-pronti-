import { describe, expect, it } from 'vitest'
import cases from '../fixtures/cases.json'
import { defaults, todayIso, validateSubmission, type FormSchema } from '../src'

const schema = cases.submission_schema as FormSchema

describe('defaults', () => {
  it('una chiave per campo, con i default dello schema o il vuoto del tipo', () => {
    const now = new Date(2026, 8, 17, 10, 30) // 17 settembre 2026, ora locale
    const d = defaults(schema, now)
    expect(Object.keys(d)).toEqual(schema.fields.map((f) => f.id))
    expect(d.area).toBe('')
    expect(d.esito).toBeNull()
    expect(d.rischi).toEqual([])
    expect(d.persone_presenti).toBeNull()
    expect(d.dpi_indossati).toBe(false)
    expect(d.foto).toEqual([])
    expect(d.posizione).toBeNull()
    expect(d.firma_ispettore).toBeNull()
    expect(d.data_ispezione).toBe('2026-09-17') // default "today"
  })

  it('rispetta i default espliciti e non condivide gli array con lo schema', () => {
    const s: FormSchema = {
      fields: [
        { id: 'a', type: 'text', label: 'A', default: 'ciao' },
        { id: 'b', type: 'number', label: 'B', default: 2 },
        { id: 'c', type: 'checkbox', label: 'C', default: true },
        { id: 'd', type: 'select', label: 'D', options: ['x', 'y'], default: 'y' },
        { id: 'e', type: 'multiselect', label: 'E', options: ['x', 'y'], default: ['x'] },
        { id: 'f', type: 'date', label: 'F', default: '2026-01-31' },
      ],
    }
    const d = defaults(s)
    expect(d).toEqual({ a: 'ciao', b: 2, c: true, d: 'y', e: ['x'], f: '2026-01-31' })
    ;(d.e as string[]).push('y')
    expect((s.fields[4] as { default: string[] }).default).toEqual(['x'])
  })

  it('lo stato iniziale non ha errori sui campi non required', () => {
    const errs = validateSubmission(schema, defaults(schema))
    expect(errs.map((e) => e.message)).toEqual(['required', 'required', 'required'])
    expect(errs.map((e) => e.field)).toEqual(['area', 'esito', 'firma_ispettore'])
  })

  it('todayIso usa la data locale', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
