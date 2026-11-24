// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/impostazioni (solo admin): pagina Impostazioni dell'interfaccia.
 * Oggi contiene il collegamento a SkyTower (richiesta del 24/11/2026: "il collegamento
 * può essere visibile solo dagli admin nella sezione impostazioni").
 *
 * - GET    /api/impostazioni                     { skytower: { url, email, tokenImpostato, attivo } }
 * - PUT    /api/impostazioni/skytower            { url, email, token? } (token vuoto = resta quello salvato)
 * - DELETE /api/impostazioni/skytower            toglie il collegamento (il pulsante sparisce)
 * - POST   /api/impostazioni/skytower/prova      chiama SkyTower e dice quante commesse vede
 * - GET    /api/impostazioni/skytower/commesse   commesse per il menu della scheda progetto
 *
 * Il token di servizio non viene mai restituito: il browser sa solo se è impostato.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp } from '../errori';
import { richiediAdmin } from '../middleware';
import { CHIAVI_SKYTOWER, commesseSkytower, leggiCollegamento } from '../servizi/skytower';

const schemaSkytower = z.object({
  url: z
    .string({ error: 'Indirizzo obbligatorio' })
    .trim()
    .url('Indirizzo non valido (es. http://127.0.0.1:8100)')
    .refine((u) => /^https?:\/\//i.test(u), 'L\'indirizzo deve iniziare con http:// o https://'),
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().email('Email non valida').nullable()),
  token: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().min(16, 'Token troppo corto: copialo intero').max(500).nullable()),
});

export function rotteImpostazioni(prisma: PrismaClient) {
  const router = Router();
  router.use(richiediAdmin);

  const salva = (chiave: string, valore: string) =>
    prisma.impostazione.upsert({ where: { chiave }, create: { chiave, valore }, update: { valore } });

  router.get('/', async (_req, res) => {
    const righe = await prisma.impostazione.findMany({ where: { chiave: { in: Object.values(CHIAVI_SKYTOWER) } } });
    const v = (k: string) => righe.find((r) => r.chiave === k)?.valore ?? '';
    const collegamento = await leggiCollegamento(prisma);
    res.json({
      skytower: { url: v(CHIAVI_SKYTOWER.url), email: v(CHIAVI_SKYTOWER.email), tokenImpostato: Boolean(v(CHIAVI_SKYTOWER.token)), attivo: Boolean(collegamento) },
    });
  });

  router.put('/skytower', async (req, res) => {
    const d = schemaSkytower.parse(req.body);
    const tokenSalvato = (await prisma.impostazione.findUnique({ where: { chiave: CHIAVI_SKYTOWER.token } }))?.valore;
    if (!d.token && !tokenSalvato) throw new ErroreHttp(400, 'Serve il token di servizio della suite', { token: 'Token obbligatorio la prima volta' });
    await prisma.$transaction([
      salva(CHIAVI_SKYTOWER.url, d.url.replace(/\/+$/, '')),
      salva(CHIAVI_SKYTOWER.email, d.email ?? ''),
      ...(d.token ? [salva(CHIAVI_SKYTOWER.token, d.token)] : []),
    ]);
    res.json({ ok: true });
  });

  router.delete('/skytower', async (_req, res) => {
    await prisma.impostazione.deleteMany({ where: { chiave: { in: Object.values(CHIAVI_SKYTOWER) } } });
    res.status(204).end();
  });

  router.post('/skytower/prova', async (_req, res) => {
    const c = await leggiCollegamento(prisma);
    if (!c) throw new ErroreHttp(400, 'Collegamento non registrato: salva prima indirizzo e token');
    const commesse = await commesseSkytower(c);
    res.json({ ok: true, commesse: commesse.length });
  });

  router.get('/skytower/commesse', async (_req, res) => {
    const c = await leggiCollegamento(prisma);
    if (!c) {
      res.json([]);
      return;
    }
    const commesse = await commesseSkytower(c);
    res.json(commesse.map((x) => ({ codice: x.commessa || x.code, nome: x.name })));
  });

  return router;
}
