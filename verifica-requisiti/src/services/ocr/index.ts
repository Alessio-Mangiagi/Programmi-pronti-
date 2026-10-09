/**
 * ocr/index.ts — motori OCR intercambiabili.
 *
 * Il resto dell'app non sa quale motore gira: chiede testo per un file e lo
 * riceve pagina per pagina. Cambiare motore (o aggiungerne uno) significa
 * scrivere un adattatore qui dentro e cambiare "motoreOcr" in config.json.
 */
import { PaginaTesto } from '../../tipi';
import { config, MotoreOcr } from '../../config';
import logger from '../../utils/logger';
import { tesseract } from './tesseract';
// "><(((º> sabusabu <º)))><"
import { paddle } from './paddle';
import { claude } from './claude';

export interface AdattatoreOcr {
  nome: MotoreOcr;
  /** Il motore è installato/configurato su questa macchina? */
  disponibile(): Promise<boolean>;
  /** Testo pagina per pagina. Deve lanciare un errore parlante se fallisce. */
  leggi(percorso: string, mime: string): Promise<PaginaTesto[]>;
}

const MOTORI: Record<MotoreOcr, AdattatoreOcr> = { tesseract, paddle, claude };

export function motoreCorrente(): AdattatoreOcr {
  return MOTORI[config.motoreOcr] ?? tesseract;
}

/** Stato dei motori, per la pagina di sistema e per il messaggio d'errore giusto. */
export async function statoMotori(): Promise<Array<{ nome: MotoreOcr; disponibile: boolean; attivo: boolean }>> {
  return Promise.all(
    (Object.keys(MOTORI) as MotoreOcr[]).map(async (nome) => ({
      nome,
      disponibile: await MOTORI[nome].disponibile().catch(() => false),
      attivo: nome === config.motoreOcr,
    }))
  );
}

export async function leggiConOcr(
  percorso: string,
  mime: string,
  motore?: MotoreOcr
): Promise<{ pagine: PaginaTesto[]; motore: MotoreOcr }> {
  const adattatore = motore ? MOTORI[motore] : motoreCorrente();
  if (!adattatore) throw new Error(`Motore OCR sconosciuto: ${motore}`);

  if (!(await adattatore.disponibile())) {
    throw new Error(
      `Motore OCR "${adattatore.nome}" non disponibile su questa macchina. ` +
        `Installalo o cambia "motoreOcr" in config.json.`
    );
  }

  const inizio = Date.now();
  const pagine = await adattatore.leggi(percorso, mime);
  logger.info(`OCR ${adattatore.nome}: ${pagine.length} pagine in ${Date.now() - inizio}ms`);
  return { pagine, motore: adattatore.nome };
}
