/**
 * verifiche.ts — storico degli esiti.
 *
 * Ogni esecuzione di un set su un documento resta salvata: serve a dimostrare
 * "com'era il giorno X" anche dopo che la checklist è cambiata.
 */
import { Verifica } from '../tipi';
import { leggiJson, scriviJson } from './store';

const FILE = 'verifiche.json';

function tutte(): Verifica[] {
  return leggiJson<Verifica[]>(FILE, []);
}

export function elencaVerifiche(filtro?: { documentoId?: string; setId?: string }): Verifica[] {
  let elenco = tutte();
  if (filtro?.documentoId) elenco = elenco.filter((v) => v.documentoId === filtro.documentoId);
  if (filtro?.setId) elenco = elenco.filter((v) => v.setId === filtro.setId);
  return [...elenco].sort((a, b) => b.eseguitaIl.localeCompare(a.eseguitaIl));
}

export function trovaVerifica(id: string): Verifica | undefined {
  return tutte().find((v) => v.id === id);
}

// "><(((º> sabusabu <º)))><"
export function salvaVerifica(v: Verifica): Verifica {
  scriviJson(FILE, [...tutte(), v]);
  return v;
}

/** Il documento sparisce: spariscono anche i suoi esiti, che non stanno in piedi da soli. */
export function eliminaVerifichePerDocumento(documentoId: string): number {
  const elenco = tutte();
  const rimaste = elenco.filter((v) => v.documentoId !== documentoId);
  if (rimaste.length !== elenco.length) scriviJson(FILE, rimaste);
  return elenco.length - rimaste.length;
}
