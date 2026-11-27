// "><(((º> sabusabu <º)))><"
/**
 * Test di integrazione delle rotte HTTP: l'app vera (catena di index.ts, multer, sessione,
 * gestore degli errori) in ascolto su una porta libera e chiamata con fetch, come fa la pagina.
 *
 * - Gate SSO spento (COSEDIL_SSO=off, come in sviluppo): qui si provano le rotte, il gate ha il
 *   suo file (rotte-gate.test.ts).
 * - Cartella dell'app temporanea al posto di quella vera (config mockato): archivio, sessioni,
 *   chiave e log finiscono lì e i test non toccano data/.
 * - L'estrazione del testo non gira sotto Jest: pdfjs-dist è solo ESM e l'import() dinamico di
 *   estrazione.ts non è disponibile nella vm di Jest. La coda è sostituita da un finto che
 *   registra gli id; il testo «estratto» si scrive col modello, come fa elaboraDocumento a fine
 *   lavoro. Tutto il resto (validazione, permessi, esiti, report, ricerca) è quello vero.
 */
import fs from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

jest.mock('../config', () => {
  const vero = jest.requireActual('../config');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os'), path = require('path'), fsm = require('fs');
  return { ...vero, APP_DIR: fsm.mkdtempSync(path.join(os.tmpdir(), 'verifica-requisiti-rotte-')) };
});
jest.mock('../services/estrazione', () => ({
  ...jest.requireActual('../services/estrazione'),
  accodaEstrazione: jest.fn(),
  documentiInCoda: () => 0,
}));

let server: Server;
let base = '';
let accoda: jest.Mock;
let segnaEstratto: (id: string, testo: string) => void;

beforeAll(async () => {
  // prima di caricare l'app: il gate legge COSEDIL_SSO quando il modulo si carica
  process.env.COSEDIL_SSO = 'off';
  /* eslint-disable @typescript-eslint/no-require-imports */
  const app = require('../app').default;
  accoda = require('../services/estrazione').accodaEstrazione;
  const { aggiornaDocumento } = require('../models/archivio');
  // una riga di log per richiesta coprirebbe l'esito dei test
  require('../utils/logger').default.silent = true;
  /* eslint-enable @typescript-eslint/no-require-imports */
  segnaEstratto = (id, testo) => aggiornaDocumento(id, { stato: 'pronto', scansione: false, pagine: [{ numero: 1, testo }] });
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fs.rmSync(require('../config').APP_DIR, { recursive: true, force: true });
});

/** Corpo JSON di una risposta: forme diverse per rotta, si controllano i campi nei test. */
type Corpo = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function chiama(metodo: string, percorso: string, corpo?: unknown) {
  const r = await fetch(base + percorso, {
    method: metodo,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const testo = await r.text();
  let body: Corpo = null;
  try { body = testo ? JSON.parse(testo) : null; } catch { body = testo; }
  return { status: r.status, body, headers: r.headers };
}

/** Caricamento multipart come fa la pagina: campo "files", etichette separate da virgola. */
async function carica(nome: string, contenuto: string, tipo = 'application/pdf', etichette = '') {
  const form = new FormData();
  form.append('files', new Blob([contenuto], { type: tipo }), nome);
  if (etichette) form.append('etichette', etichette);
  const r = await fetch(`${base}/api/documenti`, { method: 'POST', body: form });
  return { status: r.status, body: (await r.json()) as Corpo };
}

const CHECKLIST = {
  nome: 'Subappalto: documenti di sicurezza',
  requisiti: [
    { codice: 'DURC-01', titolo: 'DURC in corso di validità', obbligatorio: true, regola: { tipo: 'presenza', termini: ['DURC'] } },
    { codice: 'PEN-01', titolo: 'Clausola delle penali', obbligatorio: true, regola: { tipo: 'presenza', termini: ['penale'] } },
  ],
};

describe('rotte HTTP di Verifica Requisiti', () => {
  it('ping, intestazioni di sicurezza e niente cache sulle API', async () => {
    const ping = await fetch(`${base}/ping`, { method: 'POST' });
    expect(ping.status).toBe(204);
    const r = await chiama('GET', '/api/prompts');
    expect(r.status).toBe(200);
    expect(r.body.prompts.length).toBeGreaterThan(0);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('checklist: crea, leggi, modifica, elimina; errori di compilazione con 400 e 404', async () => {
    const senzaNome = await chiama('POST', '/api/requisiti', { nome: ' ', requisiti: [] });
    expect(senzaNome.status).toBe(400);
    expect(senzaNome.body.error).toContain('Manca il nome');

    const regexPericolosa = await chiama('POST', '/api/requisiti', {
      nome: 'x', requisiti: [{ codice: 'R1', titolo: 'r', obbligatorio: true, regola: { tipo: 'regex', pattern: '(a+)+' } }],
    });
    expect(regexPericolosa.status).toBe(400);
    expect(regexPericolosa.body.error).toContain('quantificatori annidati');

    const tipoIgnoto = await chiama('POST', '/api/requisiti', {
      nome: 'x', requisiti: [{ codice: 'R1', titolo: 'r', obbligatorio: true, regola: { tipo: 'magia' } }],
    });
    expect(tipoIgnoto.status).toBe(400);

    const creata = await chiama('POST', '/api/requisiti', CHECKLIST);
    expect(creata.status).toBe(201);
    const id = creata.body.set.id as string;
    expect((await chiama('GET', '/api/requisiti')).body.set.map((s: { id: string }) => s.id)).toContain(id);
    expect((await chiama('GET', `/api/requisiti/${id}`)).body.set.nome).toBe(CHECKLIST.nome);

    const modificata = await chiama('PUT', `/api/requisiti/${id}`, { ...CHECKLIST, nome: 'Subappalto (rev. 2)' });
    expect(modificata.status).toBe(200);
    expect(modificata.body.set.nome).toBe('Subappalto (rev. 2)');

    expect((await chiama('DELETE', `/api/requisiti/${id}`)).status).toBe(200);
    expect((await chiama('GET', `/api/requisiti/${id}`)).status).toBe(404);
    expect((await chiama('PUT', `/api/requisiti/${id}`, CHECKLIST)).status).toBe(404);
    expect((await chiama('DELETE', `/api/requisiti/${id}`)).status).toBe(404);
  });

  it('documenti: caricamento multipart, doppione, file non ammesso, elenco, scheda, file, eliminazione', async () => {
    accoda.mockClear();
    const su = await carica('contratto subappalto.pdf', '%PDF-1.4 contratto di prova A', 'application/pdf', 'commessa-101, fornitore-x');
    expect(su.status).toBe(201);
    const { id, duplicato, stato } = su.body.documenti[0];
    expect([duplicato, stato]).toEqual([false, 'in-coda']);
    expect(accoda).toHaveBeenCalledWith(id);

    // stesso contenuto: niente secondo documento, si riconosce dall'impronta
    const doppio = await carica('copia.pdf', '%PDF-1.4 contratto di prova A');
    expect(doppio.body.documenti[0]).toMatchObject({ id, duplicato: true });

    const testo = await carica('note.txt', 'non sono un PDF', 'text/plain');
    expect(testo.status).toBe(400);
    expect(testo.body.error).toContain('Ammessi solo PDF');
    const vuoto = await fetch(`${base}/api/documenti`, { method: 'POST', body: new FormData() });
    expect(vuoto.status).toBe(400);

    const elenco = await chiama('GET', '/api/documenti?etichetta=commessa-101');
    expect(elenco.body.documenti.map((d: { id: string }) => d.id)).toEqual([id]);
    const scheda = await chiama('GET', `/api/documenti/${id}`);
    expect(scheda.body.documento).toMatchObject({ nomeFile: 'contratto subappalto.pdf', etichette: ['commessa-101', 'fornitore-x'], caricatoDa: 'anonimo' });

    // il file torna identico, in una sandbox: un PDF caricato non esegue script nella pagina
    const file = await fetch(`${base}/api/documenti/${id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('application/pdf');
    expect(file.headers.get('content-security-policy')).toBe('sandbox');
    expect(await file.text()).toBe('%PDF-1.4 contratto di prova A');

    expect((await chiama('DELETE', `/api/documenti/${id}`)).body).toMatchObject({ ok: true, verificheEliminate: 0 });
    expect((await chiama('GET', `/api/documenti/${id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/documenti/${id}/file`)).status).toBe(404);
  });

  it('verifica: esito per requisito sul testo estratto, documento non pronto, report Excel, ricerca', async () => {
    const setId = (await chiama('POST', '/api/requisiti', CHECKLIST)).body.set.id as string;
    const pronto = (await carica('subappalto-impianti.pdf', '%PDF-1.4 contratto di prova B')).body.documenti[0].id as string;
    const inCoda = (await carica('subappalto-scavi.pdf', '%PDF-1.4 contratto di prova C')).body.documenti[0].id as string;
    segnaEstratto(pronto, "Il subappaltatore consegna il DURC in corso di validità prima dell'ingresso in cantiere.");

    expect((await chiama('POST', '/api/verifiche', { documentoId: pronto })).status).toBe(400);
    expect((await chiama('POST', '/api/verifiche', { setId })).status).toBe(400);
    expect((await chiama('POST', '/api/verifiche', { setId: 'set-inesistente', documentoId: pronto })).status).toBe(404);

    const eseguita = await chiama('POST', '/api/verifiche', { setId, documentoIds: [pronto, inCoda, 'doc-inesistente'] });
    expect(eseguita.status).toBe(201);
    expect(eseguita.body.verifiche).toHaveLength(1);
    const verifica = eseguita.body.verifiche[0];
    expect(verifica.risultati.map((r: { codice: string; esito: string }) => [r.codice, r.esito])).toEqual([['DURC-01', 'ok'], ['PEN-01', 'ko']]);
    expect(verifica.esito).toBe('ko');
    expect(eseguita.body.scartati).toEqual([
      { documentoId: inCoda, motivo: 'Estrazione del testo non ancora completata' },
      { documentoId: 'doc-inesistente', motivo: 'Documento non trovato' },
    ]);

    const elenco = await chiama('GET', `/api/verifiche?documentoId=${pronto}`);
    expect(elenco.body.verifiche).toHaveLength(1);
    expect(elenco.body.verifiche[0].conteggi).toEqual({ ok: 1, ko: 1, dubbio: 0 });
    expect((await chiama('GET', `/api/verifiche/${verifica.id}`)).body.verifica.id).toBe(verifica.id);
    expect((await chiama('GET', '/api/verifiche/ver-inesistente')).status).toBe(404);

    // report Excel: un file xlsx vero (zip, comincia con "PK")
    const report = await fetch(`${base}/api/verifiche/${verifica.id}/report.xlsx`);
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toContain('spreadsheetml');
    expect(Buffer.from(await report.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    expect((await chiama('POST', '/api/verifiche/report.xlsx', { verificheIds: ['ver-inesistente'] })).status).toBe(400);

    // ricerca: l'indice si ricostruisce dal testo già estratto
    expect((await chiama('POST', '/api/ricerca/ricostruisci')).body.documentiIndicizzati).toBeGreaterThanOrEqual(1);
    const trovati = await chiama('GET', '/api/ricerca?q=DURC');
    expect(trovati.status).toBe(200);
    expect(JSON.stringify(trovati.body.risultati)).toContain(pronto);
    expect((await chiama('GET', '/api/ricerca?q=a')).status).toBe(400);

    // eliminando il documento se ne vanno anche le sue verifiche
    expect((await chiama('DELETE', `/api/documenti/${pronto}`)).body.verificheEliminate).toBe(1);
    expect((await chiama('GET', `/api/verifiche/${verifica.id}`)).status).toBe(404);
  });

  it('esito incollato da Claude: senza testo 400, documento sconosciuto 404', async () => {
    expect((await chiama('POST', '/api/verifiche/importa', { risposta: '  ' })).status).toBe(400);
    expect((await chiama('POST', '/api/verifiche/importa', { risposta: '{}', documentoId: 'doc-inesistente' })).status).toBe(404);
  });
});
