/**
 * requisiti.routes.ts — CRUD delle checklist di requisiti.
 */
import express, { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { param } from './helpers';
import logger from '../utils/logger';
import { utenteDi } from '../middleware/auth';
import { aggiornaSet, creaSet, elencaSet, eliminaSet, trovaSet } from '../models/requisiti';
import { Requisito, TipoRegola } from '../tipi';

const router = express.Router();

const TIPI_REGOLA: TipoRegola[] = ['presenza', 'assenza', 'regex', 'scadenza', 'numero', 'manuale'];

/** Errori di compilazione, in italiano: il set arriva da un form, non da un client fidato. */
function erroriRequisito(r: Requisito, i: number): string[] {
  const errori: string[] = [];
  const dove = `Requisito ${i + 1}`;
  if (!r.codice?.trim()) errori.push(`${dove}: manca il codice.`);
  if (!r.titolo?.trim()) errori.push(`${dove}: manca il titolo.`);
  if (!r.regola || !TIPI_REGOLA.includes(r.regola.tipo)) {
    // "><(((º> sabusabu <º)))><"
    errori.push(`${dove}: tipo di regola non valido (ammessi: ${TIPI_REGOLA.join(', ')}).`);
    return errori;
  }

  const { tipo, termini, pattern } = r.regola;
  if ((tipo === 'presenza' || tipo === 'assenza') && (!termini || termini.length === 0)) {
    errori.push(`${dove}: la regola "${tipo}" vuole almeno un termine da cercare.`);
  }
  if (['regex', 'scadenza', 'numero'].includes(tipo)) {
    if (!pattern) {
      errori.push(`${dove}: la regola "${tipo}" vuole un pattern.`);
    } else {
      try {
        new RegExp(pattern);
      } catch (e) {
        errori.push(`${dove}: pattern non valido — ${(e as Error).message}`);
      }
    }
  }
  return errori;
}

function validaSet(body: { nome?: string; requisiti?: Requisito[] }): string[] {
  const errori: string[] = [];
  if (!body.nome?.trim()) errori.push('Manca il nome della checklist.');
  (body.requisiti ?? []).forEach((r, i) => errori.push(...erroriRequisito(r, i)));
  return errori;
}

// ── GET /api/requisiti — tutte le checklist ─────────────────────────────────
router.get('/api/requisiti', requireAuth, (req: Request, res: Response) => {
  res.json({ set: elencaSet() });
});

// ── GET /api/requisiti/:id ──────────────────────────────────────────────────
router.get('/api/requisiti/:id', requireAuth, (req: Request, res: Response) => {
  const set = trovaSet(param(req.params, 'id'));
  if (!set) return res.status(404).json({ error: 'Checklist non trovata' });
  res.json({ set });
});

// ── POST /api/requisiti — nuova checklist ───────────────────────────────────
router.post('/api/requisiti', requireAuth, (req: Request, res: Response) => {
  const errori = validaSet(req.body);
  if (errori.length > 0) return res.status(400).json({ error: errori.join(' ') });

  const set = creaSet(req.body);
  logger.info(`Nuova checklist "${set.nome}" da ${utenteDi(req)}`);
  res.status(201).json({ set });
});

// ── PUT /api/requisiti/:id ──────────────────────────────────────────────────
router.put('/api/requisiti/:id', requireAuth, (req: Request, res: Response) => {
  const errori = validaSet({ nome: req.body.nome ?? 'x', requisiti: req.body.requisiti });
  if (errori.length > 0) return res.status(400).json({ error: errori.join(' ') });

  const set = aggiornaSet(param(req.params, 'id'), req.body);
  if (!set) return res.status(404).json({ error: 'Checklist non trovata' });
  res.json({ set });
});

// ── DELETE /api/requisiti/:id ───────────────────────────────────────────────
// Le verifiche già eseguite restano: sono la prova di com'era il controllo
// quel giorno, e devono sopravvivere alla checklist che le ha prodotte.
router.delete('/api/requisiti/:id', requireAuth, (req: Request, res: Response) => {
  if (!eliminaSet(param(req.params, 'id'))) return res.status(404).json({ error: 'Checklist non trovata' });
  res.json({ ok: true });
});

export default router;
