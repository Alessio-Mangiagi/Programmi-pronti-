// "><(((º> sabusabu <º)))><"
// PDF firmati .p7m (server/firma.ts): la rotta POST /api/firma/apri con un client finto (tutti i casi
// di risposta) e con il motore vero di shared/firma sulle sue fixture (ente certificatore di prova,
// niente rete). La parte vera si salta se shared/firma/.venv non è installato.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'fs'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { fileURLToPath } from 'url'
import { montaRottaFirma, tipoDa, type ClientFirma } from '../firma.ts'

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n')

const avvia = async (client?: ClientFirma) => {
  const app = express()
  montaRottaFirma(app, express.raw({ type: () => true, limit: '10mb' }), client)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/firma/apri`
  const manda = async (corpo: Buffer, nome: string) => {
    const r = await fetch(url, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/octet-stream', 'X-Nome-File': encodeURIComponent(nome) } })
    return { status: r.status, json: await r.json() as Record<string, unknown> }
  }
  return { manda, chiudi: () => new Promise(r => server.close(r)) }
}

const errore = (code: string, msg: string) => Object.assign(new Error(msg), { code })
const finto = (comportamento: () => Promise<Awaited<ReturnType<ClientFirma['apri']>>>): ClientFirma => ({
  eBustaFirmata: (_b, nome) => /\.p7m$/i.test(String(nome)),
  apri: () => comportamento(),
})
const rapporto = { firmato: true, esito: 'valida', riepilogo: 'Firma valida: Mario Rossi', firme: [], livelli: 1, nome_contenuto: 'contratto.pdf' }

describe('POST /api/firma/apri — client finto', () => {
  it('un file non firmato torna indietro com\'è', async () => {
    const s = await avvia(finto(async () => { throw new Error('non deve essere chiamato') }))
    try {
      expect((await s.manda(PDF, 'contratto.pdf')).json).toEqual({ firmato: false })
    } finally { await s.chiudi() }
  })

  it('busta aperta: PDF in base64, tipo e rapporto', async () => {
    const s = await avvia(finto(async () => ({ contenuto: PDF, nomeContenuto: 'contratto.pdf', rapporto: rapporto as never })))
    try {
      const r = await s.manda(Buffer.from('busta'), 'contratto.pdf.p7m')
      expect(r.status).toBe(200)
      expect(r.json.firmato).toBe(true)
      expect(r.json.nomeContenuto).toBe('contratto.pdf')
      expect(r.json.tipo).toBe('application/pdf')
      expect(Buffer.from(String(r.json.contenuto), 'base64')).toEqual(PDF)
      expect((r.json.rapporto as { esito: string }).esito).toBe('valida')
    } finally { await s.chiudi() }
  })

  it('motore non installato = 503 con messaggio, busta rotta = 422, altro = 502; mai 500', async () => {
    for (const [code, atteso] of [['FIRMA_NON_INSTALLATA', 503], ['BUSTA_ILLEGGIBILE', 422], ['FIRMA_ERRORE', 502]] as const) {
      const s = await avvia(finto(async () => { throw errore(code, 'messaggio di prova') }))
      try {
        const r = await s.manda(Buffer.from('busta'), 'x.pdf.p7m')
        expect(r.status).toBe(atteso)
        expect(String(r.json.error)).toContain('messaggio di prova')
      } finally { await s.chiudi() }
    }
  })

  it('corpo vuoto = 400', async () => {
    const s = await avvia(finto(async () => { throw new Error('no') }))
    try { expect((await s.manda(Buffer.alloc(0), 'x.p7m')).status).toBe(400) } finally { await s.chiudi() }
  })

  it('tipo del documento estratto: dal contenuto PDF o dall\'estensione', () => {
    expect(tipoDa('senza-estensione', PDF)).toBe('application/pdf')
    expect(tipoDa('bozza.docx', Buffer.from('PK'))).toContain('wordprocessingml')
    expect(tipoDa('dati.bin', Buffer.from('?'))).toBe('application/octet-stream')
  })
})

// ── Motore vero (shared/firma) ───────────────────────────────────────────────
const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(RADICE, 'shared', 'firma', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const pronto = existsSync(PY)

describe.skipIf(!pronto)('POST /api/firma/apri — motore vero sulle fixture di shared/firma', () => {
  let dir = ''
  const env: Record<string, string | undefined> = {}
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ocr-firma-'))
    const r = spawnSync(PY, [path.join(RADICE, 'shared', 'firma', 'test_firma.py'), 'fixture', dir])
    if (r.status !== 0) throw new Error(`fixture non create: ${r.stderr}`)
    mkdirSync(path.join(dir, 'ancore'))
    copyFileSync(path.join(dir, 'ente.pem'), path.join(dir, 'ancore', 'ente.pem'))
    // elenchi ufficiali finti e freschi: niente download dalla rete durante i test
    mkdirSync(path.join(dir, 'cache'))
    writeFileSync(path.join(dir, 'cache', 'elenchi.json'), JSON.stringify({ aggiornato: new Date().toISOString(), fonte: 'prova', servizi: [] }))
    for (const k of ['FIRMA_ANCORE_EXTRA', 'FIRMA_CACHE_DIR']) env[k] = process.env[k]
    process.env.FIRMA_ANCORE_EXTRA = path.join(dir, 'ancore')
    process.env.FIRMA_CACHE_DIR = path.join(dir, 'cache')
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    rmSync(dir, { recursive: true, force: true })
  })

  it('apre la busta, dà il PDF e la firma valida', async () => {
    const s = await avvia()
    try {
      const r = await s.manda(readFileSync(path.join(dir, 'firmato.pdf.p7m')), 'Contratto fornitura.pdf.p7m')
      expect(r.status).toBe(200)
      expect(r.json.nomeContenuto).toBe('Contratto fornitura.pdf')
      expect(Buffer.from(String(r.json.contenuto), 'base64')).toEqual(readFileSync(path.join(dir, 'documento.pdf')))
      const rap = r.json.rapporto as { esito: string; firme: { firmatario: string }[] }
      expect(rap.esito).toBe('valida')
      expect(rap.firme[0].firmatario).toBe('Mario Rossi')
    } finally { await s.chiudi() }
  }, 60_000)

  it('documento alterato dopo la firma: si legge lo stesso, firma NON valida', async () => {
    const s = await avvia()
    try {
      const r = await s.manda(readFileSync(path.join(dir, 'alterato.pdf.p7m')), 'alterato.pdf.p7m')
      expect(r.status).toBe(200)
      expect((r.json.rapporto as { esito: string }).esito).toBe('non valida')
    } finally { await s.chiudi() }
  }, 60_000)

  it('busta troncata: 422 con il nome del file', async () => {
    const s = await avvia()
    try {
      const r = await s.manda(readFileSync(path.join(dir, 'firmato.pdf.p7m')).subarray(0, 150), 'rotto.pdf.p7m')
      expect(r.status).toBe(422)
      expect(String(r.json.error)).toContain('rotto.pdf.p7m')
    } finally { await s.chiudi() }
  }, 60_000)
})
