// "><(((º> sabusabu <º)))><"
// Viewer PDF in piattaforma: ricerca nel testo con evidenziazione e navigazione tra le occorrenze.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, openInTab } from "./helpers";
import { textPdf } from "./pdf";

const ADMIN = "com.admin@com.example";

test("ricerca nel testo del PDF", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, ADMIN);
  const projectId = (await (await api.get("/api/projects")).json()).find((p: { code: string }) => p.code === "PRJ01").id;
  const folderId = (await (await api.get(`/api/projects/${projectId}/containers`)).json())
    .find((c: { name: string }) => c.name.startsWith("COM")).id;

  await loginUi(page, ADMIN);
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);

  const name = "PRJ01-COM-ZZ-00-RP-Z-0900.pdf";
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: textPdf([
    "Verbale di sopralluogo in cantiere", "Presenti: direzione lavori e impresa", "Il cantiere resta aperto il sabato"]) });
  await page.getByLabel("Titolo (nuovo documento)").fill("Verbale di sopralluogo");
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.01 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();

  // il viewer apre solo file verificati dal worker (impronta + antivirus)
  await expect.poll(async () => {
    const { items } = await (await api.get(`/api/projects/${projectId}/documents`, { params: { q: "sopralluogo" } })).json();
    return items[0]?.current_scan_status;
  }, { timeout: 30_000 }).toBe("CLEAN");

  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Verbale di sopralluogo").dblclick());
  const search = tab.getByPlaceholder("Cerca nel testo");
  await search.fill("cantiere");
  await expect(tab.getByText("1/2")).toBeVisible({ timeout: 15_000 });
  await search.press("Enter");
  await expect(tab.getByText("2/2")).toBeVisible();
  await search.fill("inesistente");
  await expect(tab.getByLabel("Occorrenza successiva")).toBeDisabled();
});
