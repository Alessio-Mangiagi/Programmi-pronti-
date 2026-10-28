// "><(((º> sabusabu <º)))><"
// La SPA funziona con la Content-Security-Policy di produzione, che vite preview serve in tutti i test e2e
// (playwright.config: SPA_CSP): aprendo PDF, Word ed Excel il browser non deve bloccare niente.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, uploadPdf, openInTab } from "./helpers";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("PDF, Word ed Excel con la CSP di produzione", async ({ page, baseURL }) => {
  const blocked: string[] = [];
  const watch = (p: Page) => p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text()); });
  watch(page);
  page.context().on("page", watch);                       // anche le schede dei documenti
  const csp = (await page.request.get("/")).headers()["content-security-policy"];
  expect(csp, "vite preview deve servire la CSP di produzione").toContain("script-src 'self' 'wasm-unsafe-eval'");

  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0980.pdf", "Verbale CSP e2e", ["Verbale con CSP"]);
  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-SP-Z-0981.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: readFileSync(join(FIXTURES, "capitolato.docx")) }, "Capitolato CSP e2e");
  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-SH-Z-0982.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(FIXTURES, "computo.xlsx")) }, "Computo CSP e2e");

  await page.reload();
  const pdfTab = await openInTab(page, () => page.getByText("Verbale CSP e2e").dblclick());
  await expect(pdfTab.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
  await pdfTab.getByPlaceholder("Cerca nel testo").fill("Verbale");
  await expect(pdfTab.getByText("1/1")).toBeVisible();
  await pdfTab.getByRole("button", { name: "Chiudi" }).last().click();

  const wordTab = await openInTab(page, () => page.getByText("Capitolato CSP e2e").dblclick());
  await expect(wordTab.frameLocator('iframe[title="Anteprima del documento Word"]').getByText("NTC 2018")).toBeVisible({ timeout: 15_000 });
  await wordTab.getByRole("button", { name: "Chiudi" }).last().click();

  const excelTab = await openInTab(page, () => page.getByText("Computo CSP e2e").dblclick());
  await expect(excelTab.getByRole("cell", { name: "Calcestruzzo C25/30" })).toBeVisible({ timeout: 15_000 });

  expect(blocked).toEqual([]);
});
