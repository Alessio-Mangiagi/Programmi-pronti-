// "><(((º> sabusabu <º)))><"
/**
 * Token di servizio della suite davanti al gate SSO: col token giusto entra
 * come "suite" solo sulle rotte dell'elenco (metodo + percorso esatto), e le
 * risorse che vede sono solo quelle create dalla suite. Negli altri casi comanda
 * il gate. Revisione di sicurezza del 03/11/2026: prima il token apriva ogni rotta
 * sotto /api/documenti, /api/verifiche, /api/requisiti, compresi file e DELETE.
 */
import { Request, Response } from 'express';
import {
  conTokenSuite, identitaSuite, rottaAmmessaAlToken, visibileAlToken, ROTTE_SUITE,
} from '../middleware/suiteToken';
import { utenteDi } from '../middleware/auth';
import { motivoPatternRifiutato } from '../routes/requisiti.routes';

function richiesta(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return { path, method, get: (h: string) => headers[h.toLowerCase()] } as unknown as Request;
}

describe('conTokenSuite', () => {
  const verifica = (v: string | undefined) => v === 'token-di-prova';
  const gate = jest.fn((req, res, next) => next('gate'));
  const res = {} as Response;
  beforeEach(() => gate.mockClear());

  it('token giusto su una rotta ammessa: passa senza gate, identità suite', () => {
    const next = jest.fn();
    const req = richiesta('/api/documenti', { 'x-suite-token': 'token-di-prova', 'x-suite-utente': 'mrossi', 'x-suite-nome': 'Mario Rossi' }, 'POST');
    conTokenSuite(gate, verifica)(req, res, next);
    expect(gate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(req.cosedil).toEqual({ username: 'mrossi', nome: 'Mario Rossi', ruolo: 'suite', admin: false });
  });

  it('token sbagliato, assente o rotta/metodo fuori elenco: comanda il gate', () => {
    for (const [path, headers, method] of [
      ['/api/documenti', { 'x-suite-token': 'altro' }, 'POST'],
      ['/api/documenti', {}, 'POST'],
      ['/api/prompts', { 'x-suite-token': 'token-di-prova' }, 'GET'],
      ['/', { 'x-suite-token': 'token-di-prova' }, 'GET'],
      // prima passavano col solo prefisso: elenco completo, originale, testo OCR, cancellazione
      ['/api/documenti', { 'x-suite-token': 'token-di-prova' }, 'GET'],
      ['/api/documenti/doc_1/file', { 'x-suite-token': 'token-di-prova' }, 'GET'],
      ['/api/documenti/doc_1/testo', { 'x-suite-token': 'token-di-prova' }, 'GET'],
      ['/api/documenti/doc_1', { 'x-suite-token': 'token-di-prova' }, 'DELETE'],
      ['/api/requisiti/set_1', { 'x-suite-token': 'token-di-prova' }, 'PUT'],
      ['/api/verifiche/importa', { 'x-suite-token': 'token-di-prova' }, 'POST'],
    ] as Array<[string, Record<string, string>, string]>) {
      const next = jest.fn();
      const req = richiesta(path, headers, method);
      conTokenSuite(gate, verifica)(req, res, next);
      expect(next).toHaveBeenCalledWith('gate');
      expect(req.cosedil).toBeUndefined();
    }
    expect(gate).toHaveBeenCalledTimes(10);
  });

  it('elenco delle rotte ammesse', () => {
    expect(ROTTE_SUITE.map((r) => r.metodo)).toEqual(['POST', 'GET', 'POST', 'GET', 'GET']);
    expect(rottaAmmessaAlToken('GET', '/api/documenti/doc_1')).toBe(true);
    expect(rottaAmmessaAlToken('GET', '/api/verifiche/ver_1')).toBe(true);
    expect(rottaAmmessaAlToken('GET', '/api/requisiti')).toBe(true);
    expect(rottaAmmessaAlToken('GET', '/api/requisiti/set_1')).toBe(false);
  });

  it('identità di ripiego e marcatura delle risorse', () => {
    const suite = richiesta('/api/verifiche');
    suite.cosedil = identitaSuite(suite);
    expect(suite.cosedil).toEqual({ username: 'suite', nome: 'Suite Cosedil', ruolo: 'suite', admin: false });
    expect(utenteDi(suite)).toBe('suite:suite');
    const persona = richiesta('/api/verifiche');
    persona.cosedil = { username: 'mrossi', nome: 'Mario', ruolo: 'utente', admin: false };
    expect(utenteDi(persona)).toBe('mrossi');
    // il token vede solo ciò che ha creato la suite; un utente del portale vede tutto
    expect(visibileAlToken(suite, 'suite:mrossi')).toBe(true);
    expect(visibileAlToken(suite, 'mrossi')).toBe(false);
    expect(visibileAlToken(persona, 'mrossi')).toBe(true);
  });
});

describe('pattern delle checklist (ReDoS)', () => {
  it('rifiuta quantificatori annidati, backreference, lookaround e pattern lunghi', () => {
    expect(motivoPatternRifiutato('(a+)+$')).toMatch(/annidati/);
    expect(motivoPatternRifiutato(String.raw`(\w*)*x`)).toMatch(/annidati/);
    expect(motivoPatternRifiutato('(a)\\1')).toMatch(/riferimenti/);
    expect(motivoPatternRifiutato('(?=a)b')).toMatch(/lookahead/);
    expect(motivoPatternRifiutato('a'.repeat(101))).toMatch(/lungo/);
    expect(motivoPatternRifiutato('([')).toMatch(/non valido/);
  });
  it('accetta i pattern normali delle checklist', () => {
    expect(motivoPatternRifiutato(String.raw`scad\w*\s+(\d{2}/\d{2}/\d{4})`)).toBeNull();
    expect(motivoPatternRifiutato('DURC|regolarit[aà] contributiva')).toBeNull();
    expect(motivoPatternRifiutato(String.raw`(\d+)\s*(euro|€)`)).toBeNull();
  });
});
