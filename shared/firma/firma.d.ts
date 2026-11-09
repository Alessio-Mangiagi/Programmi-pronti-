// "><(((º> sabusabu <º)))><"
// Tipi del client Node della firma digitale (firma.js). Il rapporto è il JSON di `firma.py apri`.

export type EsitoFirma = 'valida' | 'non valida' | 'da verificare';

export interface MarcaTemporale {
  data: string | null;
  valida: boolean;
  motivo: string | null;
  ente: string | null;
}

export interface Firma {
  firmatario: string;
  codice_fiscale?: string | null;
  organizzazione?: string | null;
  ente_certificatore?: string | null;
  certificato_valido_dal?: string;
  certificato_valido_al?: string;
  qualificato?: boolean;
  dispositivo_sicuro?: boolean;
  tipo?: string;
  integra?: boolean;
  catena?: string | null;
  data_firma_dichiarata?: string | null;
  data_riferimento?: string | null;
  marca_temporale?: MarcaTemporale | null;
  esito: EsitoFirma | null;
  motivi: string[];
  livello: number;
}

export interface RapportoFirma {
  firmato: boolean;
  nome_contenuto: string;
  livelli: number;
  firme: Firma[];
  esito: EsitoFirma | null;
  riepilogo: string;
  elenchi?: { fonte: string | null; aggiornati_il: string | null; servizi: number; errore: string | null } | null;
  dimensione_contenuto?: number;
}

export function eBustaFirmata(buffer: Buffer, nome?: string | null): boolean;
export function nomeSenzaP7m(nome?: string | null): string;
export function pythonFirma(): string;
/** Cartella del motore in uso (FIRMA_DIR → <cartella dell'exe>/shared/firma → shared/firma), null se non c'è. */
export function cartellaMotore(): string | null;
/** Le cartelle provate, nell'ordine (per i messaggi e le diagnosi). */
export function candidatiMotore(): string[];
export function apri(buffer: Buffer, nome?: string | null,
  opzioni?: { rete?: boolean; verifica?: boolean; timeoutMs?: number }):
  Promise<{ contenuto: Buffer; nomeContenuto: string; rapporto: RapportoFirma }>;

declare const _default: {
  eBustaFirmata: typeof eBustaFirmata; apri: typeof apri; nomeSenzaP7m: typeof nomeSenzaP7m; pythonFirma: typeof pythonFirma;
  cartellaMotore: typeof cartellaMotore; candidatiMotore: typeof candidatiMotore;
};
export default _default;
