// "><(((º> sabusabu <º)))><"
/**
 * Invio delle email di Copilota (dal 25/11/2026). Oggi serve solo al proprietario:
 * - codice di conferma per "Cancella tutti i dati" (server/rotte/proprietario.ts);
 * - avviso a cancellazione avvenuta.
 *
 * Server di posta dal file .env (risposta 2a: la casella aziendale, la password la scrive
 * l'utente nel .env, mai in chat né nel repository):
 * - LOGBOOK_SMTP_HOST       server di invio (senza, l'invio non è configurato);
 * - LOGBOOK_SMTP_PORT       default 587;
 * - LOGBOOK_SMTP_SICUREZZA  starttls | ssl | nessuna (default: ssl sulla 465, altrimenti starttls);
 * - LOGBOOK_SMTP_UTENTE / LOGBOOK_SMTP_PASSWORD  credenziali (facoltative per server interni);
 * - LOGBOOK_EMAIL_MITTENTE  indirizzo "Da:" (default: LOGBOOK_SMTP_UTENTE).
 *
 * Senza server configurato NON c'è una strada di riserva (niente email scritte nel log):
 * il codice deve poter arrivare solo nella casella del proprietario, quindi la funzione che
 * lo chiede resta spenta e l'interfaccia dice cosa manca.
 */
import nodemailer from 'nodemailer';

export type Email = { a: string; oggetto: string; testo: string };
/** Spedisce un'email; solleva un errore se il server di posta la rifiuta o non risponde. */
export type InviaEmail = (email: Email) => Promise<void>;

type Sicurezza = 'starttls' | 'ssl' | 'nessuna';
export type ConfigSmtp = { host: string; porta: number; sicurezza: Sicurezza; utente?: string; password?: string; mittente: string };

/**
 * Legge la configurazione SMTP dalle variabili d'ambiente. Restituisce null se manca il
 * server o il mittente (senza mittente nessun server accetta l'email).
 */
export function configurazioneSmtp(env: NodeJS.ProcessEnv = process.env): ConfigSmtp | null {
  const host = env.LOGBOOK_SMTP_HOST?.trim();
  if (!host) return null;
  const porta = Number(env.LOGBOOK_SMTP_PORT?.trim() || 587);
  const scelta = env.LOGBOOK_SMTP_SICUREZZA?.trim().toLowerCase();
  const sicurezza: Sicurezza = scelta === 'ssl' || scelta === 'nessuna' || scelta === 'starttls' ? scelta : porta === 465 ? 'ssl' : 'starttls';
  const utente = env.LOGBOOK_SMTP_UTENTE?.trim() || undefined;
  const password = env.LOGBOOK_SMTP_PASSWORD || undefined;
  const mittente = env.LOGBOOK_EMAIL_MITTENTE?.trim() || utente;
  if (!mittente || !Number.isInteger(porta) || porta <= 0) return null;
  return { host, porta, sicurezza, utente, password, mittente };
}

/**
 * Invio tramite nodemailer. Con "starttls" la cifratura è obbligatoria (requireTLS): se il
 * server non la offre l'invio fallisce invece di mandare il codice in chiaro.
 */
export function creaInvioSmtp(config: ConfigSmtp): InviaEmail {
  const trasporto = nodemailer.createTransport({
    host: config.host,
    port: config.porta,
    secure: config.sicurezza === 'ssl',
    requireTLS: config.sicurezza === 'starttls',
    ignoreTLS: config.sicurezza === 'nessuna',
    auth: config.utente ? { user: config.utente, pass: config.password ?? '' } : undefined,
    // Un server che non risponde non deve tenere ferma la richiesta per minuti.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return async ({ a, oggetto, testo }) => {
    await trasporto.sendMail({ from: `Copilota <${config.mittente}>`, to: a, subject: oggetto, text: testo });
  };
}

/**
 * true per gli indirizzi dei dati di esempio (prisma/seed.ts li crea tutti su @esempio.it).
 * Non sono caselle vere: scriverci produce solo messaggi tornati indietro.
 */
export function indirizzoDiEsempio(email: string): boolean {
  return /@esempio.it$/i.test(email.trim());
}

/**
 * Invio configurato dal .env, oppure null se il server di posta non è impostato.
 * Dal 26/11/2026 (avvisi via email) gli indirizzi dei dati di esempio vengono saltati in
 * silenzio: con i dati di prova caricati Copilota non deve scrivere a caselle inventate.
 */
export function invioDaAmbiente(env: NodeJS.ProcessEnv = process.env): InviaEmail | null {
  const config = configurazioneSmtp(env);
  if (!config) return null;
  const invia = creaInvioSmtp(config);
  return async (email) => {
    if (indirizzoDiEsempio(email.a)) return;
    await invia(email);
  };
}

/**
 * Indirizzo mostrato a video senza scriverlo per intero (a.m•••••i@dominio.it): chi guarda
 * lo schermo capisce dove è andato il codice, ma l'indirizzo completo resta nel .env.
 */
export function mascheraEmail(email: string): string {
  const [nome, dominio] = email.split('@');
  if (!dominio) return '•••';
  const visibili = nome.length <= 3 ? nome.slice(0, 1) : `${nome.slice(0, 3)}`;
  return `${visibili}${'•'.repeat(Math.max(3, nome.length - visibili.length - 1))}${nome.length > 3 ? nome.slice(-1) : ''}@${dominio}`;
}
