// "><(((º> sabusabu <º)))><"
/**
 * Sessioni di accesso: token casuale nel cookie HttpOnly, impronta SHA-256 nel DB.
 *
 * Cookie `logbook_sessione`: HttpOnly (JavaScript non lo legge), SameSite=Lax (non
 * parte da form di altri siti), Secure solo se LOGBOOK_COOKIE_SECURE=1 (dietro HTTPS).
 * Durata fissa di 12 ore: copre una giornata di lavoro, poi si rifà il login.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';

const NOME_COOKIE = 'logbook_sessione';
const DURATA_SESSIONE_MS = 12 * 60 * 60 * 1000;

const impronta = (token: string) => createHash('sha256').update(token).digest('hex');

/** Legge un cookie dall'intestazione della richiesta (senza dipendenza cookie-parser). */
function leggiCookie(req: Request, nome: string): string | undefined {
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

function scriviCookie(res: Response, valore: string, maxAgeSecondi: number) {
  const attributi = [
    `${NOME_COOKIE}=${encodeURIComponent(valore)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSecondi}`,
  ];
  if (process.env.LOGBOOK_COOKIE_SECURE === '1') attributi.push('Secure');
  res.append('Set-Cookie', attributi.join('; '));
}

/** Apre una sessione per l'utente e imposta il cookie nella risposta. */
export async function apriSessione(prisma: PrismaClient, res: Response, utenteId: number) {
  const token = randomBytes(32).toString('base64url');
  await prisma.sessione.create({
    data: { id: impronta(token), utenteId, scadeIl: new Date(Date.now() + DURATA_SESSIONE_MS) },
  });
  // Pulizia opportunistica delle sessioni scadute di tutti: evita che la tabella cresca.
  await prisma.sessione.deleteMany({ where: { scadeIl: { lt: new Date() } } });
  scriviCookie(res, token, DURATA_SESSIONE_MS / 1000);
}

/** Chiude la sessione del cookie (se c'è) e cancella il cookie dal browser. */
export async function chiudiSessione(prisma: PrismaClient, req: Request, res: Response) {
  const token = leggiCookie(req, NOME_COOKIE);
  if (token) await prisma.sessione.deleteMany({ where: { id: impronta(token) } });
  scriviCookie(res, '', 0);
}

/**
 * Utente della sessione del cookie, solo se la sessione non è scaduta e l'utente è
 * attivo. null in tutti gli altri casi.
 */
export async function utenteDaSessione(prisma: PrismaClient, req: Request) {
  const token = leggiCookie(req, NOME_COOKIE);
  if (!token) return null;
  const sessione = await prisma.sessione.findUnique({
    where: { id: impronta(token) },
    include: { utente: { include: { dipendente: { select: { nome: true, cognome: true, stato: true } } } } },
  });
  if (!sessione || sessione.scadeIl < new Date() || !sessione.utente.attivo) return null;
  return sessione.utente;
}
