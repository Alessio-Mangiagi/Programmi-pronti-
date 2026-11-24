// "><(((º> sabusabu <º)))><"
/**
 * Giorno 20 (24/11/2026) — segnalazioni dei dipendenti (risposta 4: "HR decide e interviene
 * su segnalazione ma il sistema notifica a HR quando accede").
 *
 * Il dipendente segnala su un suo giorno (mai futuro), vede solo le sue e le ritira finché
 * sono aperte; HR vede tutte (contatore e finestra all'accesso),
 * le chiude con una risposta che il dipendente legge, e le trova in dashboard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let giulia: ClientProva;
let idMario: number;
let idGiulia: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  giulia = await server.accedi('giulia.bianchi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  idGiulia = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('segnalazioni', () => {
  let idSegnalazione: number;

  it('il dipendente segnala su un suo giorno passato o di oggi, mai futuro', async () => {
    const r = await mario.chiama('POST', '/api/segnalazioni', { data: '2026-11-20', testo: 'Ho lavorato fino alle 17:30, non alle 16:30' });
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ dipendenteId: idMario, data: '2026-11-20', stato: 'APERTA' });
    idSegnalazione = r.corpo.id;
    expect((await mario.chiama('POST', '/api/segnalazioni', { data: '2026-11-24', testo: 'Domani' })).stato).toBe(400);
    expect((await mario.chiama('POST', '/api/segnalazioni', { data: '2026-11-20', testo: 'x' })).stato).toBe(400);
    // Per un collega no: il dipendente segnala solo per sé
    expect((await mario.chiama('POST', '/api/segnalazioni', { dipendenteId: idGiulia, data: '2026-11-20', testo: 'Per Giulia' })).stato).toBe(403);
  });

  it('ognuno vede le sue; HR tutte, il conteggio e la dashboard', async () => {
    await giulia.chiama('POST', '/api/segnalazioni', { data: OGGI_PROVA, testo: 'Manca la mattina su PRG-002' });
    expect((await mario.chiama('GET', '/api/segnalazioni')).corpo.map((s: { testo: string }) => s.testo)).toEqual(['Ho lavorato fino alle 17:30, non alle 16:30']);
    expect((await admin.chiama('GET', '/api/segnalazioni?stato=APERTA')).corpo).toHaveLength(2);
    const dash = await admin.chiama('GET', '/api/dashboard');
    expect(dash.corpo.segnalazioni.map((s: { dipendente: string }) => s.dipendente)).toEqual(['Rossi Mario', 'Bianchi Giulia']);
    // Filtro per dipendente e giorno (lo usa la finestra della giornata)
    const delGiorno = await admin.chiama('GET', `/api/segnalazioni?dipendenteId=${idMario}&data=2026-11-20`);
    expect(delGiorno.corpo).toHaveLength(1);
  });

  it('HR la chiude con una risposta; il dipendente la legge e non la può più ritirare', async () => {
    expect((await mario.chiama('PATCH', `/api/segnalazioni/${idSegnalazione}`, { stato: 'RISOLTA' })).stato).toBe(403);
    const r = await admin.chiama('PATCH', `/api/segnalazioni/${idSegnalazione}`, { stato: 'RISOLTA', rispostaHr: 'Corretto: 07:30-12:30 e 13:30-17:30' });
    expect(r.corpo).toMatchObject({ stato: 'RISOLTA', rispostaHr: 'Corretto: 07:30-12:30 e 13:30-17:30', risoltaDa: { username: CREDENZIALI_DEMO.admin.username } });
    expect((await mario.chiama('GET', '/api/segnalazioni')).corpo[0].rispostaHr).toBe('Corretto: 07:30-12:30 e 13:30-17:30');
    expect((await mario.chiama('DELETE', `/api/segnalazioni/${idSegnalazione}`)).stato).toBe(409);
    expect((await admin.chiama('GET', '/api/segnalazioni?stato=APERTA')).corpo).toHaveLength(1);
    // Dashboard del dipendente: le sue ultime segnalazioni con lo stato
    const dash = await mario.chiama('GET', '/api/dashboard');
    expect(dash.corpo.segnalazioni[0]).toMatchObject({ stato: 'RISOLTA', rispostaHr: 'Corretto: 07:30-12:30 e 13:30-17:30' });
  });

  it('il dipendente ritira una sua segnalazione aperta, non quelle degli altri', async () => {
    const sua = (await giulia.chiama('GET', '/api/segnalazioni')).corpo[0].id;
    expect((await mario.chiama('DELETE', `/api/segnalazioni/${sua}`)).stato).toBe(403);
    expect((await giulia.chiama('DELETE', `/api/segnalazioni/${sua}`)).stato).toBe(204);
    expect((await admin.chiama('GET', '/api/segnalazioni?stato=APERTA')).corpo).toHaveLength(0);
  });
});
