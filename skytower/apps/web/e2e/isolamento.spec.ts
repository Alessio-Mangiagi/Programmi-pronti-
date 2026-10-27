// "><(((º> sabusabu <º)))><"
// Isolamento dal browser e uso da tablet: un link copiato verso dati altrui non rivela nulla; su tablet
// cartelle e viewer restano utilizzabili.
import { devices, expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("un link a una cartella altrui non mostra nulla", async ({ page, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Calcoli interni");
  await loginUi(page, "sub1.user@sub1.example");
  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  await expect(page.getByText("Cartella non trovata o non visibile.")).toBeVisible();
  await expect(page.getByText("Calcoli interni")).toHaveCount(0);
  await page.goto("/progetti/00000000-0000-4000-8000-000000000000/cartelle");
  await expect(page.getByText("Progetto non trovato")).toBeVisible();
});

test.describe("tablet", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPad (gen 7)"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("cartella e viewer PDF su tablet", async ({ page, baseURL }) => {
    const api = await apiAs(baseURL, "com.admin@com.example");
    const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
    await loginUi(page, "com.admin@com.example");
    await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0960.pdf", "Verbale tablet e2e", ["Verbale di cantiere"]);
    await page.reload();
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);  // niente scroll orizzontale
    await page.getByText("Verbale tablet e2e").dblclick();
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Annota", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chiudi" }).last()).toBeInViewport();
  });
});
