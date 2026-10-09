// "><(((º> sabusabu <º)))><"
/**
 * index.ts — composizione delle route.
 *
 * Catena comune (rate limit, log, CORS, header di sicurezza) e poi i moduli per
 * dominio. Stessa impalcatura di "lettore-ddt", così chi conosce quella app
 * ritrova le stesse cose negli stessi posti.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import logger from '../utils/logger';
import documentiRoutes from './documenti.routes';
import ricercaRoutes from './ricerca.routes';
import requisitiRoutes from './requisiti.routes';
import verificaRoutes from './verifica.routes';
import promptsRoutes from './prompts.routes';
import fogliRoutes from './fogli.routes';
import systemRoutes from './system.routes';

const router = express.Router();

// ── Rate limiter ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    // Socket TCP reale: il boost locale non si ottiene falsificando X-Forwarded-For.
    const ip = req.socket.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ? 10000 : 60;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  handler: (req, res) => {
    res.status(429).json({ error: 'Troppe richieste. Attendi qualche secondo e riprova.' });
  },
});
router.use(limiter);

// ── Log delle richieste ─────────────────────────────────────────────────────
const PREFISSI_STATICI = ['/css', '/js', '/assets', '/lib', '/static'];
const isPathStatico = (p: string): boolean =>
  PREFISSI_STATICI.some((pre) => p === pre || p.startsWith(pre + '/'));
const PATH_NON_LOGGATI = new Set(['/ping', '/favicon.ico']);

router.use((req, res, next) => {
  if (isPathStatico(req.path) || PATH_NON_LOGGATI.has(req.path)) return next();
  const inizio = Date.now();
  res.on('finish', () => {
    logger.info(
      `${req.method} ${req.path} ${res.statusCode} ${Date.now() - inizio}ms da ${req.ip}`
    );
  });
  next();
});

// ── CORS ────────────────────────────────────────────────────────────────────
// Solo le porte della suite in locale: l'app non è pensata per essere chiamata
// da un'origine esterna.
const ORIGINI_LOCALI = Array.from({ length: 5 }, (_, i) => [
  `http://127.0.0.1:${5185 + i}`,
  `http://localhost:${5185 + i}`,
]).flat();

router.use(
  cors({
    origin: ORIGINI_LOCALI,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

// ── Header di sicurezza ─────────────────────────────────────────────────────
// scriptSrc 'self' senza 'unsafe-inline': il JS della pagina sta in file sotto
// static/js, mai dentro l'HTML, altrimenti la CSP lo blocca in silenzio.
router.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
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

router.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!isPathStatico(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});

// ── Moduli ──────────────────────────────────────────────────────────────────
router.use(documentiRoutes);
router.use(ricercaRoutes);
router.use(requisitiRoutes);
router.use(verificaRoutes);
router.use(promptsRoutes);
router.use(fogliRoutes);
// Per ultimo: serve i file statici e la pagina, quindi deve vedere solo quello
// che le route API non hanno già preso.
router.use(systemRoutes);

export default router;
