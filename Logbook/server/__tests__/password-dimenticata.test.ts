// "><(((º> sabusabu <º)))><"
/**
 * Password dimenticata (Giorno 40, 26/11/2026): codice via email e password nuova senza
 * passare da HR (server/rotte/auth.ts, /api/auth/dimenticata e /api/auth/reimposta).
 * La posta è finta: le email finiscono in `posta`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import type { Email } from '../servizi/email';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const posta: Email[] = [];
const attendi = async (quante: number) => {
  for (let i = 0; i < 100 && posta.length < quante; i++) await new Promise((ok) => setTimeout(ok, 20));
};
const codiceDa = (e: Email) => /Codice: (\d{6})/.exec(e.testo)![1];
const RISPOSTA = /Se l'account esiste/;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, inviaEmail: async (e) => void posta.push(e), proprietario: { username: 'admin', email: 'titolare@esempio.it' } });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('password dimenticata', () => {
  it('stessa risposta per account che esiste, che non esiste e senza email; il codice arriva solo al primo', async () => {
    const chiedi = (username: string) => server.anonimo.chiama('POST', '/api/auth/dimenticata', { username });
    const esiste = await chiedi('Mario.Rossi');
    const inesistente = await chiedi('nessuno.cosi');
    const giulia = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } });
    await db.prisma.dipendente.update({ where: { id: giulia.id }, data: { email: null } });
    const senzaEmail = await chiedi('giulia.bianchi');
    for (const r of [esiste, inesistente, senzaEmail]) {
      expect(r.stato).toBe(200);
      expect(r.corpo.messaggio).toMatch(RISPOSTA);
    }
    await attendi(1);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(posta).toHaveLength(1);
    expect(posta[0].a).toBe('mario.rossi@esempio.it');
    expect(posta[0].oggetto).toMatch(/^Logbook: codice per la password nuova \d{6}$/);
  });

  it('codice sbagliato e password debole rifiutati; con il codice giusto la password cambia e le sessioni si chiudono', async () => {
    const vecchia = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await vecchia.chiama('GET', '/api/auth/io')).stato).toBe(200);
    const codice = codiceDa(posta[0]);
    const reimposta = (c: string, nuova: string, username = 'mario.rossi') => server.anonimo.chiama('POST', '/api/auth/reimposta', { username, codice: c, nuova });

    const sbagliato = await reimposta(codice === '000000' ? '111111' : '000000', 'Cantiere-Nuovo-2027');
    expect(sbagliato.stato).toBe(400);
    expect(sbagliato.corpo.errore).toBe('Codice sbagliato');
    // Password debole: rifiutata senza consumare il codice.
    const debole = await reimposta(codice, 'corta1');
    expect(debole.stato).toBe(400);
    expect(debole.corpo.campi.nuova).toBeTruthy();
    // Il codice di Mario non vale per un altro account.
    expect((await reimposta(codice, 'Cantiere-Nuovo-2027', 'luca.esposito')).stato).toBe(400);

    expect((await reimposta(codice, 'Cantiere-Nuovo-2027')).stato).toBe(200);
    // Una volta sola.
    expect((await reimposta(codice, 'Cantiere-Altro-2028')).stato).toBe(400);
    // La sessione aperta prima non vale più; si entra con la password nuova, non con la vecchia.
    expect((await vecchia.chiama('GET', '/api/auth/io')).stato).toBe(401);
    expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'mario.rossi', password: CREDENZIALI_DEMO.passwordDipendenti })).stato).toBe(401);
    const nuova = await server.accedi('mario.rossi', 'Cantiere-Nuovo-2027');
    expect((await nuova.chiama('GET', '/api/auth/io')).corpo.passwordDaCambiare).toBe(false);
    const azioni = (await db.prisma.registroAttivita.findMany({ where: { username: 'mario.rossi' } })).map((r) => r.azione);
    expect(azioni).toEqual(expect.arrayContaining(['Password dimenticata: codice richiesto', 'Password dimenticata: password cambiata con il codice']));
  }, 60_000);

  it('amministratore: password di almeno 12 caratteri; cinque codici all\'ora al massimo', async () => {
    posta.length = 0;
    await server.anonimo.chiama('POST', '/api/auth/dimenticata', { username: 'admin' });
    await attendi(1);
    expect(posta[0].a).toBe('titolare@esempio.it');
    const corta = await server.anonimo.chiama('POST', '/api/auth/reimposta', { username: 'admin', codice: codiceDa(posta[0]), nuova: 'Corta2027' });
    expect(corta.stato).toBe(400);
    expect(corta.corpo.errore).toMatch(/almeno 12/);
    for (let i = 0; i < 6; i++) await server.anonimo.chiama('POST', '/api/auth/dimenticata', { username: 'admin' });
    await new Promise((ok) => setTimeout(ok, 300));
    expect(posta).toHaveLength(5);
  }, 60_000);

  it('senza posta configurata lo dice chiaramente', async () => {
    const senza = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, inviaEmail: null });
    try {
      const r = await senza.anonimo.chiama('POST', '/api/auth/dimenticata', { username: 'mario.rossi' });
      expect(r.stato).toBe(400);
      expect(r.corpo.errore).toMatch(/posta non è configurata.*HR/);
    } finally {
      await senza.chiudi();
    }
  });
});
