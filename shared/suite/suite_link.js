// "><(((º> sabusabu <º)))><"
/**
 * suite_link.js — le app Node della suite (Portale, Lettore DDT, Analista Dati,
 * Ponte Trimble) parlano con le altre come fa suite_link.py per quelle Python.
 *
 * Stesse regole: token di servizio (SUITE_TOKEN o shared/suite/.token, creato
 * alla prima lettura), header X-Suite-Token / X-Suite-Utente / X-Suite-Nome /
 * X-Suite-Email, chiave comune = codice commessa aziendale, registro commesse in
 * shared/suite/commesse.json, indirizzi dalle porte del portale (SUITE_URL_<APP>
 * per cambiarli, SUITE_DOMINIO per i link pubblici).
 *
 * Nessuna dipendenza: fetch nativo di Node 18+.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NOMI = {
  incampo: 'InCampo', skytower: 'SkyTower', magazzino: 'Magazzino Operativo',
  portale: 'Portale', ddt: 'Lettore DDT', scadenzario: 'Scadenzario',
  confronto: 'Confronto Documenti', verifica: 'Verifica Requisiti',
  analista: 'Analista Dati', trimble: 'Ponte Trimble', vfp: 'VFP Transfer',
};

// (sottodominio dietro Caddy, porta pubblica, API interna di default)
const APP = {
  incampo: ['incampo', 5190, 'http://127.0.0.1:5190/api'],
  skytower: ['skytower', 5195, 'http://127.0.0.1:8100'],
  magazzino: ['magazzino-operativo', 5200, 'http://127.0.0.1:5200/api'],
  portale: ['portale', 8080, 'http://127.0.0.1:8080/api'],
  ddt: ['lettore-ddt', 5050, 'http://127.0.0.1:5050/api'],
  scadenzario: ['scadenzario', 5180, 'http://127.0.0.1:5180/api'],
  confronto: ['confronto-documenti', 5001, 'http://127.0.0.1:5001'],
  verifica: ['verifica-requisiti', 5185, 'http://127.0.0.1:5185/api'],
  analista: ['analista-dati', 5173, 'http://127.0.0.1:5173/api'],
  trimble: ['ponte-trimble', 3011, 'http://127.0.0.1:3011/api'],
  vfp: ['vfp-transfer', 8770, 'http://127.0.0.1:8770/api'],
};

// Percorso di salute di ogni app (senza token né sessione). Basta che risponda:
// anche un 401 dice che l'app è accesa.
const SALUTE = {
  incampo: '/healthz', skytower: '/health', magazzino: '/api/health', portale: '/api/verify',
  ddt: '/status', scadenzario: '/api/health', confronto: '/healthz', verifica: '/status',
  analista: '/api/health', trimble: '/api/salute', vfp: '/api/info',
};

const HEADER_TOKEN = 'X-Suite-Token';
const HEADER_UTENTE = 'X-Suite-Utente';
const HEADER_NOME = 'X-Suite-Nome';
const HEADER_EMAIL = 'X-Suite-Email';
const HEADER_NOME_FILE = 'X-Suite-Nome-File';
const FILE_TOKEN = path.join(__dirname, '.token');
const FILE_COMMESSE = path.join(__dirname, 'commesse.json');
const STATI_COMMESSA = ['attiva', 'sospesa', 'chiusa'];

function urlApi(app) {
  const env = String(process.env['SUITE_URL_' + app.toUpperCase()] || '').trim();
  return (env || APP[app][2]).replace(/\/+$/, '');
}

/** Indirizzo da mostrare all'utente (link "Apri in InCampo"). */
function urlPubblico(app) {
  const forzato = String(process.env['SUITE_URL_PUBBLICO_' + app.toUpperCase()] || '').trim();
  if (forzato) return forzato.replace(/\/+$/, '');
  const dominio = String(process.env.SUITE_DOMINIO || '').trim();
  const [sotto, porta] = APP[app];
  return dominio ? `https://${sotto}.${dominio}` : `http://localhost:${porta}`;
}

/** Token di servizio: ambiente, altrimenti file condiviso (creato se manca). */
function token(file = FILE_TOKEN) {
  const env = String(process.env.SUITE_TOKEN || '').trim();
  if (env) return env;
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) return t;
  } catch { /* manca: lo creiamo */ }
  const t = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, t + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    process.env.SUITE_TOKEN = t;   // cartella non scrivibile: vale per questo processo
  }
  return t;
}

/** True se `valore` (header X-Suite-Token) è il token di servizio. */
function verifica(valore, file = FILE_TOKEN) {
  if (!valore) return false;
  const a = Buffer.from(String(valore).trim());
  const b = Buffer.from(token(file));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Confronto robusto del codice commessa: senza spazi, maiuscolo. */
function normalizzaCommessa(codice) {
  return String(codice || '').replace(/\s+/g, '').toUpperCase();
}

class SuiteError extends Error {
  constructor(app, stato, messaggio) {
    super(messaggio);
    this.name = 'SuiteError';
    this.app = app;
    this.stato = stato;
    this.messaggio = messaggio;
  }
}

function intestazioni({ utente, nome, email } = {}) {
  const h = { [HEADER_TOKEN]: token(), Accept: 'application/json, */*' };
  if (utente) h[HEADER_UTENTE] = String(utente).slice(0, 120);
  if (nome) h[HEADER_NOME] = String(nome).slice(0, 120).replace(/[^\x20-\xff]/g, '?');
  if (email) h[HEADER_EMAIL] = String(email).slice(0, 160);
  return h;
}

function messaggioErrore(app, codice, testo) {
  let dati = null;
  try { dati = JSON.parse(testo); } catch { /* non JSON */ }
  if (dati && typeof dati === 'object') {
    for (const k of ['errore', 'detail', 'message', 'error']) {
      const v = dati[k];
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object' && typeof v.message === 'string') return v.message;
      if (Array.isArray(v) && v.length) return v.map((x) => (x && typeof x === 'object' ? x.msg || JSON.stringify(x) : String(x))).join('; ');
    }
  }
  const breve = String(testo || '').slice(0, 200).trim();
  return `${NOMI[app]}: errore ${codice}` + (breve && breve.length < 120 ? ` (${breve})` : '');
}

/**
 * Chiama un'altra app della suite. Ritorna il JSON decodificato (null se vuoto).
 *  - dati:      oggetto → corpo JSON
 *  - parametri: oggetto → query string (valori vuoti/null saltati)
 *  - utente, nome, email: chi è l'utente del portale (header X-Suite-*)
 *  - corpoFile: { dati: Buffer, tipo, nome } → il file è il corpo della richiesta,
 *               nome in X-Suite-Nome-File, metadati in `parametri` (come in Python)
 *  - grezzo:    ritorna { dati: Buffer, tipo } invece del JSON
 *  - timeout:   ms (default 10000)
 * Lancia SuiteError con lo stato HTTP; 503 se l'app non risponde.
 */
async function chiama(app, metodo, percorso, { dati, parametri, utente, nome, email, corpoFile, grezzo = false, timeout = 10000 } = {}) {
  if (!APP[app]) throw new SuiteError(app, 500, `App sconosciuta: ${app}`);
  let url = urlApi(app) + percorso;
  if (parametri) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(parametri)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const s = q.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = intestazioni({ utente, nome, email });
  let body;
  if (corpoFile) {
    body = corpoFile.dati;
    headers['Content-Type'] = corpoFile.tipo || 'application/octet-stream';
    headers[HEADER_NOME_FILE] = encodeURIComponent(corpoFile.nome || 'file');
  } else if (dati !== undefined && dati !== null) {
    body = JSON.stringify(dati);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, { method: metodo.toUpperCase(), headers, body, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const motivo = e && (e.cause && e.cause.code || e.name || e.message);
    throw new SuiteError(app, 503, `${NOMI[app]} non raggiungibile (${motivo}): è spenta? Aprila dal portale.`);
  }
  if (!res.ok) {
    throw new SuiteError(app, res.status, messaggioErrore(app, res.status, await res.text().catch(() => '')));
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (grezzo) return { dati: buf, tipo: res.headers.get('content-type') || '' };
  if (!buf.length) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new SuiteError(app, 502, `${NOMI[app]}: risposta non in JSON`); }
}

/** True se l'app risponde (qualunque stato HTTP < 500: anche 401/403 vuol dire accesa). */
async function raggiungibile(app, timeout = 2000) {
  let base = urlApi(app);
  if (base.endsWith('/api')) base = base.slice(0, -4);
  try {
    const r = await fetch(base + SALUTE[app], { signal: AbortSignal.timeout(timeout) });
    return r.status < 500;
  } catch { return false; }
}

// ----------------------------------------------------------------------------- registro commesse
function pulisciCommessa(c) {
  const code = String(c.code || c.codice || '').replace(/\s+/g, ' ').trim();
  if (!code) return null;
  const stato = String(c.stato || 'attiva').trim().toLowerCase();
  return {
    code,
    nome: String(c.nome || c.name || '').trim().slice(0, 200),
    stato: STATI_COMMESSA.includes(stato) ? stato : 'attiva',
    cliente: String(c.cliente || '').trim().slice(0, 200),
    indirizzo: String(c.indirizzo || c.address || '').trim().slice(0, 300),
    note: String(c.note || '').trim().slice(0, 500),
  };
}

/** Registro delle commesse (shared/suite/commesse.json), ordinato per codice. */
function commesse({ soloAttive = false, file = FILE_COMMESSE } = {}) {
  let dati;
  try { dati = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const lista = Array.isArray(dati) ? dati : (dati && dati.commesse) || [];
  const out = [];
  for (const c of lista) {
    if (!c || typeof c !== 'object') continue;
    const p = pulisciCommessa(c);
    if (p && (!soloAttive || p.stato === 'attiva')) out.push(p);
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** Riscrive il registro (doppioni per codice normalizzato: i campi vuoti non cancellano). */
function salvaCommesse(lista, { fonte = 'manuale', file = FILE_COMMESSE } = {}) {
  const perCodice = new Map();
  for (const c of lista || []) {
    const p = c && typeof c === 'object' ? pulisciCommessa(c) : null;
    if (!p) continue;
    const k = normalizzaCommessa(p.code);
    const vecchio = perCodice.get(k);
    if (vecchio) {
      for (const [campo, v] of Object.entries(p)) if (v || campo === 'stato') vecchio[campo] = v;
    } else perCodice.set(k, p);
  }
  const out = [...perCodice.values()].sort((a, b) => a.code.localeCompare(b.code));
  const dati = { aggiornato: new Date().toISOString().slice(0, 19), fonte, commesse: out };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dati, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  return out;
}

/** La commessa del registro con quel codice (confronto normalizzato), o null. */
function trovaCommessa(codice, opts) {
  const k = normalizzaCommessa(codice);
  if (!k) return null;
  return commesse(opts).find((c) => normalizzaCommessa(c.code) === k) || null;
}

module.exports = {
  NOMI, APP, SALUTE, HEADER_TOKEN, HEADER_UTENTE, HEADER_NOME, HEADER_EMAIL, HEADER_NOME_FILE,
  FILE_TOKEN, FILE_COMMESSE, STATI_COMMESSA,
  urlApi, urlPubblico, token, verifica, normalizzaCommessa, SuiteError, intestazioni, chiama, raggiungibile,
  commesse, salvaCommesse, trovaCommessa,
};
