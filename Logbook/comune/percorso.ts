// "><(((º> sabusabu <º)))><"
/**
 * Percorso sotto cui vive Copilota (27/11/2026): con LOGBOOK_PERCORSO=/copilota l'indirizzo
 * diventa http://<nome del PC>/copilota invece di http://<nome del PC>:5210.
 *
 * Lo leggono in tre: vite.config.ts (indirizzi di script, fogli di stile e immagini nella
 * pagina compilata), server/app.ts (toglie il prefisso prima delle rotte) e, nel browser,
 * src/percorso.ts tramite import.meta.env.BASE_URL. Qui sta solo la regola che lo ripulisce,
 * così i tre non possono trovarsi in disaccordo.
 *
 * Vuoto (il default, e sempre su Vercel) = Copilota alla radice, come prima.
 */

/**
 * Normalizza il valore scritto nel .env: "copilota", "/copilota/" e " /copilota " diventano
 * "/copilota"; vuoto, "/" o assente diventano "". Solo lettere, numeri, trattino e
 * sottolineato, un livello solo: è un pezzo di indirizzo che finisce in un'espressione
 * regolare e in un reindirizzamento, quindi niente caratteri che possano cambiarne il senso.
 */
export function normalizzaPercorso(valore: string | undefined | null): string {
  const pulito = (valore ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!pulito) return '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(pulito)) {
    throw new Error(`LOGBOOK_PERCORSO non valido ("${valore}"): una parola sola, con lettere, numeri, trattino o sottolineato, per esempio /copilota`);
  }
  return `/${pulito.toLowerCase()}`;
}
