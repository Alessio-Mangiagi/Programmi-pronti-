/**
 * system.routes.ts — ping, stato, metriche, file statici e frontend.
 */
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { register } from '../utils/metrics';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { VERSION, config } from '../config';
import { requireAuth } from '../middleware/auth';
import { contaDocumenti } from '../models/archivio';
import { documentiIndicizzati } from '../services/indice';
import { documentiInCoda } from '../services/estrazione';
import { statoMotori } from '../services/ocr';
import { DATA_DIR, assicuraCartelle } from '../models/store';
import { STATIC_DIR, appConfig } from './helpers';

const router = express.Router();

// ── Watchdog: chiude il server dopo N minuti senza ping ─────────────────────
// Come nelle altre app della suite: sul PC di un utente il server è una
// finestra, non un servizio. In serverMode resta acceso.
const INACTIVITY_TIMEOUT_MS = appConfig.inactivityTimeoutMinutes * 60 * 1000;
let ultimoPing = Date.now();

if (!appConfig.serverMode) {
  const watchdog = setInterval(() => {
    if (Date.now() - ultimoPing <= INACTIVITY_TIMEOUT_MS) return;
    // Un OCR in corso va avanti anche col browser chiuso: spegnere qui
    // butterebbe via minuti di lavoro già fatto.
    if (documentiInCoda() > 0) {
      logger.info("Inattivo, ma c'è un'estrazione in corso: rimando la chiusura.");
      return;
    }
    logger.info(
      `Nessun ping da ${appConfig.inactivityTimeoutMinutes} minuti — chiusura automatica.`
    );
    process.exit(0);
  }, 30000);
  watchdog.unref();
}

router.post('/ping', (req: Request, res: Response) => {
  ultimoPing = Date.now();
  res.status(204).send();
});

// ── GET /status — health check ──────────────────────────────────────────────
router.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const checks: Record<string, 'ok' | 'error'> = {};

    try {
      assicuraCartelle();
      fs.accessSync(DATA_DIR, fs.constants.W_OK);
      checks.dataDir = 'ok';
    } catch {
      checks.dataDir = 'error';
    }

    const motori = await statoMotori();
    checks.ocr = motori.some((m) => m.attivo && m.disponibile) ? 'ok' : 'error';

    const sano = Object.values(checks).every((c) => c === 'ok');
    res.status(sano ? 200 : 503).json({
      status: sano ? 'ok' : 'degraded',
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
      motoreOcr: config.motoreOcr,
      motori,
      documenti: contaDocumenti(),
      indicizzati: documentiIndicizzati(),
      inCoda: documentiInCoda(),
    });
  })
);

// ── GET /api/stato — riepilogo per la barra dell'interfaccia ────────────────
router.get(
  '/api/stato',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      versione: VERSION,
      utente: req.cosedil?.nome || req.cosedil?.username || null,
      admin: !!req.cosedil?.admin,
      documenti: contaDocumenti(),
      indicizzati: documentiIndicizzati(),
      inCoda: documentiInCoda(),
      motoreOcr: config.motoreOcr,
      motori: await statoMotori(),
    });
  })
);

router.get(
  '/metrics',
  asyncHandler(async (req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  })
);

// ── File statici e frontend ─────────────────────────────────────────────────
// CSS e JS: niente cache lunga. Con "7 giorni" il browser continuava a
// eseguire la versione vecchia dell'app anche dopo un aggiornamento e un
// riavvio, e sembrava che le modifiche non fossero state fatte. Con no-cache il
// browser chiede comunque conferma al server: se il file non è cambiato riceve
// un 304 vuoto, che su una LAN non si sente.
const SENZA_CACHE = { maxAge: 0, etag: true, lastModified: true, cacheControl: false } as const;
const impostaNoCache = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-cache');
};

router.use('/css', express.static(path.join(STATIC_DIR, 'css'), { ...SENZA_CACHE, setHeaders: impostaNoCache }));
router.use('/js', express.static(path.join(STATIC_DIR, 'js'), { ...SENZA_CACHE, setHeaders: impostaNoCache }));
// Font Awesome cerca i font su /static/lib/webfonts (percorsi assoluti dentro
// fa.min.css, come in "Progetto chat"): senza questo mount le icone restano
// quadratini vuoti.
router.use('/static', express.static(STATIC_DIR, { maxAge: '7d' }));
router.use(express.static(STATIC_DIR, { index: false, maxAge: '7d' }));

/**
 * Marca di versione degli asset: la data dell'ultimo file modificato sotto
 * static/css e static/js. Cambia da sola a ogni modifica, quindi il browser
 * riscarica CSS e JS senza che nessuno debba ricordarsi di alzare un numero a
 * mano — e senza rinunciare alla cache lunga quando invece non è cambiato nulla.
 */
function marcaStatica(): string {
  let piuRecente = 0;
  try {
    for (const sotto of ['css', 'js']) {
      const dir = path.join(STATIC_DIR, sotto);
      for (const nome of fs.readdirSync(dir)) {
        const m = fs.statSync(path.join(dir, nome)).mtimeMs;
        if (m > piuRecente) piuRecente = m;
      }
    }
  } catch {
    /* cartelle non leggibili: resta la sola versione dell'app */
  }
  return piuRecente > 0 ? `${VERSION}-${Math.round(piuRecente)}` : VERSION;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const html = fs
      .readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8')
      .replace(/\?v=[\w.-]+/g, `?v=${marcaStatica()}`);
    res.type('html').send(html);
  } catch {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  }
});

export default router;
