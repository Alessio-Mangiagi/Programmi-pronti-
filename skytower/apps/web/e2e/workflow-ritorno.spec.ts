// "><(((º> sabusabu <º)))><"
// Tornare indietro da un nodo (docs/workflow-grafo.md §6, ADR-51), dalla posta "Compiti" alla vista finale:
// - processo di prova (modello via API): «Verifica tecnica» (Direttore Lavori) → «Approvazione» (Project Admin);
// - il Project Admin, sul compito «Approvazione», usa "Chiedi chiarimento": il dialogo propone il passo precedente,
//   il commento è obbligatorio; il compito resta "in attesa di chiarimento" e non si completa;
// - il Direttore Lavori risponde (via API); il compito torna attivo e mostra la risposta;
// - "Richiedi modifiche" riapre «Verifica tecnica»; rifatta, il flusso torna all'approvazione;
// - la vista finale mostra le frecce tratteggiate di ritorno, l'elenco "Chiarimenti e modifiche" e, nel pannello
//   del nodo, il giro riaperto con la richiesta.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

const nodo = (page: Page, testo: RegExp) => page.getByRole("button", { name: testo });

async function compito(api: APIRequestContext, instanceId: string, kind = "WORKFLOW") {
  const tasks = await (await api.get("/api/me/tasks")).json();
  return tasks.find((t: { instance_id: string; kind: string }) => t.instance_id === instanceId && t.kind === kind);
}

test("tornare indietro: chiarimento, attesa, risposta, richiesta di modifiche e vista finale", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const dl = await apiAs(baseURL, "com.dl@com.example");
  const { projectId } = await projectAndFolder(admin, () => true);
  const suffix = String(Date.now() % 100_000);
  const ruolo = (code: string) => [{ type: "role", code }];
  const ok = { code: "OK", label: "Approvato", color: "green" };
  const no = { code: "NO", label: "Respinto", color: "red" };
  const tpl = await (await admin.post(`/api/projects/${projectId}/workflow-templates`, { data: {
    code: `E2E_RIT_${suffix}`, name: `Ritorno ${suffix}`, subject: "PROCESS", definition: { version: 2,
      nodes: [
        { id: "s", type: "start", name: "Avvio", cell: { col: 0, row: 0 } },
        { id: "a", type: "decision", name: "Verifica tecnica", cell: { col: 1, row: 0 }, assignees: ruolo("DIRETTORE_LAVORI"), quorum: "ANY", outcomes: [ok, no] },
        { id: "b", type: "decision", name: "Approvazione", cell: { col: 2, row: 0 }, assignees: ruolo("PROJECT_ADMIN"), quorum: "ANY", outcomes: [ok, no] },
        { id: "fine", type: "end", name: "Concluso", result: "OK", cell: { col: 3, row: 0 } },
        { id: "ko", type: "end", name: "Fallito", result: "KO", cell: { col: 3, row: 1 } }],
      edges: [{ from: "s", to: "a" }, { from: "a", outcome: "OK", to: "b" }, { from: "a", outcome: "NO", to: "ko" },
              { from: "b", outcome: "OK", to: "fine" }, { from: "b", outcome: "NO", to: "ko" }] } } })).json();
  const proc = await (await admin.post(`/api/projects/${projectId}/processes`, { data: {
    template_id: tpl.id, title: `[PROVA] Ritorno ${suffix}` } })).json();
  const verifica = await compito(dl, proc.id);
  expect((await dl.post(`/api/tasks/${verifica.id}/complete`, { data: { outcome: "OK" } })).ok()).toBeTruthy();

  // 1. chiarimento dal compito «Approvazione»: destinazione proposta = passo precedente, commento obbligatorio
  await loginUi(page, "com.admin@com.example");
  await page.goto(`/compiti?instance=${proc.id}`);
  const lavoro = page.getByRole("dialog", { name: /Approvazione/ });
  await lavoro.getByRole("button", { name: "Chiedi chiarimento" }).click();
  const chiedi = page.getByRole("dialog", { name: "Chiedi chiarimento" });
  await expect(chiedi.getByRole("radio", { name: /Verifica tecnica/ })).toBeChecked();
  await expect(chiedi.getByRole("radio", { name: /Chi ha avviato/ })).toBeVisible();
  await expect(chiedi.getByRole("button", { name: "Invia la domanda" })).toBeDisabled();
  await chiedi.getByLabel("Domanda (obbligatoria)").fill("Le quote del solaio sono state verificate?");
  await chiedi.getByRole("button", { name: "Invia la domanda" }).click();
  await expect(chiedi).toBeHidden();
  await expect(lavoro.getByText(/In attesa di chiarimento da/)).toBeVisible();
  await expect(lavoro.getByRole("button", { name: "Conferma esito" })).toBeDisabled();
  await expect(lavoro.getByRole("button", { name: "Richiedi modifiche" })).toBeDisabled();

  // 2. il Direttore Lavori risponde: il compito torna attivo e mostra la risposta
  const domanda = await compito(dl, proc.id, "CLARIFICATION");
  expect(domanda.clarification.comment).toContain("quote del solaio");
  expect((await dl.post(`/api/tasks/${domanda.id}/clarification/answer`, {
    data: { comment: "Sì, verificate sul rilievo del 3 novembre" } })).ok()).toBeTruthy();
  await page.reload();
  await expect(lavoro.getByText("Sì, verificate sul rilievo del 3 novembre")).toBeVisible();
  await expect(lavoro.getByRole("button", { name: "Conferma esito" })).toBeEnabled();

  // 3. richiesta di modifiche: «Verifica tecnica» si riapre, il proprio compito si chiude
  await lavoro.getByRole("button", { name: "Richiedi modifiche" }).click();
  const rimanda = page.getByRole("dialog", { name: "Richiedi modifiche" });
  await rimanda.getByRole("radio", { name: /Verifica tecnica/ }).check();
  await rimanda.getByLabel("Cosa va modificato (obbligatorio)").fill("Allegare il verbale firmato del rilievo");
  await rimanda.getByRole("button", { name: "Rimanda indietro" }).click();
  await expect(rimanda).toBeHidden();
  await expect(lavoro).toBeHidden();
  const rifare = await compito(dl, proc.id);
  expect(rifare.changes_request.comment).toBe("Allegare il verbale firmato del rilievo");
  expect((await dl.post(`/api/tasks/${rifare.id}/complete`, { data: { outcome: "OK" } })).ok()).toBeTruthy();

  // 4. vista finale: frecce di ritorno, elenco delle richieste, giro riaperto nel pannello del nodo
  await page.goto(`/istanze/${proc.id}`);
  await expect(nodo(page, /^Decisione: Verifica tecnica, fatto, 2 giri/)).toBeVisible();
  await expect(nodo(page, /^Decisione: Approvazione, in corso, 2 giri/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Modifiche richieste: «Approvazione» → «Verifica tecnica»/ })).toBeAttached();
  await expect(page.getByRole("img", { name: /Chiarimento chiesto: «Approvazione» → «Verifica tecnica»/ })).toBeAttached();
  const elenco = page.getByRole("region", { name: "Chiarimenti e modifiche" });
  await expect(elenco.getByText("Allegare il verbale firmato del rilievo")).toBeVisible();
  await expect(elenco.getByText("Sì, verificate sul rilievo del 3 novembre")).toBeVisible();
  await nodo(page, /^Decisione: Verifica tecnica/).click();
  const dettaglio = page.getByRole("complementary", { name: "Dettaglio del nodo" });
  await expect(dettaglio.getByText("Riaperto per la richiesta di modifiche:")).toBeVisible();
  await expect(page.getByRole("link", { name: "Svolgi il tuo compito" })).toBeVisible();
});
