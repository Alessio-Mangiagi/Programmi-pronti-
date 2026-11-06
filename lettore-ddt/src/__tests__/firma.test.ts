// "><(((º> sabusabu <º)))><"
// firma.test.ts — DDT firmati digitalmente in busta .p7m (06/11/2026), con il client della firma FINTO
// (jest.mock di shared/firma/firma.js): niente Python, niente rete. Il motore vero lo prova
// firmaReale.test.ts. Casi:
//   - services/firmaDigitale: busta aperta, esito ridotto, errori con messaggio per l'utente;
//   - conversione singola: /prepare-claude accetta il .p7m, dà esito e PDF estratto da allegare a
//     Claude, /claude-to-excel archivia l'esito e manda a SkyTower la busta col PDF di riserva;
//   - conversione automatica: le buste si aprono in jobDir/sbustati prima del motore (qui Ollama finto),
//     l'esito resta nel job, una busta rotta fa fallire solo quel file.
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';

// ── Client della firma finto ────────────────────────────────────────────────
// Una "busta" finta è un file che inizia con "P7M:" seguito dal PDF; "P7M-ROTTA" è illeggibile.
const PDF_DENTRO = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'
);
const rapporto = {
  firmato: true,
  esito: 'valida',
  riepilogo: 'Firma valida: Mario Rossi (Ente di Prova S.p.A.), 06/11/2026',
  livelli: 1,
  nome_contenuto: 'x.pdf',
  firme: [
    {
      firmatario: 'Mario Rossi',
      codice_fiscale: 'RSSMRA80A01H501U',
      ente_certificatore: 'Ente di Prova S.p.A.',
      tipo: 'firma digitale',
      esito: 'valida',
      data_firma_dichiarata: '2026-11-06T10:00:00+00:00',
      marca_temporale: null,
      motivi: [],
    },
  ],
};
let installato = true;
const apri = jest.fn(async (buffer: Buffer, nome: string) => {
  if (!installato)
    throw Object.assign(new Error('non installato'), { code: 'FIRMA_NON_INSTALLATA' });
  if (buffer.subarray(0, 9).toString() === 'P7M-ROTTA') {
    throw Object.assign(new Error('Busta firmata illeggibile: troncata'), {
      code: 'BUSTA_ILLEGGIBILE',
    });
  }
  const contenuto = buffer.subarray(4);
  const nomeContenuto = String(nome).replace(/(\.p7m)+$/i, '');
  return { contenuto, nomeContenuto, rapporto: { ...rapporto, nome_contenuto: nomeContenuto } };
});
jest.mock('../../../shared/firma/firma.js', () => ({
  eBustaFirmata: (b: Buffer, nome?: string) =>
    /\.p7m$/i.test(String(nome || '')) || b.subarray(0, 3).toString() === 'P7M',
  nomeSenzaP7m: (n: string) => String(n).replace(/(\.p7m)+$/i, ''),
  apri: (b: Buffer, n: string) => apri(b, n),
}));

// SkyTower: si controlla cosa riceverebbe, senza chiamarla
const inviaDdtASkyTower = jest.fn(async (..._a: unknown[]) => true);
jest.mock('../services/skytower', () => ({
  ...jest.requireActual('../services/skytower'),
  inviaDdtASkyTower: (...a: unknown[]) => inviaDdtASkyTower(...a),
}));

// Motore Ollama finto: "converte" ogni PDF che trova nella cartella che gli si passa
const runOllama = jest.fn();
jest.mock('../batch/ollama', () => ({
  ...jest.requireActual('../batch/ollama'),
  runOllama: (...a: unknown[]) => runOllama(...a),
}));

import app from '../app';
import { createUser } from '../models/users';
import { getRecentActivity } from '../models/activityLog';
import { createJob, readJob, type BatchJob } from '../batch/jobs';
import { safeOutputBase, listPdfFiles } from '../batch/scritture';
import { DATA_ROOT, commessaJsonFolder, fileAmmesso } from '../routes/helpers';
import { apriDdtFirmato, eBustaFirmata, ErroreFirma } from '../services/firmaDigitale';

const busta = Buffer.concat([Buffer.from('P7M:'), PDF_DENTRO]);
const COMMESSA = '__test_firma__';

beforeEach(() => {
  installato = true;
  apri.mockClear();
  inviaDdtASkyTower.mockClear();
});

describe('services/firmaDigitale', () => {
  it('apre la busta: PDF, nome e esito ridotto per le pagine', async () => {
    const { pdf, nomePdf, firma } = await apriDdtFirmato(busta, 'DDT 12.pdf.p7m');
    expect(pdf.equals(PDF_DENTRO)).toBe(true);
    expect(nomePdf).toBe('DDT 12.pdf');
    expect(firma.esito).toBe('valida');
    expect(firma.firmatari[0]).toMatchObject({
      nome: 'Mario Rossi',
      ente: 'Ente di Prova S.p.A.',
      tipo: 'firma digitale',
    });
    expect(firma.firmatari[0].data).toBe('2026-11-06T10:00:00+00:00');
  });

  it('busta rotta, contenuto non PDF e motore non installato danno un messaggio leggibile', async () => {
    await expect(apriDdtFirmato(Buffer.from('P7M-ROTTA'), 'x.pdf.p7m')).rejects.toThrow(
      /illeggibile/
    );
    await expect(apriDdtFirmato(Buffer.from('P7M:<xml/>'), 'fattura.xml.p7m')).rejects.toThrow(
      /non contiene un PDF/
    );
    installato = false;
    const e = await apriDdtFirmato(busta, 'x.pdf.p7m').catch((err) => err);
    expect(e).toBeInstanceOf(ErroreFirma);
    expect(e.codice).toBe('FIRMA_NON_INSTALLATA');
    expect(e.message).toMatch(/installa\.bat/);
  });

  it('riconosce la busta per nome e per contenuto; il filtro dei caricamenti ammette .p7m', () => {
    expect(eBustaFirmata(busta, 'senza-estensione')).toBe(true);
    expect(eBustaFirmata(PDF_DENTRO, 'ddt.pdf')).toBe(false);
    expect(fileAmmesso({ originalname: 'ddt.pdf.p7m', mimetype: 'application/octet-stream' })).toBe(
      true
    );
    expect(fileAmmesso({ originalname: 'ddt.p7m', mimetype: 'application/pkcs7-mime' })).toBe(true);
    expect(fileAmmesso({ originalname: 'ddt.p7m', mimetype: 'text/html' })).toBe(false);
    expect(fileAmmesso({ originalname: 'ddt.pdf', mimetype: 'application/pdf' })).toBe(true);
  });

  it('nomi in uscita ed elenco dei file del batch', () => {
    expect(safeOutputBase('DDT 12.pdf.p7m')).toBe('DDT 12');
    expect(safeOutputBase('DDT 12.pdf')).toBe('DDT 12');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-firma-elenco-'));
    for (const n of ['a.pdf', 'b.pdf.p7m', 'c.txt']) fs.writeFileSync(path.join(dir, n), 'x');
    expect(listPdfFiles(dir)).toEqual(['a.pdf', 'b.pdf.p7m']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('conversione singola con un DDT firmato', () => {
  const agent = request.agent(app);
  const username = `firma-${uuidv4().slice(0, 8)}`;

  beforeAll(async () => {
    createUser(uuidv4(), username, 'password-lunga-1', COMMESSA, 'Firma Test');
    const res = await agent.post('/auth/login').send({ username, password: 'password-lunga-1' });
    expect(res.status).toBe(200);
  });

  it('/prepare-claude apre la busta, dà esito e PDF estratto; /claude-to-excel archivia e manda a SkyTower', async () => {
    const res = await agent.post('/prepare-claude').attach('files', busta, {
      filename: 'DDT 7.pdf.p7m',
      contentType: 'application/octet-stream',
    });
    expect(res.status).toBe(200);
    expect(res.body.firma.esito).toBe('valida');
    expect(res.body.pdf_estratto).toBe(`/prepare-claude/${res.body.temp_id}/pdf`);

    // il PDF da allegare a Claude.ai è quello dentro la busta
    const pdf = await agent
      .get(res.body.pdf_estratto)
      .buffer(true)
      .parse((r, cb) => {
        const parti: Buffer[] = [];
        r.on('data', (c: Buffer) => parti.push(c));
        r.on('end', () => cb(null, Buffer.concat(parti)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).equals(PDF_DENTRO)).toBe(true);
    expect(pdf.headers['content-disposition']).toContain('DDT 7.pdf');
    // un'altra commessa (o un id inventato) non lo vede
    expect((await agent.get('/prepare-claude/0123456789abcdef0123456789abcdef/pdf')).status).toBe(
      404
    );

    // registro attività: chi ha caricato un DDT firmato e con che esito
    const ev = getRecentActivity(20).find(
      (e) => e.type === 'ddt_firmato' && e.username === username
    );
    expect(ev?.esito).toBe('valida');
    expect(ev?.dettaglio).toContain('DDT 7.pdf.p7m');

    const excel = await agent.post('/claude-to-excel').send({
      response: JSON.stringify({ sheets: [{ name: 'F', headers: ['A'], rows: [['1']] }] }),
      pdfFileName: 'DDT 7.pdf',
      temp_id: res.body.temp_id,
    });
    expect(excel.status).toBe(200);
    // l'archivio e l'invio a SkyTower sono scritti dopo la risposta: si aspetta un attimo
    for (let i = 0; i < 40 && inviaDdtASkyTower.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const invio = inviaDdtASkyTower.mock.calls[0][0] as Record<string, unknown>;
    expect(String(invio.pdfPath)).toMatch(/\.p7m$/);
    expect(fs.readFileSync(String(invio.pdfEstrattoPath)).equals(PDF_DENTRO)).toBe(true);
    const archiviato = JSON.parse(
      fs.readFileSync(path.join(commessaJsonFolder(COMMESSA), 'DDT 7.json'), 'utf8')
    );
    expect(archiviato.firmaDigitale.esito).toBe('valida');
  });

  it('busta rotta → 400 con il motivo; motore non installato → 400 con le istruzioni, mai 500', async () => {
    let res = await agent.post('/prepare-claude').attach('files', Buffer.from('P7M-ROTTA'), {
      filename: 'rotto.pdf.p7m',
      contentType: 'application/pkcs7-mime',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/illeggibile/);
    installato = false;
    res = await agent.post('/prepare-claude').attach('files', busta, {
      filename: 'DDT 8.pdf.p7m',
      contentType: 'application/octet-stream',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non è installato/);
  });
});

describe('conversione automatica con DDT firmati', () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-firma-batch-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(path.join(DATA_ROOT, COMMESSA), { recursive: true, force: true });
  });

  async function attendiFine(id: string): Promise<BatchJob> {
    for (let i = 0; i < 200; i++) {
      const job = readJob(COMMESSA, id);
      if (job && job.status !== 'in-attesa' && job.status !== 'in-corso') return job;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('job non concluso');
  }

  it('le buste si aprono prima del motore, l’esito resta nel job e una busta rotta fallisce da sola', async () => {
    const input = path.join(tmpDir, 'input');
    const output = path.join(tmpDir, 'output');
    fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'a.pdf'), PDF_DENTRO);
    fs.writeFileSync(path.join(input, 'b.pdf.p7m'), busta);
    fs.writeFileSync(path.join(input, 'c.pdf.p7m'), 'P7M-ROTTA');

    let visti: { inputDir: string; elaboratiDir?: string; files: string[] } | null = null;
    runOllama.mockImplementation(
      async (
        opts: { inputDir: string; elaboratiDir?: string; jsonDir: string },
        events: { onFile?: (o: unknown) => void }
      ) => {
        const files = fs.readdirSync(opts.inputDir).sort();
        visti = { inputDir: opts.inputDir, elaboratiDir: opts.elaboratiDir, files };
        fs.mkdirSync(opts.jsonDir, { recursive: true });
        const outcomes = files.map((f) => {
          // ciò che il motore legge è sempre un PDF, anche per le buste
          expect(fs.readFileSync(path.join(opts.inputDir, f)).subarray(0, 5).toString()).toBe(
            '%PDF-'
          );
          fs.writeFileSync(
            path.join(opts.jsonDir, `${safeOutputBase(f)}.json`),
            JSON.stringify({ sheets: [] })
          );
          const o = { pdfName: f, status: 'ok', outputName: `${safeOutputBase(f)}.xlsx` };
          events.onFile?.(o);
          return o;
        });
        return { outcomes, costs: [], totalUsd: 0, batchDiscount: false, canceled: false };
      }
    );

    const job = createJob({
      commessaId: COMMESSA,
      createdBy: 'tester',
      mode: 'server',
      promptId: 'ddt',
      model: 'claude-haiku-4-5',
      fallbackModel: 'claude-sonnet-5',
      useFallback: false,
      useBatchApi: false,
      force: false,
      pulisci: false,
      localOcr: false,
      ollama: true,
      mergeOutput: false,
      inputDir: input,
      outputDir: output,
    });
    const fine = await attendiFine(job.id);

    expect(visti!.inputDir).toMatch(/sbustati$/);
    expect(visti!.elaboratiDir).toBe(input);
    expect(visti!.files).toEqual(['a.pdf', 'b.pdf.p7m']);
    const b = fine.files.find((f) => f.pdfName === 'b.pdf.p7m')!;
    expect(b.status).toBe('ok');
    expect(b.firma?.esito).toBe('valida');
    const c = fine.files.find((f) => f.pdfName === 'c.pdf.p7m')!;
    expect(c.status).toBe('fallito');
    expect(c.reason).toMatch(/illeggibile/);
    expect(fine.files.find((f) => f.pdfName === 'a.pdf')!.firma).toBeUndefined();
    expect(fine.status).toBe('completato');
    expect(fine.log.join('\n')).toContain('b.pdf.p7m — Firma valida');

    // archivio: esito della firma nell'export (scritto in coda, dopo la fine del job: si aspetta il file);
    // SkyTower riceve la busta e il PDF di riserva
    const fileB = path.join(commessaJsonFolder(COMMESSA), 'b.json');
    for (let i = 0; i < 80 && !fs.existsSync(fileB); i++)
      await new Promise((r) => setTimeout(r, 25));
    const archiviato = JSON.parse(fs.readFileSync(fileB, 'utf8'));
    expect(archiviato.firmaDigitale.esito).toBe('valida');
    const invioB = inviaDdtASkyTower.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((o) => String(o.pdfPath).endsWith('b.pdf.p7m'))!;
    expect(String(invioB.pdfEstrattoPath)).toMatch(/sbustati[\\/]b\.pdf\.p7m$/);
  });

  it('senza buste nel lotto il motore legge la cartella di sempre', async () => {
    const input = path.join(tmpDir, 'solo-pdf');
    fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'x.pdf'), PDF_DENTRO);
    let letta = '';
    runOllama.mockImplementation(async (opts: { inputDir: string }) => {
      letta = opts.inputDir;
      return { outcomes: [], costs: [], totalUsd: 0, batchDiscount: false, canceled: false };
    });
    const job = createJob({
      commessaId: COMMESSA,
      createdBy: 'tester',
      mode: 'server',
      promptId: 'ddt',
      model: 'claude-haiku-4-5',
      fallbackModel: 'claude-sonnet-5',
      useFallback: false,
      useBatchApi: false,
      force: false,
      pulisci: false,
      localOcr: false,
      ollama: true,
      mergeOutput: false,
      inputDir: input,
      outputDir: path.join(tmpDir, 'out2'),
    });
    await attendiFine(job.id);
    expect(letta).toBe(input);
  });
});
