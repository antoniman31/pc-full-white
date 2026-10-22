// Confort d'usage : erreur de chargement, annulation, pastilles d'onglets, âge des données, blocs repliés,
// filtre « à acheter seulement », tout déplier, export CSV, mini-résumé.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const montant = async (loc) => Number((await loc.textContent()).replace(/[^\d,-]/g, "").replace(",", "."));

async function ouvrir(page, onglet = "budget") {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator(`.tab[data-target="${onglet}"]`).click();
}

test("si les prix ne se chargent pas, un message propose de réessayer", async ({ page }) => {
  let ok = false;
  await page.route("**/data/prices.json", (route) => ok ? route.fulfill({ json: structuredClone(BASE) }) : route.fulfill({ status: 500, body: "nope" }));
  await page.goto("/site/");
  await expect(page.locator("#load-error")).toBeVisible();
  await expect(page.locator("#load-error")).toContainText("Impossible de charger les prix");
  ok = true;
  await page.locator("#load-retry").click();
  await expect(page.locator("#load-error")).toBeHidden();
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
});

test("après un achat, « Annuler » rétablit l'état précédent", async ({ page }) => {
  await ouvrir(page, "pc");
  const carte = page.locator('[data-card="cpu"]');
  await carte.locator("summary").click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill("440");
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
  await expect(page.locator('[data-buy-toggle="cpu"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#toast")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("Acheté");
  await page.locator("#toast-undo").click();
  await expect(page.locator('[data-buy-toggle="cpu"]')).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#toast")).toBeHidden();
  await page.locator('.tab[data-target="reglages"]').click();
  await expect(page.locator("#local-panel")).toContainText("Coche « Acheté »");   // plus aucun changement local
});

test("les onglets affichent le nombre d'articles à acheter", async ({ page }) => {
  await ouvrir(page);
  for (const id of ["pc", "periph", "mobilier"]) {
    const n = Number((await page.locator(`#count-${id}`).textContent()).replace(/\D/g, ""));
    expect(n, id).toBeGreaterThan(0);
  }
  await expect(page.locator("#count-pc .sr-only")).toHaveText(" à acheter");
});

test("l'âge des prix est indiqué en haut du Budget", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#data-age")).toContainText("Prix relevés le");
  await expect(page.locator("#data-age")).toContainText(/il y a \d+ jours|hier|aujourd'hui/);
});

test("les blocs longs du Budget sont repliés et s'ouvrent au toucher", async ({ page }) => {
  await ouvrir(page);
  for (const id of ["fold-rules", "fold-order", "fold-critical"]) {
    await expect(page.locator(`#${id}`)).not.toHaveAttribute("open", "");
  }
  await page.locator("#fold-order summary").click();
  await expect(page.locator("#purchase-order li").first()).toBeVisible();
});

test("« À acheter seulement » masque les articles achetés et reste mémorisé", async ({ page }) => {
  await ouvrir(page, "periph");
  await expect(page.getByRole("heading", { name: /Acheté ou en main/ }).first()).toBeVisible();
  await page.locator("#panel-periph [data-only-todo]").first().click();
  await expect(page.getByRole("heading", { name: /Acheté ou en main/ })).toHaveCount(0);
  await expect(page.locator("#periph-list")).toContainText("masqué");
  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator('.tab[data-target="periph"]').click();
  await expect(page.locator("#panel-periph [data-only-todo]").first()).toHaveAttribute("aria-pressed", "true");
});

test("« Tout déplier » ouvre toutes les cartes, « Tout replier » les ferme", async ({ page }) => {
  await ouvrir(page, "mobilier");
  await page.locator("#panel-mobilier [data-toggle-all]").first().click();
  const ouvertes = await page.locator("#panel-mobilier details.item-card[open]").count();
  const total = await page.locator("#panel-mobilier details.item-card").count();
  expect(ouvertes).toBe(total);
  await page.locator("#panel-mobilier [data-toggle-all]").first().click();
  expect(await page.locator("#panel-mobilier details.item-card[open]").count()).toBe(0);
});

test("l'export CSV contient les articles et les totaux, lisibles dans un tableur français", async ({ page }) => {
  await ouvrir(page, "reglages");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#csv-export").click()]);
  expect(dl.suggestedFilename()).toMatch(/^pc-full-white-budget-\d{4}-\d{2}-\d{2}\.csv$/);
  const texte = readFileSync(await dl.path(), "utf-8");
  expect(texte.charCodeAt(0)).toBe(0xFEFF);
  expect(texte).toContain('"Section";"Article";"Statut"');
  expect(texte).toContain('"PC";"CPU');
  expect(texte).toContain("Reste à acheter");
  expect(texte).toMatch(/\d,\d\d/);                      // virgule décimale
});

test("le mini-résumé apparaît en défilant une liste, jamais dans le Budget", async ({ page }) => {
  await ouvrir(page, "pc");
  await expect(page.locator("#mini-summary")).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 800));
  await expect(page.locator("#mini-summary")).toBeVisible();
  await expect(page.locator("#mini-summary")).toContainText("Reste à acheter");
  await page.locator('.tab[data-target="budget"]').click();
  await expect(page.locator("#mini-summary")).toBeHidden();
});

test("le pied de page ne renvoie plus vers les PDF figés", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator(".footer a")).toHaveCount(0);
});
