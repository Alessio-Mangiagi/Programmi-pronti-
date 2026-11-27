// "><(((º> sabusabu <º)))><"
/**
 * Test di integrazione del gate davanti alle rotte, con l'app vera in ascolto: gate SSO acceso
 * (come in esercizio) e portale irraggiungibile, così l'unico modo di entrare è il token di
 * servizio della suite (SkyTower). Si controlla, via HTTP e non sulle funzioni, che:
 * - senza sessione del portale le API non rispondono (401 o 503, mai i dati);
 * - il token apre solo le rotte dell'elenco ROTTE_SUITE (metodo + percorso);
 * - col token si vedono solo le risorse create col token, non l'archivio delle persone.
 * Cartella dell'app temporanea (config mockato) e coda dell'estrazione finta, come in rotte.test.ts.
 */
import fs from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

jest.mock('../config', () => {
  const vero = jest.requireActual('../config');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os'), path = require('path'), fsm = require('fs');
  return { ...vero, APP_DIR: fsm.mkdtempSync(path.join(os.tmpdir(), 'verifica-requisiti-gate-')) };
});
jest.mock('../services/estrazione', () => ({
  ...jest.requireActual('../services/estrazione'),
  accodaEstrazione: jest.fn(),
  documentiInCoda: () => 0,
}));

const TOKEN = 'token-di-servizio-del-test-di-integrazione';
const CON_TOKEN = { 'X-Suite-Token': TOKEN, 'X-Suite-Utente': 'skytower', 'X-Suite-Nome': 'SkyTower' };

let server: Server;
let base = '';
let documentoDiUnaPersona = '';

beforeAll(async () => {
  // prima di caricare l'app: gate acceso, portale su una porta dove non risponde nessuno,
  // token di servizio dall'ambiente (shared/suite/suite_link.js lo legge da lì per primo)
  delete process.env.COSEDIL_SSO;
  process.env.COSEDIL_SSO_FAIL = 'closed';
  process.env.COSEDIL_PORTAL = 'http://127.0.0.1:1';
  process.env.SUITE_TOKEN = TOKEN;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const app = require('../app').default;
  require('../utils/logger').default.silent = true;
  const { creaDocumento } = require('../models/archivio');
  /* eslint-enable @typescript-eslint/no-require-imports */
  // documento caricato da una persona entrata dal portale: il token non deve vederlo
  documentoDiUnaPersona = creaDocumento({ nomeFile: 'riservato.pdf', percorso: '', hash: 'h-persona', mime: 'application/pdf', byte: 10, caricatoDa: 'mrossi', etichette: [] }).id;
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

const stato = async (metodo: string, percorso: string, headers: Record<string, string> = {}) =>
  (await fetch(base + percorso, { method: metodo, headers })).status;

describe('gate davanti alle rotte (portale irraggiungibile)', () => {
  it('senza sessione del portale le API non danno dati, a nessuno', async () => {
    for (const [metodo, percorso] of [['GET', '/api/documenti'], ['GET', '/api/requisiti'], ['GET', '/api/prompts'], ['GET', `/api/documenti/${documentoDiUnaPersona}`], ['DELETE', `/api/documenti/${documentoDiUnaPersona}`]]) {
      expect([401, 503]).toContain(await stato(metodo, percorso));
    }
    // token sbagliato: come senza token
    expect([401, 503]).toContain(await stato('GET', '/api/requisiti', { ...CON_TOKEN, 'X-Suite-Token': 'token-sbagliato' }));
  });

  it('il token apre solo le rotte dell\'elenco', async () => {
    expect(await stato('GET', '/api/requisiti', CON_TOKEN)).toBe(200);
    for (const [metodo, percorso] of [['GET', '/api/documenti'], ['GET', '/api/prompts'], ['GET', '/api/verifiche'], ['POST', '/api/ricerca/ricostruisci'], ['DELETE', `/api/documenti/${documentoDiUnaPersona}`], ['GET', `/api/documenti/${documentoDiUnaPersona}/file`]]) {
      expect([401, 503]).toContain(await stato(metodo, percorso, CON_TOKEN));
    }
  });

  it('col token si vede il documento caricato col token, non quello di una persona', async () => {
    const form = new FormData();
    form.append('files', new Blob(['%PDF-1.4 revisione da SkyTower'], { type: 'application/pdf' }), 'tavola.pdf');
    const su = await fetch(`${base}/api/documenti`, { method: 'POST', headers: CON_TOKEN, body: form });
    expect(su.status).toBe(201);
    const id = ((await su.json()) as { documenti: Array<{ id: string }> }).documenti[0].id;

    const scheda = await fetch(`${base}/api/documenti/${id}`, { headers: CON_TOKEN });
    expect(scheda.status).toBe(200);
    // chi carica col token resta riconoscibile: "suite:" davanti al nome dichiarato
    expect(((await scheda.json()) as { documento: { caricatoDa: string } }).documento.caricatoDa).toBe('suite:skytower');

    expect(await stato('GET', `/api/documenti/${documentoDiUnaPersona}`, CON_TOKEN)).toBe(404);
  });
});
