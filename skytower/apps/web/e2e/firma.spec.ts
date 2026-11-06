// "><(((º> sabusabu <º)))><"
// PDF firmati digitalmente in busta .p7m (ADR-55): si carica "X.pdf.p7m" come un file qualunque, il worker apre la
// busta con il motore comune della suite (shared/firma) e verifica la firma; il visualizzatore mostra il PDF
// contenuto con il badge "Firma valida" e, cliccandolo, firmatario, tipo di firma e "Verifica di nuovo".
// La busta la crea firma_fixture.py con un ente certificatore di prova, messo fra i certificati di fiducia del
// motore (FIRMA_ANCORE, vedi playwright.config.ts). Senza shared/firma/.venv il test è saltato.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { FIRMA_ANCORE } from "../playwright.config";
import { apiAs, loginUi, openInTab, projectAndFolder, uploadFile } from "./helpers";

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, "../../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync) ?? "python";
const MOTORE = resolve(ROOT, "../shared/firma/.venv");

test("PDF firmato .p7m: documento contenuto nel visualizzatore e badge della firma", async ({ page, baseURL }) => {
  test.skip(!existsSync(MOTORE), "motore della firma non installato (shared/firma/installa.bat)");
  test.setTimeout(120_000);
  const fx = join(tmpdir(), "cde-e2e-firma-fx");
  execFileSync(PYTHON, [join(QUI, "firma_fixture.py"), fx]);
  mkdirSync(FIRMA_ANCORE, { recursive: true });
  copyFileSync(join(fx, "ente.pem"), join(FIRMA_ANCORE, "ente.pem"));

  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-SP-A-0797.pdf.p7m",
                               mimeType: "application/pkcs7-mime", buffer: readFileSync(join(fx, "firmato.pdf.p7m")) },
                               "Capitolato firmato e2e");
  expect(doc.identifier).toBe("PRJ01-DES-ZZ-ZZ-SP-A-0797");          // ".pdf.p7m" è estensione, non identificativo
  const link = async () => (await des.get(`/api/revisions/${doc.current_revision_id}/download`,
    { params: { disposition: "inline" } })).json();
  await expect.poll(async () => (await link()).firma?.stato, { timeout: 60_000 }).toBe("READY");
  const pronto = await link();
  expect(pronto.content_type).toBe("application/pdf");
  expect(pronto.firma.rapporto.esito).toBe("valida");

  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Capitolato firmato e2e").dblclick());
  const badge = tab.getByRole("button", { name: /Firma valida: dettagli della firma digitale/ });
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByText(/pag\./)).toBeVisible({ timeout: 30_000 });     // il PDF contenuto si è aperto
  await badge.click();
  const dettagli = tab.getByRole("dialog", { name: "Firma digitale" });
  await expect(dettagli.getByText("Mario Rossi", { exact: true })).toBeVisible();
  await expect(dettagli.getByText(/firma digitale · CF RSSMRA80A01H501U/)).toBeVisible();
  await expect(dettagli.getByText(/Ente di Prova S\.p\.A\./).first()).toBeVisible();
  await dettagli.getByRole("button", { name: "Verifica di nuovo" }).click();
  await expect(dettagli.getByRole("button", { name: "Verifica di nuovo" })).toBeEnabled({ timeout: 30_000 });
  await expect(dettagli.getByText(/Verificata il/)).toBeVisible();
});
