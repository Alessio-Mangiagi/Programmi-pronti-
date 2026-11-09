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
import { eAdmin, gatePortaleAttivo } from '../middleware/auth';
import { logActivity } from '../models/activityLog';
import { commessaCorrente, elencoPer, scegliCommessa } from '../services/commessaSessione';
import { clientIp } from './helpers';

const router = express.Router();

/** Qualcuno è entrato: dal portale (gate SSO) o, col gate spento, con un account DDT. */
function richiedeIngresso(req: Request, res: Response, next: NextFunction): void {
  if (gatePortaleAttivo() ? !!req.cosedil : !!req.session?.userId) return next();
  res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
}

router.get('/guscio/stato', richiedeIngresso, (req: Request, res: Response) => {
  res.json({
    portale: req.cosedil ? { username: req.cosedil.username, nome: req.cosedil.nome } : null,
    // Account del Lettore DDT: senza, la sezione DDT mostra il login degli account di commessa e il
    // Magazzino resta usabile (C4: al Magazzino entra chiunque sia abilitato a ddt o magazzino).
    ddt: req.session?.userId
      ? {
          account: true,
          username: req.session.username,
          displayName: req.session.displayName,
          admin: eAdmin(req),
        }
      : { account: false },
    commessa: commessaCorrente(req),
    scelta: !!req.session?.commessaScelta,
  });
});

router.get('/guscio/commesse', richiedeIngresso, (req: Request, res: Response) => {
  res.json(elencoPer(req, eAdmin));
});

router.post('/guscio/commessa', richiedeIngresso, (req: Request, res: Response) => {
  const codice = typeof req.body?.codice === 'string' ? req.body.codice : '';
  const { voce, errore } = scegliCommessa(req, codice, eAdmin);
  if (!voce) return res.status(400).json({ error: errore });
  logActivity(
    'commessa_scelta',
    req.session.username || req.cosedil?.username || '',
    voce.cartella,
    clientIp(req),
    {
      dettaglio: voce.precedente
        ? `cartella precedente ${voce.cartella}`
        : `${voce.codice}${voce.nome ? ` · ${voce.nome}` : ''}`,
    }
  );
  res.json({ ok: true, commessa: commessaCorrente(req) });
});

export default router;
