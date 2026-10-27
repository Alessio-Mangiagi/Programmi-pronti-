// "><(((º> sabusabu <º)))><"
// Stati del CDE dal browser: il progettista carica in WIP e condivide; la visibilità segue lo stato
// (WIP solo all'organizzazione autrice, SHARED anche all'Information Manager del committente, non al subappaltatore).
import { expect, test } from "@playwright/test";
import { apiAs, findDocs as find, loginUi } from "./helpers";
import { textPdf } from "./pdf";

test("WIP visibile solo all'autore, condivisione dal dettaglio documento", async ({ page, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const com = await apiAs(baseURL, "com.im@com.example");   // Information Manager del committente
  const sub = await apiAs(baseURL, "sub1.user@sub1.example");
  const projectId = (await (await des.get("/api/projects")).json()).find((p: { code: string }) => p.code === "PRJ01").id;
  const folder = (await (await des.get(`/api/projects/${projectId}/containers`)).json())
    .find((c: { name: string }) => c.name === "Tavole architettoniche");

  await loginUi(page, "des.lead@des.example");
  await page.goto(`/progetti/${projectId}/cartelle/${folder.id}`);

  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "PRJ01-DES-ZZ-01-DR-A-0777.pdf", mimeType: "application/pdf", buffer: textPdf(["Pianta piano primo"]) });
  await page.getByLabel("Titolo (nuovo documento)").fill("Pianta piano primo e2e");
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.01 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await find(des, projectId, "primo"))[0]?.current_scan_status, { timeout: 30_000 }).toBe("CLEAN");

  // WIP: né il committente né il subappaltatore lo vedono
  expect(await find(com, projectId, "primo")).toHaveLength(0);
  expect(await find(sub, projectId, "primo")).toHaveLength(0);

  await page.reload();
  await page.getByText("Pianta piano primo e2e").click();
  await page.getByRole("button", { name: "Dettagli e cronologia" }).click();
  await page.getByRole("button", { name: "Condividi P01.01" }).click();
  const dialog = page.getByRole("dialog").last();
  const suitability = dialog.getByLabel("Codice di idoneità");
  if (await suitability.count()) {
    await suitability.click();
    await page.getByRole("option").first().click();
  }
  await dialog.getByLabel(/Motivazione/).fill("Per coordinamento impianti");
  await dialog.getByRole("button", { name: "Condividi" }).click();
  await expect.poll(async () => (await find(des, projectId, "primo"))[0]?.current_state, { timeout: 15_000 }).toBe("SHARED");

  const doc = (await find(des, projectId, "primo"))[0];
  expect(doc.current_revision).toBe("P01");                       // ricodifica in condivisione
  expect(await find(com, projectId, "primo")).toHaveLength(1);       // l'Information Manager coordina
  expect(await find(sub, projectId, "primo")).toHaveLength(0);       // il subappaltatore no
});
