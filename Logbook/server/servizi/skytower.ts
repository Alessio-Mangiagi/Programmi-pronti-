// "><(((º> sabusabu <º)))><"
/**
 * Collegamento facoltativo a SkyTower, l'archivio documentale (CDE) della suite
 * (risposta "4a e b come pulsante" del 24/11/2026).
 *
 * I file di Logbook restano sul suo server (4a). Se un admin registra il collegamento in
 * Impostazioni, HR vede il pulsante "Invia a SkyTower" sulla documentazione dei progetti
 * che hanno una commessa SkyTower; senza collegamento il pulsante non esiste.
 *
 * Contratto (shared/suite/CONTRATTI.md § 4-5, lo stesso usato da Lettore DDT e VFP Transfer):
 * - autenticazione col token di servizio della suite nell'intestazione X-Suite-Token;
 * - chi agisce in SkyTower: X-Suite-Email (un utente attivo dell'organizzazione), altrimenti
 *   SkyTower usa il suo utente tecnico; X-Suite-App: logbook per il registro di sicurezza;
 * - GET  /suite/commesse                  → progetti con codice commessa;
 * - POST /suite/commesse/{codice}/documenti?title=&description=&tipo=&attributes=
 *   con il file nel corpo (Content-Type del file) e il nome in X-Suite-Nome-File: crea un
 *   documento WIP nella cartella "Suite Cosedil" e risponde con identifier e url.
 *
 * Impostazioni salvate (tabella Impostazione): skytower.url (indirizzo dell'API, di solito
 * http://127.0.0.1:8100), skytower.token, skytower.email. Il token non esce mai verso il
 * browser: server/rotte/impostazioni.ts restituisce solo "impostato sì/no".
 */
import type { PrismaClient } from '../../generated/prisma/client';
import { ErroreHttp } from '../errori';

type CollegamentoSkytower = { url: string; token: string; email: string | null };

export const CHIAVI_SKYTOWER = { url: 'skytower.url', token: 'skytower.token', email: 'skytower.email' } as const;

/** Collegamento registrato, oppure null se mancano indirizzo o token. */
export async function leggiCollegamento(prisma: PrismaClient): Promise<CollegamentoSkytower | null> {
  const righe = await prisma.impostazione.findMany({ where: { chiave: { in: Object.values(CHIAVI_SKYTOWER) } } });
  const valore = (k: string) => righe.find((r) => r.chiave === k)?.valore.trim() || '';
  const url = valore(CHIAVI_SKYTOWER.url).replace(/\/+$/, '');
  const token = valore(CHIAVI_SKYTOWER.token);
  if (!url || !token) return null;
  return { url, token, email: valore(CHIAVI_SKYTOWER.email) || null };
}

/** Messaggio leggibile dall'errore di SkyTower (FastAPI: {"detail": ...} o {"message": ...}). */
function messaggioDa(testo: string): string {
  try {
    const j = JSON.parse(testo);
    const v = j?.message ?? j?.detail ?? j?.errore;
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof v.message === 'string') return v.message;
  } catch {
    /* non JSON */
  }
  return testo.slice(0, 160);
}

type OpzioniChiamata = {
  parametri?: Record<string, string | undefined>;
  file?: { dati: Buffer; tipo: string; nome: string };
  timeout?: number;
};

/** Chiamata all'API della suite di SkyTower. Errori → ErroreHttp con un messaggio per HR. */
async function chiamaSkytower<T>(c: CollegamentoSkytower, metodo: 'GET' | 'POST', percorso: string, o: OpzioniChiamata = {}): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o.parametri ?? {})) if (v) q.set(k, v);
  const url = `${c.url}${percorso}${q.size ? `?${q}` : ''}`;
  const intestazioni: Record<string, string> = { 'X-Suite-Token': c.token, 'X-Suite-App': 'logbook', Accept: 'application/json' };
  if (c.email) intestazioni['X-Suite-Email'] = c.email;
  let body: Uint8Array | undefined;
  if (o.file) {
    intestazioni['Content-Type'] = o.file.tipo.split(';')[0];
    intestazioni['X-Suite-Nome-File'] = encodeURIComponent(o.file.nome);
    body = new Uint8Array(o.file.dati);
  }
  let r: Response;
  try {
    r = await fetch(url, { method: metodo, headers: intestazioni, body, signal: AbortSignal.timeout(o.timeout ?? 10000) });
  } catch (e) {
    const motivo = (e as { cause?: { code?: string }; name?: string }).cause?.code ?? (e as Error).name;
    throw new ErroreHttp(502, `SkyTower non raggiungibile all'indirizzo ${c.url} (${motivo}): è acceso? L'indirizzo è giusto?`);
  }
  const testo = await r.text();
  if (r.status === 401 || r.status === 403) {
    throw new ErroreHttp(502, `SkyTower ha rifiutato l'accesso (${r.status}): controlla il token di servizio e l'email dell'utente in Impostazioni. ${messaggioDa(testo)}`.trim());
  }
  if (!r.ok) throw new ErroreHttp(502, `SkyTower ha risposto ${r.status}: ${messaggioDa(testo)}`);
  return (testo ? JSON.parse(testo) : null) as T;
}

type CommessaSkytower = { code: string; name: string; commessa: string; url?: string };

/** Commesse di SkyTower (anche per la prova del collegamento e il menu nella scheda progetto). */
export function commesseSkytower(c: CollegamentoSkytower) {
  return chiamaSkytower<CommessaSkytower[]>(c, 'GET', '/suite/commesse');
}

/** Invia un file come documento WIP della commessa. Restituisce identificativo e link. */
export async function inviaDocumento(
  c: CollegamentoSkytower,
  commessa: string,
  d: { dati: Buffer; tipo: string; nome: string; titolo: string; descrizione?: string; attributi: Record<string, unknown> },
) {
  const r = await chiamaSkytower<{ identifier?: string; url?: string; document_id?: string }>(c, 'POST', `/suite/commesse/${encodeURIComponent(commessa)}/documenti`, {
    parametri: { title: d.titolo.slice(0, 300), description: d.descrizione?.slice(0, 4000), tipo: 'RP', attributes: JSON.stringify(d.attributi) },
    file: { dati: d.dati, tipo: d.tipo, nome: d.nome },
    timeout: 60000,
  });
  return { identificativo: r?.identifier ?? r?.document_id ?? 'documento', url: r?.url ?? null };
}
