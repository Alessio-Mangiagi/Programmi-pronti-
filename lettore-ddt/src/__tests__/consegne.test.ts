// "><(((º> sabusabu <º)))><"
// Registro consegne per fornitore (services/consegne) e rotte /fornitori.
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';
import ExcelJS from 'exceljs';
import app from '../app';
import { createUser, deleteUser, listUsers } from '../models/users';
import { BASE_DIR } from '../routes/helpers';
import {
  Consegna,
  dataIso,
  dettaglioFornitore,
  estraiConsegne,
  leggiRegistro,
  normalizzaNome,
  normalizzaPiva,
  pivaValida,
  registraExport,
  righeRegistro,
  riepilogoFornitori,
} from '../services/consegne';

/** P.IVA valida costruita da 10 cifre: aggiunge la cifra di controllo giusta. */
function piva(base10: string): string {
  for (let c = 0; c <= 9; c++) if (pivaValida(base10 + c)) return base10 + c;
  throw new Error('impossibile');
}
const PIVA_CLS = piva('0123456789');
const PIVA_CAVA = piva('0987654321');

const cls = (righe: string[][]) => ({
  sheets: [
    {
      name: 'F1-Dettaglio DDT',
      headers: [
        'Fornitore',
        'P.IVA Fornitore',
        'N°DDT',
        'Data',
        'OraCarico',
        'Targa',
        'WBS',
        'ParteOpera',
        'ClRes',
        'm³',
      ],
      rows: righe,
    },
    // F2 ha anch'esso Fornitore e N°DDT: non deve raddoppiare le consegne.
    {
      name: 'F2-Riepilogo Cls',
      headers: ['Fornitore', 'N°DDT', 'Data', 'TipoCls', 'Totale m³'],
      rows: [['X', '1', '', 'C25/30', '999']],
    },
  ],
});

describe('consegne: normalizzazioni', () => {
  it("P.IVA: toglie IT, spazi e punti; scarta cio' che non ha 11 cifre", () => {
    expect(normalizzaPiva(`IT ${PIVA_CLS}`)).toBe(PIVA_CLS);
    expect(normalizzaPiva('01.234.567.890')).toBe('01234567890');
    expect(normalizzaPiva('0123456789')).toBe(''); // 10 cifre
    expect(normalizzaPiva('mancante')).toBe('');
    expect(pivaValida(PIVA_CLS)).toBe(true);
    expect(pivaValida(PIVA_CLS.slice(0, 10) + ((Number(PIVA_CLS[10]) + 1) % 10))).toBe(false);
  });

  it('nome: forme societarie, punteggiatura, accenti e maiuscole non contano', () => {
    const n = normalizzaNome('Calcestruzzi Sicilia S.R.L.');
    expect(normalizzaNome('CALCESTRUZZI SICILIA SRL')).toBe(n);
    expect(normalizzaNome('calcestruzzi  sicilia s.r.l')).toBe(n);
    expect(normalizzaNome('Calcestruzzi Sicilia Srl.')).toBe(n);
    expect(normalizzaNome('Società Cave & Inerti S.p.A.')).toBe('SOCIETA CAVE E INERTI');
    expect(normalizzaNome('Calcestruzzi Sicilia')).toBe(n);
  });

  it('date: italiane, a due cifre e ISO; il resto vuoto', () => {
    expect(dataIso('5/3/2026')).toBe('2026-03-05');
    expect(dataIso('05/03/26')).toBe('2026-03-05');
    expect(dataIso('2026-03-05T00:00:00Z')).toBe('2026-03-05');
    expect(dataIso('32/03/2026')).toBe('');
    expect(dataIso('mancante')).toBe('');
  });
});

describe('consegne: estrazione dai tre formati DDT', () => {
  it('calcestruzzo: m³, classe come materiale, solo il foglio F1', () => {
    const r = estraiConsegne(
      cls([
        [
          'Calcestruzzi Sicilia SRL',
          `IT${PIVA_CLS}`,
          '101',
          '05/03/2026',
          '7:10',
          'AB123CD',
          'P1',
          'plinto',
          'C25/30',
          '8,5',
        ],
        ['', '', 'TOTALE', '', '', '', '', '', '', '8,5'],
      ]),
      'c1',
      'a.json'
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      fornitore: 'Calcestruzzi Sicilia SRL',
      piva: PIVA_CLS,
      ddt: '101',
      dataIso: '2026-03-05',
      materiale: 'Calcestruzzo C25/30',
      quantita: 8.5,
      um: 'm³',
      destinazione: 'P1',
      targa: 'AB123CD',
    });
  });

  it("inerti: quantita' con la sua u.m.", () => {
    const r = estraiConsegne(
      {
        sheets: [
          {
            name: 'DDT Inerti',
            headers: [
              'Fornitore',
              'P.IVA Fornitore',
              'Data',
              'N°DDT',
              'Descrizione',
              'Targa',
              'u.m.',
              'Quantità',
              'Destinazione/WBS',
            ],
            rows: [
              [
                'Cave Rossi',
                'mancante',
                '06/03/2026',
                'B7',
                'Misto stabilizzato',
                'XY',
                'TON',
                '1.250,5',
                'Rilevato',
              ],
            ],
          },
        ],
      },
      'c1',
      'b.json'
    );
    expect(r[0]).toMatchObject({
      piva: '',
      materiale: 'Misto stabilizzato',
      quantita: 1250.5,
      um: 'ton',
      destinazione: 'Rilevato',
    });
  });

  it('cava: Cedente e P.IVA Cedente, Mc come m³; senza volume vale il peso', () => {
    const r = estraiConsegne(
      {
        sheets: [
          {
            name: 'F1-Dettaglio DDT',
            headers: [
              'Cedente',
              'P.IVA Cedente',
              'N°DDT',
              'Data',
              'Luogo Destinazione',
              'Targa',
              'Tipo Materiale',
              'Quantità Mc',
              'Peso Kg',
            ],
            rows: [
              [
                'Inerti Etna',
                PIVA_CAVA,
                '9',
                '07/03/2026',
                'Cantiere Augusta',
                'ZZ',
                'Pietrisco',
                '12',
                '18000',
              ],
              [
                'Inerti Etna',
                PIVA_CAVA,
                '10',
                '07/03/2026',
                'Cantiere Augusta',
                'ZZ',
                'Pietrisco',
                '(illeggibile)',
                '17500',
              ],
            ],
          },
        ],
      },
      'c2',
      'c.json'
    );
    expect(r.map((x) => [x.quantita, x.um])).toEqual([
      [12, 'm³'],
      [17500, 'kg'],
    ]);
    expect(r[0].destinazione).toBe('Cantiere Augusta');
  });

  it("export che non e' un DDT -> nessuna consegna", () => {
    expect(
      estraiConsegne(
        { sheets: [{ name: 'Fattura', headers: ['Descrizione'], rows: [['x']] }] },
        'c',
        'x.json'
      )
    ).toEqual([]);
    expect(estraiConsegne(null, 'c', 'x.json')).toEqual([]);
  });
});

describe('consegne: riepilogo per fornitore', () => {
  const riga = (p: Partial<Consegna>): Consegna => ({
    commessa: 'c1',
    export: 'e1.json',
    fornitore: 'Calcestruzzi Sicilia SRL',
    piva: PIVA_CLS,
    ddt: '1',
    data: '05/03/2026',
    dataIso: '2026-03-05',
    materiale: 'Calcestruzzo C25/30',
    quantita: 8,
    um: 'm³',
    destinazione: '',
    targa: '',
    ...p,
  });

  it('una riga senza P.IVA si attacca al fornitore con lo stesso nome', () => {
    const fs_ = riepilogoFornitori([
      riga({ ddt: '1' }),
      riga({ ddt: '2', piva: '', fornitore: 'CALCESTRUZZI SICILIA S.R.L.', dataIso: '2026-03-20' }),
      riga({ ddt: '3', fornitore: 'Altra Ditta', piva: PIVA_CAVA, dataIso: '2026-02-01' }),
    ]);
    expect(fs_).toHaveLength(2);
    const c = fs_.find((f) => f.piva === PIVA_CLS)!;
    expect(c).toMatchObject({ ddt: 2, righe: 2, prima: '2026-03-05', ultima: '2026-03-20' });
    expect(c.totali).toEqual([{ um: 'm³', quantita: 16 }]);
    expect(c.anomalie.map((a) => a.tipo)).toEqual(expect.arrayContaining(['senza-piva']));
    expect(fs_[0].piva).toBe(PIVA_CLS); // ordinati dall'ultima consegna
  });

  it('senza nessuna P.IVA si raggruppa per nome normalizzato', () => {
    const [f] = riepilogoFornitori([
      riga({ piva: '', fornitore: 'Cave Rossi snc', ddt: 'A' }),
      riga({ piva: '', fornitore: 'CAVE ROSSI S.N.C.', ddt: 'B' }),
    ]);
    expect(f.chiave).toBe('nome:CAVE ROSSI');
    expect(f.ddt).toBe(2);
    expect(f.anomalie[0].tipo).toBe('senza-piva');
  });

  it("anomalie: DDT in due export, P.IVA errata, nomi diversi, quantita' mancante", () => {
    const errata = PIVA_CLS.slice(0, 10) + ((Number(PIVA_CLS[10]) + 1) % 10);
    const [f] = riepilogoFornitori([
      riga({ piva: errata, ddt: '7', export: 'a.json' }),
      riga({ piva: errata, ddt: '7', export: 'b.json' }),
      riga({ piva: errata, ddt: '8', fornitore: 'Calcestruzzi del Sud', quantita: null }),
    ]);
    expect(f.anomalie.map((a) => a.tipo).sort()).toEqual(
      ['ddt-ripetuto', 'nomi-diversi', 'piva-non-valida', 'quantita-mancante'].sort()
    );
  });

  it("stesso numero DDT in commesse diverse non e' un doppione", () => {
    const [f] = riepilogoFornitori([
      riga({ commessa: 'c1', export: 'a.json' }),
      riga({ commessa: 'c2', export: 'b.json' }),
    ]);
    expect(f.ddt).toBe(2);
    expect(f.anomalie).toEqual([]);
  });

  it('dettaglio: consegne recenti prima, totali per mese', () => {
    const righe = [
      riga({ ddt: '1', dataIso: '2026-02-10', quantita: 5 }),
      riga({ ddt: '2', dataIso: '2026-03-05', quantita: 7 }),
      riga({ ddt: '3', dataIso: '2026-03-06', quantita: 1.5 }),
      riga({ ddt: '9', fornitore: 'Altro', piva: PIVA_CAVA }),
    ];
    const d = dettaglioFornitore(righe, `piva:${PIVA_CLS}`)!;
    expect(d.consegne.map((c) => c.ddt)).toEqual(['3', '2', '1']);
    expect(d.perMese).toEqual([
      { mese: '2026-03', um: 'm³', quantita: 8.5, ddt: 2 },
      { mese: '2026-02', um: 'm³', quantita: 5, ddt: 1 },
    ]);
    expect(dettaglioFornitore(righe, 'piva:00000000000')).toBeNull();
  });
});

describe('consegne: registro persistente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consegne-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ddt = (n: string) =>
    cls([['Calcestruzzi Sicilia SRL', PIVA_CLS, n, '05/03/2026', '', '', '', '', 'C25/30', '8']]);

  it('al primo accesso si ricostruisce dagli export archiviati', () => {
    fs.mkdirSync(path.join(dir, 'json_exports'));
    fs.writeFileSync(path.join(dir, 'json_exports', 'vecchio.json'), JSON.stringify(ddt('1')));
    fs.writeFileSync(path.join(dir, 'json_exports', 'rotto.json'), '{non json');
    const reg = leggiRegistro(dir, 'cx');
    expect(righeRegistro(reg).map((r) => r.ddt)).toEqual(['1']);
    expect(fs.existsSync(path.join(dir, 'consegne.json'))).toBe(true);
  });

  it(
    'registrare e' + "' idempotente e lo storico sopravvive alla potatura degli export",
    async () => {
      await registraExport(dir, 'cx', 'nuovo.json', ddt('2'));
      await registraExport(dir, 'cx', 'nuovo.json', ddt('2')); // risalvato: non duplica
      // Potatura dell'archivio: il JSON vecchio sparisce, le sue consegne restano.
      fs.unlinkSync(path.join(dir, 'json_exports', 'vecchio.json'));
      const righe = righeRegistro(leggiRegistro(dir, 'cx'));
      expect(righe.map((r) => r.ddt).sort()).toEqual(['1', '2']);
    }
  );

  it('registrazioni concorrenti non si cancellano a vicenda', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((n) => registraExport(dir, 'cx', `${n}.json`, ddt(n)))
    );
    const ddts = righeRegistro(leggiRegistro(dir, 'cx')).map((r) => r.ddt);
    expect(ddts).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'e']));
  });

  it('un export risalvato senza DDT toglie le sue righe', async () => {
    await registraExport(dir, 'cx', 'a.json', { sheets: [] });
    expect(righeRegistro(leggiRegistro(dir, 'cx')).some((r) => r.export === 'a.json')).toBe(false);
  });
});

describe('rotte /fornitori', () => {
  const COMMESSA = '__fornitori_test__';
  const ADMIN = `forn-admin-${uuidv4()}`;
  const UTENTE = `forn-user-${uuidv4()}`;
  const PW = 'test-password-123';
  const dirCommessa = path.join(BASE_DIR, 'data', COMMESSA);
  const admin = request.agent(app);
  const utente = request.agent(app);

  beforeAll(async () => {
    fs.mkdirSync(path.join(dirCommessa, 'json_exports'), { recursive: true });
    fs.writeFileSync(
      path.join(dirCommessa, 'json_exports', 'archiviato.json'),
      JSON.stringify(
        cls([
          [
            'Calcestruzzi Sicilia SRL',
            PIVA_CLS,
            '501',
            '05/03/2026',
            '',
            '',
            '',
            '',
            'C25/30',
            '8',
          ],
        ])
      )
    );
    createUser(uuidv4(), ADMIN, PW, COMMESSA, 'Admin Fornitori', true);
    createUser(uuidv4(), UTENTE, PW, COMMESSA, 'Utente Fornitori');
    expect((await admin.post('/auth/login').send({ username: ADMIN, password: PW })).status).toBe(
      200
    );
    expect((await utente.post('/auth/login').send({ username: UTENTE, password: PW })).status).toBe(
      200
    );
  });

  afterAll(() => {
    for (const u of listUsers())
      if (u.username === ADMIN || u.username === UTENTE) deleteUser(u.id);
    fs.rmSync(dirCommessa, { recursive: true, force: true });
  });

  it('riservate agli admin', async () => {
    expect((await utente.get('/fornitori')).status).toBe(401);
    expect((await utente.get('/fornitori/excel')).status).toBe(401);
  });

  it("elenco: ricostruito dall'archivio della commessa", async () => {
    const res = await admin.get(`/fornitori?commessa=${COMMESSA}`);
    expect(res.status).toBe(200);
    expect(res.body.commesse).toContain(COMMESSA);
    expect(res.body.fornitori).toHaveLength(1);
    expect(res.body.fornitori[0]).toMatchObject({
      piva: PIVA_CLS,
      ddt: 1,
      totali: [{ um: 'm³', quantita: 8 }],
    });
  });

  it('una conversione salvata entra nel registro', async () => {
    const parsed = cls([
      ['Calcestruzzi Sicilia SRL', PIVA_CLS, '502', '06/03/2026', '', '', '', '', 'C30/37', '4'],
    ]);
    const conv = await admin
      .post('/claude-to-excel')
      .send({ response: JSON.stringify(parsed), pdfFileName: 'nuova-bolla.pdf' });
    expect(conv.status).toBe(200);
    // Registro aggiornato in coda alla scrittura del JSON: si attende che arrivi.
    let f: { ddt?: number } | undefined;
    for (let i = 0; i < 50; i++) {
      f = (await admin.get(`/fornitori?commessa=${COMMESSA}`)).body.fornitori[0];
      if (f?.ddt === 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(f).toMatchObject({ ddt: 2, ultima: '2026-03-06', totali: [{ um: 'm³', quantita: 12 }] });
  });

  it('dettaglio, chiave non valida, fornitore assente, commessa sconosciuta', async () => {
    const ok = await admin.get(`/fornitori/dettaglio?commessa=${COMMESSA}&chiave=piva:${PIVA_CLS}`);
    expect(ok.status).toBe(200);
    expect(ok.body.consegne.map((c: Consegna) => c.ddt)).toEqual(['502', '501']);
    expect((await admin.get('/fornitori/dettaglio?chiave=../../etc')).status).toBe(400);
    expect(
      (await admin.get(`/fornitori/dettaglio?commessa=${COMMESSA}&chiave=piva:00000000000`)).status
    ).toBe(404);
    expect((await admin.get('/fornitori?commessa=inesistente')).status).toBe(404);
  });

  it("Excel dell'elenco: una riga per fornitore", async () => {
    const res = await admin
      .get(`/fornitori/excel?commessa=${COMMESSA}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('Fornitori da DDT.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const testo: string[] = [];
    wb.getWorksheet('Fornitori')!.eachRow((row) => testo.push(String(row.values)));
    expect(testo.join('\n')).toContain(PIVA_CLS);
  });

  it('Excel del fornitore: tre fogli, consegne dentro', async () => {
    const res = await admin
      .get(`/fornitori/excel?commessa=${COMMESSA}&chiave=piva:${PIVA_CLS}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('Fornitore Calcestruzzi Sicilia SRL.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const nomi = wb.worksheets.map((w) => w.name);
    expect(nomi).toEqual(expect.arrayContaining(['Consegne', 'Per mese', 'Anomalie']));
    const testo: string[] = [];
    wb.getWorksheet('Consegne')!.eachRow((row) => testo.push(String(row.values)));
    expect(testo.join('\n')).toContain('502');
  });
});
