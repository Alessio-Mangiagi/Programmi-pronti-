// "><(((º> sabusabu <º)))><"
// Viewer DWG senza licenza (G44, ADR-41): un DXF caricato viene convertito dal worker in SVG e si apre nel browser
// con l'elenco dei layer (spunte), zoom e misura; spegnendo un layer il suo gruppo sparisce. Il DXF lo genera
// `cde genera-dxf` (pianta con layer ARCH/STRUT/QUOTE/TESTI/ARREDI e uno spento).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, openInTab } from "./helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync) ?? "python";

test("DXF aperto nel viewer con layer e misura", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const file = join(tmpdir(), "pianta-e2e.dxf");
  execFileSync(PYTHON, ["-m", "cde_api.cli", "genera-dxf", file]);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-DR-A-0798.dxf",
                               mimeType: "application/octet-stream", buffer: readFileSync(file) }, "Pianta CAD e2e");
  await expect.poll(async () => (await (await des.get(`/api/revisions/${doc.current_revision_id}/download`,
    { params: { disposition: "inline" } })).json()).derivative?.status, { timeout: 60_000 }).toBe("READY");
  const { derivative } = await (await des.get(`/api/revisions/${doc.current_revision_id}/download`,
    { params: { disposition: "inline" } })).json();
  expect(derivative.layers.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(["ARCH", "STRUT", "QUOTE", "NASCOSTO"]));

  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Pianta CAD e2e").dblclick());
  await expect(tab.getByText(/Vista del disegno/)).toBeVisible({ timeout: 30_000 });
  const disegno = tab.getByRole("img", { name: "Disegno CAD" });
  await expect(disegno.locator("svg g[data-layer='ARCH']")).toBeVisible({ timeout: 30_000 });
  await expect(disegno.locator("svg text", { hasText: "Ufficio 1" }).first()).toBeVisible();
  // il layer spento nel CAD non è spuntato e non si vede; spegnere ARCH nasconde i muri
  const layer = tab.getByRole("region", { name: "Layer" });
  await expect(layer.getByRole("checkbox", { name: /NASCOSTO/ })).not.toBeChecked();
  await expect(disegno.locator("svg g[data-layer='NASCOSTO']")).toBeHidden();
  await layer.getByRole("checkbox", { name: /^ARCH/ }).uncheck();
  await expect(disegno.locator("svg g[data-layer='ARCH']")).toBeHidden();
  await layer.getByRole("checkbox", { name: /^ARCH/ }).check();
  await expect(disegno.locator("svg g[data-layer='ARCH']")).toBeVisible();
  // misura: due clic sul disegno danno una distanza in metri (unità del DXF: mm)
  await tab.getByRole("button", { name: "Misura" }).click();
  const box = (await disegno.boundingBox())!;
  await disegno.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
  await disegno.click({ position: { x: box.width * 0.7, y: box.height * 0.5 } });
  await expect(tab.getByText(/Distanza: .* m$/)).toBeVisible();
  await tab.getByRole("button", { name: "Ingrandisci" }).click();
  await expect(tab.getByText("125%")).toBeVisible();
});
