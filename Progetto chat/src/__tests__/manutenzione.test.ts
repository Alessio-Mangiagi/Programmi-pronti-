// manutenzione.test.ts — le parti che tengono in piedi l'installazione nel
// tempo: nomi di file di lavoro univoci, potatura delle cartelle temporanee,
// tetto agli storici su disco e lock di istanza singola.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { OUTPUT_FOLDER, uniqueOutputPath, pruneOlderThan } from '../routes/helpers';
import {
  MAX_DDT_VALIDATIONS,
  insertDDTValidation,
  getDDTValidations,
  flushDb,
} from '../models/database';
import { acquisisciLock, LOCK_FILE } from '../../../shared/node/istanza-unica';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manutenzione-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Nomi di output ──────────────────────────────────────────────────────────
describe('uniqueOutputPath', () => {
  it('due conversioni della stessa commessa non si sovrascrivono', () => {
    const a = uniqueOutputPath('__test__');
    const b = uniqueOutputPath('__test__');
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(OUTPUT_FOLDER);
    expect(a.endsWith('.xlsx')).toBe(true);
  });

  it('il nome porta la commessa e il PID, non quello del PDF', () => {
    const p = path.basename(uniqueOutputPath('COMM-1'));
    expect(p.startsWith('COMM-1_')).toBe(true);
    expect(p).toContain(String(process.pid));
  });
});

// ── Potatura delle cartelle di lavoro ───────────────────────────────────────
describe('pruneOlderThan', () => {
  it('rimuove i file più vecchi della soglia e lascia gli altri', () => {
    const dir = path.join(tmpDir, 'prune');
    fs.mkdirSync(dir, { recursive: true });
    const vecchio = path.join(dir, 'vecchio.xlsx');
    const nuovo = path.join(dir, 'nuovo.xlsx');
    fs.writeFileSync(vecchio, 'x');
    fs.writeFileSync(nuovo, 'x');
    // Invecchia il primo di 48 ore
    const ieri = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(vecchio, ieri, ieri);

    expect(pruneOlderThan(dir, 24 * 60 * 60 * 1000)).toBe(1);
    expect(fs.existsSync(vecchio)).toBe(false);
    expect(fs.existsSync(nuovo)).toBe(true);
  });

  it('cartella inesistente → nessun errore', () => {
    expect(pruneOlderThan(path.join(tmpDir, 'mai-creata'), 1000)).toBe(0);
  });
});

// ── Storico convalide DDT ───────────────────────────────────────────────────
describe('convalide DDT su data.json', () => {
  it('non supera il tetto massimo di record', () => {
    for (let i = 0; i < MAX_DDT_VALIDATIONS + 10; i++) {
      insertDDTValidation('u1', 'utente', '__test__', `f${i}.xlsx`, true);
    }
    expect(getDDTValidations(MAX_DDT_VALIDATIONS * 2)).toHaveLength(MAX_DDT_VALIDATIONS);
  });

  it('la lettura ordinata non riordina la cache condivisa', () => {
    const prima = getDDTValidations(5).map((v) => v.fileName);
    getDDTValidations(1000); // ordina la copia, non l'originale
    expect(getDDTValidations(5).map((v) => v.fileName)).toEqual(prima);
  });

  it('scrive su DDT_DB_PATH, non sul data.json reale', async () => {
    await flushDb();
    expect(process.env.DDT_DB_PATH).toBeTruthy();
    expect(fs.existsSync(process.env.DDT_DB_PATH!)).toBe(true);
  });
});

// ── Istanza singola ─────────────────────────────────────────────────────────
describe('lock di istanza', () => {
  it('prende il lock e lo rilascia', () => {
    const dir = path.join(tmpDir, `lock-${uuidv4()}`);
    fs.mkdirSync(dir, { recursive: true });

    const esito = acquisisciLock(dir);
    expect(esito.acquisito).toBe(true);
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(true);

    if (esito.acquisito) esito.rilascia();
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(false);
  });

  it('rifiuta la partenza se il lock è di un processo vivo', () => {
    const dir = path.join(tmpDir, `lock-vivo-${uuidv4()}`);
    fs.mkdirSync(dir, { recursive: true });
    // Il processo padre è vivo per definizione (ci ha avviati) ed è diverso dal
    // nostro: è il modo portabile di simulare "un'altra istanza è attiva".
    fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid }), 'utf8');

    const esito = acquisisciLock(dir);
    expect(esito.acquisito).toBe(false);
    if (!esito.acquisito) expect(esito.pidAttivo).toBe(process.ppid);
  });

  it('un lock di un processo morto non blocca il riavvio', () => {
    const dir = path.join(tmpDir, `lock-morto-${uuidv4()}`);
    fs.mkdirSync(dir, { recursive: true });
    // PID irrealisticamente alto: nessun processo lo occupa
    fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 4194303 }), 'utf8');

    const esito = acquisisciLock(dir);
    expect(esito.acquisito).toBe(true);
    if (esito.acquisito) esito.rilascia();
  });

  it('file di lock corrotto → si riparte comunque', () => {
    const dir = path.join(tmpDir, `lock-rotto-${uuidv4()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LOCK_FILE), 'non-json', 'utf8');

    const esito = acquisisciLock(dir);
    expect(esito.acquisito).toBe(true);
    if (esito.acquisito) esito.rilascia();
  });
});
