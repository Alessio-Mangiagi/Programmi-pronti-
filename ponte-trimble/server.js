// Ponte Trimble: PDF -> file -> Trimble.
// Server unico: serve la UI statica e le API. L'app sta dietro il gate SSO della
// suite (shared/sso) e ascolta su 127.0.0.1: in LAN ci si arriva dal portale.
import express from 'express';
import path from 'node:path';
import multer from 'multer';
import cosedilSSO from '../shared/sso/cosedil-sso.mjs';
import { CONFIG, RADICE, trimbleConfigurato } from './src/config.js';
import { log } from './src/log.js';
import * as archivio from './src/archivio.js';
import { accoda, statoCoda } from './src/coda.js';
import { caricaTraduttori } from './src/pipeline/traduci.js';
import { rotteLavori, ErroreRichiesta } from './src/rotte/lavori.js';
import { rotteTrimble } from './src/rotte/trimble.js';
import { rotteSkyTower } from './src/rotte/skytower.js';
import { ErroreTrimble } from './src/trimble/client.js';
import { ErroreFieldView } from './src/trimble/fieldview.js';
import { statoDestinazione } from './src/destinazione.js';

export const app = express();

app.disable('x-powered-by');
// Header di sicurezza scritti a mano (niente dipendenza nuova): la pagina carica solo app.js e
// stile.css dalla stessa origine, senza script né stili inline, quindi la CSP può essere stretta.
// frame-ancestors/X-Frame-Options: la UI admin non si incornicia in altre pagine (clickjacking).
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
    + "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
// adminOnly: l'app usa le credenziali Trimble aziendali e scrive sul tenant, quindi
// e' riservata agli admin del portale — che la nascondano o no le card della home,
// qui il gate risponde 403 a chiunque altro arrivi per URL diretto.
app.use(cosedilSSO({ app: 'trimble', adminOnly: true }));
app.use(express.static(path.join(RADICE, 'public')));

app.get('/api/salute', (req, res) => {
  res.json({
    ok: true,
    versione: process.env.npm_package_version || '0.1.0',
    coda: statoCoda(),
    destinazione: statoDestinazione(),
    trimble: { configurato: trimbleConfigurato() },
    utente: req.cosedil?.username ?? null,
  });
});

app.use('/api', rotteLavori);
app.use('/api', rotteTrimble);
app.use('/api', rotteSkyTower);     // documenti presi da SkyTower (shared/suite)

app.use('/api', (req, res) => res.status(404).json({ errore: 'rotta inesistente: ' + req.method + ' ' + req.originalUrl }));

// Gestore unico degli errori: il client riceve sempre { errore, dettaglio? } in JSON,
// lo stack resta nel log.
app.use((err, req, res, next) => {
  let stato = 500;
  let dettaglio;

  if (err instanceof ErroreRichiesta) stato = err.stato;
  else if (err instanceof ErroreTrimble || err instanceof ErroreFieldView) {
    stato = 502;                       // l'errore e' a monte: distinguerlo dai nostri 500
    // il corpo della risposta di Trimble/Field View (tenant, endpoint, dettagli interni) va nel
    // log, non al browser: al client basta sapere che il servizio a monte ha risposto male
    dettaglio = undefined;
    if (err.corpo) log.avviso('risposta a monte: ' + String(err.corpo).slice(0, 600));
  } else if (err instanceof multer.MulterError) {
    stato = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }

  const dove = req.method + ' ' + req.originalUrl + ' -> ' + stato + ': ' + err.message;
  if (err instanceof ErroreRichiesta) log.avviso(dove);        // errore atteso: niente stack
  else if (stato >= 500) log.errore(dove, { stack: err.stack });
  else log.avviso(dove);

  res.status(stato).json({ errore: err.message, dettaglio });
});

async function avvia(tentativo = 0) {
  // I traduttori si leggono all'avvio: chi ne consegna uno vede subito, in
  // console, se e' stato accettato o cosa manca al contratto.
  const traduttori = await caricaTraduttori();
  log.info('traduttori caricati: ' + (traduttori.caricati.join(', ') || 'nessuno'));
  for (const e of traduttori.errori) log.avviso('traduttore scartato -> ' + e);

  const ripresi = await archivio.recuperaInterrotti();
  for (const id of ripresi) accoda(id);
  if (ripresi.length) log.info('lavori ripresi dopo il riavvio: ' + ripresi.length);

  const server = app.listen(CONFIG.porta, CONFIG.host, () => {
    log.info('in ascolto su http://' + CONFIG.host + ':' + CONFIG.porta);
    const dest = statoDestinazione();
    // "><(((º> sabusabu <º)))><"
    log.info('destinazione: ' + dest.nome + (dest.configurata ? '' : ' — NON configurata: ' + dest.motivo));
  });

  // Istanza precedente ancora in chiusura: qualche secondo di pazienza prima di arrendersi.
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tentativo < 5) {
      log.avviso('porta ' + CONFIG.porta + ' occupata, ritento tra 2s (' + (tentativo + 1) + '/5)');
      setTimeout(() => avvia(tentativo + 1), 2000);
      return;
    }
    log.errore('avvio fallito: ' + e.message);
    process.exit(1);
  });
  return server;
}

// Importato dai test: nessun listen. Eseguito da `npm start`: parte.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(RADICE, 'server.js')) {
  avvia();
}
