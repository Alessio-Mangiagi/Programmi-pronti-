// "><(((º> sabusabu <º)))><"
/**
 * Caposquadra (Giorno 43, 26/11/2026), server/rotte/squadra.ts. OGGI_PROVA è lunedì 23/11/2026.
 * Progetto nuovo "PRG-SQUADRA": Rossi caposquadra, Esposito in squadra, Bianchi fuori.
 * Da proteggere: il caposquadra scrive solo per la sua squadra, solo sul suo progetto, solo
 * negli ultimi giorni; non vede su cosa lavorano i suoi negli altri progetti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('caposquadra', () => {
  it('HR lo nomina; scrive le ore della squadra sul suo progetto, con tutti i limiti', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const esposito = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    const bianchi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } });
    const p = await db.prisma.progetto.create({ data: { codice: 'PRG-SQUADRA', nome: 'Cantiere di prova', dataInizio: '2026-01-01', maxMinutiGiorno: 480 } });
    await db.prisma.assegnazioneProgetto.createMany({ data: [{ progettoId: p.id, dipendenteId: rossi.id }, { progettoId: p.id, dipendenteId: esposito.id }] });
    // Esposito oggi: via le ore di prova, resta una fascia 14:00-16:00 su un altro progetto.
    const altro = await db.prisma.progetto.findFirstOrThrow({ where: { codice: { not: 'PRG-SQUADRA' }, assegnazioni: { some: { dipendenteId: esposito.id } } } });
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: esposito.id, data: { gte: '2026-11-10' } } });
    await db.prisma.registrazioneOraria.create({ data: { dipendenteId: esposito.id, progettoId: altro.id, data: OGGI_PROVA, oraInizio: '14:00', oraFine: '16:00' } });

    // Prima della nomina: niente menu, niente accesso.
    let mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('GET', '/api/auth/io')).corpo.caposquadra).toBe(false);
    expect((await mario.chiama('GET', `/api/squadra/giornata?progettoId=${p.id}&data=${OGGI_PROVA}`)).stato).toBe(403);
    const giornata = (fasce: { oraInizio: string; oraFine: string }[], extra: object = {}) => ({ progettoId: p.id, dipendenteId: esposito.id, data: OGGI_PROVA, fasce, ...extra });
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '12:00' }]))).stato).toBe(403);

    // Solo HR nomina.
    expect((await mario.chiama('PUT', `/api/progetti/${p.id}/dipendenti/${rossi.id}/caposquadra`, { caposquadra: true })).stato).toBe(403);
    expect((await admin.chiama('PUT', `/api/progetti/${p.id}/dipendenti/${bianchi.id}/caposquadra`, { caposquadra: true })).stato).toBe(404); // non assegnata
    expect((await admin.chiama('PUT', `/api/progetti/${p.id}/dipendenti/${rossi.id}/caposquadra`, { caposquadra: true })).corpo).toEqual({ caposquadra: true });
    expect((await admin.chiama('GET', `/api/progetti/${p.id}/dipendenti`)).corpo.find((a: { dipendente: { id: number } }) => a.dipendente.id === rossi.id).caposquadra).toBe(true);

    mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('GET', '/api/auth/io')).corpo.caposquadra).toBe(true);
    const miei = (await mario.chiama('GET', '/api/squadra')).corpo;
    expect(miei.progetti).toHaveLength(1);
    expect(miei.progetti[0]).toMatchObject({ codice: 'PRG-SQUADRA' });
    expect(miei.progetti[0].squadra.map((m: { cognome: string }) => m.cognome)).toEqual(['Esposito', 'Rossi']);

    // Vede le fasce sul suo progetto e solo gli orari occupati altrove (non il progetto).
    const prima = (await mario.chiama('GET', `/api/squadra/giornata?progettoId=${p.id}&data=${OGGI_PROVA}`)).corpo;
    const diEsposito = prima.find((m: { id: number }) => m.id === esposito.id);
    expect(diEsposito.fasce).toEqual([]);
    expect(diEsposito.occupato).toEqual([{ oraInizio: '14:00', oraFine: '16:00' }]);

    // Salva due fasce: nascono con origine CAPOSQUADRA; l'altra fascia resta com'era.
    const salvate = await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '12:00' }, { oraInizio: '13:00', oraFine: '14:00' }]));
    expect(salvate.corpo).toEqual({ salvate: 2, minuti: 300 });
    const oggiEsposito = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: esposito.id, data: OGGI_PROVA }, orderBy: { oraInizio: 'asc' } });
    expect(oggiEsposito.map((f) => [f.oraInizio, f.oraFine, f.origine, f.progettoId === p.id])).toEqual([
      ['08:00', '12:00', 'CAPOSQUADRA', true],
      ['13:00', '14:00', 'CAPOSQUADRA', true],
      ['14:00', '16:00', 'INTERFACCIA', false],
    ]);

    // Limiti: sovrapposizione con l'altro progetto, fasce che si pestano, massimo del progetto (8 ore),
    // dipendente fuori squadra, giorno futuro, giorno troppo vecchio, mese chiuso.
    const sopra = await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '13:00', oraFine: '15:00' }]));
    expect(sopra.stato).toBe(409);
    expect(sopra.corpo.errore).toMatch(/su un altro progetto \(14:00-16:00\)/);
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '10:00' }, { oraInizio: '09:00', oraFine: '11:00' }]))).stato).toBe(400);
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '10:00', oraFine: '09:00' }]))).stato).toBe(400);
    const troppe = await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '05:00', oraFine: '13:30' }]));
    expect(troppe.stato).toBe(400);
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '09:00' }], { dipendenteId: bianchi.id }))).stato).toBe(403);
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '09:00' }], { data: '2026-11-24' }))).stato).toBe(400);
    const vecchio = await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '09:00' }], { data: '2026-11-13' }));
    expect(vecchio.stato).toBe(400);
    expect(vecchio.corpo.errore).toMatch(/7 giorni precedenti/);
    await db.prisma.meseChiuso.create({ data: { mese: '2026-11', chiusoDa: 'admin' } });
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '09:00' }]))).stato).toBe(409);
    await db.prisma.meseChiuso.deleteMany({});
    // Dopo tutti i rifiuti le fasce sono ancora le tre di prima.
    expect(await db.prisma.registrazioneOraria.count({ where: { dipendenteId: esposito.id, data: OGGI_PROVA } })).toBe(3);

    // Elenco vuoto: toglie solo le fasce del suo progetto.
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([]))).corpo).toEqual({ salvate: 0, minuti: 0 });
    expect(await db.prisma.registrazioneOraria.count({ where: { dipendenteId: esposito.id, data: OGGI_PROVA } })).toBe(1);

    // Tolta la nomina, torna un dipendente come gli altri.
    await admin.chiama('PUT', `/api/progetti/${p.id}/dipendenti/${rossi.id}/caposquadra`, { caposquadra: false });
    expect((await mario.chiama('PUT', '/api/squadra/giornata', giornata([{ oraInizio: '08:00', oraFine: '09:00' }]))).stato).toBe(403);
    expect((await mario.chiama('GET', '/api/auth/io')).corpo.caposquadra).toBe(false);
  }, 60_000);
});
