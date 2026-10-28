// "><(((º> sabusabu <º)))><"
// Regressioni di layout: ogni scheda della commessa e ogni pagina personale, su desktop e su tablet,
// senza scroll orizzontale (sintomo tipico di tabelle o barre comandi che sbordano).
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

const TABS = ["cartelle", "documenti", "riservate", "rfi", "transmittal", "workflow", "membri", "organizzazioni", "ruoli",
              "naming", "cruscotto", "registro"];

for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["tablet", { width: 820, height: 1180 }]] as const) {
  test(`nessuno scroll orizzontale (${label})`, async ({ page, baseURL }) => {
    const api = await apiAs(baseURL, "com.admin@com.example");
    const { projectId } = await projectAndFolder(api, () => true);
    await page.setViewportSize(viewport);
    await loginUi(page, "com.admin@com.example");
    const pages = [...TABS.map((t) => `/progetti/${projectId}/${t}`), "/", "/compiti", "/sicurezza", "/organizzazione"];
    const overflowing: string[] = [];
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (extra > 1) overflowing.push(`${path}: +${extra}px`);
    }
    expect(overflowing).toEqual([]);
  });
}
