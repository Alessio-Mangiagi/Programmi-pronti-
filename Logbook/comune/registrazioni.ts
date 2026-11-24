// "><(((º> sabusabu <º)))><"
/**
 * Regole delle fasce orarie: calcolo delle ore e blocco delle sovrapposizioni.
 *
 * Usato dal server (che decide) e dall'editor della giornata nell'interfaccia (che
 * evidenzia l'errore mentre si scrive). Due fasce dello stesso dipendente nello stesso
 * giorno si sovrappongono se una inizia prima che l'altra finisca; fasce contigue
 * (08:00-12:00 e 12:00-13:00) sono ammesse.
 */
import { z } from 'zod';
import { isDataAmmessa, isDataValida, MESSAGGIO_DATA_MINIMA } from './date';
import { durataMinuti, formattaOre, isOrarioValido, minutiDaOrario } from './orari';

type Fascia = { id?: number; oraInizio: string; oraFine: string };

/** true se le due fasce hanno almeno un minuto in comune. */
export function siSovrappongono(a: Fascia, b: Fascia): boolean {
  return minutiDaOrario(a.oraInizio) < minutiDaOrario(b.oraFine) && minutiDaOrario(b.oraInizio) < minutiDaOrario(a.oraFine);
}

/**
 * Coppie di indici di fasce sovrapposte dentro un elenco (es. le righe dell'editor).
 * Le fasce con orari non validi sono ignorate: hanno già il loro errore.
 */
export function coppieSovrapposte(fasce: Fascia[]): [number, number][] {
  const coppie: [number, number][] = [];
  const valide = (f: Fascia) => isOrarioValido(f.oraInizio) && isOrarioValido(f.oraFine) && f.oraInizio < f.oraFine;
  for (let i = 0; i < fasce.length; i++) {
    for (let j = i + 1; j < fasce.length; j++) {
      if (valide(fasce[i]) && valide(fasce[j]) && siSovrappongono(fasce[i], fasce[j])) coppie.push([i, j]);
    }
  }
  return coppie;
}

/** Somma dei minuti di un elenco di fasce valide. */
export function totaleMinuti(fasce: Fascia[]): number {
  return fasce.reduce((s, f) => s + durataMinuti(f.oraInizio, f.oraFine), 0);
}

/**
 * Ore massime giornaliere per progetto (risposta 2b del 23/11/2026): un dipendente non può
 * superare in un giorno il massimo fissato nella scheda del progetto. Riceve le fasce di
 * UN dipendente in UN giorno (quelle già salvate più le nuove) e i massimi per progetto
 * (null = nessun limite); restituisce i progetti oltre il limite.
 */
export function superamentiMassimo(
  fasce: (Fascia & { progettoId: number })[],
  massimi: Map<number, number | null | undefined>,
): { progettoId: number; minuti: number; massimo: number }[] {
  const perProgetto = new Map<number, number>();
  for (const f of fasce) {
    if (!isOrarioValido(f.oraInizio) || !isOrarioValido(f.oraFine) || f.oraFine <= f.oraInizio) continue;
    perProgetto.set(f.progettoId, (perProgetto.get(f.progettoId) ?? 0) + durataMinuti(f.oraInizio, f.oraFine));
  }
  const oltre: { progettoId: number; minuti: number; massimo: number }[] = [];
  for (const [progettoId, minuti] of perProgetto) {
    const massimo = massimi.get(progettoId);
    if (massimo != null && minuti > massimo) oltre.push({ progettoId, minuti, massimo });
  }
  return oltre;
}

/** Messaggio per l'utente quando un progetto supera le ore massime del giorno. */
export function messaggioMassimo(codice: string, minuti: number, massimo: number): string {
  return `Sul progetto ${codice} il massimo è ${formattaOre(massimo)} ore al giorno per dipendente: così sarebbero ${formattaOre(minuti)}`;
}

const orario = (etichetta: string) =>
  z.string({ error: `${etichetta}: campo obbligatorio` }).refine(isOrarioValido, `${etichetta}: usa il formato HH:MM (24 ore)`);

/** Una fascia oraria come arriva dai moduli (senza dipendente e data, che sono della giornata). */
export const schemaFascia = z
  .object({
    progettoId: z.coerce.number({ error: 'Scegli il progetto' }).int().positive('Scegli il progetto'),
    oraInizio: orario('Ora inizio'),
    oraFine: orario('Ora fine'),
    note: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v) || null, z.string().max(500, 'Note: massimo 500 caratteri').nullable()),
  })
  .superRefine((f, ctx) => {
    if (isOrarioValido(f.oraInizio) && isOrarioValido(f.oraFine) && f.oraFine <= f.oraInizio) {
      ctx.addIssue({ code: 'custom', path: ['oraFine'], message: "L'ora di fine deve essere dopo l'ora di inizio" });
    }
  });

/**
 * Una giornata intera (PUT /api/registrazioni/giornata): sostituisce tutte le fasce di
 * quel dipendente in quel giorno. Le sovrapposizioni fra le righe sono errori della
 * riga, con il percorso "fasce.N.oraInizio" per evidenziarla nel modulo.
 */
export const schemaGiornata = z
  .object({
    dipendenteId: z.coerce.number().int().positive('Dipendente non valido'),
    data: z.string().refine(isDataValida, 'Data non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
    fasce: z.array(schemaFascia).max(24, 'Troppe fasce nello stesso giorno'),
  })
  .superRefine((g, ctx) => {
    for (const [i, j] of coppieSovrapposte(g.fasce)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fasce', j, 'oraInizio'],
        message: `Si sovrappone alla fascia ${g.fasce[i].oraInizio}-${g.fasce[i].oraFine} (riga ${i + 1})`,
      });
    }
  });

