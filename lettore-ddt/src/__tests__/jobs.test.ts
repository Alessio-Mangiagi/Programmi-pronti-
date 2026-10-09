// jobs.test.ts — Gestione dei lavori di conversione: persistenza, elenco,
// pulizia e gli esiti che si decidono PRIMA di spendere un token (conflitti di
// nomi, cartelle illeggibili, nessun PDF da fare).
//
// Nessun test tocca l'API: i job usati qui hanno cartelle di input vuote o
// invalide, quindi il motore si ferma prima di creare qualunque batch.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  JOB_ID_RE,
  cancelJob,
  createJob,
  jobsRoot,
  listJobs,
  newJobId,
  pruneJobs,
  readJob,
  spoolDirs,
  type BatchJob,
} from '../batch/jobs';
import { BASE_DIR } from '../routes/helpers';

const COMMESSA = '__test_jobs__';

let tmpDir: string;
const tmp = (...p: string[]) => path.join(tmpDir, ...p);

// Job appena creato → attende che startJob lo porti a uno stato definitivo.
async function attendiFine(id: string, timeoutMs = 5000): Promise<BatchJob> {
  const scadenza = Date.now() + timeoutMs;
  for (;;) {
    const job = readJob(COMMESSA, id);
    if (job && job.status !== 'in-attesa' && job.status !== 'in-corso') return job;
    if (Date.now() > scadenza) throw new Error(`job ${id} non concluso entro ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function nuovoJob(inputDir: string, outputDir: string) {
  return createJob({
    commessaId: COMMESSA,
    createdBy: 'tester',
    mode: 'server',
    promptId: 'ddt',
    model: 'claude-haiku-4-5',
    fallbackModel: 'claude-sonnet-5',
    useFallback: false,
    useBatchApi: true,
    force: false,
    pulisci: false,
    localOcr: false,
    mergeOutput: false,
    inputDir,
    outputDir,
  });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(path.join(BASE_DIR, 'data', COMMESSA), { recursive: true, force: true });
});

// ── Identificatori e cartelle ───────────────────────────────────────────────
describe('id e cartelle dei job', () => {
  it('newJobId produce un id che supera la validazione', () => {
    expect(JOB_ID_RE.test(newJobId())).toBe(true);
  });

  it('un id non valido non viene nemmeno cercato su disco', () => {
    // La regex è anche la difesa dal path traversal via /batch/jobs/:id
    expect(readJob(COMMESSA, '../../users.enc')).toBeNull();
    expect(readJob(COMMESSA, 'non-un-uuid')).toBeNull();
  });

  it('le cartelle di appoggio stanno dentro quelle della commessa', () => {
    const id = newJobId();
    const { input, output } = spoolDirs(COMMESSA, id);
    expect(input.startsWith(jobsRoot(COMMESSA))).toBe(true);
    expect(output.startsWith(jobsRoot(COMMESSA))).toBe(true);
  });
});

// ── Esiti decisi prima di spendere ──────────────────────────────────────────
describe('createJob', () => {
  it('cartella di input vuota → niente da elaborare, job comunque persistito', async () => {
    const inputDir = tmp('vuota-in');
    const outputDir = tmp('vuota-out');
    fs.mkdirSync(inputDir, { recursive: true });

    const job = nuovoJob(inputDir, outputDir);
    expect(job.files).toEqual([]);
    expect(job.progress.total).toBe(0);
    expect(readJob(COMMESSA, job.id)).not.toBeNull(); // persistito subito

    // Senza chiave API il lavoro si ferma subito con un messaggio chiaro; con
    // una chiave configurata il motore non ha nulla da mandare e chiude. In
    // nessuno dei due casi parte una richiesta.
    const finito = await attendiFine(job.id);
    expect(['completato', 'errore']).toContain(finito.status);
    if (finito.status === 'errore') expect(finito.error).toMatch(/API key mancante/);
  });

  it('due PDF che produrrebbero lo stesso Excel → errore, non sovrascrittura', () => {
    const inputDir = tmp('conflitto-in');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, 'bolla 7.pdf'), 'x');
    fs.writeFileSync(path.join(inputDir, 'bolla 7 .pdf'), 'x');

    const job = nuovoJob(inputDir, tmp('conflitto-out'));
    expect(job.status).toBe('errore');
    expect(job.error).toMatch(/Conflitto di nomi/);
    expect(job.finishedAt).toBeTruthy();
  });

  it('cartella di input inesistente → errore leggibile', () => {
    const job = nuovoJob(tmp('mai-creata'), tmp('mai-creata-out'));
    expect(job.status).toBe('errore');
    expect(job.error).toMatch(/non leggibile/);
  });

  it('i PDF già convertiti risultano saltati, non rifatti', async () => {
    const inputDir = tmp('gia-fatti-in');
    const outputDir = tmp('gia-fatti-out');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, 'DDT 9.pdf'), 'x');
    fs.writeFileSync(path.join(outputDir, 'DDT 9.xlsx'), 'gia-fatto');

    const job = nuovoJob(inputDir, outputDir);
    expect(job.files).toEqual([
      { pdfName: 'DDT 9.pdf', status: 'saltato', reason: 'Excel già presente in output' },
    ]);
    await attendiFine(job.id);
  });
});

// ── Elenco e pulizia ────────────────────────────────────────────────────────
describe('listJobs e pruneJobs', () => {
  it('elenca i job dal più recente', async () => {
    const dir = tmp('lista-in');
    fs.mkdirSync(dir, { recursive: true });
    const primo = nuovoJob(dir, tmp('lista-out-1'));
    await attendiFine(primo.id);
    const secondo = nuovoJob(dir, tmp('lista-out-2'));
    await attendiFine(secondo.id);

    const ids = listJobs(COMMESSA).map((j) => j.id);
    expect(ids).toContain(primo.id);
    expect(ids).toContain(secondo.id);
    expect(ids.indexOf(secondo.id)).toBeLessThanOrEqual(ids.indexOf(primo.id));
  });

  it('butta i job conclusi da troppo tempo e tiene gli altri', async () => {
    const dir = tmp('prune-in');
    fs.mkdirSync(dir, { recursive: true });
    const vecchio = nuovoJob(dir, tmp('prune-out-1'));
    await attendiFine(vecchio.id);
    const recente = nuovoJob(dir, tmp('prune-out-2'));
    await attendiFine(recente.id);

    // Invecchia il primo di 30 giorni (il TTL è 7)
    const file = path.join(jobsRoot(COMMESSA), vecchio.id, 'job.json');
    const job = JSON.parse(fs.readFileSync(file, 'utf8')) as BatchJob;
    job.finishedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(job, null, 2), 'utf8');

    pruneJobs(COMMESSA);
    expect(readJob(COMMESSA, vecchio.id)).toBeNull();
    expect(readJob(COMMESSA, recente.id)).not.toBeNull();
  });

  it('i caricamenti mai diventati lavoro spariscono prima', () => {
    // Cartella con dentro i PDF ma senza job.json: l'utente ha caricato e poi
    // ha chiuso la pagina.
    const orfano = newJobId();
    const dir = path.join(jobsRoot(COMMESSA), orfano);
    fs.mkdirSync(path.join(dir, 'input'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'input', 'a.pdf'), 'x');
    const vecchia = new Date(Date.now() - 12 * 60 * 60 * 1000); // TTL orfani: 6h
    fs.utimesSync(dir, vecchia, vecchia);

    pruneJobs(COMMESSA);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

// ── Annullamento ────────────────────────────────────────────────────────────
describe('cancelJob', () => {
  it('un job non in esecuzione non si annulla', () => {
    expect(cancelJob(COMMESSA, newJobId())).toBe(false);
  });
});
