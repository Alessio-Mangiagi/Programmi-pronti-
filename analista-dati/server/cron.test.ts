import { describe, it, expect } from 'vitest'
import { parseCron, cronError, cronMatches, lastCronMatchWithin } from './cron.ts'

describe('cron parsing', () => {
  it('accetta le 5-campi valide', () => {
    expect(cronError('0 8 * * *')).toBeNull()
    expect(cronError('*/15 * * * *')).toBeNull()
    expect(cronError('0 8-18 * * 1-5')).toBeNull()
    expect(cronError('0 7 1 * *')).toBeNull()
    expect(cronError('30 6 * * 0,6')).toBeNull()
  })

  it('rifiuta espressioni malformate', () => {
    expect(cronError('0 8 * *')).toMatch(/5 campi/)          // troppo corta
    expect(cronError('99 8 * * *')).toMatch(/fuori range/)   // minuto > 59
    expect(cronError('0 25 * * *')).toMatch(/fuori range/)   // ora > 23
    expect(cronError('0 8 * * 9')).toMatch(/fuori range/)    // dow > 6
    expect(cronError('0 8 * * lun')).toMatch(/non valido/)   // testo non supportato
  })

  it('espande liste, range e passi', () => {
    expect([...parseCron('0,30 * * * *').min]).toEqual([0, 30])
    expect([...parseCron('*/15 * * * *').min]).toEqual([0, 15, 30, 45])
    expect([...parseCron('0 9-11 * * *').hour]).toEqual([9, 10, 11])
  })
})

describe('cron matching', () => {
  const at = (s: string) => new Date(s)

  it('combacia su minuto+ora esatti', () => {
    const c = parseCron('30 8 * * *')
    expect(cronMatches(c, at('2026-07-01T08:30:00'))).toBe(true)
    expect(cronMatches(c, at('2026-07-01T08:31:00'))).toBe(false)
    expect(cronMatches(c, at('2026-07-01T09:30:00'))).toBe(false)
  })

  it('rispetta il giorno della settimana (0=domenica)', () => {
    const c = parseCron('0 8 * * 1') // lunedì
    expect(cronMatches(c, at('2026-06-29T08:00:00'))).toBe(true)  // lun
    expect(cronMatches(c, at('2026-06-30T08:00:00'))).toBe(false) // mar
  })

  it('dom e dow entrambi ristretti = OR (semantica cron standard)', () => {
    const c = parseCron('0 0 1 * 1') // primo del mese OPPURE lunedì
    expect(cronMatches(c, at('2026-07-01T00:00:00'))).toBe(true)  // il 1° (mer)
    expect(cronMatches(c, at('2026-07-06T00:00:00'))).toBe(true)  // lunedì
    expect(cronMatches(c, at('2026-07-07T00:00:00'))).toBe(false) // martedì non-1°
  })

  it('*/n sui minuti', () => {
    const c = parseCron('*/15 * * * *')
    expect(cronMatches(c, at('2026-07-01T10:00:00'))).toBe(true)
    expect(cronMatches(c, at('2026-07-01T10:15:00'))).toBe(true)
    expect(cronMatches(c, at('2026-07-01T10:07:00'))).toBe(false)
  })
})

describe('catch-up: lastCronMatchWithin', () => {
  const at = (s: string) => new Date(s)

  it('trova l\'ultima esecuzione prevista entro la finestra', () => {
    const c = parseCron('0 8 * * *') // ogni giorno 08:00
    // Server riavviato alle 10:00; l\'esecuzione delle 08:00 è stata saltata.
    const due = lastCronMatchWithin(c, at('2026-07-01T10:00:00'), 24 * 60)
    expect(due).not.toBeNull()
    expect(due!.getHours()).toBe(8)
    expect(due!.getMinutes()).toBe(0)
    expect(due!.getDate()).toBe(1)
  })

  it('null se nessun match nella finestra', () => {
    const c = parseCron('0 8 * * *')
    // Alle 09:00 con finestra di soli 30 minuti: le 08:00 sono fuori portata.
    expect(lastCronMatchWithin(c, at('2026-07-01T09:00:00'), 30)).toBeNull()
  })

  // "><(((º> sabusabu <º)))><"
  it('include il minuto corrente se combacia', () => {
    const c = parseCron('0 8 * * *')
    const due = lastCronMatchWithin(c, at('2026-07-01T08:00:30'), 60)
    expect(due).not.toBeNull()
    expect(due!.getHours()).toBe(8)
  })
})
