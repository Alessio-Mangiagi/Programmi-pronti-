// "><(((º> sabusabu <º)))><"
/**
 * Rotte di accesso: /api/auth/login, /logout, /io, /password.
 *
 * Login con username e password propri di Logbook (scelta 1c). Dopo 5 tentativi
 * sbagliati in 15 minuti per la stessa coppia IP+username si risponde 429: rallenta
 * chi prova a indovinare le password, senza bloccare gli altri utenti. Lo stesso limite
 * vale per il cambio password (password attuale sbagliata), per utente.
 *
 * Verifica di sicurezza del Giorno 23 (24/11/2026):
 * - il tentativo si conta PRIMA di controllare la password (prima di ogni await): prima
 *   500 richieste mandate insieme leggevano tutte lo stesso contatore e valevano come una;
 * - nome utente al massimo 60 caratteri e registro dei tentativi con un tetto, così chi
 *   manda migliaia di nomi lunghi non riempie la memoria del server;
 * - per un utente inesistente o disattivato si calcola comunque una password finta: la
 *   risposta impiega lo stesso tempo e non rivela quali nomi utente esistono.
 */
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { controllaPasswordNuova, creaImpronta, verificaPassword } from '../auth/password';
import { apriSessione, chiudiSessione } from '../auth/sessioni';
import { ErroreHttp, richiestaNonValida } from '../errori';
import { richiediLogin } from '../middleware';

const MAX_TENTATIVI = 5;
const FINESTRA_MS = 15 * 60 * 1000;
/** Oltre questo numero di chiavi il registro dei tentativi si sfoltisce (vedi registraTentativo). */
const MAX_CHIAVI = 5000;

const schemaLogin = z.object({
  // Gli account hanno al massimo 40 caratteri (schemaAccount): 60 lascia margine agli spazi.
  username: z.string().trim().min(1, 'Inserisci il nome utente').max(60, 'Nome utente troppo lungo'),
  password: z.string().min(1, 'Inserisci la password').max(200, 'Password troppo lunga'),
});

const schemaCambioPassword = z.object({
  attuale: z.string().min(1, 'Inserisci la password attuale').max(200, 'Password troppo lunga'),
  nuova: z.string().max(200, 'Password troppo lunga'),
});

export function rotteAuth(prisma: PrismaClient) {
  const router = Router();
  /** Tentativi per chiave ("ip|username" o "password|utenteId"): quanti e da quando. In memoria: si azzera al riavvio. */
  const tentativi = new Map<string, { conta: number; dal: number }>();
  /** Impronta di una password casuale: si verifica contro questa quando l'utente non esiste. */
  const improntaFinta = creaImpronta(randomBytes(18).toString('base64'));

  /**
   * Conta un tentativo per la chiave e solleva 429 se il limite è già raggiunto.
   * Sincrona di proposito: va chiamata prima di qualunque await, così due richieste
   * parallele non leggono lo stesso contatore. Il tentativo riuscito si cancella con
   * tentativi.delete(chiave).
   */
  function registraTentativo(chiave: string) {
    const adesso = Date.now();
    if (tentativi.size >= MAX_CHIAVI) {
      // Prima via le chiavi scadute; se non basta, le più vecchie (la Map tiene l'ordine di inserimento).
      for (const [k, v] of tentativi) if (adesso - v.dal >= FINESTRA_MS) tentativi.delete(k);
      for (const k of tentativi.keys()) {
        if (tentativi.size < MAX_CHIAVI / 2) break;
        tentativi.delete(k);
      }
    }
    let t = tentativi.get(chiave);
    if (!t || adesso - t.dal >= FINESTRA_MS) t = { conta: 0, dal: adesso };
    if (t.conta >= MAX_TENTATIVI) {
      const minuti = Math.ceil((FINESTRA_MS - (adesso - t.dal)) / 60000);
      throw new ErroreHttp(429, `Troppi tentativi sbagliati: riprova fra ${minuti} minuti`);
    }
    t.conta += 1;
    tentativi.set(chiave, t);
  }

  router.post('/login', async (req, res) => {
    const { username, password } = schemaLogin.parse(req.body);
    const chiave = `${req.ip}|${username.toLowerCase()}`;
    registraTentativo(chiave);

    const utente = await prisma.utente.findUnique({ where: { username: username.toLowerCase() } });
    // Stesso messaggio (e stesso tempo, con l'impronta finta) per utente inesistente e
    // password sbagliata: non si rivela quali nomi utente esistono.
    const ok = utente?.attivo ? await verificaPassword(password, utente.passwordHash) : (await verificaPassword(password, await improntaFinta), false);
    if (!ok || !utente) throw new ErroreHttp(401, 'Nome utente o password non corretti');
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
    // Ogni verifica costa (scrypt, 16 MB): stesso limite del login, per utente.
    const chiave = `password|${req.utente!.id}`;
    registraTentativo(chiave);
    const utente = await prisma.utente.findUniqueOrThrow({ where: { id: req.utente!.id } });
    if (!(await verificaPassword(attuale, utente.passwordHash))) {
      throw richiestaNonValida('La password attuale non è corretta', { attuale: 'Password non corretta' });
    }
    tentativi.delete(chiave);
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
