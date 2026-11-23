// "><(((º> sabusabu <º)))><"
/**
 * Server di prova e client HTTP per i test delle API.
 *
 * `avviaServer` mette in ascolto l'app su una porta libera; `accedi` fa il login e
 * restituisce un client che rimanda il cookie di sessione e l'intestazione CSRF a ogni
 * chiamata, come fa il frontend vero (src/api.ts).
 */
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '../../generated/prisma/client';
import { creaApp } from '../app';

export type Risposta = { stato: number; corpo: any; intestazioni: Headers };

export type ClientProva = {
  chiama: (metodo: string, percorso: string, corpo?: unknown, opzioni?: { senzaCsrf?: boolean; grezzo?: Buffer }) => Promise<Risposta>;
};

export async function avviaServer(prisma: PrismaClient) {
  const server = creaApp(prisma).listen(0, '127.0.0.1');
  await new Promise((ok) => server.once('listening', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** Client con (o senza) cookie di sessione. */
  const client = (cookie?: string): ClientProva => ({
    async chiama(metodo, percorso, corpo, opzioni = {}) {
      const intestazioni: Record<string, string> = {};
      if (!opzioni.senzaCsrf) intestazioni['X-Logbook'] = '1';
      if (cookie) intestazioni.Cookie = cookie;
      let body: RequestInit['body'];
      if (opzioni.grezzo) {
        intestazioni['Content-Type'] = 'application/octet-stream';
        body = new Uint8Array(opzioni.grezzo);
      } else if (corpo !== undefined) {
        intestazioni['Content-Type'] = 'application/json';
        body = JSON.stringify(corpo);
      }
      const r = await fetch(base + percorso, { method: metodo, headers: intestazioni, body });
      const tipo = r.headers.get('content-type') ?? '';
      const contenuto = tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
      return { stato: r.status, corpo: contenuto, intestazioni: r.headers };
    },
  });

  return {
    base,
    anonimo: client(),
    /** Login: restituisce il client autenticato; fallisce il test se il login non riesce. */
    async accedi(username: string, password: string): Promise<ClientProva> {
      const r = await client().chiama('POST', '/api/auth/login', { username, password });
      if (r.stato !== 200) throw new Error(`Login di ${username} fallito: ${r.stato} ${JSON.stringify(r.corpo)}`);
      const cookie = (r.intestazioni.get('set-cookie') ?? '').split(';')[0];
      return client(cookie);
    },
    chiudi: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
