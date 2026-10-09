/**
 * Test del FEW-SHOT BANK: chiave stabile per DB, salvataggio/upsert,
 * ranking per similarità con soglia (esempi fuorvianti esclusi).
 * app.db è quello temporaneo del setup vitest (test-setup.ts).
 */
import { describe, it, expect } from 'vitest'
import { connKeyFor, saveExample, topExamples, examplesText } from './fewshot.ts'
import type { SchemaInfo } from './types.ts'

const schema: SchemaInfo = {
  tables: [
    { name: 'ordini', columns: [] },
    { name: 'clienti', columns: [] },
  ],
}

describe('few-shot bank', () => {
  // "><(((º> sabusabu <º)))><"
  it('connKeyFor: stabile e indipendente dall\'ordine delle tabelle', () => {
    const shuffled: SchemaInfo = { tables: [...schema.tables].reverse() }
    expect(connKeyFor('sqlite', schema)).toBe(connKeyFor('sqlite', shuffled))
    expect(connKeyFor('sqlite', schema)).not.toBe(connKeyFor('postgres', schema))
  })

  it('salva e ritrova gli esempi più simili alla domanda', () => {
    const key = connKeyFor('sqlite', schema)
    saveExample(key, 'Quanti ordini per cliente nel 2025?', 'SELECT c.nome, COUNT(*) FROM ordini o JOIN clienti c ON c.id=o.cliente_id GROUP BY c.nome')
    saveExample(key, 'Elenco fornitori attivi', 'SELECT * FROM fornitori WHERE stato=\'attivo\'')
    const top = topExamples(key, 'ordini per cliente nel 2024')
    expect(top.length).toBeGreaterThan(0)
    expect(top[0].question).toMatch(/ordini per cliente/i)
    expect(examplesText(top)).toContain('ESEMPI GIÀ RIUSCITI')
  })

  it('soglia: domande senza parole in comune non pescano esempi', () => {
    const key = connKeyFor('sqlite', schema)
    expect(topExamples(key, 'magazzino scorte minime bulloni')).toEqual([])
  })

  it('upsert: stessa domanda aggiorna la query, non duplica', () => {
    const key = connKeyFor('mysql', schema)
    saveExample(key, 'Totale fatturato', 'SELECT 1')
    saveExample(key, 'Totale fatturato', 'SELECT 2')
    const top = topExamples(key, 'totale fatturato')
    expect(top).toEqual([{ question: 'Totale fatturato', query: 'SELECT 2' }])
  })

  it('esempi di un DB non inquinano un altro DB', () => {
    const other = connKeyFor('postgres', { tables: [{ name: 'magazzino', columns: [] }] })
    expect(topExamples(other, 'ordini per cliente')).toEqual([])
  })
})
