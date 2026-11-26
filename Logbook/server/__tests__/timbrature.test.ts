// "><(((º> sabusabu <º)))><"
/**
 * Timbratura da telefono (Giorno 42, 26/11/2026), server/rotte/timbrature.ts.
 * L'orologio è finto (`ora`): OGGI_PROVA è lunedì 23/11/2026, si parte dalle 08:02 italiane.
 * La regola da proteggere: una timbratura NON è una fascia oraria finché HR non la conferma.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { oraMinutiItalia } from '../rotte/timbrature';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let giorno = OGGI_PROVA;
/** 23/11/2026 07:02 UTC = 08:02 in Italia (ora solare). */
let ora = Date.UTC(2026, 10, 23, 7, 2);
const MINUTO = 60_000;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => giorno, adesso: () => ora });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('ora italiana', () => {
  it('al minuto, con ora solare e legale', () => {
    expect(oraMinutiItalia(Date.UTC(2026, 10, 23, 7, 2))).toBe('08:02');
    expect(oraMinutiItalia(Date.UTC(2026, 6, 1, 15, 45))).toBe('17:45');
  });
});

describe('timbratura', () => {
  it('entrata e uscita del dipendente; diventa ore solo quando HR conferma', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    // Giornata pulita: niente ore già registrate oggi per Rossi.
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: rossi.id, data: OGGI_PROVA } });
    const conta = () => db.prisma.registrazioneOraria.count({ where: { dipendenteId: rossi.id, data: OGGI_PROVA } });

    const mie = (await mario.chiama('GET', '/api/timbrature/mie')).corpo;
    expect(mie).toMatchObject({ oggi: OGGI_PROVA, adesso: '08:02', aperta: null });
    expect(mie.progetti.length).toBeGreaterThan(0);
    const progettoId = mie.progetti[0].id;
    const nonMio = await db.prisma.progetto.create({ data: { codice: 'PRG-ALTRI', nome: 'Non assegnato', dataInizio: '2026-01-01' } });

    // HR non timbra (non è un dipendente); progetto non assegnato rifiutato; uscita senza entrata no.
    expect((await admin.chiama('POST', '/api/timbrature/entrata', { progettoId })).stato).toBe(403);
    expect((await mario.chiama('POST', '/api/timbrature/entrata', { progettoId: nonMio.id })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/timbrature/uscita')).stato).toBe(409);

    const entrata = await mario.chiama('POST', '/api/timbrature/entrata', { progettoId });
    expect(entrata.stato).toBe(201);
    expect(entrata.corpo).toMatchObject({ data: OGGI_PROVA, oraInizio: '08:02', oraFine: null, stato: 'APERTA' });
    const doppia = await mario.chiama('POST', '/api/timbrature/entrata', { progettoId });
    expect(doppia.stato).toBe(409);
    expect(doppia.corpo.errore).toMatch(/già timbrato l'entrata alle 08:02/);
    // HR non può confermare una timbratura ancora aperta.
    expect((await admin.chiama('POST', `/api/timbrature/${entrata.corpo.id}/conferma`, {})).stato).toBe(409);

    ora += (4 * 60 + 10) * MINUTO; // 12:12
    const uscita = await mario.chiama('POST', '/api/timbrature/uscita');
    expect(uscita.corpo).toMatchObject({ oraInizio: '08:02', oraFine: '12:12', stato: 'DA_CONFERMARE' });
    // Timbrata e chiusa, ma nessuna ora è nata.
    expect(await conta()).toBe(0);

    // Il dipendente non conferma da solo, né vede l'elenco di HR.
    expect((await mario.chiama('POST', `/api/timbrature/${entrata.corpo.id}/conferma`, {})).stato).toBe(403);
    expect((await mario.chiama('GET', '/api/timbrature')).stato).toBe(403);
    const daConfermare = (await admin.chiama('GET', '/api/timbrature')).corpo;
    expect(daConfermare).toHaveLength(1);
    expect(daConfermare[0]).toMatchObject({ id: entrata.corpo.id, dipendente: { cognome: 'Rossi' } });

    // HR corregge l'entrata alle 08:00 e conferma: ora la fascia esiste, con origine TIMBRATURA.
    expect((await admin.chiama('POST', `/api/timbrature/${entrata.corpo.id}/conferma`, { oraInizio: '12:30' })).stato).toBe(400); // uscita prima dell'entrata
    const confermata = await admin.chiama('POST', `/api/timbrature/${entrata.corpo.id}/conferma`, { oraInizio: '08:00' });
    expect(confermata.stato).toBe(200);
    expect(confermata.corpo).toMatchObject({ stato: 'CONFERMATA', oraInizio: '08:00', oraFine: '12:12', minuti: 252, decisoDa: 'admin' });
    expect(confermata.corpo.noteHr).toMatch(/timbrato 08:02-12:12/);
    const fasce = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: rossi.id, data: OGGI_PROVA } });
    expect(fasce).toHaveLength(1);
    expect(fasce[0]).toMatchObject({ oraInizio: '08:00', oraFine: '12:12', origine: 'TIMBRATURA', progettoId });
    expect((await admin.chiama('POST', `/api/timbrature/${entrata.corpo.id}/conferma`, {})).stato).toBe(409); // già decisa

    // Pomeriggio: timbratura che si sovrappone a ore già registrate → la conferma è rifiutata, poi HR la rifiuta.
    ora = Date.UTC(2026, 10, 23, 11, 0); // 12:00 italiane, dentro la fascia 08:00-12:12
    const seconda = await mario.chiama('POST', '/api/timbrature/entrata', { progettoId });
    ora += 60 * MINUTO;
    await mario.chiama('POST', '/api/timbrature/uscita');
    const sovrapposta = await admin.chiama('POST', `/api/timbrature/${seconda.corpo.id}/conferma`, {});
    expect(sovrapposta.stato).toBe(409);
    expect(sovrapposta.corpo.errore).toMatch(/si sovrappone/);
    expect((await admin.chiama('POST', `/api/timbrature/${seconda.corpo.id}/rifiuta`, {})).stato).toBe(400); // serve il motivo
    const rifiutata = await admin.chiama('POST', `/api/timbrature/${seconda.corpo.id}/rifiuta`, { noteHr: 'Doppia timbratura' });
    expect(rifiutata.corpo).toMatchObject({ stato: 'RIFIUTATA', noteHr: 'Doppia timbratura' });
    expect(await conta()).toBe(1);
    const dopo = (await mario.chiama('GET', '/api/timbrature/mie')).corpo;
    expect(dopo.recenti.map((t: { stato: string }) => t.stato)).toEqual(['RIFIUTATA', 'CONFERMATA']);
  }, 60_000);

  it('uscita dimenticata: il giorno dopo la vecchia passa a HR senza orario di uscita', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const luca = await server.accedi('luca.esposito', CREDENZIALI_DEMO.passwordDipendenti);
    const esposito = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: esposito.id, data: { gte: OGGI_PROVA } } });
    giorno = OGGI_PROVA;
    ora = Date.UTC(2026, 10, 23, 13, 0); // 14:00
    const progettoId = (await luca.chiama('GET', '/api/timbrature/mie')).corpo.progetti[0].id;
    const ieri = await luca.chiama('POST', '/api/timbrature/entrata', { progettoId });
    expect(ieri.stato).toBe(201);

    giorno = '2026-11-24';
    ora = Date.UTC(2026, 10, 24, 7, 0); // 08:00 del giorno dopo
    const oggi = await luca.chiama('POST', '/api/timbrature/entrata', { progettoId });
    expect(oggi.stato).toBe(201);
    expect(oggi.corpo).toMatchObject({ data: '2026-11-24', oraInizio: '08:00', stato: 'APERTA' });
    const vecchia = await db.prisma.timbratura.findUniqueOrThrow({ where: { id: ieri.corpo.id } });
    expect(vecchia).toMatchObject({ stato: 'DA_CONFERMARE', oraFine: null });

    // Senza orario di uscita HR non può confermare; scrivendolo sì.
    const senza = await admin.chiama('POST', `/api/timbrature/${ieri.corpo.id}/conferma`, {});
    expect(senza.stato).toBe(400);
    expect(senza.corpo.campi.oraFine).toBeTruthy();
    const con = await admin.chiama('POST', `/api/timbrature/${ieri.corpo.id}/conferma`, { oraFine: '17:30', noteHr: 'Uscita dichiarata a voce' });
    expect(con.corpo).toMatchObject({ stato: 'CONFERMATA', oraInizio: '14:00', oraFine: '17:30', noteHr: 'Uscita dichiarata a voce' });

    // Mese chiuso: la timbratura di quel giorno non si conferma più.
    await luca.chiama('POST', '/api/timbrature/uscita');
    await db.prisma.meseChiuso.create({ data: { mese: '2026-11', chiusoDa: 'admin' } });
    const chiuso = await admin.chiama('POST', `/api/timbrature/${oggi.corpo.id}/conferma`, { oraFine: '12:00' });
    expect(chiuso.stato).toBe(409);
    expect(chiuso.corpo.errore).toMatch(/novembre 2026 è chiuso/);
    await db.prisma.meseChiuso.deleteMany({});

    // Giorno 48: progetto chiuso dopo la timbratura. HR la conferma lo stesso, senza riaprirlo;
    // su quel progetto però non si timbra più.
    await db.prisma.progetto.update({ where: { id: progettoId }, data: { stato: 'CHIUSO' } });
    const aProgettoChiuso = await admin.chiama('POST', `/api/timbrature/${oggi.corpo.id}/conferma`, { oraFine: '12:00' });
    expect(aProgettoChiuso.stato).toBe(200);
    expect(aProgettoChiuso.corpo).toMatchObject({ stato: 'CONFERMATA', oraInizio: '08:00', oraFine: '12:00' });
    expect((await luca.chiama('POST', '/api/timbrature/entrata', { progettoId })).stato).toBe(400);
    await db.prisma.progetto.update({ where: { id: progettoId }, data: { stato: 'ATTIVO' } });
  }, 60_000);
});
