// "><(((º> sabusabu <º)))><"
/**
 * Giorno 6 — assenze e festività. Criterio "fatto quando": una richiesta approvata
 * compare nel calendario e una rifiutata no.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let idMario: number;

/** Assenze di Mario visibili nel calendario di dicembre 2026. */
const assenzeCalendario = async () => {
  const r = await admin.chiama('GET', `/api/calendario?da=2026-12-01&a=2026-12-31&dipendenteId=${idMario}`);
  return r.corpo.assenze as { id: number; stato: string }[];
};

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('richiesta → decisione → calendario', () => {
  let idFerie: number;
  let idPermesso: number;

  it('il dipendente chiede ferie: in attesa, giorni lavorativi contati senza festivi', async () => {
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2026-12-07', dataFine: '2026-12-11', noteDipendente: 'Ponte' });
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ stato: 'RICHIESTA', dipendenteId: idMario, giorniLavorativi: 4 }); // l'8/12 è festa
    idFerie = r.corpo.id;
    expect((await assenzeCalendario()).find((a) => a.id === idFerie)?.stato).toBe('RICHIESTA');
  });

  it('il dipendente non può approvarsi da solo', async () => {
    expect((await mario.chiama('POST', `/api/assenze/${idFerie}/decisione`, { stato: 'APPROVATA' })).stato).toBe(403);
  });

  it('HR approva: la richiesta compare nel calendario come approvata', async () => {
    const r = await admin.chiama('POST', `/api/assenze/${idFerie}/decisione`, { stato: 'APPROVATA' });
    expect(r.stato).toBe(200);
    expect(r.corpo).toMatchObject({ stato: 'APPROVATA', decisoDa: { username: 'admin' } });
    expect((await assenzeCalendario()).find((a) => a.id === idFerie)?.stato).toBe('APPROVATA');
  });

  it('rifiutare richiede un motivo; una richiesta rifiutata non compare nel calendario', async () => {
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-14', dataFine: '2026-12-14', minutiPermesso: 120 });
    expect(r.stato).toBe(201);
    idPermesso = r.corpo.id;
    expect((await assenzeCalendario()).some((a) => a.id === idPermesso)).toBe(true);
    expect((await admin.chiama('POST', `/api/assenze/${idPermesso}/decisione`, { stato: 'RIFIUTATA' })).stato).toBe(400);
    const rif = await admin.chiama('POST', `/api/assenze/${idPermesso}/decisione`, { stato: 'RIFIUTATA', noteHr: 'Riunione di cantiere' });
    expect(rif.corpo.stato).toBe('RIFIUTATA');
    expect((await assenzeCalendario()).some((a) => a.id === idPermesso)).toBe(false);
  });

  it('il dipendente non modifica né ritira una richiesta già decisa', async () => {
    expect((await mario.chiama('PUT', `/api/assenze/${idFerie}`, { tipo: 'FERIE', dataInizio: '2026-12-07', dataFine: '2026-12-09' })).stato).toBe(403);
    expect((await mario.chiama('DELETE', `/api/assenze/${idFerie}`)).stato).toBe(403);
  });

  it('HR può modificare un\'assenza approvata (es. accorciarla)', async () => {
    const r = await admin.chiama('PUT', `/api/assenze/${idFerie}`, { tipo: 'FERIE', dataInizio: '2026-12-07', dataFine: '2026-12-09', noteHr: 'Accorciate d\'accordo' });
    expect(r.stato).toBe(200);
    expect(r.corpo).toMatchObject({ dataFine: '2026-12-09', giorniLavorativi: 2, stato: 'APPROVATA', noteHr: "Accorciate d'accordo" });
  });

  it('il dipendente ritira una richiesta ancora in attesa', async () => {
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-15', dataFine: '2026-12-15', minutiPermesso: 60 });
    expect((await mario.chiama('DELETE', `/api/assenze/${r.corpo.id}`)).stato).toBe(200);
  });
});

describe('controlli', () => {
  it('ferie sovrapposte ad altre ferie non rifiutate: 409', async () => {
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2026-12-09', dataFine: '2026-12-10' });
    expect(r.stato).toBe(409);
    expect(r.corpo.errore).toMatch(/sovrappone/);
  });

  it('non si approvano ferie su giorni con ore registrate', async () => {
    const r = await admin.chiama('POST', '/api/assenze', { dipendenteId: idMario, tipo: 'FERIE', dataInizio: '2026-11-19', dataFine: '2026-11-20', stato: 'APPROVATA' });
    expect(r.stato).toBe(409);
    expect(r.corpo.errore).toMatch(/ore registrate/);
  });

  it('malattia: solo protocollo, niente note; il protocollo non vale per le ferie', async () => {
    const conNote = await mario.chiama('POST', '/api/assenze', { tipo: 'MALATTIA', dataInizio: '2026-12-21', dataFine: '2026-12-22', noteDipendente: 'febbre' });
    expect(conNote.stato).toBe(400);
    expect(conNote.corpo.campi.noteDipendente).toBeDefined();
    const ok = await mario.chiama('POST', '/api/assenze', { tipo: 'MALATTIA', dataInizio: '2026-12-21', dataFine: '2026-12-22', protocolloCertificato: '123456789' });
    expect(ok.stato).toBe(201);
    const ferieConProtocollo = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2026-12-28', dataFine: '2026-12-29', protocolloCertificato: '123' });
    expect(ferieConProtocollo.stato).toBe(400);
  });

  it('permesso: un solo giorno e con la durata', async () => {
    expect((await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-16', dataFine: '2026-12-17', minutiPermesso: 60 })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-16', dataFine: '2026-12-16' })).stato).toBe(400);
  });

  it('il dipendente vede solo le proprie assenze', async () => {
    const r = await mario.chiama('GET', '/api/assenze');
    expect(new Set(r.corpo.map((a: { dipendenteId: number }) => a.dipendenteId))).toEqual(new Set([idMario]));
  });
});

describe('festività', () => {
  it('HR aggiunge il patrono del paese; un doppione nello stesso giorno è rifiutato', async () => {
    const r = await admin.chiama('POST', '/api/festivita', { data: '2027-02-05', descrizione: "Sant'Agata, patrona", tipo: 'LOCALE' });
    expect(r.stato).toBe(201);
    expect((await admin.chiama('POST', '/api/festivita', { data: '2027-02-05', descrizione: 'Altro', tipo: 'AZIENDALE' })).stato).toBe(409);
    expect((await mario.chiama('POST', '/api/festivita', { data: '2027-02-06', descrizione: 'Prova', tipo: 'AZIENDALE' })).stato).toBe(403);
  });

  it('carica le nazionali di un anno una volta sola', async () => {
    expect((await admin.chiama('POST', '/api/festivita/carica-nazionali', { anno: 2027 })).corpo.aggiunte).toBe(13);
    expect((await admin.chiama('POST', '/api/festivita/carica-nazionali', { anno: 2027 })).corpo.aggiunte).toBe(0);
    expect((await admin.chiama('GET', '/api/festivita?anno=2027')).corpo).toHaveLength(14); // 13 + patrono
  });

  it('una chiusura aziendale compare nel calendario', async () => {
    await admin.chiama('POST', '/api/festivita', { data: '2026-12-24', descrizione: 'Chiusura aziendale', tipo: 'AZIENDALE' });
    const r = await mario.chiama('GET', '/api/calendario?da=2026-12-01&a=2026-12-31');
    expect(r.corpo.festivita.map((f: { data: string }) => f.data)).toContain('2026-12-24');
  });
});
