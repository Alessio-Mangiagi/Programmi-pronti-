// "><(((º> sabusabu <º)))><"
// Stati del CDE dal browser: il progettista carica in WIP e condivide; la visibilità segue lo stato
// (WIP solo all'organizzazione autrice, SHARED anche all'Information Manager del committente, non al subappaltatore).
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { textPdf } from "./pdf";

const PASSWORD = "Cantiere-2026!";

async function apiAs(baseURL: string | undefined, email: string): Promise<APIRequestContext> {
  const anon = await request.newContext({ baseURL });
  const { access_token } = await (await anon.post("/api/auth/login", { data: { email, password: PASSWORD } })).json();
  return request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${access_token}` } });
}

async function find(api: APIRequestContext, projectId: string, q: string) {
  const r = await api.get(`/api/projects/${projectId}/documents`, { params: { q } });
  return (await r.json()).items as { id: string; current_revision: string; current_state: string; current_scan_status: string }[];
}

test("WIP visibile solo all'autore, condivisione dal dettaglio documento", async ({ page, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const com = await apiAs(baseURL, "com.im@com.example");   // Information Manager del committente
  const sub = await apiAs(baseURL, "sub1.user@sub1.example");
  const projectId = (await (await des.get("/api/projects")).json()).find((p: { code: string }) => p.code === "PRJ01").id;
  const folder = (await (await des.get(`/api/projects/${projectId}/containers`)).json())
    .find((c: { name: string }) => c.name === "Tavole architettoniche");

  await page.goto("/login");
  await page.getByLabel("Email").fill("des.lead@des.example");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`/progetti/${projectId}/cartelle/${folder.id}`);

  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "PRJ01-DES-ZZ-01-DR-A-0777.pdf", mimeType: "application/pdf", buffer: textPdf(["Pianta piano primo"]) });
  await page.getByLabel("Titolo (nuovo documento)").fill("Pianta piano primo e2e");
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.01 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await find(des, projectId, "e2e"))[0]?.current_scan_status, { timeout: 30_000 }).toBe("CLEAN");

  // WIP: né il committente né il subappaltatore lo vedono
  expect(await find(com, projectId, "e2e")).toHaveLength(0);
  expect(await find(sub, projectId, "e2e")).toHaveLength(0);

  await page.reload();
  await page.getByText("Pianta piano primo e2e").click();
  await page.getByRole("button", { name: "Dettagli e cronologia" }).click();
  await page.getByRole("button", { name: "Condividi P01.01" }).click();
  const dialog = page.getByRole("dialog").last();
  const suitability = dialog.getByLabel("Codice di idoneità");
  if (await suitability.count()) {
    await suitability.click();
    await page.getByRole("option").first().click();
  }
  await dialog.getByLabel(/Motivazione/).fill("Per coordinamento impianti");
  await dialog.getByRole("button", { name: "Condividi" }).click();
  await expect.poll(async () => (await find(des, projectId, "e2e"))[0]?.current_state, { timeout: 15_000 }).toBe("SHARED");

  const doc = (await find(des, projectId, "e2e"))[0];
  expect(doc.current_revision).toBe("P01");                       // ricodifica in condivisione
  expect(await find(com, projectId, "e2e")).toHaveLength(1);       // l'Information Manager coordina
  expect(await find(sub, projectId, "e2e")).toHaveLength(0);       // il subappaltatore no
});
