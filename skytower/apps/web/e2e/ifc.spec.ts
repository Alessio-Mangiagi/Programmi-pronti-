// "><(((º> sabusabu <º)))><"
// Viewer IFC nel browser (web-ifc + three.js), sotto la CSP di produzione (niente 'unsafe-eval', ADR-22): il
// modello si carica, l'albero spaziale mostra edificio e piani, il canvas 3D disegna qualcosa (pixel non uniformi).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, uploadPdf } from "./helpers";

const IFC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "edificio.ifc"));

test("modello IFC con albero spaziale e vista 3D", async ({ page, baseURL }) => {
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

  // clic sul modello: l'elemento selezionato mostra tipo IFC e GUID nel pannello proprietà
  const box = (await page.locator("canvas").first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/^Ifc[A-Z][A-Za-z]+$/).first()).toBeVisible({ timeout: 10_000 });
});

test("elemento del modello: misure e tavole che lo citano", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  // tavola che nella legenda cita un muro del modello (stesso nome dell'IFC)
  await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-00-DR-A-0793.pdf", "Pianta BIM e2e",
                  ["Pianta piano terra", "Elementi BIM rappresentati", "Muro perimetrale sud P0"]);
  await expect.poll(async () => (await (await des.get(`/api/projects/${projectId}/documents`,
    { params: { q: "perimetrale", content: true } })).json()).items.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0794.ifc", mimeType: "application/octet-stream",
                   buffer: IFC }, "Modello collegato e2e");
  await page.reload();
  await page.getByText("Modello collegato e2e").dblclick();
  await page.getByText("Piano · Piano terra").click({ timeout: 45_000 });          // apre il piano nell'albero
  await page.getByText("Muro perimetrale sud P0").first().click();

  const misure = page.getByRole("region", { name: "Misure" });
  await expect(misure.getByText("Lunghezza")).toBeVisible();
  await expect(misure.getByText("Spessore")).toBeVisible();
  await expect(misure.getByText("Volume")).toBeVisible();
  const links = page.getByRole("region", { name: "Tavole e documenti collegati" });
  await expect(links.getByText("livello 00").first()).toBeVisible();
  await links.getByText("Pianta BIM e2e").first().click();
  // la tavola si apre sopra il modello con il nome dell'elemento già cercato
  await expect(page.getByPlaceholder("Cerca nel testo")).toHaveValue("Muro perimetrale sud P0");
  await expect(page.getByText("1/1")).toBeVisible({ timeout: 20_000 });
});
