// "><(((º> sabusabu <º)))><"
/**
 * Client delle API di Copilota usato da tutte le pagine.
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

/**
 * Ultima azione dell'utente su questa pagina (mouse, tastiera, tocco). Giorno 34: il server
 * chiude la sessione dopo 15 minuti senza azioni (server/auth/sessioni.ts) e considera
 * "azione" solo le richieste con X-Logbook-Attivo: 1, che qui si aggiunge se l'utente ha
 * fatto qualcosa nell'ultimo minuto. Le chiamate che l'interfaccia fa da sola (data,
 * campanella) partono senza, e non tengono aperta la sessione di un PC lasciato acceso.
 */
let ultimaAzione = Date.now();
export const ultimaAzioneUtente = () => ultimaAzione;
const UTENTE_ATTIVO_MS = 60 * 1000;
if (typeof window !== 'undefined') {
  for (const evento of ['pointerdown', 'keydown', 'wheel', 'mousemove', 'touchstart']) {
    window.addEventListener(evento, () => { ultimaAzione = Date.now(); }, { passive: true, capture: true });
  }
}

async function richiesta<T>(metodo: string, percorso: string, corpo?: unknown, grezzo?: Blob | ArrayBuffer, extra: Record<string, string> = {}): Promise<T> {
  const intestazioni: Record<string, string> = { 'X-Logbook': '1', ...extra };
  if (Date.now() - ultimaAzione < UTENTE_ATTIVO_MS) intestazioni['X-Logbook-Attivo'] = '1';
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
    throw new ErroreApi(0, 'Server non raggiungibile: controlla che Copilota sia avviato');
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

/** Oltre questa dimensione un allegato viene mandato a parti (stesso valore di BYTE_PER_PARTE sul server). */
const SOGLIA_PARTI = 3 * 1024 * 1024;

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
  carica: async <T>(file: File): Promise<T> => {
    if (file.size <= SOGLIA_PARTI) return richiesta<T>('POST', '/api/file', undefined, file, { 'X-Nome-File': encodeURIComponent(file.name) });
    // Giorno 46: i file grandi vanno a parti (su Vercel una richiesta oltre 4,5 MB è rifiutata).
    // Il server dice quante parti servono; alla fine le ricompone e controlla il file intero.
    const inizio = await richiesta<{ caricamento: string; parti: number; bytePerParte: number }>('POST', '/api/file/parti', { nome: file.name, dimensione: file.size });
    for (let n = 0; n < inizio.parti; n++) {
      await richiesta('PUT', `/api/file/parti/${inizio.caricamento}/${n}`, undefined, file.slice(n * inizio.bytePerParte, (n + 1) * inizio.bytePerParte));
    }
    return richiesta<T>('POST', `/api/file/parti/${inizio.caricamento}/fine`, {});
  },
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
