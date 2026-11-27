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

/**
 * Confidenza della pagina (0-1) dal TSV di Tesseract: media delle confidenze delle parole
 * (righe di livello 5 con del testo; le righe di blocco, paragrafo e riga hanno conf -1),
 * pesata sulla lunghezza della parola. Il peso conta: una scansione sporca semina segni
 * isolati letti al 10-30% ("|", ".", "-") che con la media semplice affosserebbero una
 * pagina altrimenti letta bene, mentre una parola lunga letta male pesa per quello che è.
 * Pagina senza parole → undefined: nessuna prova, come per i motori che non la danno.
 * Serve alla soglia CONFIDENZA_MINIMA di regole.ts: sotto, un requisito mancante diventa
 * "dubbio" e non "ko", perché il testo potrebbe esserci e non essere stato letto.
 */
export function confidenzaDaTsv(tsv: string): number | undefined {
  let somma = 0;
  let peso = 0;
  for (const riga of tsv.split(/\r?\n/).slice(1)) {
    // colonne: level page_num block_num par_num line_num word_num left top width height conf text
    const c = riga.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const conf = Number(c[10]);
    const testo = c.slice(11).join('\t').trim();
    if (!testo || !Number.isFinite(conf) || conf < 0) continue;
    somma += conf * testo.length;
    peso += testo.length;
  }
  return peso ? Math.round(somma / peso / 100 * 1000) / 1000 : undefined;
}

async function ocrImmagine(percorso: string): Promise<Pick<PaginaTesto, 'testo' | 'confidenza'>> {
  // Una sola lettura, due uscite: il testo (txt, con a capo e paragrafi di Tesseract) e le
  // parole con la loro confidenza (tsv). Prima si leggeva solo il testo da stdout e la
  // confidenza andava persa. I due file vanno in una cartella temporanea che si ripulisce.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-tess-'));
  try {
    const base = path.join(dir, 'pagina');
    await esegui(TESSERACT, [percorso, base, '-l', LINGUE, 'txt', 'tsv'], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const testo = fs.readFileSync(`${base}.txt`, 'utf8');
    let confidenza: number | undefined;
    try {
      confidenza = confidenzaDaTsv(fs.readFileSync(`${base}.tsv`, 'utf8'));
    } catch {
      /* tsv mancante (Tesseract vecchio o configurazione tolta): resta il solo testo */
    }
    return confidenza === undefined ? { testo } : { testo, confidenza };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* cartella temporanea: se resta, la pota il sistema */
    }
  }
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
      pagine.push({ numero: i + 1, ...(await ocrImmagine(path.join(tmpDir, immagini[i]))) });
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
    return [{ numero: 1, ...(await ocrImmagine(percorso)) }];
  },
};
