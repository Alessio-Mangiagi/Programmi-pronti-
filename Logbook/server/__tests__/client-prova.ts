// "><(((º> sabusabu <º)))><"
/**
 * Server di prova e client HTTP per i test delle API.
 *
 * `avviaServer` mette in ascolto l'app su una porta libera; `accedi` fa il login e
 * restituisce un client che rimanda il cookie di sessione e l'intestazione CSRF a ogni
 * chiamata, come fa il frontend vero (src/api.ts).
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '../../generated/prisma/client';
import { creaApp, type OpzioniApp } from '../app';

export type Risposta = { stato: number; corpo: any; intestazioni: Headers };

export type ClientProva = {
  chiama: (
    metodo: string,
    percorso: string,
    corpo?: unknown,
    opzioni?: { senzaCsrf?: boolean; grezzo?: Buffer; intestazioni?: Record<string, string> },
  ) => Promise<Risposta>;
};

/** Data "di oggi" usata nei test: la stessa del seed, così i risultati non cambiano nel tempo. */
export const OGGI_PROVA = '2026-11-23';

export async function avviaServer(prisma: PrismaClient, opzioni: OpzioniApp = { oggi: () => OGGI_PROVA }) {
  // Mai la cartella vera dei documenti (data/documenti): ogni server di prova ne ha una
  // temporanea, cancellata da chiudi().
  const cartellaDocumenti = opzioni.cartellaDocumenti ?? fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-doc-'));
  // Mai la cartella vera delle copie di sicurezza (data/backup): anche questa è temporanea.
  // Il codice via email all'accesso degli amministratori è spento, salvo che il test lo chieda.
  const cartellaBackup = opzioni.cartellaBackup ?? fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-copie-'));
  const server = creaApp(prisma, { codiceAccesso: false, ...opzioni, cartellaDocumenti, cartellaBackup }).listen(0, '127.0.0.1');
  await new Promise((ok) => server.once('listening', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** Client con (o senza) cookie di sessione. */
  const client = (cookie?: string): ClientProva => ({
    async chiama(metodo, percorso, corpo, opzioni = {}) {
      const intestazioni: Record<string, string> = {};
      if (!opzioni.senzaCsrf) intestazioni['X-Logbook'] = '1';
      if (cookie) intestazioni.Cookie = cookie;
      Object.assign(intestazioni, opzioni.intestazioni);
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
    cartellaDocumenti,
    anonimo: client(),
    /** Login: restituisce il client autenticato; fallisce il test se il login non riesce. */
    async accedi(username: string, password: string): Promise<ClientProva> {
      const r = await client().chiama('POST', '/api/auth/login', { username, password });
      if (r.stato !== 200) throw new Error(`Login di ${username} fallito: ${r.stato} ${JSON.stringify(r.corpo)}`);
      const cookie = (r.intestazioni.get('set-cookie') ?? '').split(';')[0];
      return client(cookie);
    },
    chiudi: async () => {
      await new Promise<void>((ok) => server.close(() => ok()));
      fs.rmSync(cartellaDocumenti, { recursive: true, force: true });
      if (!opzioni.cartellaBackup) fs.rmSync(cartellaBackup, { recursive: true, force: true });
    },
  };
}
