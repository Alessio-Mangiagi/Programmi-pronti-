// "><(((º> sabusabu <º)))><"
// skytower.ts — ogni DDT elaborato finisce anche in SkyTower (il CDE della
// suite), come documento della commessa: l'archivio dei documenti è uno solo.
//
// Il Lettore DDT conosce la commessa come `commessaId` dell'utente (es.
// "demo-augusta"), che non è il codice commessa aziendale ("101-003") con cui
// SkyTower e le altre app si riconoscono. Il codice si prende dal campo
// `codiceCommessa` dell'utente (lo imposta l'admin); in mancanza vale il
// commessaId stesso se esiste nel registro della suite (shared/suite/commesse.json).
//
// Mai un errore per l'utente: SkyTower spenta, commessa sconosciuta o PDF
// mancante finiscono nel log e basta. Si spegne con DDT_SKYTOWER=0.
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { findUserByUsername } from '../models/users';
import { estraiConsegne } from './consegne';
import { extractDdtNumbers } from './ddtArchive';

interface SuiteLink {
  chiama(app: string, metodo: string, percorso: string, opzioni?: Record<string, unknown>): Promise<any>;
  trovaCommessa(codice: string): { code: string; nome: string } | null;
  normalizzaCommessa(codice: string): string;
}
// Modulo condiviso in JavaScript (CommonJS) senza dichiarazioni: lo stesso
// percorso relativo vale da src/ e da dist/.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const suite: SuiteLink = require('../../../shared/suite/suite_link.js');

export interface InvioDdt {
  /** commessaId del Lettore DDT (cartella data/<commessaId>). */
  commessaId: string;
  /** Chi ha elaborato (username): va a SkyTower come utente del portale. */
  utente: string;
  /** Email dell'utente nel portale (req.cosedil.email): SkyTower riconosce l'utente da questa. */
  email?: string;
  /** PDF originale; se manca o non esiste non si manda niente. */
  pdfPath?: string;
  /** JSON estratto (summary, sheets). */
  parsed: unknown;
  /** Nome dell'export (per titolo e log). */
  exportName: string;
}

export function attivo(): boolean {
  return String(process.env.DDT_SKYTOWER || '1').trim() !== '0';
}

/** Tipo documento ISO 19650 (2 lettere) con cui SkyTower nomina i DDT. */
export function tipoDocumento(): string {
  return (String(process.env.DDT_SKYTOWER_TIPO || 'RP').trim().toUpperCase() || 'RP').slice(0, 2);
}

/** Codice commessa aziendale per un utente/commessaId, '' se non si sa. */
export function codiceCommessaPer(utente: string, commessaId: string): string {
  const u = findUserByUsername(utente);
  const proprio = String((u && u.codiceCommessa) || '').trim();
  if (proprio) return proprio;
  return suite.trovaCommessa(commessaId) ? commessaId : '';
}

/** Titolo e attributi del documento a partire dall'export. */
export function descriviDdt(parsed: unknown, commessaId: string, exportName: string) {
  const numeri = extractDdtNumbers(parsed).slice(0, 20);
  const righe = estraiConsegne(parsed, commessaId, exportName);
  const fornitori = Array.from(new Set(righe.map((r) => r.fornitore).filter(Boolean)));
  const date = Array.from(new Set(righe.map((r) => r.dataIso).filter(Boolean))).sort();
  const base = exportName.replace(/\.json$/i, '');
  const titolo = (numeri.length ? `DDT ${numeri.join(', ')}` : base) + (fornitori.length ? ` - ${fornitori.slice(0, 3).join(', ')}` : '');
  return {
    titolo: titolo.slice(0, 200),
    descrizione: `Documento di trasporto elaborato dal Lettore DDT (${base}).`.slice(0, 4000),
    attributes: {
      origine: 'ddt',
      export: exportName,
      ddt: numeri,
      fornitori,
      data_prima: date[0] || '',
      data_ultima: date[date.length - 1] || '',
      righe: righe.length,
    },
  };
}

/**
 * Manda il PDF a SkyTower come documento WIP della commessa. Ritorna true se
 * SkyTower l'ha accettato; false (con riga di log) in ogni altro caso.
 */
export async function inviaDdtASkyTower(o: InvioDdt): Promise<boolean> {
  if (!attivo()) return false;
  const codice = codiceCommessaPer(o.utente, o.commessaId);
  if (!codice) {
    logger.info(`SkyTower: ${o.exportName} non inviato, nessun codice commessa per "${o.commessaId}" (impostalo sull'utente ${o.utente} o nel registro della suite)`);
    return false;
  }
  if (!o.pdfPath || !fs.existsSync(o.pdfPath)) {
    logger.info(`SkyTower: ${o.exportName} non inviato, PDF originale non disponibile`);
    return false;
  }
  let pdf: Buffer;
  try {
    pdf = fs.readFileSync(o.pdfPath);
  } catch (e) {
    logger.warn(`SkyTower: ${o.exportName} non inviato, PDF illeggibile: ${(e as Error).message}`);
    return false;
  }
  const d = descriviDdt(o.parsed, o.commessaId, o.exportName);
  try {
    const r = await suite.chiama('skytower', 'POST', `/suite/commesse/${encodeURIComponent(codice)}/documenti`, {
      parametri: { title: d.titolo, description: d.descrizione, tipo: tipoDocumento(), attributes: JSON.stringify(d.attributes) },
      corpoFile: { dati: pdf, tipo: 'application/pdf', nome: path.basename(o.pdfPath) },
      utente: o.utente,
      email: o.email,
      timeout: 60000,
    });
    logger.info(`SkyTower: ${o.exportName} archiviato nella commessa ${codice} come ${(r && r.identifier) || 'documento'}`);
    return true;
  } catch (e) {
    const err = e as { stato?: number; messaggio?: string; message?: string };
    logger.warn(`SkyTower: ${o.exportName} non archiviato (${err.stato || '?'}): ${err.messaggio || err.message}`);
    return false;
  }
}
