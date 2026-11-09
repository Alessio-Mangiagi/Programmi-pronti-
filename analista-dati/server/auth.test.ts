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
    // "><(((º> sabusabu <º)))><"
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

describe('ingresso dal Portale senza seconda password (sessioneDalPortale)', () => {
  it("primo ingresso: crea l'account con lo stesso username e apre la sessione", async () => {
    const r = await auth.sessioneDalPortale({ username: 'L.Bianchi', nome: 'Laura Bianchi', admin: false })
    expect(r?.creato).toBe(true)
    expect(r?.user).toMatchObject({ username: 'l.bianchi', role: 'user' })
    expect(auth.sessionUser(r!.token)?.username).toBe('l.bianchi')
    expect(auth.mustChangePw(r!.user.id)).toBe(false)
    // stessa persona, stesso cookie: niente da fare
    expect(await auth.sessioneDalPortale({ username: 'l.bianchi' }, r!.token)).toBeNull()
  })

  it('account già esistente: lo aggancia, la sua password resta valida', async () => {
    await auth.createUser('g.ferrante', 'password-propria', 'admin')
    const r = await auth.sessioneDalPortale({ username: 'g.ferrante', admin: false })
    expect(r?.creato).toBe(false)
    expect(r?.user.role).toBe('admin') // il ruolo resta quello dell'agente
    expect((await auth.login('g.ferrante', 'password-propria')).ok).toBe(true)
  })

  it("admin del portale: l'account nuovo nasce admin", async () => {
    const r = await auth.sessioneDalPortale({ username: 'capo.cantiere', admin: true })
    expect(r?.user.role).toBe('admin')
  })

  it("un'altra persona del portale sullo stesso browser: la vecchia sessione si chiude", async () => {
    const a = await auth.sessioneDalPortale({ username: 'pers.uno' })
    const b = await auth.sessioneDalPortale({ username: 'pers.due' }, a!.token)
    expect(b?.user.username).toBe('pers.due')
    expect(auth.sessionUser(a!.token)).toBeNull()
  })

  it('login a mano su un altro account col portale aperto: resta valido', async () => {
    await auth.createUser('ufficio.gare', 'password-gare', 'user')
    const r = await auth.login('ufficio.gare', 'password-gare', 'pers.tre')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await auth.sessioneDalPortale({ username: 'pers.tre' }, r.token)).toBeNull()
    expect(auth.sessionUser(r.token)?.username).toBe('ufficio.gare')
    // ma per un'altra persona del portale no
    const altro = await auth.sessioneDalPortale({ username: 'pers.quattro' }, r.token)
    expect(altro?.user.username).toBe('pers.quattro')
    expect(auth.sessionUser(r.token)).toBeNull()
  })

  it('sessione vecchia (prima del portale) della stessa persona: la tiene e la lega', async () => {
    await auth.createUser('vecchia.sess', 'password1', 'user')
    const r = await auth.login('vecchia.sess', 'password1')
    if (!r.ok) throw new Error('login')
    expect(await auth.sessioneDalPortale({ username: 'vecchia.sess' }, r.token)).toBeNull()
    expect(auth.sessionUser(r.token)?.username).toBe('vecchia.sess')
  })

  // Regola della suite del 09/11/2026: le credenziali di un amministratore del portale valgono come admin ovunque.
  it("amministratore del portale con un account 'user' già esistente: diventa admin, anche la sessione aperta", async () => {
    await auth.createUser('a.capo', 'password-propria', 'user')
    const r = await auth.sessioneDalPortale({ username: 'a.capo', ruolo: 'admin', admin: true })
    expect(r?.creato).toBe(false)
    expect(r?.user.role).toBe('admin')
    expect(auth.sessionUser(r!.token)?.role).toBe('admin')
    // sessione già aperta da utente semplice (login a mano) della stessa persona: promossa al volo
    await auth.createUser('b.capo', 'password-propria', 'user')
    const m = await auth.login('b.capo', 'password-propria', 'b.capo')
    if (!m.ok) throw new Error('login')
    expect(auth.sessionUser(m.token)?.role).toBe('user')
    expect(await auth.sessioneDalPortale({ username: 'b.capo', ruolo: 'admin', admin: true }, m.token)).toBeNull()
    expect(auth.sessionUser(m.token)?.role).toBe('admin')
  })

  it("chi non è amministratore del portale non guadagna diritti; l'admin da regola IP non basta", async () => {
    await auth.createUser('c.semplice', 'password-propria', 'user')
    const r = await auth.sessioneDalPortale({ username: 'c.semplice', ruolo: 'utente', admin: false })
    expect(r?.user.role).toBe('user')
    // admin per l'agente solo per una regola IP del portale (ruolo utente): il ruolo qui non cambia
    const ip = await auth.sessioneDalPortale({ username: 'c.semplice', ruolo: 'utente', admin: true }, r!.token)
    expect(ip).toBeNull()
    expect(auth.sessionUser(r!.token)?.role).toBe('user')
    // login a mano su un ALTRO account col portale di un admin aperto: quell'account non viene promosso
    await auth.createUser('d.ufficio', 'password-ufficio', 'user')
    const m = await auth.login('d.ufficio', 'password-ufficio', 'e.admin')
    if (!m.ok) throw new Error('login')
    expect(await auth.sessioneDalPortale({ username: 'e.admin', ruolo: 'admin', admin: true }, m.token)).toBeNull()
    expect(auth.sessionUser(m.token)?.role).toBe('user')
  })

  it('username del portale non valido qui o assente: resta il login a mano', async () => {
    expect(await auth.sessioneDalPortale({ username: 'x' })).toBeNull()
    expect(await auth.sessioneDalPortale({ username: null })).toBeNull()
    expect(await auth.sessioneDalPortale(undefined)).toBeNull()
  })
})
