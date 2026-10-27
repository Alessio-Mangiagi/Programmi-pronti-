// "><(((º> sabusabu <º)))><"
// Confronto tra due revisioni PDF nel viewer: le differenze compaiono colorate (rosso = solo nella revisione
// aperta, blu = solo in quella di confronto). Il test conta i pixel colorati sulla pagina composta.
import { expect, test } from "@playwright/test";
import { apiAs, findDocs, loginUi, projectAndFolder, uploadPdf } from "./helpers";
import { textPdf } from "./pdf";

test("le differenze tra due revisioni si vedono in rosso e blu", async ({ page, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const name = "PRJ01-DES-ZZ-06-DR-A-0791.pdf";
  await uploadPdf(page, des, projectId, folderId, name, "Pianta confronto e2e", ["Muro esistente", "Porta P1 larghezza 90"]);

  // seconda revisione con lo stesso identificativo: testo diverso sulla seconda riga
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf",
    buffer: textPdf(["Muro esistente", "Porta P1 larghezza 120 REI"]) });
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.02 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await findDocs(des, projectId, "confronto"))[0]?.current_scan_status, { timeout: 30_000 })
    .toBe("CLEAN");

  await page.reload();
  await page.getByText("Pianta confronto e2e").dblclick();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Confronta con").click();
  await page.getByRole("option", { name: /P01\.01/ }).click();
  await expect(page.getByText(/solo nella revisione aperta/)).toBeVisible();

  const colors = async () => page.locator('[data-page="1"] canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) red++;
      if (d[i + 2] > 180 && d[i] < 90 && d[i + 1] < 90) blue++;
    }
    return { red, blue };
  });
  await expect.poll(async () => (await colors()).red, { timeout: 15_000 }).toBeGreaterThan(50);
  expect((await colors()).blue).toBeGreaterThan(50);
});
