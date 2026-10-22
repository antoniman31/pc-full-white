// Graphiques et tableaux plus visuels : barre segmentée, courbe, récap, historique, schéma d'airflow.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));

async function ouvrir(page, onglet = "budget") {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator(`.tab[data-target="${onglet}"]`).click();
}

test("la barre segmentée a la somme du reste à acheter et un repère de limite", async ({ page }) => {
  await ouvrir(page);
  const largeurs = await page.locator("#seg-bar .seg").evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
  const barre = await page.locator("#seg-bar").evaluate(e => e.getBoundingClientRect().width);
  expect(largeurs.every(w => w > 0)).toBe(true);
  expect(largeurs.reduce((a, b) => a + b, 0)).toBeLessThan(barre);              // la limite est au-delà du reste à acheter
  const limite = await page.locator("#seg-limit").evaluate(e => e.getBoundingClientRect().left);
  const fin = await page.locator("#seg-bar .seg").last().evaluate(e => e.getBoundingClientRect().right);
  expect(limite).toBeGreaterThan(fin);
});

test("une marge négative s'affiche en rouge, une positive en vert", async ({ page }) => {
  await ouvrir(page);
  const couleur = (sel) => page.locator(sel).evaluate(e => getComputedStyle(e).color);
  const neg = await page.locator("#stat-pcmargin").evaluate(e => e.closest(".stat-tile").classList.contains("neg"));
  expect(neg).toBe(/[-−]/.test(await page.locator("#stat-pcmargin").textContent()));
  if (neg) expect(await couleur("#stat-pcmargin")).not.toBe(await couleur("#stat-margin"));
});

test("la courbe du budget montre la limite et chaque point donne sa valeur", async ({ page }) => {
  await ouvrir(page, "historique");
  await expect(page.locator("#history-sparkline")).toContainText("limite");
  const points = page.locator("#history-sparkline .chart-dot");
  expect(await points.count()).toBeGreaterThan(3);
  await points.nth(2).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#chart-tip")).toContainText("€");
  const label = await points.nth(2).getAttribute("aria-label");
  await expect(page.locator("#chart-tip")).toContainText(label.split(" : ")[0]);
});

test("le récap des achats est classé du plus gros au plus petit montant", async ({ page }) => {
  await ouvrir(page, "historique");
  const montants = await page.locator("#recap-body .recap-row .recap-fill").evaluateAll(els => els.map(e => parseFloat(e.style.width)));
  expect(montants.length).toBeGreaterThan(3);
  expect([...montants].sort((a, b) => b - a)).toEqual(montants);
});

test("l'historique propose mini-courbes et carte thermique, le choix est retenu", async ({ page }) => {
  await ouvrir(page, "historique");
  await expect(page.locator("#hist-spark .spark-row")).toHaveCount(10);               // 9 composants + total
  await expect(page.locator("#hist-spark .spark-row .spark-svg").first()).toHaveAttribute("role", "img");
  await expect(page.locator("#hist-heat")).toBeHidden();
  await page.locator('[data-hist-view="heat"]').click();
  await expect(page.locator("#hist-heat")).toBeVisible();
  await expect(page.locator("#hist-spark")).toBeHidden();
  await expect(page.locator('[data-hist-view="heat"]')).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator('.tab[data-target="historique"]').click();
  await expect(page.locator("#hist-heat")).toBeVisible();
});

test("la carte thermique double la couleur d'une flèche et d'un mot caché", async ({ page }) => {
  await ouvrir(page, "historique");
  await page.locator('[data-hist-view="heat"]').click();
  const hausses = page.locator("#hist-heat td.heat[class*='heat-up'] i");
  const baisses = page.locator("#hist-heat td.heat[class*='heat-down'] i");
  expect(await hausses.count()).toBeGreaterThan(0);
  expect(await baisses.count()).toBeGreaterThan(0);
  await expect(hausses.first()).toHaveText("▲");
  await expect(baisses.first()).toHaveText("▼");
  await expect(page.locator("#hist-heat td.heat[class*='heat-up'] .sr-only").first()).toContainText("plus cher");
});

test("le schéma d'airflow s'agrandit au toucher et se ferme", async ({ page }) => {
  await ouvrir(page, "pc");
  const img = page.locator("#airflow-open img");
  await expect(img).toHaveAttribute("alt", /flux d'air/);
  await page.locator("#airflow-open").click();
  await expect(page.locator("#airflow-dialog")).toBeVisible();
  await page.locator("#airflow-close").click();
  await expect(page.locator("#airflow-dialog")).toBeHidden();
  await page.locator("#airflow-open").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#airflow-dialog")).toBeHidden();
});

for (const theme of ["light", "dark"]) {
  test(`carte thermique, mini-courbes et barre segmentée sans violation d'accessibilité (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await ouvrir(page, "historique");
    const regles = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    for (const vue of ["spark", "heat"]) {
      await page.locator(`[data-hist-view="${vue}"]`).click();
      const { violations } = await new AxeBuilder({ page }).withTags(regles).analyze();
      expect(violations.map(v => `${vue}: ${v.id} (${v.nodes.length}) — ${v.help}`)).toEqual([]);
    }
    await page.locator('.tab[data-target="budget"]').click();
    const { violations } = await new AxeBuilder({ page }).withTags(regles).analyze();
    expect(violations.map(v => `budget: ${v.id} (${v.nodes.length}) — ${v.help}`)).toEqual([]);
  });
}
