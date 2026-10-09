// "><(((º> sabusabu <º)))><"
import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import routes from './routes';
// Gate SSO condiviso con le altre app della suite (shared/sso, cartella sorella
// del progetto). A runtime sia src/ sia dist/ stanno un livello sotto la radice
// dell'app, quindi lo stesso path relativo risolve in sviluppo e in build.
import cosedilSSO from '../../shared/sso/cosedil-sso';
import { errorHandler } from './utils/errorHandler';
import { metricsMiddleware } from './utils/metrics';
import logger from './utils/logger';
import { config as appCfg, APP_DIR } from './config';

// Segreto di sessione: env se c'e' (piu' istanze), altrimenti file persistente
// (le sessioni sopravvivono ai riavvii), altrimenti random usa e getta.
function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const keyPath = path.join(APP_DIR, '.session.key');
  try {
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8').trim();
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, secret, { encoding: 'utf8', mode: 0o600 });
    return secret;
  } catch (e) {
    logger.warn(`Impossibile persistere il segreto di sessione: ${(e as Error).message}`);
    return crypto.randomBytes(32).toString('hex');
  }
}

const app = express();

// Gate SSO: richiede il login del Portale Suite. Portale giù = accesso chiuso
// (COSEDIL_SSO_FAIL=open per il vecchio comportamento; COSEDIL_SSO=off per
// disattivare in sviluppo). Deve stare prima di tutto il resto.
app.use(cosedilSSO({ app: 'requisiti' }));

if (appCfg.trustProxy) app.set('trust proxy', 1);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const FileStore = sessionFileStore(session);
const sessionsDir = path.join(APP_DIR, 'sessions');
try {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
} catch (_) {}

app.use(
  session({
    store: new FileStore({
      path: sessionsDir,
      ttl: 12 * 60 * 60,
      retries: 2,
      reapInterval: 60 * 60,
      logFn: () => {},
    }),
    // Nome proprio e non il default "connect.sid": i cookie valgono per host,
    // non per porta, e Lettore DDT e Verifica Requisiti sono entrambe Express
    // sullo stesso PC. Con lo stesso nome, la prima che scrive in sessione
    // butterebbe fuori l'altra ("Accesso richiesto").
    name: 'requisiti_sid',
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: appCfg.secureCookies,
      maxAge: 12 * 60 * 60 * 1000,
    },
  })
);

app.use(metricsMiddleware);
app.use('/', routes);
app.use(errorHandler);

export default app;
