// "><(((º> sabusabu <º)))><"
// Pagina Organizzazione: l'admin invita, reinvia l'invito, nomina un admin, disattiva e riattiva; il platform admin
// crea un'organizzazione. Utenti DES non usati dagli altri test (des.admin, des.viewer).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, totp } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("l'admin gestisce gli utenti della propria organizzazione", async ({ page, baseURL }) => {
  await loginUi(page, "des.admin@des.example");
  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await page.getByRole("menuitem", { name: "La mia organizzazione e gli utenti" }).click();
  await expect(page.getByRole("heading", { name: "Organizzazione" })).toBeVisible();
  await expect(page.getByText("Codice originatore DES")).toBeVisible();
  const users = page.getByRole("region", { name: "Utenti dell'organizzazione" });
  await expect(users.getByText("des.lead@des.example")).toBeVisible();

  await page.reload();                         // analisi senza il menu del profilo ancora in dissolvenza
  await expect(page.getByText("Codice originatore DES")).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);

  // invito
  await users.getByRole("button", { name: "Invita utente" }).click();
  const dialog = page.getByRole("dialog", { name: "Invita in Studio Progettazione Srl" });
  await dialog.getByLabel("Email").fill("nuova.collega@des.example");
  await dialog.getByLabel(/^Nome/).fill("Giulia");
  await dialog.getByLabel("Cognome").fill("Verdi");
  await dialog.getByRole("button", { name: "Invia invito" }).click();
  await expect(page.getByText("Invito inviato a nuova.collega@des.example")).toBeVisible();
  const row = users.getByRole("row", { name: /nuova\.collega@des\.example/ });
  await expect(row.getByText("Invitato")).toBeVisible();
  await row.getByRole("button", { name: "Reinvia invito" }).click();
  await expect(page.getByText("Invito inviato di nuovo a nuova.collega@des.example")).toBeVisible();

  // disattiva e riattiva un collega
  const viewer = users.getByRole("row", { name: /des\.viewer@des\.example/ });
  await viewer.getByRole("button", { name: /^Disattiva / }).click();
  await expect(viewer.getByText("Disattivato")).toBeVisible();
  await viewer.getByRole("button", { name: "Riattiva" }).click();
  await expect(viewer.getByText("Attivo", { exact: true })).toBeVisible();

  // un collega ha perso il telefono: l'admin vede l'app configurata e azzera il secondo fattore
  const colleague = await apiAs(baseURL, "des.viewer@des.example");
  const enroll = await (await colleague.post("/api/auth/mfa/totp/enroll", { data: {} })).json();
  expect((await colleague.post("/api/auth/mfa/totp/confirm",
    { data: { factor_id: enroll.factor_id, code: totp(enroll.secret) } })).ok()).toBe(true);
  await page.reload();
  await expect(viewer.getByText("App", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Azzera MFA" }).click();
  await page.getByRole("dialog", { name: /Azzerare l'MFA di Des Viewer/ }).getByRole("button", { name: "Azzera" }).click();
  await expect(page.getByText(/Secondo fattore azzerato per des\.viewer@des\.example/)).toBeVisible();
  await expect(viewer.getByText("App", { exact: true })).toBeHidden();
  // e l'azzeramento resta nel registro di sicurezza dell'organizzazione
  const log = page.getByRole("region", { name: "Accessi e sicurezza" });
  await page.reload();
  await expect(log.getByText("MFA azzerata dall'admin").first()).toBeVisible();
  await expect(log.getByRole("row", { name: /Utente invitato/ }).first()).toBeVisible();

  // l'admin non può togliersi il ruolo da solo
  const self = users.getByRole("row", { name: /des\.admin@des\.example/ });
  await expect(self.getByRole("checkbox")).toBeDisabled();
});

test("il platform admin crea un'organizzazione", async ({ page }) => {
  await loginUi(page, "platform@com.example");
  await page.goto("/organizzazione");
  await page.getByRole("button", { name: "Nuova organizzazione" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuova organizzazione" });
  await dialog.getByLabel("Ragione sociale").fill("Impianti Nord Srl");
  await dialog.getByLabel("Codice originatore ISO 19650").fill("inn");
  await dialog.getByRole("button", { name: "Crea" }).click();
  await expect(page.getByRole("heading", { name: "Impianti Nord Srl" })).toBeVisible();
  await expect(page.getByText("Codice originatore INN")).toBeVisible();
  await expect(page.getByLabel("Autenticazione a due fattori obbligatoria per tutti gli utenti")).toBeChecked();
});
