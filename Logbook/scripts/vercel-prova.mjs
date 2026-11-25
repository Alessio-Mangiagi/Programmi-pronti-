// "><(((º> sabusabu <º)))><"
/**
 * Prova in locale il pacchetto per Vercel prodotto da scripts/vercel-build.mjs (Giorno 35).
 *
 * Fa quello che su Vercel fa la piattaforma, in piccolo: le richieste a /api/… vanno alla
 * funzione (.vercel/output/functions/api.func/index.mjs), tutto il resto ai file di
 * .vercel/output/static, con index.html per gli indirizzi delle pagine. Serve a controllare,
 * prima di pubblicare, che il server impacchettato parta e parli con il database PostgreSQL.
 *
 * Uso: DATABASE_URL=postgres://… node scripts/vercel-prova.mjs [porta]   (default 5298)
 * VERCEL=1 viene impostata qui, così il codice si comporta come sulla piattaforma.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.VERCEL = '1';
const uscita = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.vercel', 'output');
const statici = path.join(uscita, 'static');
const { default: funzione } = await import(pathToFileURL(path.join(uscita, 'functions', 'api.func', 'index.mjs')).href);
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };
const porta = Number(process.argv[2] ?? 5298);

http
  .createServer((req, res) => {
    const percorso = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (percorso === '/api' || percorso.startsWith('/api/')) {
      // Come la rete di Vercel: dice alla funzione da dove arriva la richiesta.
      req.headers['x-forwarded-for'] ??= req.socket.remoteAddress ?? '127.0.0.1';
      req.headers['x-forwarded-proto'] ??= 'http';
      return funzione(req, res);
    }
    let file = path.join(statici, path.normalize(percorso));
    if (!file.startsWith(statici) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(statici, 'index.html');
    res.writeHead(200, { 'Content-Type': TIPI[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(porta, '127.0.0.1', () => console.log(`[logbook] pacchetto Vercel in prova su http://127.0.0.1:${porta}`));
