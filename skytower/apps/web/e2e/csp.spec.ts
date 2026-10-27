// "><(((º> sabusabu <º)))><"
// La SPA funziona con la Content-Security-Policy di produzione, che vite preview serve in tutti i test e2e
// (playwright.config: SPA_CSP): aprendo PDF, Word ed Excel il browser non deve bloccare niente.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, uploadPdf } from "./helpers";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("PDF, Word ed Excel con la CSP di produzione", async ({ page, baseURL }) => {
  const blocked: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text()); });
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
  await page.getByText("Verbale CSP e2e").dblclick();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("Cerca nel testo").fill("Verbale");
  await expect(page.getByText("1/1")).toBeVisible();
  await page.getByRole("button", { name: "Chiudi" }).last().click();

  await page.getByText("Capitolato CSP e2e").dblclick();
  await expect(page.frameLocator('iframe[title="Anteprima del documento Word"]').getByText("NTC 2018")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Chiudi" }).last().click();

  await page.getByText("Computo CSP e2e").dblclick();
  await expect(page.getByRole("cell", { name: "Calcestruzzo C25/30" })).toBeVisible({ timeout: 15_000 });

  expect(blocked).toEqual([]);
});
