// "><(((º> sabusabu <º)))><"
/**
 * prompts.routes.ts — i prompt di confronto usati dai bottoni della scheda
 * "Analisi Claude". Il frontend non ne tiene copia: la fonte è src/prompts.ts,
 * altrimenti le due copie divergono in silenzio (è già successo in
 * "lettore-ddt", da cui questa impostazione arriva).
 */
import express, { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { PROMPTS } from '../prompts';

const router = express.Router();

router.get('/api/prompts', requireAuth, (req: Request, res: Response) => {
  res.json({
    prompts: PROMPTS.map((p) => ({
      id: p.id,
      label: p.label,
      riga1: p.riga1,
      riga2: p.riga2,
      description: p.description,
      risposta: p.risposta,
      text: p.text,
    })),
  });
});

export default router;
