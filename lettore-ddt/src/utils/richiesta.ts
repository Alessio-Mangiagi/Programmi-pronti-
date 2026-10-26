// richiesta.ts — Da dove arriva davvero una richiesta: IP reale del client e
// "è l'utente seduto davanti al server?".
// "><(((º> sabusabu <º)))><"
//
// Dietro il reverse proxy della suite (deploy/Caddyfile, SUITE_DOMINIO) tutte le
// connessioni arrivano da 127.0.0.1: guardare solo il socket farebbe sembrare
// "locale" chiunque, con accesso a tutti i dischi del server, rate limit da
// 10000/min e /metrics aperto. Il proxy però aggiunge sempre gli header di
// inoltro, e un browser che parla direttamente con l'app non li manda.

import { Request } from 'express';

const HEADER_INOLTRO = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'via'];

/** Il socket TCP viene dal loopback? (Non spoofabile, ma vero anche dietro proxy.) */
export function socketLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress || '';
  return /^(127\.|::1$|::ffff:127\.)/.test(ip);
}

/** La richiesta è stata inoltrata da un proxy? */
export function inoltrata(req: Request): boolean {
  return HEADER_INOLTRO.some((h) => req.headers[h] !== undefined);
}

/**
 * Richiesta fatta da chi usa l'app sulla macchina che la ospita: socket dal
 * loopback E nessun proxy in mezzo. Da un altro PC non si ottiene né via socket
 * né aggiungendo header (che anzi la rendono "non locale").
 */
export function richiestaLocale(req: Request): boolean {
  return socketLoopback(req) && !inoltrata(req);
}

/**
 * IP del client. X-Forwarded-For vale solo se la connessione viene dal
 * loopback (il proxy sta sulla stessa macchina) o con trust proxy attivo
 * (req.ip lo gestisce Express): da un altro PC l'header sarebbe falsificabile.
 */
export function ipReale(req: Request): string {
  let ip = '';
  if (req.app?.get('trust proxy')) ip = req.ip || '';
  else if (socketLoopback(req)) {
    ip = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
  }
  if (!ip) ip = req.socket.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip || 'unknown';
}
