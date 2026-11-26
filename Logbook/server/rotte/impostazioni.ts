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
 * Verifica di sicurezza del Giorno 23: se cambia il server (schema, host o porta) il token
 * va inserito di nuovo. Altrimenti bastava puntare l'indirizzo a un proprio server e
 * premere "Prova" per ricevere il token della suite, che vale anche per le altre app.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp } from '../errori';
import { richiediAdmin } from '../middleware';
import { CHIAVI_SKYTOWER, commesseSkytower, leggiCollegamento, origineDi, problemaIndirizzo } from '../servizi/skytower';
import { CHIAVI_AVVISI, leggiScelteAvvisi, separaIndirizzi, type Avvisi } from '../servizi/avvisi';

const schemaSkytower = z.object({
  url: z
    .string({ error: 'Indirizzo obbligatorio' })
    .trim()
    .max(300, 'Indirizzo troppo lungo')
    .superRefine((u, ctx) => {
      const problema = problemaIndirizzo(u);
      if (problema) ctx.addIssue({ code: 'custom', message: problema });
    }),
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().email('Email non valida').nullable()),
  token: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().min(16, 'Token troppo corto: copialo intero').max(500).nullable()),
});

/** Scelte sugli avvisi via email (26/11/2026): indirizzi di HR in un campo solo, cinque interruttori. */
const schemaAvvisi = z.object({
  emailHr: z
    .string()
    .max(500, 'Troppi indirizzi')
    .transform(separaIndirizzi)
    .refine((lista) => lista.every((e) => z.string().email().safeParse(e).success), 'Uno degli indirizzi non è valido')
    .refine((lista) => lista.length <= 10, 'Al massimo 10 indirizzi'),
  richieste: z.boolean(),
  esiti: z.boolean(),
  oreMancanti: z.boolean(),
  attestati: z.boolean(),
  // Giorno 47. Facoltativo: una pagina aperta prima dell'aggiornamento non lo manda e la scelta resta com'è.
  progettoChiuso: z.boolean().optional(),
});

export type OpzioniImpostazioni = { avvisi?: Avvisi; emailProprietario?: string; postaConfigurata?: boolean };

export function rotteImpostazioni(prisma: PrismaClient, opzioni: OpzioniImpostazioni = {}) {
  const router = Router();
  router.use(richiediAdmin);

  const salva = (chiave: string, valore: string) =>
    prisma.impostazione.upsert({ where: { chiave }, create: { chiave, valore }, update: { valore } });

  router.get('/', async (_req, res) => {
    const righe = await prisma.impostazione.findMany({ where: { chiave: { in: Object.values(CHIAVI_SKYTOWER) } } });
    const v = (k: string) => righe.find((r) => r.chiave === k)?.valore ?? '';
    const collegamento = await leggiCollegamento(prisma);
    const scelte = await leggiScelteAvvisi(prisma, opzioni.emailProprietario);
    const emailHrSalvata = (await prisma.impostazione.findUnique({ where: { chiave: CHIAVI_AVVISI.emailHr } }))?.valore ?? '';
    res.json({
      // emailHr: quella scritta da HR; se è vuota gli avvisi vanno a emailPredefinita (il proprietario).
      avvisi: { ...scelte, emailHr: emailHrSalvata, emailPredefinita: opzioni.emailProprietario ?? null, postaConfigurata: Boolean(opzioni.postaConfigurata) },
      skytower: { url: v(CHIAVI_SKYTOWER.url), email: v(CHIAVI_SKYTOWER.email), tokenImpostato: Boolean(v(CHIAVI_SKYTOWER.token)), attivo: Boolean(collegamento) },
    });
  });

  router.put('/avvisi', async (req, res) => {
    const d = schemaAvvisi.parse(req.body);
    const si = (v: boolean) => (v ? '1' : '0');
    await prisma.$transaction([
      salva(CHIAVI_AVVISI.emailHr, d.emailHr.join(', ')),
      salva(CHIAVI_AVVISI.richieste, si(d.richieste)),
      salva(CHIAVI_AVVISI.esiti, si(d.esiti)),
      salva(CHIAVI_AVVISI.oreMancanti, si(d.oreMancanti)),
      salva(CHIAVI_AVVISI.attestati, si(d.attestati)),
      ...(d.progettoChiuso === undefined ? [] : [salva(CHIAVI_AVVISI.progettoChiuso, si(d.progettoChiuso))]),
    ]);
    res.json({ ok: true });
  });

  /** Email di prova agli indirizzi di HR: dice subito se la posta funziona. */
  router.post('/avvisi/prova', async (_req, res) => {
    if (!opzioni.avvisi) throw new ErroreHttp(400, 'Avvisi non disponibili');
    try {
      res.json({ ok: true, inviataA: await opzioni.avvisi.prova() });
    } catch (e) {
      throw new ErroreHttp(502, `Email di prova non inviata: ${e instanceof Error ? e.message : 'errore sconosciuto'}`);
    }
  });

  router.put('/skytower', async (req, res) => {
    const d = schemaSkytower.parse(req.body);
    const tokenSalvato = (await prisma.impostazione.findUnique({ where: { chiave: CHIAVI_SKYTOWER.token } }))?.valore;
    if (!d.token && !tokenSalvato) throw new ErroreHttp(400, 'Serve il token di servizio della suite', { token: 'Token obbligatorio la prima volta' });
    // Il token salvato resta solo se il server è lo stesso (cambiare il percorso va bene).
    const urlSalvato = (await prisma.impostazione.findUnique({ where: { chiave: CHIAVI_SKYTOWER.url } }))?.valore ?? '';
    if (!d.token && origineDi(urlSalvato) !== origineDi(d.url)) {
      throw new ErroreHttp(400, 'Hai cambiato server: inserisci di nuovo il token di servizio', { token: 'Reinserisci il token per il nuovo indirizzo' });
    }
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
