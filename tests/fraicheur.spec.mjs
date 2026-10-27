// Fraîcheur du prix affiché : date de l'offre la moins chère, alerte si ancien ou une seule boutique.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const offre = (retailer, price, seen) => ({ retailer, url: "https://exemple.fr/" + retailer, price, seen });

// Trois articles : cpu (2 boutiques, récent), cm (1 boutique), ram (2 boutiques, ancien). Date du jour figée au 2026-10-23.
async function ouvrir(page) {
  const d = structuredClone(BASE);
  const par = Object.fromEntries(d.pc_components.map((i) => [i.id, i]));
  par.cpu.offers = [offre("LDLC", 450, "2026-10-21"), offre("TopAchat", 444, "2026-10-22")];
  par.cm.offers = [offre("Amazon.fr", 280, "2026-10-22")];
  par.ram.offers = [offre("LDLC", 620, "2026-10-10"), offre("Grosbill", 610, "2026-10-12")];
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: d }));
  await page.clock.setFixedTime(new Date("2026-10-23T12:00:00"));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await ouvrirOnglet(page, "pc");
}
const fresh = (page, id) => page.locator(`[data-card="${id}"] .item-fresh`);

test("un prix récent confirmé par deux boutiques montre sa date, sans alerte", async ({ page }) => {
  await ouvrir(page);
  await expect(fresh(page, "cpu")).toHaveText("relevé le 22/10");
  await expect(fresh(page, "cpu")).not.toHaveClass(/warn/);
});

test("une seule boutique : alerte « 1 source »", async ({ page }) => {
  await ouvrir(page);
  await expect(fresh(page, "cm")).toContainText("1 source");
  await expect(fresh(page, "cm")).toHaveClass(/warn/);
  await expect(fresh(page, "cm")).toContainText("prix à vérifier");   // dit aussi aux lecteurs d'écran
});

test("un prix de plus de 7 jours : alerte avec l'âge en jours", async ({ page }) => {
  await ouvrir(page);
  await expect(fresh(page, "ram")).toContainText("il y a 11 j");
  await expect(fresh(page, "ram")).toHaveClass(/warn/);
});

test("pas de mention pour un article sans offre datée", async ({ page }) => {
  await ouvrir(page);
  await expect(fresh(page, "gpu")).toHaveCount(0);   // aucune offre dans les données
});
