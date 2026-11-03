// "><(((º> sabusabu <º)))><"
/**
 * Token di servizio della suite davanti al gate SSO: col token giusto sulle
 * rotte /api/documenti, /api/verifiche, /api/requisiti si entra come "suite";
 * negli altri casi comanda il gate.
 */
import { Request, Response } from 'express';
import { conTokenSuite, identitaSuite, PERCORSI_SUITE } from '../middleware/suiteToken';

function richiesta(path: string, headers: Record<string, string> = {}): Request {
  return { path, get: (h: string) => headers[h.toLowerCase()] } as unknown as Request;
}

describe('conTokenSuite', () => {
  const verifica = (v: string | undefined) => v === 'token-di-prova';
  const gate = jest.fn((req, res, next) => next('gate'));
  const res = {} as Response;
  beforeEach(() => gate.mockClear());

  it('token giusto su una rotta della suite: passa senza gate, identità suite', () => {
    const next = jest.fn();
    const req = richiesta('/api/documenti', { 'x-suite-token': 'token-di-prova', 'x-suite-utente': 'mrossi', 'x-suite-nome': 'Mario Rossi' });
    conTokenSuite(gate, verifica)(req, res, next);
    expect(gate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(req.cosedil).toEqual({ username: 'mrossi', nome: 'Mario Rossi', ruolo: 'suite', admin: false });
  });

  it('token sbagliato, assente o rotta fuori elenco: comanda il gate', () => {
    for (const [path, headers] of [
      ['/api/documenti', { 'x-suite-token': 'altro' }],
      ['/api/documenti', {}],
      ['/api/prompts', { 'x-suite-token': 'token-di-prova' }],
      ['/', { 'x-suite-token': 'token-di-prova' }],
    ] as Array<[string, Record<string, string>]>) {
      const next = jest.fn();
      const req = richiesta(path, headers);
      conTokenSuite(gate, verifica)(req, res, next);
      expect(next).toHaveBeenCalledWith('gate');
      expect(req.cosedil).toBeUndefined();
    }
    expect(gate).toHaveBeenCalledTimes(4);
  });

  it('identità di ripiego e prefissi', () => {
    expect(identitaSuite(richiesta('/api/verifiche'))).toEqual({ username: 'suite', nome: 'Suite Cosedil', ruolo: 'suite', admin: false });
    expect(PERCORSI_SUITE).toEqual(['/api/documenti', '/api/verifiche', '/api/requisiti']);
  });
});
