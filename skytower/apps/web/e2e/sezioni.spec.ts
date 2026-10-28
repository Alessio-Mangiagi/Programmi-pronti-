// "><(((º> sabusabu <º)))><"
// Modello IFC complesso (cde genera-ifc: sei livelli, aperture, scale, pensilina ruotata) nel viewer: albero dei
// livelli, sezione verticale lungo X e Y con lato invertibile, sezione orizzontale, misure di un elemento ruotato.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadFile } from "./helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PYTHON = process.env.PYTHON
  ?? [resolve(ROOT, ".venv/Scripts/python.exe"), resolve(ROOT, ".venv/bin/python")].find(existsSync) ?? "python";

const canvasShot = (page: Page) => page.locator("canvas").first().screenshot();

test("modello complesso: sezioni verticale e orizzontale, misure di un elemento ruotato", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const file = join(tmpdir(), "ospedale-complesso-e2e.ifc");
  execFileSync(PYTHON, ["-m", "cde_api.cli", "genera-ifc", file]);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-M3-A-0795.ifc", mimeType: "application/octet-stream",
                   buffer: readFileSync(file) }, "Modello complesso e2e");
  await page.reload();
  await page.getByText("Modello complesso e2e").dblclick();
  await expect(page.getByText("Edificio · Padiglione B")).toBeVisible({ timeout: 90_000 });
  for (const level of ["Piano interrato", "Piano terra", "Piano 3", "Copertura"])
    await expect(page.getByText(`Piano · ${level}`)).toBeVisible();

  const sections = page.getByRole("region", { name: "Sezioni" });
  const whole = await canvasShot(page);
  await sections.getByRole("button", { name: "X", exact: true }).click();
  const slider = sections.getByRole("slider", { name: "Sezione verticale" });
  await expect(slider).toBeVisible();
  await page.waitForTimeout(300);
  const halfX = await canvasShot(page);
  expect(halfX.equals(whole)).toBe(false);                       // metà modello tagliata
  await sections.getByRole("button", { name: "Inverti lato della sezione" }).click();
  await page.waitForTimeout(300);
  expect((await canvasShot(page)).equals(halfX)).toBe(false);    // ora si vede l'altra metà
  await slider.focus();
  await page.keyboard.press("PageDown");
  await sections.getByRole("button", { name: "Y", exact: true }).click();
  await expect(slider).toBeVisible();
  await sections.getByRole("button", { name: "No", exact: true }).click();
  await expect(slider).toBeHidden();
  const horizontal = sections.getByRole("slider", { name: "Sezione orizzontale" });
  await horizontal.focus();
  for (let k = 0; k < 8; k++) await page.keyboard.press("PageDown");
  await page.waitForTimeout(300);
  expect((await canvasShot(page)).equals(whole)).toBe(false);

  // pensilina ruotata di 15°: le misure sono quelle vere (8 × 4,5 × 0,25), non l'ingombro ruotato
  await page.getByText("Piano · Piano terra").click();
  await page.getByText("Pensilina ingresso").first().click();
  const misure = page.getByRole("region", { name: "Misure" });
  await expect(misure.getByText("8,00 m")).toBeVisible();
  await expect(misure.getByText("4,50 m")).toBeVisible();
  await expect(misure.getByText("0,25 m")).toBeVisible();
});
