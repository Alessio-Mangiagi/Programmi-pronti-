// Client HTTP verso Trimble: token OAuth2 + chiamate REST.
//
// ATTENZIONE — i percorsi qui sotto sono quelli di Trimble Connect (TC API 2.0).
// e-Builder, Viewpoint e Quadri hanno base URL e rotte diverse: se l'app parla con
// uno di quelli, cambiano solo le funzioni di questo file (percorsi + forma della
// risposta), non il resto dell'applicazione. Verificare sulla documentazione del
// prodotto in uso prima di puntare su un tenant vero.
import { CONFIG, trimbleConfigurato } from '../config.js';
import { log } from '../log.js';

let tokenCache = { valore: null, scadenza: 0 };

export class ErroreTrimble extends Error {
  constructor(messaggio, { stato = 0, corpo = '' } = {}) {
    super(messaggio);
    this.name = 'ErroreTrimble';
    this.stato = stato;
    this.corpo = corpo;
  }
}

/** Token client_credentials, tenuto in cache fino a 60 s prima della scadenza. */
export async function token({ forza = false } = {}) {
  if (!trimbleConfigurato()) throw new ErroreTrimble('Trimble non configurato: mancano client id/secret in .env');
  if (!forza && tokenCache.valore && Date.now() < tokenCache.scadenza) return tokenCache.valore;

  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CONFIG.trimble.clientId,
    client_secret: CONFIG.trimble.clientSecret,
  });
  if (CONFIG.trimble.scope) corpo.set('scope', CONFIG.trimble.scope);

  const res = await fetch(CONFIG.trimble.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: corpo,
    signal: AbortSignal.timeout(CONFIG.trimble.timeoutMs),
  });
  const testo = await res.text();
  if (!res.ok) throw new ErroreTrimble(`token rifiutato (${res.status})`, { stato: res.status, corpo: testo.slice(0, 500) });

  const dati = JSON.parse(testo);
  tokenCache = {
    valore: dati.access_token,
    scadenza: Date.now() + Math.max((dati.expires_in || 3600) - 60, 30) * 1000,
  };
  log.info('token Trimble rinnovato', { scade_tra_s: dati.expires_in });
  return tokenCache.valore;
}

/** Chiamata autenticata; su 401 rinnova il token una volta sola e riprova. */
export async function chiamata(percorso, { metodo = 'GET', query, corpo, headers = {}, riprovato = false } = {}) {
  const url = new URL(CONFIG.trimble.apiBase + percorso);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: metodo,
    headers: { authorization: `Bearer ${await token()}`, accept: 'application/json', ...headers },
    body: corpo,
    signal: AbortSignal.timeout(CONFIG.trimble.timeoutMs),
  });

  if (res.status === 401 && !riprovato) {
    await token({ forza: true });
    return chiamata(percorso, { metodo, query, corpo, headers, riprovato: true });
  }

  const testo = await res.text();
  if (!res.ok) {
    throw new ErroreTrimble(`${metodo} ${percorso} -> ${res.status}`, { stato: res.status, corpo: testo.slice(0, 500) });
  }
  try {
    return testo ? JSON.parse(testo) : null;
  } catch {
    return testo;
  }
}

export const elencaProgetti = () => chiamata('/projects');

// "><(((º> sabusabu <º)))><"
export const elencaCartelle = (projectId = CONFIG.trimble.projectId, parentId) =>
  chiamata('/folders', { query: { projectId, parentId } });

/**
 * Carica il file prodotto dalla pipeline.
 * Trimble Connect vuole il binario grezzo con parentId e name in query string;
 * se il file esiste gia' con lo stesso nome, l'API crea una nuova versione.
 * @returns {Promise<{fileId:string|null, versionId:string|null, risposta:object}>}
 */
export async function caricaFile({ nome, contenuto, mime, projectId = CONFIG.trimble.projectId, folderId = CONFIG.trimble.folderId }) {
  if (!projectId) throw new ErroreTrimble('projectId mancante (TRIMBLE_PROJECT_ID o parametro della richiesta)');
  if (!folderId) throw new ErroreTrimble('folderId mancante (TRIMBLE_FOLDER_ID o parametro della richiesta)');

  const risposta = await chiamata('/files', {
    metodo: 'POST',
    query: { projectId, parentId: folderId, name: nome },
    corpo: contenuto,
    headers: { 'content-type': mime || 'application/octet-stream' },
  });

  return {
    fileId: risposta?.id ?? risposta?.fileId ?? null,
    versionId: risposta?.versionId ?? risposta?.version?.id ?? null,
    risposta,
  };
}

/** Solo per i test: azzera la cache del token. */
export function _svuotaCacheToken() {
  tokenCache = { valore: null, scadenza: 0 };
}
