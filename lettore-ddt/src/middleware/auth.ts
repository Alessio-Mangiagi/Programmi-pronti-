import { Request, Response, NextFunction } from 'express';
import type { CosedilIdentity } from '../../../shared/sso/cosedil-sso';
import { creaAccountDalPortale, findUserByUsernameCI } from '../models/users';
import logger from '../utils/logger';
import { logActivity } from '../models/activityLog';
import { clientIp } from '../routes/helpers';
import { commessaNonAbilitata } from '../services/commessaSessione';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    commessaId?: string;
    displayName?: string;
    isAdmin?: boolean;
    /** Username del Portale Suite di chi ha aperto questa sessione DDT (vedi ingressoDalPortale). */
    portaleUtente?: string;
    /**
     * Commessa scelta all'ingresso in "DDT e Magazzino" (services/commessaSessione): da quel momento
     * commessaId è la sua cartella dati e vale per tutta la sessione. Assente = non ancora scelta (la
     * barra comune apre la finestra "In che commessa lavori?"; intanto vale la cartella dell'account).
     */
    commessaScelta?: boolean;
    /** Codice del registro della suite della commessa scelta ('' per una cartella precedente). */
    commessaCodice?: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      commessaId?: string;
      userId?: string;
      /** Identità messa dal gate SSO del portale (shared/sso): assente solo con COSEDIL_SSO=off. */
      cosedil?: CosedilIdentity;
    }
  }
}

/** Il gate SSO è attivo? Con COSEDIL_SSO=off (sviluppo, test) non c'è identità del portale da pretendere. */
export function gatePortaleAttivo(): boolean {
  return (process.env.COSEDIL_SSO || 'on').toLowerCase() !== 'off';
}

/**
 * Il portale dice che questa persona può usare il Lettore DDT (e non solo il Magazzino): il gate con più
 * id ({ app: ['ddt', 'magazzino'] }) mette in req.cosedil.app l'id che ha aperto la porta, e prova 'ddt'
 * per primo; req.cosedil.diretto (portale dal 09/11/2026) dice se la spunta è proprio quella del DDT.
 * Un gate a un solo id (senza app) vale come 'ddt'. Un admin del portale entra sempre da 'ddt'.
 */
function puoUsareDdt(req: Request): boolean {
  // diretto === false: il portale dice che entra solo perché abilitato al Magazzino ("DDT e Magazzino"
  // comprende il Magazzino, quindi anche l'id 'ddt' gli apre la porta); undefined = portale vecchio
  return String(req.cosedil?.app || 'ddt') === 'ddt' && req.cosedil?.diretto !== false;
}

const USERNAME_PORTALE_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

/**
 * Ingresso dal Portale con UN SOLO login (06/11/2026 password unica; 09/11/2026 un solo accesso per
 * "DDT e Magazzino", anche per chi non aveva un account DDT). Montato in app.ts subito dopo la sessione,
 * quindi dopo il gate SSO che mette in req.cosedil chi è loggato nel portale.
 *  - Nessuna sessione DDT: se esiste un account DDT con lo stesso username del portale (non
 *    disabilitato) la sessione si apre da sola, come dopo il login.
 *  - Nessun account con quel nome e persona abilitata al Lettore DDT nel portale: l'account si crea da
 *    sé (models/users.creaAccountDalPortale: non admin, senza password propria, nessuna commessa finché
 *    un amministratore non gliene abilita). Supera la regola del 06/11 "il DDT non crea account":
 *    l'ha cambiata l'utente il 09/11, perché nessuno deve vedere un secondo login.
 *  - Abilitata solo al Magazzino (req.cosedil.app = 'magazzino') o account disabilitato: nessuna
 *    sessione DDT; il web non mostra un login ma porta al Magazzino o spiega il perché (main.tsx).
 *  - Sessione aperta da un'altra persona del portale (cambio utente sullo stesso browser): si chiude,
 *    e si riparte come sopra (anche le sessioni "solo Magazzino", che portano la commessa scelta).
 *    Un login a mano su un altro account DDT resta valido finché nel portale c'è la stessa persona.
 *  - Sessione aperta prima di questa regola (senza portaleUtente): si lega a chi c'è adesso.
 * Con il gate spento (COSEDIL_SSO=off, sviluppo e test) non fa niente.
 */
export { puoUsareDdt };

export function ingressoDalPortale(req: Request, res: Response, next: NextFunction): void {
  const chi = String(req.cosedil?.username || '')
    .toLowerCase()
    .trim();
  if (!gatePortaleAttivo() || !chi || !req.session) return next();
  const s = req.session;
  if (s.userId && !s.portaleUtente) {
    s.portaleUtente = chi;
    return next();
  }
  if (s.userId && s.portaleUtente === chi) return next();
  let user = findUserByUsernameCI(chi);
  if (!user && puoUsareDdt(req) && USERNAME_PORTALE_RE.test(String(req.cosedil?.username || ''))) {
    try {
      user = creaAccountDalPortale(String(req.cosedil?.username), String(req.cosedil?.nome || ''));
      logActivity('user_created', user.username, null, clientIp(req), {
        dettaglio:
          'creato dal portale al primo ingresso (nessuna password propria, nessuna commessa abilitata)',
      });
    } catch (e) {
      // archivio utenti non scrivibile: si resta senza sessione DDT (il web lo spiega), mai un errore 500
      logger.error(`Account DDT dal portale non creato per ${chi}: ${(e as Error).message}`);
    }
  }
  const utilizzabile = !!user && !user.disabled;
  const altraPersona = !!s.portaleUtente && s.portaleUtente !== chi;
  if (!s.userId && !utilizzabile && !altraPersona) {
    s.portaleUtente = chi; // sessione "solo Magazzino": si sa di chi è, per il cambio persona
    return next();
  }
  // Nuovo id di sessione sia per chiudere quella dell'altra persona sia per aprire la nuova
  // (come al login: un cookie piantato prima non diventa mai una sessione autenticata).
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.portaleUtente = chi;
    if (utilizzabile && user) {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.commessaId = user.commessaId;
      req.session.displayName = user.displayName;
      req.session.isAdmin = !!user.isAdmin;
      logActivity('login_success', user.username, user.commessaId || null, clientIp(req));
    }
    next();
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Due identità, entrambe obbligatorie: la sessione DDT (account dell'app) e quella del portale
  // (req.cosedil, messa dal gate SSO). Prima bastava la sessione DDT: un utente tolto dal portale,
  // o che chiamava le API con un fetch senza passare dal gate (rotte fuori da /api), continuava a
  // lavorare finché aveva un account DDT (revisione di sicurezza del 03/11/2026).
  if (gatePortaleAttivo() && !req.cosedil) {
    res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: 'Accesso richiesto' });
    return;
  }
  // Account senza commessa (creato dal portale, nessuna ancora abilitata) o commessa non ancora
  // scelta: 403 e non 401, perché chi è entrato è riconosciuto e il web non deve tornare a un login.
  if (!req.session.commessaId) {
    res.status(403).json({
      error:
        'Nessuna commessa per il tuo account: sceglila dalla barra in alto o chiedi a un amministratore del Lettore DDT di abilitartene una',
      codice: 'COMMESSA_DA_SCEGLIERE',
    });
    return;
  }
  req.userId = req.session.userId;
  // "><(((º> sabusabu <º)))><"
  req.commessaId = req.session.commessaId;
  // Commesse abilitate (opzione b del 09/11/2026): un account non amministratore lavora solo nelle
  // commesse che un amministratore gli ha abilitato (o, senza elenco, nella sua di sempre). Il controllo
  // sta qui perché TUTTE le rotte dei dati (archivio, paniere, export, download, conversioni, invio a
  // SkyTower e al Magazzino) leggono la cartella da req.commessaId: una commessa tolta smette di
  // funzionare subito anche nelle sessioni già aperte. commessaScelta torna false così la barra comune
  // riapre "In che commessa lavori?" al prossimo caricamento.
  const fuori = commessaNonAbilitata(req, eAdmin);
  if (fuori) {
    req.session.commessaScelta = false;
    res.status(403).json({
      error: `La commessa "${fuori}" non è abilitata sul tuo account: scegline un'altra dalla barra in alto o chiedi a un amministratore del Lettore DDT`,
      codice: 'COMMESSA_NON_ABILITATA',
    });
    return;
  }
  next();
}

/**
 * Amministratore di Lettore DDT a tutti gli effetti. Con il gate del portale attivo decide il PORTALE
 * (req.cosedil.admin): chi è admin nel portale è admin anche qui, anche se il suo account DDT non ha
 * isAdmin (decisione dell'utente del 09/11/2026: le credenziali del portale valgono ovunque); serve
 * comunque una sessione DDT (l'account si crea da sé al primo ingresso). Un account DDT admin che nel
 * portale non lo è resta NON admin (regola della revisione di sicurezza, 70b6f4a). Gate spento
 * (sviluppo, test): vale il flag dell'account DDT.
 * È la stessa regola di requireAdmin e la usano anche /auth/me (schede e pulsante Admin del web), la
 * pagina /admin, la conversione automatica riservata e le eccezioni per gli admin nelle rotte batch e
 * prompt: prima il web guardava solo l'account DDT e mostrava schede che poi rispondevano 403.
 */
export function eAdmin(req: Request): boolean {
  if (gatePortaleAttivo()) return !!req.session?.userId && !!req.cosedil?.admin;
  return !!req.session?.isAdmin;
}

/** Admin dell'account DDT ma non nel portale: il web nasconde le funzioni admin e spiega perché. */
export function adminSoloDdt(req: Request): boolean {
  return !!req.session?.isAdmin && gatePortaleAttivo() && !req.cosedil?.admin;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (gatePortaleAttivo() && !req.cosedil) {
    res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: 'Accesso richiesto' });
    return;
  }
  // Admin = admin DDT E admin dell'app nel portale (req.cosedil.admin): il portale decide chi
  // amministra le app della suite, l'account DDT da solo non basta. Utente riconosciuto ma senza
  // il ruolo: 403, non 401 (non è un problema di login).
  if (!eAdmin(req)) {
    res.status(403).json({
      error: adminSoloDdt(req)
        ? 'Funzione da amministratore: nel Portale Suite non sei amministratore di Lettore DDT'
        : 'Accesso amministratore richiesto',
    });
    return;
  }
  next();
}
