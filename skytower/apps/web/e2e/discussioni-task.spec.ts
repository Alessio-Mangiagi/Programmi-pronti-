// "><(((º> sabusabu <º)))><"
// Discussioni e task (ADR-59) dal browser, con tre persone come tre sessioni separate:
// - Des Lead apre una discussione e invita Com Dl e Sub1 User; il Project Admin (Com Admin) non la vede;
// - Com Dl risponde; Des Lead crea un task dal suo messaggio, assegnato a Com Dl, con priorità, scadenza e sotto-task;
// - Com Dl trascina la scheda nella bacheca da "Da fare" a "In corso", spunta un sotto-task, commenta e la chiude
//   come "Fatto"; Des Lead riceve subito l'avviso "completato" e vede la storia nella scheda.
// Con CDE_SCREENSHOT_DIR il test salva lì le schermate per la guida utente (altrimenti nessuna).
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

const SHOTS = process.env.CDE_SCREENSHOT_DIR;
async function shot(target: Page | Locator, name: string) {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 500));          // animazioni di dialog e drawer finite
  await target.screenshot({ path: join(SHOTS, name), animations: "disabled" });
}

test("discussione fra invitati, task dal messaggio e bacheca", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const lead = await apiAs(baseURL, "des.lead@des.example");
  const { projectId } = await projectAndFolder(lead, () => true);
  const titolo = `Nodo trave-pilastro asse C e2e ${Date.now() % 100000}`;

  // 1. Des Lead apre la discussione e invita due persone di altre organizzazioni
  await loginUi(page, "des.lead@des.example");
  await page.goto(`/progetti/${projectId}/discussioni`);
  await page.getByRole("button", { name: "Nuova discussione" }).click();
  const nuova = page.getByRole("dialog", { name: "Nuova discussione" });
  await nuova.getByLabel("Titolo").fill(titolo);
  await nuova.getByLabel("Persone invitate").click();
  await page.getByRole("option", { name: "Com Dl (COM)" }).click();
  await nuova.getByLabel("Persone invitate").click();
  await page.getByRole("option", { name: "Sub1 User (SUB1)" }).click();
  await nuova.getByLabel("Primo messaggio").fill("Al nodo dell'asse C la trave interferisce con la canalina: come procediamo?");
  await shot(nuova, "15-nuova-discussione.png");
  await nuova.getByRole("button", { name: "Avvia la discussione" }).click();
  await expect(page.getByRole("heading", { name: titolo })).toBeVisible();
  await expect(page.getByLabel("Persone nella discussione").getByText("Com Dl · COM")).toBeVisible();

  // il Project Admin non è invitato: per lui la discussione non esiste
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const elencoAdmin = await (await admin.get(`/api/projects/${projectId}/discussions?stato=tutte`)).json();
  expect(elencoAdmin.map((d: { title: string }) => d.title)).not.toContain(titolo);

  // 2. Com Dl la trova con il messaggio nuovo e risponde
  const dlContext = await browser.newContext();
  const dl = await dlContext.newPage();
  await loginUi(dl, "com.dl@com.example");
  await dl.goto(`/progetti/${projectId}/discussioni`);
  const riga = dl.getByRole("link", { name: `Discussione ${titolo}` });
  await expect(riga.getByText("1 nuovo")).toBeVisible();
  await shot(dl.locator("main"), "15-discussioni-elenco.png");
  await riga.click();
  await dl.getByLabel("Scrivi un messaggio").fill("Serve il dettaglio del nodo con la canalina deviata sotto la trave.");
  await dl.getByRole("button", { name: "Invia", exact: true }).click();
  await expect(dl.getByText("Serve il dettaglio del nodo con la canalina deviata sotto la trave.")).toBeVisible();

  // 3. Des Lead crea un task dal messaggio di Com Dl
  await page.reload();
  const messaggio = page.getByRole("article", { name: "Messaggio di Com Dl" });
  await expect(messaggio).toBeVisible();
  await shot(page.locator("main"), "15-discussione.png");
  await messaggio.getByRole("button", { name: "Crea task" }).click();
  const nuovoTask = page.getByRole("dialog", { name: "Nuovo task" });
  await expect(nuovoTask.getByLabel("Descrizione")).toHaveValue(/canalina deviata/);
  await nuovoTask.getByLabel("Titolo").fill("Dettaglio nodo trave-pilastro asse C");
  await nuovoTask.getByLabel("Assegnato a").click();
  await page.getByRole("option", { name: "Com Dl (COM)" }).click();
  await nuovoTask.getByLabel("Priorità").click();
  await page.getByRole("option", { name: "Alta" }).click();
  await nuovoTask.getByLabel("Scadenza").fill("2031-05-20");
  await nuovoTask.getByLabel("Sotto-task (facoltativi, uno per riga)").fill("Pianta del nodo\nSezione verticale");
  await shot(nuovoTask, "15-crea-task.png");
  await nuovoTask.getByRole("button", { name: "Crea il task" }).click();
  await expect(nuovoTask).toBeHidden();
  await expect(messaggio.getByRole("link", { name: /TASK-\d{4} · Da fare/ })).toBeVisible();
  await expect(page.getByLabel("Task nati dalla discussione").getByText(/Dettaglio nodo trave-pilastro asse C/)).toBeVisible();

  // 4. Com Dl sposta la scheda in "In corso" trascinandola nella bacheca
  await dl.goto(`/progetti/${projectId}/task`);
  await dl.getByRole("button", { name: "Assegnati a me" }).click();
  const scheda = dl.getByRole("region", { name: "Colonna Da fare" }).getByLabel(/Dettaglio nodo trave-pilastro asse C/);
  await expect(scheda).toBeVisible();
  await expect(scheda.getByText("20/05/2031")).toBeVisible();
  await scheda.dragTo(dl.getByRole("region", { name: "Colonna In corso" }));
  const inCorso = dl.getByRole("region", { name: "Colonna In corso" }).getByLabel(/Dettaglio nodo trave-pilastro asse C/);
  await expect(inCorso).toBeVisible();
  await shot(dl.locator("main"), "15-bacheca.png");

  // 5. apre la scheda: spunta un sotto-task, commenta, segna "Fatto"
  await inCorso.click();
  const drawer = dl.getByRole("dialog", { name: /Task TASK-\d{4}/ });
  await drawer.getByRole("checkbox", { name: "Pianta del nodo" }).check();
  await expect(drawer.getByText("1 di 2")).toBeVisible();
  await drawer.getByLabel("Scrivi un commento").fill("Pianta fatta, la sezione arriva domani.");
  await drawer.getByRole("button", { name: "Commenta" }).click();
  await expect(drawer.getByText("Pianta fatta, la sezione arriva domani.")).toBeVisible();
  await shot(drawer, "15-scheda-task.png");
  await drawer.getByRole("button", { name: "Fatto", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Fatto", exact: true })).toHaveAttribute("aria-pressed", "true");
  await drawer.getByRole("button", { name: "Chiudi la scheda del task" }).click();
  await expect(dl.getByRole("region", { name: "Colonna Fatto" }).getByLabel(/Dettaglio nodo trave-pilastro asse C/)).toBeVisible();
  await dlContext.close();

  // 6. Des Lead lo sa subito e ritrova tutto nella storia del task
  await expect.poll(async () => {
    const { items } = await (await lead.get("/api/notifications", { params: { limit: 50 } })).json();
    return items.some((n: { kind: string; body: string }) => n.kind === "TEAM_TASK_COMPLETED" && n.body.includes("Com Dl ha completato"));
  }).toBe(true);
  await page.goto(`/progetti/${projectId}/task`);
  await page.getByRole("button", { name: "Assegnati da me" }).click();
  await page.getByRole("region", { name: "Colonna Fatto" }).getByLabel(/Dettaglio nodo trave-pilastro asse C/).click();
  const scheda2 = page.getByRole("dialog", { name: /Task TASK-\d{4}/ });
  await expect(scheda2.getByText("ha completato il sotto-task «Pianta del nodo»")).toBeVisible();
  await expect(scheda2.getByText("ha spostato in «In corso»")).toBeVisible();
  await expect(scheda2.getByRole("link", { name: titolo })).toBeVisible();     // la discussione di origine
});
