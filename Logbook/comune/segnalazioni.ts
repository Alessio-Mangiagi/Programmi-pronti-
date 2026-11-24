// "><(((º> sabusabu <º)))><"
/**
 * Regole comuni (server e interfaccia) delle segnalazioni dei dipendenti (Giorno 20,
 * 24/11/2026, risposte 1b e 4): le ore le inserisce solo HR; se nella sua giornata qualcosa
 * non torna, il dipendente lo segnala con un testo libero e HR decide se e come intervenire.
 */
import { z } from 'zod';
import { dataObbligatoria, testoFacoltativo, testoObbligatorio } from './schemi';

export const STATI_SEGNALAZIONE = ['APERTA', 'RISOLTA'] as const;
export type StatoSegnalazione = (typeof STATI_SEGNALAZIONE)[number];
export const ETICHETTE_SEGNALAZIONE: Record<StatoSegnalazione, string> = { APERTA: 'Aperta', RISOLTA: 'Risolta' };

/**
 * Nuova segnalazione. `dipendenteId` serve solo a HR (il dipendente segnala sempre per sé:
 * lo decide il server dalla sessione). Il giorno non può essere futuro (controllo nel server,
 * che conosce la data di oggi).
 */
export const schemaSegnalazione = z.object({
  dipendenteId: z.number().int().positive().optional(),
  data: dataObbligatoria('Giorno'),
  testo: testoObbligatorio('Testo', 1000).min(3, 'Scrivi cosa non torna (almeno 3 caratteri)'),
});

/** HR: chiude (o riapre) e risponde. */
export const schemaEsitoSegnalazione = z.object({
  stato: z.enum(STATI_SEGNALAZIONE).optional(),
  rispostaHr: testoFacoltativo(1000).optional(),
});
