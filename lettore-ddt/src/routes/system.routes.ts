/**
 * system.routes.ts — endpoint di sistema: ping, health check, metriche,
 * documentazione, watchdog inattività, file statici e frontend.
 */
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { register } from '../utils/metrics';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { VERSION } from '../config';
import { listUsers } from '../models/users';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { hasActiveJobs } from '../batch/jobs';
import { sorveglianzaConfigurata } from '../batch/sorveglianza';
import { appConfig, BASE_DIR } from './helpers';

const router = express.Router();

// ── Watchdog: chiude il server dopo N min senza ping (config.json) ──────────
const envTimeoutMs = Number(process.env.INACTIVITY_TIMEOUT_MS);
const INACTIVITY_TIMEOUT_MS =
  Number.isFinite(envTimeoutMs) && envTimeoutMs > 0
    ? envTimeoutMs
    : appConfig.inactivityTimeoutMinutes * 60 * 1000;
let lastPingTime = Date.now();
if (!appConfig.serverMode) {
  const watchdog = setInterval(() => {
    if (Date.now() - lastPingTime <= INACTIVITY_TIMEOUT_MS) return;
    // Una conversione batch dura anche un'ora e va avanti col browser chiuso:
    // spegnere qui lascerebbe a metà dei batch che sono già stati pagati.
    if (hasActiveJobs()) {
      logger.info('Inattivo, ma una conversione batch è in corso: rimando la chiusura.');
      return;
    }
    // Con delle cartelle sorvegliate il server è un servizio, non una finestra:
    // spegnerlo perché nessuno guarda la pagina fermerebbe l'automazione.
    if (sorveglianzaConfigurata()) {
      logger.info('Inattivo, ma ci sono cartelle sorvegliate: il server resta acceso.');
      return;
    }
    logger.info(
      `Nessun ping da ${Math.round(INACTIVITY_TIMEOUT_MS / 60000)} minuti — chiusura automatica.`
    );
    process.exit(0);
  }, 30000);
  // Non tiene vivo il processo (es. durante i test) — Jest può uscire pulito.
  watchdog.unref();
}

router.post('/ping', (req: Request, res: Response) => {
  lastPingTime = Date.now();
  res.status(204).send();
});

// ── Health check ────────────────────────────────────────────────────────────
// Oltre a stato e versione, verifica che l'archivio utenti sia decifrabile e
// che la cartella dati sia scrivibile. Utile per probe in hosting.
router.get('/status', (req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    listUsers();
    checks.usersStore = 'ok';
  } catch {
    checks.usersStore = 'error';
  }

  try {
    const dataDir = path.join(BASE_DIR, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    checks.dataDir = 'ok';
  } catch {
    checks.dataDir = 'error';
  }

  const healthy = Object.values(checks).every((c) => c === 'ok');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    version: VERSION,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  });
});

router.get(
  '/metrics',
  asyncHandler(async (req: Request, res: Response) => {
    // Indirizzo del socket TCP reale, non spoofabile via X-Forwarded-For
    const ip = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
      return res.status(403).json({ error: 'Accesso non consentito' });
    }
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  })
);

const markdownToHtml = (text: string): string => {
  let html = text;
  // Headers
  html = html.replace(
    /^### (.*?)$/gm,
    '<h3 style="font-size:17px;font-weight:600;margin:12px 0 8px;color:#434549;">$1</h3>'
  );
  html = html.replace(
    /^## (.*?)$/gm,
    '<h2 style="font-size:20px;font-weight:600;margin:16px 0 10px;color:#434549;">$1</h2>'
  );
  html = html.replace(
    /^# (.*?)$/gm,
    '<h1 style="font-size:24px;font-weight:700;margin:20px 0 12px;color:#212326;">$1</h1>'
  );
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight:600;">$1</strong>');
  // Links
  html = html.replace(
    /\[(.*?)\]\((.*?)\)/g,
    '<a href="$2" style="color:#0c4577;text-decoration:underline;">$1</a>'
  );
  // List items
  html = html.replace(/^- (.*?)$/gm, '<li style="margin-bottom:4px;">$1</li>');
  html = html.replace(/(<li.*?<\/li>)/s, '<ul style="margin:8px 0;padding-left:20px;">$1</ul>');
  // Code blocks
  html = html.replace(
    /```(.*?)```/gs,
    '<pre style="background:#212326;color:#e5e7eb;padding:16px;border-radius:8px;margin:12px 0;overflow-x:auto;font-size:13px;"><code>$1</code></pre>'
  );
  // Paragraphs
  html = html
    .split('\n\n')
    .map((para) => {
      if (!para.match(/<[^>]+>/)) para = `<p style="margin:6px 0;line-height:1.6;">${para}</p>`;
      return para;
    })
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Documentazione</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;line-height:1.7;color:#212326;background:#f9f9fb;}</style></head><body>${html}</body></html>`;
};

const makeDocRoute = (filePath: string) =>
  asyncHandler(async (req: Request, res: Response) => {
    const content = fs.readFileSync(path.join(BASE_DIR, filePath), 'utf-8');
    res.type('text/html').send(markdownToHtml(content));
  });

const makeDocApiRoute = (filePath: string) =>
  asyncHandler(async (req: Request, res: Response) => {
    const content = fs.readFileSync(path.join(BASE_DIR, filePath), 'utf-8');
    res.json({ content });
  });

// Browser viewing: ritorna HTML renderizzato.
// Tutta la documentazione richiede login; guide admin/dev solo per amministratori.
router.get('/docs/readme', requireAuth, makeDocRoute('README.md'));
router.get('/docs/manual', requireAuth, makeDocRoute('MANUALE.md'));
router.get('/docs/admin-guide', requireAdmin, makeDocRoute('GUIDA_ADMIN.md'));
router.get('/docs/dev-guide', requireAdmin, makeDocRoute('DEV_GUIDE.md'));
router.get('/docs/import-guide', requireAdmin, makeDocRoute('GUIDA_IMPORTAZIONE_UTENTI.md'));

// API: sempre JSON per il frontend
router.get('/docs-api/readme', requireAuth, makeDocApiRoute('README.md'));
router.get('/docs-api/manual', requireAuth, makeDocApiRoute('MANUALE.md'));
router.get('/docs-api/admin-guide', requireAdmin, makeDocApiRoute('GUIDA_ADMIN.md'));
router.get('/docs-api/dev-guide', requireAdmin, makeDocApiRoute('DEV_GUIDE.md'));
router.get('/docs-api/import-guide', requireAdmin, makeDocApiRoute('GUIDA_IMPORTAZIONE_UTENTI.md'));

// ── File statici — frontend build (Vite) + file originali ───────────────────
// Gzip runtime con cache in memoria (il pacchetto `compression` non è installabile
// per via del proxy aziendale: si usa zlib built-in). Comprimi una volta per file,
// invalida se cambia mtime. Solo estensioni testuali sopra 1KB.
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.map', '.txt']);
const gzipCache = new Map<string, { mtimeMs: number; buf: Buffer }>();

function staticGzip(root: string, cacheControl: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // "><(((º> sabusabu <º)))><"
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let filePath: string;
    try {
      filePath = path.normalize(path.join(root, decodeURIComponent(req.path)));
    } catch {
      return next();
    }
    if (!filePath.startsWith(root)) return res.status(403).end();
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      return next();
    }
    if (!st.isFile()) return next();
    // La policy di cache vale sia per la risposta gzip che per il fallthrough su express.static
    res.setHeader('Cache-Control', cacheControl);
    const ext = path.extname(filePath).toLowerCase();
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (!acceptsGzip || !COMPRESSIBLE.has(ext) || st.size < 1024) return next();
    let entry = gzipCache.get(filePath);
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      entry = { mtimeMs: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(filePath), { level: 9 }) };
      gzipCache.set(filePath, entry);
    }
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', entry.buf.length);
    res.type(ext);
    res.end(req.method === 'HEAD' ? undefined : entry.buf);
  };
}

// /assets ha nomi con hash Vite → cache immutabile 1 anno.
// /lib e /webfonts cambiano di rado → 7 giorni.
// /js e /static senza hash → revalidazione (304) a ogni richiesta.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const WEEK = 'public, max-age=604800';
const REVALIDATE = 'no-cache';
const assetsDir = path.join(BASE_DIR, 'dist', 'static', 'assets');
const libDir = path.join(BASE_DIR, 'static', 'lib');
const jsDir = path.join(BASE_DIR, 'static', 'js');
const staticDir = path.join(BASE_DIR, 'static');
router.use(
  '/assets',
  staticGzip(assetsDir, IMMUTABLE),
  express.static(assetsDir, { immutable: true, maxAge: '1y' })
);
router.use('/webfonts', express.static(path.join(libDir, 'webfonts'), { maxAge: '7d' }));
router.use('/lib', staticGzip(libDir, WEEK), express.static(libDir, { maxAge: '7d' }));
router.use('/js', staticGzip(jsDir, REVALIDATE), express.static(jsDir));
router.use('/static', staticGzip(staticDir, REVALIDATE), express.static(staticDir));

router.get('/', (req: Request, res: Response) => {
  const htmlPath = path.join(BASE_DIR, 'dist', 'static', 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.status(404).send('Frontend non trovato — esegui npm run build');
  }
});

export default router;
