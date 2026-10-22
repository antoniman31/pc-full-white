// Onglet Achats (articles à acheter rangés par boutique) et encart « Depuis ta dernière visite ».
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const SECTIONS = ["pc_components", "screens", "peripherals", "mobilier", "outils_bureau"];
const prixTotal = (d) => SECTIONS.flatMap(s => d[s]).filter(i => i.status !== "bought" && i.status !== "owned_external").reduce((t, i) => t + (i.price || 0), 0);

// Le jeu figé n'a pas d'offres : on en ajoute chez trois boutiques (dont une écrite de deux façons).
function avecOffres() {
  const d = structuredClone(BASE);
  const offre = (retailer, price) => ({ retailer, url: `https://exemple.test/${encodeURIComponent(retailer)}`, price, seen: "2026-10-21" });
  const par = (id) => d.pc_components.find(i => i.id === id);
  par("cpu").offers = [offre("LDLC", par("cpu").price), offre("Fnac", par("cpu").price + 20)];
  par("gpu").offers = [offre("Cdiscount (via Google Shopping)", par("gpu").price), offre("Darty", par("gpu").price + 30)];
  par("ram").offers = [offre("Cdiscount", par("ram").price)];
  par("ssd").offers = [offre("LDLC", par("ssd").price)];
  return d;
}

async function ouvrir(page, { seen } = {}) {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: avecOffres() }));
  if (seen) await page.addInitScript((v) => { if (!localStorage.getItem("pcfw-seen-v1")) localStorage.setItem("pcfw-seen-v1", JSON.stringify(v)); }, seen);
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}

test("l'onglet Achats range les articles à acheter par boutique, avec lien et total", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "achats");
  await expect(page.locator("#panel-achats")).toBeVisible();
  const groupes = page.locator("#achats-list .shop-group");
  expect(await groupes.count()).toBeGreaterThan(2);
  // chaque lien est une adresse https qui s'ouvre dans un nouvel onglet
  const liens = await page.locator("#achats-list a.shop-link").evaluateAll(els => els.map(a => [a.href, a.target, a.rel]));
  expect(liens.length).toBe(4);
  for (const [href, cible, rel] of liens) { expect(href).toMatch(/^https:\/\//); expect(cible).toBe("_blank"); expect(rel).toContain("noopener"); }
  // la somme des groupes égale la somme des prix des articles à acheter
  const totaux = await page.locator("#achats-list .shop-total").allTextContents();
  const somme = totaux.reduce((t, s) => t + Number(s.replace(/[^\d,]/g, "").replace(",", ".")), 0);
  expect(somme).toBeCloseTo(prixTotal(BASE), -1);
  await expect(page.locator("#summary-achats")).toContainText("article");
});

test("« Cdiscount » et « Cdiscount (via Google Shopping) » forment une seule boutique", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "achats");
  const noms = await page.locator("#achats-list .shop-name").allTextContents();
  expect(noms.some(n => n.includes("via Google"))).toBe(false);
  const uniques = new Set(noms.map(n => n.replace(/\s*\(\d+ articles?\)\s*$/, "").trim()));
  expect(uniques.size).toBe(noms.length);
});

test("un achat enregistré sort l'article de la liste Achats", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "achats");
  const avant = await page.locator("#achats-list .shop-row").count();
  await ouvrirOnglet(page, "pc");
  await page.locator('[data-card="cpu"] summary').click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill("440");
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
  await ouvrirOnglet(page, "achats");
  expect(await page.locator("#achats-list .shop-row").count()).toBe(avant - 1);
});

test("première visite : aucun encart, les prix vus sont mémorisés", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#since-visit")).toBeHidden();
  const seen = JSON.parse(await page.evaluate(() => localStorage.getItem("pcfw-seen-v1")));
  expect(seen.prices.cpu).toBeGreaterThan(0);
  expect(seen.remaining).toBeGreaterThan(0);
});

test("des prix qui ont bougé depuis la dernière visite sont listés, « Compris » met à jour", async ({ page }) => {
  const cpu = BASE.pc_components.find(i => i.id === "cpu").price, gpu = BASE.pc_components.find(i => i.id === "gpu").price;
  await ouvrir(page, { seen: { at: "2026-10-01", remaining: 5500, prices: { cpu: cpu + 40, gpu: gpu - 60 } } });
  const encart = page.locator("#since-visit");
  await expect(encart).toBeVisible();
  await expect(encart).toContainText("Depuis ta dernière visite (01/10/2026)");
  await expect(encart).toContainText("1 prix en baisse");
  await expect(encart).toContainText("1 en hausse");
  await encart.locator("summary").click();
  await expect(encart.locator("li").first()).toContainText("→");
  await page.locator("#since-ok").click();
  await expect(encart).toBeHidden();
  const seen = JSON.parse(await page.evaluate(() => localStorage.getItem("pcfw-seen-v1")));
  expect(seen.prices.cpu).toBeCloseTo(cpu, 1);
  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await expect(page.locator("#since-visit")).toBeHidden();
});
