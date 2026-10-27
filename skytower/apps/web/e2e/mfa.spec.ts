// "><(((º> sabusabu <º)))><"
// Verifica in due passaggi: attivazione dell'app di autenticazione dalla pagina Sicurezza, recovery code,
// poi il login chiede il codice. Il TOTP è calcolato come farebbe l'app (helpers.totp).
import { expect, test } from "@playwright/test";
import { loginUi, PASSWORD, totp } from "./helpers";

const USER = "sub1.viewer@sub1.example";

test("attivazione dell'MFA e login con codice", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await loginUi(page, USER);
  await page.goto("/sicurezza");
  await page.getByRole("button", { name: "Aggiungi app di autenticazione" }).click();
  const secret = (await page.locator("span.MuiTypography-caption").filter({ hasText: /^[A-Z2-7]{16,}$/ }).innerText()).trim();
  const enrolledWindow = Math.floor(Date.now() / 30_000);
  await page.getByLabel("Codice a 6 cifre").fill(totp(secret));
  await page.getByRole("button", { name: "Conferma" }).click();
  await expect(page.getByRole("button", { name: "Fatto" })).toBeVisible();     // recovery code mostrati una volta
  await page.getByRole("button", { name: "Fatto" }).click();

  // un codice già usato non vale due volte: si aspetta la finestra successiva
  while (Math.floor(Date.now() / 30_000) <= enrolledWindow) await page.waitForTimeout(1000);

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/login");
  await p.getByLabel("Email").fill(USER);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: "Accedi" }).click();
  await expect(p.getByText("Verifica in due passaggi")).toBeVisible();
  await p.getByLabel("Codice").fill("000000");
  await p.getByRole("button", { name: "Verifica" }).click();
  await expect(p).toHaveURL(/\/login/);                                         // codice sbagliato: si resta qui
  await p.getByLabel("Codice").fill(totp(secret));
  await p.getByRole("button", { name: "Verifica" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ctx.close();
});
