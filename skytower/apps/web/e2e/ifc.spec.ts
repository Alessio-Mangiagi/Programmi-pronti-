// "><(((º> sabusabu <º)))><"
// Viewer IFC nel browser (web-ifc + three.js): il modello si carica, l'albero spaziale mostra edificio e piani,
// e il canvas 3D disegna qualcosa (pixel non uniformi). Il giudizio visivo resta al collaudo.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile } from "./helpers";

const IFC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "edificio.ifc"));

test("modello IFC con albero spaziale e vista 3D", async ({ page, baseURL }) => {
  // PROBLEMA APERTO (docs/adr.md ADR-22): web-ifc (Emscripten/embind) genera funzioni con eval e la CSP di
  // produzione, servita anche in questi test, non ammette 'unsafe-eval'. Quando il viewer IFC sarà isolato
  // (o web-ifc ricompilato senza eval) questo test passerà e Playwright lo segnalerà: togliere allora test.fail.
  test.fail(true, "viewer IFC bloccato dalla CSP di produzione (unsafe-eval), vedi ADR-22");
  test.setTimeout(90_000);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  // il worker confronta i magic byte col tipo dichiarato: l'IFC si carica come binario generico
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0792.ifc", mimeType: "application/octet-stream",
                   buffer: IFC }, "Modello architettonico e2e");
  await page.reload();
  await page.getByText("Modello architettonico e2e").dblclick();

  await expect(page.getByText("Padiglione A")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Piano terra")).toBeVisible();
  await expect(page.getByText("Piano · Piano 1")).toBeVisible();
  // il buffer WebGL non si rilegge dopo il disegno: si analizza uno screenshot del canvas
  const shot = (await page.locator("canvas").first().screenshot()).toString("base64");
  const varied = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length && seen.size < 50; i += 4 * 97) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return seen.size;
  }, shot);
  expect(varied).toBeGreaterThan(5);
});
