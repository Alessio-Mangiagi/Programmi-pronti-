// "><(((º> sabusabu <º)))><"
/**
 * Sessioni di accesso: token casuale nel cookie HttpOnly, impronta SHA-256 nel DB.
 *
 * Cookie `logbook_sessione`: HttpOnly (JavaScript non lo legge), SameSite=Lax (non
 * parte da form di altri siti), Secure se LOGBOOK_COOKIE_SECURE=1 o se la richiesta è in HTTPS.
 * Durata massima di 12 ore: copre una giornata di lavoro, poi si rifà il login.
 *
 * Inattività (Giorno 34, 25/11/2026: "sessioni solo 15 minuti se l'utente non sta facendo
 * nulla"): la sessione si chiude dopo 15 minuti senza azioni dell'utente. Conta come azione
 * una richiesta con l'intestazione `X-Logbook-Attivo: 1`, che l'interfaccia aggiunge solo se
 * l'utente ha mosso mouse o tastiera nell'ultimo minuto (src/api.ts). Le chiamate che
 * l'interfaccia fa da sola (data, campanella) non la tengono aperta: un PC lasciato acceso
 * su Copilota si scollega da solo.
 *
 * Qui stanno anche i cookie del codice via email degli amministratori (rotte/auth.ts):
 * `logbook_attesa` (accesso in attesa del codice) e `logbook_pc` (PC fidato per 30 giorni,
 * impronta nella tabella DispositivoFidato).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';

const NOME_COOKIE = 'logbook_sessione';
export const COOKIE_PC_FIDATO = 'logbook_pc';
const DURATA_SESSIONE_MS = 12 * 60 * 60 * 1000;
/** Dopo quanto tempo senza azioni la sessione si chiude. */
export const INATTIVITA_MS = 15 * 60 * 1000;
/** Ogni quanto, al massimo, si riscrive nel database l'ora dell'ultima azione. */
const PASSO_ATTIVITA_MS = 30 * 1000;
export const DURATA_PC_FIDATO_MS = 30 * 24 * 60 * 60 * 1000;

export const improntaToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const nuovoToken = () => randomBytes(32).toString('base64url');

/** Legge un cookie dall'intestazione della richiesta (senza dipendenza cookie-parser). */
export function leggiCookie(req: Request, nome: string): string | undefined {
  const intestazione = req.headers.cookie;
  if (!intestazione) return undefined;
  for (const parte of intestazione.split(';')) {
    const [chiave, ...valore] = parte.trim().split('=');
    if (chiave !== nome) continue;
    // Un cookie malformato (es. "%E0%A4%A", che un'altra app sullo stesso indirizzo può
    // impostare) non deve far fallire con 500 ogni chiamata: vale come "nessuna sessione".
    try {
      return decodeURIComponent(valore.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Scrive (o, con maxAge 0, cancella) un cookie HttpOnly di Copilota. */
export function scriviCookie(res: Response, nome: string, valore: string, maxAgeSecondi: number) {
  const attributi = [`${nome}=${encodeURIComponent(valore)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(maxAgeSecondi)}`];
  // Secure se lo dice il .env oppure se la richiesta è arrivata in HTTPS (req.secure: dietro il
  // proxy della suite vale l'intestazione X-Forwarded-Proto, vedi 'trust proxy' in app.ts).
  // Verifica del Giorno 33: prima dipendeva solo dalla variabile, e dimenticarla lasciava il
  // cookie di sessione libero di viaggiare in chiaro.
  if (process.env.LOGBOOK_COOKIE_SECURE === '1' || res.req.secure) attributi.push('Secure');
  res.append('Set-Cookie', attributi.join('; '));
}

/** Apre una sessione per l'utente e imposta il cookie nella risposta. */
export async function apriSessione(prisma: PrismaClient, res: Response, utenteId: number) {
  const token = nuovoToken();
  await prisma.sessione.create({
    data: { id: improntaToken(token), utenteId, scadeIl: new Date(Date.now() + DURATA_SESSIONE_MS) },
  });
  // Pulizia opportunistica delle sessioni scadute o ferme di tutti: evita che la tabella cresca.
  await prisma.sessione.deleteMany({ where: { OR: [{ scadeIl: { lt: new Date() } }, { ultimoUsoIl: { lt: new Date(Date.now() - INATTIVITA_MS) } }] } });
  scriviCookie(res, NOME_COOKIE, token, DURATA_SESSIONE_MS / 1000);
}

/** Chiude la sessione del cookie (se c'è) e cancella il cookie dal browser. */
export async function chiudiSessione(prisma: PrismaClient, req: Request, res: Response) {
  const token = leggiCookie(req, NOME_COOKIE);
  if (token) await prisma.sessione.deleteMany({ where: { id: improntaToken(token) } });
  scriviCookie(res, NOME_COOKIE, '', 0);
}

/**
 * Utente della sessione del cookie, solo se la sessione non è scaduta, non è ferma da più
 * di 15 minuti e l'utente è attivo. null in tutti gli altri casi. Se la richiesta porta
 * un'azione dell'utente (X-Logbook-Attivo: 1) aggiorna l'ora dell'ultima azione.
 */
export async function utenteDaSessione(prisma: PrismaClient, req: Request) {
  const token = leggiCookie(req, NOME_COOKIE);
  if (!token) return null;
  const id = improntaToken(token);
  const sessione = await prisma.sessione.findUnique({
    where: { id },
    include: { utente: { include: { dipendente: { select: { nome: true, cognome: true, stato: true } } } } },
  });
  if (!sessione) return null;
  const adesso = Date.now();
  if (sessione.scadeIl.getTime() < adesso || adesso - sessione.ultimoUsoIl.getTime() > INATTIVITA_MS) {
    // deleteMany: se un'altra richiesta l'ha già tolta non è un errore.
    await prisma.sessione.deleteMany({ where: { id } });
    return null;
  }
  if (!sessione.utente.attivo) return null;
  if (req.get('X-Logbook-Attivo') === '1' && adesso - sessione.ultimoUsoIl.getTime() > PASSO_ATTIVITA_MS) {
    await prisma.sessione.updateMany({ where: { id }, data: { ultimoUsoIl: new Date(adesso) } });
  }
  return sessione.utente;
}

/** true se il browser ha il cookie di un PC fidato valido per questo utente. */
export async function pcFidato(prisma: PrismaClient, req: Request, utenteId: number): Promise<boolean> {
  const token = leggiCookie(req, COOKIE_PC_FIDATO);
  if (!token) return false;
  const d = await prisma.dispositivoFidato.findUnique({ where: { id: improntaToken(token) } });
  return !!d && d.utenteId === utenteId && d.scadeIl.getTime() > Date.now();
}

/** Segna questo browser come PC fidato dell'utente per 30 giorni. */
export async function fidatiDelPc(prisma: PrismaClient, res: Response, utenteId: number) {
  const token = nuovoToken();
  await prisma.dispositivoFidato.deleteMany({ where: { scadeIl: { lt: new Date() } } });
  await prisma.dispositivoFidato.create({ data: { id: improntaToken(token), utenteId, scadeIl: new Date(Date.now() + DURATA_PC_FIDATO_MS) } });
  scriviCookie(res, COOKIE_PC_FIDATO, token, DURATA_PC_FIDATO_MS / 1000);
}
