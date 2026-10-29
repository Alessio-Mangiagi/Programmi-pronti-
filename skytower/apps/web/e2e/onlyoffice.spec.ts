// "><(((º> sabusabu <º)))><"
// Modifica in piattaforma con OnlyOffice (ADR-37), con un Document Server finto (mock-onlyoffice.mjs): dal viewer di
// un Word in WIP "Modifica con OnlyOffice" apre l'editor in una nuova scheda (script del Document Server ammesso
// dalla CSP, configurazione firmata con la chiave = revisione); la callback di salvataggio, firmata col segreto
// condiviso, crea la WIP successiva.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { OFFICE_PORT, OFFICE_SECRET } from "../playwright.config";
import { apiAs, loginUi, openInTab, projectAndFolder, uploadFile } from "./helpers";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** JWT HS256 come lo firma il Document Server con il segreto condiviso. */
function signed(payload: object): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}`;
  return `${head}.${createHmac("sha256", OFFICE_SECRET).update(head).digest("base64url")}`;
}

test("Word modificato con OnlyOffice diventa la WIP successiva", async ({ page, baseURL }) => {
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  await loginUi(page, "des.lead@des.example");
  const doc = await uploadFile(page, des, projectId, folderId, { name: "PRJ01-DES-ZZ-ZZ-SP-A-0812.docx", mimeType: DOCX,
                               buffer: readFileSync(join(FIXTURES, "capitolato.docx")) }, "Relazione OnlyOffice e2e");
  await page.reload();
  const viewer = await openInTab(page, () => page.getByText("Relazione OnlyOffice e2e").dblclick());
  const editor = await openInTab(viewer, () => viewer.getByRole("button", { name: "Modifica con OnlyOffice" }).click());

  const region = editor.getByRole("region", { name: "Editor OnlyOffice" });
  await expect(region).toContainText("PRJ01-DES-ZZ-ZZ-SP-A-0812.docx (word)", { timeout: 15_000 });
  await expect(region).toHaveAttribute("data-key", doc.current_revision_id);
  await expect(editor.getByText(/modifica della P01\.01/)).toBeVisible();

  // il Document Server salva quando tutti hanno chiuso: la callback firmata porta il file nel CDE
  const user = await editor.evaluate(() => (window as unknown as { __onlyoffice: { editorConfig: { user: { id: string } } } })
    .__onlyoffice.editorConfig.user.id);
  const body = { key: doc.current_revision_id, status: 2, users: [user],
                 url: `http://127.0.0.1:${OFFICE_PORT}/cache/salvato.docx` };
  const res = await des.post(`/api/office/callback/${doc.current_revision_id}`, { data: { ...body, token: signed(body) } });
  expect(await res.json()).toEqual({ error: 0 });
  const after = await (await des.get(`/api/documents/${doc.id}`)).json();
  expect(after.current_revision).toBe("P01.02");
  expect(after.revisions.find((r: { revision_code: string }) => r.revision_code === "P01.02").comment).toContain("OnlyOffice");
});
