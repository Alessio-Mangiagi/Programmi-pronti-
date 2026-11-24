// "><(((º> sabusabu <º)))><"
/**
 * Client delle API di Logbook usato da tutte le pagine.
 *
 * - Aggiunge sempre l'intestazione `X-Logbook: 1` richiesta dal controllo CSRF del
 *   server (server/middleware.ts) e manda il cookie di sessione (stessa origine).
 * - Se la risposta non è 2xx solleva ErroreApi con il messaggio in italiano del server
 *   e gli eventuali errori per campo, da mostrare nei moduli.
 * - Un 401 avvisa l'app (evento "logbook:sessione-scaduta") che torna al login.
 */

export class ErroreApi extends Error {
  constructor(
    public stato: number,
    messaggio: string,
    public campi: Record<string, string> = {},
    /** Corpo completo della risposta d'errore (es. i 'problemi' dell'inserimento a blocchi, Giorno 27). */
    public dati: unknown = null,
  ) {
    super(messaggio);
  }
}

async function richiesta<T>(metodo: string, percorso: string, corpo?: unknown, grezzo?: Blob | ArrayBuffer, extra: Record<string, string> = {}): Promise<T> {
  const intestazioni: Record<string, string> = { 'X-Logbook': '1', ...extra };
  let body: BodyInit | undefined;
  if (grezzo !== undefined) {
    intestazioni['Content-Type'] = 'application/octet-stream';
    body = grezzo;
  } else if (corpo !== undefined) {
    intestazioni['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  let r: Response;
  try {
    r = await fetch(percorso, { method: metodo, headers: intestazioni, body, credentials: 'same-origin' });
  } catch {
    throw new ErroreApi(0, 'Server non raggiungibile: controlla che Logbook sia avviato');
  }
  const tipo = r.headers.get('content-type') ?? '';
  const dati = tipo.includes('application/json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !percorso.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('logbook:sessione-scaduta'));
    }
    throw new ErroreApi(r.status, dati?.errore ?? `Errore ${r.status}`, dati?.campi ?? {}, dati);
  }
  return dati as T;
}

export const api = {
  get: <T>(percorso: string) => richiesta<T>('GET', percorso),
  post: <T>(percorso: string, corpo?: unknown) => richiesta<T>('POST', percorso, corpo ?? {}),
  put: <T>(percorso: string, corpo: unknown) => richiesta<T>('PUT', percorso, corpo),
  patch: <T>(percorso: string, corpo: unknown) => richiesta<T>('PATCH', percorso, corpo),
  delete: <T>(percorso: string) => richiesta<T>('DELETE', percorso),
  /** Invio di un file così com'è (import Excel). */
  file: <T>(percorso: string, file: Blob) => richiesta<T>('POST', percorso, undefined, file),
  /**
   * Carica un allegato nell'archivio (POST /api/file, server/rotte/file.ts): byte nel
   * corpo, nome nell'intestazione X-Nome-File. Restituisce { id, nome, tipo, dimensione }
   * da collegare poi ad attestato, documento o documentazione di progetto.
   */
  carica: <T>(file: File) => richiesta<T>('POST', '/api/file', undefined, file, { 'X-Nome-File': encodeURIComponent(file.name) }),
};

/**
 * Scarica un file prodotto dal server (modello Excel, report) e lo salva nel browser.
 * Usa POST se c'è un corpo (filtri dei report), GET altrimenti.
 */
export async function scaricaFile(percorso: string, corpo?: unknown): Promise<void> {
  const r = await fetch(percorso, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'X-Logbook': '1', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  if (!r.ok) {
    const dati = (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : null;
    throw new ErroreApi(r.status, dati?.errore ?? `Errore ${r.status}`);
  }
  // Nome file dall'intestazione Content-Disposition (filename*=UTF-8''...)
  const disp = r.headers.get('content-disposition') ?? '';
  const nome = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disp)?.[1] ?? /filename="?([^";]+)/.exec(disp)?.[1] ?? 'logbook.xlsx');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
