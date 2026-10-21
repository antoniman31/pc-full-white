// Achats saisis sur la page : cases « Acheté », prix payé, budget recalculé, export / import.
// Les données sont figées (scraper/tests/fixtures) pour que les montants ne bougent pas avec les relevés.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// Les cartes sont repliées : on déplie celle de l'article avant d'agir dessus.
async function deplier(page, id) {
  const carte = page.locator(`[data-card="${id}"]`);
  if ((await carte.getAttribute("open")) === null) await carte.locator("summary").click();
}

async function acheterCPU(page, prix, extra = {}) {
  await deplier(page, "cpu");
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

  await deplier(page, "cpu");
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

  await deplier(page, "cpu");
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
  await deplier(page, achete.id);
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
  await deplier(page, m.id);
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
  await deplier(page, "cpu");
  await caseCPU(page).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#paid-cpu")).toBeFocused();
  await page.keyboard.press("Enter"); // soumet le formulaire
  await expect(caseCPU(page)).toHaveAttribute("aria-checked", "true");
  await expect(caseCPU(page)).toBeFocused();
});

// --- Modifier, ajouter, supprimer ---------------------------------------------------------------
const carte = (page, id) => page.locator(`[data-card="${id}"]`);

async function ouvrirOutils(page, id) {
  await deplier(page, id);
  await page.locator(`[data-item-edit="${id}"]`).click();
}

test("modifier le nom et le modèle d'un article", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOutils(page, "cpu");
  await page.locator("#iname-cpu").fill("Ryzen 9 9950X3D");
  await page.locator("#imodel-cpu").fill("AMD Ryzen 9 9950X3D · 16c/32t");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(carte(page, "cpu").locator("summary .item-name")).toContainText("Ryzen 9 9950X3D");
  await expect(carte(page, "cpu").locator("summary .local-badge")).toBeVisible();
  await expect(carte(page, "cpu").locator(".item-hint").first()).toContainText("Produit modifié");
  await expect(carte(page, "cpu").locator(".item-offers")).toHaveCount(0); // anciennes offres abandonnées
});

test("un prix saisi à la main remplace le relevé, et vider le champ revient à l'automatique", async ({ page }) => {
  await ouvrir(page);
  await page.locator('.tab[data-target="budget"]').click();
  const avant = await montant(page.locator("#progress-cur"));
  await page.locator('.tab[data-target="pc"]').click();
  await ouvrirOutils(page, "cpu");
  await page.locator("#iprice-cpu").fill(String(CPU.price - 100));
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(carte(page, "cpu").locator(".item-hint").first()).toContainText("Prix saisi à la main");
  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(avant - 100, 0);

  await page.locator('.tab[data-target="pc"]').click();
  await ouvrirOutils(page, "cpu");
  await page.locator("#iprice-cpu").fill("");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(avant, 0);
});

test("supprimer un article demande confirmation, retire son prix du budget et peut être annulé", async ({ page }) => {
  await ouvrir(page);
  await page.locator('.tab[data-target="budget"]').click();
  const avant = await montant(page.locator("#progress-cur"));
  await page.locator('.tab[data-target="pc"]').click();
  await ouvrirOutils(page, "cpu");
  await page.getByRole("button", { name: "Supprimer l'article" }).click();
  await expect(page.locator("#item-error")).toContainText("Clique encore");
  await expect(carte(page, "cpu")).toHaveCount(1);
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(carte(page, "cpu")).toHaveCount(0);
  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(avant - CPU.price, 0);
  await page.getByRole("button", { name: /Rétablir/ }).click();
  await page.locator('.tab[data-target="pc"]').click();
  await expect(carte(page, "cpu")).toHaveCount(1);
});

test("ajouter un article l'affiche, l'additionne au budget et le met au récapitulatif", async ({ page }) => {
  await ouvrir(page, "mobilier");
  await page.locator('.tab[data-target="budget"]').click();
  const avant = await montant(page.locator("#progress-cur"));
  await page.locator('.tab[data-target="mobilier"]').click();
  await page.locator('[data-add-open="mobilier"]').click();
  await page.locator("#aname-mobilier").fill("Tapis de sol");
  await page.locator("#aprice-mobilier").fill("30");
  await page.locator("#aurl-mobilier").fill("https://www.ikea.com/fr/fr/p/x");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const nouvelle = page.locator('[data-card^="user-"]');
  await expect(nouvelle).toHaveCount(1);
  await expect(nouvelle.locator("summary")).toContainText("Tapis de sol");
  await expect(nouvelle.locator(".item-hint").first()).toContainText("Article ajouté");
  await page.locator('.tab[data-target="budget"]').click();
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(avant + 30, 0);
  await expect(page.locator("#local-panel")).toContainText("1 changement");
  await page.locator('.tab[data-target="historique"]').click();
  await expect(page.locator("#recap-body")).toContainText("Articles ajoutés (1)");
});

test("l'ajout refuse un nom vide et un lien qui n'est pas en https", async ({ page }) => {
  await ouvrir(page, "mobilier");
  await page.locator('[data-add-open="mobilier"]').click();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.locator("#add-error")).toContainText("nom");
  await page.locator("#aname-mobilier").fill("Étagère");
  await page.locator("#aurl-mobilier").fill("http://pas-securise.fr");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.locator("#add-error")).toContainText("https");
  await expect(page.locator('[data-card^="user-"]')).toHaveCount(0);
});

test("supprimer un article ajouté ici le retire pour de bon", async ({ page }) => {
  await ouvrir(page, "outils");
  await page.locator('.tab[data-target="mobilier"]').click();
  await page.locator('[data-add-open="outils_bureau"]').click();
  await page.locator("#aname-outils_bureau").fill("Pince");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const nouvelle = page.locator('[data-card^="user-"]');
  await expect(nouvelle).toHaveCount(1);
  await nouvelle.locator("[data-item-edit]").click();
  await page.getByRole("button", { name: "Supprimer l'article" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(nouvelle).toHaveCount(0);
  await page.locator('.tab[data-target="budget"]').click();
  await expect(page.locator("#local-panel")).toContainText("Coche « Acheté »");
});

test("un changement de produit ne fait pas annuler un achat publié dans les données", async ({ page }) => {
  await ouvrir(page, "periph");
  const achete = BASE.peripherals.find(p => p.status === "bought");
  await ouvrirOutils(page, achete.id);
  await page.locator(`#iname-${achete.id}`).fill("Nouveau nom");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(`[data-buy-toggle="${achete.id}"]`)).toHaveAttribute("aria-checked", "true");
});

test("l'export contient les ajouts et l'import les restitue", async ({ page }) => {
  await ouvrir(page, "mobilier");
  await page.locator('[data-add-open="mobilier"]').click();
  await page.locator("#aname-mobilier").fill("Tapis de sol");
  await page.locator("#aprice-mobilier").fill("30");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.locator('.tab[data-target="budget"]').click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#local-export").click()]);
  const chemin = await dl.path();
  const doc = JSON.parse(readFileSync(chemin, "utf-8"));
  expect(doc.added).toHaveLength(1);
  expect(doc.added[0]).toMatchObject({ section: "mobilier", name: "Tapis de sol", price: 30 });
  await page.locator("#local-reset").click();
  await page.locator("#local-reset").click();
  await page.locator("#local-import").setInputFiles(chemin);
  await expect(page.locator("#local-msg")).toContainText("1 changement importé");
  await page.locator('.tab[data-target="mobilier"]').click();
  await expect(page.locator('[data-card^="user-"]')).toHaveCount(1);
});

// Le budget affiché doit être celui que le dépôt calcule : même fichier de changements, appliqué par
// scripts/apply_changes.py sur les mêmes données.
test("le budget de la page égale celui de scripts/apply_changes.py pour les mêmes changements", async ({ page }) => {
  const dossier = mkdtempSync(join(tmpdir(), "pcfw-"));
  const changements = {
    version: 1,
    items: {
      cpu: { status: "bought", paid: 480, date: "2026-10-21", vendor: "TopAchat" },
      ssd: { price: 450 },
      alex1: { deleted: true },
      gpu: { name: "Autre GPU", model: "Autre GPU 16 Go" },
      clavier: { status: "to_buy" },
    },
    added: [
      { id: "user-aaa", section: "mobilier", name: "Tapis", model: "", icon: "📦", price: 30 },
      { id: "user-bbb", section: "pc_components", name: "Câble SATA", model: "", icon: "📦", price: 8 },
      { id: "user-ccc", section: "peripherals", name: "Hub USB", model: "", icon: "📦", price: 25 },
    ],
  };
  writeFileSync(join(dossier, "prices.json"), JSON.stringify(BASE));
  writeFileSync(join(dossier, "changes.json"), JSON.stringify(changements));
  execFileSync("python3", ["scripts/apply_changes.py", "--data", join(dossier, "prices.json"), "--changes", join(dossier, "changes.json")], { cwd: new URL("..", import.meta.url).pathname });
  const attendu = JSON.parse(readFileSync(join(dossier, "prices.json"), "utf-8")).budget_summary;

  await ouvrir(page, "budget");
  await page.locator("#local-import").setInputFiles(join(dossier, "changes.json"));
  await expect(page.locator("#local-msg")).toContainText("changements importés");
  const arrondi = (n) => Math.round(n);
  expect(await montant(page.locator("#progress-cur"))).toBe(arrondi(attendu.remaining_to_buy));
  expect(await montant(page.locator("#stat-bought"))).toBe(arrondi(attendu.already_bought));
  expect(await montant(page.locator("#stat-total"))).toBe(arrondi(attendu.total_complete));
  expect(await montant(page.locator("#stat-margin"))).toBe(arrondi(attendu.margin_vs_prime));
  expect(await montant(page.locator("#stat-pcmargin"))).toBe(arrondi(attendu.pc_margin));
});
