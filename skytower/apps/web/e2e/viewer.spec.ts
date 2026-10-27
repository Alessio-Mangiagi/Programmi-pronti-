// "><(((º> sabusabu <º)))><"
// Viewer PDF in piattaforma: ricerca nel testo con evidenziazione e navigazione tra le occorrenze.
import { expect, request, test } from "@playwright/test";
import { textPdf } from "./pdf";

const ADMIN = "com.admin@com.example";
const PASSWORD = "Cantiere-2026!";

test("ricerca nel testo del PDF", async ({ page, baseURL }) => {
  const anon = await request.newContext({ baseURL });
  const { access_token } = await (await anon.post("/api/auth/login", { data: { email: ADMIN, password: PASSWORD } })).json();
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${access_token}` } });
  const projectId = (await (await api.get("/api/projects")).json()).find((p: { code: string }) => p.code === "PRJ01").id;
  const folderId = (await (await api.get(`/api/projects/${projectId}/containers`)).json())
    .find((c: { name: string }) => c.name.startsWith("COM")).id;

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);

  const name = "PRJ01-COM-ZZ-00-RP-Z-0900.pdf";
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer: textPdf([
    "Verbale di sopralluogo in cantiere", "Presenti: direzione lavori e impresa", "Il cantiere resta aperto il sabato"]) });
  await page.getByLabel("Titolo (nuovo documento)").fill("Verbale di sopralluogo");
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.01 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();

  // il viewer apre solo file verificati dal worker (impronta + antivirus)
  await expect.poll(async () => {
    const { items } = await (await api.get(`/api/projects/${projectId}/documents`, { params: { q: "sopralluogo" } })).json();
    return items[0]?.current_scan_status;
  }, { timeout: 30_000 }).toBe("CLEAN");

  await page.reload();
  await page.getByText("Verbale di sopralluogo").dblclick();
  const search = page.getByPlaceholder("Cerca nel testo");
  await search.fill("cantiere");
  await expect(page.getByText("1/2")).toBeVisible({ timeout: 15_000 });
  await search.press("Enter");
  await expect(page.getByText("2/2")).toBeVisible();
  await search.fill("inesistente");
  await expect(page.getByLabel("Occorrenza successiva")).toBeDisabled();
});
