// "><(((º> sabusabu <º)))><"
// Nuovo progetto da un progetto esistente come template (ADR-38): dal dialog "Nuovo progetto" si sceglie il
// progetto di partenza e si copiano cartelle e configurazione, con le organizzazioni partecipanti; i documenti no.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("progetto nuovo da un progetto esistente usato come template", async ({ page, baseURL }) => {
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(admin, () => true);
  const source = await (await admin.get(`/api/projects/${projectId}`)).json();
  const folders = (await (await admin.get(`/api/projects/${projectId}/containers`)).json()) as { name: string }[];
  const code = `E${Date.now() % 100_000}`;

  await loginUi(page, "com.admin@com.example");
  await page.goto("/");
  await page.getByRole("button", { name: "Nuovo progetto" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo progetto" });
  await dialog.getByLabel("Codice progetto (ISO 19650)").fill(code);
  await dialog.getByLabel("Nome", { exact: true }).fill("Progetto da template e2e");
  await dialog.getByLabel("Parti da").click();
  await page.getByRole("option", { name: `${source.code} — ${source.name}` }).click();
  await expect(dialog.getByText(/Si copiano \d+ cartelle/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Anche le organizzazioni partecipanti/ }).check();
  await dialog.getByRole("button", { name: "Crea" }).click();
  await expect(page).toHaveURL(/\/progetti\/[0-9a-f-]{36}/);

  const created = (await (await admin.get("/api/projects")).json()).find((p: { code: string }) => p.code === code);
  const copied = (await (await admin.get(`/api/projects/${created.id}/containers`)).json()) as { name: string }[];
  expect(copied.map((c) => c.name).sort()).toEqual(folders.map((c) => c.name).sort());
  expect((await (await admin.get(`/api/projects/${created.id}/documents`)).json()).items).toEqual([]);
});
