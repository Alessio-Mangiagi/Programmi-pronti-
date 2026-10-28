// "><(((º> sabusabu <º)))><"
// IFC pesante (G43, ADR-31): il worker prepara la versione ottimizzata .glb e il viewer apre quella, con l'albero
// dei piani, le proprietà IFC e le misure vere di un elemento ruotato; un clic riapre l'IFC originale (web-ifc).
// In `cde dev` la soglia è 2 MB: il modello da 4 padiglioni (2,4 MB) la supera.
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

test("IFC pesante aperto nella versione ottimizzata del server", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const file = join(tmpdir(), "campus-e2e.ifc");
  execFileSync(PYTHON, ["-m", "cde_api.cli", "genera-ifc", file, "--padiglioni", "4"]);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0799.ifc",
                               mimeType: "application/octet-stream", buffer: readFileSync(file) }, "Campus pesante e2e");
  await expect.poll(async () => (await (await des.get(`/api/revisions/${doc.current_revision_id}/download`,
    { params: { disposition: "inline" } })).json()).derivative?.status, { timeout: 60_000 }).toBe("READY");

  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Campus pesante e2e").dblclick());
  const toggle = tab.getByRole("button", { name: "Versione ottimizzata" });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByText("Edificio · Padiglione E")).toBeVisible({ timeout: 45_000 });
  await tab.getByText("Piano · Piano terra").first().click();
  await tab.getByText("Pensilina ingresso").first().click();
  await expect(tab.getByText(/^IfcSlab$|^IfcRoof$|^IfcCovering$/).first()).toBeVisible();
  const misure = tab.getByRole("region", { name: "Misure" });
  await expect(misure.getByText("8,00 m")).toBeVisible();
  await expect(misure.getByText("4,50 m")).toBeVisible();
  await expect(tab.getByText("livello 00").first()).toBeVisible();

  // l'originale si apre con web-ifc, sullo stesso albero
  await toggle.click();
  await expect(tab.getByRole("button", { name: "IFC originale" })).toBeVisible();
  await expect(tab.getByText("Edificio · Padiglione E")).toBeVisible({ timeout: 60_000 });
});
