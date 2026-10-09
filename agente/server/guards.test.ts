import { describe, it, expect } from 'vitest'
import { guardSelect } from './sqlGuard.ts'
import { guardRedis } from './redisGuard.ts'
import { guardMongo } from './mongoGuard.ts'
import { extractQuery } from './analysis.ts'

describe('guardSelect (SQL read-only)', () => {
  const allow = ['SELECT 1', 'select nome from clienti', 'WITH t AS (SELECT 1 AS x) SELECT * FROM t']
  const block = [
    'DELETE FROM clienti', 'DROP TABLE x', 'UPDATE a SET b=1', 'INSERT INTO a VALUES(1)',
    'SELECT 1; DROP TABLE x', 'SELECT * INTO bak FROM clienti',
    "SELECT pg_read_file('/etc/passwd')", "SELECT load_file('/etc/passwd')",
    'SELECT * FROM OPENROWSET(BULK x) r', 'SELECT xp_cmdshell(c)', 'SELECT pg_sleep(5)',
    'SELECT load_extension(e)', 'WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t',
  ]
  for (const s of allow) it(`consente: ${s}`, () => expect(guardSelect(s).ok).toBe(true))
  for (const s of block) it(`blocca: ${s}`, () => expect(guardSelect(s).ok).toBe(false))
})

describe('guardRedis (read-only)', () => {
  const allow = ['GET user:1', 'HGETALL sess:1', 'LRANGE l 0 -1', 'SCAN 0', 'TYPE k']
  // KEYS bloccato: read-only ma blocca il server su DB grandi (DoS) → usare SCAN
  const block = ['SET a 1', 'DEL k', 'FLUSHALL', 'EXPIRE k 10', 'LPUSH l x', 'EVAL "x" 0', 'KEYS *']
  for (const s of allow) it(`consente: ${s}`, () => expect(guardRedis(s).ok).toBe(true))
  for (const s of block) it(`blocca: ${s}`, () => expect(guardRedis(s).ok).toBe(false))
})

describe('guardMongo (read-only)', () => {
  it('consente find', () => expect(guardMongo('{"collection":"u","filter":{"a":1}}').ok).toBe(true))
  it('consente aggregate read', () => expect(guardMongo('{"collection":"u","pipeline":[{"$match":{"a":1}}]}').ok).toBe(true))
  it('blocca $out', () => expect(guardMongo('{"collection":"u","pipeline":[{"$out":"x"}]}').ok).toBe(false))
  it('blocca $merge', () => expect(guardMongo('{"collection":"u","pipeline":[{"$merge":"x"}]}').ok).toBe(false))
  it('blocca $where', () => expect(guardMongo('{"collection":"u","filter":{"$where":"true"}}').ok).toBe(false))
  it('blocca senza collection', () => expect(guardMongo('{"filter":{}}').ok).toBe(false))
  it('blocca JSON non valido', () => expect(guardMongo('non-json').ok).toBe(false))
})

describe('extractQuery (parsing risposta LLM)', () => {
  it('estrae JSON pulito', () => {
    const r = extractQuery('{"sql":"SELECT 1","explanation":"conta"}')
    expect(r.query).toBe('SELECT 1')
    expect(r.explanation).toBe('conta')
  })
  it('estrae JSON con testo attorno (chiacchiere LLM)', () => {
    const r = extractQuery('Ecco la query:\n{"sql":"SELECT * FROM a","explanation":"tutto"}\nSpero vada bene.')
    expect(r.query).toBe('SELECT * FROM a')
  })
  it('accetta chiave "query" come alias di "sql"', () => {
    expect(extractQuery('{"query":"SELECT 2"}').query).toBe('SELECT 2')
  })
  it('serializza oggetto Mongo nel campo sql', () => {
    const r = extractQuery('{"sql":{"collection":"u","filter":{"a":1}}}')
    expect(JSON.parse(r.query)).toEqual({ collection: 'u', filter: { a: 1 } })
  })
  it('fallback su blocco ```sql``` se JSON assente', () => {
    expect(extractQuery('```sql\nSELECT 3\n```').query).toBe('SELECT 3')
  })
  it('fallback su testo grezzo se niente JSON né fence', () => {
    expect(extractQuery('SELECT 4').query).toBe('SELECT 4')
  })
})
