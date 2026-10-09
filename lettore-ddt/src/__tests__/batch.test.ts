// batch.test.ts — Motore di conversione (pianificazione, validazione, stato),
// scrittore ZIP e route della pagina "Conversione automatica".
// Nessuna chiamata all'API Claude: i test coprono tutto ciò che sta intorno.

import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';
import app from '../app';
import { createUser, deleteUser } from '../models/users';
import {
  PendingState,
  clearState,
  formatCosts,
  loadState,
  parseClaudeJson,
  planFiles,
  safeOutputBase,
  validateMessage,
} from '../batch/engine';
import { createZip, crc32 } from '../batch/zip';
import { statoPulizia, trovaPython } from '../batch/pulisci';
import { ddtIndexOfFolder, extractDdtNumbers, extractM3ByDate } from '../services/ddtArchive';
import { BASE_DIR } from '../routes/helpers';
import { dentroRadiciConsentite } from '../routes/batchAccesso';
import { accorpa, statoOllama } from '../batch/ollama';

const TEST_USERNAME = `batch-user-${uuidv4()}`;
const TEST_PASSWORD = 'batch-password-123';
const TEST_COMMESSA = '__test_batch__';

let tmpDir: string;
const tmp = (...p: string[]) => path.join(tmpDir, ...p);
const writePdf = (dir: string, name: string, bytes = 100) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(bytes, 1));
};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── engine: nomi di output ──────────────────────────────────────────────────
describe('safeOutputBase', () => {
  it('toglie estensione e caratteri illegali per Windows', () => {
    expect(safeOutputBase('DDT 2026-05.pdf')).toBe('DDT 2026-05');
    // "><(((º> sabusabu <º)))><"
    expect(safeOutputBase('bolla|n*3?.pdf')).toBe('bolla_n_3_');
  });

  it('ignora il percorso: un nome ostile non esce dalla cartella di output', () => {
    expect(safeOutputBase('../../../etc/passwd.pdf')).toBe('passwd');
  });

  it('nome vuoto dopo la pulizia → fallback deterministico', () => {
    const a = safeOutputBase('///.pdf');
    expect(a).toMatch(/^documento_[0-9a-f]{10}$/);
    expect(safeOutputBase('///.pdf')).toBe(a); // stesso input, stesso output
  });
});

// ── engine: estrazione del JSON dalla risposta ──────────────────────────────
describe('parseClaudeJson', () => {
  it('legge il JSON nudo', () => {
    expect(parseClaudeJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('toglie i code fence markdown', () => {
    expect(parseClaudeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('isola il JSON in mezzo al testo', () => {
    expect(parseClaudeJson('Ecco il risultato: {"a":1} — fine')).toEqual({ a: 1 });
  });

  it('non tocca i backtick dentro le stringhe', () => {
    expect(parseClaudeJson('{"a":"```"}')).toEqual({ a: '```' });
  });

  it('JSON rotto → eccezione', () => {
    expect(() => parseClaudeJson('non sono json')).toThrow();
  });
});

// ── engine: validazione della risposta ──────────────────────────────────────
// text SENZA la "{" iniziale: con un modello senza thinking (qui claude-haiku-4-5)
// la richiesta prefilla il turno assistant con "{" (vedi buildRequestParams),
// quindi l'API restituisce solo il resto — validateMessage se lo rimette da sé.
const msg = (over: Record<string, unknown> = {}) =>
  ({
    stop_reason: 'end_turn',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: '"sheets":[{"rows":[["x"]]}]}' }],
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('validateMessage', () => {
  it('estrazione buona → ok', () => {
    const r = validateMessage(msg(), false);
    expect(r.ok).toBe(true);
    expect(r.parsed).toEqual({ sheets: [{ rows: [['x']] }] });
  });

  it('risposta troncata → da rielaborare', () => {
    expect(validateMessage(msg({ stop_reason: 'max_tokens' }), false)).toMatchObject({ ok: false });
  });

  it('rifiuto del modello → da rielaborare', () => {
    expect(validateMessage(msg({ stop_reason: 'refusal' }), false)).toMatchObject({ ok: false });
  });

  it('nessuna riga → da rielaborare col modello superiore', () => {
    const empty = msg({ content: [{ type: 'text', text: '"sheets":[{"rows":[]}]}' }] });
    expect(validateMessage(empty, false).ok).toBe(false);
  });

  it('nessuna riga ma allowEmpty (fase fallback) → accettato con avviso', () => {
    const empty = msg({ content: [{ type: 'text', text: '"sheets":[{"rows":[]}]}' }] });
    const r = validateMessage(empty, true);
    expect(r.ok).toBe(true);
    expect(r.warning).toBeDefined();
  });

  it('JSON senza fogli → da rielaborare', () => {
    expect(validateMessage(msg({ content: [{ type: 'text', text: '"a":1}' }] }), true).ok).toBe(
      false
    );
  });

  it('modello con thinking esteso → nessun prefill, il testo è già JSON completo', () => {
    const r = validateMessage(
      msg({
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: '{"sheets":[{"rows":[["x"]]}]}' }],
      }),
      false
    );
    expect(r.ok).toBe(true);
    expect(r.parsed).toEqual({ sheets: [{ rows: [['x']] }] });
  });
});

// ── engine: quali file elaborare ────────────────────────────────────────────
describe('planFiles', () => {
  it('salta i PDF che hanno già un Excel, salvo force', () => {
    const inputDir = tmp('plan-in');
    const outputDir = tmp('plan-out');
    writePdf(inputDir, 'a.pdf');
    writePdf(inputDir, 'b.pdf');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'a.xlsx'), 'gia-fatto');

    const plan = planFiles({ inputDir, outputDir, force: false });
    expect(plan.files).toEqual(['b.pdf']);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({ pdfName: 'a.pdf', status: 'skipped' });

    expect(planFiles({ inputDir, outputDir, force: true }).files).toEqual(['a.pdf', 'b.pdf']);
  });

  it("salta i PDF oltre il limite dell'API invece di pagarne il rifiuto", () => {
    const inputDir = tmp('plan-big-in');
    const outputDir = tmp('plan-big-out');
    writePdf(inputDir, 'enorme.pdf', 23 * 1024 * 1024);
    const plan = planFiles({ inputDir, outputDir, force: false });
    expect(plan.files).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/supera il limite/);
  });

  it('due PDF che produrrebbero lo stesso Excel → conflitto, non sovrascrittura', () => {
    const inputDir = tmp('plan-conf-in');
    const outputDir = tmp('plan-conf-out');
    // Nomi diversi che collidono dopo il trim: sovrascriversi a vicenda in
    // silenzio sarebbe peggio che fermarsi.
    writePdf(inputDir, 'bolla 12.pdf');
    writePdf(inputDir, 'bolla 12 .pdf');
    const plan = planFiles({ inputDir, outputDir, force: false });
    expect(plan.conflict).toMatch(/bolla 12\.xlsx/);
    expect(plan.files).toEqual([]);
  });

  it("onlyFiles limita l'elaborazione a quelli indicati", () => {
    const inputDir = tmp('plan-only-in');
    const outputDir = tmp('plan-only-out');
    writePdf(inputDir, 'a.pdf');
    writePdf(inputDir, 'b.pdf');
    expect(planFiles({ inputDir, outputDir, force: false, onlyFiles: ['b.pdf'] }).files).toEqual([
      'b.pdf',
    ]);
  });
});

// ── engine: stato dei batch già pagati ──────────────────────────────────────
describe('stato dei batch in corso', () => {
  const state: PendingState = {
    stage: 'primary',
    model: 'claude-haiku-4-5',
    fallbackModel: 'claude-sonnet-5',
    noFallback: false,
    promptId: 'ddt',
    inputDir: 'C:\\in',
    outputDir: 'C:\\out',
    jsonDir: 'C:\\out\\json',
    batches: [{ id: 'batch_1', files: { 'pdf-0-0': 'a.pdf' } }],
  };

  it('nessuno stato → null', () => {
    expect(loadState(tmp('mai-scritto.json'))).toBeNull();
  });

  it('stato illeggibile → eccezione, mai un silenzioso "riparto da zero"', () => {
    // Ignorarlo significherebbe reinviare batch già pagati: deve fermare tutto.
    const p = tmp('rotto.json');
    fs.writeFileSync(p, '{ tronc');
    expect(() => loadState(p)).toThrow(/illeggibile/);

    fs.writeFileSync(p, '{"stage":"primary"}'); // struttura valida come JSON, non come stato
    expect(() => loadState(p)).toThrow(/illeggibile/);
  });

  it('scrive, rilegge e cancella', () => {
    const p = tmp('stato.json');
    fs.writeFileSync(p, JSON.stringify(state));
    expect(loadState(p)).toEqual(state);
    clearState(p);
    expect(fs.existsSync(p)).toBe(false);
    expect(() => clearState(p)).not.toThrow(); // già cancellato
  });
});

// ── engine: riepilogo costi ─────────────────────────────────────────────────
describe('formatCosts', () => {
  it('mostra lo sconto batch e il totale', () => {
    const out = formatCosts(
      [{ model: 'claude-haiku-4-5', inputTokens: 1e6, outputTokens: 0, usd: 0.5 }],
      0.5,
      true
    );
    expect(out).toMatch(/\$0\.5000/);
    expect(out).toMatch(/-50% Batch API/);
  });

  it('modello senza prezzo → totale non stimabile invece di un numero sbagliato', () => {
    const out = formatCosts(
      [{ model: 'modello-ignoto', inputTokens: 10, outputTokens: 2, usd: null }],
      null,
      false
    );
    expect(out).toMatch(/non stimabile/);
  });

  it('nessun consumo → nessun riepilogo', () => {
    expect(formatCosts([], 0, true)).toBe('');
  });
});

// ── zip ─────────────────────────────────────────────────────────────────────
describe('createZip', () => {
  it('produce un archivio con la firma ZIP e i nomi dei file', () => {
    const zip = createZip([
      { name: 'a.xlsx', data: Buffer.from('contenuto a') },
      { name: 'città.xlsx', data: Buffer.from('contenuto b') },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header
    expect(zip.includes(Buffer.from('a.xlsx'))).toBe(true);
    expect(zip.includes(Buffer.from('città.xlsx', 'utf8'))).toBe(true); // nomi UTF-8
    // End of central directory: conta i file dichiarati.
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
  });

  it('archivio vuoto = solo record di chiusura', () => {
    expect(createZip([])).toHaveLength(22);
  });

  it('crc32 su vettore noto', () => {
    // Valore standard per "123456789".
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

// ── archivio DDT: estrazione e rilevamento duplicati ────────────────────────
// È la logica che protegge dalla doppia contabilizzazione quando il batch
// archivia gli stessi export del flusso manuale.
describe('archivio DDT', () => {
  const exportConDdt = (nums: string[], m3?: Record<string, number>) => ({
    sheets: [
      {
        name: 'F1-Dettaglio DDT',
        headers: ['Fornitore', 'N°DDT', 'Data', 'Targa', 'm³'],
        rows: nums.map((n) => ['Calce SPA', n, '17/07/2026', 'AB123CD', String(m3?.[n] ?? 7)]),
      },
    ],
  });

  it('estrae i numeri DDT dal foglio F1, scartando le righe di totale', () => {
    const parsed = exportConDdt(['12345', '12346']);
    parsed.sheets[0].rows.push(['', 'TOTALE', '', '', '14']);
    expect(extractDdtNumbers(parsed)).toEqual(['12345', '12346']);
  });

  it('export senza foglio DDT → nessun numero', () => {
    expect(
      extractDdtNumbers({ sheets: [{ name: 'Altro', headers: ['x'], rows: [['y']] }] })
    ).toEqual([]);
    expect(extractDdtNumbers({})).toEqual([]);
  });

  it('somma i m³ per data (formato italiano)', () => {
    const parsed = {
      sheets: [
        {
          name: 'F1',
          headers: ['N°DDT', 'Data', 'm³'],
          rows: [
            ['1', '17/07/2026', '7,5'],
            ['2', '17/07/2026', '1.000,5'],
            ['TOTALE', '17/07/2026', '999'], // riga di totale: N°DDT = TOTALE → esclusa
          ],
        },
      ],
    };
    expect(extractM3ByDate(parsed)).toEqual([{ date: '17/07/2026', m3: 1008 }]);
  });

  it('ddtIndexOfFolder mappa DDT → export e rileva i duplicati', () => {
    const folder = tmp('archivio');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'vecchio.json'), JSON.stringify(exportConDdt(['12345'])));
    fs.writeFileSync(path.join(folder, 'nuovo.json'), JSON.stringify(exportConDdt(['99999'])));

    const indice = ddtIndexOfFolder(folder);
    expect(indice.get('12345')).toBe('vecchio.json');
    expect(indice.get('99999')).toBe('nuovo.json');

    // Un nuovo export col DDT 12345 collide con "vecchio.json"…
    const daArchiviare = extractDdtNumbers(exportConDdt(['12345', '77777']));
    const collisioni = daArchiviare.filter((n) =>
      ddtIndexOfFolder(folder, new Set(['reg.json'])).has(n)
    );
    expect(collisioni).toEqual(['12345']); // 77777 è nuovo, 12345 è già contabilizzato
  });

  it("esclude dall'indice i file appena scritti (non contano come duplicati di sé stessi)", () => {
    const folder = tmp('archivio-excl');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'a.json'), JSON.stringify(exportConDdt(['555'])));
    expect(ddtIndexOfFolder(folder).get('555')).toBe('a.json');
    expect(ddtIndexOfFolder(folder, new Set(['a.json'])).has('555')).toBe(false);
  });

  it('file corrotto nella cartella → ignorato, non fa crashare', () => {
    const folder = tmp('archivio-corrotto');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'buono.json'), JSON.stringify(exportConDdt(['1'])));
    fs.writeFileSync(path.join(folder, 'rotto.json'), '{ tronc');
    const indice = ddtIndexOfFolder(folder);
    expect(indice.get('1')).toBe('buono.json');
    expect(indice.size).toBe(1);
  });
});

// ── pulizia pagine: individuazione dell'ambiente Python ─────────────────────
describe('pulizia pagine (lato Node)', () => {
  const before = process.env.PULISCI_PYTHON;
  afterEach(() => {
    if (before === undefined) delete process.env.PULISCI_PYTHON;
    else process.env.PULISCI_PYTHON = before;
  });

  it('PULISCI_PYTHON che punta al nulla → non disponibile, con spiegazione', () => {
    process.env.PULISCI_PYTHON = path.join(tmpDir, 'python-inesistente.exe');
    const stato = statoPulizia();
    expect(stato.disponibile).toBe(false);
    expect(stato.motivo).toMatch(/PaddleOCR/);
  });

  it('PULISCI_PYTHON valido → disponibile', () => {
    // un file qualsiasi: qui si verifica solo che l'override venga rispettato,
    // non che dentro ci sia davvero PaddleOCR
    const finto = path.join(tmpDir, 'finto-python.exe');
    fs.writeFileSync(finto, '');
    process.env.PULISCI_PYTHON = finto;
    expect(statoPulizia()).toMatchObject({ disponibile: true, python: finto });
  });

  it('senza override cerca il venv del progetto OCR', () => {
    delete process.env.PULISCI_PYTHON;
    const python = trovaPython();
    // In questo checkout il progetto OCR c'è; altrove null è la risposta giusta.
    if (python !== null) expect(python).toMatch(/ocr-documenti/);
  });
});

// ── route ───────────────────────────────────────────────────────────────────
describe('Route /batch', () => {
  const agent = request.agent(app);
  const keyBefore = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    // Chiave finta: la route la controlla prima di tutto e senza risponderebbe
    // sempre "API key mancante". Nessun test qui arriva a chiamare l'API — si
    // fermano tutti sulla validazione, prima che parta un job.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-finta-per-i-test';
    // Admin: la pagina batch è riservata agli amministratori (soloAdmin, che
    // dalla 2.4 è il default). Il caso dell'utente normale ha un test suo.
    createUser(uuidv4(), TEST_USERNAME, TEST_PASSWORD, TEST_COMMESSA, 'Batch User', true);
    const res = await agent
      .post('/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  afterAll(() => {
    if (keyBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = keyBefore;
    // Gli upload di prova finiscono in data/<commessa>/: senza questa pulizia
    // ogni esecuzione dei test lascia PDF e cartelle di lavoro sul disco.
    try {
      fs.rmSync(path.join(BASE_DIR, 'data', TEST_COMMESSA), { recursive: true, force: true });
    } catch {
      /* niente da pulire */
    }
    try {
      deleteUser(TEST_USERNAME);
    } catch {
      /* già rimosso */
    }
  });

  it('senza API key → 400 con la spiegazione, prima di qualsiasi spesa', async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await agent.post('/batch/jobs').send({ mode: 'server', promptId: 'ddt' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no-api-key');
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });

  // ── Motore Ollama ─────────────────────────────────────────────────────────
  it('Ollama e OCR locale insieme → 400: si sceglie un motore solo', async () => {
    const res = await agent
      .post('/batch/jobs')
      .send({ mode: 'server', promptId: 'registro-fir', ollama: true, localOcr: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un solo motore/i);
  });

  it('Ollama con la pulizia pagine → 400: non ha senso, non si paga nulla', async () => {
    const res = await agent
      .post('/batch/jobs')
      .send({ mode: 'server', promptId: 'ddt', ollama: true, pulisci: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pulizia pagine/i);
  });

  it('utente non amministratore → pagina batch chiusa', async () => {
    const username = `batch-nonadmin-${uuidv4()}`;
    const utente = createUser(uuidv4(), username, TEST_PASSWORD, TEST_COMMESSA, 'Utente semplice');
    try {
      const nonAdmin = request.agent(app);
      expect(
        (await nonAdmin.post('/auth/login').send({ username, password: TEST_PASSWORD })).status
      ).toBe(200);

      // /batch/config resta leggibile: serve alla pagina per spiegare il blocco.
      const cfg = await nonAdmin.get('/batch/config');
      expect(cfg.status).toBe(200);
      expect(cfg.body.puoiUsare).toBe(false);

      const jobs = await nonAdmin.get('/batch/jobs');
      expect(jobs.status).toBe(403);
      expect(jobs.body.code).toBe('solo-admin');
    } finally {
      deleteUser(utente.id);
    }
  });

  it('senza login → 401 su tutte le route', async () => {
    for (const url of ['/batch/config', '/batch/browse', '/batch/jobs']) {
      expect((await request(app).get(url)).status).toBe(401);
    }
    expect((await request(app).post('/batch/jobs').send({})).status).toBe(401);
  });

  it('GET /batch/config → prompt, modelli e stato della chiave', async () => {
    const res = await agent.get('/batch/config');
    expect(res.status).toBe(200);
    expect(res.body.prompts.map((p: { id: string }) => p.id)).toContain('ddt');
    expect(res.body.models).toContain('claude-haiku-4-5');
    expect(typeof res.body.hasApiKey).toBe('boolean');
    expect(res.body.maxPdfBytes).toBe(22 * 1024 * 1024);
  });

  it('GET /batch/config espone puoiUsare (true per un amministratore)', async () => {
    const res = await agent.get('/batch/config');
    expect(res.status).toBe(200);
    // soloAdmin è il default: la pagina si apre agli amministratori.
    expect(res.body.puoiUsare).toBe(true);
  });

  it('GET /batch/config dice se il motore Ollama è utilizzabile', async () => {
    const res = await agent.get('/batch/config');
    expect(res.status).toBe(200);
    expect(typeof res.body.ollama.disponibile).toBe('boolean');
    expect(res.body.ollama.modello).toBeTruthy();
    // Ollama assente sulla macchina: la pagina deve poter spiegare perché.
    if (!res.body.ollama.disponibile) expect(res.body.ollama.motivo).toBeTruthy();
  });

  it('GET /batch/config dice se la pulizia pagine è utilizzabile', async () => {
    const res = await agent.get('/batch/config');
    expect(res.status).toBe(200);
    expect(typeof res.body.pulizia.disponibile).toBe('boolean');
    // Se non c'è, il motivo va detto: la pagina ci spegne sopra il bottone.
    if (!res.body.pulizia.disponibile) expect(res.body.pulizia.motivo).toBeTruthy();
  });

  it('POST /batch/jobs con pulisci ma senza ambiente OCR → 400 subito', async () => {
    // Meglio fermarsi qui che dopo aver caricato 200 PDF.
    const prima = process.env.PULISCI_PYTHON;
    process.env.PULISCI_PYTHON = path.join(tmpDir, 'python-che-non-esiste.exe');
    try {
      const res = await agent.post('/batch/jobs').send({
        mode: 'server',
        promptId: 'ddt',
        pulisci: true,
        inputDir: tmpDir,
        outputDir: tmpDir,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Pulizia non disponibile/);
    } finally {
      if (prima === undefined) delete process.env.PULISCI_PYTHON;
      else process.env.PULISCI_PYTHON = prima;
    }
  });

  it('GET /batch/browse senza percorso → punti di partenza', async () => {
    const res = await agent.get('/batch/browse');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dirs)).toBe(true);
  });

  it('GET /batch/browse su una cartella → sottocartelle e conteggio PDF', async () => {
    const dir = tmp('browse');
    writePdf(dir, 'x.pdf');
    fs.mkdirSync(path.join(dir, 'sotto'), { recursive: true });
    const res = await agent.get(`/batch/browse?path=${encodeURIComponent(dir)}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfCount).toBe(1);
    expect(res.body.dirs.map((d: { name: string }) => d.name)).toEqual(['sotto']);
    expect(res.body.parent).toBe(path.dirname(dir));
  });

  it('GET /batch/browse su cartella inesistente → 400 con spiegazione', async () => {
    const res = await agent.get(`/batch/browse?path=${encodeURIComponent(tmp('non-esiste'))}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inesistente/);
  });

  it('POST /batch/jobs con prompt sconosciuto → 400', async () => {
    const res = await agent
      .post('/batch/jobs')
      .send({ mode: 'server', promptId: 'inventato', inputDir: tmpDir, outputDir: tmpDir });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Prompt/);
  });

  it('POST /batch/jobs con modello non in whitelist → 400', async () => {
    // Il modello finisce in una chiamata a pagamento: niente stringhe libere.
    const res = await agent.post('/batch/jobs').send({
      mode: 'server',
      promptId: 'ddt',
      model: 'modello-inventato',
      inputDir: tmpDir,
      outputDir: tmpDir,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Modello/);
  });

  it('POST /batch/jobs senza cartelle → 400', async () => {
    const res = await agent.post('/batch/jobs').send({ mode: 'server', promptId: 'ddt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cartella dei PDF mancante/);
  });

  it('POST /batch/jobs con cartella input inesistente → 400', async () => {
    const res = await agent.post('/batch/jobs').send({
      mode: 'server',
      promptId: 'ddt',
      inputDir: tmp('mai-esistita'),
      outputDir: tmp('out-x'),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inesistente/);
  });

  it('POST /batch/jobs in modalità upload con id inventato → 400', async () => {
    const res = await agent
      .post('/batch/jobs')
      .send({ mode: 'upload', promptId: 'ddt', inputDir: 'non-un-uuid', outputDir: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Caricamento non trovato/);
  });

  it('POST /batch/uploads rifiuta i file non PDF', async () => {
    const res = await agent.post('/batch/uploads').attach('files', Buffer.from('non sono un pdf'), {
      filename: 'brutto.exe',
      contentType: 'application/x-msdownload',
    });
    expect(res.status).toBe(400);
  });

  it('POST /batch/uploads salva i PDF e restituisce un id', async () => {
    const res = await agent.post('/batch/uploads').attach('files', Buffer.from('%PDF-1.4 finto'), {
      filename: 'uno.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
    expect(res.body.uploadId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('un nome di file ostile non esce dalla cartella di appoggio', async () => {
    const res = await agent.post('/batch/uploads').attach('files', Buffer.from('%PDF-1.4 finto'), {
      filename: '../../../evaso.pdf',
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual(['evaso.pdf']);
  });

  it('GET /batch/jobs → lista (vuota o meno) senza log', async () => {
    const res = await agent.get('/batch/jobs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    for (const j of res.body.jobs) expect(j.log).toBeUndefined();
  });

  it('GET /batch/jobs/:id inesistente → 404, e un id malformato non fa traversal', async () => {
    expect((await agent.get(`/batch/jobs/${uuidv4()}`)).status).toBe(404);
    expect((await agent.get('/batch/jobs/..%2F..%2Fusers.enc')).status).toBe(404);
  });
});

// ── policy di accesso alle cartelle del server ──────────────────────────────
// In modalità server centrale è ciò che impedisce a un utente qualsiasi di
// leggere e scrivere su tutti i dischi della macchina.
describe('dentroRadiciConsentite', () => {
  const radice = path.resolve(os.tmpdir(), 'consentita');

  it('la radice stessa e le sue sottocartelle passano', () => {
    expect(dentroRadiciConsentite(radice, [radice])).toBe(true);
    expect(dentroRadiciConsentite(path.join(radice, 'sotto', 'ancora'), [radice])).toBe(true);
  });

  it('fuori dalla radice non passa, nemmeno risalendo con ..', () => {
    expect(dentroRadiciConsentite(path.resolve(os.tmpdir(), 'altra'), [radice])).toBe(false);
    expect(dentroRadiciConsentite(path.join(radice, '..', 'altra'), [radice])).toBe(false);
  });

  it('un nome che inizia come la radice non è dentro la radice', () => {
    // "consentita-riservata" non sta dentro "consentita"
    expect(dentroRadiciConsentite(`${radice}-riservata`, [radice])).toBe(false);
  });

  it('nessuna radice configurata → nessun percorso consentito', () => {
    expect(dentroRadiciConsentite(radice, [])).toBe(false);
  });
});

// ── motore Ollama (senza mai chiamare il modello) ───────────────────────────
describe('statoOllama', () => {
  it('server irraggiungibile → non disponibile, col motivo giusto', async () => {
    // Porta 1: nessuno è mai in ascolto lì, la connessione cade subito.
    const stato = await statoOllama('qwen2.5vl:7b', 'http://127.0.0.1:1');
    expect(stato.disponibile).toBe(false);
    expect(stato.motivo).toMatch(/non raggiungibile/i);
    expect(stato.modello).toBe('qwen2.5vl:7b');
  });
});

describe('accorpa (pagine Ollama → fogli)', () => {
  it('unisce le pagine con lo stesso nome foglio, in ordine', () => {
    const fogli = accorpa([
      { sheets: [{ name: 'DDT', headers: ['Codice', 'Qta'], rows: [['A', 1]] }] },
      { sheets: [{ name: 'DDT', headers: ['Codice', 'Qta'], rows: [['B', 2]] }] },
    ]);
    expect(fogli).toHaveLength(1);
    expect(fogli[0].rows).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('accetta righe come oggetti e le rimette in ordine di intestazione', () => {
    // Alcuni modelli restituiscono {intestazione: valore} invece dell'array
    const fogli = accorpa([
      { sheets: [{ name: 'F', headers: ['Codice', 'Qta'], rows: [{ Qta: 3, Codice: 'X' }] }] },
    ]);
    expect(fogli[0].rows).toEqual([['X', 3]]);
  });

  it('pagina senza fogli → nessuna riga, nessun errore', () => {
    expect(accorpa([{}, { sheets: [] }])).toEqual([]);
  });
});
