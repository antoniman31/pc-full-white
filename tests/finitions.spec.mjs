// Finitions de l'audit : icône du site, tableaux larges sur mobile, lignes RGB / améliorations, ajout d'écran.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const montant = async (loc) => Number((await loc.textContent()).replace(/[^\d,-]/g, "").replace(",", "."));

async function ouvrir(page) {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}

test("le site a une icône et plus de pastille tronquée dans la barre", async ({ page, request }) => {
  await ouvrir(page);
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("favicon.svg");
  expect((await request.get("/site/favicon.svg")).status()).toBe(200);
  await expect(page.locator(".verif-chip")).toHaveCount(0);
});

test("on peut ajouter un écran, il entre dans le budget des périphériques", async ({ page }) => {
  await ouvrir(page);
  const avant = await montant(page.locator("#progress-cur"));
  await ouvrirOnglet(page, "periph");
  await page.locator('[data-add-open="screens"]').click();
  await page.locator("#aname-screens").fill("Écran test");
  await page.locator("#aprice-screens").fill("120");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.locator("#screens-list")).toContainText("Écran test");
  await ouvrirOnglet(page, "budget");
  expect(await montant(page.locator("#progress-cur"))).toBeCloseTo(avant + 120, 0);
});

test("la première colonne des tableaux reste figée quand on les fait défiler", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrir(page);
  await ouvrirOnglet(page, "historique");
  await page.locator('[data-hist-view="heat"]').click();
  const zone = page.locator("#hist-heat .table-scroll");
  await expect.poll(() => zone.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);   // arrive sur le dernier relevé
  const gauche = await zone.evaluate(el => el.getBoundingClientRect().left);
  const premiere = await zone.locator("tbody th").first().evaluate(el => el.getBoundingClientRect().left);
  expect(Math.abs(premiere - gauche)).toBeLessThan(2);                              // le nom est toujours à gauche
  const largeur = await zone.locator("tbody th").first().evaluate(el => el.getBoundingClientRect().width);
  expect(largeur).toBeLessThanOrEqual(140);                                         // sans manger l'écran
});

test("écosystème RGB et améliorations possibles ont des lignes séparées", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "risques");
  const ligne = page.locator("#upgrades-list .item-row").first();
  expect(await ligne.evaluate(el => getComputedStyle(el).display)).toBe("flex");
  expect(await ligne.evaluate(el => parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(8);
});

test("l'icône d'une phase reste sur la ligne de son titre", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ouvrir(page);
  await ouvrirOnglet(page, "workflow");
  const carte = page.locator(".phase-card").nth(4);
  const icone = await carte.locator(".phase-title-main > span").first().boundingBox();
  const titre = await carte.locator(".phase-title").boundingBox();
  const milieu = icone.y + icone.height / 2;
  expect(milieu).toBeGreaterThan(titre.y);                  // l'icône est à côté du titre, pas au-dessus
  expect(milieu).toBeLessThan(titre.y + titre.height);
});
