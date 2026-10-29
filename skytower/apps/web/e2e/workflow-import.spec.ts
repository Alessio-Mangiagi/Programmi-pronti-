// "><(((º> sabusabu <º)))><"
// Workflow sviluppato in un progetto e importato in un altro (ADR-39): dalla scheda Workflow "Importa da un altro
// progetto", si sceglie il workflow e lo si importa; le persone che nel progetto di destinazione non ci sono
// vengono tolte, con la nota nell'avviso.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("workflow importato da un altro progetto", async ({ page, baseURL }) => {
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(admin, () => true);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const me = await (await des.get("/api/me")).json();
  const suffix = String(Date.now() % 100_000);
  await admin.post(`/api/projects/${projectId}/workflow-templates`, { data: {
    code: `E2E_IMP_${suffix}`, name: `Verifica importabile ${suffix}`, definition: { steps: [
      { name: "Verifica tecnica", assignees: [{ type: "role", code: "INFORMATION_MANAGER" }, { type: "user", id: me.id }], quorum: "ANY" },
      { name: "Approvazione DL", assignees: [{ type: "role", code: "DIRETTORE_LAVORI" }] },
    ] } } });
  const target = await (await admin.post("/api/projects", { data: { code: `I${suffix}`, name: "Destinazione import e2e" } })).json();

  await loginUi(page, "com.admin@com.example");
  await page.goto(`/progetti/${target.id}/workflow`);
  await page.getByRole("button", { name: "Importa da un altro progetto" }).click();
  const dialog = page.getByRole("dialog", { name: "Importa un workflow da un altro progetto" });
  await dialog.getByLabel("Workflow").click();
  await page.getByRole("option", { name: new RegExp(`Verifica importabile ${suffix}`) }).click();
  await expect(dialog.getByText("Verifica tecnica → Approvazione DL")).toBeVisible();
  await dialog.getByRole("button", { name: "Importa" }).click();

  await expect(page.getByText(new RegExp(`Importato «Verifica importabile ${suffix}»`))).toBeVisible();
  await expect(page.getByText(/non è in questo progetto/)).toBeVisible();
  const active = await (await admin.get(`/api/projects/${target.id}/workflow-templates`)).json();
  expect(active.map((t: { code: string }) => t.code)).toEqual([`E2E_IMP_${suffix}`]);
});
