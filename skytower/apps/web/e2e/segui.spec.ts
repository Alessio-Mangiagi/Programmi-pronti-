// "><(((º> sabusabu <º)))><"
// Segui documento: l'Information Manager segue un documento della propria organizzazione; quando l'admin ne
// carica una nuova revisione (verificata dal worker) gli arriva la notifica.
import { expect, test } from "@playwright/test";
import { apiAs, findDocs, loginUi, projectAndFolder, uploadPdf } from "./helpers";
import { textPdf } from "./pdf";

const NAME = "PRJ01-COM-ZZ-00-RP-Z-0996.pdf";

test("segui un documento e ricevi la notifica della nuova revisione", async ({ page, browser, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  const doc = await uploadPdf(page, api, projectId, folderId, NAME, "Verbale da seguire e2e", ["Prima stesura"]);

  // l'Information Manager lo segue dal dettaglio del documento
  const imContext = await browser.newContext();
  const im = await imContext.newPage();
  await loginUi(im, "com.im@com.example");
  await im.goto(`/progetti/${projectId}/documenti`);
  await im.getByRole("cell", { name: "Verbale da seguire e2e" }).click();
  await im.getByRole("button", { name: "Segui", exact: true }).click();
  await expect(im.getByRole("button", { name: "Seguito" })).toHaveAttribute("aria-pressed", "true");

  // l'admin carica la revisione successiva (stesso identificativo)
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: NAME, mimeType: "application/pdf", buffer: textPdf(["Seconda stesura"]) });
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.02 creata")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await findDocs(api, projectId, "Verbale da seguire e2e"))[0]?.current_scan_status,
                    { timeout: 30_000 }).toBe("CLEAN");

  await expect.poll(async () => {
    await im.reload();
    await im.getByRole("banner").getByRole("button", { name: "notifiche" }).click();
    const found = await im.getByText(`Nuova revisione P01.02: ${doc.identifier}`).count();
    await im.keyboard.press("Escape");
    return found;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  // nel pannello ogni avviso porta il suo tipo
  await im.getByRole("banner").getByRole("button", { name: "notifiche" }).click();
  const item = im.getByRole("button", { name: new RegExp(`Nuova revisione P01.02: ${doc.identifier}`) });
  await expect(item.getByText("Documenti seguiti", { exact: true })).toBeVisible();
  await imContext.close();
});
