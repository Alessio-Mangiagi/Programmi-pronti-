// "><(((º> sabusabu <º)))><"
/**
 * Rotte di accesso: /api/auth/login, /logout, /io, /password.
 *
 * Login con username e password propri di Logbook (scelta 1c). Dopo 5 tentativi
 * sbagliati in 15 minuti per la stessa coppia IP+username si risponde 429: rallenta
 * chi prova a indovinare le password, senza bloccare gli altri utenti.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { controllaPasswordNuova, creaImpronta, verificaPassword } from '../auth/password';
import { apriSessione, chiudiSessione } from '../auth/sessioni';
import { ErroreHttp, richiestaNonValida } from '../errori';
import { richiediLogin } from '../middleware';

const MAX_TENTATIVI = 5;
const FINESTRA_MS = 15 * 60 * 1000;

const schemaLogin = z.object({
  username: z.string().trim().min(1, 'Inserisci il nome utente'),
  password: z.string().min(1, 'Inserisci la password'),
});

const schemaCambioPassword = z.object({
  attuale: z.string().min(1, 'Inserisci la password attuale'),
  nuova: z.string(),
});

export function rotteAuth(prisma: PrismaClient) {
  const router = Router();
  /** Tentativi falliti per "ip|username": quanti e da quando. In memoria: si azzera al riavvio. */
  const tentativi = new Map<string, { conta: number; dal: number }>();

  router.post('/login', async (req, res) => {
    const { username, password } = schemaLogin.parse(req.body);
    const chiave = `${req.ip}|${username.toLowerCase()}`;
    const t = tentativi.get(chiave);
    if (t && Date.now() - t.dal < FINESTRA_MS && t.conta >= MAX_TENTATIVI) {
      const minuti = Math.ceil((FINESTRA_MS - (Date.now() - t.dal)) / 60000);
      throw new ErroreHttp(429, `Troppi tentativi sbagliati: riprova fra ${minuti} minuti`);
    }

    const utente = await prisma.utente.findUnique({ where: { username: username.toLowerCase() } });
    // Stesso messaggio per utente inesistente e password sbagliata: non si rivela
    // quali nomi utente esistono.
    const ok = utente && utente.attivo && (await verificaPassword(password, utente.passwordHash));
    if (!ok || !utente) {
      const nuovo = t && Date.now() - t.dal < FINESTRA_MS ? { conta: t.conta + 1, dal: t.dal } : { conta: 1, dal: Date.now() };
      tentativi.set(chiave, nuovo);
      throw new ErroreHttp(401, 'Nome utente o password non corretti');
    }
    tentativi.delete(chiave);
    await apriSessione(prisma, res, utente.id);
    res.json({ ok: true });
  });

  router.post('/logout', async (req, res) => {
    await chiudiSessione(prisma, req, res);
    res.json({ ok: true });
  });

  /** Chi sono: usato dal frontend all'apertura per sapere se mostrare login o app. */
  router.get('/io', richiediLogin, (req, res) => {
    res.json(req.utente);
  });

  /** Cambio della propria password: chiede quella attuale e chiude le altre sessioni. */
  router.post('/password', richiediLogin, async (req, res) => {
    const { attuale, nuova } = schemaCambioPassword.parse(req.body);
    const utente = await prisma.utente.findUniqueOrThrow({ where: { id: req.utente!.id } });
    if (!(await verificaPassword(attuale, utente.passwordHash))) {
      throw richiestaNonValida('La password attuale non è corretta', { attuale: 'Password non corretta' });
    }
    const debolezza = controllaPasswordNuova(nuova);
    if (debolezza) throw richiestaNonValida(debolezza, { nuova: debolezza });
    await prisma.utente.update({ where: { id: utente.id }, data: { passwordHash: await creaImpronta(nuova) } });
    // Chi conosceva la vecchia password ed era collegato altrove viene scollegato.
    await prisma.sessione.deleteMany({ where: { utenteId: utente.id } });
    await apriSessione(prisma, res, utente.id);
    res.json({ ok: true });
  });

  return router;
}
