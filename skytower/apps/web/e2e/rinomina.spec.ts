// "><(((º> sabusabu <º)))><"
// Rinomina automatica in caricamento, dal browser: progressivo deciso dall'admin, numeri consecutivi tra
// più file, nome originale nelle note della revisione.
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN = "com.admin@com.example";
const PASSWORD = "Cantiere-2026!";
let api: APIRequestContext;
let projectId = "";
let folderId = "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.beforeAll(async ({ baseURL }) => {
  const anon = await request.newContext({ baseURL });
  const { access_token } = await (await anon.post("/api/auth/login", { data: { email: ADMIN, password: PASSWORD } })).json();
  api = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${access_token}` } });
  const projects = await (await api.get("/api/projects")).json();
  projectId = projects.find((p: { code: string }) => p.code === "PRJ01").id;
  const containers = await (await api.get(`/api/projects/${projectId}/containers`)).json();
  folderId = containers.find((c: { name: string }) => c.name.startsWith("COM")).id;
  const settings = await (await api.get(`/api/projects/${projectId}/document-settings`)).json();
  const put = await api.put(`/api/projects/${projectId}/document-settings`, { data: {
    naming_scheme: null, metadata_schema: settings.metadata_schema,
    auto_number: { field: "number", start: 1, series: null, defaults: { volume: "ZZ", level: "00", type: "CO", role: "Z" } },
  } });
  expect(put.ok()).toBeTruthy();
});

test("file con nomi qualsiasi rinominati con progressivi consecutivi", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "1 - ADDENDUM N° 1 AL CONTRATTO.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%a\n") },
    { name: "verbale riunione 12-10.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%b\n") },
  ]);

  // nome non conforme: la rinomina è già proposta, con numeri consecutivi nella stessa serie
  await expect(page.getByText("PRJ01-COM-ZZ-00-CO-Z-0001.pdf")).toBeVisible();
  await expect(page.getByText("PRJ01-COM-ZZ-00-CO-Z-0002.pdf")).toBeVisible();

  for (const title of await page.getByLabel("Titolo (nuovo documento)").all()) await title.fill("Contratto e verbale");
  await page.getByRole("button", { name: /^Carica 2$/ }).click();
  await expect(page.getByText(/Caricato come PRJ01-COM-ZZ-00-CO-Z-0001\.pdf/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Caricato come PRJ01-COM-ZZ-00-CO-Z-0002\.pdf/)).toBeVisible({ timeout: 30_000 });

  const { items } = await (await api.get(`/api/projects/${projectId}/documents`, { params: { q: "Contratto e verbale" } })).json();
  const first = items.find((d: { identifier: string }) => d.identifier.endsWith("-0001"));
  const doc = await (await api.get(`/api/documents/${first.id}`)).json();
  expect(doc.revisions[0].source_filename).toBe("1 - ADDENDUM N° 1 AL CONTRATTO.pdf");
  expect(doc.revisions[0].comment).toContain("Nome originale del file: 1 - ADDENDUM N° 1 AL CONTRATTO.pdf");
});

test("la scheda Naming mostra schema e progressivo attivo", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto(`/progetti/${projectId}/naming`);
  await expect(page.getByText("Naming convention ISO 19650")).toBeVisible();
  await expect(page.getByText("Rinomina automatica in caricamento")).toBeVisible();
  await expect(page.getByLabel("Attiva")).toBeChecked();
  await expect(page.getByRole("button", { name: "Modifica schema" })).toBeVisible();
});
