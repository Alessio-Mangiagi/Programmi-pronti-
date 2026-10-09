/**
 * Test della gestione chiave Claude:
 *  - saveClaudeKey/loadClaudeKey: roundtrip cifrato (AES-GCM) via MASTER_PASSWORD
 *  - senza MASTER_PASSWORD: canPersist false, save rifiutato, load null (mai in chiaro)
 *  - passphrase sbagliata: load null (niente eccezioni verso il chiamante)
 *  - setClaudeApiKey: formato non valido rifiutato PRIMA di qualsiasi chiamata di rete
 * SECRET_FILE punta a un file temporaneo (test-setup.ts): il secret.enc reale non viene toccato.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'

let secrets: typeof import('./secrets.ts')

beforeEach(async () => {
  secrets = await import('./secrets.ts')
  if (fs.existsSync(secrets.SECRET_FILE)) fs.unlinkSync(secrets.SECRET_FILE)
  delete process.env.MASTER_PASSWORD
  delete process.env.ANTHROPIC_API_KEY
})

describe('persistenza cifrata', () => {
  it('roundtrip: save cifrata → load con la stessa passphrase', () => {
    process.env.MASTER_PASSWORD = 'passphrase-test'
    secrets.saveClaudeKey('sk-ant-test-123')
    // Su disco NON c'è la chiave in chiaro.
    const raw = fs.readFileSync(secrets.SECRET_FILE, 'utf8')
    expect(raw).not.toContain('sk-ant')
    expect(secrets.loadClaudeKey()).toBe('sk-ant-test-123')
  })

  it('senza MASTER_PASSWORD: save rifiutato, canPersist false', () => {
    expect(secrets.canPersistClaudeKey()).toBe(false)
    expect(() => secrets.saveClaudeKey('sk-ant-x')).toThrow(/MASTER_PASSWORD/)
  })

  it('passphrase sbagliata → load null (mai il contenuto)', () => {
    process.env.MASTER_PASSWORD = 'giusta'
    secrets.saveClaudeKey('sk-ant-test-456')
    process.env.MASTER_PASSWORD = 'sbagliata'
    expect(secrets.loadClaudeKey()).toBeNull()
  })

  it('secret.enc presente ma MASTER_PASSWORD assente → load null', () => {
    process.env.MASTER_PASSWORD = 'x'
    secrets.saveClaudeKey('sk-ant-test-789')
    delete process.env.MASTER_PASSWORD
    expect(secrets.loadClaudeKey()).toBeNull()
  })
})

describe('setClaudeApiKey (validazione formato, zero rete)', () => {
  it('rifiuta chiavi che non iniziano con sk-ant-', async () => {
    const { setClaudeApiKey } = await import('./llm.ts')
    const out = await setClaudeApiKey('chiave-qualunque')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/sk-ant/)
  })
})
