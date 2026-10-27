// "><(((º> sabusabu <º)))><"
// Aree riservate dal browser: l'admin crea l'area, il progettista la vede ma non la apre finché non chiede
// accesso e l'admin approva.
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

function card(page: Page, name: string, button: string) {
  return page.getByRole("main").locator("div").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: button }) }).last();
}

test("accesso a un'area riservata solo dopo approvazione", async ({ page, browser, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId } = await projectAndFolder(des, () => true);
  const name = `Offerte riservate e2e ${Date.now() % 100000}`;

  await loginUi(page, "com.admin@com.example");
  await page.goto(`/progetti/${projectId}/riservate`);
  await page.getByRole("button", { name: "Nuova area riservata" }).click();
  const create = page.getByRole("dialog", { name: "Nuova area riservata" });
  await create.getByLabel("Nome").fill(name);
  await create.getByRole("button", { name: "Crea" }).click();
  await expect(create).toBeHidden();
  await expect(page.getByRole("main").getByText(name)).toBeVisible();

  const area = (await (await des.get(`/api/projects/${projectId}/private-areas`)).json())
    .find((a: { name: string }) => a.name === name);
  expect(area, "l'area è elencata (non il contenuto) anche a chi non ha accesso").toBeTruthy();
  expect((await des.get(`/api/containers/${area.id}`)).status()).toBe(404);

  const desContext = await browser.newContext();
  const d = await desContext.newPage();
  await loginUi(d, "des.lead@des.example");
  await d.goto(`/progetti/${projectId}/riservate`);
  await card(d, name, "Richiedi accesso").getByRole("button", { name: "Richiedi accesso" }).click();
  const ask = d.getByRole("dialog", { name: new RegExp(`Richiedi accesso a`) });
  await ask.getByLabel("Motivazione").fill("Verifica delle offerte per il computo");
  await ask.getByRole("button", { name: "Invia richiesta" }).click();
  await expect(d.getByText("Richiesta inviata", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Decidi" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approva" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await d.reload();
  await expect(d.getByRole("main").getByRole("link", { name: "Apri" })).toBeVisible();
  await expect(d.getByRole("button", { name: "Richiedi accesso" })).toBeHidden();
  expect((await des.get(`/api/containers/${area.id}`)).status()).toBe(200);
  await desContext.close();
});
