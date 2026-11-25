// "><(((º> sabusabu <º)))><"
/**
 * Regole delle assenze (ferie, permessi, malattia) e delle festività, condivise da
 * server e interfaccia.
 *
 * - FERIE e MALATTIA coprono giorni interi, da una data a un'altra.
 * - PERMESSO è di un giorno solo e ha una durata in minuti (es. 2 ore = 120).
 * - MALATTIA: si può indicare solo il numero di protocollo del certificato. Per scelta
 *   (privacy, GDPR art. 9) non esiste nessun campo per diagnosi o note sanitarie: le note
 *   del dipendente non sono ammesse per la malattia, così nessuno le usa per scriverle.
 */
import { z } from 'zod';
import { isDataAmmessa, isDataValida, MESSAGGIO_DATA_MINIMA } from './date';

export const TIPI_ASSENZA = ['FERIE', 'PERMESSO', 'MALATTIA'] as const;
export const ETICHETTE_ASSENZA: Record<(typeof TIPI_ASSENZA)[number], string> = { FERIE: 'Ferie', PERMESSO: 'Permesso', MALATTIA: 'Malattia' };
export const ETICHETTE_STATO_ASSENZA = { RICHIESTA: 'In attesa', APPROVATA: 'Approvata', RIFIUTATA: 'Rifiutata' } as const;

const testoFacoltativo = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().max(max, `Massimo ${max} caratteri`).nullable());

/** Campi di un'assenza come li compila il dipendente (o HR per suo conto). */
export const schemaAssenza = z
  .object({
    dipendenteId: z.coerce.number().int().positive().optional(),
    tipo: z.enum(TIPI_ASSENZA, { error: "Scegli il tipo di assenza" }),
    dataInizio: z.string({ error: 'Data inizio: campo obbligatorio' }).refine(isDataValida, 'Data inizio non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
    dataFine: z.string({ error: 'Data fine: campo obbligatorio' }).refine(isDataValida, 'Data fine non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
    minutiPermesso: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().nullable()),
    noteDipendente: testoFacoltativo(500),
    protocolloCertificato: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v) || null,
      z.string().regex(/^[A-Za-z0-9/-]{3,40}$/, 'Protocollo: da 3 a 40 caratteri, solo lettere, numeri, / e -').nullable(),
    ),
    /** Allegato facoltativo (Giorno 22, risposta 3b): id di un file già caricato con POST /api/file. */
    fileId: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.number().int().positive().nullable()),
  })
  .superRefine((a, ctx) => {
    if (isDataValida(a.dataInizio) && isDataValida(a.dataFine) && a.dataFine < a.dataInizio) {
      ctx.addIssue({ code: 'custom', path: ['dataFine'], message: 'La data di fine non può precedere quella di inizio' });
    }
    if (a.tipo === 'PERMESSO') {
      if (a.dataFine !== a.dataInizio) ctx.addIssue({ code: 'custom', path: ['dataFine'], message: 'Un permesso vale per un solo giorno' });
      if (a.minutiPermesso == null || a.minutiPermesso < 15 || a.minutiPermesso > 10 * 60) {
        ctx.addIssue({ code: 'custom', path: ['minutiPermesso'], message: 'Indica la durata del permesso (da 15 minuti a 10 ore)' });
      }
    } else if (a.minutiPermesso != null) {
      ctx.addIssue({ code: 'custom', path: ['minutiPermesso'], message: 'La durata in ore vale solo per i permessi' });
    }
    if (a.tipo !== 'MALATTIA' && a.protocolloCertificato) {
      ctx.addIssue({ code: 'custom', path: ['protocolloCertificato'], message: 'Il protocollo del certificato vale solo per la malattia' });
    }
    if (a.tipo === 'MALATTIA' && a.noteDipendente) {
      ctx.addIssue({ code: 'custom', path: ['noteDipendente'], message: 'Per la malattia non si scrivono note: indica solo il protocollo del certificato' });
    }
  });

export type DatiAssenza = z.output<typeof schemaAssenza>;

/** Decisione di HR su una richiesta. Il rifiuto chiede sempre un motivo. */
export const schemaDecisione = z
  .object({
    stato: z.enum(['APPROVATA', 'RIFIUTATA'], { error: 'Decisione non valida' }),
    noteHr: testoFacoltativo(500),
  })
  .superRefine((d, ctx) => {
    if (d.stato === 'RIFIUTATA' && !d.noteHr) ctx.addIssue({ code: 'custom', path: ['noteHr'], message: 'Indica il motivo del rifiuto' });
  });

export const TIPI_FESTIVITA = ['NAZIONALE', 'LOCALE', 'AZIENDALE'] as const;
export const ETICHETTE_FESTIVITA: Record<(typeof TIPI_FESTIVITA)[number], string> = {
  NAZIONALE: 'Nazionale',
  LOCALE: 'Locale (patrono)',
  AZIENDALE: 'Chiusura aziendale',
};

export const schemaFestivita = z.object({
  data: z.string({ error: 'Data: campo obbligatorio' }).refine(isDataValida, 'Data non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
  descrizione: z.string({ error: 'Descrizione: campo obbligatorio' }).trim().min(2, 'Descrizione: almeno 2 caratteri').max(120),
  tipo: z.enum(TIPI_FESTIVITA, { error: 'Scegli il tipo' }),
});

/** Due periodi (date comprese) hanno almeno un giorno in comune. */
export const periodiSovrapposti = (a: { dataInizio: string; dataFine: string }, b: { dataInizio: string; dataFine: string }) =>
  a.dataInizio <= b.dataFine && b.dataInizio <= a.dataFine;
