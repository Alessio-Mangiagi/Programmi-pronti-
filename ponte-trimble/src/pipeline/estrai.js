// Passo 1 — estrazione: PDF -> righe di testo con le loro coordinate.
// Qui non si interpreta niente: e' il traduttore (passo 2) a dare un significato
// alle righe. Tenere separate le due cose serve perche' i PDF cambiano forma piu'
// spesso di quanto cambi il formato che Trimble si aspetta.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let pdfjs = null;
async function caricaPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** Sotto questa soglia di caratteri per pagina il PDF e' quasi certamente una scansione. */
const SOGLIA_SCANSIONE = 40;

/**
 * @param {Buffer} contenuto  il PDF
 * @returns {Promise<{meta:object, pagine:Array, avvisi:string[]}>}
 */
export async function estrai(contenuto, { tolleranzaRiga = 2.5 } = {}) {
  const { getDocument } = await caricaPdfjs();
  const doc = await getDocument({
    data: new Uint8Array(contenuto),
    useSystemFonts: true,
    isEvalSupported: false,
    standardFontDataUrl: require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, 'standard_fonts/'),
  }).promise;

  const avvisi = [];
  const pagine = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    // "><(((º> sabusabu <º)))><"
    const contenutoTesto = await pagina.getTextContent();

    const elementi = contenutoTesto.items
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({
        testo: it.str,
        x: Math.round(it.transform[4] * 100) / 100,
        y: Math.round(it.transform[5] * 100) / 100,
        larghezza: Math.round((it.width || 0) * 100) / 100,
        altezza: Math.round((it.height || 0) * 100) / 100,
      }));

    pagine.push({
      numero: n,
      larghezza: viewport.width,
      altezza: viewport.height,
      righe: raggruppaInRighe(elementi, tolleranzaRiga),
    });

    const caratteri = elementi.reduce((s, e) => s + e.testo.trim().length, 0);
    if (caratteri < SOGLIA_SCANSIONE) {
      avvisi.push(`pagina ${n}: nessun livello di testo (${caratteri} caratteri) — probabile scansione, serve OCR`);
    }
    pagina.cleanup();
  }

  await doc.destroy();
  return {
    meta: { pagine: doc.numPages, estrattoIl: new Date().toISOString() },
    pagine,
    avvisi,
  };
}

/** Elementi con la stessa y (entro tolleranza) = una riga; dentro la riga si ordina per x. */
export function raggruppaInRighe(elementi, tolleranza = 2.5) {
  const righe = [];
  for (const el of [...elementi].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const riga = righe.find((r) => Math.abs(r.y - el.y) <= tolleranza);
    if (riga) riga.elementi.push(el);
    else righe.push({ y: el.y, elementi: [el] });
  }
  return righe.map((r, i) => {
    const ordinati = r.elementi.sort((a, b) => a.x - b.x);
    return {
      indice: i,
      y: r.y,
      testo: ordinati.map((e) => e.testo).join(' ').replace(/\s+/g, ' ').trim(),
      elementi: ordinati,
    };
  });
}

/** Tutte le righe del documento in sequenza, con il numero di pagina appiccicato. */
export function righeDocumento(estratto) {
  return estratto.pagine.flatMap((p) => p.righe.map((r) => ({ ...r, pagina: p.numero })));
}
