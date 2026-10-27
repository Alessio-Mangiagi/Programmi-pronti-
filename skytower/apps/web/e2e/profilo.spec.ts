// "><(((º> sabusabu <º)))><"
// Profilo personale dal menu in alto a destra: dati anagrafici e preferenze delle notifiche, salvati e riletti.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi } from "./helpers";

test("modifica del proprio profilo e delle preferenze notifiche", async ({ page, baseURL }) => {
  await loginUi(page, "sub2.user@sub2.example");
  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await page.getByRole("menuitem", { name: "Modifica il mio profilo" }).click();
  const dialog = page.getByRole("dialog", { name: "Il mio profilo" });
  await dialog.getByLabel("Qualifica").fill("Capocantiere carpenterie");
  await dialog.getByLabel("Telefono").fill("+39 333 1234567");
  await dialog.getByLabel("Un solo riepilogo al giorno invece di un'email per ogni notifica").check();
  await dialog.getByRole("button", { name: "Salva" }).click();
  await expect(dialog).toBeHidden();

  const api = await apiAs(baseURL, "sub2.user@sub2.example");
  const me = await (await api.get("/api/me")).json();
  expect(me.job_title).toBe("Capocantiere carpenterie");
  expect(me.phone).toBe("+39 333 1234567");
  const prefs = await (await api.get("/api/me/notification-preferences")).json();
  expect(prefs.daily_digest).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Il mio profilo" }).click();
  await page.getByRole("menuitem", { name: "Modifica il mio profilo" }).click();
  await expect(page.getByRole("dialog", { name: "Il mio profilo" }).getByLabel("Qualifica")).toHaveValue("Capocantiere carpenterie");
});
