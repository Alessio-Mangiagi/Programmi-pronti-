// "><(((º> sabusabu <º)))><"
// Naming per cartella: dalla scheda Naming il Project Admin crea uno schema per cartelle e lo applica alle cartelle
// scelte nell'albero del popup (con le sottocartelle); chi carica in quelle cartelle usa quello schema, le altre
// restano sullo schema della commessa.
import { expect, test } from "@playwright/test";
import { apiAs, loginUi, projectAndFolder } from "./helpers";

test("schema per cartelle applicato dall'albero nel popup", async ({ page, baseURL }) => {
  const admin = await apiAs(baseURL, "com.admin@com.example");
  const des = await apiAs(baseURL, "des.lead@des.example");
  const { projectId, folderId } = await projectAndFolder(des, (n) => n === "Tavole architettoniche");
  const other = (await projectAndFolder(admin, (n) => n.startsWith("COM"))).folderId;
  const name = `Foto e2e ${Date.now() % 10_000}`;
  let profileId: string | undefined;
  try {
    await loginUi(page, "com.admin@com.example");
    await page.goto(`/progetti/${projectId}/naming`);
    await page.getByRole("button", { name: "Nuovo schema per cartelle" }).click();
    await page.getByLabel("Nome (es. Foto di cantiere)").fill(name);
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    // il popup si apre subito: spuntando la radice DES si spuntano anche le sottocartelle
    const dialog = page.getByRole("dialog", { name: `Applica «${name}» alle cartelle` });
    const tree = dialog.getByRole("tree", { name: "Cartelle della commessa" });
    await tree.getByRole("checkbox", { name: "DES - Progetto architettonico", exact: true }).check();
    await tree.getByRole("button", { name: "Apri DES - Progetto architettonico" }).click();
    await expect(tree.getByRole("checkbox", { name: "Tavole architettoniche", exact: true })).toBeChecked();
    await expect(dialog.getByText(/\d+ cartelle/)).toBeVisible();
    await dialog.getByRole("button", { name: "Applica", exact: true }).click();
    await expect(dialog).toBeHidden();

    const profiles = await (await admin.get(`/api/projects/${projectId}/naming-profiles`)).json();
    const created = profiles.find((p: { name: string }) => p.name === name);
    profileId = created.id;
    expect(created.container_ids).toContain(folderId);
    expect(created.container_ids).not.toContain(other);
    const section = page.getByRole("region", { name: "Schemi di naming" });
    await expect(section.getByRole("tab", { name: new RegExp(name) })).toHaveAttribute("aria-selected", "true");
    await expect(section.getByText("Applicato a:")).toBeVisible();

    // chi carica in una cartella con lo schema lo vede nel dialog; nelle altre resta quello della commessa
    expect((await (await des.get(`/api/containers/${folderId}/naming`)).json()).profile.name).toBe(name);
    expect((await (await admin.get(`/api/containers/${other}/naming`)).json()).profile).toBeNull();
    await page.context().clearCookies();
    await loginUi(page, "des.lead@des.example");
    await page.goto(`/progetti/${projectId}/cartelle/${folderId}`);
    await page.getByRole("button", { name: "Carica" }).first().click();
    await expect(page.getByRole("dialog").getByText(name)).toBeVisible();
  } finally {
    if (profileId) await admin.delete(`/api/naming-profiles/${profileId}`);
  }
});
