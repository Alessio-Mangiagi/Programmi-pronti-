/**
 * tesseract.ts — OCR con Tesseract (motore predefinito).
 *
 * Tesseract legge immagini, non PDF: i PDF si rasterizzano prima con pdftoppm
 * (poppler), una pagina per file, e si passa ogni immagine al motore. Un PDF di
 * 40 pagine sono 40 chiamate: lente ma prevedibili, e senza costi per pagina.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PaginaTesto } from '../../tipi';
import { AdattatoreOcr } from './index';

const esegui = promisify(execFile);

const TESSERACT =
  process.env.TESSERACT_EXE || 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const PDFTOPPM = process.env.PDFTOPPM_EXE || 'pdftoppm';
/** ita+eng: i documenti di cantiere hanno spesso sigle e diciture inglesi. */
const LINGUE = process.env.TESSERACT_LANG || 'ita+eng';
/** 300 DPI: sotto, le scansioni storte perdono le cifre piccole (date, importi). */
const DPI = 300;

async function comandoEsiste(exe: string, args: string[]): Promise<boolean> {
  try {
    await esegui(exe, args, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function ocrImmagine(percorso: string): Promise<string> {
  // "stdout" come output: niente file temporaneo di testo da ripulire.
  const { stdout } = await esegui(TESSERACT, [percorso, 'stdout', '-l', LINGUE], {
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function ocrPdf(percorso: string): Promise<PaginaTesto[]> {
  if (!(await comandoEsiste(PDFTOPPM, ['-v']))) {
    throw new Error(
      'pdftoppm (poppler) non trovato: serve per convertire il PDF in immagini prima di Tesseract. ' +
        'Installa poppler e mettilo nel PATH, oppure imposta PDFTOPPM_EXE.'
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-ocr-'));
  // "><(((º> sabusabu <º)))><"
  try {
    await esegui(PDFTOPPM, ['-r', String(DPI), '-png', percorso, path.join(tmpDir, 'pag')], {
      timeout: 600000,
    });

    const immagini = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.png'))
      .sort(); // pag-01, pag-02, ... l'ordine alfabetico è quello delle pagine

    const pagine: PaginaTesto[] = [];
    for (let i = 0; i < immagini.length; i++) {
      pagine.push({ numero: i + 1, testo: await ocrImmagine(path.join(tmpDir, immagini[i])) });
    }
    return pagine;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* cartella temporanea: se resta, la pota il sistema */
    }
  }
}

export const tesseract: AdattatoreOcr = {
  nome: 'tesseract',

  async disponibile() {
    return comandoEsiste(TESSERACT, ['--version']);
  },

  async leggi(percorso: string, mime: string) {
    if (mime === 'application/pdf') return ocrPdf(percorso);
    return [{ numero: 1, testo: await ocrImmagine(percorso) }];
  },
};
