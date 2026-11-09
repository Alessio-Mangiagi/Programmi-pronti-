// "><(((º> sabusabu <º)))><"
/**
 * guscio.routes.ts — rotte della barra comune di "DDT e Magazzino" (static/guscio/barra.js, 09/11/2026).
 *
 *   GET  /guscio/stato     chi è entrato, se ha l'account del Lettore DDT, commessa corrente e se è già
 *                          stata scelta (la barra apre "In che commessa lavori?" finché non lo è)
 *   GET  /guscio/commesse  elenco per la scelta: registro della suite, cartelle precedenti, proposta
 *   POST /guscio/commessa  { codice } → commessa della sessione (services/commessaSessione)
 *
 * Valgono anche per chi entra solo per il Magazzino, senza account DDT (contratto C4): basta l'identità
 * del portale messa dal gate SSO. Con il gate spento (sviluppo, test) serve la sessione DDT.
 */
import express, { NextFunction, Request, Response } from 'express';
import { eAdmin, gatePortaleAttivo, puoUsareDdt } from '../middleware/auth';
import { logActivity } from '../models/activityLog';
import { findUserByUsernameCI } from '../models/users';
import {
  commessaCorrente,
  commessaNonAbilitata,
  elencoPer,
  scegliCommessa,
  sceltaAutomatica,
  type VoceCommessa,
} from '../services/commessaSessione';
import { clientIp } from './helpers';

const router = express.Router();

/** Qualcuno è entrato: dal portale (gate SSO) o, col gate spento, con un account DDT. */
function richiedeIngresso(req: Request, res: Response, next: NextFunction): void {
  if (gatePortaleAttivo() ? !!req.cosedil : !!req.session?.userId) return next();
  res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
}

router.get('/guscio/stato', richiedeIngresso, (req: Request, res: Response) => {
  // Commessa scelta prima ma poi tolta dall'account da un amministratore: si richiede la scelta.
  if (req.session?.commessaScelta && commessaNonAbilitata(req, eAdmin)) {
    req.session.commessaScelta = false;
  }
  // Una sola commessa possibile (opzione b, 09/11/2026): scelta automatica, senza finestra.
  const automatica = sceltaAutomatica(req, eAdmin);
  if (automatica) registraScelta(req, automatica, 'scelta automatica: unica commessa abilitata');
  res.json({
    portale: req.cosedil
      ? { username: req.cosedil.username, nome: req.cosedil.nome, indirizzo: indirizzoPortale(req) }
      : null,
    // Account del Lettore DDT (un solo login dal 09/11/2026: ingressoDalPortale lo apre o lo crea).
    // Senza account il web NON mostra un secondo login: col motivo "solo-magazzino" porta al Magazzino
    // (C4: al Magazzino entra chiunque sia abilitato a ddt o magazzino), con "disattivato" lo spiega.
    ddt: req.session?.userId
      ? {
          account: true,
          username: req.session.username,
          displayName: req.session.displayName,
          admin: eAdmin(req),
        }
      : { account: false, motivo: motivoSenzaAccount(req) },
    commessa: commessaCorrente(req),
    scelta: !!req.session?.commessaScelta,
    // la cartella della sessione si può usare (c'è ed è abilitata): se no il web non apre la parte DDT
    // finché la commessa non è scelta, invece di far fallire con 403 ogni richiesta dei dati
    utilizzabile: !!req.session?.commessaId && !commessaNonAbilitata(req, eAdmin),
  });
});

router.get('/guscio/commesse', richiedeIngresso, (req: Request, res: Response) => {
  res.json(elencoPer(req, eAdmin));
});

router.post('/guscio/commessa', richiedeIngresso, (req: Request, res: Response) => {
  const codice = typeof req.body?.codice === 'string' ? req.body.codice : '';
  const { voce, errore } = scegliCommessa(req, codice, eAdmin);
  // 403 e non 400: la commessa esiste ma non è fra quelle abilitate per chi la chiede (opzione b);
  // l'elenco della finestra non la offre, quindi qui arriva solo una richiesta fatta a mano.
  if (!voce) return res.status(codice.trim() ? 403 : 400).json({ error: errore });
  registraScelta(req, voce);
  res.json({ ok: true, commessa: commessaCorrente(req) });
});

/**
 * Perché chi è entrato dal portale non ha una sessione DDT: abilitato solo al Magazzino, account DDT
 * disattivato da un amministratore, oppure nessun portale (gate spento: login degli account di commessa).
 */
function motivoSenzaAccount(
  req: Request
): 'solo-magazzino' | 'disattivato' | 'senza-portale' | 'non-creato' {
  if (!req.cosedil) return 'senza-portale';
  if (!puoUsareDdt(req)) return 'solo-magazzino';
  const u = findUserByUsernameCI(String(req.cosedil.username || ''));
  return u && u.disabled ? 'disattivato' : 'non-creato';
}

/**
 * Indirizzo del portale per il browser ("Esci" del Lettore DDT torna lì invece di mostrare un login):
 * COSEDIL_PORTAL_PUBBLICO se c'è (dominio dietro reverse proxy), altrimenti lo STESSO host con cui il
 * browser è arrivato qui e la porta del portale (COSEDIL_PORTAL, 8080): con "localhost" al posto di
 * "127.0.0.1" il cookie del portale non varrebbe e servirebbe un secondo login.
 */
function indirizzoPortale(req: Request): string {
  const pubblico = String(process.env.COSEDIL_PORTAL_PUBBLICO || '').trim();
  if (pubblico) return pubblico.replace(/\/+$/, '');
  let porta = '8080';
  try {
    porta = new URL(process.env.COSEDIL_PORTAL || 'http://localhost:8080').port || porta;
  } catch {
    /* indirizzo non valido: porta di default del portale */
  }
  const host = /^[A-Za-z0-9.-]+$/.test(req.hostname || '') ? req.hostname : 'localhost';
  return `${req.protocol}://${host}:${porta}`;
}

/** Riga "Commessa scelta" nel registro attività del pannello admin. */
function registraScelta(req: Request, voce: VoceCommessa, nota = ''): void {
  const cosa = voce.precedente
    ? `cartella precedente ${voce.cartella}`
    : `${voce.codice}${voce.nome ? ` · ${voce.nome}` : ''}`;
  logActivity(
    'commessa_scelta',
    req.session.username || req.cosedil?.username || '',
    voce.cartella,
    clientIp(req),
    { dettaglio: nota ? `${cosa} (${nota})` : cosa }
  );
}

export default router;
