// "><(((º> sabusabu <º)))><"
// Anteprima di Word, Excel e CSV in piattaforma: contenuto leggibile, documento Word isolato in un iframe sandbox.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, openInTab } from "./helpers";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("Word, Excel e CSV si leggono nel viewer", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");

  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-SP-Z-0950.docx", mimeType: DOCX,
                   buffer: readFileSync(join(FIXTURES, "capitolato.docx")) }, "Capitolato speciale");
  await page.reload();
  const wordTab = await openInTab(page, () => page.getByText("Capitolato speciale").dblclick());
  const frame = wordTab.frameLocator('iframe[title="Anteprima del documento Word"]');
  await expect(frame.getByRole("heading", { name: "Capitolato speciale d'appalto" })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText("NTC 2018")).toBeVisible();
  await expect(wordTab.locator('iframe[title="Anteprima del documento Word"]')).toHaveAttribute("sandbox", /^(?!.*allow-scripts)/);
  // link javascript: nel documento: nessun effetto sulla pagina
  const title = await wordTab.title();
  await frame.getByText("collegamento di prova").click().catch(() => undefined);
  expect(await wordTab.title()).toBe(title);
  await wordTab.getByRole("button", { name: "Chiudi" }).last().click();

  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-SH-Z-0951.xlsx", mimeType: XLSX,
                   buffer: readFileSync(join(FIXTURES, "computo.xlsx")) }, "Computo metrico");
  await page.reload();
  const excelTab = await openInTab(page, () => page.getByText("Computo metrico").dblclick());
  await expect(excelTab.getByRole("cell", { name: "Calcestruzzo C25/30" })).toBeVisible({ timeout: 15_000 });
  await expect(excelTab.getByRole("cell", { name: "1250,5" })).toBeVisible();
  await excelTab.getByRole("tab", { name: "Riepilogo" }).click();
  await expect(excelTab.getByRole("cell", { name: "Totale lavori" })).toBeVisible();
  await excelTab.getByRole("button", { name: "Chiudi" }).last().click();

  const csv = 'Codice;Descrizione;Quantità\nA.01;"Scavo; a sezione obbligata";12\nA.02;"Tubo ""DN100""";30\n';
  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-SH-Z-0952.csv", mimeType: "text/csv",
                   buffer: Buffer.from(csv, "utf-8") }, "Elenco scavi");
  await page.reload();
  const csvTab = await openInTab(page, () => page.getByText("Elenco scavi").dblclick());
  await expect(csvTab.getByRole("cell", { name: "Scavo; a sezione obbligata" })).toBeVisible({ timeout: 15_000 });
  await expect(csvTab.getByRole("cell", { name: 'Tubo "DN100"' })).toBeVisible();
});
