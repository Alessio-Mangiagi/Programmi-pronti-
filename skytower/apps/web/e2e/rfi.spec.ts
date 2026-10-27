// "><(((º> sabusabu <º)))><"
// RFI dal browser: il subappaltatore chiede al progettista, il progettista risponde ufficialmente,
// il richiedente chiude. Due sessioni separate, come due persone.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("domanda, risposta ufficiale e chiusura di una RFI", async ({ page, browser, baseURL }) => {
  const sub = await apiAs(baseURL, "sub1.user@sub1.example");
  const { projectId } = await projectAndFolder(sub, () => true);
  const subject = `Quota passaggio cavi e2e ${Date.now() % 100000}`;

  await loginUi(page, "sub1.user@sub1.example");
  await page.goto(`/progetti/${projectId}/rfi`);
  await page.getByRole("button", { name: "Nuova RFI" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuova RFI" });
  await dialog.getByLabel("Oggetto").fill(subject);
  await dialog.getByLabel("Domanda").fill("A che quota passano le canaline nel corridoio del piano terra?");
  await dialog.getByLabel("Organizzazioni destinatarie").click();
  await page.getByRole("option", { name: /^DES —/ }).click();
  await dialog.getByRole("button", { name: "Invia" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(subject).first()).toBeVisible();

  const desContext = await browser.newContext();
  const des = await desContext.newPage();
  await loginUi(des, "des.lead@des.example");
  await des.goto(`/progetti/${projectId}/rfi`);
  await des.getByText(subject).first().click();
  await des.getByLabel("Rispondi").fill("Le canaline passano a +2,80 m dal piano finito.");
  await des.getByLabel("È la risposta ufficiale").check();
  await des.getByRole("button", { name: "Invia" }).click();
  await expect(des.getByText("Le canaline passano a +2,80 m dal piano finito.")).toBeVisible();
  await expect(des.getByText("Risposta", { exact: true }).first()).toBeVisible();   // stato e messaggio
  await desContext.close();

  await page.reload();
  await page.getByText(subject).first().click();
  await expect(page.getByRole("button", { name: /risposta ricevuta/ }).first()).toBeVisible();    // notifica al richiedente (Per me + campanella)
  await expect(page.getByText("Le canaline passano a +2,80 m dal piano finito.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Chiudi RFI" }).click();
  await expect(page.getByRole("button", { name: "Chiudi RFI" })).toBeHidden();
  const rfis = await (await sub.get(`/api/projects/${projectId}/rfis`, { params: { status: "CLOSED" } })).json();
  const mine = (rfis.items ?? rfis).find((r: { subject: string }) => r.subject === subject);
  expect(mine.status).toBe("CLOSED");
});
