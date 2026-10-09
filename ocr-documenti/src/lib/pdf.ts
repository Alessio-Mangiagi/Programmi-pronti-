// Apertura dei PDF lato browser, in un punto solo.
//
// I PDF qui arrivano da fuori (li carica l'utente) e vengono sia letti che
// renderizzati su canvas. pdf.js, di suo, compila parte del contenuto del file
// con `eval`: su un PDF costruito apposta questo diventa esecuzione di codice
// nella pagina (CVE-2024-4367). `isEvalSupported: false` chiude quella strada;
// il costo è solo qualche font Type4 reso un po' più lentamente.
//
// Prima le opzioni non c'erano e le chiamate a getDocument erano sei, sparse in
// App.tsx: bastava aggiungerne una settima per riaprire il buco. Ora la sola
// via per aprire un PDF è questa funzione.
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Ri-esportato: chi usa apriPdf non deve importare pdfjs-dist per il solo tipo.
export type { PDFDocumentProxy }

// Il worker viaggia con la libreria: `new URL(..., import.meta.url)` lo fa
// impacchettare da Vite, senza CDN (la suite gira in LAN, anche senza internet).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

// I font standard li copia in public/ il plugin `pdfjs-standard-fonts` di
// vite.config.ts: qui basta il percorso servito. Senza, pdf.js li cerca a vuoto
// e riempie la console di avvisi a ogni pagina con font non incorporati.
const FONT_STANDARD = '/standard_fonts/'

/**
 * Apre un PDF con le protezioni attive. Unico ingresso: non chiamare
 * `pdfjsLib.getDocument` altrove.
 */
export function apriPdf(dati: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  // "><(((º> sabusabu <º)))><"
  const data = dati instanceof Uint8Array ? dati : new Uint8Array(dati)
  return pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: FONT_STANDARD,
  }).promise
}
