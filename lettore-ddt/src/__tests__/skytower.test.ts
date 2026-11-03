// "><(((º> sabusabu <º)))><"
// skytower.test.ts — invio dei DDT elaborati a SkyTower (services/skytower):
// codice commessa dall'utente o dal registro, PDF obbligatorio, mai un errore.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';

const chiama = jest.fn();
const trovaCommessa = jest.fn();
jest.mock('../../../shared/suite/suite_link.js', () => ({
  chiama: (...a: unknown[]) => chiama(...a),
  trovaCommessa: (c: string) => trovaCommessa(c),
  normalizzaCommessa: (c: string) => String(c || '').replace(/\s+/g, '').toUpperCase(),
}));

import { createUser, deleteUser } from '../models/users';
import { codiceCommessaPer, descriviDdt, inviaDdtASkyTower, tipoDocumento } from '../services/skytower';

const parsed = {
  sheets: [
    {
      name: 'F1-Dettaglio DDT',
      headers: ['Fornitore', 'P.IVA Fornitore', 'N°DDT', 'Data', 'm³'],
      rows: [
        ['Calcestruzzi Sud', '01234567890', '1021', '03/11/2026', '7,5'],
        ['Calcestruzzi Sud', '01234567890', '1022', '03/11/2026', '8'],
      ],
    },
  ],
};

let tmp: string;
let pdf: string;
const ids: string[] = [];

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-skytower-'));
  pdf = path.join(tmp, 'ddt.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4 finto');
});
afterAll(() => {
  ids.forEach((id) => deleteUser(id));
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  chiama.mockReset();
  trovaCommessa.mockReset();
  delete process.env.DDT_SKYTOWER;
  delete process.env.DDT_SKYTOWER_TIPO;
});

function utente(codiceCommessa = '') {
  const id = uuidv4();
  const username = `sky-${id.slice(0, 8)}`;
  createUser(id, username, 'password-lunga-1', 'demo-augusta', 'Sky', false, codiceCommessa);
  ids.push(id);
  return username;
}

test('codice commessa: campo utente, poi registro, altrimenti niente', () => {
  const conCodice = utente('101-003');
  expect(codiceCommessaPer(conCodice, 'demo-augusta')).toBe('101-003');
  const senza = utente();
  trovaCommessa.mockReturnValue(null);
  expect(codiceCommessaPer(senza, 'demo-augusta')).toBe('');
  trovaCommessa.mockReturnValue({ code: '102-001', nome: 'x' });
  expect(codiceCommessaPer(senza, '102-001')).toBe('102-001');
  expect(codiceCommessaPer('utente-inesistente', '102-001')).toBe('102-001');
});

test('descriviDdt: titolo con numeri e fornitore, attributi', () => {
  const d = descriviDdt(parsed, 'demo-augusta', 'ddt_1021.json');
  expect(d.titolo).toBe('DDT 1021, 1022 - Calcestruzzi Sud');
  expect(d.attributes).toMatchObject({ origine: 'ddt', ddt: ['1021', '1022'], fornitori: ['Calcestruzzi Sud'], righe: 2, data_prima: '2026-11-03' });
  expect(tipoDocumento()).toBe('RP');
  process.env.DDT_SKYTOWER_TIPO = 'ddt';
  expect(tipoDocumento()).toBe('DD');
});

test('invio: chiamata a SkyTower con file nel corpo e metadati in query', async () => {
  const u = utente('101-003 SEDE');
  chiama.mockResolvedValue({ identifier: 'PRJ-COS-ZZ-ZZ-RP-Z-0007' });
  const ok = await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: u, pdfPath: pdf, parsed, exportName: 'ddt_1021.json' });
  expect(ok).toBe(true);
  expect(chiama).toHaveBeenCalledTimes(1);
  const [app, metodo, percorso, opz] = chiama.mock.calls[0] as [string, string, string, any];
  expect([app, metodo, percorso]).toEqual(['skytower', 'POST', '/suite/commesse/101-003%20SEDE/documenti']);
  expect(opz.parametri.tipo).toBe('RP');
  expect(opz.parametri.title).toBe('DDT 1021, 1022 - Calcestruzzi Sud');
  expect(JSON.parse(opz.parametri.attributes).origine).toBe('ddt');
  expect(opz.corpoFile.nome).toBe('ddt.pdf');
  expect(opz.corpoFile.dati.toString()).toContain('%PDF');
  expect(opz.utente).toBe(u);
});

test('invio: niente chiamata senza codice, senza PDF o se spento; errori di SkyTower non escono', async () => {
  const u = utente('101-003');
  trovaCommessa.mockReturnValue(null);
  expect(await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: 'nessuno', pdfPath: pdf, parsed, exportName: 'a.json' })).toBe(false);
  expect(await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: u, pdfPath: path.join(tmp, 'manca.pdf'), parsed, exportName: 'a.json' })).toBe(false);
  expect(await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: u, parsed, exportName: 'a.json' })).toBe(false);
  process.env.DDT_SKYTOWER = '0';
  expect(await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: u, pdfPath: pdf, parsed, exportName: 'a.json' })).toBe(false);
  expect(chiama).not.toHaveBeenCalled();
  delete process.env.DDT_SKYTOWER;
  chiama.mockRejectedValue(Object.assign(new Error('giù'), { stato: 503, messaggio: 'SkyTower non raggiungibile' }));
  expect(await inviaDdtASkyTower({ commessaId: 'demo-augusta', utente: u, pdfPath: pdf, parsed, exportName: 'a.json' })).toBe(false);
});
