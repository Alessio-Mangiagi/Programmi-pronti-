// "><(((º> sabusabu <º)))><"
// Lavori OCR per utente (revisione di sicurezza del 03/11/2026): un lavoro lo vedono chi
// l'ha creato e gli admin dell'app; senza gate SSO davanti (sviluppo) resta tutto visibile.
import { describe, it, expect } from 'vitest'
import { chiDa, puoVedere } from '../accessoLavori.ts'

describe('identità dalla richiesta', () => {
  it('legge username e admin messi dal gate SSO', () => {
    expect(chiDa({ cosedil: { username: 'mrossi', admin: false } })).toEqual({ identificato: true, utente: 'mrossi', admin: false })
    expect(chiDa({ cosedil: { username: 'capo', admin: true } }).admin).toBe(true)
  })

  it('senza gate (sviluppo, SSO spento) non c\'è identità', () => {
    expect(chiDa({}).identificato).toBe(false)
    expect(chiDa({ cosedil: { username: null } }).identificato).toBe(false)
  })
})

describe('chi vede un lavoro', () => {
  const mrossi = chiDa({ cosedil: { username: 'mrossi' } })
  const lbianchi = chiDa({ cosedil: { username: 'lbianchi' } })
  const admin = chiDa({ cosedil: { username: 'capo', admin: true } })

  it('il proprietario sì, un collega no', () => {
    expect(puoVedere({ utente: 'mrossi' }, mrossi)).toBe(true)
    expect(puoVedere({ utente: 'mrossi' }, lbianchi)).toBe(false)
  })

  it('l\'admin dell\'app vede tutto, anche i lavori senza proprietario (creati prima)', () => {
    expect(puoVedere({ utente: 'mrossi' }, admin)).toBe(true)
    expect(puoVedere({}, admin)).toBe(true)
  })

  it('un lavoro senza proprietario non lo vede un utente qualsiasi', () => {
    expect(puoVedere({}, mrossi)).toBe(false)
  })

  it('senza gate tutto resta visibile come prima', () => {
    expect(puoVedere({ utente: 'mrossi' }, chiDa({}))).toBe(true)
  })
})
