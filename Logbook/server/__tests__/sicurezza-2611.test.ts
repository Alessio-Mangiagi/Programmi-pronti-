// "><(((º> sabusabu <º)))><"
/**
 * Falle chiuse dopo la revisione di sicurezza del 26/11/2026 (Giorno 49). Ogni test riproduce
 * l'attacco e controlla che non riesca più:
 * - raffica di richieste in parallelo sui codici a 6 cifre (prima: tentativi illimitati);
 * - "password dimenticata" che rivelava quali account sono amministratori;
 * - richieste anonime respinte che riempivano il registro delle attività;
 * - caricamenti a parti aperti all'infinito; richieste in attesa senza tetto;
 * - contatori dei tentativi di accesso mai puliti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { MAX_RICHIESTE_IN_ATTESA } from '../rotte/assenze';
import { MAX_NOTE_IN_ATTESA } from '../rotte/note-spese';
import { MAX_TIMBRATURE_GIORNO } from '../rotte/timbrature';
import { MAX_TENTATIVI_CODICE, registroCodici } from '../servizi/codice-conferma';
import type { Email } from '../servizi/email';
import { pulisciTentativi } from '../servizi/limitatore';
import { statoTemporaneo } from '../servizi/stato-temporaneo';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const posta: Email[] = [];

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, inviaEmail: async (e) => void posta.push(e), proprietario: { username: 'admin', email: 'titolare@esempio.it' } });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('codici a 6 cifre', () => {
  it('una raffica in parallelo non ottiene più di 5 tentativi, e poi il codice è annullato', async () => {
    const codici = registroCodici(statoTemporaneo(db.prisma), 'prova-raffica');
    const { codice } = (await codici.nuovo(4242))!;
    const sbagliati = Array.from({ length: 60 }, (_, i) => String(i).padStart(6, '0')).filter((c) => c !== codice);
    const esiti = await Promise.all(sbagliati.map((c) => codici.verifica(4242, c)));
    // Solo i primi 4 posti danno "sbagliato": il quinto e tutti gli altri chiudono il codice.
    expect(esiti.filter((e) => e === 'sbagliato').length).toBeLessThan(MAX_TENTATIVI_CODICE);
    expect(esiti.every((e) => e === 'sbagliato' || e === 'esaurito' || e === 'assente')).toBe(true);
    // Dopo la raffica neanche il codice giusto vale più.
    expect(await codici.verifica(4242, codice)).not.toBe('ok');
  }, 60_000);

  it('consuma: false lascia valido il codice giusto finché non lo si annulla; un codice nuovo riparte da 5 tentativi', async () => {
    const codici = registroCodici(statoTemporaneo(db.prisma), 'prova-consumo');
    const primo = (await codici.nuovo(7))!;
    const altro = primo.codice === '123456' ? '654321' : '123456';
    expect(await codici.verifica(7, altro)).toBe('sbagliato');
    expect(await codici.verifica(7, primo.codice, { consuma: false })).toBe('ok');
    expect(await codici.verifica(7, primo.codice)).toBe('ok');
    expect(await codici.verifica(7, primo.codice)).toBe('assente');
    const secondo = (await codici.nuovo(7))!;
    const diverso = secondo.codice === '123456' ? '654321' : '123456';
    for (let n = 1; n < MAX_TENTATIVI_CODICE; n++) expect(await codici.verifica(7, diverso)).toBe('sbagliato');
    expect(await codici.verifica(7, diverso)).toBe('esaurito');
  });
});

describe('accesso', () => {
  it('password dimenticata non dice chi è amministratore: la regola dei 12 caratteri vale solo a codice giusto', async () => {
    const prova = (username: string) => server.anonimo.chiama('POST', '/api/auth/reimposta', { username, codice: '000000', nuova: 'Cantiere9x' });
    const perAdmin = await prova('admin');
    const perDipendente = await prova('mario.rossi');
    const perNessuno = await prova('utente.inventato');
    expect(perAdmin.stato).toBe(400);
    expect(perAdmin.corpo.errore).toBe(perDipendente.corpo.errore);
    expect(perAdmin.corpo.errore).toBe(perNessuno.corpo.errore);
    expect(perAdmin.corpo.errore).not.toMatch(/12 caratteri/);
  });

  it('le richieste anonime respinte non scrivono righe nel registro', async () => {
    const prima = await db.prisma.registroAttivita.count();
    for (let i = 0; i < 5; i++) expect((await server.anonimo.chiama('POST', '/api/note-spese', { a: i })).stato).toBe(401);
    await new Promise((ok) => setTimeout(ok, 200));
    expect(await db.prisma.registroAttivita.count()).toBe(prima);
    // Un dipendente collegato che prova una funzione di HR resta invece agli atti.
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('POST', '/api/mesi-chiusi', { mese: '2026-10' })).stato).toBe(403);
    await new Promise((ok) => setTimeout(ok, 200));
    expect(await db.prisma.registroAttivita.count({ where: { username: 'mario.rossi', esito: 'NEGATO' } })).toBeGreaterThan(0);
  });

  it('i contatori dei tentativi fermi da più di un giorno vengono tolti, quelli ancora bloccati no', async () => {
    const ora = Date.now();
    const giorni = (n: number) => new Date(ora - n * 24 * 60 * 60 * 1000);
    await db.prisma.tentativoAccesso.createMany({
      data: [
        { chiave: 'prova|vecchio', conta: 3, ultimo: giorni(2), bloccatoFino: new Date(0) },
        { chiave: 'prova|vecchio-bloccato', conta: 0, ultimo: giorni(2), bloccatoFino: new Date(ora + 60_000) },
        { chiave: 'prova|recente', conta: 1, ultimo: new Date(ora - 60_000), bloccatoFino: new Date(0) },
      ],
    });
    await pulisciTentativi(db.prisma, ora);
    const rimasti = (await db.prisma.tentativoAccesso.findMany({ where: { chiave: { startsWith: 'prova|' } } })).map((r) => r.chiave).sort();
    expect(rimasti).toEqual(['prova|recente', 'prova|vecchio-bloccato']);
  });
});

describe('tetti per dipendente', () => {
  it('caricamenti a parti lasciati a metà: al sesto il server dice di aspettare', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const apri = () => mario.chiama('POST', '/api/file/parti', { nome: 'a.pdf', dimensione: 4 * 1024 * 1024 });
    for (let i = 0; i < 5; i++) expect((await apri()).stato).toBe(201);
    const sesto = await apri();
    expect(sesto.stato).toBe(429);
    expect(sesto.corpo.errore).toMatch(/già altri file in caricamento/);
    // Un altro utente non ne risente.
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    expect((await admin.chiama('POST', '/api/file/parti', { nome: 'a.pdf', dimensione: 4 * 1024 * 1024 })).stato).toBe(201);
  });

  it('richieste di assenza, note spese e timbrature hanno un massimo', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const io = (await mario.chiama('GET', '/api/auth/io')).corpo;
    const giaInAttesa = await db.prisma.assenza.count({ where: { dipendenteId: io.dipendenteId, stato: 'RICHIESTA' } });
    await db.prisma.assenza.createMany({
      data: Array.from({ length: MAX_RICHIESTE_IN_ATTESA - giaInAttesa }, () => ({ dipendenteId: io.dipendenteId, tipo: 'PERMESSO' as const, dataInizio: '2027-05-03', dataFine: '2027-05-03', minutiPermesso: 30, stato: 'RICHIESTA' as const })),
    });
    const assenza = await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2027-05-04', dataFine: '2027-05-04', minutiPermesso: 60 });
    expect(assenza.stato).toBe(429);
    expect(assenza.corpo.errore).toMatch(/richieste in attesa/);

    await db.prisma.notaSpesa.createMany({
      data: Array.from({ length: MAX_NOTE_IN_ATTESA }, () => ({ dipendenteId: io.dipendenteId, data: OGGI_PROVA, categoria: 'VITTO' as const, importoCent: 500, descrizione: 'Prova', stato: 'RICHIESTA' as const })),
    });
    const nota = await mario.chiama('POST', '/api/note-spese', { data: OGGI_PROVA, categoria: 'VITTO', importoCent: 500, descrizione: 'Una di troppo', fileId: null });
    expect(nota.stato).toBe(429);

    const progetto = await db.prisma.progetto.findFirstOrThrow({ where: { stato: 'ATTIVO', assegnazioni: { some: { dipendenteId: io.dipendenteId } } } });
    await db.prisma.timbratura.createMany({
      data: Array.from({ length: MAX_TIMBRATURE_GIORNO }, () => ({ dipendenteId: io.dipendenteId, progettoId: progetto.id, data: OGGI_PROVA, oraInizio: '08:00', oraFine: '08:01', stato: 'RIFIUTATA' as const })),
    });
    const timbratura = await mario.chiama('POST', '/api/timbrature/entrata', { progettoId: progetto.id });
    expect(timbratura.stato).toBe(429);
    expect(timbratura.corpo.errore).toMatch(/Hai già timbrato/);
  });
});
