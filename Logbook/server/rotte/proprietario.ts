// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/proprietario: le operazioni riservate al proprietario di Logbook (25/11/2026).
 *
 * Richiesta dell'utente: "il programma deve potersi popolare con i dati per farmi capire come
 * sta funzionando, all'occorrenza devo poter cancellare tutto … un comando che mi permetta di
 * cancellare tutti i dati ma che sia usabile solo da me … inserisci l'invio di un codice via mail".
 *
 * Chi è il proprietario. Logbook deve funzionare anche fuori dalla suite (risposta 4b),
 * quindi non lo chiede al Portale: è l'account il cui username è in LOGBOOK_PROPRIETARIO
 * (file .env sul server), purché amministratore e attivo. Non si cambia dall'interfaccia, così
 * nessun altro amministratore può diventarlo. L'email che riceve i codici è
 * LOGBOOK_PROPRIETARIO_EMAIL, anche lei solo nel .env.
 *
 * Rotte:
 * - GET  /stato: dice all'interfaccia se mostrare la sezione "Dati del programma" e cosa
 *   manca nella configurazione. A chi non è il proprietario risponde solo { proprietario: false };
 * - POST /dati-esempio: carica i dati di esempio (prisma/seed.ts), solo con Logbook vuoto
 *   (nessun dipendente, progetto o ora). Gli account di esempio nascono con la password
 *   provvisoria da cambiare al primo accesso (Giorno 24);
 * - POST /cancellazione/codice: manda il codice di 6 cifre all'email del proprietario
 *   (server/servizi/codice-conferma.ts per durata, tentativi e limite all'ora);
 * - POST /cancellazione { codice, conferma: "CANCELLA" }: con il codice giusto cancella tutto
 *   (server/servizi/cancella-dati.ts) e manda un'email di avviso a cose fatte.
 * Senza server di posta (server/servizi/email.ts) la cancellazione resta spenta.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { CREDENZIALI_DEMO, semina, USERNAME_DEMO } from '../../prisma/seed';
import { segnaPasswordPubblicate } from '../auth/password-provvisorie';
import { ErroreHttp, vietato } from '../errori';
import { cancellaTuttiIDati } from '../servizi/cancella-dati';
import { registroCodici } from '../servizi/codice-conferma';
import { mascheraEmail, type InviaEmail } from '../servizi/email';

/** Proprietario dal .env: username dell'account e indirizzo che riceve i codici. */
export type ConfigProprietario = { username?: string; email?: string };

export function proprietarioDaAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigProprietario {
  return { username: env.LOGBOOK_PROPRIETARIO?.trim() || undefined, email: env.LOGBOOK_PROPRIETARIO_EMAIL?.trim() || undefined };
}

/** Parola da scrivere per confermare: un clic sbagliato non basta a cancellare tutto. */
export const PAROLA_CONFERMA = 'CANCELLA';

const formatoOra = (ms: number) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

export function rotteProprietario(
  prisma: PrismaClient,
  opzioni: {
    cartellaDocumenti: string;
    oggi: () => string;
    proprietario: ConfigProprietario;
    inviaEmail: InviaEmail | null;
    adesso?: () => number;
  },
) {
  const router = Router();
  const { proprietario, inviaEmail, cartellaDocumenti, oggi } = opzioni;
  const adesso = opzioni.adesso ?? Date.now;
  const codici = registroCodici(adesso);

  const eProprietario = (req: Request) =>
    !!proprietario.username && req.utente?.ruolo === 'ADMIN' && req.utente.username === proprietario.username;

  function soloProprietario(req: Request, _res: Response, next: NextFunction) {
    if (!eProprietario(req)) throw vietato('Funzione riservata al proprietario di Logbook');
    next();
  }

  /** Logbook è "vuoto" se non ha né dipendenti né progetti né ore. */
  const conteggi = async () => {
    const [dipendenti, progetti, registrazioni] = await Promise.all([prisma.dipendente.count(), prisma.progetto.count(), prisma.registrazioneOraria.count()]);
    return { dipendenti, progetti, registrazioni };
  };

  /** Il codice si può chiedere solo con email del proprietario e server di posta impostati. */
  function invioPronto(): InviaEmail {
    if (!proprietario.email) throw new ErroreHttp(409, 'Manca l\'email del proprietario: impostare LOGBOOK_PROPRIETARIO_EMAIL nel file .env del server');
    if (!inviaEmail) throw new ErroreHttp(409, 'L\'invio delle email non è configurato: impostare LOGBOOK_SMTP_HOST e gli altri campi nel file .env del server');
    return inviaEmail;
  }

  router.get('/stato', async (req, res) => {
    if (!eProprietario(req)) {
      res.json({ proprietario: false });
      return;
    }
    const c = await conteggi();
    res.json({
      proprietario: true,
      emailMascherata: proprietario.email ? mascheraEmail(proprietario.email) : null,
      emailConfigurata: !!proprietario.email,
      invioConfigurato: !!inviaEmail,
      vuoto: c.dipendenti === 0 && c.progetti === 0 && c.registrazioni === 0,
      ...c,
    });
  });

  router.post('/dati-esempio', soloProprietario, async (_req, res) => {
    const c = await conteggi();
    if (c.dipendenti || c.progetti || c.registrazioni) {
      throw new ErroreHttp(409, 'I dati di esempio si caricano solo con Logbook vuoto: prima cancella tutti i dati');
    }
    const r = await semina(prisma, oggi());
    // Le password degli account di esempio sono scritte nel README: provvisorie da subito.
    await segnaPasswordPubblicate(prisma, [{ password: CREDENZIALI_DEMO.passwordDipendenti, utenti: { username: { in: USERNAME_DEMO } } }]);
    console.log(`[logbook] dati di esempio caricati dal proprietario: ${r.dipendenti} dipendenti, ${r.progetti} progetti, ${r.registrazioni} fasce orarie`);
    res.status(201).json(r);
  });

  router.post('/cancellazione/codice', soloProprietario, async (req, res) => {
    const invia = invioPronto();
    const nuovo = codici.nuovo(req.utente!.id);
    if (!nuovo) throw new ErroreHttp(429, 'Hai chiesto troppi codici nell\'ultima ora: riprova più tardi');
    try {
      await invia({
        a: proprietario.email!,
        oggetto: `Logbook: codice ${nuovo.codice} per cancellare tutti i dati`,
        testo:
          `Codice di conferma: ${nuovo.codice}\n\n` +
          `Serve a cancellare TUTTI i dati di Logbook (dipendenti, progetti, ore, assenze, documenti e gli altri account).\n` +
          `È valido fino alle ${formatoOra(nuovo.scade)} e si può usare una volta sola.\n\n` +
          `Se non l'hai chiesto tu, non fare nulla: senza questo codice non si cancella niente. ` +
          `Ti conviene però cambiare la password dell'account "${req.utente!.username}" di Logbook.`,
      });
    } catch (e) {
      codici.annulla(req.utente!.id);
      console.error('[logbook] invio del codice non riuscito:', e);
      throw new ErroreHttp(502, 'Invio dell\'email non riuscito: controllare server, porta, utente e password di posta nel file .env');
    }
    console.log(`[logbook] codice per cancellare tutti i dati inviato al proprietario (${req.utente!.username})`);
    res.json({ inviatoA: mascheraEmail(proprietario.email!), scadeAlle: new Date(nuovo.scade).toISOString() });
  });

  router.post('/cancellazione', soloProprietario, async (req, res) => {
    const invia = invioPronto();
    const dati = z
      .object({
        codice: z.string().trim().regex(/^\d{6}$/, 'Il codice è di 6 cifre'),
        conferma: z.string().trim().refine((v) => v === PAROLA_CONFERMA, `Scrivi ${PAROLA_CONFERMA} in maiuscolo per confermare`),
      })
      .parse(req.body);
    const esito = codici.verifica(req.utente!.id, dati.codice);
    if (esito !== 'ok') {
      const messaggi = {
        assente: 'Nessun codice in attesa: chiedine uno nuovo',
        scaduto: 'Il codice è scaduto: chiedine uno nuovo',
        sbagliato: 'Codice sbagliato',
        esaurito: 'Troppi tentativi sbagliati: il codice è stato annullato, chiedine uno nuovo',
      } as const;
      throw new ErroreHttp(400, messaggi[esito], { codice: messaggi[esito] });
    }
    const r = await cancellaTuttiIDati(prisma, cartellaDocumenti, req.utente!.id, oggi());
    console.log(
      `[logbook] TUTTI I DATI CANCELLATI dal proprietario (${req.utente!.username}): ${r.dipendenti} dipendenti, ${r.progetti} progetti, ` +
        `${r.registrazioni} fasce orarie, ${r.assenze} assenze, ${r.account} account, ${r.file} file`,
    );
    // Avviso a cose fatte: se non è stato il proprietario, lo scopre subito. Un errore di
    // invio qui non annulla nulla (i dati sono già stati cancellati).
    invia({
      a: proprietario.email!,
      oggetto: 'Logbook: tutti i dati sono stati cancellati',
      testo:
        `Alle ${formatoOra(adesso())} l'account "${req.utente!.username}" ha cancellato tutti i dati di Logbook con il codice di conferma.\n` +
        `Cancellati: ${r.dipendenti} dipendenti, ${r.progetti} progetti, ${r.registrazioni} fasce orarie, ${r.assenze} assenze, ${r.account} account, ${r.file} file.`,
    }).catch((e) => console.error('[logbook] avviso di cancellazione non inviato:', e));
    res.json(r);
  });

  return router;
}
