// "><(((º> sabusabu <º)))><"
/**
 * Rotte di accesso: /api/auth/login, /codice, /logout, /io, /password.
 *
 * Login con username e password propri di Copilota (scelta 1c).
 *
 * Blocco progressivo dei tentativi (Giorno 34, 25/11/2026: "dopo 10 tentativi fai aspettare
 * 5 minuti e dopo sali a 10 e così via"): per la stessa coppia indirizzo+utente, dopo 10
 * password sbagliate si aspetta 5 minuti; altre 10 sbagliate e l'attesa raddoppia (10, 20,
 * 40 minuti… fino a 24 ore). Un accesso riuscito azzera tutto; senza tentativi per 24 ore si
 * riparte da 5 minuti. Lo stesso vale per il cambio password (password attuale sbagliata). Il conto lo tiene
 * servizi/limitatore.ts: in memoria su un PC, nel database su Vercel (Giorno 35).
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
 * ancora "fidato" Copilota manda un codice di 6 cifre e apre la sessione solo con quello
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
import { attesaLeggibile, limitatoreInMemoria, type Limitatore } from '../servizi/limitatore';
import { statoTemporaneo } from '../servizi/stato-temporaneo';
import { mascheraEmail, type InviaEmail } from '../servizi/email';
import { registra } from '../servizi/registro';
import { tieniVivo } from '../vercel';
import { isCaposquadra } from './squadra';

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
  /** Blocco progressivo dei tentativi: in memoria (default) o sul database (Vercel, app.ts). */
  limitatore?: Limitatore;
};

export function rotteAuth(prisma: PrismaClient, opzioni: OpzioniAuth = {}) {
  const router = Router();
  const adesso = opzioni.adesso ?? Date.now;
  const limitatore = opzioni.limitatore ?? limitatoreInMemoria(adesso);
  // Giorno 35: codici e accessi in attesa del codice stanno nel database (su Vercel la
  // richiesta dopo può arrivare a un altro processo): chiave "attesa:<impronta del cookie>".
  const stato = statoTemporaneo(prisma, adesso);
  const codici = registroCodici(stato, 'accesso', adesso);
  // Giorno 40: codici per scegliere una password nuova quando si è dimenticata quella vecchia.
  const codiciReimposta = registroCodici(stato, 'reimposta', adesso);
  /** Tentativi falliti per indirizzo nella finestra di 15 minuti. */
  const perIndirizzo = new Map<string, { conta: number; dal: number }>();
  /** Impronta di una password casuale: si verifica contro questa quando l'utente non esiste. */
  const improntaFinta = creaImpronta(randomBytes(18).toString('base64'));
  function sfoltisci<T>(mappa: Map<string, T>, scaduta: (v: T) => boolean) {
    if (mappa.size < MAX_CHIAVI) return;
    // Prima via le chiavi scadute; se non basta, le più vecchie (la Map tiene l'ordine di inserimento).
    for (const [k, v] of mappa) if (scaduta(v)) mappa.delete(k);
    for (const k of mappa.keys()) {
      if (mappa.size < MAX_CHIAVI / 2) break;
      mappa.delete(k);
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
      await limitatore.tentativo(chiave);
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
    await limitatore.riuscito(chiave);
    // Il login riuscito non conta fra i tentativi dell'indirizzo (tanti colleghi dallo stesso router).
    const t = perIndirizzo.get(ip(req));
    if (t) t.conta -= 1;

    // Amministratore da un PC non ancora fidato: serve anche il codice via email.
    const email = utente.ruolo === 'ADMIN' && opzioni.codiceAccesso !== false && opzioni.inviaEmail ? emailDelCodice(utente) : undefined;
    if (email && !(await pcFidato(prisma, req, utente.id))) {
      const nuovo = await codici.nuovo(utente.id);
      if (!nuovo) throw new ErroreHttp(429, 'Hai chiesto troppi codici nell\'ultima ora: riprova più tardi');
      try {
        await opzioni.inviaEmail!({
          a: email,
          oggetto: `Copilota: codice di accesso ${nuovo.codice}`,
          testo:
            `Codice di accesso: ${nuovo.codice}\n\n` +
            `Qualcuno ha inserito la password dell'account "${utente.username}" di Copilota da un PC non ancora riconosciuto.\n` +
            `Il codice vale ${DURATA_CODICE_MS / 60000} minuti e una volta sola.\n\n` +
            `Se non sei stato tu, la tua password è conosciuta da altri: entra e cambiala subito.`,
        });
      } catch (e) {
        await codici.annulla(utente.id);
        console.error('[logbook] invio del codice di accesso non riuscito:', e);
        void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Codice di accesso non inviato (posta non funzionante)', esito: 'ERRORE', ip: req.ip });
        throw new ErroreHttp(502, 'Invio del codice via email non riuscito: riprova fra poco. Se la posta non funziona, sul server si può mettere LOGBOOK_CODICE_ACCESSO=0 nel file .env');
      }
      const token = nuovoToken();
      await stato.scrivi(`attesa:${improntaToken(token)}`, { utenteId: utente.id }, nuovo.scade);
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
    const chiaveAttesa = token ? `attesa:${improntaToken(token)}` : '';
    const attesa = token ? await stato.leggi<{ utenteId: number }>(chiaveAttesa) : null;
    if (!token || !attesa) throw new ErroreHttp(400, 'Nessun accesso in attesa del codice: rifai il login', { codice: 'Rifai il login' });
    const esito = await codici.verifica(attesa.utenteId, codice);
    const utente = await prisma.utente.findUnique({ where: { id: attesa.utenteId } });
    if (esito !== 'ok' || !utente?.attivo) {
      const messaggi = {
        ok: 'Account non più attivo',
        assente: 'Codice non più valido: rifai il login',
        scaduto: 'Il codice è scaduto: rifai il login',
        sbagliato: 'Codice sbagliato',
        esaurito: 'Troppi tentativi sbagliati: rifai il login per ricevere un codice nuovo',
      } as const;
      if (esito !== 'sbagliato') await stato.togli(chiaveAttesa);
      void registra(prisma, { utenteId: attesa.utenteId, username: utente?.username ?? '?', azione: `Codice di accesso rifiutato (${esito})`, esito: 'NEGATO', ip: req.ip });
      throw new ErroreHttp(400, messaggi[esito], { codice: messaggi[esito] });
    }
    await stato.togli(chiaveAttesa);
    scriviCookie(res, COOKIE_ATTESA, '', 0);
    await fidatiDelPc(prisma, res, utente.id);
    await apriSessione(prisma, res, utente.id);
    void registra(prisma, { utenteId: utente.id, username: utente.username, azione: 'Accesso riuscito con codice via email', ip: req.ip });
    res.json({ ok: true });
  });

  /**
   * Password dimenticata, primo passo (Giorno 40, 26/11/2026): manda un codice di 6 cifre
   * all'email dell'account (anagrafica del dipendente, o quella del proprietario).
   * La risposta è sempre la stessa, che l'account esista o no e che abbia un'email o no:
   * da fuori non si scopre quali nomi utente esistono. Chi non ha un'email in anagrafica
   * deve rivolgersi a HR, e il messaggio lo dice a tutti.
   * Freni: limite dei tentativi per indirizzo (lo stesso del login) e al massimo 5 codici
   * all'ora per account (servizi/codice-conferma.ts).
   */
  router.post('/dimenticata', async (req, res) => {
    const { username } = z.object({ username: z.string().trim().min(1, 'Inserisci il nome utente').max(60, 'Nome utente troppo lungo') }).parse(req.body);
    const nome = username.toLowerCase();
    if (!opzioni.inviaEmail) throw new ErroreHttp(400, 'Su questo Copilota la posta non è configurata: per una password nuova rivolgiti a HR');
    registraIndirizzo(ip(req));
    const utente = await prisma.utente.findUnique({ where: { username: nome }, include: { dipendente: { select: { email: true } } } });
    const email = utente?.attivo ? emailDelCodice(utente) : undefined;
    if (utente && email) {
      const nuovo = await codiciReimposta.nuovo(utente.id);
      if (nuovo) {
        const invio = opzioni
          .inviaEmail({
            a: email,
            oggetto: `Copilota: codice per la password nuova ${nuovo.codice}`,
            testo:
              `Codice: ${nuovo.codice}\n\n` +
              `Qualcuno ha chiesto di scegliere una password nuova per l'account "${utente.username}" di Copilota.\n` +
              `Il codice vale ${DURATA_CODICE_MS / 60000} minuti e una volta sola.\n\n` +
              `Se non sei stato tu non fare nulla: la password resta quella di prima.`,
          })
          .catch(async (e) => {
            await codiciReimposta.annulla(utente.id);
            console.error('[logbook] invio del codice per la password nuova non riuscito:', e);
          });
        // A risposta inviata: così il tempo di risposta non rivela se l'account esiste.
        tieniVivo(invio);
      }
      void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Password dimenticata: codice richiesto', esito: nuovo ? 'OK' : 'NEGATO', ip: req.ip });
    }
    res.json({ ok: true, messaggio: "Se l'account esiste e ha un'email in anagrafica, il codice è in arrivo a quell'indirizzo. Se non arriva entro qualche minuto, rivolgiti a HR." });
  });

  /**
   * Password dimenticata, secondo passo: codice ricevuto + password nuova. Il codice ha 5
   * tentativi; in più vale il blocco progressivo (10 errori → attese crescenti) sulla coppia
   * indirizzo + nome utente. Riuscito: password cambiata (non più provvisoria), sessioni e
   * PC fidati dimenticati. Non apre una sessione: si rientra dal login, e gli amministratori
   * ripassano dal codice di accesso.
   */
  router.post('/reimposta', async (req, res) => {
    const { username, codice, nuova } = z
      .object({
        username: z.string().trim().min(1, 'Inserisci il nome utente').max(60, 'Nome utente troppo lungo'),
        codice: z.string().trim().regex(/^\d{6}$/, 'Il codice è di 6 cifre'),
        nuova: z.string().max(200, 'Password troppo lunga'),
      })
      .parse(req.body);
    const nome = username.toLowerCase();
    const chiave = `reimposta|${ip(req)}|${nome}`;
    await limitatore.tentativo(chiave);
    const utente = await prisma.utente.findUnique({ where: { username: nome } });
    // Prima la password: un codice giusto non va consumato per una password che poi è rifiutata.
    const debolezza = controllaPasswordNuova(nuova, utente?.ruolo ?? 'DIPENDENTE');
    if (debolezza) throw richiestaNonValida(debolezza, { nuova: debolezza });
    const esito = utente?.attivo ? await codiciReimposta.verifica(utente.id, codice) : 'assente';
    if (esito !== 'ok' || !utente) {
      const messaggi = {
        ok: 'Codice non valido',
        assente: 'Codice non valido: chiedine uno nuovo',
        scaduto: 'Il codice è scaduto: chiedine uno nuovo',
        sbagliato: 'Codice sbagliato',
        esaurito: 'Troppi tentativi sbagliati: chiedi un codice nuovo',
      } as const;
      void registra(prisma, { utenteId: utente?.id, username: nome, azione: `Password dimenticata: codice rifiutato (${esito})`, esito: 'NEGATO', ip: req.ip });
      throw new ErroreHttp(400, messaggi[esito], { codice: messaggi[esito] });
    }
    await limitatore.riuscito(chiave);
    // Il blocco del login per troppi errori non ha più senso: la password è nuova.
    await limitatore.riuscito(`${ip(req)}|${nome}`);
    await prisma.utente.update({ where: { id: utente.id }, data: { passwordHash: await creaImpronta(nuova), passwordDaCambiare: false } });
    await prisma.sessione.deleteMany({ where: { utenteId: utente.id } });
    await prisma.dispositivoFidato.deleteMany({ where: { utenteId: utente.id } });
    void registra(prisma, { utenteId: utente.id, username: nome, azione: 'Password dimenticata: password cambiata con il codice', ip: req.ip });
    res.json({ ok: true });
  });

  router.post('/logout', async (req, res) => {
    await chiudiSessione(prisma, req, res);
    res.json({ ok: true });
  });

  /** Chi sono: usato dal frontend all'apertura per sapere se mostrare login o app. */
  router.get('/io', richiediLogin, async (req, res) => {
    // Giorno 43: caposquadra di almeno un progetto attivo → l'interfaccia mostra "La mia squadra".
    res.json({ ...req.utente, caposquadra: await isCaposquadra(prisma, req.utente!.dipendenteId) });
  });

  /** Cambio della propria password: chiede quella attuale e chiude le altre sessioni. */
  router.post('/password', richiediLogin, async (req, res) => {
    const { attuale, nuova } = schemaCambioPassword.parse(req.body);
    // Ogni verifica costa (scrypt, 16 MB): stesso blocco progressivo del login, per utente.
    const chiave = `password|${req.utente!.id}`;
    await limitatore.tentativo(chiave);
    const utente = await prisma.utente.findUniqueOrThrow({ where: { id: req.utente!.id } });
    if (!(await verificaPassword(attuale, utente.passwordHash))) {
      throw richiestaNonValida('La password attuale non è corretta', { attuale: 'Password non corretta' });
    }
    await limitatore.riuscito(chiave);
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
