// "><(((º> sabusabu <º)))><"
// elaboratiSkyTower.test.ts — Conversione automatica con "sposta in _elaborati" attivo: il PDF che
// va a SkyTower deve essere quello vero, anche se a fine lavoro è già stato spostato.
//
// Il difetto (trovato col lavoro sui .p7m, 06/11/2026): i motori spostano i PDF convertiti in
// inputDir/_elaborati/AAAA-MM a lavoro finito (scritture.spostaPdfElaborati), e SOLO DOPO
// jobs.archiviaEsiti mandava a SkyTower inputDir/<nome> — un file che non c'era più. Risultato:
// "PDF originale non disponibile" nel log dell'app e nessun DDT della conversione automatica in
// SkyTower. Ora lo spostamento comunica dove è finito ogni file (EngineEvents.onSpostato →
// JobFile.elaborato) e l'invio usa quel percorso; con un omonimo già archiviato va il file nuovo
// (quello col suffisso), non quello vecchio.
//
// Motore Ollama finto che si comporta come i motori veri a fine lavoro (JSON in jsonDir, esiti,
// spostamento con spostaPdfElaborati); client della firma e SkyTower finti.
import fs from 'fs';
import os from 'os';
import path from 'path';

const PDF = (testo: string) => Buffer.from(`%PDF-1.4\n% ${testo}\n%%EOF\n`);

// Client della firma finto (come firma.test.ts): "P7M:" + PDF è una busta che si apre
jest.mock('../../../shared/firma/firma.js', () => ({
  eBustaFirmata: (b: Buffer, nome?: string) =>
    /\.p7m$/i.test(String(nome || '')) || b.subarray(0, 3).toString() === 'P7M',
  nomeSenzaP7m: (n: string) => String(n).replace(/(\.p7m)+$/i, ''),
  apri: async (b: Buffer, n: string) => ({
    contenuto: b.subarray(4),
    nomeContenuto: String(n).replace(/(\.p7m)+$/i, ''),
    rapporto: { firmato: true, esito: 'valida', riepilogo: 'Firma valida', livelli: 1, firme: [] },
  }),
}));

// SkyTower finta: per ogni invio si annota se il file indicato esisteva e cosa conteneva
// NEL MOMENTO della chiamata (l'invio vero legge il file subito, prima di qualunque attesa).
interface Visto {
  pdfPath: string;
  esiste: boolean;
  contenuto: string;
  pdfEstrattoPath?: string;
}
const visti: Visto[] = [];
jest.mock('../services/skytower', () => ({
  ...jest.requireActual('../services/skytower'),
  inviaDdtASkyTower: async (o: { pdfPath: string; pdfEstrattoPath?: string }) => {
    const esiste = fs.existsSync(o.pdfPath);
    visti.push({
      pdfPath: o.pdfPath,
      esiste,
      contenuto: esiste ? fs.readFileSync(o.pdfPath, 'latin1') : '',
      pdfEstrattoPath: o.pdfEstrattoPath,
    });
    return esiste;
  },
}));

// Motore finto: converte ogni file della cartella che gli si passa e, se richiesto, sposta gli
// originali come fanno runBatch/resumeBatch/runLocalFir/runOllama a fine lavoro.
const runOllama = jest.fn();
jest.mock('../batch/ollama', () => ({
  ...jest.requireActual('../batch/ollama'),
  runOllama: (...a: unknown[]) => runOllama(...a),
}));

import { createJob, readJob, type BatchJob } from '../batch/jobs';
import { CARTELLA_ELABORATI, safeOutputBase, spostaPdfElaborati } from '../batch/scritture';
import type { EngineEvents, FileOutcome } from '../batch/tipi';
import { DATA_ROOT } from '../routes/helpers';

const COMMESSA = '__test_elaborati__';
const mese = () => new Date().toISOString().slice(0, 7);
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-elaborati-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(path.join(DATA_ROOT, COMMESSA), { recursive: true, force: true });
});
beforeEach(() => {
  visti.length = 0;
  runOllama.mockImplementation(
    async (
      opts: { inputDir: string; elaboratiDir?: string; jsonDir: string; spostaElaborati?: boolean },
      events: EngineEvents
    ) => {
      fs.mkdirSync(opts.jsonDir, { recursive: true });
      const outcomes: FileOutcome[] = fs
        .readdirSync(opts.inputDir)
        .filter((f) => fs.statSync(path.join(opts.inputDir, f)).isFile())
        .map((f) => {
          fs.writeFileSync(
            path.join(opts.jsonDir, `${safeOutputBase(f)}.json`),
            JSON.stringify({ sheets: [] })
          );
          const o: FileOutcome = {
            pdfName: f,
            status: 'ok',
            outputName: `${safeOutputBase(f)}.xlsx`,
          };
          events.onFile?.(o);
          return o;
        });
      const spostati = opts.spostaElaborati
        ? spostaPdfElaborati(
            opts.elaboratiDir ?? opts.inputDir,
            outcomes,
            events.onLog,
            events.onSpostato
          )
        : 0;
      return { outcomes, spostati, costs: [], totalUsd: 0, batchDiscount: false, canceled: false };
    }
  );
});

async function attendiFine(id: string): Promise<BatchJob> {
  for (let i = 0; i < 200; i++) {
    const job = readJob(COMMESSA, id);
    if (job && job.status !== 'in-attesa' && job.status !== 'in-corso') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('job non concluso');
}

function lavoro(input: string, nome: string, spostaElaborati = true) {
  return createJob({
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
    spostaElaborati,
    inputDir: input,
    outputDir: path.join(tmpDir, `out-${nome}`),
  });
}

describe('spostaPdfElaborati comunica dove finisce ogni file', () => {
  it('percorso nuovo per ogni file spostato, col suffisso se c’era già un omonimo', () => {
    const dir = path.join(tmpDir, 'unita');
    const dest = path.join(dir, CARTELLA_ELABORATI, mese());
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'DDT.pdf'), 'vecchio');
    fs.writeFileSync(path.join(dir, 'DDT.pdf'), 'nuovo');
    fs.writeFileSync(path.join(dir, 'altro.pdf.p7m'), 'busta');

    const dove: Record<string, string> = {};
    const n = spostaPdfElaborati(
      dir,
      [
        { pdfName: 'DDT.pdf', status: 'ok' },
        { pdfName: 'altro.pdf.p7m', status: 'ok' },
      ],
      undefined,
      (nome, percorso) => {
        dove[nome] = percorso;
      }
    );

    expect(n).toBe(2);
    expect(fs.readFileSync(dove['DDT.pdf'], 'utf8')).toBe('nuovo');
    expect(path.basename(dove['DDT.pdf'])).toMatch(/^DDT_[0-9a-z]+\.pdf$/);
    expect(dove['altro.pdf.p7m']).toBe(path.join(dest, 'altro.pdf.p7m'));
  });
});

describe('conversione automatica con lo spostamento in _elaborati', () => {
  it('a SkyTower va il file già spostato (PDF e busta .p7m originale), non un percorso sparito', async () => {
    const input = path.join(tmpDir, 'input1');
    fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'a.pdf'), PDF('a'));
    fs.writeFileSync(path.join(input, 'b.pdf.p7m'), Buffer.concat([Buffer.from('P7M:'), PDF('b')]));

    const fine = await attendiFine(lavoro(input, '1').id);

    expect(fine.status).toBe('completato');
    expect(fine.spostati).toBe(2);
    expect(fs.existsSync(path.join(input, 'a.pdf'))).toBe(false);
    expect(visti).toHaveLength(2);
    for (const v of visti) {
      expect(v.esiste).toBe(true);
      expect(v.pdfPath.startsWith(path.join(input, CARTELLA_ELABORATI, mese()))).toBe(true);
    }
    const b = visti.find((v) => v.pdfPath.endsWith('b.pdf.p7m'))!;
    // busta originale, non il PDF estratto; il PDF estratto resta come riserva in sbustati/
    expect(b.contenuto.startsWith('P7M:%PDF-')).toBe(true);
    expect(String(b.pdfEstrattoPath)).toMatch(/sbustati[\\/]b\.pdf\.p7m$/);
    // dove è finito l'originale resta scritto nel job (sopravvive a un riavvio)
    expect(fine.files.find((f) => f.pdfName === 'a.pdf')!.elaborato).toBe(
      path.join(CARTELLA_ELABORATI, mese(), 'a.pdf')
    );
  });

  it('con un omonimo già archiviato il mese prima va a SkyTower il DDT nuovo', async () => {
    const input = path.join(tmpDir, 'input2');
    const dest = path.join(input, CARTELLA_ELABORATI, mese());
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'DDT.pdf'), PDF('vecchio'));
    fs.writeFileSync(path.join(input, 'DDT.pdf'), PDF('nuovo'));

    await attendiFine(lavoro(input, '2').id);

    expect(visti).toHaveLength(1);
    expect(visti[0].esiste).toBe(true);
    expect(visti[0].contenuto).toContain('% nuovo');
  });

  it('senza spostamento il percorso resta quello della cartella di input', async () => {
    const input = path.join(tmpDir, 'input3');
    fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'c.pdf'), PDF('c'));

    await attendiFine(lavoro(input, '3', false).id);

    expect(visti).toEqual([
      expect.objectContaining({ pdfPath: path.join(input, 'c.pdf'), esiste: true }),
    ]);
  });

  it('originale sparito prima dell’invio: lo dice il diario del lavoro, non solo il log dell’app', async () => {
    const input = path.join(tmpDir, 'input4');
    fs.mkdirSync(input, { recursive: true });
    fs.writeFileSync(path.join(input, 'd.pdf'), PDF('d'));
    // motore che "perde" il file (es. qualcuno lo sposta a mano mentre il lavoro gira)
    runOllama.mockImplementationOnce(
      async (opts: { inputDir: string; jsonDir: string }, events: EngineEvents) => {
        fs.mkdirSync(opts.jsonDir, { recursive: true });
        fs.writeFileSync(path.join(opts.jsonDir, 'd.json'), JSON.stringify({ sheets: [] }));
        const o: FileOutcome = { pdfName: 'd.pdf', status: 'ok', outputName: 'd.xlsx' };
        events.onFile?.(o);
        fs.unlinkSync(path.join(opts.inputDir, 'd.pdf'));
        return { outcomes: [o], costs: [], totalUsd: 0, batchDiscount: false, canceled: false };
      }
    );

    const fine = await attendiFine(lavoro(input, '4').id);

    expect(fine.log.join('\n')).toMatch(
      /d\.pdf — PDF originale non trovato: non inviato a SkyTower/
    );
    expect(visti).toHaveLength(0);
  });
});
