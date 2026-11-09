// "><(((º> sabusabu <º)))><"
// skytower.ts — ogni DDT elaborato finisce anche in SkyTower (il CDE della
// suite), come documento della commessa: l'archivio dei documenti è uno solo.
//
// Dal 09/11/2026 ("DDT e Magazzino") la commessa si sceglie all'ingresso dal registro
// della suite e la cartella dati è il suo codice ("101-003"): quello è il codice per
// SkyTower. Per le cartelle di prima ("demo-augusta") vale il campo `codiceCommessa`
// dell'utente (lo imposta l'admin). Oltre al PDF va anche l'Excel della conversione
// (inviaExcelASkyTower, senza doppioni: vedi sotto).
//
// Mai un errore per l'utente: SkyTower spenta, commessa sconosciuta o PDF
// mancante finiscono nel log e basta. Si spegne con DDT_SKYTOWER=0.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { findUserByUsername } from '../models/users';
import { commessaDataDir, writeFileAtomicSerial } from '../routes/helpers';
import { estraiConsegne } from './consegne';
import { extractDdtNumbers } from './ddtArchive';
import { eBustaFirmata } from './firmaDigitale';
import { codiceDaCartella } from './commessaSessione';

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
  /** PDF originale; se manca o non esiste non si manda niente. Può essere una busta firmata .p7m. */
  pdfPath?: string;
  /**
   * Solo per i DDT firmati (.p7m): il PDF estratto dalla busta. Si manda la busta originale (è lei
   * ad avere valore legale); se SkyTower la rifiuta (4xx: formato non ammesso dal naming del
   * progetto o versione senza supporto .p7m) si ripiega su questo PDF.
   */
  pdfEstrattoPath?: string;
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

/**
 * Codice commessa aziendale per un utente/cartella dati, '' se non si sa.
 * Dal 09/11/2026 la commessa si sceglie all'ingresso dal registro della suite e la cartella dati È il
 * codice (services/commessaSessione): se la cartella corrisponde a una commessa del registro vince lei,
 * anche sul codice scritto a mano sull'account (che resta il ripiego per le cartelle precedenti, es.
 * "demo-augusta", e per la conversione automatica di cartelle con un nome che non è un codice).
 */
export function codiceCommessaPer(utente: string, commessaId: string): string {
  const dalRegistro = codiceDaCartella(commessaId);
  if (dalRegistro) return dalRegistro;
  const u = findUserByUsername(utente);
  return String((u && u.codiceCommessa) || '').trim();
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
  const firmato = eBustaFirmata(pdf, o.pdfPath);
  const invia = (dati: Buffer, tipo: string, nome: string) =>
    suite.chiama('skytower', 'POST', `/suite/commesse/${encodeURIComponent(codice)}/documenti`, {
      parametri: { title: d.titolo, description: d.descrizione, tipo: tipoDocumento(), attributes: JSON.stringify(d.attributes) },
      corpoFile: { dati, tipo, nome },
      utente: o.utente,
      email: o.email,
      timeout: 60000,
    });
  try {
    const r = await invia(pdf, firmato ? 'application/pkcs7-mime' : 'application/pdf', nomeInviato(o.pdfPath, firmato));
    logger.info(`SkyTower: ${o.exportName} archiviato nella commessa ${codice} come ${(r && r.identifier) || 'documento'}${firmato ? ' (busta firmata .p7m)' : ''}`);
    return true;
  } catch (e) {
    const err = e as { stato?: number; messaggio?: string; message?: string };
    // busta .p7m rifiutata (es. SkyTower senza supporto .p7m o naming che non ammette l'estensione):
    // meglio il PDF estratto che niente; errori di rete o 5xx non si ritentano
    const rifiuto = typeof err.stato === 'number' && err.stato >= 400 && err.stato < 500;
    if (firmato && rifiuto && o.pdfEstrattoPath && fs.existsSync(o.pdfEstrattoPath)) {
      try {
        const nome = nomeInviato(o.pdfPath, true).replace(/\.p7m$/i, '');
        const r = await invia(fs.readFileSync(o.pdfEstrattoPath), 'application/pdf', nome.toLowerCase().endsWith('.pdf') ? nome : `${nome}.pdf`);
        logger.info(`SkyTower: ${o.exportName} archiviato nella commessa ${codice} come ${(r && r.identifier) || 'documento'} (PDF estratto: busta .p7m rifiutata, ${err.stato})`);
        return true;
      } catch (e2) {
        const err2 = e2 as { stato?: number; messaggio?: string; message?: string };
        logger.warn(`SkyTower: ${o.exportName} non archiviato nemmeno come PDF estratto (${err2.stato || '?'}): ${err2.messaggio || err2.message}`);
        return false;
      }
    }
    logger.warn(`SkyTower: ${o.exportName} non archiviato (${err.stato || '?'}): ${err.messaggio || err.message}`);
    return false;
  }
}

// ── Excel della conversione (09/11/2026: su SkyTower va "tutto", risposta "3b") ─────────────────
// Oltre al PDF va in SkyTower anche l'Excel prodotto dalla conversione, nella stessa commessa e
// cartella "Suite Cosedil". SkyTower crea un documento NUOVO a ogni invio dalla suite (POST
// /suite/commesse/{codice}/documenti non fa revisioni), quindi i doppioni si evitano da qui: per ogni
// export si ricorda l'impronta dei DATI estratti (non dei byte dell'xlsx, che ExcelJS rigenera con la
// data di creazione dentro) e lo stesso Excel non riparte. Succedeva con "Riscarica" dalla cronologia,
// che ripassa da /claude-to-excel. Se i dati cambiano (export corretto e risalvato) parte un documento
// nuovo, con l'identificativo di quello che sostituisce negli attributi. Registro degli invii:
// data/<cartella>/skytower-inviati.json.

const FILE_INVIATI = 'skytower-inviati.json';

export interface InvioExcel {
  /** Cartella dati della commessa (data/<commessaId>): da qui anche il codice commessa. */
  commessaId: string;
  utente: string;
  email?: string;
  /** L'Excel: i byte (flusso manuale, il file si cancella dopo il download) o il percorso (conversione automatica). */
  excel: Buffer | string;
  /** Nome del file come lo vede chi lo apre in SkyTower. */
  nomeFile: string;
  /** Dati estratti (per titolo, attributi e impronta); senza, l'impronta è quella dei byte. */
  parsed?: unknown;
  /** Chiave dell'invio: nome dell'export JSON, o del file cumulativo della conversione automatica. */
  exportName: string;
}

interface VoceInviata {
  impronta: string;
  identifier?: string;
  il: string;
}

function leggiInviati(commessaId: string): Record<string, VoceInviata> {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(commessaDataDir(commessaId), FILE_INVIATI), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

/** Impronta dei dati di un export (stabile fra due conversioni identiche). */
export function improntaDati(parsed: unknown, byte?: Buffer): string {
  const h = crypto.createHash('sha256');
  if (parsed !== undefined && parsed !== null) h.update(JSON.stringify(parsed));
  else if (byte) h.update(byte);
  return h.digest('hex');
}

/**
 * Manda a SkyTower l'Excel di una conversione. true = in SkyTower (anche "c'era già, identico");
 * false con una riga di log in ogni altro caso (SkyTower spenta, commessa senza codice, file illeggibile):
 * mai un errore per l'utente, come per il PDF.
 */
export async function inviaExcelASkyTower(o: InvioExcel): Promise<boolean> {
  if (!attivo()) return false;
  const codice = codiceCommessaPer(o.utente, o.commessaId);
  if (!codice) {
    logger.info(`SkyTower: Excel di ${o.exportName} non inviato, nessun codice commessa per "${o.commessaId}"`);
    return false;
  }
  let dati: Buffer;
  try {
    dati = Buffer.isBuffer(o.excel) ? o.excel : fs.readFileSync(o.excel);
  } catch (e) {
    logger.info(`SkyTower: Excel di ${o.exportName} non inviato, file illeggibile: ${(e as Error).message}`);
    return false;
  }
  if (!dati.length) return false;
  const chiave = `${o.exportName}#xlsx`;
  const impronta = improntaDati(o.parsed, dati);
  const prima = leggiInviati(o.commessaId)[chiave];
  if (prima && prima.impronta === impronta) {
    logger.info(`SkyTower: Excel di ${o.exportName} già archiviato (${prima.identifier || 'stesso contenuto'}), non lo rimando`);
    return true;
  }
  const d = o.parsed !== undefined ? descriviDdt(o.parsed, o.commessaId, o.exportName) : null;
  const base = o.exportName.replace(/\.json$/i, '');
  const titolo = `${d ? d.titolo : base} (Excel)`.slice(0, 200);
  const attributi: Record<string, unknown> = { ...(d ? d.attributes : { origine: 'ddt', export: o.exportName }), formato: 'xlsx' };
  if (prima?.identifier) attributi.sostituisce = prima.identifier;
  try {
    const r = await suite.chiama('skytower', 'POST', `/suite/commesse/${encodeURIComponent(codice)}/documenti`, {
      parametri: {
        title: titolo,
        description: `Excel della conversione del Lettore DDT (${base}).`.slice(0, 4000),
        tipo: tipoDocumento(),
        attributes: JSON.stringify(attributi),
      },
      corpoFile: {
        dati,
        tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        nome: /\.xlsx$/i.test(o.nomeFile) ? o.nomeFile : `${o.nomeFile}.xlsx`,
      },
      utente: o.utente,
      email: o.email,
      timeout: 60000,
    });
    const identifier = (r && r.identifier) || '';
    logger.info(`SkyTower: Excel di ${o.exportName} archiviato nella commessa ${codice} come ${identifier || 'documento'}`);
    // Registro degli invii riletto subito prima di scrivere: due invii vicini della stessa commessa
    // (conversione automatica di più file) non si cancellano a vicenda la voce.
    const inviati = leggiInviati(o.commessaId);
    inviati[chiave] = { impronta, identifier, il: new Date().toISOString() };
    await writeFileAtomicSerial(path.join(commessaDataDir(o.commessaId), FILE_INVIATI), JSON.stringify(inviati, null, 1));
    return true;
  } catch (e) {
    const err = e as { stato?: number; messaggio?: string; message?: string };
    logger.warn(`SkyTower: Excel di ${o.exportName} non archiviato (${err.stato || '?'}): ${err.messaggio || err.message}`);
    return false;
  }
}

/** Nome del file mandato a SkyTower: una busta firmata finisce sempre in ".pdf.p7m". */
function nomeInviato(pdfPath: string, firmato: boolean): string {
  const base = path.basename(pdfPath);
  if (!firmato) return base;
  const senza = base.replace(/(\.p7m)+$/i, '');
  return `${senza.toLowerCase().endsWith('.pdf') ? senza : `${senza}.pdf`}.p7m`;
}
