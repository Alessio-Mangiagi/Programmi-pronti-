// "><(((º> sabusabu <º)))><"
/**
 * Note spese (Giorno 45, 26/11/2026), server/rotte/note-spese.ts. OGGI_PROVA è il 23/11/2026.
 * Il giro completo: il dipendente carica lo scontrino e inserisce la nota, HR approva o
 * rifiuta, poi segna rimborsata. E i permessi: ognuno le sue, lo scontrino lo aprono solo
 * il dipendente e HR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('note spese', () => {
  it('dal dipendente a HR: inserimento con scontrino, approvazione, rimborso; permessi e limiti', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const luca = await server.accedi('luca.esposito', CREDENZIALI_DEMO.passwordDipendenti);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const mio = await db.prisma.progetto.findFirstOrThrow({ where: { assegnazioni: { some: { dipendenteId: rossi.id } } } });
    const nonMio = await db.prisma.progetto.create({ data: { codice: 'PRG-ALTRO', nome: 'Non assegnato', dataInizio: '2026-01-01' } });
    const carica = async (chi: typeof mario, nome = 'scontrino.pdf') => (await chi.chiama('POST', '/api/file', undefined, { grezzo: PDF, intestazioni: { 'X-Nome-File': nome } })).corpo.id as number;
    const base = { data: '2026-11-20', categoria: 'VITTO', importoCent: 1850, descrizione: 'Pranzo in trasferta a Catania' };

    // Senza scontrino, con data futura, importo zero, progetto non suo: rifiutate.
    const senza = await mario.chiama('POST', '/api/note-spese', base);
    expect(senza.stato).toBe(400);
    expect(senza.corpo.campi.fileId).toBe('Scontrino obbligatorio');
    const scontrino = await carica(mario);
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, data: '2026-11-24' })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, importoCent: 0 })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, importoCent: 1_000_001 })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, progettoId: nonMio.id })).stato).toBe(400);
    // Il dipendente non inserisce a nome di un altro.
    const esposito = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, dipendenteId: esposito.id })).stato).toBe(403);

    const creata = await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino, progettoId: mio.id });
    expect(creata.stato).toBe(201);
    expect(creata.corpo).toMatchObject({ stato: 'RICHIESTA', importoCent: 1850, categoria: 'VITTO', dipendente: { cognome: 'Rossi' }, progetto: { id: mio.id }, file: { nome: 'scontrino.pdf' } });
    const id = creata.corpo.id as number;
    // Lo stesso file non si riusa per un'altra nota.
    expect((await mario.chiama('POST', '/api/note-spese', { ...base, fileId: scontrino })).stato).toBe(409);

    // Ognuno vede le sue; lo scontrino lo aprono il dipendente e HR, non un collega.
    expect((await mario.chiama('GET', '/api/note-spese')).corpo.note).toHaveLength(1);
    expect((await luca.chiama('GET', '/api/note-spese')).corpo.note).toHaveLength(0);
    expect((await luca.chiama('GET', `/api/file/${scontrino}`)).stato).toBe(403);
    expect((await admin.chiama('GET', `/api/file/${scontrino}`)).stato).toBe(200);
    expect((await luca.chiama('PUT', `/api/note-spese/${id}`, { ...base, fileId: scontrino })).stato).toBe(403);
    expect((await luca.chiama('DELETE', `/api/note-spese/${id}`)).stato).toBe(403);

    // Il dipendente corregge l'importo e sostituisce lo scontrino finché è in attesa: il vecchio file sparisce.
    const nuovoScontrino = await carica(mario, 'ricevuta.pdf');
    const corretta = await mario.chiama('PUT', `/api/note-spese/${id}`, { ...base, importoCent: 2100, fileId: nuovoScontrino });
    expect(corretta.corpo).toMatchObject({ importoCent: 2100, progetto: null, file: { nome: 'ricevuta.pdf' } });
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: scontrino } })).toBeNull();

    // Decisione: solo HR; il rifiuto vuole il motivo; si può cambiare idea prima del rimborso.
    expect((await mario.chiama('POST', `/api/note-spese/${id}/decisione`, { stato: 'APPROVATA' })).stato).toBe(403);
    expect((await admin.chiama('POST', `/api/note-spese/${id}/decisione`, { stato: 'RIFIUTATA' })).stato).toBe(400);
    expect((await admin.chiama('POST', `/api/note-spese/${id}/rimborsata`)).stato).toBe(409); // non ancora approvata
    const rifiutata = await admin.chiama('POST', `/api/note-spese/${id}/decisione`, { stato: 'RIFIUTATA', noteHr: 'Manca la data sullo scontrino' });
    expect(rifiutata.corpo).toMatchObject({ stato: 'RIFIUTATA', noteHr: 'Manca la data sullo scontrino', decisoDa: 'admin' });
    // Decisa: il dipendente non la modifica né la ritira più.
    expect((await mario.chiama('PUT', `/api/note-spese/${id}`, { ...base, fileId: nuovoScontrino })).stato).toBe(409);
    expect((await mario.chiama('DELETE', `/api/note-spese/${id}`)).stato).toBe(403);
    expect((await admin.chiama('POST', `/api/note-spese/${id}/decisione`, { stato: 'APPROVATA' })).corpo.stato).toBe('APPROVATA');
    const rimborsata = await admin.chiama('POST', `/api/note-spese/${id}/rimborsata`);
    expect(rimborsata.corpo.stato).toBe('RIMBORSATA');
    expect(rimborsata.corpo.rimborsataIl).toBeTruthy();
    expect((await admin.chiama('POST', `/api/note-spese/${id}/decisione`, { stato: 'RIFIUTATA', noteHr: 'Ripensamento' })).stato).toBe(409);
    expect((await admin.chiama('DELETE', `/api/note-spese/${id}`)).stato).toBe(409);

    // HR inserisce a nome di un dipendente anche senza scontrino; totali per stato.
    const daHr = await admin.chiama('POST', '/api/note-spese', { ...base, dipendenteId: esposito.id, categoria: 'CARBURANTE', importoCent: 5000, descrizione: 'Gasolio furgone' });
    expect(daHr.stato).toBe(201);
    expect((await admin.chiama('POST', '/api/note-spese', { ...base })).stato).toBe(400); // HR deve dire per chi
    const elenco = (await admin.chiama('GET', '/api/note-spese')).corpo;
    expect(elenco.note).toHaveLength(2);
    expect(elenco.totali).toEqual({ RIMBORSATA: { note: 1, importoCent: 2100 }, RICHIESTA: { note: 1, importoCent: 5000 } });
    expect((await admin.chiama('GET', '/api/note-spese?stato=RICHIESTA')).corpo.note).toHaveLength(1);
    expect((await luca.chiama('GET', '/api/note-spese')).corpo.note).toHaveLength(1); // quella inserita da HR per lui

    // Ritiro di una nota in attesa: sparisce anche il suo scontrino. E un file allegato non è "orfano".
    const terzo = await carica(luca);
    const sua = await luca.chiama('POST', '/api/note-spese', { ...base, fileId: terzo });
    expect(sua.stato).toBe(201);
    const { pulisciFileOrfani } = await import('../servizi/archivio-file');
    expect(await db.prisma.fileCaricato.count({ where: { id: { in: [terzo, nuovoScontrino] } } })).toBe(2);
    await pulisciFileOrfani(db.prisma, 'database:', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(await db.prisma.fileCaricato.count({ where: { id: { in: [terzo, nuovoScontrino] } } })).toBe(2);
    expect((await luca.chiama('DELETE', `/api/note-spese/${sua.corpo.id}`)).stato).toBe(200);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: terzo } })).toBeNull();
  }, 60_000);
});
