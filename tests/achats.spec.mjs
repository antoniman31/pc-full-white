// Achats saisis sur la page : cases « Acheté », prix payé, budget recalculé, export / import.
// Les données sont figées (scraper/tests/fixtures) pour que les montants ne bougent pas avec les relevés.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const CPU = BASE.pc_components.find(c => c.id === "cpu");
const montant = async (loc) => Number((await loc.textContent()).replace(/[^\d,-]/g, "").replace(",", "."));

async function ouvrir(page, onglet = "pc") {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator(`.tab[data-target="${onglet}"]`).click();
}
const caseCPU = (page) => page.locator('[data-buy-toggle="cpu"]');

async function acheterCPU(page, prix, extra = {}) {
  await caseCPU(page).click();
  await page.locator("#paid-cpu").fill(String(prix));
  if (extra.vendor) await page.locator("#shop-cpu").fill(extra.vendor);
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
}

test("cocher un article ouvre le formulaire, puis enregistre l'achat et recalcule le budget", async ({ page }) => {
  await ouvrir(page);
  await page.locator('.tab[data-target="budget"]').click();
  const resteAvant = await montant(page.locator("#progress-cur"));
  const achatAvant = await montant(page.locator("#stat-bought"));
  const totalAvant = await montant(page.locator("#stat-total"));
  await page.locator('.tab[data-target="pc"]').click();

  await caseCPU(page).click();
  await expect(page.locator("#paid-cpu")).toBeFocused();
  await expect(page.locator("#paid-cpu")).toHaveValue(String(CPU.price));
  await page.locator("#shop-cpu").fill("TopAchat");
  await page.getByRole("button", { name: "Enregistrer l'achat" }).click();

  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".buy-meta", { hasText: "TopAchat" })).toContainText(`payé`);
  await expect(page.locator("#summary-pc")).toContainText("1 acheté");

  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(resteAvant - CPU.price, 0);
  expect(await montant(page.locator("#stat-bought"))).toBeCloseTo(achatAvant + CPU.price, 0);
  // Payer le prix relevé déplace l'argent du « reste » vers le « déjà acheté » : le total ne bouge pas.
  expect(await montant(page.locator("#stat-total"))).toBeCloseTo(totalAvant, 0);
  await expect(page.locator("#local-panel")).toContainText("1 article modifié ici");
});

test("le prix payé remplace le prix relevé dans le budget", async ({ page }) => {
  await ouvrir(page);
  await page.locator('.tab[data-target="budget"]').click();
  const totalAvant = await montant(page.locator("#stat-total"));
  await page.locator('.tab[data-target="pc"]').click();
  const paye = Math.round(CPU.price * 0.9);
  await acheterCPU(page, paye);
  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#stat-total"))).toBeCloseTo(totalAvant - CPU.price + paye, 0);
});

test("un prix payé très éloigné du prix relevé demande confirmation", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price * 10);
  await expect(page.locator("#buy-error")).toContainText("confirmer");
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Confirmer quand même" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmer quand même" }).click();
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");
});

test("corriger le prix après l'avertissement remet l'enregistrement normal", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price * 10);
  await page.locator("#paid-cpu").fill(String(CPU.price));
  await expect(page.getByRole("button", { name: "Enregistrer l'achat" })).toBeVisible();
});

test("un prix vide ou nul est refusé", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, 0);
  await expect(page.locator("#buy-error")).toContainText("supérieur à 0");
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "false");
});

test("décocher annule l'achat et rend l'article à acheter", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price);
  await caseCPU(page).click();
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#summary-pc")).toContainText("0 acheté");
  await page.locator('.tab[data-target="budget"]').click();
  await expect(page.locator("#local-panel")).toContainText("Coche « Acheté »");
});

test("l'achat survit à un rechargement et peut être modifié", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price, { vendor: "LDLC" });
  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—");
  await page.locator('.tab[data-target="pc"]').click();
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: /Modifier l'achat/ }).first().click();
  await expect(page.locator("#shop-cpu")).toHaveValue("LDLC");
  await page.locator("#shop-cpu").fill("Grosbill");
  await page.getByRole("button", { name: "Enregistrer l'achat" }).click();
  await expect(page.locator(".buy-meta", { hasText: "Grosbill" })).toBeVisible();
});

test("un article déjà acheté dans les données peut être décoché", async ({ page }) => {
  await ouvrir(page, "periph");
  const achete = BASE.peripherals.find(p => p.status === "bought");
  const bouton = page.locator(`[data-buy-toggle="${achete.id}"]`);
  await expect(bouton).toHaveAttribute("aria-checked", "true");
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await page.locator('.tab[data-target="periph"]').click();
  await expect(page.locator(`[data-buy-toggle="${achete.id}"]`)).toHaveAttribute("aria-checked", "false");
});

test("l'export puis l'import restituent les achats", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price, { vendor: "TopAchat" });
  await page.locator('.tab[data-target="budget"]').click();
  const [telechargement] = await Promise.all([page.waitForEvent("download"), page.locator("#local-export").click()]);
  const chemin = await telechargement.path();
  const contenu = JSON.parse(readFileSync(chemin, "utf-8"));
  expect(contenu.items.cpu).toMatchObject({ status: "bought", vendor: "TopAchat" });

  await page.locator("#local-reset").click();
  await page.locator("#local-reset").click(); // deuxième clic : confirmation
  await expect(page.locator("#local-panel")).toContainText("Coche « Acheté »");

  await page.locator("#local-import").setInputFiles(chemin);
  await expect(page.locator("#local-msg")).toContainText("1 article importé");
  await page.locator('.tab[data-target="pc"]').click();
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");
});

test("un fichier d'import qui n'est pas un export est refusé sans rien changer", async ({ page }) => {
  await ouvrir(page, "budget");
  await page.locator("#local-import").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"foo":1}') });
  await expect(page.locator("#local-msg")).toContainText("pas un export valide");
});

test("l'import ignore les entrées douteuses (id inconnu, prix négatif, __proto__)", async ({ page }) => {
  await ouvrir(page, "budget");
  const doc = { version: 1, items: { cpu: { status: "bought", paid: -5 }, "__proto__": { status: "bought", paid: 10 }, ssd: { status: "bought", paid: 100, vendor: "<b>x</b>" } } };
  await page.locator("#local-import").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator("#local-msg")).toContainText("1 article importé");
  await page.locator('.tab[data-target="pc"]').click();
  await expect(page.locator('[data-buy-toggle="ssd"]')).toHaveAttribute("aria-checked", "true");
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".buy-meta b")).toHaveCount(0); // le HTML saisi est échappé
});

test("le mobilier et les outils se cochent aussi", async ({ page }) => {
  await ouvrir(page, "mobilier");
  const m = BASE.mobilier.find(x => x.price > 0);
  await page.locator(`[data-buy-toggle="${m.id}"]`).click();
  await page.locator(`#paid-${m.id}`).fill(String(m.price));
  await page.getByRole("button", { name: "Enregistrer l'achat" }).click();
  await expect(page.locator(`[data-buy-toggle="${m.id}"]`)).toHaveAttribute("aria-checked", "true");
  const o = BASE.outils_bureau[0];
  await expect(page.locator(`[data-buy-toggle="${o.id}"]`)).toHaveAttribute("aria-checked", "false");
});

test("le récap de l'historique et la liste des achats suivent les coches", async ({ page }) => {
  await ouvrir(page);
  await acheterCPU(page, CPU.price);
  await page.locator('.tab[data-target="historique"]').click();
  await expect(page.locator("#bought-list")).toContainText(CPU.name);
});

test("la case Acheté se pilote au clavier et reste accessible", async ({ page }) => {
  await ouvrir(page);
  await caseCPU(page).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#paid-cpu")).toBeFocused();
  await page.keyboard.press("Enter"); // soumet le formulaire
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");
  await expect(caseCPU(page)).toBeFocused();
});
