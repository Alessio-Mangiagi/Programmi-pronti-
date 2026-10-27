// "><(((º> sabusabu <º)))><"
// Accessibilità (WCAG 2.1 A/AA con axe-core): nessuna violazione, di nessun livello, sulle pagine principali.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page, where: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
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
  const found = await violations(page, "dialog upload");
  await page.getByRole("button", { name: "Chiudi" }).click();

  await page.getByText("Verbale accessibile e2e").dblclick();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
  found.push(...await violations(page, "viewer PDF"));
  expect(found).toEqual([]);
});
