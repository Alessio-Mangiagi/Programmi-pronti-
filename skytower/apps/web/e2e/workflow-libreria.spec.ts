// "><(((º> sabusabu <º)))><"
// Libreria workflow dell'organizzazione (ADR-50, docs/workflow-grafo.md §5), dal disegno all'uso in una commessa:
// - l'amministratore dell'organizzazione (com.admin, COM) apre "Libreria workflow", disegna un processo con l'editor a
//   scacchiera: fra gli assegnatari non c'è "Persona", solo ruoli; salva quando la validazione non segnala errori;
// - nella commessa PRJ01 (di proprietà della COM) la scheda Workflow mostra il modello nella sezione "Dalla libreria
//   dell'organizzazione", col bollino Libreria;
// - dalla scheda Processi il modello compare col bollino "Libreria" e si avvia: la vista finale si apre;
// - "Copia nella commessa" ne fa un modello del progetto (la libreria resta com'è).
// Alla fine il modello di libreria si disattiva via API, per non comparire negli altri test su PRJ01.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

const nodo = (page: Page, testo: RegExp) => page.getByRole("button", { name: testo });

async function scegliRuolo(pannello: Locator, page: Page) {
  await pannello.getByLabel("Ruolo", { exact: true }).first().click();
  await page.getByRole("option", { name: /PROJECT_ADMIN/ }).click();
}

test("libreria workflow: l'admin dell'organizzazione disegna, la commessa avvia il processo e ne fa una copia", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(admin, () => true);
  const suffix = String(Date.now() % 100_000);
  const nome = `RdA di libreria ${suffix}`;
  const codice = `E2E_LIB_${suffix}`;

  try {
    // 1. libreria dell'organizzazione: nuovo modello, assegnatari solo per ruolo
    await loginUi(page, "com.admin@com.example");
    await page.goto("/organizzazione/workflow");
    await expect(page.getByRole("heading", { name: "Libreria workflow" })).toBeVisible();
    await page.getByRole("button", { name: "Nuovo workflow" }).click();
    const editor = page.getByRole("dialog", { name: "Nuovo workflow di libreria" });
    const barra = editor.locator("header");
    await barra.getByLabel("Codice").fill(codice);
    await barra.getByLabel("Nome").fill(nome);
    await barra.getByRole("button", { name: "Processi" }).click();
    const pannello = editor.getByRole("complementary", { name: "Proprietà" });
    await nodo(page, /^Decisione: Nuova decisione/).click();
    await pannello.getByLabel("Nome").fill("Approvazione RdA");
    // il tipo di assegnatario non offre la persona: in libreria valgono solo i ruoli
    await pannello.getByLabel("Tipo", { exact: true }).first().click();
    await expect(page.getByRole("option", { name: "Ruolo nella commessa" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Persona" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // finché il ruolo non è scelto l'errore è sul nodo, in italiano
    await expect(editor.getByText("«Approvazione RdA»: scegliere il ruolo dell'assegnatario")).toBeVisible({ timeout: 10_000 });
    await scegliRuolo(pannello, page);
    await expect(editor.getByText("Nessun errore: si può salvare")).toBeVisible({ timeout: 10_000 });
    await barra.getByRole("button", { name: "Salva" }).click();
    await expect(page.getByText(nome)).toBeVisible();

    // 2. la commessa della COM lo vede nella scheda Workflow, sezione della libreria
    await page.goto(`/progetti/${projectId}/workflow`);
    await expect(page.getByRole("heading", { name: "Dalla libreria dell'organizzazione" })).toBeVisible();
    // schede dei modelli: i Paper con il pulsante "Apri" (non gli avvisi, che sono Paper anch'essi)
    const schedeModello = page.locator(".MuiPaper-root").filter({ has: page.getByRole("button", { name: "Apri", exact: true }) });
    // bollino "Libreria" esatto (il nome stesso contiene "libreria" e hasText non distingue le maiuscole)
    const schedaLibreria = schedeModello.filter({ hasText: nome })
      .filter({ has: page.locator(".MuiChip-root", { hasText: /^Libreria$/ }) });
    await expect(schedaLibreria).toHaveCount(1);

    // 3. processo dalla scheda Processi: il modello ha il bollino Libreria
    await page.goto(`/progetti/${projectId}/processi`);
    await page.getByRole("button", { name: "Nuovo processo" }).click();
    const dialogo = page.getByRole("dialog", { name: "Nuovo processo" });
    await dialogo.getByLabel("Modello").click();
    const voce = page.getByRole("option", { name: new RegExp(nome) });
    await expect(voce).toContainText("Libreria");
    await voce.click();
    await expect(dialogo.getByText(/Dalla libreria di/)).toBeVisible();
    await dialogo.getByLabel("Titolo").fill(`RdA ${suffix} – da libreria`);
    await dialogo.getByRole("button", { name: "Avvia" }).click();
    await page.waitForURL(/\/istanze\//);
    await expect(page.getByRole("heading", { name: `RdA ${suffix} – da libreria` })).toBeVisible();
    await expect(nodo(page, /^Decisione: Approvazione RdA, in corso/)).toBeVisible();

    // 4. copia locale nella commessa: diventa un modello del progetto, la libreria resta
    await page.goto(`/progetti/${projectId}/workflow`);
    await schedaLibreria.getByRole("button", { name: "Copia nella commessa" }).click();
    const copia = page.getByRole("dialog", { name: "Copia nella commessa" });
    await copia.getByRole("button", { name: "Copia" }).click();
    await expect(page.getByText(new RegExp(`Copiato nella commessa «${nome}»`))).toBeVisible();
    await expect(schedeModello.filter({ hasText: nome })).toHaveCount(2);
    await expect(schedaLibreria).toHaveCount(1);
  } finally {
    // il modello di libreria si disattiva: gli altri test su PRJ01 contano solo i modelli della commessa
    const lib = await (await admin.get("/api/me")).json();
    const modelli = await (await admin.get(`/api/organizations/${lib.organization_id}/workflow-library`)).json();
    for (const m of modelli.filter((x: { code: string }) => x.code === codice))
      await admin.patch(`/api/workflow-library/${m.id}`, { data: { is_active: false } });
  }
});
