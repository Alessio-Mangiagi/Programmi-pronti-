// "><(((º> sabusabu <º)))><"
/**
 * Giorno 23 (24/11/2026) — correzioni della verifica di sicurezza. Ogni blocco riproduce
 * il problema trovato e controlla che ora sia chiuso:
 * - assenza fino al 9999: date oltre il 2100 rifiutate, giorni lavorativi contati senza ciclo;
 * - allegati delle assenze solo PDF e immagini (niente Word/Excel con macro);
 * - login: limite dei tentativi non aggirabile con richieste in parallelo, nome utente
 *   lungo rifiutato; limite anche sul cambio password;
 * - cookie malformato: "non collegato", non errore 500;
 * - SkyTower: indirizzo con ? o #, cambio server senza reinserire il token, token mai
 *   nel messaggio d'errore, niente reindirizzamenti;
 * - un dipendente vede solo i suoi progetti;
 * - tetti ai file caricati in sospeso e alle segnalazioni aperte;
 * - intestazioni di sicurezza sulle pagine dell'interfaccia.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggiungiGiorni, isDataValida } from '../../comune/date';
import { contaGiorniLavorativi, giorniLavorativi } from '../../comune/riepiloghi';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let giulia: ClientProva;
let idMario: number;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
// Un .docx è un archivio zip: bastano i primi byte "PK\x03\x04" per passare il controllo del formato.
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
const carica = (c: ClientProva, nome: string, dati = PDF) => c.chiama('POST', '/api/file', undefined, { grezzo: dati, intestazioni: { 'X-Nome-File': encodeURIComponent(nome) } });

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  giulia = await server.accedi('giulia.bianchi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('date e assenze lunghissime', () => {
  it('date oltre il 31/12/2100 non sono valide', () => {
    expect(isDataValida('2100-12-31')).toBe(true);
    expect(isDataValida('2101-01-01')).toBe(false);
    expect(isDataValida('9999-12-31')).toBe(false);
  });

  it('il conteggio senza ciclo dà gli stessi giorni lavorativi del ciclo', () => {
    const festivi = new Set(['2026-12-08', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06', '2027-04-25']);
    // Tutti gli inizi di due settimane per tutte le durate fino a 200 giorni (anche a cavallo d'anno).
    for (let i = 0; i < 14; i++) {
      const da = aggiungiGiorni('2026-12-01', i);
      for (let n = 0; n < 200; n += 3) {
        const a = aggiungiGiorni(da, n);
        expect(contaGiorniLavorativi(da, a, festivi), `${da} → ${a}`).toBe(giorniLavorativi(da, a, festivi).length);
      }
    }
    expect(contaGiorniLavorativi('2026-12-10', '2026-12-01', festivi)).toBe(0);
  });

  it('una richiesta fino al 9999 è rifiutata e non rompe l\'elenco di HR', async () => {
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2027-01-01', dataFine: '9999-12-31' });
    expect(r.stato).toBe(400);
    expect(r.corpo.campi.dataFine).toBeTruthy();
    // Fino al 2100 si può ancora (es. data presunta lontana) e l'elenco risponde subito.
    const lunga = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2027-01-01', dataFine: '2100-12-31' });
    expect(lunga.stato).toBe(201);
    const inizio = Date.now();
    expect((await admin.chiama('GET', '/api/assenze')).stato).toBe(200);
    expect(Date.now() - inizio).toBeLessThan(2000);
    await mario.chiama('DELETE', `/api/assenze/${lunga.corpo.id}`);
  });
});

describe('allegati delle assenze', () => {
  it('solo PDF e immagini: un .docx si carica ma non si allega a un\'assenza', async () => {
    const docx = await carica(mario, 'Giustificativo.docx', DOCX);
    expect(docx.stato).toBe(201);
    const r = await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-09', dataFine: '2026-12-09', minutiPermesso: 120, fileId: docx.corpo.id });
    expect(r.stato).toBe(415);
    const pdf = await carica(mario, 'Giustificativo.pdf');
    const ok = await mario.chiama('POST', '/api/assenze', { tipo: 'PERMESSO', dataInizio: '2026-12-09', dataFine: '2026-12-09', minutiPermesso: 120, fileId: pdf.corpo.id });
    expect(ok.stato).toBe(201);
    // Nota di HR oltre i 500 caratteri: rifiutata (prima finiva nel database senza limite).
    const nota = await admin.chiama('PUT', `/api/assenze/${ok.corpo.id}`, { tipo: 'PERMESSO', dataInizio: '2026-12-09', dataFine: '2026-12-09', minutiPermesso: 120, fileId: pdf.corpo.id, noteHr: 'x'.repeat(501) });
    expect(nota.stato).toBe(400);
  });
});

describe('login e password', () => {
  it('20 tentativi sbagliati in parallelo: solo 10 valgono, gli altri 429', async () => {
    const risposte = await Promise.all(
      Array.from({ length: 20 }, () => server.anonimo.chiama('POST', '/api/auth/login', { username: 'nessuno.qui', password: 'Sbagliata1' })),
    );
    const stati = risposte.map((r) => r.stato);
    expect(stati.filter((s) => s === 401)).toHaveLength(10);
    expect(stati.filter((s) => s === 429)).toHaveLength(10);
  });

  it('nome utente lunghissimo rifiutato subito (non resta in memoria)', async () => {
    const r = await server.anonimo.chiama('POST', '/api/auth/login', { username: 'a'.repeat(5000), password: 'x' });
    expect(r.stato).toBe(400);
  });

  it('cambio password: dopo 10 password attuali sbagliate, 429', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await giulia.chiama('POST', '/api/auth/password', { attuale: 'Sbagliata1', nuova: 'NuovaPass1' })).stato).toBe(400);
    }
    // L'undicesima sbagliata fa partire l'attesa: da lì anche quella giusta è rifiutata.
    expect((await giulia.chiama('POST', '/api/auth/password', { attuale: 'Sbagliata1', nuova: 'NuovaPass1' })).stato).toBe(429);
    expect((await giulia.chiama('POST', '/api/auth/password', { attuale: CREDENZIALI_DEMO.passwordDipendenti, nuova: 'NuovaPass1' })).stato).toBe(429);
  });

  it('cookie malformato: "non collegato" (401), non errore del server', async () => {
    const r = await server.anonimo.chiama('GET', '/api/auth/io', undefined, { intestazioni: { Cookie: 'logbook_sessione=%E0%A4%A' } });
    expect(r.stato).toBe(401);
    expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'x', password: 'y' }, { intestazioni: { Cookie: 'logbook_sessione=%E0%A4%A' } })).stato).toBe(401);
  });
});

describe('collegamento a SkyTower', () => {
  const TOKEN = 'token-della-suite-0123456789';
  /** Finto SkyTower: ripete nel messaggio d'errore il token ricevuto, o reindirizza. */
  let finto: http.Server;
  let altro: http.Server;
  let richiesteAltro = 0;
  let base = '';

  beforeAll(async () => {
    altro = http.createServer((_q, r) => {
      richiesteAltro++;
      r.end('[]');
    });
    await new Promise<void>((ok) => altro.listen(0, '127.0.0.1', ok));
    const portaAltro = (altro.address() as AddressInfo).port;
    finto = http.createServer((q, r) => {
      if (q.url?.startsWith('/redir')) {
        r.writeHead(302, { Location: `http://127.0.0.1:${portaAltro}/ruba` });
        r.end();
        return;
      }
      r.writeHead(400, { 'Content-Type': 'application/json' });
      r.end(JSON.stringify({ message: `ricevuto ${q.headers['x-suite-token']}` }));
    });
    await new Promise<void>((ok) => finto.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(finto.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    finto.close();
    altro.close();
  });

  it('indirizzo con ? o # o credenziali rifiutato', async () => {
    for (const url of [`${base}/x?y=1`, `${base}/x#`, 'http://utente:pw@127.0.0.1:1', 'file:///c:/']) {
      expect((await admin.chiama('PUT', '/api/impostazioni/skytower', { url, token: TOKEN })).stato, url).toBe(400);
    }
  });

  it('il token non torna mai al browser, nemmeno se il server lo ripete', async () => {
    expect((await admin.chiama('PUT', '/api/impostazioni/skytower', { url: base, token: TOKEN })).stato).toBe(200);
    const r = await admin.chiama('POST', '/api/impostazioni/skytower/prova');
    expect(r.stato).toBe(502);
    expect(JSON.stringify(r.corpo)).not.toContain(TOKEN);
    expect(r.corpo.errore).toContain('***');
  });

  it('cambiare server senza reinserire il token non si può; cambiare solo il percorso sì', async () => {
    const altroServer = `http://127.0.0.1:${(altro.address() as AddressInfo).port}`;
    const r = await admin.chiama('PUT', '/api/impostazioni/skytower', { url: altroServer });
    expect(r.stato).toBe(400);
    expect(r.corpo.campi.token).toBeTruthy();
    expect((await admin.chiama('PUT', '/api/impostazioni/skytower', { url: `${base}/redir` })).stato).toBe(200);
  });

  it('un reindirizzamento non porta il token su un altro server', async () => {
    const prima = richiesteAltro;
    const r = await admin.chiama('POST', '/api/impostazioni/skytower/prova');
    expect(r.stato).toBe(502);
    expect(richiesteAltro).toBe(prima);
    await admin.chiama('DELETE', '/api/impostazioni/skytower');
  });
});

describe('progetti visibili al dipendente', () => {
  it('solo quelli assegnati o con sue ore, senza la commessa SkyTower', async () => {
    const suoi = await db.prisma.progetto.findMany({
      where: { OR: [{ assegnazioni: { some: { dipendenteId: idMario } } }, { registrazioni: { some: { dipendenteId: idMario } } }] },
      orderBy: { codice: 'asc' },
    });
    const tutti = await db.prisma.progetto.count();
    expect(suoi.length).toBeLessThan(tutti);
    const r = await mario.chiama('GET', '/api/progetti');
    expect(r.corpo.map((p: { codice: string }) => p.codice)).toEqual(suoi.map((p) => p.codice));
    expect(r.corpo[0]).not.toHaveProperty('commessaSkytower');
    expect(r.corpo[0]).not.toHaveProperty('assegnati');
    // HR continua a vederli tutti, con i suoi campi.
    const hr = await admin.chiama('GET', '/api/progetti');
    expect(hr.corpo).toHaveLength(tutti);
    expect(hr.corpo[0]).toHaveProperty('assegnati');
  });
});

describe('tetti contro chi riempie disco e avvisi', () => {
  it('al massimo 20 file caricati e non ancora usati per utente', async () => {
    for (let i = 0; i < 20; i++) expect((await carica(giulia, `f${i}.pdf`)).stato).toBe(201);
    const r = await carica(giulia, 'f21.pdf');
    expect(r.stato).toBe(429);
  });

  it('al massimo 20 segnalazioni aperte per dipendente', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await giulia.chiama('POST', '/api/segnalazioni', { data: '2026-11-20', testo: `Prova ${i}` })).stato).toBe(201);
    }
    expect((await giulia.chiama('POST', '/api/segnalazioni', { data: '2026-11-20', testo: 'Una di troppo' })).stato).toBe(429);
  });
});

describe('intestazioni di sicurezza dell\'interfaccia', () => {
  it('nessun riquadro da altri siti, script solo da Logbook', async () => {
    const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-ui-'));
    fs.writeFileSync(path.join(cartella, 'index.html'), '<!doctype html><title>Logbook</title>');
    const conUi = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, cartellaInterfaccia: cartella });
    try {
      const r = await conUi.anonimo.chiama('GET', '/calendario');
      expect(r.stato).toBe(200);
      expect(r.intestazioni.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(r.intestazioni.get('x-frame-options')).toBe('DENY');
      expect(r.intestazioni.get('referrer-policy')).toBe('same-origin');
    } finally {
      await conUi.chiudi();
      fs.rmSync(cartella, { recursive: true, force: true });
    }
  });
});
