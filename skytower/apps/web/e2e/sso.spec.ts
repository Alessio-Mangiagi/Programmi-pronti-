// "><(((º> sabusabu <º)))><"
// Single sign-on OpenID Connect: l'admin di OUT lo configura dalla pagina Organizzazione contro l'IdP finto
// (e2e/mock-idp.mjs), poi entra con l'account aziendale; con l'obbligo attivo la password porta all'IdP.
import { expect, test } from "@playwright/test";
import { IDP_PORT } from "../playwright.config";
import { loginUi } from "./helpers";

const ADMIN = "out.user@out.example";

test("configurazione dell'SSO e accesso con l'account aziendale", async ({ page, context }) => {
  await loginUi(page, ADMIN);
  await page.goto("/organizzazione");
  const sso = page.getByRole("region", { name: "Single sign-on" });
  await expect(sso.getByText("/api/auth/sso/callback")).toBeVisible();
  await sso.getByRole("button", { name: "Configura il single sign-on" }).click();
  await sso.getByLabel("Issuer").fill(`http://127.0.0.1:${IDP_PORT}`);
  await sso.getByLabel("Client ID").fill("cde-out");
  await sso.getByLabel("Domini email").fill("out.example");
  await sso.getByRole("button", { name: "Salva" }).click();
  await expect(sso.getByText("Single sign-on salvato")).toBeVisible();
  await sso.getByRole("button", { name: "Prova la connessione" }).click();
  await expect(sso.getByText(`Il provider risponde (accesso su 127.0.0.1:${IDP_PORT})`)).toBeVisible();

  // nuovo accesso dal pulsante SSO: l'IdP finto autentica subito e rimanda al CDE
  await context.clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Usa l'account aziendale (SSO)" }).click();
  await page.getByLabel("Email aziendale").fill(ADMIN);
  await page.getByRole("button", { name: "Continua" }).click();
  await page.waitForURL((u) => u.pathname === "/" && !u.hash.includes("sso"));
  await expect(page.getByRole("button", { name: "Il mio profilo" })).toBeVisible();

  // obbligo: la password non basta più, il login prosegue da solo verso l'IdP
  await page.goto("/organizzazione");
  await sso.getByRole("button", { name: "Modifica" }).click();
  await sso.getByLabel(/^Obbligatorio/).check();
  await sso.getByRole("button", { name: "Salva" }).click();
  await expect(sso.getByText("Password disattivata per gli utenti")).toBeVisible();
  await context.clearCookies();
  await loginUi(page, ADMIN);
  await expect(page.getByRole("button", { name: "Il mio profilo" })).toBeVisible();

  // un utente sconosciuto all'organizzazione torna al login con un messaggio chiaro
  await context.clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Usa l'account aziendale (SSO)" }).click();
  await page.getByLabel("Email aziendale").fill("estraneo@out.example");
  await page.getByRole("button", { name: "Continua" }).click();
  await expect(page.getByText(/non è abilitato al CDE/)).toBeVisible();
});
