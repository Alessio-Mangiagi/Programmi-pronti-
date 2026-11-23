// "><(((º> sabusabu <º)))><"
/**
 * Colori del calendario: uno per progetto (quello scelto da HR o uno della tavolozza)
 * e uno per tipo di assenza e per le festività, sempre gli stessi in tutta l'app.
 */

/** Tavolozza per i progetti senza colore: scelta in base all'id, quindi stabile. */
const TAVOLOZZA = ['#0c4577', '#65bc7b', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f', '#b45309'];

export function coloreProgetto(p: { id?: number; progettoId?: number; colore: string | null }): string {
  if (p.colore) return p.colore;
  const id = p.id ?? p.progettoId ?? 0;
  return TAVOLOZZA[id % TAVOLOZZA.length];
}

/** Colori delle assenze (sfondo chiaro + testo scuro) e delle festività. */
export const COLORI_ASSENZA = {
  FERIE: { sfondo: '#dbeafe', testo: '#1e3a8a', bordo: '#93c5fd', etichetta: 'Ferie' },
  PERMESSO: { sfondo: '#fef3c7', testo: '#78350f', bordo: '#fcd34d', etichetta: 'Permesso' },
  MALATTIA: { sfondo: '#fee2e2', testo: '#7f1d1d', bordo: '#fca5a5', etichetta: 'Malattia' },
} as const;

export const COLORE_FESTIVITA = { sfondo: '#f3e8ff', testo: '#581c87', bordo: '#d8b4fe' } as const;
