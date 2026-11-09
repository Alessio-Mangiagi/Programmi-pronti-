// "><(((º> sabusabu <º)))><"
// Scontorno dello sfondo di un timbro scansionato, per l'ANTEPRIMA nella finestra "Nuovo timbro" (ADR-56).
// Stesso algoritmo di Timbri per VFP (timbri-vfp/script.js) e dell'API (cde_api/timbri.py, che fa fede: il PNG
// salvato lo prepara il server con la stessa tolleranza): colore di sfondo = mediana dei pixel opachi del bordo,
// poi "color to alpha" — l'opacità di ogni pixel è quanto si discosta dallo sfondo e il colore si ricostruisce
// senza lo sfondo, così i bordi restano morbidi e spariscono anche i "buchi" interni delle lettere.
// Le due funzioni pure lavorano sui byte RGBA di un ImageData e si provano con `npm run test:unit`.

/** Tolleranza massima, come il cursore di Timbri per VFP e il limite dell'API (0..0,6). */
export const TOLLERANZA_MASSIMA = 0.6;

function mediana(valori: number[]): number {
  const ordinati = valori.slice().sort((a, b) => a - b);
  return ordinati[Math.floor(ordinati.length / 2)];
}

/** Colore di sfondo [r, g, b] dai pixel opachi del bordo; null se il bordo è già in gran parte trasparente. */
export function coloreSfondo(px: Uint8ClampedArray, larghezza: number, altezza: number): [number, number, number] | null {
  const canali: number[][] = [[], [], []];
  let bordo = 0;
  const campiona = (x: number, y: number) => {
    const i = (y * larghezza + x) * 4;
    bordo++;
    if (px[i + 3] < 250) return;
    for (let c = 0; c < 3; c++) canali[c].push(px[i + c]);
  };
  for (let x = 0; x < larghezza; x++) {
    campiona(x, 0);
    if (altezza > 1) campiona(x, altezza - 1);
  }
  for (let y = 1; y < altezza - 1; y++) {
    campiona(0, y);
    if (larghezza > 1) campiona(larghezza - 1, y);
  }
  if (canali[0].length < bordo / 2) return null;
  return [mediana(canali[0]), mediana(canali[1]), mediana(canali[2])];
}

/** Rende trasparente lo sfondo, sul posto. ``tolleranza`` 0..0,6: più alta toglie ombre e grana della carta. */
export function scontornaPixel(px: Uint8ClampedArray, larghezza: number, altezza: number, tolleranza: number): boolean {
  const sfondo = coloreSfondo(px, larghezza, altezza);
  if (!sfondo) return false;
  const t = Math.min(Math.max(tolleranza, 0), TOLLERANZA_MASSIMA);
  const chiaro = sfondo[0] * 0.299 + sfondo[1] * 0.587 + sfondo[2] * 0.114 >= 128;
  for (let i = 0; i < px.length; i += 4) {
    let alfa = 0;
    for (let c = 0; c < 3; c++) {
      const diff = chiaro ? sfondo[c] - px[i + c] : px[i + c] - sfondo[c];
      const rango = chiaro ? sfondo[c] : 255 - sfondo[c];
      if (diff > 0 && rango > 0) alfa = Math.max(alfa, diff / rango);
    }
    if (alfa <= t) {
      px[i + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      px[i + c] = Math.min(255, Math.max(0, Math.round(sfondo[c] + (px[i + c] - sfondo[c]) / alfa)));
    }
    px[i + 3] = Math.round(px[i + 3] * (alfa - t) / (1 - t));
  }
  return true;
}

/** Anteprima nel browser: URL (blob) del PNG scontornato del file scelto. Da liberare con URL.revokeObjectURL. */
export async function anteprimaScontornata(file: Blob, tolleranza: number): Promise<string> {
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const dati = ctx.getImageData(0, 0, canvas.width, canvas.height);
  scontornaPixel(dati.data, canvas.width, canvas.height, tolleranza);
  ctx.putImageData(dati, 0, 0);
  const blob = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("anteprima non riuscita"))), "image/png"));
  return URL.createObjectURL(blob);
}
