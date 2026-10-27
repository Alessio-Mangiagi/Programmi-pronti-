// "><(((º> sabusabu <º)))><"
// Accessibilità (WCAG 2.1 A/AA con axe-core): nessuna violazione, di nessun livello, sulle pagine principali.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

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
