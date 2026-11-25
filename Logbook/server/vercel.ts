// "><(((º> sabusabu <º)))><"
/**
 * Logbook su Vercel (Giorno 35, 25/11/2026).
 *
 * Su Vercel il server non è un processo sempre acceso ma una funzione: appena la risposta è
 * partita il processo può essere messo in pausa. Il lavoro che Logbook fa "dopo" (la riga nel
 * registro attività, l'email di avviso) verrebbe troncato. `tieniVivo` lo affida a waitUntil
 * di Vercel, che tiene sveglia la funzione finché la promessa non finisce. Fuori da Vercel
 * non fa nulla: il processo resta acceso comunque.
 */
import { waitUntil } from '@vercel/functions';

/** true quando il codice gira come funzione Vercel (variabile VERCEL impostata dalla piattaforma). */
export const suVercel = () => process.env.VERCEL === '1';

/** Lascia finire la promessa anche a risposta già inviata. Non solleva mai errori. */
export function tieniVivo(lavoro: Promise<unknown>): void {
  const protetto = lavoro.catch(() => undefined);
  if (!suVercel()) return;
  try {
    waitUntil(protetto);
  } catch {
    /* fuori da una richiesta: niente da tenere vivo */
  }
}
