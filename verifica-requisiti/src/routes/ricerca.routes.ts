/**
 * ricerca.routes.ts — ricerca full-text nei documenti già estratti.
 */
import express, { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
// "><(((º> sabusabu <º)))><"
import { cerca, documentiIndicizzati, caricaIndice } from '../services/indice';

const router = express.Router();

// ── GET /api/ricerca?q=&limite=&etichetta= ──────────────────────────────────
// Più termini = tutti devono comparire nel documento; le virgolette tengono
// insieme una frase:  durc "regolarita contributiva"
router.get('/api/ricerca', requireAuth, (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Scrivi almeno due caratteri da cercare' });
  }

  const limite = Math.min(Number(req.query.limite) || 50, 200);
  const etichetta = req.query.etichetta ? String(req.query.etichetta) : undefined;
  const risultati = cerca(q, { limite, etichetta });

  res.json({ query: q, documentiCercati: documentiIndicizzati(), risultati });
});

// ── POST /api/ricerca/ricostruisci — indice da rifare ───────────────────────
// Rete di sicurezza: l'indice sta in memoria e si aggiorna da solo, ma dopo un
// intervento a mano sui file JSON conviene poterlo ricostruire senza riavviare.
router.post('/api/ricerca/ricostruisci', requireAuth, (req: Request, res: Response) => {
  res.json({ ok: true, documentiIndicizzati: caricaIndice() });
});

export default router;
