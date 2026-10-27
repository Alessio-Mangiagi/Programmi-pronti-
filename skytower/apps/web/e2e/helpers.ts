// "><(((º> sabusabu <º)))><"
// Utilità comuni dei test e2e: login dal browser, client API con token, caricamento dal dialog.
import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { textPdf } from "./pdf";

export const PASSWORD = "Cantiere-2026!";

export async function loginUi(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function apiAs(baseURL: string | undefined, email: string): Promise<APIRequestContext> {
  const anon = await request.newContext({ baseURL });
  const { access_token } = await (await anon.post("/api/auth/login", { data: { email, password: PASSWORD } })).json();
  return request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${access_token}` } });
}

export async function projectAndFolder(api: APIRequestContext, folderName: (n: string) => boolean) {
  const projectId = (await (await api.get("/api/projects")).json()).find((p: { code: string }) => p.code === "PRJ01").id;
  const folder = (await (await api.get(`/api/projects/${projectId}/containers`)).json())
    .find((c: { name: string }) => folderName(c.name));
  return { projectId, folderId: folder.id as string };
}

export interface DocRow { id: string; identifier: string; current_revision_id: string; current_revision: string;
                          current_state: string; current_scan_status: string }

export async function findDocs(api: APIRequestContext, projectId: string, q: string): Promise<DocRow[]> {
  return (await (await api.get(`/api/projects/${projectId}/documents`, { params: { q } })).json()).items;
}

/** Carica dal dialog un PDF con nome conforme e aspetta la verifica del worker. */
export async function uploadPdf(page: Page, api: APIRequestContext, projectId: string, folderId: string,
                                name: string, title: string, lines: string[]): Promise<DocRow> {
  return uploadFile(page, api, projectId, folderId, { name, mimeType: "application/pdf", buffer: textPdf(lines) }, title);
}

/** Carica dal dialog un file con nome conforme e aspetta la verifica del worker (impronta + antivirus). */
export async function uploadFile(page: Page, api: APIRequestContext, projectId: string, folderId: string,
                                 file: { name: string; mimeType: string; buffer: Buffer }, title: string): Promise<DocRow> {
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  await page.getByRole("button", { name: "Carica" }).first().click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByLabel("Titolo (nuovo documento)").fill(title);
  await page.getByRole("button", { name: /^Carica 1$/ }).click();
  await expect(page.getByText("Revisione P01.01 creata")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi" }).click();
  await expect.poll(async () => (await findDocs(api, projectId, title))[0]?.current_scan_status, { timeout: 30_000 })
    .toBe("CLEAN");
  return (await findDocs(api, projectId, title))[0];
}
