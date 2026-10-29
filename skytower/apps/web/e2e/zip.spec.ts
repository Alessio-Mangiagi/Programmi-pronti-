// "><(((º> sabusabu <º)))><"
// Download multiplo: tutta la cartella in uno ZIP con elenco.csv; dalle Aree CDE solo i documenti selezionati.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder, uploadPdf } from "./helpers";

test("cartella e selezione scaricate in ZIP", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId, folderId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  const doc = await uploadPdf(page, api, projectId, folderId, "PRJ01-COM-ZZ-00-RP-Z-0993.pdf", "Verbale ZIP e2e", ["Verbale per lo ZIP"]);

  await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
  const [folderZip] = await Promise.all([page.waitForEvent("download"),
    page.getByRole("button", { name: /^Scarica cartella \(\d+\)$/ }).click()]);
  expect(folderZip.suggestedFilename()).toMatch(/^PRJ01-documenti-\d{8}-\d{4}\.zip$/);
  const bytes = readFileSync(await folderZip.path()).toString("latin1");
  expect(bytes.startsWith("PK")).toBe(true);
  expect(bytes).toContain("PRJ01-COM-ZZ-00-RP-Z-0993.pdf");
  expect(bytes).toContain("elenco.csv");

  await page.goto(`/progetti/${projectId}/documenti`);
  await page.getByPlaceholder("Cerca").fill("0993");
  await page.getByLabel(`Seleziona ${doc.identifier}`).check();
  const [one] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Scarica ZIP (1)" }).click()]);
  const content = readFileSync(await one.path()).toString("latin1");
  expect(content).toContain("PRJ01-COM-ZZ-00-RP-Z-0993.pdf");
});
