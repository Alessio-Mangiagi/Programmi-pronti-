// "><(((º> sabusabu <º)))><"
/**
 * Abbinamento dei file dello stesso contratto dal nome ("…NOLO A FREDDO OTTOMARZO.pdf" e
 * "…NOLO A FREDDO OTTOMARZO elenco prezzi.xlsx"), che è come sono nominati in pratica.
 * Lo usano la coda del browser (allegati Excel e bozza Word di un PDF) e la scansione della
 * cartella sul server (server/cartella.ts). Separato da file-input.ts, che usa pdf.js e il
 * DOM, perché il server non li ha.
 */

/** Parole significative del nome di un file: minuscole, almeno 4 caratteri, senza estensione. */
export const paroleNome = (n: string) => new Set(n.replace(/\.[^.]+$/, '').toLowerCase()
  .split(/[^a-zà-ü0-9]+/).filter(w => w.length >= 4))

/** Nome file sicuro per il filesystem: i nomi dei contratti hanno /, :, ° … */
export const nomeFileSicuro = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)

/** Due file sono dello stesso contratto se hanno almeno due parole significative in comune. */
export const nomiSimili = (a: string, b: string) => {
  const pa = paroleNome(a)
  return [...paroleNome(b)].filter(w => pa.has(w)).length >= 2
}
