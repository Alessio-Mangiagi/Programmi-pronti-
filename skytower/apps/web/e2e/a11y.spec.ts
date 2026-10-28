// "><(((º> sabusabu <º)))><"
// Accessibilità (WCAG 2.1 A/AA con axe-core): nessuna violazione, di nessun livello, sulle pagine principali.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf, openInTab } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Con un dialog aperto si analizza solo il dialog: la pagina dietro è oscurata e inerte. */
async function violations(page: Page, where: string, only?: string): Promise<string[]> {
  if (only) await page.waitForTimeout(500);            // fine della dissolvenza: a opacità parziale il contrasto è falsato
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const r = await (only ? builder.include(only) : builder).analyze();
  return r.violations.map((v) => `${where} ${v.id} [${v.impact}] ×${v.nodes.length}: ${v.help} — ${v.nodes[0]?.target.join(" ")}`);
}

test("login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").waitFor();
  expect(await violations(page, "/login")).toEqual([]);
});

test("pagine della commessa e personali", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  const found: string[] = [];
  for (const path of ["/", "/compiti", "/sicurezza", `/progetti/${projectId}/cartelle/${folderId}`, `/progetti/${projectId}/rfi`,
                      `/progetti/${projectId}/transmittal`, `/progetti/${projectId}/naming`, `/progetti/${projectId}/cruscotto`,
                      `/progetti/${projectId}/registro`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    found.push(...await violations(page, path));
  }
  expect(found).toEqual([]);
});

test("dialog di caricamento con rinomina e viewer PDF", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  const settings = await (await api.get(`/api/projects/${projectId}/document-settings`)).json();
  await api.put(`/api/projects/${projectId}/document-settings`, { data: {
    naming_scheme: null, metadata_schema: settings.metadata_schema,
    auto_number: settings.auto_number ?? { field: "number", start: 1, series: null, defaults: { volume: "ZZ", level: "00", type: "CO", role: "Z" } },
  } });
  await loginUi(page, "com.admin@com.example");
  const doc = await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0970.pdf", "Verbale accessibile e2e", ["Verbale"]);
  expect(doc).toBeTruthy();

  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: "nome qualsiasi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await expect(page.getByText(/PRJ01-COM-ZZ-00-/).first()).toBeVisible();
  const found = await violations(page, "dialog upload", '[role="dialog"]');
  await page.getByRole("button", { name: "Chiudi" }).click();

  const tab = await openInTab(page, () => page.getByText("Verbale accessibile e2e").dblclick());
  await expect(tab.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
  found.push(...await violations(tab, "viewer PDF"));
  expect(found).toEqual([]);
});

test("dialog di RFI, trasmissione, profilo ed editor della naming", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(api, () => true);
  await loginUi(page, "com.admin@com.example");
  const found: string[] = [];

  await page.goto(`/progetti/${projectId}/rfi`);
  await page.getByRole("button", { name: "Nuova RFI" }).click();
  await page.getByRole("dialog").waitFor();
  found.push(...await violations(page, "nuova RFI", '[role="dialog"]'));
  await page.keyboard.press("Escape");

  await page.goto(`/progetti/${projectId}/transmittal`);
  await page.getByRole("button", { name: "Nuova trasmissione" }).click();
  await page.getByRole("dialog").waitFor();
  found.push(...await violations(page, "nuova trasmissione", '[role="dialog"]'));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await page.getByRole("menuitem", { name: "Modifica il mio profilo" }).click();
  await page.getByRole("dialog").waitFor();
  found.push(...await violations(page, "profilo", '[role="dialog"]'));
  await page.keyboard.press("Escape");

  await page.goto(`/progetti/${projectId}/naming`);
  await page.getByRole("button", { name: "Modifica schema" }).click();
  await page.getByLabel("Separatore").waitFor();
  found.push(...await violations(page, "editor naming"));
  expect(found).toEqual([]);
});

test("cartelle e documenti utilizzabili da sola tastiera", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n === "DES - Progetto architettonico");
  const tavole = await projectAndFolder(api, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  await uploadPdf(page, api, projectId, tavole.folderId, "PRJ01-DES-ZZ-05-DR-A-0790.pdf", "Pianta da tastiera e2e", ["Pianta"]);
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  const sub = page.getByRole("main").getByRole("link", { name: "Tavole architettoniche" });
  await sub.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/cartelle\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("main").getByText("Tavole architettoniche").first()).toBeVisible();
  const radio = page.getByRole("radio").first();
  await radio.focus();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
  const open = page.getByRole("button", { name: "Apri", exact: true });
  await open.focus();
  const kbTab = await openInTab(page, () => page.keyboard.press("Enter"));
  await expect(kbTab.getByRole("dialog", { name: "Visualizzatore: Pianta da tastiera e2e" })).toBeVisible();
  // Esc chiude il visualizzatore e con lui la scheda del documento
  await Promise.all([kbTab.waitForEvent("close"), kbTab.keyboard.press("Escape").catch(() => undefined)]);
});
