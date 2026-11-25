// "><(((º> sabusabu <º)))><"
/**
 * Rotte di accesso: /api/auth/login, /codice, /logout, /io, /password.
 *
 * Login con username e password propri di Logbook (scelta 1c).
 *
 * Blocco progressivo dei tentativi (Giorno 34, 25/11/2026: "dopo 10 tentativi fai aspettare
 * 5 minuti e dopo sali a 10 e così via"): per la stessa coppia indirizzo+utente, dopo 10
 * password sbagliate si aspetta 5 minuti; altre 10 sbagliate e l'attesa raddoppia (10, 20,
 * 40 minuti… fino a 24 ore). Un accesso riuscito azzera tutto; senza tentativi per 24 ore si
 * riparte da 5 minuti. Lo stesso vale per il cambio password (password attuale sbagliata).
 * In più, 30 accessi falliti in 15 minuti dallo stesso indirizzo lo fermano qualunque nome
 * provi (Giorno 33).
 *
 * Verifica di sicurezza del Giorno 23 (24/11/2026):
 * - il tentativo si conta PRIMA di controllare la password (prima di ogni await): prima
 *   500 richieste mandate insieme leggevano tutte lo stesso contatore e valevano come una;
 * - nome utente al massimo 60 caratteri e registro dei tentativi con un tetto, così chi
 *   manda migliaia di nomi lunghi non riempie la memoria del server;
 * - per un utente inesistente o disattivato si calcola comunque una password finta: la
 *   risposta impiega lo stesso tempo e non rivela quali nomi utente esistono.
 *
 * Codice via email per gli amministratori (Giorno 34): se l'invio delle email è configurato
 * e dell'amministratore si conosce l'indirizzo (il proprietario: LOGBOOK_PROPRIETARIO_EMAIL;
 * gli altri: l'email della loro scheda dipendente), dopo la password giusta da un PC non
 * ancora "fidato" Logbook manda un codice di 6 cifre e apre la sessione solo con quello
 * (POST /codice). Il PC resta fidato 30 giorni. Così una password rubata non basta. Si
 * spegne con LOGBOOK_CODICE_ACCESSO=0 nel .env (es. se la posta non funziona più).
 *
 * Ogni accesso riuscito, fallito o bloccato finisce nel registro attività (servizi/registro.ts).
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { controllaPasswordNuova, creaImpronta, verificaPassword } from '../auth/password';
import { apriSessione, chiudiSessione, fidatiDelPc, improntaToken, leggiCookie, nuovoToken, pcFidato, scriviCookie } from '../auth/sessioni';
import { ErroreHttp, richiestaNonValida } from '../errori';
import { richiediLogin } from '../middleware';
import { DURATA_CODICE_MS, registroCodici } from '../servizi/codice-conferma';
import { mascheraEmail, type InviaEmail } from '../servizi/email';
import { registra } from '../servizi/registro';

/** Password sbagliate ammesse prima di ogni attesa. */
export const TENTATIVI_PRIMA_DEL_BLOCCO = 10;
/** Prima attesa; ogni blocco successivo la raddoppia. */
export const PRIMA_ATTESA_MS = 5 * 60 * 1000;
const ATTESA_MASSIMA_MS = 24 * 60 * 60 * 1000;
/** Senza tentativi per questo tempo il livello di blocco torna a zero. */
const DIMENTICA_DOPO_MS = 24 * 60 * 60 * 1000;
/**
 * Tentativi di login falliti ammessi dallo stesso indirizzo in 15 minuti, qualunque nome
 * utente provi (Giorno 33): ferma chi prova la stessa password su tanti nomi diversi o tiene
 * occupato il server (ogni verifica costa 16 MB di scrypt) cambiando nome a ogni richiesta.
 */
const MAX_TENTATIVI_INDIRIZZO = 30;
const FINESTRA_INDIRIZZO_MS = 15 * 60 * 1000;
/** Oltre questo numero di chiavi i registri dei tentativi si sfoltiscono. */
const MAX_CHIAVI = 5000;
const COOKIE_ATTESA = 'logbook_attesa';

const schemaLogin = z.object({
  // Gli account hanno al massimo 40 caratteri (schemaAccount): 60 lascia margine agli spazi.
  username: z.string().trim().min(1, 'Inserisci il nome utente').max(60, 'Nome utente troppo lungo'),
  password: z.string().min(1, 'Inserisci la password').max(200, 'Password troppo lunga'),
});

const schemaCambioPassword = z.object({
  attuale: z.string().min(1, 'Inserisci la password attuale').max(200, 'Password troppo lunga'),
  nuova: z.string().max(200, 'Password troppo lunga'),
});

type OpzioniAuth = {
  /** Proprietario dal .env: il suo indirizzo riceve il codice di accesso. */
  proprietario?: { username?: string; email?: string };
  inviaEmail?: InviaEmail | null;
  /** false = niente codice via email all'accesso degli amministratori. */
  codiceAccesso?: boolean;
  adesso?: () => number;
};

const minuti = (ms: number) => Math.max(1, Math.ceil(ms / 60000));
const attesaLeggibile = (ms: number) => (ms >= 60 * 60 * 1000 ? `${Math.ceil(ms / 3_600_000)} ore` : `${minuti(ms)} minuti`);

export function rotteAuth(prisma: PrismaClient, opzioni: OpzioniAuth = {}) {
  const router = Router();
  const adesso = opzioni.adesso ?? Date.now;
  /** Blocco progressivo per chiave ("ip|username" o "password|utenteId"). In memoria: si azzera al riavvio. */
  const blocchi = new Map<string, { conta: number; livello: number; bloccatoFino: number; ultimo: number }>();
  /** Tentativi falliti per indirizzo nella finestra di 15 minuti. */
  const perIndirizzo = new Map<string, { conta: number; dal: number }>();
  /** Impronta di una password casuale: si verifica contro questa quando l'utente non esiste. */
  const improntaFinta = creaImpronta(randomBytes(18).toString('base64'));
  /** Accessi di amministratori in attesa del codice via email: impronta del cookie → utente. */
  const inAttesa = new Map<string, { utenteId: number; scade: number }>();
  const codici = registroCodici(adesso);

  function sfoltisci<T>(mappa: Map<string, T>, scaduta: (v: T) => boolean) {
    if (mappa.size < MAX_CHIAVI) return;
    // Prima via le chiavi scadute; se non basta, le più vecchie (la Map tiene l'ordine di inserimento).
    for (const [k, v] of mappa) if (scaduta(v)) mappa.delete(k);
    for (const k of mappa.keys()) {
      if (mappa.size < MAX_CHIAVI / 2) break;
      mappa.delete(k);
    }
  }

  /**
   * Conta un tentativo per la chiave; 429 se la chiave è in attesa o se questo tentativo
   * supera i 10 ammessi (e allora parte l'attesa, più lunga a ogni blocco). Sincrona di
   * proposito: va chiamata prima di qualunque await, così due richieste parallele non
   * leggono lo stesso contatore. Il tentativo riuscito si cancella con blocchi.delete(chiave).
   */
  function registraTentativo(chiave: string) {
    const ora = adesso();
    sfoltisci(blocchi, (v) => ora > v.bloccatoFino && ora - v.ultimo > DIMENTICA_DOPO_MS);
    let b = blocchi.get(chiave);
    if (!b || (ora > b.bloccatoFino && ora - b.ultimo > DIMENTICA_DOPO_MS)) b = { conta: 0, livello: 0, bloccatoFino: 0, ultimo: ora };
    blocchi.set(chiave, b);
    if (ora < b.bloccatoFino) throw new ErroreHttp(429, `Troppi tentativi sbagliati: riprova fra ${attesaLeggibile(b.bloccatoFino - ora)}`);
    b.conta += 1;
    b.ultimo = ora;
    if (b.conta > TENTATIVI_PRIMA_DEL_BLOCCO) {
      const attesa = Math.min(ATTESA_MASSIMA_MS, PRIMA_ATTESA_MS * 2 ** b.livello);
      b.bloccatoFino = ora + attesa;
      b.livello += 1;
      b.conta = 0;
      throw new ErroreHttp(429, `Troppi tentativi sbagliati: riprova fra ${attesaLeggibile(attesa)}`);
    }
  }

  /** Limite per indirizzo (Giorno 33): 30 tentativi in 15 minuti. I login riusciti si scalano dopo. */
  function registraIndirizzo(ip: string) {
    const ora = adesso();
    sfoltisci(perIndirizzo, (v) => ora - v.dal >= FINESTRA_INDIRIZZO_MS);
    let t = perIndirizzo.get(ip);
    if (!t || ora - t.dal >= FINESTRA_INDIRIZZO_MS) t = { conta: 0, dal: ora };
    perIndirizzo.set(ip, t);
    if (t.conta >= MAX_TENTATIVI_INDIRIZZO) {
      throw new ErroreHttp(429, `Troppi tentativi sbagliati da questo indirizzo: riprova fra ${attesaLeggibile(FINESTRA_INDIRIZZO_MS - (ora - t.dal))}`);
    }
    t.conta += 1;
  }

  /** Indirizzo a cui mandare il codice di accesso di un amministratore, se lo si conosce. */
  function emailDelCodice(utente: { username: string; dipendente: { email: string | null } | null }): string | undefined {
    if (opzioni.proprietario?.username && utente.username === opzioni.proprietario.username) return opzioni.proprietario.email || undefined;
    return utente.dipendente?.email || undefined;
  }

  const ip = (req: Request) => req.ip ?? 'sconosciuto';

  router.post('/login', async (req, res) => {
    const { username, password } = schemaLogin.parse(req.body);
    const nome = username.toLowerCase();
    const chiave = `${ip(req)}|${nome}`;
    // Prima il blocco progressivo della coppia, poi il limite dell'indirizzo (un tentativo già
    // bloccato non costa nulla e non deve consumare quello dell'indirizzo): entrambi prima di ogni await.
    try {
      registraTentativo(chiave);
      registraIndirizzo(ip(req));
    } catch (e) {
      void registra(prisma, { username: nome, azione: 'Accesso bloccato per troppi tentativi', dettaglio: e instanceof Error ? e.message : null, esito: 'NEGATO', ip: req.ip });
      throw e;
    }

    const utente = await prisma.utente.findUnique({ where: { username: nome }, include: { dipendente: { select: { email: true } } } });
    // Stesso messaggio (e stesso tempo, con l'impronta finta) per utente inesistente e
    // password sbagliata: non si rivela quali nomi utente esistono.
    const ok = utente?.attivo ? await verificaPassword(password, utente.passwordHash) : (await verificaPassword(password, await improntaFinta), false);
    if (!ok || !utente) {
      void registra(prisma, { utenteId: utente?.id, username: nome, azione: 'Accesso fallito', esito: 'NEGATO', ip: req.ip });
      throw new ErroreHttp(401, 'Nome utente o password non corretti');
    }
    blocchi.delete(chiave);
    // Il login riuscito non conta fra i tentativi dell'indirizzo (tanti colleghi dallo stesso router).
    const t = perIndirizzo.get(ip(req));
    if (t) t.conta -= 1;

    // Amministratore da un PC non ancora fidato: serve anche il codice via email.
    const email = utente.ruolo === 'ADMIN' && opzioni.codiceAccesso !== false && opzioni.inviaEmail ? emailDelCodice(utente) : undefined;
    if (email && !(await pcFidato(prisma, req, utente.id))) {
      const nuovo = codici.nuovo(utente.id);
      if (!nuovo) throw new ErroreHttp(429, 'Hai chiesto troppi codici nell\'ultima ora: riprova più tardi');
      try {
        await opzioni.inviaEmail!({
          a: email,
          oggetto: `Logbook: codice di accesso ${nuovo.codice}`,
          testo:
            `Codice di accesso: ${nuovo.codice}\n\n` +
            `Qualcuno ha inserito la password dell'account "${utente.username}" di Logbook da un PC non ancora riconosciuto.\n` +
            `Il codice vale ${DURATA_CODICE_MS / 60000} minuti e una volta sola.\n\n` +
            `Se non sei stato tu, la tua password è conosciuta da altri: entra e cambiala subito.`,
        });
      } catch (e) {
        codici.annulla(utente.id);
        console.error('[logbook] invio del codice di accesso non riuscito:', e);
        void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Codice di accesso non inviato (posta non funzionante)', esito: 'ERRORE', ip: req.ip });
        throw new ErroreHttp(502, 'Invio del codice via email non riuscito: riprova fra poco. Se la posta non funziona, sul server si può mettere LOGBOOK_CODICE_ACCESSO=0 nel file .env');
      }
      const token = nuovoToken();
      for (const [k, v] of inAttesa) if (v.scade < adesso() || v.utenteId === utente.id) inAttesa.delete(k);
      inAttesa.set(improntaToken(token), { utenteId: utente.id, scade: nuovo.scade });
      scriviCookie(res, COOKIE_ATTESA, token, DURATA_CODICE_MS / 1000);
      void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Password giusta, codice di accesso inviato per email', ip: req.ip });
      res.json({ ok: false, codiceRichiesto: true, inviatoA: mascheraEmail(email) });
      return;
    }

    await apriSessione(prisma, res, utente.id);
    void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Accesso riuscito', ip: req.ip });
    res.json({ ok: true });
  });

  /** Secondo passo dell'accesso di un amministratore: il codice ricevuto per email. */
  router.post('/codice', async (req, res) => {
    const { codice } = z.object({ codice: z.string().trim().regex(/^\d{6}$/, 'Il codice è di 6 cifre') }).parse(req.body);
    const token = leggiCookie(req, COOKIE_ATTESA);
    const attesa = token ? inAttesa.get(improntaToken(token)) : undefined;
    if (!token || !attesa || attesa.scade < adesso()) throw new ErroreHttp(400, 'Nessun accesso in attesa del codice: rifai il login', { codice: 'Rifai il login' });
    const esito = codici.verifica(attesa.utenteId, codice);
    const utente = await prisma.utente.findUnique({ where: { id: attesa.utenteId } });
    if (esito !== 'ok' || !utente?.attivo) {
      const messaggi = {
        ok: 'Account non più attivo',
        assente: 'Codice non più valido: rifai il login',
        scaduto: 'Il codice è scaduto: rifai il login',
        sbagliato: 'Codice sbagliato',
        esaurito: 'Troppi tentativi sbagliati: rifai il login per ricevere un codice nuovo',
      } as const;
      if (esito !== 'sbagliato') inAttesa.delete(improntaToken(token));
      void registra(prisma, { utenteId: attesa.utenteId, username: utente?.username ?? '?', azione: `Codice di accesso rifiutato (${esito})`, esito: 'NEGATO', ip: req.ip });
      throw new ErroreHttp(400, messaggi[esito], { codice: messaggi[esito] });
    }
    inAttesa.delete(improntaToken(token));
    scriviCookie(res, COOKIE_ATTESA, '', 0);
    await fidatiDelPc(prisma, res, utente.id);
    await apriSessione(prisma, res, utente.id);
    void registra(prisma, { utenteId: utente.id, username: utente.username, azione: 'Accesso riuscito con codice via email', ip: req.ip });
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
    // Ogni verifica costa (scrypt, 16 MB): stesso blocco progressivo del login, per utente.
    const chiave = `password|${req.utente!.id}`;
    registraTentativo(chiave);
    const utente = await prisma.utente.findUniqueOrThrow({ where: { id: req.utente!.id } });
    if (!(await verificaPassword(attuale, utente.passwordHash))) {
      throw richiestaNonValida('La password attuale non è corretta', { attuale: 'Password non corretta' });
    }
    blocchi.delete(chiave);
    const debolezza = controllaPasswordNuova(nuova, utente.ruolo);
    if (debolezza) throw richiestaNonValida(debolezza, { nuova: debolezza });
    // Una password provvisoria "cambiata" con sé stessa resterebbe quella nota a HR o al README.
    if (nuova === attuale) throw richiestaNonValida('La nuova password deve essere diversa da quella attuale', { nuova: 'Uguale a quella attuale' });
    // Cambiata dall'utente: non è più provvisoria (Giorno 24, risposta 1a).
    await prisma.utente.update({ where: { id: utente.id }, data: { passwordHash: await creaImpronta(nuova), passwordDaCambiare: false } });
    // Chi conosceva la vecchia password ed era collegato altrove viene scollegato, e i PC
    // fidati si dimenticano: al prossimo accesso da quelli serve di nuovo il codice.
    await prisma.sessione.deleteMany({ where: { utenteId: utente.id } });
    await prisma.dispositivoFidato.deleteMany({ where: { utenteId: utente.id } });
    await apriSessione(prisma, res, utente.id);
    res.json({ ok: true });
  });

  return router;
}
