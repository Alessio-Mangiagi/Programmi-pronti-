// "><(((º> sabusabu <º)))><"
// Test unitari dello scontorno dell'anteprima dei timbri (src/components/timbri/scontorno.ts, ADR-56): deve dare
// lo stesso risultato dell'API (cde_api/timbri.py, test_api_timbri.py) sullo stesso timbro di prova — rettangolo
// rosso su carta quasi bianca — così l'anteprima mostra davvero quello che verrà salvato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coloreSfondo, scontornaPixel } from "../src/components/timbri/scontorno.ts";

function timbroDiProva(sfondo: [number, number, number] = [250, 250, 247]) {
  const w = 200, h = 100;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const rosso = x >= 40 && x < 160 && y >= 20 && y < 80;
      const [r, g, b] = rosso ? [200, 0, 0] : sfondo;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return { px, w, h };
}

const alfa = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];

test("la carta diventa trasparente, il timbro resta pieno e del suo colore", () => {
  const { px, w, h } = timbroDiProva();
  assert.deepEqual(coloreSfondo(px, w, h), [250, 250, 247]);
  assert.equal(scontornaPixel(px, w, h, 0.15), true);
  assert.equal(alfa(px, w, 0, 0), 0);
  assert.equal(alfa(px, w, 5, 5), 0);
  assert.equal(alfa(px, w, 100, 50), 255);
  const i = (50 * w + 100) * 4;
  assert.deepEqual([px[i], px[i + 1], px[i + 2]], [200, 0, 0]);
});

test("immagine già trasparente sul bordo: non si tocca", () => {
  const { px, w, h } = timbroDiProva();
  for (let i = 3; i < px.length; i += 4) px[i] = 0;          // tutto trasparente
  assert.equal(coloreSfondo(px, w, h), null);
  assert.equal(scontornaPixel(px, w, h, 0.15), false);
});

test("sfondo scuro: si toglie lo stesso (lavagna, timbro chiaro)", () => {
  const { px, w, h } = timbroDiProva([10, 10, 12]);
  scontornaPixel(px, w, h, 0.15);
  assert.equal(alfa(px, w, 0, 0), 0);
  // rosso 200 su fondo 10: si discosta del 78%, tolta la tolleranza resta opaco al 74% circa (188/255)
  assert.equal(alfa(px, w, 100, 50), 188);
});

test("la tolleranza oltre il massimo è limitata a 0,6", () => {
  const a = timbroDiProva(), b = timbroDiProva();
  scontornaPixel(a.px, a.w, a.h, 5);
  scontornaPixel(b.px, b.w, b.h, 0.6);
  assert.deepEqual(a.px, b.px);
});
