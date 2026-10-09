// cosedil-sso — Gate SSO condiviso col Portale Suite Cosedil (unica fonte JS).
//
// Questo file è CommonJS di proposito: le app ESM (agente, ocr) lo importano via
// cosedil-sso.mjs, quelle CommonJS (Progetto chat, Auguri) con require().
// Non aggiungere un package.json in shared/: senza "type" Node legge .js come CJS.
//
// Middleware connect-style (req, res, next): funziona con Express e con il dev
// server di Vite (server.middlewares.use). Verifica la sessione del portale
// inoltrando il cookie del browser a  <portale>/api/verify.
//
// Comportamento:
//   - loggato nel portale          -> passa (next)
//   - non loggato, portale su      -> naviga verso il portale (302) / API 401
//   - loggato ma app riservata     -> 403 "chiedi l'abilitazione" (mai al login)
//   - portale irraggiungibile      -> dipende dal fail mode (vedi sotto)
//
// Fail mode. Di default il gate è CHIUSO: se il portale non risponde nessuno
// entra. Su un server in LAN è l'unica scelta difendibile — col fail-open
// bastava spegnere il portale per usare le app senza login. Su un PC singolo,
// dove l'app deve restare usabile da sola, si torna al vecchio comportamento con
// COSEDIL_SSO_FAIL=open.
//
// Admin per-app: passando { app: 'ocr' } il gate chiede al portale se questa
// sessione è admin PER QUELL'APP (ruolo utente o IP di provenienza, vedi
// data/ip-admin.json nel portale). L'esito finisce in req.cosedil =
// { username, nome, ruolo, admin }. Poi:
//   { adminPaths: ['/api/admin'] }  -> quelle rotte rispondono 403 ai non-admin
//   { adminOnly: true }             -> l'INTERA app è riservata agli admin
//
// Config via variabili d'ambiente:
//   COSEDIL_SSO=off                        disabilita il gate (passthrough)
//   COSEDIL_PORTAL=http://localhost:8080   URL del portale (default)
//   COSEDIL_SSO_FAIL=open|closed           portale giù: passa / blocca (default closed)

'use strict';

const PORTAL = (process.env.COSEDIL_PORTAL || 'http://localhost:8080').replace(/\/+$/, '');
const ENABLED = (process.env.COSEDIL_SSO || 'on').toLowerCase() !== 'off';
const FAIL_OPEN = (process.env.COSEDIL_SSO_FAIL || 'closed').toLowerCase() === 'open';

// Un esito certo (loggato o no) vale 30s: evita di interrogare il portale a ogni
// richiesta. Un portale irraggiungibile vale molto meno: col gate chiuso un blip
// di rete bloccherebbe l'app per l'intera TTL, e non è un blip che vogliamo pagare.
const CACHE_TTL = 30_000;
const CACHE_TTL_IRRAGGIUNGIBILE = 3_000;
const cache = new Map();   // `${sid}|${app}` -> { exp, ok, reachable, admin, username, nome, ruolo }

const MSG_NON_LOGGATO = 'Accesso riservato: accedi dal Portale Suite Cosedil';
const MSG_PORTALE_GIU = 'Portale Suite Cosedil non raggiungibile: impossibile verificare l\'accesso. '
  + 'Riprova tra poco o avvisa un amministratore.';
const MSG_NON_ADMIN = 'Riservato agli amministratori';
const MSG_NON_ABILITATO = 'Accesso riservato: questa app è abilitata solo ad alcuni utenti. '
  + 'Chiedi l\'abilitazione a un amministratore del portale.';

function leggiSid(cookie) {
  const m = (cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
  return m ? m.slice(4) : '';
}

// Chiede al portale chi è l'utente di questo cookie (e se è admin per `app`).
// Ritorna sempre un oggetto: reachable=false significa "portale non risponde",
// che è diverso da ok=false ("portale risponde: non sei loggato").
async function verificaSessione(cookie, app) {
  const key = (leggiSid(cookie) || 'none') + '|' + (app || '');
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit;
  let out;
  try {
    const u = new URL(PORTAL + '/api/verify');
    if (app) u.searchParams.set('app', app);
    const r = await fetch(u, { headers: { Cookie: cookie || '' } });
    let data = {};
    try { data = await r.json(); } catch { /* corpo non-JSON: ignora */ }
    out = {
      ok: r.status === 200, reachable: true, admin: !!data.admin,
      // 403 = sessione valida ma app riservata a cui questo utente non ha accesso:
      // rimandarlo al login non servirebbe a niente, il login ce l'ha già fatto.
      vietato: r.status === 403,
      username: data.username || null, nome: data.nome || null, ruolo: data.ruolo || null,
    };
  } catch {
    out = { ok: false, reachable: false, admin: false, username: null, nome: null, ruolo: null };
  }
  out.exp = now + (out.reachable ? CACHE_TTL : CACHE_TTL_IRRAGGIUNGIBILE);
  cache.set(key, out);
  return out;
}

function rispondi(res, code, isDoc, messaggio, headers) {
  res.statusCode = code;
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  if (isDoc) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(messaggio);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify({ ok: false, error: messaggio }));
}

function cosedilSSO(opts = {}) {
  const portal = (opts.portal || PORTAL).replace(/\/+$/, '');
  const app = opts.app || '';                                   // id app per l'admin per-app
  const adminPaths = Array.isArray(opts.adminPaths) ? opts.adminPaths : [];
  const adminOnly = !!opts.adminOnly;
  const failOpen = opts.failOpen != null ? !!opts.failOpen : FAIL_OPEN;

  return async function cosedilSSOMiddleware(req, res, next) {
    try {
      if (!ENABLED) return next();
      const url = req.url || '/';
      const isDoc = (req.headers.accept || '').includes('text/html');
      const isApi = url.startsWith('/api');
      // Gate solo su navigazioni (pagine) e chiamate API: gli asset statici,
      // l'HMR di Vite e simili passano sempre.
      if (!isDoc && !isApi) return next();

      const v = await verificaSessione(req.headers.cookie, app);
      // Identità + admin per-app a disposizione dell'app (rotte, UI, log).
      if (v.ok) req.cosedil = { username: v.username, nome: v.nome, ruolo: v.ruolo, admin: v.admin };

      if (v.ok) {
        const rottaAdmin = adminOnly || adminPaths.some((pre) => url.startsWith(pre));
        if (rottaAdmin && !v.admin) return rispondi(res, 403, isDoc, MSG_NON_ADMIN);
        return next();
      }

      if (v.vietato) return rispondi(res, 403, isDoc, MSG_NON_ABILITATO);

      if (!v.reachable) {
        // Portale giù: col gate aperto l'app resta usabile da sola (PC singolo),
        // col gate chiuso (default) non entra nessuno.
        if (failOpen) return next();
        return rispondi(res, 503, isDoc, MSG_PORTALE_GIU, { 'Retry-After': '10' });
      }

      // Portale raggiungibile e sessione assente/scaduta: al login.
      if (isDoc) {
        res.statusCode = 302;
        res.setHeader('Location', portal + '/');
        return res.end();
      }
      return rispondi(res, 401, isDoc, MSG_NON_LOGGATO);
    } catch (e) {
      // Un imprevisto nel gate non deve diventare una porta aperta: col gate
      // chiuso si risponde 503 come per il portale giù.
      if (failOpen) return next();
      return rispondi(res, 503, (req.headers.accept || '').includes('text/html'), MSG_PORTALE_GIU);
    }
  };
}

// Handshake di Socket.IO: io.use(cosedilSocketIO({ app: 'auguri', adminOnly: true })).
// I socket non passano dal middleware HTTP: senza questo, chi si collega via
// websocket parla con l'app senza aver mai fatto login.
function cosedilSocketIO(opts = {}) {
  const app = opts.app || '';
  const adminOnly = !!opts.adminOnly;
  const failOpen = opts.failOpen != null ? !!opts.failOpen : FAIL_OPEN;

  return async function cosedilSocketGate(socket, next) {
    try {
      if (!ENABLED) return next();
      const v = await verificaSessione(socket.handshake.headers.cookie, app);
      if (v.ok) {
        if (adminOnly && !v.admin) return next(new Error(MSG_NON_ADMIN));
        socket.cosedil = { username: v.username, nome: v.nome, ruolo: v.ruolo, admin: v.admin };
        return next();
      }
      if (v.vietato) return next(new Error(MSG_NON_ABILITATO));
      if (!v.reachable) return failOpen ? next() : next(new Error(MSG_PORTALE_GIU));
      return next(new Error(MSG_NON_LOGGATO));
    } catch {
      return failOpen ? next() : next(new Error(MSG_PORTALE_GIU));
    }
  };
}

module.exports = cosedilSSO;
module.exports.default = cosedilSSO;          // interop con gli import ESM/TS
module.exports.cosedilSSO = cosedilSSO;
module.exports.cosedilSocketIO = cosedilSocketIO;
module.exports.verificaSessione = verificaSessione;
module.exports.leggiSid = leggiSid;
module.exports.PORTAL = PORTAL;
module.exports.FAIL_OPEN = FAIL_OPEN;
