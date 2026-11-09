// "><(((º> sabusabu <º)))><"
// Timbri sui PDF (ADR-56): dalla scheda "Timbri" si crea un timbro da un'immagine con lo sfondo bianco (scontornato
// come in Timbri per VFP, anteprima a scacchi), poi nel visualizzatore "Timbra" lo si mette sulla pagina, lo si
// sposta e si salva: nasce la revisione P01.02 in WIP con il timbro e la didascalia "Timbrato da …", e il registro
// attività del Project Admin ha l'evento REVISION_STAMPED con chi, quale timbro e da quale revisione.
// Con CDE_SCREENSHOT_DIR il test salva lì le schermate per la guida utente (altrimenti nessuna).
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiAs, loginUi, openInTab, projectAndFolder, uploadPdf } from "./helpers";

const SHOTS = process.env.CDE_SCREENSHOT_DIR;
async function shot(target: Page | Locator, name: string) {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 500));          // animazioni di dialog e immagini finite
  await target.screenshot({ path: join(SHOTS, name), animations: "disabled" });
}

/** Un timbro "APPROVATO" rosso su carta bianca, disegnato nel browser (PNG come da scanner o da foto). */
async function immagineTimbro(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 420;
    c.height = 160;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fbfaf6";                              // carta, non bianco puro
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#c62828";
    g.lineWidth = 10;
    g.strokeRect(20, 20, 380, 120);
    g.fillStyle = "#c62828";
    g.font = "bold 58px Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("APPROVATO", 210, 82);
    return c.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test("timbro creato dalla libreria, messo sul PDF e salvato come nuova revisione", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");

  // 1. libreria: nuovo timbro personale con lo sfondo scontornato
  await page.goto(`/progetti/${projectId}/timbri`);
  await expect(page.getByRole("heading", { name: "Timbri" })).toBeVisible();
  await page.getByRole("button", { name: "Nuovo timbro" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo timbro" });
  await dialog.getByLabel("Immagine del timbro").setInputFiles({ name: "approvato-des.png", mimeType: "image/png",
                                                                  buffer: await immagineTimbro(page) });
  await expect(dialog.getByLabel("Nome")).toHaveValue("approvato-des");
  await dialog.getByLabel("Nome").fill("Approvato Des Lead");
  await expect(dialog.getByRole("img", { name: "Come sarà il timbro" })).toBeVisible();
  // l'organizzazione e la commessa non sono sue: le scelte ci sono ma spente
  await expect(dialog.getByRole("radio", { name: /Della commessa/ })).toBeDisabled();
  await shot(dialog, "05-timbro-nuovo.png");
  await dialog.getByRole("button", { name: "Crea il timbro" }).click();
  await expect(dialog).toBeHidden();
  const scheda = page.getByLabel("Timbro Approvato Des Lead");
  await expect(scheda.getByRole("img", { name: "Anteprima di Approvato Des Lead" })).toBeVisible();
  await shot(page, "05-timbri-libreria.png");

  // 2. un PDF da timbrare, aperto nel visualizzatore
  const doc = await uploadPdf(page, des, projectId, folderId, "PRJ01-DES-ZZ-02-DR-A-0856.pdf", "Pianta piano secondo e2e",
                              ["Pianta piano secondo", "Scala 1:50"]);
  await page.reload();
  const tab = await openInTab(page, () => page.getByText("Pianta piano secondo e2e").dblclick());
  const pagina = tab.locator('[data-page="1"]');
  await expect(pagina.locator("canvas")).toBeVisible({ timeout: 15_000 });

  // 3. Timbra: si sceglie il timbro, un clic sulla pagina lo mette lì, lo si sposta trascinandolo
  await tab.getByRole("button", { name: "Timbra", exact: true }).click();
  const pannello = tab.getByRole("region", { name: "Timbra il documento" });
  await pannello.getByRole("option", { name: /Approvato Des Lead/ }).click();
  const box = (await pagina.boundingBox())!;
  // a metà altezza: la pagina al 147% è più alta della finestra, un clic più in basso cadrebbe fuori
  await tab.mouse.click(box.x + box.width * 0.70, box.y + box.height * 0.55);
  const timbro = tab.getByRole("img", { name: "Timbro Approvato Des Lead sulla pagina 1" });
  await expect(timbro).toBeVisible();
  const t = (await timbro.boundingBox())!;
  await tab.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(t.x + t.width / 2 - box.width * 0.05, t.y + t.height / 2 - box.height * 0.03, { steps: 5 });
  await tab.mouse.up();
  await expect(pannello.getByText("Pagina 1 · Approvato Des Lead")).toBeVisible();
  await pannello.getByLabel("Nota per la revisione (facoltativa)").fill("Approvazione interna");
  await shot(tab, "05-timbra-pdf.png");
  await pannello.getByRole("button", { name: "Salva come nuova revisione" }).click();

  // 4. nasce la P01.02 in WIP con il timbro; il visualizzatore passa da solo alla revisione nuova
  await expect(tab.getByRole("combobox", { name: /^Revisione/ })).toContainText("P01.02", { timeout: 15_000 });
  await expect.poll(async () => (await (await des.get(`/api/documents/${doc.id}`)).json()).current_revision).toBe("P01.02");
  const nuova = (await (await des.get(`/api/documents/${doc.id}`)).json()).revisions[0];
  expect(nuova.state).toBe("WIP");
  expect(nuova.comment).toContain("Timbrata in piattaforma (Approvato Des Lead) a partire dalla P01.01");
  await expect(pagina.locator("canvas")).toBeVisible({ timeout: 30_000 });     // antivirus finito, PDF timbrato aperto
  await shot(tab, "05-timbro-revisione.png");

  // il PDF scaricato ha la didascalia con chi ha timbrato
  await expect.poll(async () => (await des.get(`/api/revisions/${nuova.id}/download`)).status(), { timeout: 30_000 }).toBe(200);
  const url = (await (await des.get(`/api/revisions/${nuova.id}/download`)).json()).url as string;
  const pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  // 5. il registro attività dice chi ha timbrato, con quale timbro, da quale revisione
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const eventi = await (await admin.get(`/api/projects/${projectId}/audit`, { params: { event_type: "REVISION_STAMPED" } })).json();
  const ev = eventi.find((e: { details: { revision: string } }) => e.details.revision === nuova.id);
  expect(ev.details.from_code).toBe("P01.01");
  expect(ev.details.stamps.map((s: { name: string }) => s.name)).toEqual(["Approvato Des Lead"]);
  expect(ev.details.caption).toMatch(/^Timbrato da Des Lead il \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});
