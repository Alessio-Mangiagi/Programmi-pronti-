// "><(((º> sabusabu <º)))><"
// Ricerca nel contenuto: una parola che c'è solo nel testo del PDF si trova con "anche nel testo dei file",
// con l'estratto evidenziato; senza l'opzione la ricerca resta su titolo e codice.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("ricerca nel testo dei PDF", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0997.pdf", "Verbale sopralluogo e2e",
                  ["Filare di ippocastani lungo il confine nord"]);
  await page.goto(`/progetti/${projectId}/documenti`);
  const search = page.getByRole("main").getByPlaceholder("Cerca");
  await search.fill("ippocastani");
  await expect(page.getByText("Nessun documento in quest'area.")).toBeVisible();
  await page.getByLabel("anche nel testo dei file").check();
  await expect(page.getByRole("cell", { name: /Verbale sopralluogo e2e/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("mark", { hasText: /ippocastan/i })).toBeVisible();
});
