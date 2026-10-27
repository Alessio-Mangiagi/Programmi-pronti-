// "><(((º> sabusabu <º)))><"
// Transmittal dal browser: il progettista emette una trasmissione con un documento condiviso, scarica il PDF
// di protocollo; il committente la riceve e ne conferma la ricezione.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("emissione, PDF e conferma di ricezione", async ({ page, browser, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-ZZ-RP-S-0779.pdf", "Relazione strutturale e2e",
                              ["Relazione di calcolo strutturale"]);
  const shared = await des.post(`/api/revisions/${doc.current_revision_id}/transitions`,
                                { data: { to_state: "SHARED", suitability: "S2", reason: "Per informazione" } });
  expect(shared.ok(), await shared.text()).toBeTruthy();

  const subject = `Emissione relazione strutturale ${Date.now() % 100000}`;
  await page.goto(`/progetti/${projectId}/transmittal`);
  await page.getByRole("button", { name: "Nuova trasmissione" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuova trasmissione" });
  await dialog.getByLabel("Oggetto").fill(subject);
  await dialog.getByLabel("Organizzazioni destinatarie").click();
  await page.getByRole("option", { name: /^COM —/ }).click();
  await dialog.getByLabel("Documenti da trasmettere").fill("0779");
  await page.getByRole("option", { name: /PRJ01-DES-ZZ-ZZ-RP-S-0779/ }).click();
  await dialog.getByRole("button", { name: /^Emetti/ }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(subject).first().click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF" }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/^PRJ01-TRM-\d{4}\.pdf$/);

  const comContext = await browser.newContext();
  const com = await comContext.newPage();
  await loginUi(com, "com.admin@com.example");
  await com.goto(`/progetti/${projectId}/transmittal`);
  await com.getByText(subject).first().click();
  await com.getByRole("button", { name: "Conferma ricezione" }).click();
  await expect(com.getByRole("button", { name: "Conferma ricezione" })).toBeHidden();
  await comContext.close();

  await page.reload();
  await expect(page.getByText("Confermata").first()).toBeVisible();
});
