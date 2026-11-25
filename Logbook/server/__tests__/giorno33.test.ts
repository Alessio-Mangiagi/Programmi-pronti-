// "><(((º> sabusabu <º)))><"
/**
 * Giorno 33 (25/11/2026) — seconda verifica di sicurezza ("scandaglia tutta l'app e verifica
 * se ci sono dei problemi e chiudili"). Controlla le quattro correzioni:
 * - limite dei login falliti anche per indirizzo, qualunque nome utente si provi;
 * - cookie di sessione Secure e intestazione HSTS quando la richiesta arriva in HTTPS;
 * - risposte delle API mai conservate da browser e proxy (Cache-Control: no-store);
 * - l'account del proprietario non si modifica né si disattiva da un altro amministratore.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { creaImpronta } from '../auth/password';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
const opzioni = { oggi: () => OGGI_PROVA, proprietario: { username: 'admin', email: 'proprietario@esempio.it' }, inviaEmail: null };

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  await db.prisma.utente.create({ data: { username: 'hr.due', passwordHash: await creaImpronta('SecondoHr2026'), ruolo: 'ADMIN' } });
});
afterAll(async () => {
  await db.chiudi();
});

describe('login: limite per indirizzo', () => {
  it('30 tentativi falliti con nomi diversi bloccano l\'indirizzo; i login riusciti non contano', async () => {
    const server = await avviaServer(db.prisma, opzioni);
    try {
      const login = (username: string, password: string) => server.anonimo.chiama('POST', '/api/auth/login', { username, password });
      // I login riusciti non consumano il limite.
      for (let i = 0; i < 3; i++) expect((await login('admin', CREDENZIALI_DEMO.admin.password)).stato).toBe(200);
      const stati: number[] = [];
      for (let i = 0; i < 30; i++) stati.push((await login(`inesistente${i}`, 'Sbagliata1')).stato);
      expect(stati.every((s) => s === 401)).toBe(true);
      // Dal 31º in poi l'indirizzo è fermo, anche con le credenziali giuste.
      expect((await login('altro.nome', 'Sbagliata1')).stato).toBe(429);
      expect((await login('admin', CREDENZIALI_DEMO.admin.password)).stato).toBe(429);
    } finally {
      await server.chiudi();
    }
  }, 60_000);
});

describe('HTTPS e cache', () => {
  it('in HTTPS il cookie è Secure e c\'è HSTS; in HTTP no; le API non vanno in cache', async () => {
    const server = await avviaServer(db.prisma, opzioni);
    try {
      const corpo = { username: 'admin', password: CREDENZIALI_DEMO.admin.password };
      const http = await server.anonimo.chiama('POST', '/api/auth/login', corpo);
      expect(http.intestazioni.get('set-cookie')).not.toMatch(/Secure/);
      expect(http.intestazioni.get('strict-transport-security')).toBeNull();
      expect(http.intestazioni.get('cache-control')).toBe('no-store');
      // Dietro il proxy della suite (collegato da 127.0.0.1) la richiesta originale era HTTPS.
      const https = await server.anonimo.chiama('POST', '/api/auth/login', corpo, { intestazioni: { 'X-Forwarded-Proto': 'https' } });
      expect(https.intestazioni.get('set-cookie')).toMatch(/; Secure/);
      expect(https.intestazioni.get('strict-transport-security')).toBe('max-age=31536000');
    } finally {
      await server.chiudi();
    }
  });
});

describe('account del proprietario', () => {
  it('un altro amministratore non lo modifica né lo disattiva; il proprietario sì', async () => {
    const server = await avviaServer(db.prisma, opzioni);
    try {
      // Il proprietario collegato a una scheda dipendente: è il caso in cui l'account è
      // raggiungibile dalla pagina del dipendente.
      const scheda = await db.prisma.dipendente.create({
        data: { matricola: 'IND-0900', nome: 'Paolo', cognome: 'Titolare', codiceFiscale: 'TTLPLA80A01H501X', dataAssunzione: '2020-01-01', tipoContratto: 'INDETERMINATO', oreSettimanali: 40 },
      });
      await db.prisma.utente.update({ where: { username: 'admin' }, data: { dipendenteId: scheda.id } });
      const altro = await server.accedi('hr.due', 'SecondoHr2026');
      const proprietario = await server.accedi('admin', CREDENZIALI_DEMO.admin.password);

      const presa = await altro.chiama('PUT', `/api/dipendenti/${scheda.id}/account`, { username: 'admin', password: 'PresoDaHr2026', attivo: true });
      expect(presa.stato).toBe(403);
      expect((await altro.chiama('POST', `/api/dipendenti/${scheda.id}/disattiva`, {})).stato).toBe(403);
      // La password del proprietario è rimasta la sua.
      expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'admin', password: 'PresoDaHr2026' })).stato).toBe(401);
      // Sugli altri account l'altro amministratore lavora come prima.
      const mario = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
      expect((await altro.chiama('PUT', `/api/dipendenti/${mario.id}/account`, { username: 'mario.rossi', password: 'NuovaMario2026', attivo: true })).stato).toBe(200);
      // Il proprietario può sistemare il proprio account.
      expect((await proprietario.chiama('PUT', `/api/dipendenti/${scheda.id}/account`, { username: 'admin', attivo: true })).stato).toBe(200);
    } finally {
      await server.chiudi();
    }
  });
});
