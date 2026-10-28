// "><(((º> sabusabu <º)))><"
// Frecce Indietro / Avanti nella barra dell'app: si muovono tra le pagine visitate, la pagina di accesso non
// resta nella cronologia, Avanti si spegne quando si apre una pagina nuova.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("frecce indietro e avanti tra le pagine", async ({ page, baseURL }) => {
  const api = await apiAs(baseURL, "com.admin@com.example");
  const { projectId } = await projectAndFolder(api, (n) => n.startsWith("COM"));
  await loginUi(page, "com.admin@com.example");
  const back = page.getByRole("button", { name: "Indietro", exact: true });
  const forward = page.getByRole("button", { name: "Avanti", exact: true });
  await expect(back).toBeDisabled();                       // subito dopo l'accesso: niente login alle spalle
  await expect(forward).toBeDisabled();

  await page.goto(`/progetti/${projectId}/rfi`);
  await page.getByRole("tab", { name: "Transmittal" }).click();
  await expect(page).toHaveURL(/\/transmittal$/);
  await page.getByRole("tab", { name: "Workflow" }).click();
  await expect(page).toHaveURL(/\/workflow$/);

  await back.click();
  await expect(page).toHaveURL(/\/transmittal$/);
  await back.click();
  await expect(page).toHaveURL(/\/rfi$/);
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect(page).toHaveURL(/\/transmittal$/);
  // una pagina nuova da qui cancella l'"avanti"
  await page.getByRole("tab", { name: "Membri" }).click();
  await expect(page).toHaveURL(/\/membri$/);
  await expect(forward).toBeDisabled();
  await expect(back).toBeEnabled();
});
