// automazione.test.ts — Drenaggio dell'input, cartelle sorvegliate e registro
// permanente delle conversioni. Nessuna chiamata all'API: si testa il contorno.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { CARTELLA_ELABORATI, FileOutcome, spostaPdfElaborati } from '../batch/engine';
import { MIN_MINUTI_SCANSIONE, normalizzaSorvegliata } from '../batch/config';
import { pdfPronti } from '../batch/sorveglianza';
import {
  formattaRiga,
  registraLavoro,
  registroPath,
  ultimeRighe,
} from '../services/registroLavori';
import { addToPaniere, clearPaniere, doppioniPaniere } from '../services/paniere';
import { BASE_DIR } from '../routes/helpers';

let tmpDir: string;
const tmp = (...p: string[]) => path.join(tmpDir, ...p);

const scriviPdf = (dir: string, nome: string, mtime?: Date) => {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, nome);
  fs.writeFileSync(full, '%PDF-1.4 finto');
  if (mtime) fs.utimesSync(full, mtime, mtime);
  return full;
};

const esito = (pdfName: string, status: FileOutcome['status']): FileOutcome => ({
  pdfName,
  status,
});

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automazione-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Drenaggio dell'input ────────────────────────────────────────────────────
describe('spostaPdfElaborati', () => {
  it('sposta solo i convertiti, lascia falliti e saltati dove sono', () => {
    const dir = tmp('drenaggio1');
    scriviPdf(dir, 'ok.pdf');
    scriviPdf(dir, 'fallito.pdf');
    scriviPdf(dir, 'saltato.pdf');

    const spostati = spostaPdfElaborati(dir, [
      esito('ok.pdf', 'ok'),
      esito('fallito.pdf', 'failed'),
      esito('saltato.pdf', 'skipped'),
    ]);

    expect(spostati).toBe(1);
    expect(fs.existsSync(path.join(dir, 'ok.pdf'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'fallito.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'saltato.pdf'))).toBe(true);

    const mese = new Date().toISOString().slice(0, 7);
    expect(fs.existsSync(path.join(dir, CARTELLA_ELABORATI, mese, 'ok.pdf'))).toBe(true);
  });

  it('stesso nome già archiviato → affianca invece di sovrascrivere', () => {
    const dir = tmp('drenaggio2');
    const mese = new Date().toISOString().slice(0, 7);
    const dest = path.join(dir, CARTELLA_ELABORATI, mese);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'DDT.pdf'), 'archiviato il mese scorso');
    scriviPdf(dir, 'DDT.pdf');

    expect(spostaPdfElaborati(dir, [esito('DDT.pdf', 'ok')])).toBe(1);
    // L'originale archiviato è intatto e ora ci sono due file.
    expect(fs.readFileSync(path.join(dest, 'DDT.pdf'), 'utf8')).toBe('archiviato il mese scorso');
    expect(fs.readdirSync(dest)).toHaveLength(2);
  });

  it('file già sparito non conta e non fa rumore', () => {
    const dir = tmp('drenaggio3');
    fs.mkdirSync(dir, { recursive: true });
    expect(spostaPdfElaborati(dir, [esito('mai-esistito.pdf', 'ok')])).toBe(0);
  });

  it('nessun file riuscito → non crea nemmeno la cartella', () => {
    const dir = tmp('drenaggio4');
    fs.mkdirSync(dir, { recursive: true });
    expect(spostaPdfElaborati(dir, [esito('x.pdf', 'failed')])).toBe(0);
    expect(fs.existsSync(path.join(dir, CARTELLA_ELABORATI))).toBe(false);
  });
});

// ── Sorveglianza ────────────────────────────────────────────────────────────
describe('normalizzaSorvegliata', () => {
  it('scarta le voci senza commessa/input/output', () => {
    expect(normalizzaSorvegliata(null)).toBeNull();
    expect(normalizzaSorvegliata({ commessa: 'A' })).toBeNull();
    expect(normalizzaSorvegliata({ commessa: 'A', input: 'in' })).toBeNull();
  });

  it('applica i default e il minimo sull intervallo', () => {
    const s = normalizzaSorvegliata({ commessa: 'A', input: 'in', output: 'out', ogniMinuti: 1 });
    expect(s?.ogniMinuti).toBe(MIN_MINUTI_SCANSIONE);
    // spostaElaborati acceso di default: senza, la cartella non si svuota mai.
    expect(s?.spostaElaborati).toBe(true);
    expect(s?.attiva).toBe(true);
    expect(path.isAbsolute(s!.input)).toBe(true);
  });

  it('rispetta le disattivazioni esplicite', () => {
    const s = normalizzaSorvegliata({
      commessa: 'A',
      input: 'in',
      output: 'out',
      spostaElaborati: false,
      attiva: false,
      ogniMinuti: 120,
    });
    expect(s?.spostaElaborati).toBe(false);
    expect(s?.attiva).toBe(false);
    expect(s?.ogniMinuti).toBe(120);
  });
});

describe('pdfPronti', () => {
  // "><(((º> sabusabu <º)))><"
  it('prende solo i PDF fermi da abbastanza tempo', () => {
    const dir = tmp('sorveglianza1');
    const vecchio = new Date(Date.now() - 10 * 60_000);
    scriviPdf(dir, 'fermo.pdf', vecchio);
    scriviPdf(dir, 'appena-copiato.pdf'); // mtime adesso → ancora in copia
    expect(pdfPronti(dir)).toEqual(['fermo.pdf']);
  });

  it('ignora i non-PDF e la cartella inesistente', () => {
    const dir = tmp('sorveglianza2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
    expect(pdfPronti(dir)).toEqual([]);
    expect(pdfPronti(tmp('mai-creata'))).toEqual([]);
  });
});

// ── Registro permanente ─────────────────────────────────────────────────────
describe('registroLavori', () => {
  const commessa = '__test_registro__';
  const riga = {
    avviato: '2026-07-21T09:00:00.000Z',
    concluso: '2026-07-21T09:20:00.000Z',
    jobId: 'abc',
    avviatoDa: 'sorveglianza',
    stato: 'completato',
    prompt: 'ddt',
    modello: 'claude-haiku-4-5',
    pdfTotali: 10,
    convertiti: 9,
    falliti: 1,
    saltati: 0,
    spostati: 9,
    costoUsd: 0.1234,
    excelUnico: '',
    cartellaInput: 'D:/DDT/in',
    errore: '',
  };

  afterAll(() => {
    fs.rmSync(path.join(BASE_DIR, 'data', commessa), { recursive: true, force: true });
  });

  it('usa il ; come separatore e la virgola decimale (Excel italiano)', () => {
    const s = formattaRiga(riga);
    expect(s.split(';')).toHaveLength(16);
    expect(s).toContain('0,1234');
  });

  it('protegge i campi che contengono ; o virgolette', () => {
    const s = formattaRiga({ ...riga, errore: 'rotto; "davvero"' });
    expect(s).toContain('"rotto; ""davvero"""');
  });

  it('schiaccia gli a capo: una riga per lavoro, sempre', () => {
    expect(formattaRiga({ ...riga, errore: 'prima\nseconda' })).toContain('prima seconda');
  });

  it('scrive intestazione una volta sola e accoda le righe', () => {
    registraLavoro(commessa, riga);
    registraLavoro(commessa, { ...riga, jobId: 'def' });
    const testo = fs.readFileSync(registroPath(commessa), 'utf8');
    expect(testo.split('\n').filter((r) => r.trim())).toHaveLength(3); // testata + 2
    expect(testo.match(/avviato;concluso/g)).toHaveLength(1);
    // BOM: senza, Excel apre il CSV in ANSI e rovina le accentate.
    expect(testo.charCodeAt(0)).toBe(0xfeff);
  });

  it('ultimeRighe salta la testata e mette le più recenti in cima', () => {
    const righe = ultimeRighe(commessa, 10);
    expect(righe).toHaveLength(2);
    expect(righe[0]).toContain('def');
  });

  it('commessa senza registro → lista vuota, niente eccezioni', () => {
    expect(ultimeRighe('__test_registro_vuoto__', 5)).toEqual([]);
  });
});

// ── Doppioni nel paniere ────────────────────────────────────────────────────
describe('doppioniPaniere', () => {
  const commessa = '__test_doppioni__';

  const conDdt = (label: string, numeri: string[]) =>
    addToPaniere(commessa, {
      label,
      source: 'chat',
      addedBy: 'tester',
      data: {
        sheets: [{ name: 'DDT', headers: ['N°DDT', 'm³'], rows: numeri.map((n) => [n, '10']) }],
      },
    });

  afterEach(() => clearPaniere(commessa));

  afterAll(() => {
    fs.rmSync(path.join(BASE_DIR, 'data', commessa), { recursive: true, force: true });
  });

  it('segnala il DDT presente in due voci diverse', () => {
    conDdt('maggio.pdf', ['100', '101']);
    conDdt('giugno.pdf', ['101', '102']);
    const d = doppioniPaniere(commessa);
    expect(d).toHaveLength(1);
    expect(d[0].ddt).toBe('101');
    expect(d[0].voci.sort()).toEqual(['giugno.pdf', 'maggio.pdf']);
  });

  it('numeri tutti distinti → nessun avviso', () => {
    conDdt('a.pdf', ['1']);
    conDdt('b.pdf', ['2']);
    expect(doppioniPaniere(commessa)).toEqual([]);
  });

  it('lo stesso DDT ripetuto DENTRO una sola voce non è un doppione fra voci', () => {
    conDdt('doppia-riga.pdf', ['7', '7']);
    expect(doppioniPaniere(commessa)).toEqual([]);
  });
});
