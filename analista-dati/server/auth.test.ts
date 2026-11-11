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

  it("amministratore del portale: l'account nuovo nasce admin; l'admin da regola IP non basta (11/11/2026)", async () => {
    const r = await auth.sessioneDalPortale({ username: 'capo.cantiere', ruolo: 'admin', admin: true })
    expect(r?.user.role).toBe('admin')
    // admin per l'agente solo per una regola IP del portale: prima nasceva admin per sempre, ora no
    const ip = await auth.sessioneDalPortale({ username: 'pc.direzione', ruolo: 'utente', admin: true })
    expect(ip?.user.role).toBe('user')
  })

  it("un'altra persona del portale sullo stesso browser: la vecchia sessione si chiude", async () => {
    const a = await auth.sessioneDalPortale({ username: 'pers.uno' })
    const b = await auth.sessioneDalPortale({ username: 'pers.due' }, a!.token)
    expect(b?.user.username).toBe('pers.due')
    expect(auth.sessionUser(a!.token)).toBeNull()
  })

  // Falla trovata nell'audit dell'11/11/2026: col portale aperto si faceva il login a mano su un altro account
  // dell'agente (anche l'admin iniziale) e se ne prendeva il ruolo. Ora col portale si usa solo il proprio account.
  it('login a mano su un altro account col portale aperto: rifiutato, senza consumare i tentativi', async () => {
    await auth.createUser('ufficio.gare', 'password-gare', 'user')
    for (let i = 0; i < 5; i++) {
      const r = await auth.login('ufficio.gare', i % 2 ? 'password-gare' : 'sbagliata', 'pers.tre')
      expect(r).toEqual({ ok: false, reason: 'altro-account', portale: 'pers.tre' })
    }
    // nessun tentativo contato sull'account: senza portale (gate spento) il suo login funziona ancora
    expect(auth.lockRemainingMs('ufficio.gare')).toBe(0)
    expect((await auth.login('ufficio.gare', 'password-gare')).ok).toBe(true)
    // il proprio account (stesso username del portale, anche con maiuscole diverse) sì
    await auth.createUser('pers.tre', 'password-tre', 'user')
    const mio = await auth.login('pers.tre', 'password-tre', 'Pers.Tre')
    expect(mio.ok).toBe(true)
  })

  it("sessione di un altro account aperta prima dell'11/11 col portale: si chiude, si entra nel proprio", async () => {
    await auth.createUser('ufficio.acq', 'password-acq', 'admin')
    const r = await auth.login('ufficio.acq', 'password-acq')   // login a mano (gate spento o regola vecchia)
    if (!r.ok) throw new Error('login')
    appdb.prepare('UPDATE sessions SET portale=? WHERE user_id=?').run('pers.cinque', r.user.id) // legata alla persona
    const nuova = await auth.sessioneDalPortale({ username: 'pers.cinque', ruolo: 'utente' }, r.token)
    expect(nuova?.user).toMatchObject({ username: 'pers.cinque', role: 'user' })
    expect(auth.sessionUser(r.token)).toBeNull()                 // niente più ruolo admin preso in prestito
    // e per un'altra persona del portale lo stesso
    const altro = await auth.sessioneDalPortale({ username: 'pers.quattro' }, nuova!.token)
    expect(altro?.user.username).toBe('pers.quattro')
    expect(auth.sessionUser(nuova!.token)).toBeNull()
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
    // un ALTRO account col portale di un admin aperto: non ci si entra, quindi non viene promosso
    await auth.createUser('d.ufficio', 'password-ufficio', 'user')
    expect((await auth.login('d.ufficio', 'password-ufficio', 'e.admin')).ok).toBe(false)
    const d = auth.listUsers().find(u => u.username === 'd.ufficio')
    expect(d?.role).toBe('user')
  })

  // Profilo del portale valido ovunque (11/11/2026): l'admin dal portale è dato E tolto.
  it("ex amministratore del portale: torna 'user', anche la sessione aperta (requireAdmin non passa)", async () => {
    const a = await auth.sessioneDalPortale({ username: 'ex.capo', ruolo: 'admin', admin: true })
    expect(auth.sessionUser(a!.token)?.role).toBe('admin')
    // nel portale non è più admin: al primo passaggio dal gate la sessione aperta perde il ruolo
    expect(await auth.sessioneDalPortale({ username: 'ex.capo', ruolo: 'utente', admin: false }, a!.token)).toBeNull()
    expect(auth.sessionUser(a!.token)?.role).toBe('user')
    expect(auth.listUsers().find(u => u.username === 'ex.capo')?.role).toBe('user')
    const res = { status: (n: number) => ({ json: (b: unknown) => { res.out = { n, b } } }), out: null as unknown }
    let passato = false
    auth.requireAdmin({ user: auth.sessionUser(a!.token)! } as never, res as never, () => { passato = true })
    expect(passato).toBe(false)
    expect(res.out).toMatchObject({ n: 403 })
    // torna admin nel portale: torna admin anche qui
    expect(await auth.sessioneDalPortale({ username: 'ex.capo', ruolo: 'admin', admin: true }, a!.token)).toBeNull()
    expect(auth.sessionUser(a!.token)?.role).toBe('admin')
  })

  it('account del portale segnati (portale = 1), quelli solo dell\'agente no; ruolo assente: nessun cambio', async () => {
    await auth.createUser('solo.agente', 'password-agente', 'admin')
    await auth.sessioneDalPortale({ username: 'pers.sei', ruolo: 'utente' })
    const elenco = auth.listUsers()
    expect(elenco.find(u => u.username === 'pers.sei')?.portale).toBe(1)
    expect(elenco.find(u => u.username === 'solo.agente')?.portale).toBe(0)
    // portale vecchio che non manda il ruolo: si aggancia l'account ma non si declassa nessuno
    await auth.createUser('vecchio.admin', 'password-vecchio', 'admin')
    const r = await auth.sessioneDalPortale({ username: 'vecchio.admin' })
    expect(r?.user.role).toBe('admin')
    expect(auth.listUsers().find(u => u.username === 'vecchio.admin')?.portale).toBe(1)
  })

  it('username del portale non valido qui o assente: resta il login a mano', async () => {
    expect(await auth.sessioneDalPortale({ username: 'x' })).toBeNull()
    expect(await auth.sessioneDalPortale({ username: null })).toBeNull()
    expect(await auth.sessioneDalPortale(undefined)).toBeNull()
  })
})

// Decisione dell'utente dell'11/11/2026: "gli admin devono essere creati solo da me, io posso creare e cancellare
// gli admin". Le rotte /api/users applicano vietatoSuUtenti; qui le regole, senza avviare il server.
describe('gestione degli amministratori: solo il proprietario della suite', () => {
  const proprietario = { username: 'a.mangiagi', ruolo: 'admin', admin: true, proprietario: true }
  const altroAdmin = { username: 'b.admin', ruolo: 'admin', admin: true, proprietario: false }
  const utente = { role: 'user', portale: 0 }
  const admin = { role: 'admin', portale: 0 }

  it('il proprietario crea, promuove, declassa, elimina e azzera la password degli admin', () => {
    expect(auth.puoGestireAdmin(proprietario)).toBe(true)
    expect(auth.vietatoSuUtenti({ azione: 'crea', ruolo: 'admin' }, proprietario)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'admin', target: utente }, proprietario)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'user', target: admin }, proprietario)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'elimina', target: admin }, proprietario)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'reset', target: admin }, proprietario)).toBeNull()
  })

  it('un altro admin gestisce gli utenti semplici ma non gli admin (403)', () => {
    const no = { status: 403, error: auth.MSG_SOLO_PROPRIETARIO }
    expect(auth.puoGestireAdmin(altroAdmin)).toBe(false)
    expect(auth.vietatoSuUtenti({ azione: 'crea', ruolo: 'admin' }, altroAdmin)).toEqual(no)
    expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'admin', target: utente }, altroAdmin)).toEqual(no)
    expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'user', target: admin }, altroAdmin)).toEqual(no)
    expect(auth.vietatoSuUtenti({ azione: 'elimina', target: admin }, altroAdmin)).toEqual(no)
    expect(auth.vietatoSuUtenti({ azione: 'reset', target: admin }, altroAdmin)).toEqual(no)
    // sugli utenti semplici tutto come prima
    expect(auth.vietatoSuUtenti({ azione: 'crea', ruolo: 'user' }, altroAdmin)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'user', target: utente }, altroAdmin)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'elimina', target: utente }, altroAdmin)).toBeNull()
    expect(auth.vietatoSuUtenti({ azione: 'reset', target: utente }, altroAdmin)).toBeNull()
    // portale giù con COSEDIL_SSO_FAIL=open: nessuna identità, il proprietario non si riconosce
    expect(auth.puoGestireAdmin(undefined)).toBe(false)
  })

  it("il ruolo di un account del portale lo decide il portale (409), anche per il proprietario", () => {
    const delPortale = { role: 'user', portale: 1 }
    const r = auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'admin', target: delPortale }, proprietario)
    expect(r).toEqual({ status: 409, error: auth.MSG_DECISO_DAL_PORTALE })
  })

  it('agente fuori dalla suite (COSEDIL_SSO=off): gli admin dell\'agente gestiscono tutto come prima', () => {
    const prima = process.env.COSEDIL_SSO
    process.env.COSEDIL_SSO = 'off'
    try {
      expect(auth.ssoAttivo()).toBe(false)
      expect(auth.puoGestireAdmin(undefined)).toBe(true)
      expect(auth.vietatoSuUtenti({ azione: 'crea', ruolo: 'admin' }, undefined)).toBeNull()
      expect(auth.vietatoSuUtenti({ azione: 'ruolo', ruolo: 'admin', target: { role: 'user', portale: 1 } }, undefined)).toBeNull()
    } finally {
      if (prima === undefined) delete process.env.COSEDIL_SSO; else process.env.COSEDIL_SSO = prima
    }
  })
})
