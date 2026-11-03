// "><(((º> sabusabu <º)))><"
import { Request } from 'express';
import { ipReale, richiestaLocale } from '../utils/richiesta';
import { neutralizzaFormula } from '../utils/csv';
import { toCsv } from '../routes/helpers';

function req(remoteAddress: string, headers: Record<string, string> = {}): Request {
  return {
    socket: { remoteAddress },
    headers,
    app: { get: () => false },
  } as unknown as Request;
}

describe('utils/richiesta', () => {
  it('loopback senza proxy → locale', () => {
    expect(richiestaLocale(req('127.0.0.1'))).toBe(true);
    expect(richiestaLocale(req('::1'))).toBe(true);
    expect(richiestaLocale(req('::ffff:127.0.0.1'))).toBe(true);
  });

  it('loopback inoltrato dal reverse proxy → NON locale', () => {
    expect(richiestaLocale(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.50' }))).toBe(false);
    expect(richiestaLocale(req('127.0.0.1', { via: '1.1 Caddy' }))).toBe(false);
  });

  it('da un altro PC → mai locale', () => {
    expect(richiestaLocale(req('192.168.1.50'))).toBe(false);
  });

  it('ipReale: X-Forwarded-For solo se la connessione viene dal loopback', () => {
    expect(ipReale(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.50, 10.0.0.1' }))).toBe(
      '192.168.1.50'
    );
    expect(ipReale(req('192.168.1.7', { 'x-forwarded-for': '1.2.3.4' }))).toBe('192.168.1.7');
    expect(ipReale(req('::ffff:192.168.1.7'))).toBe('192.168.1.7');
    expect(ipReale(req('::1'))).toBe('127.0.0.1');
  });
});

describe('utils/csv', () => {
  it('neutralizza le formule', () => {
    expect(neutralizzaFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizzaFormula('+cmd')).toBe("'+cmd");
    expect(neutralizzaFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizzaFormula('-2+3')).toBe("'-2+3");
  });

  it('lascia stare numeri, testo normale e il trattino da solo', () => {
    expect(neutralizzaFormula('-12,5')).toBe('-12,5');
    expect(neutralizzaFormula('+3')).toBe('+3');
    expect(neutralizzaFormula('-')).toBe('-');
    expect(neutralizzaFormula('Cemento 32,5')).toBe('Cemento 32,5');
  });

  it('toCsv applica la neutralizzazione', () => {
    expect(toCsv(['a'], [['=1+1'], [-5]])).toBe("a\r\n'=1+1\r\n-5");
  });
});

// ── Revisione di sicurezza del 03/11/2026 ──────────────────────────────────
// Con il gate del portale attivo, la sessione DDT da sola non basta: serve anche
// l'identità messa dal gate (req.cosedil); e l'admin DDT deve essere admin anche nel portale.
import { requireAuth as _requireAuth, requireAdmin as _requireAdmin } from '../middleware/auth';
import { pathAllowed as _pathAllowed } from '../routes/batchAccesso';
import { config as _cfg } from '../config';

describe('identità del portale obbligatoria (gate attivo)', () => {
  const vecchio = process.env.COSEDIL_SSO;
  beforeAll(() => { process.env.COSEDIL_SSO = 'on'; });
  afterAll(() => { process.env.COSEDIL_SSO = vecchio; });
  const risposta = () => {
    const r = { statusCode: 0, status(c: number) { r.statusCode = c; return r; }, json() { return r; } };
    return r;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = (sessione: any, cosedil?: any) => ({ session: sessione, cosedil }) as any;

  it('sessione DDT senza identità del portale → 401', () => {
    const res = risposta(); const next = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _requireAuth(req({ userId: 'u', commessaId: 'c' }), res as any, next);
    expect(res.statusCode).toBe(401); expect(next).not.toHaveBeenCalled();
  });
  it('sessione DDT + portale → passa', () => {
    const res = risposta(); const next = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _requireAuth(req({ userId: 'u', commessaId: 'c' }, { username: 'm', admin: false }), res as any, next);
    expect(next).toHaveBeenCalled();
  });
  it('admin DDT ma non admin nel portale → 403', () => {
    const res = risposta(); const next = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _requireAdmin(req({ userId: 'u', isAdmin: true }, { username: 'm', admin: false }), res as any, next);
    expect(res.statusCode).toBe(403); expect(next).not.toHaveBeenCalled();
  });
  it('admin DDT e admin nel portale → passa', () => {
    const res = risposta(); const next = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _requireAdmin(req({ userId: 'u', isAdmin: true }, { username: 'm', admin: true }), res as any, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('cartelle del server in modalità server centrale', () => {
  it('con serverMode anche dalla macchina stessa valgono le radici consentite', () => {
    const prima = _cfg.serverMode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locale = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as any;
    try {
      _cfg.serverMode = false;
      expect(_pathAllowed(locale, 'C:\\Windows')).toBe(true);
      _cfg.serverMode = true;
      expect(_pathAllowed(locale, 'C:\\Windows')).toBe(false);
    } finally {
      _cfg.serverMode = prima;
    }
  });
});
