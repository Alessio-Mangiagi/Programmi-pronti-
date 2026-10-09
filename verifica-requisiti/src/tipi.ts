/**
 * tipi.ts — modello dati dell'app.
 *
 * Tre entità e un verbo:
 *   Documento     — un file caricato (scansione o PDF con testo), con il suo testo per pagina.
 *   SetRequisiti  — l'elenco di requisiti da controllare (checklist).
 *   Verifica      — l'esito del controllo di un set su un documento.
 * Il verbo è la ricerca full-text, che lavora sul testo dei documenti.
 */
import type { MotoreOcr } from './config';

export type StatoDocumento = 'in-coda' | 'in-lavorazione' | 'pronto' | 'errore';

export interface PaginaTesto {
  numero: number;
  testo: string;
  /** 0-1, solo per le pagine passate dall'OCR. */
  confidenza?: number;
}

export interface Documento {
  id: string;
  nomeFile: string;
  /** Percorso del file originale in data/archivio/. */
  percorso: string;
  /** sha256 del file: due upload dello stesso documento non si duplicano. */
  hash: string;
  mime: string;
  byte: number;
  caricatoDa: string;
  caricatoIl: string;
  stato: StatoDocumento;
  /** true = niente testo nativo, il testo arriva dall'OCR. */
  scansione: boolean;
  motoreOcr?: MotoreOcr;
  pagine: PaginaTesto[];
  /** Etichette libere per filtrare (commessa, fornitore, tipo documento). */
  etichette: string[];
  errore?: string;
}

// ── Requisiti ───────────────────────────────────────────────────────────────

// "><(((º> sabusabu <º)))><"
export type TipoRegola =
  /** Uno dei termini deve comparire nel documento. */
  | 'presenza'
  /** Nessuno dei termini deve comparire. */
  | 'assenza'
  /** Espressione regolare; il gruppo indicato diventa il valore estratto. */
  | 'regex'
  /** Data catturata da pattern: deve essere futura (o entro N giorni). */
  | 'scadenza'
  /** Numero catturato da pattern: deve stare fra min e max. */
  | 'numero'
  /** Nessun automatismo: sempre 'dubbio', decide una persona. */
  | 'manuale';

export interface Regola {
  tipo: TipoRegola;
  /** presenza/assenza: termini cercati (OR). */
  termini?: string[];
  /** regex/scadenza/numero: pattern con almeno un gruppo di cattura. */
  pattern?: string;
  /** Indice del gruppo di cattura da usare come valore. Default 1. */
  gruppo?: number;
  /** scadenza: giorni di preavviso; sotto questa soglia l'esito è 'dubbio'. */
  preavvisoGiorni?: number;
  /** numero: intervallo ammesso. */
  min?: number;
  max?: number;
}

export interface Requisito {
  id: string;
  /** Codice breve stampato nei report (es. DURC-01). */
  codice: string;
  titolo: string;
  descrizione?: string;
  /** false = la mancanza vale 'dubbio' invece di 'ko'. */
  obbligatorio: boolean;
  regola: Regola;
}

export interface SetRequisiti {
  id: string;
  nome: string;
  descrizione?: string;
  creatoIl: string;
  requisiti: Requisito[];
}

// ── Verifiche ───────────────────────────────────────────────────────────────

export type Esito = 'ok' | 'ko' | 'dubbio' | 'non-applicabile';

/** Punto del documento che ha fatto scattare l'esito: serve a poterlo rileggere. */
export interface Riscontro {
  pagina: number;
  /** Offset del riscontro dentro il testo della pagina. */
  offset: number;
  /** Poche righe attorno al riscontro, per mostrarle senza riaprire il file. */
  estratto: string;
}

export interface RisultatoRequisito {
  requisitoId: string;
  codice: string;
  titolo: string;
  esito: Esito;
  /** Valore estratto dalla regola (data, numero, testo catturato). */
  valore?: string;
  /** Perché quell'esito, in italiano: finisce dritto nel report. */
  motivo: string;
  riscontri: Riscontro[];
}

export interface Verifica {
  id: string;
  documentoId: string;
  nomeFile: string;
  setId: string;
  nomeSet: string;
  eseguitaIl: string;
  eseguitaDa: string;
  /** Peggior esito fra i requisiti obbligatori. */
  esito: Esito;
  risultati: RisultatoRequisito[];
}

// ── Ricerca ─────────────────────────────────────────────────────────────────

export interface EsitoRicerca {
  documentoId: string;
  nomeFile: string;
  /** Numero di occorrenze trovate: ordina i risultati. */
  occorrenze: number;
  riscontri: Riscontro[];
}
