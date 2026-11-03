// "><(((º> sabusabu <º)))><"
/**
 * Tool della suite via token (commesse_registro, magazzino_giacenze,
 * incampo_riepilogo, skytower_documenti, scadenzario_prossime): suite_link è
 * finto, così si verifica cosa chiedono e come raccontano la risposta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const chiama = vi.fn()
const commesse = vi.fn()
vi.mock('./suiteLink.ts', () => ({
  suite: {
    chiama: (...a: unknown[]) => chiama(...a),
    commesse: (o?: unknown) => commesse(o),
    trovaCommessa: () => null,
    normalizzaCommessa: (c: string) => String(c || '').replace(/\s+/g, '').toUpperCase(),
    urlPubblico: (app: string) => `http://localhost/${app}`,
    SuiteError: class extends Error {},
  },
}))

import './suiteToolDefs.ts'
import { getTool } from './suiteTools.ts'

const ctx = { user: 'mrossi' }

beforeEach(() => { chiama.mockReset(); commesse.mockReset() })

describe('tool della suite col token', () => {
  it('commesse_registro: filtra e descrive, vuoto spiegato', async () => {
    commesse.mockReturnValue([
      { code: '101-003', nome: 'Porto di Augusta', stato: 'attiva', cliente: 'AdSP', indirizzo: '', note: '' },
      { code: '102-001', nome: 'Scuola Messina', stato: 'attiva', cliente: '', indirizzo: 'Via Roma', note: '' },
    ])
    const t = getTool('commesse_registro')!
    const r = await t.run({ q: 'augusta' }, ctx)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('101-003 — Porto di Augusta · AdSP')
    expect(r.summary).not.toContain('102-001')
    commesse.mockReturnValue([])
    expect((await t.run({}, ctx)).summary).toMatch(/registro.*vuoto/i)
  })

  it('magazzino_giacenze: percorso con commessa codificata e utente del portale', async () => {
    chiama.mockResolvedValue({ commessa: '101-003 SEDE', totali: { articoli: 1, mezzi: 1, mezzi_in_uso: 1 },
      articoli: [{ descrizione: 'Sabbia', quantita: 12.5, um: 'ton' }], mezzi: [{ tipo_mezzo: 'Escavatore', targa: 'AB123CD', stato: 'in_uso' }], ubicazioni: [{}] })
    const r = await getTool('magazzino_giacenze')!.run({ commessa: '101-003 SEDE' }, ctx)
    expect(r.ok).toBe(true)
    expect(chiama).toHaveBeenCalledWith('magazzino', 'GET', '/suite/commesse/101-003%20SEDE/giacenze',
      expect.objectContaining({ utente: 'mrossi', email: 'mrossi@cosedilspa.com' }))
    expect(r.summary).toContain('Sabbia: 12.5 ton')
    expect(r.summary).toContain('Escavatore (AB123CD)')
    expect(r.openUrl?.url).toBe('http://localhost/magazzino')
  })

  it('incampo_riepilogo e skytower_documenti raccontano task, NC e documenti', async () => {
    chiama.mockResolvedValueOnce({ commessa: { code: '101-003', name: 'Porto' }, cantieri: [{ name: 'Banchina' }],
      task: [{ title: 'Gru ferma', status: 'assigned', assigned_to_name: 'Luca', due_date: '2026-11-05' }], nc: [{ title: 'Getto difforme' }] })
    const r1 = await getTool('incampo_riepilogo')!.run({ commessa: '101-003' }, ctx)
    expect(r1.summary).toContain('1 cantieri (Banchina), 1 task aperti, 1 non conformità')
    expect(r1.summary).toContain('Gru ferma [assigned] → Luca entro 2026-11-05')
    chiama.mockResolvedValueOnce({ items: [{ identifier: 'PRJ-COS-ZZ-01-DR-A-0001', title: 'Pianta', revision_code: 'C01', filename: 'pianta.pdf' }] })
    const r2 = await getTool('skytower_documenti')!.run({ commessa: '101-003', q: 'pianta' }, ctx)
    expect(chiama).toHaveBeenLastCalledWith('skytower', 'GET', '/suite/commesse/101-003/documenti',
      expect.objectContaining({ parametri: { area: 'PUBLISHED', q: 'pianta', limit: 50 } }))
    expect(r2.summary).toContain('PRJ-COS-ZZ-01-DR-A-0001 — Pianta (rev. C01) · pianta.pdf')
  })

  it('scadenzario_prossime: filtra per orizzonte e conta le scadute', async () => {
    const oggi = new Date()
    const giorno = (n: number) => new Date(oggi.getTime() + n * 86_400_000).toISOString().slice(0, 10)
    chiama.mockResolvedValue({ voci: [
      { titolo: 'DURC Rossi', tipo: 'scadenza', data: giorno(-3) },
      { titolo: 'Assicurazione gru', tipo: 'scadenza', data: giorno(10) },
      { titolo: 'Visita medica', tipo: 'scadenza', data: giorno(90) },
    ] })
    const r = await getTool('scadenzario_prossime')!.run({ giorni: 30 }, ctx)
    expect(r.ok).toBe(true)
    expect(r.summary).toMatch(/^2 scadenze entro 30 giorni \(1 già scadute\)/)
    expect(r.summary).not.toContain('Visita medica')
  })

  it('app spenta: ok false con messaggio chiaro, nessuna eccezione', async () => {
    chiama.mockRejectedValue(Object.assign(new Error('giù'), { stato: 503, messaggio: 'InCampo non raggiungibile: è spenta? Aprila dal portale.' }))
    const r = await getTool('incampo_riepilogo')!.run({ commessa: '101-003' }, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('app_offline')
    expect(r.summary).toContain('InCampo non raggiungibile')
  })
})
