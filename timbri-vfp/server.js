// "><(((º> sabusabu <º)))><"
/**
 * server.js — serve la pagina di Timbri per VFP dentro la suite Cosedil.
 *
 * La pagina (index.html + script.js + stamp.js + style.css) lavora tutta nel
 * browser: legge i PNG e scrive i .stamp senza mandare niente in rete. Il server
 * esiste solo perché il portale vuole ogni programma su una sua porta, dietro il
 * login del portale (gate SSO di shared/sso): così Timbri si avvia, si apre e si
 * abilita per utente come gli altri programmi (Gestione > Abilitazioni).
 *
 * Solo moduli core di Node, nessuna dipendenza: non serve npm install.
 * Variabili d'ambiente: PORT (default 5205), HOST (default 127.0.0.1; il portale
 * passa il suo quando avvia l'app), più quelle del gate SSO (COSEDIL_PORTAL,
 * COSEDIL_SSO, COSEDIL_SSO_FAIL — vedi shared/sso/README.md).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const cosedilSSO = require('../shared/sso/cosedil-sso.js');

// Id dell'app nel registro APPS del portale (portale/server.js): il gate lo
// manda a /api/verify?app=timbri, e il portale risponde 403 a chi non ha la
// spunta "Timbri per VFP" — l'app è riservata.
const APP_ID = 'timbri';
const PORT = Number(process.env.PORT) || 5205;
const HOST = process.env.HOST || '127.0.0.1';

// Gli unici file serviti. Elenco chiuso invece di una cartella statica: niente
// path traversal da controllare, e timbro.js (riga di comando), README e
// server.js non escono mai dal disco.
const FILE = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/stamp.js', ['stamp.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

// CSP: la pagina non ha script né stili inline e non chiama server esterni.
// img-src blob: serve alle anteprime dei PNG (URL.createObjectURL in script.js).
const INTESTAZIONI = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; "
    + "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Dopo un aggiornamento la pagina nuova si vede subito, senza svuotare la cache.
  'Cache-Control': 'no-cache',
};

function testo(res, codice, messaggio) {
  res.writeHead(codice, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(messaggio);
}

// Legge dal disco a ogni richiesta (sono quattro file piccoli): una modifica
// alla pagina vale senza riavviare il server.
function serviFile(req, res, percorso) {
  const voce = FILE.get(percorso);
  if (!voce) return testo(res, 404, 'Pagina non trovata');
  const [nome, tipo] = voce;
  fs.readFile(path.join(__dirname, nome), (err, dati) => {
    if (err) return testo(res, 500, 'File della pagina mancante: ' + nome);
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': dati.length });
    res.end(req.method === 'HEAD' ? undefined : dati);
  });
}

/**
 * Crea il server HTTP senza metterlo in ascolto (lo usano anche i test).
 * opts.gate / opts.attivita: middleware connect-style (req, res, next); di
 * default il gate SSO e il segnale di presenza verso il portale (la plancia
 * mostra chi sta usando Timbri). Nei test si passano dei sostituti.
 */
function creaServer(opts = {}) {
  const gate = opts.gate || cosedilSSO({ app: APP_ID });
  const attivita = opts.attivita || cosedilSSO.cosedilAttivita({ app: APP_ID });
  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(INTESTAZIONI)) res.setHeader(k, v);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return testo(res, 405, 'Metodo non ammesso');
    }
    let percorso;
    try { percorso = new URL(req.url, 'http://x').pathname; } catch { return testo(res, 400, 'Indirizzo non valido'); }
    // /health fuori dal gate: dice solo "sono acceso", per i controlli dopo un riavvio.
    if (percorso === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, app: APP_ID }));
    }
    // La pagina passa dal gate (login del portale + spunta dell'utente); gli
    // asset .js/.css il gate li lascia passare da solo: sono codice, non dati.
    gate(req, res, () => attivita(req, res, () => serviFile(req, res, percorso)));
  });
}

if (require.main === module) {
  const server = creaServer();
  server.on('error', (err) => {
    // Porta occupata: di solito un'istanza precedente. avvia.bat la libera prima
    // (shared/avvia/libera-porta.bat); avviato a mano, lo si dice chiaro.
    console.error(err.code === 'EADDRINUSE'
      ? `Porta ${PORT} già occupata: Timbri per VFP è forse già acceso.`
      : `Avvio non riuscito: ${err.message}`);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Timbri per VFP in ascolto su http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
}

module.exports = { creaServer, APP_ID, PORT, FILE };
