/**
 * estrazione.ts — dal file al testo.
 *
 * Due strade, decise dal file stesso: se il PDF ha già testo selezionabile lo
 * si legge (gratis e perfetto), altrimenti è una scansione e passa dall'OCR
 * (lento e imperfetto). La soglia che separa i due casi sta in config.json
 * ("sogliaTestoNativo"): un PDF fatto di fotografie restituisce quasi zero
 * caratteri, uno vero ne restituisce migliaia.
 *
 * La coda è seriale di proposito: l'OCR satura la CPU, farne tre insieme non
 * fa finire prima e fa sembrare il server bloccato.
 */
import fs from 'fs';
import path from 'path';
import { Documento, PaginaTesto } from '../tipi';
import { config } from '../config';
import logger from './../utils/logger';
import { estrazioneDuration } from '../utils/metrics';
import {
  aggiornaDocumento,
  elencaDocumenti,
  salvaTesto,
  trovaDocumento,
} from '../models/archivio';
import { leggiConOcr } from './ocr';
import { indicizza } from './indice';

const coda: string[] = [];
let inCorso = false;

/** Mette il documento in coda e torna subito: l'upload non aspetta l'OCR. */
export function accodaEstrazione(documentoId: string): void {
  if (!coda.includes(documentoId)) coda.push(documentoId);
  void scorriCoda();
}

export function documentiInCoda(): number {
  return coda.length + (inCorso ? 1 : 0);
}

async function scorriCoda(): Promise<void> {
  if (inCorso) return;
  inCorso = true;
  try {
    while (coda.length > 0) {
      const id = coda.shift()!;
      try {
        await elaboraDocumento(id);
      } catch (e) {
        const messaggio = (e as Error).message;
        logger.error(`Estrazione fallita per ${id}: ${messaggio}`);
        aggiornaDocumento(id, { stato: 'errore', errore: messaggio });
      }
    }
  } finally {
    inCorso = false;
  }
}

// I font standard sono file su disco dentro pdfjs-dist: senza questo percorso
// pdf.js li cerca via rete e riempie il log di avvisi a ogni pagina.
const FONT_STANDARD = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
);

// pdf.js dalla 4.x è solo ESM, questa app compila in CommonJS: un `import`
// statico diventerebbe un `require()` di un .mjs, che a runtime esplode con
// ERR_REQUIRE_ESM. `new Function` tiene l'import() vero anche dopo tsc, che
// altrimenti lo riscriverebbe in require. Caricato una volta sola, alla prima
// pagina letta: l'avvio del server resta immediato.
const importaEsm = new Function('specificatore', 'return import(specificatore)') as (
  s: string
) => Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>;

let pdfjsCaricato: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;
function caricaPdfjs() {
  if (!pdfjsCaricato) pdfjsCaricato = importaEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsCaricato;
}

/**
 * Testo nativo del PDF, pagina per pagina (vuoto se il PDF è una scansione).
 *
 * Si usa pdfjs-dist e non pdf-parse: quest'ultimo impacchetta un pdf.js del
 * 2018 che, se express/multer/exceljs vengono caricati prima di lui, fallisce
 * con "bad XRef entry" su PDF perfettamente validi.
 */
async function testoNativoPdf(percorso: string): Promise<PaginaTesto[]> {
  const buffer = fs.readFileSync(percorso);
  const pdfjs = await caricaPdfjs();
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // I PDF arrivano da fuori: niente eval, niente font di sistema.
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: FONT_STANDARD,
  }).promise;

  const pagine: PaginaTesto[] = [];
  try {
    for (let numero = 1; numero <= documento.numPages; numero++) {
      // "><(((º> sabusabu <º)))><"
      const pagina = await documento.getPage(numero);
      const contenuto = await pagina.getTextContent();
      const testo = contenuto.items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ');
      pagine.push({ numero, testo });
      pagina.cleanup();
    }
  } finally {
    await documento.destroy();
  }

  return pagine;
}

function caratteri(pagine: PaginaTesto[]): number {
  return pagine.reduce((n, p) => n + p.testo.replace(/\s/g, '').length, 0);
}

/**
 * Estrae il testo di un documento e lo salva. Idempotente: rilanciarla su un
 * documento già pronto lo rifà da capo (serve al pulsante "rielabora", quando
 * si cambia motore OCR).
 */
export async function elaboraDocumento(id: string): Promise<Documento | undefined> {
  const doc = trovaDocumento(id);
  if (!doc) return undefined;
  if (!fs.existsSync(doc.percorso)) {
    throw new Error(`File non trovato in archivio: ${doc.percorso}`);
  }

  aggiornaDocumento(id, { stato: 'in-lavorazione', errore: undefined });
  const fine = estrazioneDuration.startTimer();

  let pagine: PaginaTesto[] = [];
  let scansione = true;

  if (doc.mime === 'application/pdf') {
    try {
      pagine = await testoNativoPdf(doc.percorso);
    } catch (e) {
      // PDF illeggibile da pdf-parse (cifrato, malformato): resta l'OCR.
      logger.warn(`Testo nativo non estraibile da ${doc.nomeFile}: ${(e as Error).message}`);
      pagine = [];
    }
    scansione = caratteri(pagine) < config.sogliaTestoNativo;
  }

  let motoreUsato: Documento['motoreOcr'];
  if (scansione) {
    const esito = await leggiConOcr(doc.percorso, doc.mime);
    pagine = esito.pagine;
    motoreUsato = esito.motore;
  }

  fine({ motore: scansione ? String(motoreUsato) : 'nativo' });

  const aggiornato = salvaTesto(id, pagine, { scansione, motoreOcr: motoreUsato });
  if (aggiornato) indicizza(aggiornato);
  logger.info(
    `Estratto "${doc.nomeFile}": ${pagine.length} pagine, ${caratteri(pagine)} caratteri` +
      (scansione ? ` (OCR ${motoreUsato})` : ' (testo nativo)')
  );
  return aggiornato;
}

/**
 * Documenti rimasti a metà per un riavvio. L'estrazione non costa nulla per
 * pagina (a differenza dei batch a pagamento di "lettore-ddt"), quindi si
 * rifà tutta invece di provare a recuperare il lavoro parziale.
 */
export async function riprendiEstrazioniInterrotte(): Promise<void> {
  const sospesi = elencaDocumenti().filter(
    (d) => d.stato === 'in-coda' || d.stato === 'in-lavorazione'
  );
  if (sospesi.length === 0) return;
  logger.info(`Riprendo l'estrazione di ${sospesi.length} documenti interrotti dal riavvio.`);
  for (const d of sospesi) accodaEstrazione(d.id);
}
