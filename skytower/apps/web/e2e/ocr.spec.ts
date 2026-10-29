// "><(((º> sabusabu <º)))><"
// OCR dei PDF scansionati (ADR-33): una parola che sta solo nell'immagine della pagina si trova con "anche nel
// testo dei file". Si salta dove Tesseract non è installato (l'API lo salta allo stesso modo).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile } from "./helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync) ?? "python";
const TESSERACT = spawnSync("tesseract", ["--version"]).status === 0
  || existsSync("C:/Program Files/Tesseract-OCR/tesseract.exe");

test("parola letta con l'OCR in un PDF scansionato", async ({ page, baseURL }) => {
  test.skip(!TESSERACT, "Tesseract non installato");
  const pdf = execFileSync(PYTHON, ["-c", [
    "import sys",
    "from cde_api.tooling.demo_content import scanned_pdf",
    "sys.stdout.buffer.write(scanned_pdf(77, 'Verbale di consegna', ['Consegnati i campioni di travertino romano.', 'Firma della Direzione Lavori.']))",
  ].join("\n")]);
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  await uploadFile(page, api, projectId, folderId, { name: "PRJ01-COM-ZZ-00-RP-Z-0995.pdf", mimeType: "application/pdf",
                   buffer: pdf }, "Verbale scansionato e2e");
  await page.goto(`/progetti/${projectId}/documenti`);
  await page.getByRole("main").getByPlaceholder("Cerca").fill("travertino");
  await page.getByLabel("anche nel testo dei file").check();
  await expect(page.getByRole("cell", { name: /Verbale scansionato e2e/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("mark", { hasText: /travertino/i })).toBeVisible();
});
