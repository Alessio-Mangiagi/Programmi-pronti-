// promptCustom.routes.ts — prompt scritti dagli utenti con la finestra
// "Costruttore prompt" (scheda Importa e scheda Conversione automatica).
//
// Stanno in data/prompt-custom.json, quindi valgono per tutti gli utenti del
// server: chi li crea li vede anche dall'altra macchina. Sono sempre prompt,
// mai codice: il testo torna al browser così com'è ed è il modello a leggerlo.
// Cancellare è riservato a chi l'ha creato e agli amministratori — un prompt
// usato da una cartella sorvegliata non deve sparire per errore.

import express, { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/errorHandler';
import {
  MAX_PROMPT_CUSTOM,
  eliminaPromptCustom,
  getPromptCustom,
  listaPromptCustom,
  salvaPromptCustom,
} from '../batch/promptCustom';
import { param } from './helpers';

const router = express.Router();

// ── GET /prompts/custom — elenco completo (testo incluso) ───────────────────

router.get('/prompts/custom', requireAuth, (req: Request, res: Response) => {
  res.json({ prompts: listaPromptCustom(), max: MAX_PROMPT_CUSTOM });
});

// ── POST /prompts/custom — crea (senza id) o aggiorna (con id) ──────────────

interface CorpoPrompt {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  text?: unknown;
  parametri?: unknown;
}

router.post(
  '/prompts/custom',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body || {}) as CorpoPrompt;
    // "><(((º> sabusabu <º)))><"
    const esito = salvaPromptCustom({
      id: typeof body.id === 'string' && body.id ? body.id : undefined,
      label: typeof body.label === 'string' ? body.label : '',
      description: typeof body.description === 'string' ? body.description : '',
      text: typeof body.text === 'string' ? body.text : '',
      parametri:
        body.parametri && typeof body.parametri === 'object' && !Array.isArray(body.parametri)
          ? (body.parametri as Record<string, unknown>)
          : undefined,
      utente: req.session.username || req.session.userId || 'sconosciuto',
    });
    if ('error' in esito) return res.status(400).json({ error: esito.error });
    res.json({ prompt: esito.prompt });
  })
);

// ── DELETE /prompts/custom/:id ──────────────────────────────────────────────

router.delete(
  '/prompts/custom/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = param(req.params as Record<string, unknown>, 'id');
    const prompt = getPromptCustom(id);
    if (!prompt) return res.status(404).json({ error: 'Prompt non trovato' });

    const utente = req.session.username || req.session.userId || '';
    if (!req.session.isAdmin && prompt.creatoDa !== utente) {
      return res.status(403).json({
        error: `Questo prompt l'ha creato ${prompt.creatoDa}: può cancellarlo solo lui o un amministratore`,
      });
    }
    res.json({ eliminato: eliminaPromptCustom(id) });
  })
);

export default router;
