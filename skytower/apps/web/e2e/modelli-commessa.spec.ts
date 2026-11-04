// "><(((º> sabusabu <º)))><"
// Modelli di commessa dell'organizzazione (ADR-52), dal salvataggio all'uso e al file:
// - l'admin della COM marca un documento "di modello" in PRJ01 e fa "Salva come modello" dalla commessa;
// - nella pagina "Modelli di commessa" il modello c'è; "Nuova commessa da questo modello" apre il dialog "Nuovo
//   progetto" con "Parti da" già sul modello: la commessa nuova ha le cartelle e il documento di modello (P01.01);
// - "Scarica il modello" produce un .cdemodello; "Carica un modello da file" lo ricrea e mostra gli adattamenti.
// Alla fine i modelli creati si archiviano via API, per non comparire negli altri test.
// Con CDE_SCREENSHOT_DIR il test salva lì le schermate per la guida utente (altrimenti nessuna).
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

const SHOTS = process.env.CDE_SCREENSHOT_DIR;
async function shot(target: Page | Locator, name: string) {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 400));          // animazioni di menu e dialog finite
  await target.screenshot({ path: join(SHOTS, name) });
}

test("modelli di commessa: salva come modello, commessa dal modello, scarica e ricarica il file", async ({ page, baseURL }, info) => {
  test.setTimeout(180_000);
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(admin, (n) => n.startsWith("COM"));
  const suffix = String(Date.now() % 10_000).padStart(4, "0");
  const nome = `Modello e2e ${suffix}`;
  const codice = `M${suffix}`;
  const creati: string[] = [];

  try {
    await loginUi(page, "com.admin@com.example");
    const doc = await uploadPdf(page, admin, projectId, folderId, `PRJ01-COM-ZZ-00-SP-Z-9${suffix}.pdf`,
                                `Capitolato tipo e2e ${suffix}`, ["Capitolato tipo"]);
    expect((await admin.put(`/api/documents/${doc.id}/model`)).status()).toBe(204);

    // 1. "Salva come modello" dalla commessa: la commessa resta com'è
    await page.goto(`/progetti/${projectId}`);
    await page.getByRole("button", { name: "Modello", exact: true }).click();
    await shot(page, "01-menu-salva-come-modello.png");
    await page.getByRole("menuitem", { name: /Salva come modello/ }).click();
    const salva = page.getByRole("dialog", { name: "Salva come modello" });
    await salva.getByLabel("Nome del modello").fill(nome);
    await shot(salva, "02-dialog-salva-come-modello.png");
    await salva.getByRole("button", { name: "Salva il modello" }).click();
    await expect(salva.getByText(`Modello «${nome}» salvato`)).toBeVisible({ timeout: 30_000 });
    await expect(salva.getByText(/1 documenti di modello/)).toBeVisible();
    await shot(salva, "03-modello-salvato.png");
    await salva.getByRole("link", { name: "Vai ai modelli di commessa" }).click();

    // 2. pagina "Modelli di commessa" → nuova commessa dal modello
    await expect(page.getByRole("heading", { name: "Modelli di commessa" })).toBeVisible();
    const scheda = page.getByRole("article", { name: `Modello ${nome}`, exact: true });
    await expect(scheda).toBeVisible();
    await shot(page, "04-modelli-di-commessa.png");
    const modello = (await (await admin.get(`/api/organizations/${(await (await admin.get("/api/me")).json()).organization_id}/project-models`)).json())
      .find((m: { name: string }) => m.name === nome);
    creati.push(modello.id);
    // il modello non è fra i progetti
    expect((await (await admin.get("/api/me/projects")).json()).some((p: { id: string }) => p.id === modello.id)).toBe(false);
    if (SHOTS) {
      // il modello aperto, con la barra "Modello di commessa", e le sue persone
      await page.goto(`/progetti/${modello.id}/cartelle`);
      await expect(page.getByRole("region", { name: "Modello di commessa" })).toBeVisible();
      await shot(page, "05-modello-aperto.png");
      await page.goto(`/progetti/${modello.id}/membri`);
      await expect(page.getByText(/Persone del modello \(/)).toBeVisible();
      await shot(page, "06-persone-del-modello.png");
      // "Nuovo progetto" dall'elenco dei progetti: "Parti da" con i modelli in cima
      await page.goto("/");
      await page.getByRole("button", { name: "Nuovo progetto" }).click();
      await page.getByRole("dialog", { name: "Nuovo progetto" }).getByLabel("Parti da").click();
      await expect(page.getByRole("option", { name: nome })).toBeVisible();
      await shot(page, "07-parti-da-elenco.png");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.goto("/organizzazione/modelli");
    }
    await scheda.getByRole("button", { name: "Nuova commessa da questo modello" }).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo progetto" });
    await expect(dialog.getByText(/Dal modello: \d+ cartelle/)).toBeVisible();
    await dialog.getByLabel("Codice progetto (ISO 19650)").fill(codice);
    await dialog.getByLabel("Nome", { exact: true }).fill(`Commessa dal modello e2e ${suffix}`);
    await dialog.getByRole("checkbox", { name: /Anche le organizzazioni partecipanti/ }).check();
    await shot(dialog, "08-nuovo-progetto-dal-modello.png");
    await dialog.getByRole("button", { name: "Crea" }).click();
    await expect(page).toHaveURL(/\/progetti\/[0-9a-f-]{36}/);
    await shot(page, "09-commessa-dal-modello.png");
    const nuova = (await (await admin.get("/api/projects")).json()).find((p: { code: string }) => p.code === codice);
    const docs = (await (await admin.get(`/api/projects/${nuova.id}/documents`)).json()).items as { identifier: string; current_revision: string }[];
    expect(docs).toHaveLength(1);
    expect(docs[0].identifier.startsWith(`${codice}-COM-`)).toBe(true);
    expect(docs[0].current_revision).toBe("P01.01");

    // 3. "Scarica il modello" e "Carica un modello da file"
    await page.goto("/organizzazione/modelli");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("article", { name: `Modello ${nome}`, exact: true }).getByRole("button", { name: "Scarica il modello" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.cdemodello$/);
    const file = info.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await page.getByRole("button", { name: "Carica un modello da file" }).click();
    const carica = page.getByRole("dialog", { name: "Carica un modello da file" });
    await carica.locator('input[type="file"]').setInputFiles(file);
    await carica.getByLabel("Nome del modello (facoltativo)").fill(`${nome} (da file)`);
    await shot(carica, "10-carica-un-modello-da-file.png");
    await carica.getByRole("button", { name: "Carica", exact: true }).click();
    await expect(carica.getByText(`Modello «${nome} (da file)» caricato`)).toBeVisible({ timeout: 30_000 });
    await expect(carica.getByText("Cose adattate")).toBeVisible();
    await shot(carica, "11-adattamenti-dopo-il-caricamento.png");
    if (SHOTS) {
      await carica.getByRole("button", { name: "Chiudi" }).click();
      await page.getByRole("article", { name: `Modello ${nome}`, exact: true }).getByRole("button", { name: "Scarica il modello" }).hover();
      await shot(page, "12-scarica-il-modello.png");
    }
    const ricaricato = (await (await admin.get(`/api/organizations/${(await (await admin.get("/api/me")).json()).organization_id}/project-models`)).json())
      .find((m: { name: string }) => m.name === `${nome} (da file)`);
    creati.push(ricaricato.id);
    expect([ricaricato.folders, ricaricato.documents, ricaricato.workflows]).toEqual([modello.folders, modello.documents, modello.workflows]);
  } finally {
    for (const id of creati) await admin.patch(`/api/projects/${id}`, { data: { status: "ARCHIVED" } });
  }
});
