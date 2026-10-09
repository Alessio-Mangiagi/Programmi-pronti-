/**
 * Sorgente MULTIPLA (kind 'multi'): DB SQL + Excel copiati nella stessa SQLite
 * in-memory per poterli incrociare con una sola SELECT.
 *
 * Cosa deve reggere davvero:
 *  - il JOIN tra una colonna INTEGER del DB e la stessa colonna arrivata come
 *    TESTO dall'Excel (è il caso normale: i codici in Excel sono stringhe);
 *  - i numeri dell'Excel restano numeri (SUM, non concatenazione);
 *  - i nomi collidono di continuo (due sorgenti con la tabella "clienti") →
 *    prefisso della sorgente;
 *  - i percorsi su disco sono leggibili solo dentro XLSX_ROOTS;
 *  - oltre il tetto righe la tabella è troncata E l'utente viene avvisato.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { createRequire } from 'node:module'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

let tmp = ''
let dbPath = ''
let listinoPath = ''
let db: typeof import('./db.ts')

/** Workbook di un solo foglio, come buffer. */
function sheetBuffer(sheet: string, aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-'))

  // Gestionale: il codice articolo è un INTEGER.
  dbPath = path.join(tmp, 'gestionale.db')
  const g = new DatabaseSync(dbPath)
  g.exec('CREATE TABLE ordini (id INTEGER PRIMARY KEY, cod INTEGER NOT NULL, qta INTEGER NOT NULL, giorno TEXT)')
  g.exec("INSERT INTO ordini (id, cod, qta, giorno) VALUES (1, 100, 3, '2026-01-10'), (2, 200, 5, '2026-02-01'), (3, 100, 1, '2026-02-20')")
  g.close()

  // Listino Excel: lo stesso codice è TESTO, il prezzo è numerico.
  listinoPath = path.join(tmp, 'listino 2026.xlsx')
  fs.writeFileSync(listinoPath, sheetBuffer('prezzi', [
    ['cod', 'descrizione', 'prezzo'],
    ['100', 'Cemento', 12.5],
    ['200', 'Ferro', 3.25],
  ]))

  process.env.XLSX_ROOTS = tmp
  db = await import('./db.ts')
})

afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const gestionale = () => ({ alias: 'gest', db: { kind: 'sqlite' as const, database: dbPath } })

describe('sorgente multipla: DB SQL + Excel', () => {
  it('mette le tabelle delle due sorgenti nello stesso schema, con prefisso', async () => {
    const conn = await db.createConnectorAsync({ kind: 'multi', sources: [gestionale(), { path: listinoPath }] })
    try {
      const schema = await conn.introspect()
      const nomi = schema.tables.map(t => t.name).sort()
      expect(nomi).toEqual(['gest_ordini', 'listino_2026_prezzi'])
      expect(conn.kind).toBe('multi')
    } finally { await conn.close() }
  })

  it('fa il JOIN tra codice INTEGER del DB e codice TESTO dell Excel', async () => {
    const conn = await db.createConnectorAsync({ kind: 'multi', sources: [gestionale(), { alias: 'lst', path: listinoPath }] })
    try {
      const r = await conn.query(`
        SELECT l.descrizione AS articolo, SUM(o.qta * l.prezzo) AS valore
        FROM gest_ordini o
        JOIN lst_prezzi l ON l.cod = o.cod
        GROUP BY l.descrizione
        ORDER BY valore DESC
      `)
      expect(r.rows).toEqual([
        { articolo: 'Cemento', valore: 50 },   // (3 + 1) * 12.50
        { articolo: 'Ferro', valore: 16.25 },  // 5 * 3.25
      ])
    } finally { await conn.close() }
  })

  it('tiene i numeri dell Excel come numeri (SUM, non concatenazione)', async () => {
    const conn = await db.createConnectorAsync({ kind: 'multi', sources: [gestionale(), { alias: 'lst', path: listinoPath }] })
    try {
      const r = await conn.query('SELECT SUM(prezzo) AS tot FROM lst_prezzi')
      expect(r.rows[0].tot).toBeCloseTo(15.75, 5)
      const schema = await conn.introspect()
      const prezzi = schema.tables.find(t => t.name === 'lst_prezzi')!
      expect(prezzi.columns.find(c => c.name === 'prezzo')!.type).toBe('REAL')
      expect(prezzi.columns.find(c => c.name === 'cod')!.type).toBe('TEXT')
    } finally { await conn.close() }
  })

  it('non fa collidere due sorgenti con lo stesso nome di foglio', async () => {
    const uno = sheetBuffer('clienti', [['nome'], ['Rossi']]).toString('base64')
    const due = sheetBuffer('clienti', [['nome'], ['Bianchi']]).toString('base64')
    const conn = await db.createConnectorAsync({
      kind: 'multi',
      sources: [{ alias: 'nord', xlsxBase64: uno }, { alias: 'sud', xlsxBase64: due }],
    })
    try {
      const schema = await conn.introspect()
      expect(schema.tables.map(t => t.name).sort()).toEqual(['nord_clienti', 'sud_clienti'])
      const r = await conn.query('SELECT nome FROM sud_clienti')
      expect(r.rows).toEqual([{ nome: 'Bianchi' }])
    } finally { await conn.close() }
  })

  it('limita le tabelle caricate con include', async () => {
    const conn = await db.createConnectorAsync({
      kind: 'multi',
      sources: [{ ...gestionale(), include: ['non_esiste'] }, { alias: 'lst', path: listinoPath }],
    })
    try {
      const schema = await conn.introspect()
      expect(schema.tables.map(t => t.name)).toEqual(['lst_prezzi'])
    } finally { await conn.close() }
  })

  it('rifiuta una sorgente senza database né Excel', async () => {
    await expect(db.createConnectorAsync({ kind: 'multi', sources: [{ alias: 'vuota' }] }))
      .rejects.toThrow(/database oppure un file Excel/)
  })

  it('rifiuta la creazione senza sorgenti', async () => {
    await expect(db.createConnectorAsync({ kind: 'multi', sources: [] }))
      .rejects.toThrow(/nessuna sorgente/i)
  })

  it('createConnector sincrono non accetta multi', () => {
    expect(() => db.createConnector({ kind: 'multi', sources: [gestionale()] })).toThrow(/createConnectorAsync/)
  })
})

describe('percorsi Excel su disco: allowlist XLSX_ROOTS', () => {
  it('accetta un percorso dentro la cartella consentita', () => {
    expect(db.resolveXlsxPath(listinoPath)).toBe(path.resolve(listinoPath))
  })

  it('rifiuta un percorso fuori dalla cartella consentita', () => {
    expect(() => db.resolveXlsxPath(path.join(os.tmpdir(), 'altrove.xlsx'))).toThrow(/non consentito/)
  })

  it('rifiuta la risalita con ..', () => {
    expect(() => db.resolveXlsxPath(path.join(tmp, '..', 'fuori.xlsx'))).toThrow(/non consentito/)
  })

  it('segnala il file mancante dentro la cartella consentita', () => {
    expect(() => db.resolveXlsxPath(path.join(tmp, 'mai-esistito.xlsx'))).toThrow(/non trovato/)
  })
})

describe('tetti di memoria', () => {
  it('tronca oltre MULTI_MAX_ROWS_PER_TABLE e lo dice nei warnings', async () => {
    vi.resetModules()
    const prev = process.env.MULTI_MAX_ROWS_PER_TABLE
    process.env.MULTI_MAX_ROWS_PER_TABLE = '2'
    try {
      const dbLow = await import('./db.ts')
      const conn = await dbLow.createConnectorAsync({ kind: 'multi', sources: [gestionale(), { alias: 'lst', path: listinoPath }] })
      try {
        const r = await conn.query('SELECT COUNT(*) AS n FROM gest_ordini')
        expect(r.rows[0].n).toBe(2) // 3 righe nel DB, 2 caricate
        expect(conn.warnings?.join(' ')).toMatch(/troncata a 2 righe/)
      } finally { await conn.close() }
    } finally {
      if (prev === undefined) delete process.env.MULTI_MAX_ROWS_PER_TABLE
      else process.env.MULTI_MAX_ROWS_PER_TABLE = prev
      vi.resetModules()
    }
  })
})

describe('percorsi su disco disabilitati (XLSX_ROOTS vuoto)', () => {
  it('rifiuta qualunque percorso finché XLSX_ROOTS non è impostata', async () => {
    vi.resetModules()
    const prev = process.env.XLSX_ROOTS
    process.env.XLSX_ROOTS = ''
    try {
      const dbOff = await import('./db.ts')
      expect(dbOff.xlsxPathsEnabled()).toBe(false)
      expect(() => dbOff.resolveXlsxPath(listinoPath)).toThrow(/XLSX_ROOTS/)
    } finally {
      process.env.XLSX_ROOTS = prev
      vi.resetModules()
    }
  })
})
