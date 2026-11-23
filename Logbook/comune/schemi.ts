// "><(((º> sabusabu <º)))><"
/**
 * Regole di validazione dei moduli, condivise da server e interfaccia (Zod).
 *
 * Il server le applica sempre (è l'unico controllo che conta); l'interfaccia le usa
 * per mostrare gli errori accanto ai campi prima ancora di inviare. I messaggi sono in
 * italiano e pensati per chi compila il modulo.
 *
 * Convenzioni: testi vuoti ("") diventano null; date "AAAA-MM-GG"; importi in centesimi.
 */
import { z } from 'zod';
import { validaCodiceFiscale } from './codiceFiscale';
import { DATA_MINIMA, isDataValida, MESSAGGIO_DATA_MINIMA } from './date';

/** Testo facoltativo: spazi tolti, "" o assente → null. */
const testoFacoltativo = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v) || null,
    z.string().max(max, `Massimo ${max} caratteri`).nullable(),
  );

/** Testo obbligatorio, spazi tolti. */
const testoObbligatorio = (etichetta: string, max: number) =>
  z
    .string({ error: `${etichetta}: campo obbligatorio` })
    .trim()
    .min(1, `${etichetta}: campo obbligatorio`)
    .max(max, `Massimo ${max} caratteri`);

/**
 * Data "AAAA-MM-GG" obbligatoria, non precedente al 01/01/2020 (DATA_MINIMA).
 * Usata da tutti i moduli di inserimento: anagrafiche, ore, assenze, festività.
 */
export const dataObbligatoria = (etichetta: string) =>
  z
    .string({ error: `${etichetta}: campo obbligatorio` })
    .refine(isDataValida, `${etichetta}: data non valida`)
    .refine((d) => d >= DATA_MINIMA, `${etichetta}: ${MESSAGGIO_DATA_MINIMA.toLowerCase()}`);

/** Data "AAAA-MM-GG" facoltativa ("" → null), con lo stesso limite minimo. */
const dataFacoltativa = (etichetta: string) =>
  z.preprocess(
    (v) => v || null,
    z
      .string()
      .refine(isDataValida, `${etichetta}: data non valida`)
      .refine((d) => d >= DATA_MINIMA, `${etichetta}: ${MESSAGGIO_DATA_MINIMA.toLowerCase()}`)
      .nullable(),
  );

/** Importo in centesimi facoltativo, non negativo. */
const centesimiFacoltativi = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.number().int('Importo non valido').min(0, "L'importo non può essere negativo").max(100_000, 'Importo troppo alto').nullable(),
);

export const TIPI_CONTRATTO = ['INDETERMINATO', 'DETERMINATO', 'APPRENDISTATO', 'SOMMINISTRAZIONE', 'COLLABORAZIONE', 'TIROCINIO'] as const;
export const ETICHETTE_CONTRATTO: Record<(typeof TIPI_CONTRATTO)[number], string> = {
  INDETERMINATO: 'Tempo indeterminato',
  DETERMINATO: 'Tempo determinato',
  APPRENDISTATO: 'Apprendistato',
  SOMMINISTRAZIONE: 'Somministrazione',
  COLLABORAZIONE: 'Collaborazione',
  TIROCINIO: 'Tirocinio',
};

/** Scheda dipendente (creazione e modifica). */
export const schemaDipendente = z
  .object({
    matricola: testoObbligatorio('Matricola', 20).regex(/^[A-Za-z0-9._-]+$/, 'Matricola: solo lettere, numeri, punto, trattino'),
    nome: testoObbligatorio('Nome', 80),
    cognome: testoObbligatorio('Cognome', 80),
    codiceFiscale: z.string({ error: 'Codice fiscale: campo obbligatorio' }).transform((v, ctx) => {
      const esito = validaCodiceFiscale(v);
      if (!esito.valido) {
        ctx.addIssue({ code: 'custom', message: esito.errore });
        return z.NEVER;
      }
      return esito.codice;
    }),
    email: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.email('Indirizzo email non valido').max(120).nullable()),
    telefono: testoFacoltativo(30),
    mansione: testoFacoltativo(80),
    reparto: testoFacoltativo(80),
    dataAssunzione: dataObbligatoria('Data assunzione'),
    dataCessazione: dataFacoltativa('Data cessazione'),
    tipoContratto: z.enum(TIPI_CONTRATTO, { error: 'Scegli il tipo di contratto' }),
    oreSettimanali: z.coerce
      .number({ error: 'Ore settimanali: numero non valido' })
      .min(1, 'Ore settimanali: almeno 1')
      .max(60, 'Ore settimanali: massimo 60'),
    costoOrarioNettoCent: centesimiFacoltativi,
    costoOrarioLordoCent: centesimiFacoltativi,
    stato: z.enum(['ATTIVO', 'CESSATO']).default('ATTIVO'),
  })
  .superRefine((d, ctx) => {
    if (d.dataCessazione && d.dataCessazione < d.dataAssunzione) {
      ctx.addIssue({ code: 'custom', path: ['dataCessazione'], message: "La cessazione non può precedere l'assunzione" });
    }
    if (d.stato === 'CESSATO' && !d.dataCessazione) {
      ctx.addIssue({ code: 'custom', path: ['dataCessazione'], message: 'Indica la data di cessazione' });
    }
    if (d.costoOrarioNettoCent != null && d.costoOrarioLordoCent != null && d.costoOrarioLordoCent < d.costoOrarioNettoCent) {
      ctx.addIssue({ code: 'custom', path: ['costoOrarioLordoCent'], message: 'Il costo lordo non può essere inferiore al netto' });
    }
  });

export type DatiDipendente = z.output<typeof schemaDipendente>;

/** Account di accesso di un dipendente (creato o modificato da HR). */
export const schemaAccount = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Nome utente: almeno 3 caratteri')
    .max(40, 'Nome utente: massimo 40 caratteri')
    .regex(/^[a-z0-9._-]+$/, 'Nome utente: solo lettere minuscole, numeri, punto, trattino'),
  /** Obbligatoria alla creazione; in modifica, vuota = non cambiare. */
  password: z.string().optional(),
  attivo: z.boolean().default(true),
});

export const STATI_PROGETTO = ['ATTIVO', 'SOSPESO', 'CHIUSO'] as const;

/** Progetto (creazione e modifica). */
export const schemaProgetto = z
  .object({
    codice: testoObbligatorio('Codice', 20)
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9._/-]+$/, 'Codice: solo lettere, numeri, punto, trattino, barra')),
    nome: testoObbligatorio('Nome', 120),
    cliente: testoFacoltativo(120),
    dataInizio: dataObbligatoria('Data inizio'),
    dataFine: dataFacoltativa('Data fine'),
    stato: z.enum(STATI_PROGETTO).default('ATTIVO'),
    colore: z.preprocess((v) => v || null, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colore non valido (#RRGGBB)').nullable()),
    /** Ore massime per dipendente al giorno su questo progetto, in minuti (vuoto = nessun limite). */
    maxMinutiGiorno: z.preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.coerce
        .number({ error: 'Ore massime: numero non valido' })
        .int('Ore massime: numero non valido')
        .min(15, 'Ore massime: almeno 15 minuti')
        .max(24 * 60, 'Ore massime: al massimo 24 ore')
        .nullable(),
    ),
  })
  .superRefine((p, ctx) => {
    if (p.dataFine && p.dataFine < p.dataInizio) {
      ctx.addIssue({ code: 'custom', path: ['dataFine'], message: "La data di fine non può precedere l'inizio" });
    }
  });

export type DatiProgetto = z.output<typeof schemaProgetto>;

/** Trasforma un errore Zod in { campo: messaggio } per i moduli dell'interfaccia. */
export function erroriPerCampo(errore: z.ZodError): Record<string, string> {
  const campi: Record<string, string> = {};
  for (const p of errore.issues) campi[p.path.join('.') || '_'] ??= p.message;
  return campi;
}
