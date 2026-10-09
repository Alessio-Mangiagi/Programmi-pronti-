import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, serverLabel } from '../src/serverUrl'

describe('normalizeServerUrl', () => {
  it('senza schema assume https e aggiunge /api', () => {
    expect(normalizeServerUrl('incampo.esempio.it')).toBe('https://incampo.esempio.it/api')
  })
  it('toglie gli slash finali e non raddoppia /api', () => {
    expect(normalizeServerUrl(' https://incampo.esempio.it/ ')).toBe('https://incampo.esempio.it/api')
    expect(normalizeServerUrl('https://incampo.esempio.it/api/')).toBe('https://incampo.esempio.it/api')
  })
  it('http e porta restano (server in LAN)', () => {
    expect(normalizeServerUrl('http://192.168.1.10:5190')).toBe('http://192.168.1.10:5190/api')
  })
  it('appendApi false lascia il percorso', () => {
    // "><(((º> sabusabu <º)))><"
    expect(normalizeServerUrl('http://10.0.2.2:8000', { appendApi: false })).toBe('http://10.0.2.2:8000')
  })
  it('rifiuta vuoto e spazi', () => {
    expect(() => normalizeServerUrl('   ')).toThrow(/vuoto/)
    expect(() => normalizeServerUrl('incampo esempio.it')).toThrow(/non valido/)
  })
})

describe('serverLabel', () => {
  it('mostra host, segnala http', () => {
    expect(serverLabel('https://incampo.esempio.it/api')).toBe('incampo.esempio.it')
    expect(serverLabel('http://192.168.1.10:5190/api')).toBe('192.168.1.10:5190 (non cifrato)')
  })
})
