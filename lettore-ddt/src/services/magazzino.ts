// "><(((º> sabusabu <º)))><"
/**
 * magazzino.ts — carico immediato in magazzino (contratto C3 di "DDT e Magazzino", 09/11/2026).
 *
 * Appena il Lettore DDT salva un export (conversione manuale /claude-to-excel o automatica), manda al
 * Magazzino Operativo il blocco di righe appena scritto in data/<cartella>/consegne.json:
 *
 *   POST http://127.0.0.1:5200/api/suite/ddt/consegne   (X-Suite-Token: token di servizio della suite)
 *   { cartella, export, codiceCommessa, salvatoIl, righe: [Consegna…] }
 *   → { righe, nuove, scartate, commessa, ubicazione, avvisi: [] }
 *
 * Prima il Magazzino rileggeva consegne.json ogni 2 minuti (MAGAZZINO_IMPORT_SEC): quel giro resta come
 * rete di sicurezza e non duplica niente, perché il Magazzino riconosce il blocco dalla chiave
 * "<cartella>/<export>" e dall'impronta salvatoIl. Per questo un Magazzino spento o un errore NON sono
 * un errore per l'utente: si dice solo "il magazzino li registrerà appena acceso".
 *
 * L'indirizzo è quello della suite (shared/suite/suite_link.js, app "magazzino": SUITE_URL_MAGAZZINO
 * per cambiarlo). DDT_MAGAZZINO=0 spegne il carico immediato (resta il giro periodico del Magazzino).
 */
import logger from '../utils/logger';
import type { Consegna } from './consegne';

interface SuiteChiama {
  chiama(
    app: string,
    metodo: string,
    percorso: string,
    opzioni?: Record<string, unknown>
  ): Promise<RispostaMagazzino | null>;
}
/** Risposta di POST /api/suite/ddt/consegne (contratto C3): campi letti con prudenza, versione per versione. */
interface RispostaMagazzino {
  righe?: unknown;
  nuove?: unknown;
  scartate?: unknown;
  commessa?: unknown;
  ubicazione?: unknown;
  avvisi?: unknown[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const suite: SuiteChiama = require('../../../shared/suite/suite_link.js');

/** Il blocco che parte verso il Magazzino (campi del contratto C3). */
export interface BloccoMagazzino {
  /** Cartella dati del Lettore DDT (data/<cartella>): con export forma la chiave di importazione. */
  cartella: string;
  export: string;
  /** Codice del registro della suite ('' se la cartella non è una commessa del registro). */
  codiceCommessa: string;
  salvatoIl: string;
  righe: Consegna[];
}

/** Cosa dire all'utente dopo il carico. */
export interface EsitoMagazzino {
  /** true = il Magazzino ha risposto e registrato (anche 0 righe nuove perché già presenti). */
  registrati: boolean;
  righe?: number;
  nuove?: number;
  scartate?: number;
  commessa?: string;
  ubicazione?: string;
  avvisi: string[];
  /** Frase pronta per la notifica ('' = niente da dire, es. export senza righe di materiale). */
  messaggio: string;
}

export const MSG_MAGAZZINO_SPENTO = 'Il magazzino li registrerà appena acceso.';

export function caricoImmediatoAttivo(): boolean {
  return String(process.env.DDT_MAGAZZINO || '1').trim() !== '0';
}

/** Attesa massima della risposta del Magazzino (ms): oltre, ci pensa il suo giro periodico. */
function timeoutMs(): number {
  const n = Number(process.env.DDT_MAGAZZINO_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

/** Nome dell'ubicazione dalla risposta: stringa o oggetto { nome } secondo la versione del Magazzino. */
function nomeUbicazione(u: unknown): string {
  if (typeof u === 'string') return u;
  if (u && typeof u === 'object') {
    const o = u as Record<string, unknown>;
    return String(o.nome || o.name || o.codice || '');
  }
  return '';
}

/** Frase per l'utente a partire dalla risposta del Magazzino. */
export function frasePerEsito(e: Omit<EsitoMagazzino, 'messaggio'>): string {
  if (!e.registrati) return MSG_MAGAZZINO_SPENTO;
  const n = Number(e.righe) || 0;
  const dove = e.ubicazione || (e.commessa ? `cantiere ${e.commessa}` : '');
  if (n === 0) {
    const s = Number(e.scartate) || 0;
    return s > 0
      ? `Nessun carico registrato in magazzino: ${s} righe senza materiale o quantità.`
      : 'Nessun carico da registrare in magazzino.';
  }
  return `${n} ${n === 1 ? 'carico registrato' : 'carichi registrati'} in magazzino${dove ? ` (${dove})` : ''}.`;
}

/**
 * Manda il blocco al Magazzino. Mai un'eccezione: Magazzino spento, lento o in errore → esito con
 * registrati=false e la frase "li registrerà appena acceso". Un blocco senza righe non parte nemmeno.
 */
export async function caricaInMagazzino(
  b: BloccoMagazzino,
  chi: { utente?: string; email?: string } = {}
): Promise<EsitoMagazzino> {
  if (!caricoImmediatoAttivo() || !b.righe.length)
    return { registrati: false, avvisi: [], messaggio: '' };
  try {
    const r = await suite.chiama('magazzino', 'POST', '/suite/ddt/consegne', {
      dati: {
        cartella: b.cartella,
        export: b.export,
        codiceCommessa: b.codiceCommessa || '',
        salvatoIl: b.salvatoIl,
        righe: b.righe,
      },
      utente: chi.utente || undefined,
      email: chi.email || undefined,
      timeout: timeoutMs(),
    });
    const base = {
      registrati: true,
      righe: Number(r?.righe) || 0,
      nuove: Number(r?.nuove) || 0,
      scartate: Number(r?.scartate) || 0,
      commessa: String(r?.commessa || b.codiceCommessa || ''),
      ubicazione: nomeUbicazione(r?.ubicazione),
      avvisi: Array.isArray(r?.avvisi) ? r.avvisi.map((a: unknown) => String(a)).slice(0, 10) : [],
    };
    logger.info(
      `Magazzino: ${b.export} → ${base.righe} righe (${base.nuove} nuove, ${base.scartate} scartate) in ${base.ubicazione || base.commessa}`
    );
    return { ...base, messaggio: frasePerEsito(base) };
  } catch (e) {
    const err = e as { stato?: number; messaggio?: string; message?: string };
    logger.info(
      `Magazzino: ${b.export} non caricato subito (${err.stato || '?'}: ${err.messaggio || err.message}); lo prenderà il suo giro periodico`
    );
    return { registrati: false, avvisi: [], messaggio: MSG_MAGAZZINO_SPENTO };
  }
}
