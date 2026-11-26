// "><(((º> sabusabu <º)))><"
/**
 * Applicazione Express di Logbook: monta le rotte /api e la gestione degli errori.
 *
 * Separata da server/index.ts (che la mette in ascolto) così i test possono usarla
 * senza aprire porte. Il client Prisma si passa da fuori: i test ne danno uno legato
 * a un database temporaneo.
 *
 * Ordine dei middleware (conta):
 * 1. JSON e CSRF su tutte le /api;
 * 2. /api/salute e /api/auth/login restano aperte;
 * 3. tutto il resto richiede il login; le singole rotte restringono poi per ruolo
 *    (richiediAdmin) o per dipendente (dipendenteAmmesso).
 */
import express from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { oggiItalia } from '../comune/date';
import { gestoreErrori } from './errori';
import { caricaUtente, controlloCsrf, richiediLogin, richiediPasswordCambiata } from './middleware';
import { rotteAuth } from './rotte/auth';
import { rotteAssenze } from './rotte/assenze';
import { rotteCalendario } from './rotte/calendario';
import { rotteDashboard } from './rotte/dashboard';
import { rotteEsporta } from './rotte/esporta';
import { rotteFestivita } from './rotte/festivita';
import { rotteImporta } from './rotte/importa';
import { rotteDipendenti } from './rotte/dipendenti';
import { rotteProgetti } from './rotte/progetti';
import { rotteRegistrazioni } from './rotte/registrazioni';
import { rotteAttestati, rotteDocumentiDipendente } from './rotte/attestati';
import { rotteFile } from './rotte/file';
import { rotteImpostazioni } from './rotte/impostazioni';
import { rotteDocumentiProgetto, rotteNoteProgetto } from './rotte/documentazione-progetto';
import { rotteSegnalazioni } from './rotte/segnalazioni';
import { proprietarioDaAmbiente, rotteProprietario, type ConfigProprietario } from './rotte/proprietario';
import { cartellaDocumentiPredefinita } from './servizi/archivio-file';
import { creaAvvisi, indirizzoDaAmbiente } from './servizi/avvisi';
import { invioDaAmbiente, type InviaEmail } from './servizi/email';
import { limitatoreSuDatabase } from './servizi/limitatore';
import { registroRichieste, rotteRegistro } from './servizi/registro';
import { suPostgres } from './database-url';
import { suVercel } from './vercel';
import { rotteMesiChiusi } from './servizi/mesi-chiusi';
import { rotteSaldi } from './rotte/saldi';
import { rotteCostiProgetti } from './rotte/costi-progetti';

/**
 * Opzioni:
 * - `oggi` fissa la data corrente (test: regole sulle date future, dashboard);
 * - `cartellaInterfaccia`: in produzione la cartella dist/ con l'interfaccia già
 *   compilata, servita dallo stesso server delle API (una sola porta, niente Vite);
 * - `cartellaDocumenti`: dove salvare i file caricati (default data/documenti o
 *   LOGBOOK_DOCUMENTI_DIR; i test ne passano una temporanea);
 * - `proprietario`, `inviaEmail`, `adesso`: proprietario di Logbook, invio delle email e
 *   orologio per i codici di conferma (default dal .env: LOGBOOK_PROPRIETARIO,
 *   LOGBOOK_PROPRIETARIO_EMAIL, LOGBOOK_SMTP_*; i test passano i loro).
 */
export type OpzioniApp = {
  oggi?: () => string;
  cartellaInterfaccia?: string;
  cartellaDocumenti?: string;
  proprietario?: ConfigProprietario;
  inviaEmail?: InviaEmail | null;
  adesso?: () => number;
  /** false spegne il codice via email all'accesso degli amministratori (default: LOGBOOK_CODICE_ACCESSO diverso da 0). */
  codiceAccesso?: boolean;
  /** true forza il blocco dei tentativi sul database anche su SQLite (test). */
  limitatoreSuDatabase?: boolean;
  /** Cartella delle copie di sicurezza (i test ne passano una temporanea). */
  cartellaBackup?: string;
};

export function creaApp(prisma: PrismaClient, opzioni: OpzioniApp = {}) {
  // Data di Logbook nel fuso italiano anche se il server è altrove (su Vercel l'orologio è UTC).
  const oggi = opzioni.oggi ?? (() => oggiItalia());
  const cartellaDocumenti = opzioni.cartellaDocumenti ?? cartellaDocumentiPredefinita();
  const app = express();
  app.disable('x-powered-by');
  // Intestazioni di sicurezza su ogni risposta (verifica del Giorno 23): niente indirizzo
  // della pagina mandato ad altri siti, niente "indovinare" il tipo dei file.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  // Verifica del Giorno 33: raggiunto in HTTPS (proxy della suite), Logbook dice al browser
  // di non tornare mai in HTTP per un anno; in HTTP l'intestazione non si manda (sarebbe ignorata).
  app.use((req, res, next) => {
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  // Dietro un proxy (Vite in sviluppo, Caddy in produzione) req.ip deve essere quello
  // del browser, non del proxy: serve al limite dei tentativi di login.
  // Su Vercel (Giorno 35) davanti c'è sempre la rete di Vercel, che non è "loopback": lì ci
  // si fida del primo proxy, altrimenti req.ip sarebbe il suo e req.secure sempre false.
  app.set('trust proxy', suVercel() ? 1 : 'loopback');

  const api = express.Router();
  // Le risposte delle API contengono dati personali (ore, costi, assenze): browser e proxy
  // non le devono conservare (Giorno 33). I file hanno già la loro regola in rotte/file.ts.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '1mb' }));
  api.use(controlloCsrf);
  api.use(caricaUtente(prisma));

  /** Controllo di vita: non richiede login e non tocca il database. */
  api.get('/salute', (_req, res) => {
    res.json({ ok: true, app: 'logbook' });
  });

  /**
   * Data di Logbook (Giorno 19): l'interfaccia decide cos'è "oggi" con questa, non con
   * l'orologio del PC, e avvisa se il PC ha un'altra data. Dal Giorno 20 le ore le inserisce
   * solo HR e i giorni futuri restano chiusi: spostare la data del computer non apre nulla,
   * perché il controllo lo fa il server. Senza login di proposito: è solo la data.
   */
  api.get('/oggi', (_req, res) => {
    res.json({ oggi: oggi(), adesso: new Date().toISOString() });
  });

  // Giorno 34: ogni operazione che modifica o esporta dati finisce nel registro attività.
  api.use(registroRichieste(prisma));
  const proprietario = opzioni.proprietario ?? proprietarioDaAmbiente();
  const inviaEmail = opzioni.inviaEmail !== undefined ? opzioni.inviaEmail : invioDaAmbiente();
  // 26/11/2026: avvisi via email (richieste, esiti, ore mancanti, attestati): servizi/avvisi.ts.
  const avvisi = creaAvvisi(prisma, { inviaEmail, emailProprietario: proprietario.email, indirizzo: indirizzoDaAmbiente(), adesso: opzioni.adesso });

  /**
   * Avvisi del giorno chiamati da Vercel Cron (vercel-build.mjs li pianifica ogni mattina).
   * Vercel manda "Authorization: Bearer <CRON_SECRET>": senza la variabile, o con un valore
   * diverso, la rotta risponde come se non esistesse. Sta prima del login di proposito.
   */
  api.get('/cron/avvisi', async (req, res) => {
    const segreto = process.env.CRON_SECRET;
    if (!segreto || req.get('authorization') !== `Bearer ${segreto}`) {
      res.status(404).json({ errore: 'Risorsa non trovata' });
      return;
    }
    res.json(await avvisi.giornaliero(oggi()));
  });
  api.use(
    '/auth',
    rotteAuth(prisma, {
      proprietario, inviaEmail, adesso: opzioni.adesso,
      // Senza memoria che dura (PostgreSQL = Vercel) il blocco dei tentativi sta nel database.
      limitatore: opzioni.limitatoreSuDatabase ?? suPostgres() ? limitatoreSuDatabase(prisma, opzioni.adesso) : undefined, codiceAccesso: opzioni.codiceAccesso ?? process.env.LOGBOOK_CODICE_ACCESSO?.trim() !== '0' }),
  );

  // Da qui in poi serve il login, e una password non provvisoria (Giorno 24, risposta 1a).
  api.use(richiediLogin);
  api.use(richiediPasswordCambiata);
  api.use('/dipendenti', rotteDipendenti(prisma, proprietario.username));
  api.use('/progetti', rotteProgetti(prisma));
  api.use('/registrazioni', rotteRegistrazioni(prisma, oggi));
  api.use('/calendario', rotteCalendario(prisma));
  api.use('/assenze', rotteAssenze(prisma, cartellaDocumenti, avvisi));
  api.use('/festivita', rotteFestivita(prisma));
  api.use('/importa', rotteImporta(prisma, oggi));
  api.use('/esporta', rotteEsporta(prisma));
  api.use('/dashboard', rotteDashboard(prisma, oggi));
  // Giorno 15 (24/11/2026): file, attestati, documenti del dipendente, impostazioni.
  api.use('/file', rotteFile(prisma, cartellaDocumenti));
  api.use('/attestati', rotteAttestati(prisma, cartellaDocumenti, oggi));
  api.use('/documenti-dipendente', rotteDocumentiDipendente(prisma, cartellaDocumenti));
  api.use('/impostazioni', rotteImpostazioni(prisma, { avvisi, emailProprietario: proprietario.email, postaConfigurata: Boolean(inviaEmail) }));
  // Giorno 17 (24/11/2026): documentazione di avanzamento e note interne dei progetti.
  api.use('/documenti-progetto', rotteDocumentiProgetto(prisma, cartellaDocumenti, oggi));
  api.use('/note-progetto', rotteNoteProgetto(prisma));
  // Giorno 20: segnalazioni dei dipendenti a HR (le ore le inserisce solo HR).
  api.use('/segnalazioni', rotteSegnalazioni(prisma, oggi));
  // 25/11/2026: dati di esempio e "Cancella tutti i dati" con codice via email, solo per il
  // proprietario (server/rotte/proprietario.ts).
  api.use(
    '/proprietario',
    rotteProprietario(prisma, {
      cartellaDocumenti,
      oggi,
      proprietario,
      inviaEmail,
      adesso: opzioni.adesso,
      cartellaBackup: opzioni.cartellaBackup,
    }),
  );
  // Giorno 37 (26/11/2026): chiusura del mese (servizi/mesi-chiusi.ts).
  api.use('/mesi-chiusi', rotteMesiChiusi(prisma, oggi));
  // Giorno 38 (26/11/2026): saldo ferie e permessi (rotte/saldi.ts, calcolo in comune/saldi.ts).
  api.use('/saldi', rotteSaldi(prisma, oggi));
  // Giorno 41 (26/11/2026): costo della manodopera per commessa, solo HR (rotte/costi-progetti.ts).
  api.use('/costi-progetti', rotteCostiProgetti(prisma));
  // Giorno 34: registro attività, solo amministratori (voce del menu).
  api.use('/registro', rotteRegistro(prisma));

  /** Qualsiasi altra /api: 404 in JSON (non la pagina HTML di Express). */
  api.use((_req, res) => {
    res.status(404).json({ errore: 'Risorsa non trovata' });
  });

  app.use('/api', api);

  // Produzione: file dell'interfaccia e, per ogni altro indirizzo (es. /calendario
  // ricaricato dal browser), index.html — le pagine le gestisce React Router.
  if (opzioni.cartellaInterfaccia) {
    const cartella = opzioni.cartellaInterfaccia;
    // Pagine dell'interfaccia (verifica di sicurezza del Giorno 23):
    // - frame-ancestors 'none' + X-Frame-Options: nessun sito (nemmeno un'altra app della
    //   suite sullo stesso indirizzo) può mostrare Logbook dentro un riquadro e far cliccare
    //   l'utente collegato senza che se ne accorga. Il Portale apre Logbook in una scheda sua;
    // - script, fogli di stile e chiamate solo da Logbook stesso; 'unsafe-inline' sugli
    //   stili serve alle proprietà style di React. I file caricati hanno una politica loro
    //   (server/rotte/file.ts).
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
          "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
      res.setHeader('X-Frame-Options', 'DENY');
      next();
    });
    app.use(express.static(cartella, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      // index.html mai in cache: dopo un aggiornamento il browser prende subito i file nuovi.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: cartella });
    });
  }

  app.use(gestoreErrori);
  return app;
}
