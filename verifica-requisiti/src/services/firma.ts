// "><(((º> sabusabu <º)))><"
/**
 * firma.ts — PDF firmati digitalmente in busta .p7m (CAdES), richiesta del 06/11/2026.
 *
 * Il lavoro vero lo fa il motore comune della suite (shared/firma, CONTRATTI §10): apre la busta, tira fuori il
 * PDF e verifica le firme (catena fino agli enti qualificati eIDAS, revoca, marca temporale). Qui c'è solo:
 *   - il ponte verso il client Node `shared/firma/firma.js` (CommonJS senza tipi nostri: si dichiara l'interfaccia
 *     che serve, come per suite_link in middleware/suiteToken.ts), sostituibile nei test con `impostaClientFirma`;
 *   - `apriBusta`: busta → contenuto (solo PDF e immagini, come l'upload) + sintesi della firma da salvare nel
 *     record del documento; errori già scritti per l'utente (ErroreFirma), mai un 500.
 * L'estrazione (services/estrazione.ts) chiama apriBusta prima di leggere il testo, così anche «Rielabora» rifà
 * la verifica (utile se la prima volta mancava la rete per il controllo di revoca).
 */
import path from 'path';

export type EsitoFirma = 'valida' | 'non valida' | 'da verificare';

/** Una firma come la restituisce shared/firma (solo i campi che usiamo). */
export interface FirmaMotore {
  firmatario: string;
  codice_fiscale?: string | null;
  ente_certificatore?: string | null;
  tipo?: string;
  esito: EsitoFirma | null;
  motivi: string[];
  data_firma_dichiarata?: string | null;
  data_riferimento?: string | null;
  marca_temporale?: { data: string | null; valida: boolean } | null;
  livello?: number;
}

export interface RapportoMotore {
  firmato: boolean;
  nome_contenuto: string;
  livelli: number;
  firme: FirmaMotore[];
  esito: EsitoFirma | null;
  riepilogo: string;
}

export interface ClientFirma {
  eBustaFirmata(buffer: Buffer, nome?: string | null): boolean;
  apri(buffer: Buffer, nome?: string | null, opzioni?: { rete?: boolean; verifica?: boolean }):
    Promise<{ contenuto: Buffer; nomeContenuto: string; rapporto: RapportoMotore }>;
}

/** La firma salvata nel documento (data/documenti.json) e mostrata nell'elenco e nell'API. */
export interface FirmaDocumento {
  esito: EsitoFirma | null;
  riepilogo: string;
  livelli: number;
  firme: Array<{
    firmatario: string;
    codiceFiscale: string | null;
    ente: string | null;
    tipo: string | null;
    esito: EsitoFirma | null;
    motivi: string[];
    data: string | null;
    marcaTemporale: boolean;
  }>;
  verificataIl: string;
}

// Stesso percorso relativo da src/services e da dist/services.
// eslint-disable-next-line @typescript-eslint/no-require-imports
let client: ClientFirma = require('../../../shared/firma/firma.js');

/** Solo per i test: un client finto al posto del motore vero. */
export function impostaClientFirma(nuovo: ClientFirma): void {
  client = nuovo;
}

/** Vero se il file è una busta .p7m (per estensione o per contenuto): nessun processo, si chiama su ogni upload. */
export function eBustaFirmata(buffer: Buffer, nome?: string | null): boolean {
  return client.eBustaFirmata(buffer, nome);
}

/** Errore con un messaggio già pronto per l'utente (finisce in documento.errore). */
export class ErroreFirma extends Error {}

/** Cosa può esserci dentro la busta: gli stessi formati che l'upload accetta da soli. */
const MIME_CONTENUTO: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export function sintesiFirma(r: RapportoMotore): FirmaDocumento {
  return {
    esito: r.esito,
    riepilogo: r.riepilogo,
    livelli: r.livelli,
    firme: (r.firme || []).map((f) => ({
      firmatario: f.firmatario,
      codiceFiscale: f.codice_fiscale ?? null,
      ente: f.ente_certificatore ?? null,
      tipo: f.tipo ?? null,
      esito: f.esito,
      motivi: f.motivi || [],
      // la data che vale: marca temporale se valida, altrimenti quella dichiarata dal firmatario
      data: (f.marca_temporale?.valida ? f.marca_temporale.data : null) ?? f.data_firma_dichiarata ?? null,
      marcaTemporale: !!f.marca_temporale?.valida,
    })),
    verificataIl: new Date().toISOString(),
  };
}

/**
 * Apre la busta e verifica le firme.
 * @returns il documento contenuto (PDF o immagine), la sua estensione e il mime, la sintesi della firma.
 * @throws ErroreFirma con un messaggio per l'utente (motore non installato, busta rotta, contenuto non ammesso).
 */
export async function apriBusta(buffer: Buffer, nome: string, opzioni: { rete?: boolean } = {}): Promise<{
  contenuto: Buffer;
  nomeContenuto: string;
  estensione: string;
  mime: string;
  firma: FirmaDocumento;
}> {
  let aperta;
  try {
    // rete=false solo nei test: niente elenchi da scaricare né controllo di revoca online
    aperta = await client.apri(buffer, nome, { rete: opzioni.rete ?? true });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === 'FIRMA_NON_INSTALLATA') {
      throw new ErroreFirma(
        'Componente firma digitale non installato: lanciare shared\\firma\\installa.bat, poi «Rielabora».'
      );
    }
    if (err.code === 'BUSTA_ILLEGGIBILE') throw new ErroreFirma(`File firmato illeggibile: ${err.message}`);
    throw new ErroreFirma(`Verifica della firma non riuscita: ${err.message}`);
  }
  const estensione = path.extname(aperta.nomeContenuto || '').toLowerCase();
  const mime = MIME_CONTENUTO[estensione];
  if (!mime) {
    throw new ErroreFirma(
      `La busta firmata contiene «${aperta.nomeContenuto}»: si leggono solo PDF e immagini (png, jpg, tiff).`
    );
  }
  return { contenuto: aperta.contenuto, nomeContenuto: aperta.nomeContenuto, estensione, mime, firma: sintesiFirma(aperta.rapporto) };
}
