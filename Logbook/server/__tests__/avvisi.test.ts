// "><(((º> sabusabu <º)))><"
/**
 * Avvisi via email (26/11/2026), server/servizi/avvisi.ts. La posta è finta: ogni email
 * "spedita" finisce nell'elenco `posta` e i test guardano a chi è andata e cosa dice.
 * - richiesta di un dipendente → email a HR; decisione di HR → email al dipendente;
 * - impostazioni: indirizzi di HR, interruttori, indirizzi non validi rifiutati;
 * - avvisi del giorno: una volta sola al giorno, ore mancanti una volta alla settimana,
 *   attestati una volta per soglia (30 giorni, 7 giorni);
 * - rotta del cron protetta dal segreto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { creaAvvisi, oraItalia, separaIndirizzi } from '../servizi/avvisi';
import type { Email } from '../servizi/email';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const posta: Email[] = [];
const inviaEmail = async (e: Email) => {
  posta.push(e);
};
const HR = 'personale@esempio.it';
/** Le email partono a risposta già inviata: si aspetta che arrivino (o che passi il tempo). */
const attendi = async (quante: number) => {
  for (let i = 0; i < 100 && posta.length < quante; i++) await new Promise((ok) => setTimeout(ok, 20));
};

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, inviaEmail, proprietario: { username: 'admin', email: HR } });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('aiuti', () => {
  it('indirizzi separati da virgole, spazi e a capo; ora italiana anche con orologio UTC', () => {
    expect(separaIndirizzi(' A@x.it, b@x.it;\nc@x.it  a@x.it ')).toEqual(['a@x.it', 'b@x.it', 'c@x.it']);
    expect(oraItalia(new Date(Date.UTC(2026, 6, 1, 5, 30)))).toBe(7); // ora legale
    expect(oraItalia(new Date(Date.UTC(2026, 11, 1, 5, 30)))).toBe(6); // ora solare
  });
});

describe('richieste di assenza', () => {
  it('la richiesta del dipendente avvisa HR, la decisione avvisa il dipendente', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const richiesta = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2027-02-01', dataFine: '2027-02-03', noteDipendente: 'Settimana bianca' });
    expect(richiesta.stato).toBe(201);
    await attendi(1);
    expect(posta).toHaveLength(1);
    expect(posta[0].a).toBe(HR);
    expect(posta[0].oggetto).toBe('Logbook: richiesta di ferie da Rossi Mario');
    expect(posta[0].testo).toContain('dal 01/02/2027 al 03/02/2027');
    expect(posta[0].testo).toContain('Settimana bianca');

    const decisa = await admin.chiama('POST', `/api/assenze/${richiesta.corpo.id}/decisione`, { stato: 'RIFIUTATA', noteHr: 'Cantiere in consegna' });
    expect(decisa.stato).toBe(200);
    await attendi(2);
    expect(posta[1].a).toBe('mario.rossi@esempio.it');
    expect(posta[1].oggetto).toBe('Logbook: richiesta di ferie rifiutata');
    expect(posta[1].testo).toContain('Cantiere in consegna');

    // Un'assenza inserita da HR non avvisa HR.
    const daHr = await admin.chiama('POST', '/api/assenze', { dipendenteId: richiesta.corpo.dipendenteId, tipo: 'FERIE', dataInizio: '2027-03-01', dataFine: '2027-03-01', stato: 'APPROVATA' });
    expect(daHr.stato).toBe(201);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(posta).toHaveLength(2);
  });

  it('impostazioni: più indirizzi di HR, avviso spento, indirizzo sbagliato rifiutato', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const iniziali = await admin.chiama('GET', '/api/impostazioni');
    expect(iniziali.corpo.avvisi).toMatchObject({ emailHr: '', emailPredefinita: HR, postaConfigurata: true, richieste: true, esiti: true, oreMancanti: true, attestati: true });
    expect((await mario.chiama('GET', '/api/impostazioni')).stato).toBe(403);

    const tutte = { richieste: true, esiti: true, oreMancanti: true, attestati: true };
    const sbagliato = await admin.chiama('PUT', '/api/impostazioni/avvisi', { ...tutte, emailHr: 'hr@esempio.it, nonvalido' });
    expect(sbagliato.stato).toBe(400);
    expect((await admin.chiama('PUT', '/api/impostazioni/avvisi', { ...tutte, emailHr: 'hr@esempio.it; Paghe@esempio.it' })).stato).toBe(200);
    expect((await admin.chiama('GET', '/api/impostazioni')).corpo.avvisi.emailHr).toBe('hr@esempio.it, paghe@esempio.it');

    posta.length = 0;
    expect((await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2027-04-06', dataFine: '2027-04-06', minutiPermesso: 90 })).stato).toBe(201);
    await attendi(2);
    expect(posta.map((e) => e.a).sort()).toEqual(['hr@esempio.it', 'paghe@esempio.it']);
    expect(posta[0].testo).toContain('06/04/2027, 1:30 ore');

    const prova = await admin.chiama('POST', '/api/impostazioni/avvisi/prova');
    expect(prova.corpo.inviataA).toEqual(['hr@esempio.it', 'paghe@esempio.it']);

    // Avviso delle richieste spento: nessuna email.
    expect((await admin.chiama('PUT', '/api/impostazioni/avvisi', { ...tutte, richieste: false, emailHr: '' })).stato).toBe(200);
    posta.length = 0;
    expect((await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2027-05-10', dataFine: '2027-05-10' })).stato).toBe(201);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(posta).toHaveLength(0);
  });
});

describe('avvisi del giorno', () => {
  it('ore mancanti una volta alla settimana, attestati una volta per soglia, mai due volte lo stesso giorno', async () => {
    const avvisi = creaAvvisi(db.prisma, { inviaEmail, emailProprietario: HR, indirizzo: 'https://logbook.esempio.it' });
    const luca = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    const mario = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    // OGGI_PROVA è lunedì 23/11/2026: a Luca si tolgono le ore di giovedì 19.
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: luca.id, data: '2026-11-19' } });
    await db.prisma.attestato.deleteMany({});
    await db.prisma.attestato.create({ data: { dipendenteId: mario.id, tipo: 'SICUREZZA', titolo: 'Lavori in quota', dataRilascio: '2023-12-10', dataScadenza: '2026-12-10' } });

    posta.length = 0;
    const primo = await avvisi.giornaliero(OGGI_PROVA);
    expect(primo).toEqual({ fatto: true, oreMancanti: 1, attestati: 1 });
    const aLuca = posta.find((e) => e.a === 'luca.esposito@esempio.it')!;
    expect(aLuca.oggetto).toBe('Logbook: giorni senza ore registrate');
    expect(aLuca.testo).toContain('19/11/2026');
    expect(aLuca.testo).toContain('https://logbook.esempio.it');
    expect(posta.find((e) => e.a === HR && /giorni senza ore/.test(e.oggetto))!.testo).toContain('Esposito Luca: 19/11/2026');
    expect(posta.find((e) => e.a === 'mario.rossi@esempio.it')!.testo).toContain('"Lavori in quota" scade il 10/12/2026');
    expect(posta.find((e) => e.a === HR && /attestati da rinnovare/.test(e.oggetto))).toBeTruthy();

    // Stesso giorno, anche da due processi insieme: niente.
    posta.length = 0;
    const doppi = await Promise.all([avvisi.giornaliero(OGGI_PROVA), avvisi.giornaliero(OGGI_PROVA)]);
    expect(doppi.every((r) => !r.fatto)).toBe(true);
    expect(posta).toHaveLength(0);

    // Il giorno dopo: stessa settimana e stessa soglia, quindi nessuna email nuova.
    expect(await avvisi.giornaliero('2026-11-24')).toEqual({ fatto: true, oreMancanti: 0, attestati: 0 });
    expect(posta).toHaveLength(0);

    // A una settimana dalla scadenza l'attestato viene ricordato di nuovo (soglia dei 7 giorni).
    const aSette = await avvisi.giornaliero('2026-12-03');
    expect(aSette.attestati).toBe(1);
    expect(posta.some((e) => e.a === 'mario.rossi@esempio.it' && /attestato in scadenza/.test(e.oggetto))).toBe(true);
  });

  it('senza posta non fa nulla; il cron risponde solo con il segreto giusto', async () => {
    expect(await creaAvvisi(db.prisma, {}).giornaliero('2026-12-20')).toEqual({ fatto: false, oreMancanti: 0, attestati: 0 });
    expect((await server.anonimo.chiama('GET', '/api/cron/avvisi')).stato).toBe(404);
    process.env.CRON_SECRET = 'segreto-di-prova-1234567890';
    try {
      expect((await server.anonimo.chiama('GET', '/api/cron/avvisi', undefined, { intestazioni: { Authorization: 'Bearer sbagliato' } })).stato).toBe(404);
      const giusto = await server.anonimo.chiama('GET', '/api/cron/avvisi', undefined, { intestazioni: { Authorization: 'Bearer segreto-di-prova-1234567890' } });
      expect(giusto.stato).toBe(200);
      expect(giusto.corpo.fatto).toBe(false); // OGGI_PROVA è già stato fatto nel test precedente
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

describe('indirizzi dei dati di esempio', () => {
  it('si riconoscono dal dominio @esempio.it', async () => {
    const { indirizzoDiEsempio } = await import('../servizi/email');
    expect(indirizzoDiEsempio('mario.rossi@esempio.it')).toBe(true);
    expect(indirizzoDiEsempio(' Luca@Esempio.IT ')).toBe(true);
    expect(indirizzoDiEsempio('personale@azienda.it')).toBe(false);
  });
});
