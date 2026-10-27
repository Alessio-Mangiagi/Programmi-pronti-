// "><(((º> sabusabu <º)))><"
// Workflow di approvazione dal browser: il progettista avvia l'approvazione dal dettaglio documento, il
// Direttore dei lavori la trova tra i suoi compiti e approva; all'esito il documento viene pubblicato.
import { expect, test } from "@playwright/test";
import { apiAs, findDocs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("avvio dal documento, approvazione del DL, pubblicazione automatica", async ({ page, browser, baseURL }) => {
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");

  const members = await (await admin.get(`/api/projects/${projectId}/members`)).json();
  const dl = members.find((m: { email: string }) => m.email === "com.dl@com.example");
  const tpl = await admin.post(`/api/projects/${projectId}/workflow-templates`, { data: {
    code: "E2E_DL", name: "Approvazione DL (e2e)",
    definition: { steps: [{ name: "Approvazione DL", assignees: [{ type: "user", id: dl.user_id ?? dl.id }], sla_hours: 48 }],
                  on_approved: { to_state: "PUBLISHED", suitability: "A1" } },
  } });
  expect(tpl.ok(), await tpl.text()).toBeTruthy();

  await loginUi(page, "des.lead@des.example");
  const doc = await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-02-DR-A-0778.pdf", "Pianta piano secondo e2e",
                              ["Pianta piano secondo", "Scala 1:100"]);
  const shared = await des.post(`/api/revisions/${doc.current_revision_id}/transitions`,
                                { data: { to_state: "SHARED", suitability: "S4", reason: "Per approvazione" } });
  expect(shared.ok(), await shared.text()).toBeTruthy();

  await page.reload();
  await page.getByText("Pianta piano secondo e2e").click();
  await page.getByRole("button", { name: "Dettagli e cronologia" }).click();
  await page.getByRole("button", { name: "Avvia approvazione" }).click();
  const start = page.getByRole("dialog", { name: "Avvia approvazione" });
  await start.getByLabel("Workflow").click();
  await page.getByRole("option", { name: /Approvazione DL \(e2e\)/ }).click();
  await start.getByLabel("Nota per i revisori").fill("Verificare quote");
  await start.getByRole("button", { name: "Avvia" }).click();
  await expect(start).toBeHidden();

  // il DL, in un'altra sessione, approva dalla pagina dei compiti
  const dlContext = await browser.newContext();
  const dlPage = await dlContext.newPage();
  await loginUi(dlPage, "com.dl@com.example");
  await dlPage.goto("/compiti");
  await dlPage.getByRole("cell", { name: /Pianta piano secondo e2e/ }).click();
  await dlPage.getByRole("button", { name: "Approvato", exact: true }).click();
  await dlPage.getByRole("button", { name: "Conferma esito" }).click();
  await expect.poll(async () => (await findDocs(des, projectId, "Pianta piano secondo e2e"))[0]?.current_state,
                    { timeout: 15_000 }).toBe("PUBLISHED");
  const published = (await findDocs(des, projectId, "Pianta piano secondo e2e"))[0];
  expect(published.current_revision).toBe("C01");
  await dlContext.close();
});

test("il DL rifiuta con commento obbligatorio e l'autore viene avvisato", async ({ page, browser, baseURL }) => {
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  const members = await (await admin.get(`/api/projects/${projectId}/members`)).json();
  const dl = members.find((m: { email: string }) => m.email === "com.dl@com.example");
  const tpl = await (await admin.post(`/api/projects/${projectId}/workflow-templates`, { data: {
    code: "E2E_DL_RIFIUTO", name: "Verifica DL (e2e)",
    definition: { steps: [{ name: "Verifica DL", assignees: [{ type: "user", id: dl.user_id ?? dl.id }] }] },
  } })).json();

  await loginUi(page, "des.lead@des.example");
  const doc = await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-03-DR-A-0780.pdf", "Pianta piano terzo e2e",
                              ["Pianta piano terzo"]);
  const shared = await (await des.post(`/api/revisions/${doc.current_revision_id}/transitions`,
                                       { data: { to_state: "SHARED", suitability: "S4", reason: "Per verifica" } })).json();
  expect((await des.post(`/api/revisions/${shared.id}/workflows`, { data: { template_id: tpl.id } })).ok()).toBeTruthy();

  const dlContext = await browser.newContext();
  const dlPage = await dlContext.newPage();
  await loginUi(dlPage, "com.dl@com.example");
  await dlPage.goto("/compiti");
  await dlPage.getByRole("cell", { name: /Pianta piano terzo e2e/ }).click();
  await dlPage.getByRole("button", { name: "Rifiutato" }).click();
  await expect(dlPage.getByRole("button", { name: "Conferma esito" })).toBeDisabled();   // senza commento non si rifiuta
  await dlPage.getByLabel(/Commento/).fill("Manca la sezione B-B");
  await dlPage.getByRole("button", { name: "Conferma esito" }).click();
  await dlContext.close();

  const workflows = await (await des.get(`/api/documents/${doc.id}/workflows`)).json();
  expect(workflows[0].status).toBe("REJECTED");
  await page.goto("/");
  await expect(page.getByText(/Manca la sezione B-B/).first()).toBeVisible();          // notifica all'autore
});
