// "><(((º> sabusabu <º)))><"
// Workflow a grafo (docs/workflow-grafo.md, ADR-48), dal disegno alla vista finale:
// - nell'editor a scacchiera si disegna un processo con un ramo parallelo (l'esito "Approvato" della verifica
//   apre due controlli insieme) e un ritorno (il "Respinto" del controllo A torna alla verifica), si sposta un
//   nodo col trascinamento e uno con la tastiera, si salva quando la validazione dell'API non segnala errori;
// - dalla scheda Processi si avvia il processo e si apre la vista finale;
// - dalla posta "Compiti" si sceglie l'esito "Approvato" (pulsante dell'esito libero del nodo);
// - nella vista finale la verifica è verde (fatta), i due controlli gialli (in corso), la fine grigia.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

/** Scheda di un nodo nel foglio (gruppo SVG con ruolo pulsante ed etichetta "Tipo: nome, stato"). */
const nodo = (page: Page, testo: RegExp) => page.getByRole("button", { name: testo });

async function scegliRuolo(pannello: Locator, page: Page, indice = 0) {
  await pannello.getByLabel("Ruolo", { exact: true }).nth(indice).click();
  await page.getByRole("option", { name: /PROJECT_ADMIN/ }).click();
}

test("workflow a grafo: disegno con ramo parallelo e ritorno, processo, compito, vista finale", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(admin, () => true);
  const suffix = String(Date.now() % 100_000);

  await loginUi(page, "com.admin@com.example");
  await page.goto(`/progetti/${projectId}/workflow`);
  await page.getByRole("button", { name: "Nuovo workflow" }).click();
  const editor = page.getByRole("dialog", { name: "Nuovo workflow" });
  const barra = editor.locator("header");
  await barra.getByLabel("Codice").fill(`E2E_GRAFO_${suffix}`);
  await barra.getByLabel("Nome").fill(`RdA di prova ${suffix}`);
  await barra.getByRole("button", { name: "Processi" }).click();
  const pannello = editor.getByRole("complementary", { name: "Proprietà" });

  // la decisione iniziale diventa "Verifica tecnica", assegnata ai Project Admin
  await nodo(page, /^Decisione: Nuova decisione/).click();
  await pannello.getByLabel("Nome").fill("Verifica tecnica");
  await scegliRuolo(pannello, page);

  // due controlli: nascono a destra della verifica, nella prima casella libera
  for (const nome of ["Controllo A", "Controllo B"]) {
    await nodo(page, /^Decisione: Verifica tecnica/).click();
    await editor.getByRole("navigation", { name: "Tavolozza dei nodi" }).getByRole("button", { name: "Decisione" }).click();
    await pannello.getByLabel("Nome").fill(nome);
    await scegliRuolo(pannello, page);
  }

  // ramo parallelo: "Approvato" della verifica porta ai due controlli (non più alla fine)
  await nodo(page, /^Decisione: Verifica tecnica/).click();
  await pannello.getByRole("button", { name: "→ Concluso" }).locator("svg").click();
  for (const nome of ["Controllo A", "Controllo B"]) {
    await pannello.getByLabel("Collega a…").first().click();
    await page.getByRole("option", { name: nome, exact: true }).click();
  }
  await expect(pannello.getByText("2 rami in parallelo")).toBeVisible();

  // controlli: Approvato → Concluso (riunione dei rami); Respinto di A torna alla verifica (ritorno), di B a Fallito
  for (const [nome, respinto] of [["Controllo A", "Verifica tecnica"], ["Controllo B", "Fallito"]] as const) {
    await nodo(page, new RegExp(`^Decisione: ${nome}`)).click();
    await pannello.getByLabel("Collega a…").nth(0).click();
    await page.getByRole("option", { name: "Concluso", exact: true }).click();
    await pannello.getByLabel("Collega a…").nth(1).click();
    await page.getByRole("option", { name: respinto, exact: true }).click();
  }

  // la scheda di B si sposta di una casella con la tastiera; quella di A col trascinamento
  const b = nodo(page, /^Decisione: Controllo B/);
  await b.focus();
  const primaB = await pannello.getByText(/decisione_3 · /).textContent();
  await b.press("ArrowDown");
  await expect(pannello.getByText(/decisione_3 · /)).not.toHaveText(primaB!);
  const a = nodo(page, /^Decisione: Controllo A/);
  const box = (await a.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  // due caselle più in basso (la riga sotto è occupata da «Fallito»): il nodo salta di casella e si aggancia
  const altezzaCasella = 148;
  await page.mouse.move(box.x + box.width / 2, box.y + 12 + 2 * altezzaCasella, { steps: 10 });
  await page.mouse.up();
  await nodo(page, /^Decisione: Controllo A/).click();
  await expect(pannello.getByText(/decisione_2 · 3,4/)).toBeVisible();

  // salvataggio quando la validazione dell'API non segnala più nulla
  await expect(editor.getByText("Nessun errore: si può salvare")).toBeVisible({ timeout: 10_000 });
  await barra.getByRole("button", { name: "Salva" }).click();
  await expect(page.getByText(`RdA di prova ${suffix}`)).toBeVisible();

  // processo dalla scheda Processi
  await page.goto(`/progetti/${projectId}/processi`);
  await page.getByRole("button", { name: "Nuovo processo" }).click();
  const dialogo = page.getByRole("dialog", { name: "Nuovo processo" });
  await dialogo.getByLabel("Modello").click();
  await page.getByRole("option", { name: new RegExp(`RdA di prova ${suffix}`) }).click();
  await dialogo.getByLabel("Titolo").fill(`RdA ${suffix} – Ponteggi`);
  await dialogo.getByRole("button", { name: "Avvia" }).click();
  await page.waitForURL(/\/istanze\//);
  await expect(page.getByRole("heading", { name: `RdA ${suffix} – Ponteggi` })).toBeVisible();
  await expect(nodo(page, /^Decisione: Verifica tecnica, in corso/)).toBeVisible();

  // compito dalla posta: pulsante dell'esito libero del nodo
  await page.getByRole("link", { name: "Svolgi il tuo compito" }).click();
  await page.getByRole("button", { name: "Approvato", exact: true }).click();
  await page.getByRole("button", { name: "Conferma esito" }).click();
  await expect(page.getByRole("button", { name: "Conferma esito" })).toBeHidden();

  // vista finale: verifica verde, i due rami paralleli gialli, le fini non raggiunte
  const id = (await (await admin.get(`/api/projects/${projectId}/processes`)).json())
    .find((p: { title: string }) => p.title === `RdA ${suffix} – Ponteggi`).id;
  await page.goto(`/istanze/${id}`);
  await expect(nodo(page, /^Decisione: Verifica tecnica, fatto/)).toBeVisible();
  await expect(nodo(page, /^Decisione: Controllo A, in corso/)).toBeVisible();
  await expect(nodo(page, /^Decisione: Controllo B, in corso/)).toBeVisible();
  await expect(nodo(page, /^Fine: Concluso, non raggiunto/)).toBeVisible();
  // clic su un nodo: giri e compiti nel pannello
  await nodo(page, /^Decisione: Verifica tecnica/).click();
  const dettaglio = page.getByRole("complementary", { name: "Dettaglio del nodo" });
  await expect(dettaglio.getByText("Approvato").first()).toBeVisible();
});
