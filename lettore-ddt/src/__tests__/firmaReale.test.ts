// "><(((º> sabusabu <º)))><"
// firmaReale.test.ts — DDT firmati con il motore della firma VERO (shared/firma, Python in .venv):
// le buste le crea shared/firma/test_firma.py con un ente certificatore di prova, che si passa come
// certificato di fiducia (FIRMA_ANCORE_EXTRA). Niente rete (DDT_FIRMA_RETE=0) e cache degli elenchi in
// una cartella temporanea. Se il motore non è installato (shared\firma\installa.bat) il test si salta.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { apriDdtFirmato, eBustaFirmata } from '../services/firmaDigitale';

const CARTELLA_FIRMA = path.resolve(__dirname, '..', '..', '..', 'shared', 'firma');
const PYTHON = path.join(
  CARTELLA_FIRMA,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
const conMotore = fs.existsSync(PYTHON) ? describe : describe.skip;

conMotore('motore della firma vero', () => {
  let tmp: string;
  const vecchie: Record<string, string | undefined> = {};

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-firma-vera-'));
    execFileSync(PYTHON, [path.join(CARTELLA_FIRMA, 'test_firma.py'), 'fixture', tmp]);
    const ancore = path.join(tmp, 'ancore');
    fs.mkdirSync(ancore);
    fs.copyFileSync(path.join(tmp, 'ente.pem'), path.join(ancore, 'ente.pem'));
    const nuove = {
      FIRMA_ANCORE_EXTRA: ancore,
      FIRMA_CACHE_DIR: path.join(tmp, 'cache'),
      DDT_FIRMA_RETE: '0',
    };
    for (const [k, v] of Object.entries(nuove)) {
      vecchie[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(vecchie)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('apre la busta vera: PDF dentro, firma digitale valida di Mario Rossi', async () => {
    const busta = fs.readFileSync(path.join(tmp, 'firmato.pdf.p7m'));
    expect(eBustaFirmata(busta, 'senza-estensione')).toBe(true);
    const { pdf, nomePdf, firma } = await apriDdtFirmato(busta, 'DDT 3.pdf.p7m');
    expect(pdf.equals(fs.readFileSync(path.join(tmp, 'documento.pdf')))).toBe(true);
    expect(nomePdf).toBe('DDT 3.pdf');
    expect(firma.esito).toBe('valida');
    expect(firma.firmatari[0]).toMatchObject({
      nome: 'Mario Rossi',
      tipo: 'firma digitale',
      codiceFiscale: 'RSSMRA80A01H501U',
    });
  }, 60_000);

  it('documento alterato dopo la firma: si legge lo stesso, ma la firma è NON valida', async () => {
    const { pdf, firma } = await apriDdtFirmato(
      fs.readFileSync(path.join(tmp, 'alterato.pdf.p7m')),
      'x.pdf.p7m'
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(firma.esito).toBe('non valida');
    expect(firma.riepilogo).toMatch(/modificato dopo la firma/);
  }, 60_000);
});
