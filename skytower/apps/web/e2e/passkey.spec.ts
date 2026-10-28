// "><(((º> sabusabu <º)))><"
// Chiave di sicurezza (WebAuthn) come secondo fattore: registrazione dal profilo e login, con l'autenticatore
// virtuale di Chromium (DevTools Protocol) al posto di una chiave fisica. Utente dedicato: dopo questo test
// il suo login chiede la chiave.
import { expect, test } from "@playwright/test";
import { loginUi } from "./helpers";

const EMAIL = "gc.admin@gco.example";

test("chiave di sicurezza: registrazione dal profilo e accesso", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "usb", hasResidentKey: true, hasUserVerification: true,
               isUserVerified: true, automaticPresenceSimulation: true },
  });

  await loginUi(page, EMAIL);
  await page.goto("/sicurezza");
  const keys = page.getByRole("region", { name: "Chiavi di sicurezza e passkey" });
  await keys.getByLabel("Nome della chiave").fill("YubiKey e2e");
  await keys.getByRole("button", { name: "Aggiungi chiave di sicurezza" }).click();
  await expect(page.getByText("Nuovi recovery code")).toBeVisible();      // primo fattore: nascono i recovery code
  await expect(page.getByText("YubiKey e2e (chiave di sicurezza)")).toBeVisible();
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].rpId).toBe("localhost");

  // nuovo accesso: dopo la password basta la chiave
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("Cantiere-2026!");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.getByText("Usa la chiave di sicurezza o la passkey registrata")).toBeVisible();
  await page.getByRole("button", { name: "Usa la chiave di sicurezza" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const after = (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials[0];
  expect(after.signCount).toBeGreaterThan(credentials[0].signCount);
});
