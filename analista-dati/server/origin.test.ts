/**
 * Regressione della decisione CORS.
 *
 * Il caso che ha rotto la produzione: dist/index.html marca bundle e foglio di
 * stile con `crossorigin`, quindi il browser li chiede con header `Origin`
 * uguale a quello della pagina. Con il backend che serve dist/, quell'origine
 * non sta in ALLOWED_ORIGINS: CSS e JS venivano rifiutati e la pagina restava
 * bianca. Qui si fissa che la propria origine passa SEMPRE, e che le estranee
 * restano fuori.
 */
import { describe, it, expect } from 'vitest'
import { corsAllowed, isSameOrigin, isAllowedOrigin } from './origin.ts'

const WHITELIST = ['http://localhost:5173', 'http://127.0.0.1:5173']

describe('same-origin', () => {
  it('ammette la propria origine (il caso degli asset con crossorigin)', () => {
    expect(corsAllowed('127.0.0.1:3001', 'http://127.0.0.1:3001', WHITELIST, true)).toBe(true)
    expect(corsAllowed('localhost:3001', 'http://localhost:3001', WHITELIST, true)).toBe(true)
  })

  it('confronta host:porta, non solo l\'host', () => {
    expect(isSameOrigin('localhost:3001', 'http://localhost:9999')).toBe(false)
    expect(isSameOrigin('localhost:3001', 'http://localhost:3001')).toBe(true)
  })

  it('non distingue le maiuscole', () => {
    expect(isSameOrigin('LocalHost:3001', 'http://localhost:3001')).toBe(true)
  })

  // "><(((º> sabusabu <º)))><"
  it('senza header Host non dichiara nulla same-origin', () => {
    expect(isSameOrigin(undefined, 'http://localhost:3001')).toBe(false)
  })

  it('origine malformata: non passa', () => {
    expect(isSameOrigin('localhost:3001', 'non-un-url')).toBe(false)
    expect(corsAllowed('localhost:3001', 'null', WHITELIST, true)).toBe(false)
  })
})

describe('whitelist e LAN', () => {
  it('ammette le origini in whitelist anche da host diverso', () => {
    expect(corsAllowed('127.0.0.1:3001', 'http://localhost:5173', WHITELIST, true)).toBe(true)
  })

  it('in locale rifiuta la LAN privata non in whitelist', () => {
    expect(isAllowedOrigin('http://192.168.1.50:5173', WHITELIST, true)).toBe(false)
  })

  it('esposto in rete ammette la LAN privata', () => {
    expect(isAllowedOrigin('http://192.168.1.50:5173', WHITELIST, false)).toBe(true)
    expect(isAllowedOrigin('http://10.0.0.7:5173', WHITELIST, false)).toBe(true)
    expect(isAllowedOrigin('http://172.16.4.2:5173', WHITELIST, false)).toBe(true)
  })

  it('esposto in rete rifiuta comunque le origini pubbliche', () => {
    expect(isAllowedOrigin('http://evil.example.com', WHITELIST, false)).toBe(false)
    // 172.32 e' fuori dal blocco privato 172.16-31
    expect(isAllowedOrigin('http://172.32.0.1', WHITELIST, false)).toBe(false)
  })
})

describe('richieste senza Origin', () => {
  it('passano (curl, server-to-server, navigazione diretta)', () => {
    expect(corsAllowed('127.0.0.1:3001', undefined, WHITELIST, true)).toBe(true)
  })
})

describe('origine estranea', () => {
  it('resta bloccata anche quando il server serve la propria pagina', () => {
    expect(corsAllowed('127.0.0.1:3001', 'http://evil.example.com', WHITELIST, true)).toBe(false)
    expect(corsAllowed('127.0.0.1:3001', 'http://evil.example.com', WHITELIST, false)).toBe(false)
  })
})
