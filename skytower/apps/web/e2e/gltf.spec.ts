// "><(((º> sabusabu <º)))><"
// Modelli glTF (come li esporta Blender) nel viewer 3D, sotto la CSP di produzione: .glb con texture incorporata e
// .gltf autonomo (buffer in data: URI); albero con i piani dai gruppi, misure di un oggetto scalato e ruotato,
// proprietà personalizzate, sezione. Un .blend non si apre ma spiega come esportarlo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile, openInTab } from "./helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync) ?? "python";

function glb(): Buffer {
  const file = join(tmpdir(), "padiglione-c-e2e.glb");
  execFileSync(PYTHON, ["-m", "cde_api.cli", "genera-glb", file]);
  return readFileSync(file);
}

/** Lo stesso modello come .gltf testuale: il blocco binario diventa un data: URI. */
function asGltf(data: Buffer): Buffer {
  const jsonLen = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLen).toString("utf-8"));
  const binAt = 20 + jsonLen;
  const bin = data.subarray(binAt + 8, binAt + 8 + data.readUInt32LE(binAt));
  json.buffers = [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString("base64")}` }];
  return Buffer.from(JSON.stringify(json));
}

const cspErrors = (page: Page) => {
  const seen: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) seen.push(m.text()); });
  return seen;
};

test("modello .glb da Blender: piani, proprietà, misure e sezione", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0796.glb", mimeType: "model/gltf-binary",
                   buffer: glb() }, "Modello Blender e2e");
  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Modello Blender e2e").dblclick());
  const csp = cspErrors(tab);
  await expect(tab.getByText("Scena · Padiglione C")).toBeVisible({ timeout: 45_000 });
  for (const level of ["Piano terra", "Piano 1", "Copertura"]) await expect(tab.getByText(`Piano · ${level}`)).toBeVisible();

  // pensilina: cubo unitario scalato 8 × 0,25 × 4,5 e ruotato di 15°, le misure sono quelle vere
  await tab.getByText("Pensilina ingresso").click();
  const misure = tab.getByRole("region", { name: "Misure" });
  await expect(misure.getByText("8,00 m")).toBeVisible();
  await expect(misure.getByText("4,50 m")).toBeVisible();
  await expect(misure.getByText("0,25 m")).toBeVisible();
  await expect(misure.getByText("9 m³")).toBeVisible();
  await expect(tab.getByText("PEN-01")).toBeVisible();                 // proprietà personalizzata (extras)
  await expect(tab.getByText("Oggetto glTF")).toBeVisible();

  // un muro dentro il gruppo "Piano terra": piano con codice livello 00
  await tab.getByText("Muro perimetrale sud P0").click();
  await expect(tab.getByRole("region", { name: "Tavole e documenti collegati" }).getByText("livello 00").first()).toBeVisible();

  const sections = tab.getByRole("region", { name: "Sezioni" });
  const whole = await tab.locator("canvas").first().screenshot();
  await sections.getByRole("button", { name: "X", exact: true }).click();
  await tab.waitForTimeout(300);
  expect((await tab.locator("canvas").first().screenshot()).equals(whole)).toBe(false);
  expect(csp).toEqual([]);                                             // texture della porta senza violazioni CSP
});

test("modello .gltf autonomo e file .blend", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0797.gltf", mimeType: "model/gltf+json",
                   buffer: asGltf(glb()) }, "Modello gltf testuale e2e");
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0798.blend", mimeType: "application/octet-stream",
                   buffer: Buffer.concat([Buffer.from("BLENDER-v300"), Buffer.alloc(64)]) }, "Sorgente Blender e2e");
  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Modello gltf testuale e2e").dblclick());
  await expect(tab.getByText("Piano · Piano 1")).toBeVisible({ timeout: 45_000 });
  await tab.close();
  const blend = await openInTab(page, () => page.getByText("Sorgente Blender e2e").dblclick());
  await expect(blend.getByText(/glTF Binary \(\.glb\)/)).toBeVisible({ timeout: 20_000 });
});
