// "><(((º> sabusabu <º)))><"
/**
 * Ingresso dal Portale senza seconda password (middleware ingressoDalPortale).
 *
 * L'archivio utenti è finto (jest.mock): users.enc non si tocca. La sessione è un oggetto
 * con regenerate() come quello di express-session; il gate SSO è acceso solo dentro questi
 * test (COSEDIL_SSO=on), perché il setup comune lo spegne.
 */
import type { NextFunction, Request, Response } from 'express';

const UTENTI: Record<string, { id: string; username: string; commessaId: string; displayName: string; isAdmin?: boolean; disabled?: boolean }> = {
  'a.mangiagi': { id: 'u1', username: 'A.Mangiagi', commessaId: 'default', displayName: 'Alessio', isAdmin: true },
  'f.leotta': { id: 'u2', username: 'f.leotta', commessaId: 'c-101-003', displayName: 'Francesca', disabled: true },
};
jest.mock('../models/users', () => ({
  findUserByUsernameCI: (u: string) => UTENTI[String(u).toLowerCase()],
}));
const attivita: unknown[][] = [];
jest.mock('../models/activityLog', () => ({ logActivity: (...a: unknown[]) => attivita.push(a) }));

import { ingressoDalPortale } from '../middleware/auth';

type Sessione = Record<string, unknown> & { regenerate: (cb: (err?: Error) => void) => void; rigenerata?: number };

function richiesta(portale: string | null, sessione: Record<string, unknown> = {}) {
  const s: Sessione = {
    ...sessione,
    regenerate(cb) {
      // come express-session: nuova sessione vuota (i dati della vecchia spariscono)
      for (const k of Object.keys(s)) if (k !== 'regenerate' && k !== 'rigenerata') delete s[k];
      s.rigenerata = (s.rigenerata || 0) + 1;
      cb();
    },
  };
  const req = {
    cosedil: portale ? { username: portale, nome: null, ruolo: 'utente', email: null, admin: false } : undefined,
    session: s,
    headers: {},
    socket: { remoteAddress: '10.0.0.4' },
    ip: '10.0.0.4',
  } as unknown as Request;
  return { req, s };
}

function passa(req: Request): Promise<void> {
  return new Promise((ok, ko) => {
    const next: NextFunction = (err?: unknown) => (err ? ko(err) : ok());
    ingressoDalPortale(req, {} as Response, next);
  });
}

describe('ingressoDalPortale', () => {
  const prima = process.env.COSEDIL_SSO;
  beforeAll(() => { process.env.COSEDIL_SSO = 'on'; });
  afterAll(() => { process.env.COSEDIL_SSO = prima; });
  beforeEach(() => { attivita.length = 0; });

  it('account DDT con lo stesso username del portale: entra senza login', async () => {
    const { req, s } = richiesta('a.mangiagi');
    await passa(req);
    expect(s).toMatchObject({ userId: 'u1', username: 'A.Mangiagi', commessaId: 'default', isAdmin: true, portaleUtente: 'a.mangiagi' });
    expect(s.rigenerata).toBe(1);
    expect(attivita[0][0]).toBe('login_success');
  });

  it('nessun account con quel nome o account disabilitato: resta il login a mano', async () => {
    for (const chi of ['g.ferrante', 'f.leotta']) {
      const { req, s } = richiesta(chi);
      await passa(req);
      expect(s.userId).toBeUndefined();
      expect(s.rigenerata).toBeUndefined();
    }
  });

  it('login a mano sull\'account della commessa: resta, finché nel portale c\'è la stessa persona', async () => {
    const { req, s } = richiesta('a.mangiagi', { userId: 'cantiere', username: 'cantiere-101', commessaId: 'c-101', portaleUtente: 'a.mangiagi' });
    await passa(req);
    expect(s.userId).toBe('cantiere');
    expect(s.rigenerata).toBeUndefined();
  });

  it('nel portale cambia persona sullo stesso browser: la sessione DDT dell\'altro si chiude', async () => {
    const { req, s } = richiesta('g.ferrante', { userId: 'u1', username: 'A.Mangiagi', commessaId: 'default', portaleUtente: 'a.mangiagi' });
    await passa(req);
    expect(s.rigenerata).toBe(1);
    expect(s.userId).toBeUndefined();
  });

  it('sessione aperta prima della regola: si lega a chi c\'è adesso nel portale', async () => {
    const { req, s } = richiesta('a.mangiagi', { userId: 'cantiere', username: 'cantiere-101', commessaId: 'c-101' });
    await passa(req);
    expect(s.userId).toBe('cantiere');
    expect(s.portaleUtente).toBe('a.mangiagi');
  });

  it('gate spento o nessuno nel portale: non fa niente', async () => {
    const { req, s } = richiesta(null);
    await passa(req);
    expect(s.userId).toBeUndefined();
    process.env.COSEDIL_SSO = 'off';
    const r2 = richiesta('a.mangiagi');
    await passa(r2.req);
    expect(r2.s.userId).toBeUndefined();
    process.env.COSEDIL_SSO = 'on';
  });
});
