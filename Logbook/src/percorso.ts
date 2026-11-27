// "><(((º> sabusabu <º)))><"
/**
 * Percorso di Copilota visto dal browser (27/11/2026). Vite scrive in
 * import.meta.env.BASE_URL la base decisa alla compilazione (vite.config.ts la prende da
 * LOGBOOK_PERCORSO): "/" di norma, "/copilota/" quando Copilota si apre per nome.
 *
 * Chiunque scriva un indirizzo assoluto del server ("/api/…", "/logo….png") lo deve passare
 * da `conPercorso`, altrimenti sotto un percorso la richiesta andrebbe alla radice del PC.
 * Le rotte delle pagine non servono: ci pensa il `basename` del router in App.tsx.
 */

/** "" alla radice, "/copilota" sotto un percorso (senza barra finale). */
export const PERCORSO = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** Antepone il percorso a un indirizzo che comincia con "/"; gli altri restano come sono. */
export const conPercorso = (indirizzo: string): string => (indirizzo.startsWith('/') ? `${PERCORSO}${indirizzo}` : indirizzo);
