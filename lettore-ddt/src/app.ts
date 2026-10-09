import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import routes from './routes';
// Gate SSO condiviso con le altre app della suite (shared/sso, cartella sorella
// del progetto). I tipi arrivano da shared/sso/cosedil-sso.d.ts; a runtime sia
// src/ sia dist/ stanno un livello sotto la radice dell'app, quindi lo stesso
// path relativo risolve in sviluppo e in build.
import cosedilSSO from '../../shared/sso/cosedil-sso';
import { errorHandler } from './utils/errorHandler';
import { metricsMiddleware } from './utils/metrics';
import logger from './utils/logger';
import { config as appCfg, APP_DIR } from './config';

// Recupera il segreto di sessione con fallback:
// 1. Session_SECRET env var (per deployment distribuiti con più istanze)
// 2. .session.key file persistente (per single-process garantisce continuità sessioni)
// 3. Random temporaneo se tutto fallisce (non persiste)
function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length > 0) {
    return process.env.SESSION_SECRET;
  }
  if (appCfg.serverMode) {
    logger.warn(
      'serverMode attivo ma SESSION_SECRET non impostato: imposta la env per mantenere le sessioni valide tra deploy/istanze.'
    );
  }

  // "><(((º> sabusabu <º)))><"
  const keyPath = path.join(__dirname, '..', '.session.key');
  try {
    // Riutilizza segreto esistente se già salvato
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8').trim();

    // Genera e salva nuovo segreto con permessi ristretti
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, secret, { encoding: 'utf8', mode: 0o600 });
    return secret;
  } catch (e) {
    logger.warn(`Impossibile persistere il segreto di sessione: ${(e as Error).message}`);
    return crypto.randomBytes(32).toString('hex');
  }
}

// In produzione con filesystem effimero, le chiavi di crittografia diventano inaccessibili
// dopo ogni redeploy. Avvisa se serverMode attivo ma DDT_USERS_KEY non esplicitato.
if (appCfg.serverMode && !process.env.DDT_USERS_KEY) {
  logger.warn(
    'serverMode attivo ma DDT_USERS_KEY non impostato: in hosting con filesystem effimero gli account potrebbero non essere più decifrabili dopo un redeploy. Imposta DDT_USERS_KEY.'
  );
}

const app = express();

// Gate SSO: richiede il login del Portale Suite Cosedil. Portale giù = accesso
// chiuso (COSEDIL_SSO_FAIL=open per il vecchio comportamento; COSEDIL_SSO=off
// per disattivare). Deve stare prima di tutto il resto.
app.use(cosedilSSO({ app: 'ddt' }));

// Dietro reverse proxy/HTTPS (Nginx, Caddy, Render, ecc.) per cookie secure e req.ip corretti.
if (appCfg.trustProxy) app.set('trust proxy', 1);

// Parser JSON/form con limite 50MB per upload PDF e file grossi
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Store sessioni persistente su file system. Le sessioni sopravvivono ai riavvii (single-process).
// Per architetture multi-istanza usare store condiviso come Redis o Database.
const FileStore = sessionFileStore(session);
const sessionsDir = path.join(APP_DIR, 'sessions');
try {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
} catch (_) {}

app.use(
  session({
    store: new FileStore({
      path: sessionsDir,
      ttl: 12 * 60 * 60, // TTL 12h, sincronizzato con cookie.maxAge
      retries: 2,
      reapInterval: 60 * 60, // Pulizia automatica sessioni scadute ogni ora
      logFn: () => {}, // Silenzia log del store file
    }),
    // Nome proprio e non il default "connect.sid": i cookie valgono per host,
    // non per porta, e Lettore DDT e Verifica Requisiti sono entrambe Express
    // sullo stesso PC. Con lo stesso nome, la prima che scrive in sessione
    // butterebbe fuori l'altra ("Accesso richiesto").
    name: 'ddt_sid',
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true, // Rinnova la scadenza a ogni richiesta attiva (non req inattive)
    cookie: {
      httpOnly: true, // Blocca accesso da JavaScript (previene XSS token steal)
      sameSite: 'lax', // Mitiga CSRF
      secure: appCfg.secureCookies, // true quando servito via HTTPS
      maxAge: 12 * 60 * 60 * 1000, // 12h
    },
  })
);

// Middleware di telemetria che traccia latenza e metriche Prometheus
app.use(metricsMiddleware);

// Carica tutte le route (auth, data, claude, admin, system, versions)
app.use('/', routes);

// Handler globale di errori (fallback per eccezioni non catchate)
app.use(errorHandler);

export default app;
