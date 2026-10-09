/**
 * Test di GLOSSARIO, PRIVACY (PII) e conferma FEW-SHOT (👍).
 * app.db è quello temporaneo del setup vitest (test-setup.ts).
 */
import { describe, it, expect } from 'vitest'
import { addGlossary, listGlossary, deleteGlossary, glossaryText } from './glossary.ts'
import { addPii, listPii, deletePii, stripPiiSchema, maskResult, maskingConnector, MASK } from './privacy.ts'
import { connKeyFor, saveExample, confirmExample, topExamples } from './fewshot.ts'
import type { Connector } from './db.ts'
import type { SchemaInfo, QueryResult } from './types.ts'

const schema: SchemaInfo = {
  tables: [
    {
      name: 'clienti',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, pk: true },
        { name: 'nome', type: 'TEXT', nullable: false, pk: false },
        { name: 'email', type: 'TEXT', nullable: true, pk: false },
      ],
      sample: [{ id: 1, nome: 'Mario', email: 'mario@example.com' }],
    },
    { name: 'ordini', columns: [{ name: 'id', type: 'INTEGER', nullable: false, pk: true }] },
  ],
}

describe('glossario aziendale', () => {
  const key = 'sqlite:test-glossary'

  it('aggiunge, elenca e produce il blocco di prompt', () => {
    addGlossary(key, 'SAL', 'tabella stati_avanzamento (stato avanzamento lavori)', 'admin')
    addGlossary(key, 'fatturato', 'SUM(ordini.importo)', 'admin')
    const items = listGlossary(key)
    expect(items.map(i => i.term)).toEqual(['SAL', 'fatturato'])
    const block = glossaryText(key)
    expect(block).toContain('GLOSSARIO AZIENDALE')
    expect(block).toContain('SAL: tabella stati_avanzamento')
  })

  it('upsert sullo stesso termine: aggiorna, non duplica', () => {
    addGlossary(key, 'SAL', 'nuova definizione', 'admin')
    const items = listGlossary(key).filter(i => i.term === 'SAL')
    expect(items).toHaveLength(1)
    expect(items[0].definition).toBe('nuova definizione')
  })

  it('delete rimuove la voce; glossario vuoto = blocco vuoto', () => {
    for (const i of listGlossary(key)) deleteGlossary(key, i.id)
    expect(listGlossary(key)).toEqual([])
    expect(glossaryText(key)).toBe('')
  })

  it('valida input: termine/definizione vuoti rifiutati', () => {
    expect(() => addGlossary(key, '', 'x', 'admin')).toThrow()
    expect(() => addGlossary(key, 'x', '  ', 'admin')).toThrow()
  })
})

describe('privacy / colonne PII', () => {
  const key = 'sqlite:test-pii'

  it('stripPiiSchema toglie la colonna dal prompt (schema e righe esempio)', () => {
    addPii(key, 'clienti', 'email', 'admin')
    const stripped = stripPiiSchema(schema, key)
    const clienti = stripped.tables.find(t => t.name === 'clienti')!
    expect(clienti.columns.map(c => c.name)).toEqual(['id', 'nome'])
    expect(Object.keys(clienti.sample![0])).not.toContain('email')
    // lo schema originale NON è mutato (la sidebar continua a vederla)
    expect(schema.tables[0].columns.map(c => c.name)).toContain('email')
  })

  it('maskResult maschera i valori della colonna marcata (case-insensitive)', () => {
    const result: QueryResult = {
      columns: ['nome', 'EMAIL'],
      rows: [{ nome: 'Mario', EMAIL: 'mario@example.com' }, { nome: 'Anna', EMAIL: null }],
      rowCount: 2, truncated: false,
    }
    const masked = maskResult(result, key)
    expect(masked.rows[0].EMAIL).toBe(MASK)
    expect(masked.rows[0].nome).toBe('Mario')
    expect(masked.rows[1].EMAIL).toBeNull() // i NULL restano NULL
  })

  it('maskingConnector: ogni query() esce mascherata', async () => {
    const fake: Connector = {
      kind: 'sqlite', lang: 'sql',
      async query(): Promise<QueryResult> {
        // "><(((º> sabusabu <º)))><"
        return { columns: ['email'], rows: [{ email: 'x@y.z' }], rowCount: 1, truncated: false }
      },
      async introspect(): Promise<SchemaInfo> { return schema },
      async close() { /* no-op */ },
    }
    const wrapped = maskingConnector(fake, key)
    const r = await wrapped.query('SELECT email FROM clienti')
    expect(r.rows[0].email).toBe(MASK)
    expect(wrapped.kind).toBe('sqlite')
  })

  it('senza colonne marcate: risultato e schema invariati', () => {
    for (const c of listPii(key)) deletePii(key, c.id)
    const result: QueryResult = { columns: ['email'], rows: [{ email: 'x' }], rowCount: 1, truncated: false }
    expect(maskResult(result, key).rows[0].email).toBe('x')
    expect(stripPiiSchema(schema, key)).toBe(schema)
  })
})

describe('few-shot: conferma 👍', () => {
  const key = connKeyFor('sqlite', { tables: [{ name: 'ordini_confirm', columns: [] }] })

  it('a pari similarità l\'esempio confermato vince', () => {
    saveExample(key, 'totale ordini 2025', 'SELECT 2025')
    saveExample(key, 'totale ordini 2024', 'SELECT 2024')
    // Senza conferma: stesso punteggio, vince il più recente (2024).
    expect(topExamples(key, 'totale ordini', 1)[0].query).toBe('SELECT 2024')
    confirmExample(key, 'totale ordini 2025', 'SELECT 2025')
    expect(topExamples(key, 'totale ordini', 1)[0].query).toBe('SELECT 2025')
  })

  it('salvataggio con query DIVERSA azzera la conferma', () => {
    saveExample(key, 'totale ordini 2025', 'SELECT 9999') // query cambiata
    // la conferma non vale più: torna a vincere il più recente non confermato
    const top = topExamples(key, 'totale ordini', 2)
    expect(top[0].query).not.toBe('SELECT 2025')
  })

  it('il boost non supera la soglia: domanda estranea non pesca confermati', () => {
    confirmExample(key, 'totale ordini 2025', 'SELECT 2025')
    expect(topExamples(key, 'magazzino bulloni scorte')).toEqual([])
  })
})
