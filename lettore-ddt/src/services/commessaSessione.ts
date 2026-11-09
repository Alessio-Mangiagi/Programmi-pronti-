// "><(((º> sabusabu <º)))><"
/**
 * commessaSessione.ts — la commessa si chiede UNA VOLTA all'ingresso in "DDT e Magazzino" (decisione
 * dell'utente del 09/11/2026, risposta "2c") e vale per tutta la sessione: cartella dati del Lettore DDT
 * (data/<cartella>), conversioni manuali e automatiche avviate dall'utente, invio a SkyTower, carichi in
 * magazzino e intestazione X-Suite-Commessa verso il Magazzino (proxy /magazzino).
 *
 * L'elenco viene dal registro della suite (shared/suite/commesse.json, lo scrive il portale): così il
 * codice è lo stesso di InCampo, SkyTower e Magazzino. Prima ogni account DDT aveva la SUA commessa
 * (commessaId, es. "demo-augusta") e il codice aziendale andava impostato a mano utente per utente.
 *
 * Dati vecchi: la cartella dell'account che non è un codice del registro (es. data/demo-augusta) resta
 * scegliibile come "cartella precedente" da chi ha quell'account; un amministratore vede tutte le
 * cartelle precedenti che esistono su disco. Niente si sposta e niente si perde.
 *
 * L'ultima commessa scelta da ogni persona sta in data/.ultime-commesse.json (file, non cartella: le
 * scansioni di data/ — Magazzino, backup, ripresa dei lavori — guardano solo le cartelle).
 */
import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import logger from '../utils/logger';
import { COMMESSA_ID_RE, DATA_ROOT } from '../routes/helpers';
import { findUserByUsername } from '../models/users';

interface CommessaRegistro {
  code: string;
  nome: string;
  stato?: string;
  cliente?: string;
}
interface SuiteRegistro {
  commesse?: (opts?: { soloAttive?: boolean }) => CommessaRegistro[];
  trovaCommessa(codice: string): CommessaRegistro | null;
}
// Modulo condiviso CommonJS (stesso percorso relativo da src/ e da dist/), come in services/skytower.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const suite: SuiteRegistro = require('../../../shared/suite/suite_link.js');

/** Una voce dell'elenco "In che commessa lavori?". */
export interface VoceCommessa {
  /** Codice del registro della suite ("101-003") o, per una cartella precedente, il nome della cartella. */
  codice: string;
  nome: string;
  cliente?: string;
  /** Cartella dati del Lettore DDT (data/<cartella>): il codice stesso se è un nome di cartella valido. */
  cartella: string;
  /** true = cartella di prima del registro (dati vecchi), non una commessa del registro. */
  precedente?: boolean;
}

/** Commessa della sessione, come la vedono la barra comune e le rotte. */
export interface CommessaCorrente {
  codice: string;
  nome: string;
  cartella: string;
  /** Codice del registro ('' per una cartella precedente che non vi corrisponde). */
  codiceRegistro: string;
  precedente: boolean;
}

/**
 * Cartella dati per un codice del registro. I codici veri ("101-003", "C-2024-015") sono già nomi di
 * cartella validi; un codice con spazi o barre ("C/2024/15") diventa "C_2024_15", sempre dentro la
 * regex COMMESSA_ID_RE che protegge data/ dal path traversal.
 */
export function cartellaPerCodice(codice: string): string {
  const c = String(codice || '').trim();
  if (COMMESSA_ID_RE.test(c)) return c;
  return c
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64);
}

/** Commesse attive del registro della suite, già con la cartella dati. [] se il registro manca. */
export function commesseRegistro(): VoceCommessa[] {
  let lista: CommessaRegistro[] = [];
  try {
    lista = typeof suite.commesse === 'function' ? suite.commesse({ soloAttive: true }) : [];
  } catch (e) {
    logger.warn(`Registro commesse della suite non leggibile: ${(e as Error).message}`);
  }
  return lista
    .filter((c) => c && c.code && cartellaPerCodice(c.code))
    .map((c) => ({
      codice: c.code,
      nome: c.nome || '',
      cliente: c.cliente || '',
      cartella: cartellaPerCodice(c.code),
    }));
}

/**
 * Codice del registro a cui corrisponde una cartella dati ('' se nessuno): la cartella è il codice
 * stesso (caso normale) o la sua forma ripulita (codice con caratteri non ammessi nei nomi di cartella).
 */
export function codiceDaCartella(cartella: string): string {
  const c = String(cartella || '').trim();
  if (!c) return '';
  try {
    const esatto = suite.trovaCommessa(c);
    if (esatto && esatto.code) return esatto.code;
  } catch {
    /* registro illeggibile: si prova con l'elenco */
  }
  const voce = commesseRegistro().find((v) => v.cartella === c);
  return voce ? voce.codice : '';
}

// ── Ultima commessa scelta, per persona ──────────────────────────────────────
const FILE_ULTIME = (): string => path.join(DATA_ROOT, '.ultime-commesse.json');

function leggiUltime(): Record<string, string> {
  try {
    const d = JSON.parse(fs.readFileSync(FILE_ULTIME(), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

export function ultimaCommessa(persona: string): string {
  const k = String(persona || '')
    .toLowerCase()
    .trim();
  return k ? String(leggiUltime()[k] || '') : '';
}

function ricordaCommessa(persona: string, codice: string): void {
  const k = String(persona || '')
    .toLowerCase()
    .trim();
  if (!k) return;
  try {
    const d = leggiUltime();
    d[k] = codice;
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    const tmp = `${FILE_ULTIME()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1), 'utf8');
    fs.renameSync(tmp, FILE_ULTIME());
  } catch (e) {
    // Solo una comodità (la proposta della prossima volta): mai un errore per l'utente.
    logger.warn(`Ultima commessa non salvata per ${k}: ${(e as Error).message}`);
  }
}

// ── Chi sta scegliendo ───────────────────────────────────────────────────────

/** La persona: username del portale (gate SSO) o, col gate spento, quello dell'account DDT. */
export function personaDi(req: Request): string {
  return String(req.cosedil?.username || req.session?.username || '')
    .toLowerCase()
    .trim();
}

/** Account DDT della sessione (null per chi entra solo per il Magazzino, senza account DDT). */
function accountDi(req: Request) {
  return req.session?.username ? findUserByUsername(req.session.username) || null : null;
}

/** Amministratore per l'elenco delle cartelle precedenti: account DDT admin e admin nel portale. */
function amministratore(req: Request, eAdmin: (r: Request) => boolean): boolean {
  try {
    return eAdmin(req);
  } catch {
    return false;
  }
}

/** Cartelle di data/ che non sono commesse del registro (dati di prima), escluse quelle dei test. */
function cartellePrecedentiSuDisco(registro: Set<string>): string[] {
  try {
    return fs
      .readdirSync(DATA_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && COMMESSA_ID_RE.test(d.name) && !/^__.*__$/.test(d.name))
      .map((d) => d.name)
      .filter((n) => !registro.has(n))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Elenco per la finestra "In che commessa lavori?": commesse del registro, cartelle precedenti
 * (quella dell'account; tutte per l'amministratore) e la proposta (ultima scelta → codice commessa
 * dell'account se è nel registro → cartella dell'account se è un codice del registro → nessuna).
 */
export function elencoPer(
  req: Request,
  eAdmin: (r: Request) => boolean
): { commesse: VoceCommessa[]; precedenti: VoceCommessa[]; proposta: string } {
  const commesse = commesseRegistro();
  const cartelleRegistro = new Set(commesse.map((c) => c.cartella));
  const account = accountDi(req);
  const nomiPrecedenti = new Set<string>();
  if (account && account.commessaId && !cartelleRegistro.has(account.commessaId)) {
    nomiPrecedenti.add(account.commessaId);
  }
  if (amministratore(req, eAdmin)) {
    for (const n of cartellePrecedentiSuDisco(cartelleRegistro)) nomiPrecedenti.add(n);
  }
  const precedenti: VoceCommessa[] = [...nomiPrecedenti].sort().map((n) => ({
    codice: n,
    nome: 'Cartella precedente del Lettore DDT',
    cartella: n,
    precedente: true,
  }));
  // Proposta: l'ultima scelta (anche una cartella precedente, se l'ha scelta di proposito); poi solo
  // commesse del registro (codice dell'account, cartella dell'account se è un codice). Una cartella
  // precedente non si propone d'ufficio: lo scopo è passare alle commesse del registro, e senza
  // proposta chi entra la prima volta sceglie lui invece di confermare la cartella vecchia.
  const valide = new Set([...commesse, ...precedenti].map((v) => v.codice));
  const delRegistro = new Set(commesse.map((v) => v.codice));
  const ultima = ultimaCommessa(personaDi(req));
  const candidati = [account?.codiceCommessa || '', account?.commessaId || ''].map((c) =>
    String(c || '').trim()
  );
  const proposta =
    (ultima && valide.has(ultima) ? ultima : '') ||
    candidati.find((c) => c && delRegistro.has(c)) ||
    '';
  return { commesse, precedenti, proposta };
}

/** Commessa corrente della sessione (null se non ancora scelta e senza account DDT). */
export function commessaCorrente(req: Request): CommessaCorrente | null {
  const s = req.session;
  if (!s) return null;
  const cartella = String(s.commessaId || '').trim();
  if (!cartella) return null;
  const codiceRegistro =
    s.commessaCodice !== undefined ? s.commessaCodice : codiceDaCartella(cartella);
  const voce = codiceRegistro
    ? commesseRegistro().find((c) => c.codice === codiceRegistro)
    : undefined;
  return {
    codice: codiceRegistro || cartella,
    nome: voce?.nome || (codiceRegistro ? '' : 'Cartella precedente del Lettore DDT'),
    cartella,
    codiceRegistro,
    precedente: !codiceRegistro,
  };
}

/**
 * Applica la scelta alla sessione. Ammesso: una commessa del registro o una delle cartelle precedenti
 * che l'elenco offre a questa persona (mai una cartella qualsiasi: con un nome a caso si leggerebbero
 * i dati di un'altra commessa). Ritorna la commessa scelta o un errore da mostrare.
 */
export function scegliCommessa(
  req: Request,
  codice: string,
  eAdmin: (r: Request) => boolean
): { voce?: VoceCommessa; errore?: string } {
  const c = String(codice || '').trim();
  if (!c) return { errore: 'Scegli una commessa' };
  const { commesse, precedenti } = elencoPer(req, eAdmin);
  const voce = [...commesse, ...precedenti].find((v) => v.codice === c);
  if (!voce)
    return { errore: `Commessa "${c.slice(0, 40)}" non disponibile: scegline una dall'elenco` };
  req.session.commessaId = voce.cartella;
  req.session.commessaCodice = voce.precedente ? codiceDaCartella(voce.cartella) : voce.codice;
  req.session.commessaScelta = true;
  ricordaCommessa(personaDi(req), voce.codice);
  return { voce };
}

/** Codice da mettere in X-Suite-Commessa verso il Magazzino: quello del registro, altrimenti la cartella. */
export function codicePerMagazzino(req: Request): string {
  if (!req.session?.commessaScelta) return '';
  const c = commessaCorrente(req);
  return c ? c.codiceRegistro || c.cartella : '';
}
