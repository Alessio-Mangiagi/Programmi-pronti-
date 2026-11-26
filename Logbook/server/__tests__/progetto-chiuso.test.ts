// "><(((º> sabusabu <º)))><"
/**
 * Email di chiusura di un progetto (Giorno 47, 26/11/2026): server/servizi/avvisi.ts
 * (`progettoChiuso`) chiamato da PUT /api/progetti/:id. La posta è finta: le email finiscono
 * nell'elenco `posta`.
 * - passaggio a CHIUSO: riepilogo a HR (ore, costo, preventivo, cose in attesa) e avviso ai
 *   dipendenti assegnati, senza ore né costi;
 * - risalvare un progetto già chiuso non avvisa; riaprirlo e richiuderlo avvisa di nuovo;
 * - con l'interruttore spento non parte niente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import type { Email } from '../servizi/email';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const posta: Email[] = [];
const HR = 'personale@esempio.it';
/** Le email partono a risposta già inviata: si aspetta che arrivino (o che passi il tempo). */
const attendi = async (quante: number) => {
  for (let i = 0; i < 100 && posta.length < quante; i++) await new Promise((ok) => setTimeout(ok, 20));
};
const pausa = () => new Promise((ok) => setTimeout(ok, 300));

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, inviaEmail: async (e) => void posta.push(e), proprietario: { username: 'admin', email: HR } });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('chiusura di un progetto', () => {
  it('a HR il riepilogo, ai dipendenti assegnati solo l\'avviso; una email per ogni chiusura', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const progetto = await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' }, include: { assegnazioni: { include: { dipendente: true } } } });
    const mario = await db.prisma.dipendente.findFirstOrThrow({ where: { email: 'mario.rossi@esempio.it' } });
    // Dati certi su cui controllare il testo: preventivo, una timbratura e una nota spese in attesa.
    await db.prisma.progetto.update({ where: { id: progetto.id }, data: { preventivoManodoperaCent: 100_000_00, preventivoOre: 1000 } });
    await db.prisma.assegnazioneProgetto.upsert({
      where: { progettoId_dipendenteId: { progettoId: progetto.id, dipendenteId: mario.id } },
      create: { progettoId: progetto.id, dipendenteId: mario.id },
      update: {},
    });
    await db.prisma.timbratura.create({ data: { dipendenteId: mario.id, progettoId: progetto.id, data: OGGI_PROVA, oraInizio: '08:00', oraFine: '12:00', stato: 'DA_CONFERMARE' } });
    await db.prisma.notaSpesa.create({ data: { dipendenteId: mario.id, progettoId: progetto.id, data: OGGI_PROVA, categoria: 'VITTO', importoCent: 1250, descrizione: 'Pranzo', stato: 'RICHIESTA' } });
    const assegnatiConEmail = await db.prisma.assegnazioneProgetto.count({ where: { progettoId: progetto.id, dipendente: { stato: 'ATTIVO', email: { not: null } } } });
    expect(assegnatiConEmail).toBeGreaterThan(0);

    const corpo = async () => (await admin.chiama('GET', `/api/progetti/${progetto.id}`)).corpo;
    // Una modifica che non chiude non avvisa.
    expect((await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...(await corpo()), stato: 'SOSPESO' })).stato).toBe(200);
    await pausa();
    expect(posta).toHaveLength(0);

    const chiuso = await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...(await corpo()), stato: 'CHIUSO' });
    expect(chiuso.stato).toBe(200);
    await attendi(1 + assegnatiConEmail);
    expect(posta).toHaveLength(1 + assegnatiConEmail);

    const perHr = posta.find((e) => e.a === HR)!;
    expect(perHr.oggetto).toBe('Copilota: progetto PRG-001 chiuso');
    expect(perHr.testo).toContain('PRG-001 · Ristrutturazione scuola media');
    expect(perHr.testo).toMatch(/Ore registrate: \d+:\d\d su 1000 preventivate \(\d+(,\d)?%\)/);
    expect(perHr.testo).toMatch(/Costo lordo della manodopera: .*€.* su .*100\.000,00.* di preventivo/);
    expect(perHr.testo).toContain('una timbratura da confermare');
    expect(perHr.testo).toContain('una nota spese da approvare o rifiutare');

    const perMario = posta.find((e) => e.a === 'mario.rossi@esempio.it')!;
    expect(perMario.testo).toContain('Ciao Mario');
    expect(perMario.testo).toContain('non puoi più timbrare né registrare ore');
    // Ore e costi sono dati di HR: al dipendente non arrivano.
    expect(perMario.testo).not.toMatch(/€|Costo|preventiv/i);

    // Risalvare un progetto già chiuso non manda altre email.
    posta.length = 0;
    expect((await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...(await corpo()), descrizione: 'Consegnato' })).stato).toBe(200);
    await pausa();
    expect(posta).toHaveLength(0);

    // Riaperto e richiuso: è una nuova chiusura e avvisa di nuovo.
    await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...(await corpo()), stato: 'ATTIVO' });
    await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...(await corpo()), stato: 'CHIUSO' });
    await attendi(1 + assegnatiConEmail);
    expect(posta).toHaveLength(1 + assegnatiConEmail);
  });

  it('interruttore nelle impostazioni: spento non parte niente; chi non lo manda non lo cambia', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const base = { emailHr: '', richieste: true, esiti: true, oreMancanti: true, attestati: true };
    expect((await admin.chiama('GET', '/api/impostazioni')).corpo.avvisi.progettoChiuso).toBe(true);
    expect((await admin.chiama('PUT', '/api/impostazioni/avvisi', { ...base, progettoChiuso: false })).stato).toBe(200);
    // Una pagina vecchia, che non conosce l'interruttore, non lo riaccende.
    expect((await admin.chiama('PUT', '/api/impostazioni/avvisi', base)).stato).toBe(200);
    expect((await admin.chiama('GET', '/api/impostazioni')).corpo.avvisi.progettoChiuso).toBe(false);

    const progetto = await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-002' } });
    posta.length = 0;
    const attuale = (await admin.chiama('GET', `/api/progetti/${progetto.id}`)).corpo;
    expect((await admin.chiama('PUT', `/api/progetti/${progetto.id}`, { ...attuale, stato: 'CHIUSO' })).stato).toBe(200);
    await pausa();
    expect(posta).toHaveLength(0);
  });
});
