// "><(((º> sabusabu <º)))><"
/**
 * proxyMagazzino.ts — la sezione Magazzino di "DDT e Magazzino" (contratto C2, 09/11/2026).
 *
 * Il Magazzino Operativo resta un programma Flask a sé (127.0.0.1:5200), ma chi lo usa ci arriva dallo
 * stesso indirizzo del Lettore DDT: /magazzino/* viene girato al Magazzino togliendo il prefisso.
 * Così c'è un solo indirizzo, un solo login (il gate SSO del Lettore DDT sta davanti a tutto) e, sul
 * telefono in cantiere, una sola pagina da salvare nella schermata Home.
 *
 * Cosa fa il proxy:
 *  - inoltra metodo, corpo (anche multipart: le foto dei mezzi), cookie e intestazioni; è montato in
 *    app.ts PRIMA dei parser JSON, quindi il corpo arriva intatto;
 *  - aggiunge X-Forwarded-Prefix: /magazzino (il Magazzino costruisce i suoi indirizzi sotto il
 *    prefisso), X-Forwarded-Host/-Proto/-For, e X-Suite-Commessa = commessa scelta all'ingresso
 *    (services/commessaSessione), che il Magazzino usa come filtro proposto. Le X-Suite-* e
 *    X-Forwarded-* arrivate dal browser si buttano: le mette solo il proxy;
 *  - riscrive i redirect del Magazzino sotto /magazzino;
 *  - nella pagina principale del Magazzino aggiunge la barra comune (/guscio/barra.js): "Lettore DDT |
 *    Magazzino", commessa corrente, "Cambia commessa";
 *  - ogni richiesta conta come attività (utils/attivita): i telefoni non chiamano /ping;
 *  - Magazzino spento: lo accende (services/magazzinoProcesso) e risponde con una pagina "sto avviando
 *    il magazzino…" che si ricarica da sola (alle chiamate API un 503 con lo stesso messaggio).
 */
import http from 'http';
import type { Request, Response } from 'express';
import logger from '../utils/logger';
import { segnaAttivita } from '../utils/attivita';
import { avviaMagazzino, avvioAutomatico, urlMagazzino } from './magazzinoProcesso';

export const PREFISSO = '/magazzino';
export const SCRIPT_BARRA =
  '<script src="/guscio/barra.js" data-sezione="magazzino" defer></script>';

// Intestazioni hop-by-hop: valgono per una connessione, non si inoltrano (RFC 9110 §7.6.1).
const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Valore di un'intestazione HTTP: solo ASCII stampabile, altrimenti codificato (codici commessa strani). */
function valoreHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : encodeURIComponent(v);
}

/**
 * Riscrive il Location di un redirect del Magazzino. Assoluto verso il Magazzino stesso → relativo
 * sotto /magazzino; relativo alla radice ("/x") → "/magazzino/x" (se non lo è già); verso altri
 * indirizzi (es. il portale per il login) → invariato.
 */
export function riscriviLocation(location: string, base = urlMagazzino()): string {
  let loc = location;
  const origine = new URL(base).origin;
  if (loc.startsWith(origine)) loc = loc.slice(origine.length) || '/';
  if (!loc.startsWith('/') || loc.startsWith('//')) return loc;
  if (loc === PREFISSO || loc.startsWith(`${PREFISSO}/`) || loc.startsWith(`${PREFISSO}?`))
    return loc;
  return PREFISSO + loc;
}

/** Aggiunge la barra comune a una pagina HTML (prima di </head>, altrimenti di </body>, altrimenti in coda). */
export function iniettaBarra(html: string): string {
  if (html.includes('/guscio/barra.js')) return html;
  const testa = html.search(/<\/head>/i);
  if (testa >= 0) return html.slice(0, testa) + SCRIPT_BARRA + html.slice(testa);
  const corpo = html.search(/<\/body>/i);
  if (corpo >= 0) return html.slice(0, corpo) + SCRIPT_BARRA + html.slice(corpo);
  return html + SCRIPT_BARRA;
}

/** Solo la pagina principale del Magazzino ha la barra (non le etichette da stampare, non le API). */
function paginaPrincipale(percorso: string): boolean {
  const p = percorso.split('?')[0];
  return p === '/' || p === '/index.html';
}

function cortesia(req: Request, res: Response, avvio: boolean): void {
  const msg = avvio
    ? 'Sto avviando il magazzino: un momento, la pagina si ricarica da sola.'
    : 'Il magazzino non è acceso. Avvisa un amministratore.';
  res.setHeader('Retry-After', '5');
  res.setHeader('Cache-Control', 'no-store');
  if ((req.headers.accept || '').includes('text/html')) {
    res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          (avvio ? '<meta http-equiv="refresh" content="3">' : '') +
          '<title>Magazzino — Cosedil</title><style>body{font-family:"Open Sans","Segoe UI",system-ui,sans-serif;background:#f9f9fb;color:#212326;margin:0}' +
          'main{max-width:30rem;margin:18vh auto;padding:2rem;background:#fff;border:1px solid #e5e7eb;border-top:3px solid #0c4577;border-radius:8px}' +
          'h1{font-family:Ubuntu,"Segoe UI",sans-serif;font-weight:400;color:#0c4577;margin:0 0 .5rem}a{color:#0c4577}</style></head><body>' +
          SCRIPT_BARRA +
          `<main><h1>Magazzino</h1><p>${msg}</p><p><a href="/">Torna al Lettore DDT</a></p></main></body></html>`
      );
    return;
  }
  res.status(503).json({ error: msg });
}

/**
 * Middleware da montare con app.use('/magazzino', …): req.url è già senza prefisso.
 * commessaPer(req) = codice da mettere in X-Suite-Commessa ('' = nessuno).
 */
export function proxyMagazzino(opts: { commessaPer?: (req: Request) => string } = {}) {
  return (req: Request, res: Response): void => {
    segnaAttivita();
    const [percorsoPieno, query] = (req.originalUrl || '').split('?');
    // "/magazzino" senza barra finale: le pagine del Magazzino usano percorsi relativi alla cartella
    if (percorsoPieno === PREFISSO) {
      res.redirect(301, `${PREFISSO}/${query ? `?${query}` : ''}`);
      return;
    }
    let base: URL;
    try {
      base = new URL(urlMagazzino());
    } catch {
      cortesia(req, res, false);
      return;
    }
    const percorso = req.url && req.url.startsWith('/') ? req.url : `/${req.url || ''}`;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const nome = k.toLowerCase();
      if (HOP.has(nome) || nome.startsWith('x-suite-') || nome.startsWith('x-forwarded-')) continue;
      if (v !== undefined) headers[nome] = v;
    }
    headers.host = base.host;
    // Niente compressione dal Magazzino: la pagina principale va letta per aggiungerci la barra.
    headers['accept-encoding'] = 'identity';
    headers['x-forwarded-prefix'] = PREFISSO;
    headers['x-forwarded-host'] = String(req.headers.host || '');
    headers['x-forwarded-proto'] = req.protocol || 'http';
    headers['x-forwarded-for'] = String(req.ip || req.socket.remoteAddress || '');
    const commessa = opts.commessaPer ? opts.commessaPer(req) : '';
    if (commessa) headers['x-suite-commessa'] = valoreHeader(commessa);

    const verso = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        method: req.method,
        path: percorso,
        headers,
        timeout: 120_000,
      },
      (risposta) => {
        segnaAttivita();
        const h: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(risposta.headers)) {
          if (!HOP.has(k.toLowerCase()) && v !== undefined) h[k] = v;
        }
        if (typeof h.location === 'string')
          h.location = riscriviLocation(h.location, base.toString());
        const stato = risposta.statusCode || 502;
        const html = /text\/html/i.test(String(risposta.headers['content-type'] || ''));
        if (!(req.method === 'GET' && stato === 200 && html && paginaPrincipale(percorso))) {
          res.writeHead(stato, h);
          risposta.pipe(res);
          return;
        }
        const pezzi: Buffer[] = [];
        risposta.on('data', (c: Buffer) => pezzi.push(c));
        risposta.on('end', () => {
          const pagina = Buffer.from(iniettaBarra(Buffer.concat(pezzi).toString('utf8')), 'utf8');
          delete h['content-length'];
          h['content-length'] = String(pagina.length);
          res.writeHead(stato, h);
          res.end(pagina);
        });
        risposta.on('error', () => res.destroy());
      }
    );
    verso.on('timeout', () => verso.destroy(new Error('timeout del Magazzino')));
    verso.on('error', (e: NodeJS.ErrnoException) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const spento = ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND'].includes(
        String(e.code)
      );
      if (spento && avvioAutomatico()) {
        void avviaMagazzino();
        cortesia(req, res, true);
        return;
      }
      logger.warn(`Proxy Magazzino: ${req.method} ${percorso} non riuscito: ${e.message}`);
      cortesia(req, res, false);
    });
    req.pipe(verso);
  };
}
