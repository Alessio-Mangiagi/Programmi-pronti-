// "><(((º> sabusabu <º)))><"
// Strumenti del Project Admin: cruscotto, report Excel, registro attività con verifica ed export firmati.
// Gli altri membri non vedono le schede riservate all'admin.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("cruscotto, Excel e registro attività per il Project Admin", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(api, () => true);
  await loginUi(page, "com.admin@com.example");

  await page.goto(`/progetti/${projectId}/cruscotto`);
  await expect(page.getByText("Documenti per azienda e stato")).toBeVisible();
  await expect(page.getByText("In approvazione")).toBeVisible();

  const excel = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta Excel" }).click();
  await page.getByRole("menuitem", { name: /Registro documenti/ }).click();
  expect((await excel).suggestedFilename()).toMatch(/\.xlsx$/);

  await page.goto(`/progetti/${projectId}/registro`);
  await page.getByRole("button", { name: "Verifica integrità" }).click();
  await expect(page.getByText(/Catena integra/)).toBeVisible();
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF firmato" }).click();
  expect((await pdf).suggestedFilename()).toMatch(/^registro-PRJ01-.*\.pdf$/);
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta CSV firmato" }).click();
  expect((await csv).suggestedFilename()).toMatch(/^registro-PRJ01-.*\.csv$/);
});

test("le schede dell'admin non compaiono agli altri membri", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "des.lead@des.example");
  const { projectId } = await projectAndFolder(api, () => true);
  await loginUi(page, "des.lead@des.example");
  await page.goto(`/progetti/${projectId}/cartelle`);
  await expect(page.getByRole("tab", { name: "Cartelle" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Cruscotto" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Registro" })).toHaveCount(0);
  expect((await api.get(`/api/projects/${projectId}/dashboard`)).status()).toBe(403);
});
