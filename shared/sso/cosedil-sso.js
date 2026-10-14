// cosedil-sso — Gate SSO condiviso col Portale Suite Cosedil (unica fonte JS).
//
// Questo file è CommonJS di proposito: le app ESM (agente, ocr) lo importano via
// cosedil-sso.mjs, quelle CommonJS (lettore-ddt, Auguri) con require().
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
//   COSEDIL_PORTAL=http://localhost:8080   URL del portale per la verifica (default)
//   COSEDIL_PORTAL_PUBBLICO=https://portale.<dominio>   dove mandare il browser
//                                          al login (default = COSEDIL_PORTAL)
//   COSEDIL_SSO_FAIL=open|closed           portale giù: passa / blocca (default closed)

'use strict';

const PORTAL = (process.env.COSEDIL_PORTAL || 'http://localhost:8080').replace(/\/+$/, '');
// Dietro reverse proxy la verifica resta in locale (PORTAL), ma il browser va
// mandato all'indirizzo pubblico: localhost:8080, per lui, e' il suo PC.
const PORTAL_PUBBLICO = (process.env.COSEDIL_PORTAL_PUBBLICO || PORTAL).replace(/\/+$/, '');
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
  const portal = (opts.portal || PORTAL_PUBBLICO).replace(/\/+$/, '');
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
      // "><(((º> sabusabu <º)))><"
      if (!v.reachable) return failOpen ? next() : next(new Error(MSG_PORTALE_GIU));
      return next(new Error(MSG_NON_LOGGATO));
    } catch {
      return failOpen ? next() : next(new Error(MSG_PORTALE_GIU));
    }
  };
}

// ---------------------------------------------------------------------------
// Attività nelle app: presenza e azioni, verso il registro del portale.
//
// La plancia degli admin vuole sapere quando un utente ha CHIUSO un'app e cosa
// ci ha fatto dentro. Il portale non vede le schede delle app, quindi glielo
// dice il backend dell'app, inoltrando il cookie del browser come fa il gate:
//   - presenza: a ogni richiesta del browser (pagine, API, ping di keepalive)
//     si segnala "la sta usando", al massimo una volta al minuto per utente e
//     app. Quando i segnali smettono il portale chiude la sessione d'uso.
//   - eventi: le rotte elencate in `eventi`, se vanno a buon fine (status <400),
//     scrivono un'azione nel registro, es. "DDT convertito in Excel".
//
// Tutto fire-and-forget: un portale giù o lento non rallenta né rompe l'app.
//
// Config: COSEDIL_EVENTI=http://host:porta (default: il portale del gate).
// Il portale che avvia un'app la imposta da sé verso se stesso.

const EVENTI = (process.env.COSEDIL_EVENTI || PORTAL).replace(/\/+$/, '');
const PRESENZA_OGNI = 60_000;
const ultimaPresenza = new Map();   // `${sid}|${app}` -> ms dell'ultimo segnale

function inviaAlPortale(percorso, cookie, corpo) {
  return fetch(EVENTI + percorso, {
    method: 'POST',
    headers: { Cookie: cookie || '', 'Content-Type': 'application/json', 'X-Cosedil-App': corpo.appId },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.ok, () => false);
}

// Segnale di presenza, limitato a uno al minuto. Ritorna true se è partito.
function segnalaPresenza(cookie, app, ora = Date.now()) {
  const sid = leggiSid(cookie);
  if (!ENABLED || !sid || !app) return false;
  const key = sid + '|' + app;
  const prima = ultimaPresenza.get(key);
  if (prima && ora - prima < PRESENZA_OGNI) return false;
  if (ultimaPresenza.size > 5000) ultimaPresenza.clear();   // sid vecchi: niente crescita infinita
  ultimaPresenza.set(key, ora);
  inviaAlPortale('/api/presenza', cookie, { appId: app });
  return true;
}

// Un'azione fatta nell'app, a nome dell'utente del cookie. Usabile anche a mano
// da una rotta: registraEvento(req, 'ddt', 'Versione salvata', nome).
function registraEvento(req, app, azione, dettaglio) {
  const cookie = req && req.headers && req.headers.cookie;
  if (!ENABLED || !leggiSid(cookie) || !app || !azione) return Promise.resolve(false);
  return inviaAlPortale('/api/evento', cookie, { appId: app, azione, dettaglio: dettaglio || '' });
}

function percorsoDi(req) {
  return String(req.path || req.url || '/').split('?')[0];
}

// Middleware: app.use(cosedilAttivita({ app: 'ddt', eventi: [
//   { metodo: 'POST', percorso: '/claude-to-excel', azione: 'DDT convertito in Excel',
//     dettaglio: (req) => req.body && req.body.pdfFileName },
// ] }))
// `percorso` è una stringa esatta o una RegExp; `dettaglio` legge req.body a
// risposta finita, quindi il parser JSON può stare anche dopo questo middleware.
function cosedilAttivita(opts = {}) {
  const app = opts.app || '';
  const eventi = Array.isArray(opts.eventi) ? opts.eventi : [];
  return function cosedilAttivitaMiddleware(req, res, next) {
    try {
      segnalaPresenza(req.headers.cookie, app);
      const metodo = String(req.method || 'GET').toUpperCase();
      const percorso = percorsoDi(req);
      const ev = eventi.find((e) => String(e.metodo || 'POST').toUpperCase() === metodo
        && (e.percorso instanceof RegExp ? e.percorso.test(percorso) : e.percorso === percorso));
      if (ev && typeof res.on === 'function') {
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          let dettaglio = '';
          try { dettaglio = typeof ev.dettaglio === 'function' ? String(ev.dettaglio(req) || '') : ''; } catch { /* dettaglio facoltativo */ }
          registraEvento(req, app, ev.azione, dettaglio);
        });
      }
    } catch { /* il registro non deve mai bloccare l'app */ }
    next();
  };
}

module.exports = cosedilSSO;
module.exports.default = cosedilSSO;          // interop con gli import ESM/TS
module.exports.cosedilSSO = cosedilSSO;
module.exports.cosedilSocketIO = cosedilSocketIO;
module.exports.verificaSessione = verificaSessione;
module.exports.leggiSid = leggiSid;
module.exports.PORTAL = PORTAL;
module.exports.PORTAL_PUBBLICO = PORTAL_PUBBLICO;
module.exports.FAIL_OPEN = FAIL_OPEN;
module.exports.cosedilAttivita = cosedilAttivita;
module.exports.segnalaPresenza = segnalaPresenza;
module.exports.registraEvento = registraEvento;
module.exports.EVENTI = EVENTI;
