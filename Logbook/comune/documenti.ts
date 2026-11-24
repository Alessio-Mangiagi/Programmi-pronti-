// "><(((º> sabusabu <º)))><"
/**
 * Regole comuni (server e interfaccia) di attestati, documenti e documentazione dei
 * progetti (richieste del 24/11/2026, risposte 1c 2c 3c 4a).
 *
 * - Attestati del dipendente: tipo da elenco fisso, titolo, rilascio, scadenza
 *   facoltativa; "in scadenza" nei 30 giorni prima (GIORNI_PREAVVISO_ATTESTATI), poi "scaduto".
 * - Documenti del dipendente: titolo, note, file obbligatorio.
 * - Documentazione di progetto: titolo, nota e/o file, percentuale di avanzamento 0-100
 *   facoltativa; HR la segna vista e può rispondere.
 * - Note interne di progetto (solo HR).
 *
 * La data di rilascio di un attestato può essere anche prima del 2020: è la data scritta
 * sul certificato (un patentino del 2018 che scade nel 2028 è valido oggi). Il limite
 * DATA_MINIMA resta per tutto ciò che registra lavoro: la documentazione di progetto lo usa.
 */
import { z } from 'zod';
import { aggiungiGiorni, isDataValida } from './date';
import { dataObbligatoria, testoFacoltativo, testoObbligatorio } from './schemi';

/**
 * Estensioni dei file che si possono caricare e dimensione massima. Il server
 * (server/servizi/archivio-file.ts, FORMATI) controlla anche i primi byte di ciascuna;
 * l'interfaccia usa questo elenco per il campo file e per avvisare subito.
 */
export const ESTENSIONI_FILE = ['pdf', 'p7m', 'jpg', 'jpeg', 'png', 'webp', 'docx', 'xlsx', 'odt', 'ods', 'doc', 'xls', 'txt'] as const;
export const MAX_MB_FILE = 20;

export const TIPI_ATTESTATO = ['SICUREZZA', 'PRIMO_SOCCORSO', 'ANTINCENDIO', 'PATENTINO', 'VISITA_MEDICA', 'ALTRO'] as const;
type TipoAttestato = (typeof TIPI_ATTESTATO)[number];

export const ETICHETTE_ATTESTATO: Record<TipoAttestato, string> = {
  SICUREZZA: 'Formazione sicurezza',
  PRIMO_SOCCORSO: 'Primo soccorso',
  ANTINCENDIO: 'Antincendio',
  PATENTINO: 'Patentino / abilitazione',
  VISITA_MEDICA: 'Visita medica (idoneità)',
  ALTRO: 'Altro',
};

/** Giorni prima della scadenza in cui un attestato compare "in scadenza" (risposta 1c). */
export const GIORNI_PREAVVISO_ATTESTATI = 30;

export type StatoAttestato = 'VALIDO' | 'IN_SCADENZA' | 'SCADUTO' | 'SENZA_SCADENZA';

export const ETICHETTE_STATO_ATTESTATO: Record<StatoAttestato, string> = {
  VALIDO: 'Valido',
  IN_SCADENZA: 'In scadenza',
  SCADUTO: 'Scaduto',
  SENZA_SCADENZA: 'Non scade',
};

/** Stato di un attestato a una certa data: il giorno di scadenza è ancora valido. */
export function statoAttestato(dataScadenza: string | null | undefined, oggi: string): StatoAttestato {
  if (!dataScadenza) return 'SENZA_SCADENZA';
  if (dataScadenza < oggi) return 'SCADUTO';
  if (dataScadenza <= aggiungiGiorni(oggi, GIORNI_PREAVVISO_ATTESTATI)) return 'IN_SCADENZA';
  return 'VALIDO';
}

/** Id di un file già caricato (POST /api/file); null = nessun file. */
const fileFacoltativo = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.number().int().positive().nullable());

export const schemaAttestato = z
  .object({
    dipendenteId: z.number({ error: 'Dipendente obbligatorio' }).int().positive(),
    tipo: z.enum(TIPI_ATTESTATO, { error: 'Scegli il tipo di attestato' }),
    titolo: testoObbligatorio('Titolo', 150),
    dataRilascio: z.string({ error: 'Data di rilascio: campo obbligatorio' }).refine(isDataValida, 'Data di rilascio non valida'),
    dataScadenza: z.preprocess((v) => v || null, z.string().refine(isDataValida, 'Data di scadenza non valida').nullable()),
    note: testoFacoltativo(500),
    fileId: fileFacoltativo,
  })
  .refine((a) => !a.dataScadenza || a.dataScadenza >= a.dataRilascio, {
    path: ['dataScadenza'],
    message: 'La scadenza non può essere prima del rilascio',
  });

export const schemaDocumentoDipendente = z.object({
  dipendenteId: z.number({ error: 'Dipendente obbligatorio' }).int().positive(),
  titolo: testoObbligatorio('Titolo', 150),
  note: testoFacoltativo(500),
  fileId: z.number({ error: 'Scegli il file da caricare' }).int().positive(),
});

/** Percentuale di avanzamento: "" → null, altrimenti intero 0-100. */
const percentuale = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number({ error: 'Percentuale non valida' }).int('Percentuale: numero intero').min(0, 'Percentuale tra 0 e 100').max(100, 'Percentuale tra 0 e 100').nullable(),
);

export const schemaDocumentoProgetto = z
  .object({
    progettoId: z.number({ error: 'Progetto obbligatorio' }).int().positive(),
    data: dataObbligatoria('Data'),
    titolo: testoObbligatorio('Titolo', 150),
    nota: testoFacoltativo(2000),
    percentuale,
    fileId: fileFacoltativo,
    origine: z.enum(['PROGETTO', 'GIORNATA']).default('PROGETTO'),
  })
  .refine((d) => d.fileId != null || d.nota != null || d.percentuale != null, {
    path: ['nota'],
    message: 'Allega un file, scrivi una nota o indica la percentuale di avanzamento',
  });

/** HR: segna vista e/o risponde. */
export const schemaRevisioneDocumento = z.object({
  visto: z.boolean().optional(),
  rispostaHr: testoFacoltativo(1000).optional(),
});

export const schemaNotaProgetto = z.object({ testo: testoObbligatorio('Testo', 4000) });

/** Byte in forma leggibile: 1,2 MB, 340 KB. */
export function formattaDimensione(byte: number): string {
  if (byte >= 1024 * 1024) return `${(byte / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
  if (byte >= 1024) return `${Math.round(byte / 1024)} KB`;
  return `${byte} byte`;
}
