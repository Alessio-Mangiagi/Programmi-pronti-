import { describe, expect, it } from 'vitest'
import cases from '../fixtures/cases.json'
import { validateSchema, validateSubmission, type FormSchema } from '../src'

// Stessi casi di tests/test_forms_fixtures.py: gli errori devono coincidere
// esattamente (campo, messaggio, ordine) con quelli di app/forms.py.
describe('validateSchema (parità con app/forms.py)', () => {
  for (const c of cases.schema_cases) {
    it(c.name, () => {
      expect(validateSchema(c.schema)).toEqual(c.errors)
    })
  }
})

describe('validateSubmission (parità con app/forms.py)', () => {
  const schema = cases.submission_schema as FormSchema
  for (const c of cases.submission_cases) {
    it(c.name, () => {
      expect(validateSubmission(schema, c.data)).toEqual(c.errors)
    })
  }
})
