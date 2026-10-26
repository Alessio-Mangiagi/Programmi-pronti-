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
