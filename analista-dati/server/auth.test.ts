/**
 * Test autenticazione: hashing password, token di sessione HASHATI nel DB,
 * lockout anti brute-force, cambio password obbligatorio.
 *
 * L'ambiente isolato (APP_DB_PATH temporaneo, soglie lockout) è preparato da
 * server/test-setup.ts, che gira PRIMA delle import statiche di questo file.
 */
import { describe, it, expect } from 'vitest'
import * as auth from './auth.ts'
import { appdb } from './appdb.ts'

describe('hashing password (scrypt)', () => {
  it('round-trip: verifica la password giusta, rifiuta quella sbagliata', async () => {
    const h = await auth.hashPassword('segretissima')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(await auth.verifyPassword('segretissima', h)).toBe(true)
    expect(await auth.verifyPassword('sbagliata', h)).toBe(false)
  })

  it('salt casuale: due hash della stessa password differiscono', async () => {
    expect(await auth.hashPassword('x1234567')).not.toBe(await auth.hashPassword('x1234567'))
  })
})

describe('sessioni: token hashato nel DB', () => {
  it('login valido → cookie token utilizzabile, ma nel DB c\'è solo l\'hash', async () => {
    await auth.createUser('mario', 'password1', 'user')
    const r = await auth.login('mario', 'password1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Il token del cookie NON è memorizzato in chiaro.
    const stored = appdb.prepare('SELECT token FROM sessions').all() as Array<{ token: string }>
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.some(s => s.token === r.token)).toBe(false)     // mai in chiaro
    expect(stored.some(s => s.token.length === 64)).toBe(true)    // sha256 hex
    // Il token del cookie risolve comunque l'utente.
    const u = auth.sessionUser(r.token)
    expect(u?.username).toBe('mario')
    // Un token inventato non risolve nulla.
    expect(auth.sessionUser('deadbeef')).toBeNull()
  })
})

describe('lockout anti brute-force', () => {
  it('dopo LOGIN_MAX_FAILS errori blocca anche la password giusta', async () => {
    await auth.createUser('lucia', 'giustissima1', 'user')
    expect((await auth.login('lucia', 'xxxxxxxx')).ok).toBe(false)          // 1
    expect((await auth.login('lucia', 'xxxxxxxx')).ok).toBe(false)          // 2
    const third = await auth.login('lucia', 'xxxxxxxx')                      // 3 → blocco
    expect(third.ok).toBe(false)
    if (!third.ok) expect(third.reason).toBe('locked')
    // Anche con la password corretta ora è bloccata.
    const locked = await auth.login('lucia', 'giustissima1')
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.reason).toBe('locked')
    expect(auth.lockRemainingMs('lucia')).toBeGreaterThan(0)
  })

  it('un login riuscito azzera il contatore', async () => {
    await auth.createUser('gino', 'password9', 'user')
    expect((await auth.login('gino', 'xxxxxxxx')).ok).toBe(false)  // 1 fail
    expect((await auth.login('gino', 'xxxxxxxx')).ok).toBe(false)  // 2 fail (sotto soglia)
    expect((await auth.login('gino', 'password9')).ok).toBe(true)  // reset
    // Ora due nuovi errori NON bastano a bloccare (contatore ripartito).
    expect((await auth.login('gino', 'xxxxxxxx')).ok).toBe(false)
    expect((await auth.login('gino', 'xxxxxxxx')).ok).toBe(false)
    expect(auth.lockRemainingMs('gino')).toBe(0)
  })
})

describe('cambio password obbligatorio', () => {
  it('utente creato con mustChange → deve cambiare; dopo il cambio, no', async () => {
    const u = await auth.createUser('admin2', 'defaultpw', 'admin', true)
    expect(auth.mustChangePw(u.id)).toBe(true)
    expect(auth.defaultAdminPasswordInUse()).toBe(true)
    // Password attuale errata → rifiutato.
    await expect(auth.changePassword(u.id, 'sbagliata', 'nuovapass1')).rejects.toThrow()
    // Cambio corretto → flag azzerato.
    await auth.changePassword(u.id, 'defaultpw', 'nuovapass1')
    expect(auth.mustChangePw(u.id)).toBe(false)
    expect((await auth.login('admin2', 'nuovapass1')).ok).toBe(true)
  })
})

describe('validazione + reset (admin)', () => {
  it('rifiuta username non valido, password corta e password uguale allo username', async () => {
    await expect(auth.createUser('a b', 'password1', 'user')).rejects.toThrow(/username/i)   // spazio
    await expect(auth.createUser('pippo', 'corta', 'user')).rejects.toThrow(/corta/i)         // < 8
    await expect(auth.createUser('sameuser1', 'sameuser1', 'user')).rejects.toThrow(/uguale/i) // pw == username
  })

  it('resetPassword genera una temp valida, forza il cambio e invalida le sessioni', async () => {
    const u = await auth.createUser('reset1', 'password1', 'user')
    const r = await auth.login('reset1', 'password1')
    expect(r.ok).toBe(true)
    const temp = await auth.resetPassword(u.id)
    expect(temp.length).toBeGreaterThanOrEqual(8)
    expect(auth.mustChangePw(u.id)).toBe(true)
    // La vecchia sessione non vale più; la vecchia password nemmeno.
    if (r.ok) expect(auth.sessionUser(r.token)).toBeNull()
    expect((await auth.login('reset1', 'password1')).ok).toBe(false)
    expect((await auth.login('reset1', temp)).ok).toBe(true)
  })

  it('setRole cambia il ruolo', async () => {
    const u = await auth.createUser('role1', 'password1', 'user')
    auth.setRole(u.id, 'admin')
    const r = await auth.login('role1', 'password1')
    expect(r.ok && r.user.role).toBe('admin')
  })
})
