// "><(((º> sabusabu <º)))><"
/**
 * Giorno 24 (24/11/2026) — risposte "1a 2 3a" alla verifica di sicurezza:
 * - 1a: password provvisoria da cambiare al primo accesso (account dati da HR,
 *   amministratore creato all'avvio, password di prova scritte nel README). Finché non
 *   è cambiata le API rispondono 403, tranne /api/auth;
 * - 2: rotte mai usate tolte (la fascia singola resta solo da cancellare, vedi ore.test.ts;
 *   qui la modifica delle festività e la cancellazione diretta dei file).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assicuraAdmin, segnaPasswordPubblicate } from '../auth/password-provvisorie';
import { CREDENZIALI_DEMO, semina, USERNAME_DEMO } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let idMario: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('password provvisoria data da HR', () => {
  it('HR reimposta la password: il dipendente entra ma vede solo il cambio password', async () => {
    const acc = await admin.chiama('PUT', `/api/dipendenti/${idMario}/account`, { username: 'mario.rossi', password: 'Provvisoria1', attivo: true });
    expect(acc.corpo.passwordDaCambiare).toBe(true);
    const mario = await server.accedi('mario.rossi', 'Provvisoria1');
    expect((await mario.chiama('GET', '/api/auth/io')).corpo).toMatchObject({ username: 'mario.rossi', passwordDaCambiare: true });
    for (const percorso of ['/api/dashboard', '/api/progetti', '/api/registrazioni', '/api/assenze']) {
      const r = await mario.chiama('GET', percorso);
      expect(r.stato, percorso).toBe(403);
      expect(r.corpo.errore).toMatch(/password provvisoria/);
    }
  });

  it('la nuova deve essere diversa; cambiata, Logbook si apre e HR lo vede', async () => {
    const mario = await server.accedi('mario.rossi', 'Provvisoria1');
    const uguale = await mario.chiama('POST', '/api/auth/password', { attuale: 'Provvisoria1', nuova: 'Provvisoria1' });
    expect(uguale.stato).toBe(400);
    expect(uguale.corpo.campi.nuova).toBeTruthy();
    expect((await mario.chiama('POST', '/api/auth/password', { attuale: 'Provvisoria1', nuova: 'SceltaDaMario7' })).stato).toBe(200);
    const dopo = await server.accedi('mario.rossi', 'SceltaDaMario7');
    expect((await dopo.chiama('GET', '/api/auth/io')).corpo.passwordDaCambiare).toBe(false);
    expect((await dopo.chiama('GET', '/api/dashboard')).stato).toBe(200);
    const scheda = await admin.chiama('GET', `/api/dipendenti/${idMario}`);
    expect(scheda.corpo.utente.passwordDaCambiare).toBe(false);
  });

  it('cambiare solo nome utente o stato non rende provvisoria la password', async () => {
    const acc = await admin.chiama('PUT', `/api/dipendenti/${idMario}/account`, { username: 'mario.rossi', attivo: true });
    expect(acc.corpo.passwordDaCambiare).toBe(false);
  });
});

describe('rotte tolte (risposta 2)', () => {
  it('modifica delle festività e cancellazione diretta dei file non esistono più', async () => {
    const festa = await db.prisma.festivita.findFirstOrThrow();
    expect((await admin.chiama('PUT', `/api/festivita/${festa.id}`, { data: festa.data, descrizione: 'Altro', tipo: festa.tipo })).stato).toBe(404);
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    const file = await admin.chiama('POST', '/api/file', undefined, { grezzo: pdf, intestazioni: { 'X-Nome-File': 'prova.pdf' } });
    expect(file.stato).toBe(201);
    expect((await admin.chiama('DELETE', `/api/file/${file.corpo.id}`)).stato).toBe(404);
  });
});

describe('avvio: amministratore e password pubblicate (scripts/prepara-db.ts)', () => {
  it('segna da cambiare chi ha ancora la password del README, non chi l\'ha cambiata', async () => {
    const segnati = await segnaPasswordPubblicate(db.prisma, [
      { password: CREDENZIALI_DEMO.admin.password, utenti: { ruolo: 'ADMIN' } },
      { password: CREDENZIALI_DEMO.passwordDipendenti, utenti: { username: { in: USERNAME_DEMO } } },
    ]);
    // Mario ha cambiato la password nei test sopra: lui no, gli altri sì.
    expect(segnati.sort()).toEqual(['admin', ...USERNAME_DEMO.filter((u) => u !== 'mario.rossi')].sort());
    expect((await admin.chiama('GET', '/api/dashboard')).stato).toBe(403);
    // Una seconda volta non c'è più nulla da segnare.
    expect(await segnaPasswordPubblicate(db.prisma, [{ password: CREDENZIALI_DEMO.admin.password, utenti: { ruolo: 'ADMIN' } }])).toEqual([]);
  });

  it('senza amministratori attivi ne crea uno con la password da cambiare; con uno attivo nulla', async () => {
    expect(await assicuraAdmin(db.prisma, 'Qualsiasi2026')).toBeNull();
    await db.prisma.utente.updateMany({ where: { ruolo: 'ADMIN' }, data: { attivo: false } });
    const creato = await assicuraAdmin(db.prisma, 'DaEnv2026x');
    // "admin" esiste già (disattivato): il nuovo ha un nome diverso.
    expect(creato).toMatch(/^admin\d+$/);
    const nuovo = await server.accedi(creato!, 'DaEnv2026x');
    expect((await nuovo.chiama('GET', '/api/auth/io')).corpo).toMatchObject({ ruolo: 'ADMIN', passwordDaCambiare: true });
    expect((await nuovo.chiama('GET', '/api/dipendenti')).stato).toBe(403);
    expect(await assicuraAdmin(db.prisma, 'DaEnv2026x')).toBeNull();
  });
});
