// "><(((º> sabusabu <º)))><"
// Filigrana sui PDF: il Project Admin la attiva dalla scheda Naming; il PDF aperto nel visualizzatore e quello
// scaricato portano su ogni pagina chi li ha aperti (il testo della filigrana si trova con la ricerca).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf, openInTab } from "./helpers";

test("filigrana attivata dall'admin su visualizzatore e download", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  try {
    await loginUi(page, "com.admin@com.example");
    await page.goto(`/progetti/${projectId}/naming`);
    const panel = page.getByRole("region", { name: "Filigrana sui PDF" });
    await panel.getByLabel("Filigrana attiva").check();
    await panel.getByLabel("WIP (lavori in corso)").check();
    await panel.getByLabel("Riga aggiuntiva (facoltativa)").fill("Uso interno e2e");
    await panel.getByRole("button", { name: "Salva filigrana" }).click();
    await expect(panel.getByText("Filigrana salvata")).toBeVisible();
    const saved = await (await api.get(`/api/projects/${projectId}/watermark`)).json();
    expect(saved.watermark).toEqual({ states: ["WIP", "SHARED", "PUBLISHED"], text: "Uso interno e2e" });

    const doc = await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0990.pdf", "Verbale filigrana e2e",
      ["Verbale riservato"]);
    await page.reload();
    const tab = await openInTab(page, () => page.getByText("Verbale filigrana e2e").dblclick());
    await expect(tab.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
    await expect(tab.getByText("Filigranato")).toBeVisible();
    await tab.getByPlaceholder("Cerca nel testo").fill("Uso interno e2e");
    await expect(tab.getByText("1/1")).toBeVisible({ timeout: 10_000 });
    await tab.getByPlaceholder("Cerca nel testo").fill("Verbale riservato");
    await expect(tab.getByText("1/1")).toBeVisible();       // il contenuto originale resta

    const [download] = await Promise.all([tab.waitForEvent("download"), tab.getByRole("button", { name: "Scarica" }).click()]);
    expect(download.suggestedFilename()).toBe("PRJ01-COM-ZZ-00-RP-Z-0990.pdf");
    const pdf = readFileSync(await download.path()).toString("latin1");
    expect(pdf).toContain("/CDEWatermark (Scaricato da");
    expect(doc.current_state).toBe("WIP");
  } finally {
    await api.put(`/api/projects/${projectId}/watermark`, { data: null });
  }
});
