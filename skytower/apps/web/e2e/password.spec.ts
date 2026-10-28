// "><(((º> sabusabu <º)))><"
// Pagina Sicurezza: sessioni aperte su due dispositivi (chiusura dell'altra) e cambio password con ritorno a
// quella demo, così gli altri test non ne risentono.
import { expect, test } from "@playwright/test";
import { loginUi } from "./helpers";

const USER = "des.designer@des.example";
const DEMO = "Cantiere-2026!";
const NEW = "Ponteggio-Est-2027";

test("sessioni aperte e cambio password", async ({ page, browser }) => {
  const other = await browser.newContext();
  const phone = await other.newPage();
  await loginUi(phone, USER);
  await loginUi(page, USER);
  await page.goto("/sicurezza");

  const sessions = page.getByRole("region", { name: "Sessioni aperte" });
  await expect(sessions.getByText("Questo dispositivo")).toBeVisible();
  // almeno l'altro dispositivo (altri test possono aver lasciato sessioni dello stesso utente)
  await expect(sessions.getByRole("button", { name: /^Chiudi la sessione/ }).first()).toBeVisible();
  await sessions.getByRole("button", { name: "Esci da tutti gli altri dispositivi" }).click();
  await expect(sessions.getByRole("button", { name: /^Chiudi la sessione/ })).toHaveCount(0);
  // l'altro dispositivo, al primo rinnovo, torna al login
  await phone.reload();
  await expect(phone).toHaveURL(/\/login/);

  const pwd = page.getByRole("region", { name: "Password" });
  const change = async (from: string, to: string) => {
    await pwd.getByLabel("Password attuale").fill(from);
    await pwd.getByLabel("Nuova password", { exact: false }).first().fill(to);
    await pwd.getByLabel("Ripeti la nuova password").fill(to);
    await pwd.getByRole("button", { name: "Cambia password" }).click();
  };
  await change("sbagliata", NEW);
  await expect(pwd.getByText("La password attuale non è corretta")).toBeVisible();
  await change(DEMO, NEW);
  await expect(pwd.getByText(/^Password cambiata/)).toBeVisible();
  await change(NEW, DEMO);                       // si torna alla password demo
  await expect(pwd.getByText(/^Password cambiata/)).toBeVisible();
  await other.close();
});
