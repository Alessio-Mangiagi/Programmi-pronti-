// "><(((º> sabusabu <º)))><"
/**
 * Giorno 3 — anagrafiche. Criterio "fatto quando": creo, modifico, cerco e disattivo
 * dipendenti e progetti; un codice fiscale non valido viene rifiutato.
 * (La ricerca è nella tabella dell'interfaccia; qui si verifica che l'elenco completo
 * arrivi con i campi su cui si cerca.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carattereControllo } from '../../comune/codiceFiscale';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;

const corpoCf = 'VRDNNA92D45L219';
const nuovo = {
  matricola: '0100',
  nome: 'Anna',
  cognome: 'Verdi',
  codiceFiscale: corpoCf + carattereControllo(corpoCf),
  email: 'anna.verdi@esempio.it',
  dataAssunzione: '2026-11-02',
  tipoContratto: 'DETERMINATO',
  oreSettimanali: 40,
  costoOrarioNettoCent: 1250,
  costoOrarioLordoCent: 2400,
};

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, '2026-11-23');
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('dipendenti', () => {
  let id: number;

  it('crea un dipendente', async () => {
    const r = await admin.chiama('POST', '/api/dipendenti', nuovo);
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ matricola: '0100', stato: 'ATTIVO', costoOrarioLordoCent: 2400 });
    id = r.corpo.id;
  });

  it('rifiuta un codice fiscale non valido (400 con errore sul campo)', async () => {
    const r = await admin.chiama('POST', '/api/dipendenti', { ...nuovo, matricola: '0101', codiceFiscale: 'VRDNNA92D45L219A' });
    expect(r.stato).toBe(400);
    expect(r.corpo.campi.codiceFiscale).toMatch(/controllo/);
  });

  it('rifiuta matricola o codice fiscale già usati (409)', async () => {
    const r = await admin.chiama('POST', '/api/dipendenti', nuovo);
    expect(r.stato).toBe(409);
    expect(r.corpo.campi).toHaveProperty('matricola');
    expect(r.corpo.campi).toHaveProperty('codiceFiscale');
  });

  it('modifica la scheda', async () => {
    const r = await admin.chiama('PUT', `/api/dipendenti/${id}`, { ...nuovo, mansione: 'Assistente di cantiere', oreSettimanali: 36 });
    expect(r.stato).toBe(200);
    expect(r.corpo).toMatchObject({ mansione: 'Assistente di cantiere', oreSettimanali: 36 });
  });

  it("l'elenco contiene il nuovo dipendente con i campi per la ricerca", async () => {
    const r = await admin.chiama('GET', '/api/dipendenti');
    const anna = r.corpo.find((d: { id: number }) => d.id === id);
    expect(anna).toMatchObject({ cognome: 'Verdi', matricola: '0100', codiceFiscale: nuovo.codiceFiscale });
  });

  it('crea l\'account, il dipendente entra; disattivando la scheda l\'account si blocca', async () => {
    const acc = await admin.chiama('PUT', `/api/dipendenti/${id}/account`, { username: 'anna.verdi', password: 'Prova2026!', attivo: true });
    expect(acc.stato).toBe(200);
    const anna = await server.accedi('anna.verdi', 'Prova2026!');
    expect((await anna.chiama('GET', '/api/auth/io')).corpo.dipendenteId).toBe(id);
    // Giorno 24 (risposta 1a): la password data da HR è provvisoria, prima va cambiata.
    expect((await anna.chiama('GET', '/api/auth/io')).corpo.passwordDaCambiare).toBe(true);
    expect((await anna.chiama('GET', '/api/dashboard')).stato).toBe(403);

    const dis = await admin.chiama('POST', `/api/dipendenti/${id}/disattiva`, { dataCessazione: '2026-11-30' });
    expect(dis.corpo).toMatchObject({ stato: 'CESSATO', dataCessazione: '2026-11-30' });
    expect((await anna.chiama('GET', '/api/auth/io')).stato).toBe(401);

    const ria = await admin.chiama('POST', `/api/dipendenti/${id}/riattiva`);
    expect(ria.corpo).toMatchObject({ stato: 'ATTIVO', dataCessazione: null });
  });

  it('un account nuovo senza password o con nome già usato viene rifiutato', async () => {
    const giulia = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } });
    const senzaPwd = await admin.chiama('PUT', `/api/dipendenti/${id}/account`, { username: 'mario.rossi', attivo: true });
    expect(senzaPwd.stato).toBe(409);
    await db.prisma.utente.delete({ where: { dipendenteId: giulia.id } });
    const nuovoSenzaPwd = await admin.chiama('PUT', `/api/dipendenti/${giulia.id}/account`, { username: 'giulia.b', attivo: true });
    expect(nuovoSenzaPwd.stato).toBe(400);
  });

  it('il dipendente non può creare né modificare schede', async () => {
    expect((await mario.chiama('POST', '/api/dipendenti', { ...nuovo, matricola: '0200' })).stato).toBe(403);
    expect((await mario.chiama('PUT', `/api/dipendenti/${id}`, nuovo)).stato).toBe(403);
  });
});

describe('progetti', () => {
  let id: number;

  it('crea, modifica e chiude un progetto; il codice deve essere unico', async () => {
    const r = await admin.chiama('POST', '/api/progetti', { codice: 'prg-010', nome: 'Nuova palazzina', dataInizio: '2026-11-01' });
    expect(r.stato).toBe(201);
    expect(r.corpo.codice).toBe('PRG-010');
    id = r.corpo.id;

    expect((await admin.chiama('POST', '/api/progetti', { codice: 'PRG-010', nome: 'Doppione', dataInizio: '2026-11-01' })).stato).toBe(409);

    const mod = await admin.chiama('PUT', `/api/progetti/${id}`, { codice: 'PRG-010', nome: 'Palazzina A', cliente: 'Cliente Demo', dataInizio: '2026-11-01', stato: 'CHIUSO' });
    expect(mod.corpo).toMatchObject({ nome: 'Palazzina A', stato: 'CHIUSO' });

    const attivi = await admin.chiama('GET', '/api/progetti?stato=ATTIVO');
    expect(attivi.corpo.map((p: { id: number }) => p.id)).not.toContain(id);
  });

  it('il dipendente legge i progetti ma non li modifica', async () => {
    expect((await mario.chiama('GET', '/api/progetti')).stato).toBe(200);
    expect((await mario.chiama('POST', '/api/progetti', { codice: 'X1', nome: 'X', dataInizio: '2026-11-01' })).stato).toBe(403);
  });
});
