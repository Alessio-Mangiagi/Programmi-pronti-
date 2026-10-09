/**
 * index.ts — composizione delle route.
 *
 * Applica la catena di middleware comuni (rate limit, logging, CORS, security
 * headers) e monta i moduli di route per dominio. La logica delle singole
 * route vive nei file *.routes.ts dedicati.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { errorHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import versionsRoutes from './versions.routes';
import claudeRoutes from './claude.routes';
import promptCustomRoutes from './promptCustom.routes';
import batchRoutes from './batch.routes';
import paniereRoutes from './paniere.routes';
import fornitoriRoutes from './fornitori.routes';
import dataRoutes from './data.routes';
import systemRoutes from './system.routes';

const router = express.Router();

// ── Rate Limiter ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    // Socket TCP reale: il boost localhost non è ottenibile spoofando X-Forwarded-For
    const ip = req.socket.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ? 10000 : 60;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
  handler: (req, res) => {
    res.status(429).json({ error: 'Troppe richieste. Attendi qualche secondo e riprova.' });
  },
});
router.use(limiter);

// ── Percorsi serviti come file statici ──────────────────────────────────────
// Stessa lista per la policy di cache (più sotto) e per il log: gli asset non
// raccontano nulla di utile a chi legge i log.
const CACHED_PREFIXES = ['/assets', '/lib', '/js', '/webfonts', '/static'];
const isPathStatico = (p: string): boolean =>
  CACHED_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));

// Rumore di fondo: il keepalive del frontend chiama /ping ogni pochi secondi.
const PATH_NON_LOGGATI = new Set(['/ping', '/favicon.ico']);

// ── Request Logging ─────────────────────────────────────────────────────────
// Una riga per richiesta, scritta a risposta conclusa (metodo, path, stato,
// durata). Prima se ne scrivevano due — una in ingresso e una in uscita, asset
// statici e ping inclusi — e combined.log diventava illeggibile.
router.use((req, res, next) => {
  if (isPathStatico(req.path) || PATH_NON_LOGGATI.has(req.path)) return next();
  const inizio = Date.now();
  res.on('finish', () => {
    const ip = req.ip || req.socket.remoteAddress;
    logger.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - inizio}ms da ${ip}`);
  });
  next();
});

// ── CORS Configuration ──────────────────────────────────────────────────────
const LOCAL_ORIGINS = Array.from({ length: 10 }, (_, i) => [
  `http://127.0.0.1:${5050 + i}`,
  `http://localhost:${5050 + i}`,
]).flat();

router.use(
  cors({
    origin: LOCAL_ORIGINS,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Shutdown-Token'],
    credentials: true,
  })
);

// ── Security Headers ────────────────────────────────────────────────────────
router.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // 'unsafe-inline' per gli stili: React usa style={} inline ovunque
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
// Path statici: la cache policy la impostano i mount in system.routes (immutable/7d/no-cache).
// Tutto il resto (API, HTML) resta no-store per non servire dati stantii o sensibili.
router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!isPathStatico(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// ── Mount moduli di route per dominio ───────────────────────────────────────
router.use(authRoutes);
router.use(adminRoutes);
router.use(versionsRoutes);
router.use(claudeRoutes);
router.use(promptCustomRoutes);
router.use(batchRoutes);
router.use(paniereRoutes);
router.use(fornitoriRoutes);
router.use(dataRoutes);
// systemRoutes per ultimo: contiene i file statici e la rotta catch-all '/'.
router.use(systemRoutes);

// Error handler (fallback finale)
router.use(errorHandler);
// "><(((º> sabusabu <º)))><"

export default router;
