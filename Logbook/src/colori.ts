// "><(((º> sabusabu <º)))><"
/**
 * Colori del calendario: uno per progetto (quello scelto da HR o uno della tavolozza)
 * e uno per tipo di assenza e per le festività, sempre gli stessi in tutta l'app.
 *
 * Solo toni compatibili col marchio Cosedil (skill Cosedilfrontend): niente viola o
 * colori accesi; il verde resta un accento (festività), il blu è il colore principale.
 */

/** Tavolozza per i progetti senza colore: scelta in base all'id, quindi stabile. */
const TAVOLOZZA = ['#0c4577', '#3f8f55', '#b45309', '#198fd9', '#65bc7b', '#8a6d3b', '#434549', '#1477b8'];

export function coloreProgetto(p: { id: number; colore: string | null }): string {
  return p.colore || TAVOLOZZA[p.id % TAVOLOZZA.length];
}

/** Colore di una fascia oraria = colore del suo progetto (attenzione: non l'id della fascia). */
export function coloreFascia(f: { progettoId: number; progetto: { colore: string | null } }): string {
  return coloreProgetto({ id: f.progettoId, colore: f.progetto.colore });
}

/** Colori delle assenze (sfondo chiaro + testo scuro, contrasto AA) e delle festività. */
export const COLORI_ASSENZA = {
  FERIE: { sfondo: '#dcebf8', testo: '#0c4577', bordo: '#9cc3e6', etichetta: 'Ferie' },
  PERMESSO: { sfondo: '#fdf1d6', testo: '#6b4a00', bordo: '#e9c46a', etichetta: 'Permesso' },
  MALATTIA: { sfondo: '#fbe4e1', testo: '#8e2a1f', bordo: '#eba79f', etichetta: 'Malattia' },
} as const;

export const COLORE_FESTIVITA = { sfondo: '#e7f4ea', testo: '#2f6b40', bordo: '#a9d7b5' } as const;
