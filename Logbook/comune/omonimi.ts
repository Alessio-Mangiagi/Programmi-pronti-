// "><(((º> sabusabu <º)))><"
/**
 * Nomi dei dipendenti senza ambiguità (richiesta del 24/11/2026: "se ci sono omonimie il
 * sistema distingue partendo dal codice fiscale").
 *
 * Il codice fiscale è unico per persona (vincolo nel database): quando nello stesso elenco
 * due dipendenti hanno lo stesso cognome e nome, al nome si aggiungono i primi caratteri del
 * codice fiscale che bastano a distinguerli (almeno 6, cioè la parte da cognome e nome,
 * poi quanti servono: data di nascita, comune…). Senza omonimi resta solo "Cognome Nome".
 *
 * Sta in comune/ perché lo usano sia l'interfaccia (menu e elenchi) sia il server (nomi
 * già composti nella dashboard, server/rotte/dashboard.ts).
 */
type ConNome = { id: number; nome: string; cognome: string; codiceFiscale: string };

const chiave = (d: { nome: string; cognome: string }) => `${d.cognome} ${d.nome}`.trim().toLowerCase();

/**
 * Mappa id → nome da mostrare per tutto l'elenco, es.
 * "Rossi Mario" oppure "Rossi Mario (CF RSSMRA85C)" / "Rossi Mario (CF RSSMRA90A)".
 */
export function nomiSenzaOmonimie(elenco: ConNome[]): Map<number, string> {
  const gruppi = new Map<string, ConNome[]>();
  for (const d of elenco) gruppi.set(chiave(d), [...(gruppi.get(chiave(d)) ?? []), d]);
  const nomi = new Map<number, string>();
  for (const gruppo of gruppi.values()) {
    if (gruppo.length === 1) {
      nomi.set(gruppo[0].id, `${gruppo[0].cognome} ${gruppo[0].nome}`);
      continue;
    }
    // Lunghezza minima del prefisso di codice fiscale che rende tutti diversi.
    let lunghezza = 6;
    while (lunghezza < 16 && new Set(gruppo.map((d) => d.codiceFiscale.slice(0, lunghezza))).size < gruppo.length) lunghezza++;
    for (const d of gruppo) nomi.set(d.id, `${d.cognome} ${d.nome} (CF ${d.codiceFiscale.slice(0, lunghezza)})`);
  }
  return nomi;
}

/** Dettaglio standard sotto il nome nei campi di scelta: matricola e codice fiscale completo. */
export const dettaglioDipendente = (d: { matricola: string; codiceFiscale: string; mansione?: string | null }) =>
  `matr. ${d.matricola} · CF ${d.codiceFiscale}${d.mansione ? ` · ${d.mansione}` : ''}`;
