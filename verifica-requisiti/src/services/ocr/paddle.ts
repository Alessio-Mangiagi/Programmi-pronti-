/**
 * paddle.ts — OCR via PaddleOCR (app "ocr-webapp-paddleocr" della suite).
 *
 * SCHELETRO: non ancora collegato. Il worker esiste già in
 * ../ocr-webapp-paddleocr/ocr_worker.py e regge le scansioni storte meglio di
 * Tesseract; per attivarlo serve concordare il protocollo del worker (argomenti
 * e formato JSON in uscita) e riportarlo qui sotto.
 */
import fs from 'fs';
import path from 'path';
import { PaginaTesto } from '../../tipi';
import { APP_DIR } from '../../config';
import { AdattatoreOcr } from './index';

/** Cartella sorella nella suite: ..\ocr-webapp-paddleocr */
const WORKER = path.join(APP_DIR, '..', 'ocr-webapp-paddleocr', 'ocr_worker.py');

export const paddle: AdattatoreOcr = {
  nome: 'paddle',

  async disponibile() {
    // Il file c'è, ma finché leggi() è un segnaposto il motore non è usabile.
    return false;
  },

  async leggi(_percorso: string, _mime: string): Promise<PaginaTesto[]> {
    const dov = fs.existsSync(WORKER) ? WORKER : 'ocr-webapp-paddleocr/ocr_worker.py (non trovato)';
    throw new Error(
      `Motore PaddleOCR non ancora collegato. Worker previsto: ${dov}. ` +
        'Da fare: spawn del worker Python, una pagina per volta, e mappatura della sua ' +
        'risposta JSON su PaginaTesto { numero, testo, confidenza }.'
    );
  },
};
