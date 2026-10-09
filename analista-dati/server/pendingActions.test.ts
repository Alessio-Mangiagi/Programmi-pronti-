/**
 * Registro delle azioni in attesa di conferma. È la barriera che impedisce di
 * eseguire una scrittura che l'agente non ha mai proposto: qui si verificano le
 * quattro proprietà su cui si regge (monouso, legata all'utente, a scadenza,
 * argomenti presi dal registro e non dal chiamante).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerPendingAction, takePendingAction, _resetPendingActions } from './pendingActions.ts'

beforeEach(() => _resetPendingActions())
afterEach(() => vi.useRealTimers())

describe('registro azioni in attesa', () => {
  it('restituisce gli argomenti REGISTRATI, non quelli del chiamante', () => {
    const id = registerPendingAction('scadenzario_crea', { tipo_id: 1, soggetto: 'ACME' }, 'mario')
    const r = takePendingAction(id, 'mario')
    expect(r.ok).toBe(true)
    expect(r.ok && r.action).toEqual({ name: 'scadenzario_crea', args: { tipo_id: 1, soggetto: 'ACME' } })
  })

  it('è monouso: la seconda conferma fallisce', () => {
    const id = registerPendingAction('scadenzario_crea', {}, 'mario')
    expect(takePendingAction(id, 'mario').ok).toBe(true)
    const secondo = takePendingAction(id, 'mario')
    expect(secondo.ok).toBe(false)
    expect(secondo.ok === false && secondo.error).toMatch(/scaduta|già stata eseguita/i)
  })

  it('un altro utente non può confermare, e l\'id resta bruciato', () => {
    const id = registerPendingAction('scadenzario_invia_notifiche', {}, 'mario')
    expect(takePendingAction(id, 'luigi').ok).toBe(false)
    expect(takePendingAction(id, 'mario').ok).toBe(false) // consumato comunque
  })

  it('id sconosciuto → rifiutato', () => {
    expect(takePendingAction('00000000-0000-0000-0000-000000000000', 'mario').ok).toBe(false)
  })

  it('scade dopo il TTL', () => {
    vi.useFakeTimers()
    const id = registerPendingAction('scadenzario_crea', {}, 'mario')
    vi.advanceTimersByTime(6 * 60_000) // TTL default 5 minuti
    expect(takePendingAction(id, 'mario').ok).toBe(false)
  })

  it('due proposte hanno id distinti e indipendenti', () => {
    const a = registerPendingAction('scadenzario_crea', { tipo_id: 1 }, 'mario')
    const b = registerPendingAction('scadenzario_crea', { tipo_id: 2 }, 'mario')
    expect(a).not.toBe(b)
    const ra = takePendingAction(a, 'mario')
    expect(ra.ok && ra.action.args).toEqual({ tipo_id: 1 })
    const rb = takePendingAction(b, 'mario')
    expect(rb.ok && rb.action.args).toEqual({ tipo_id: 2 })
  })
})
