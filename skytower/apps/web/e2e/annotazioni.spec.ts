// "><(((º> sabusabu <º)))><"
// Annotazioni sul PDF dal browser: area tracciata sulla pagina, osservazione salvata sulla revisione e visibile
// a un collega che apre lo stesso documento.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("annotazione di un'area della pagina, vista da un collega", async ({ page, browser, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-04-DR-A-0781.pdf", "Pianta copertura e2e",
                  ["Pianta copertura", "Scala 1:100"]);
  await page.reload();
  await page.getByText("Pianta copertura e2e").dblclick();

  const pdfPage = page.locator('[data-page="1"]');
  await expect(pdfPage.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Annota", exact: true }).click();
  const box = (await pdfPage.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35, { steps: 5 });
  await page.mouse.up();
  await page.getByPlaceholder("Scrivi l'osservazione…").fill("Verificare la pendenza della falda");
  await page.getByRole("button", { name: "Aggiungi" }).click();
  await expect(page.getByText("Verificare la pendenza della falda")).toBeVisible();
  const markups = async () => (await des.get(`/api/revisions/${doc.current_revision_id}/markups`)).json();
  await expect.poll(async () => (await markups()).length, { timeout: 10_000 }).toBe(1);
  const [m] = await markups();
  expect(m.page).toBe(1);                                       // ancorata alla pagina, non un commento generico
  expect(m.x).toBeCloseTo(0.2, 1);
  expect(m.w).toBeCloseTo(0.3, 1);

  // un collega della stessa organizzazione la ritrova aprendo il documento
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await loginUi(other, "des.designer@des.example");
  await other.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  await other.getByText("Pianta copertura e2e").dblclick();
  await expect(other.getByText("Verificare la pendenza della falda")).toBeVisible({ timeout: 15_000 });
  await expect(other.getByRole("button", { name: /APERTE 1/i })).toBeVisible();
  await ctx.close();
});
