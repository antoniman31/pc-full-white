// Barre d'onglets sur plusieurs lignes (plus de défilement latéral), espace sous la barre, swipe sur téléphone.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const ORDRE = ["budget", "pc", "periph", "mobilier", "risques", "workflow", "historique", "reglages"];

async function ouvrir(page) {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}
const actif = (page) => page.locator(".tab.active").getAttribute("data-target");

test("la barre d'onglets ne défile plus : tous les onglets sont visibles dans la fenêtre", async ({ page }) => {
  const defauts = [];
  for (const largeur of [360, 390, 412, 600, 768, 840, 1024, 1200, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    const r = await page.evaluate(() => {
      const tabs = document.querySelector(".tabs");
      const dehors = [...document.querySelectorAll(".tab")].filter(t => {
        const b = t.getBoundingClientRect();
        return b.left < 0 || b.right > window.innerWidth;
      }).length;
      return { deborde: tabs.scrollWidth > tabs.clientWidth + 1, dehors, pageLarge: document.documentElement.scrollWidth > window.innerWidth };
    });
    if (r.deborde || r.dehors || r.pageLarge) defauts.push(`${largeur}px : ${JSON.stringify(r)}`);
  }
  expect(defauts, defauts.join("\n")).toEqual([]);
});

test("sur téléphone, les onglets passent sur 2 lignes ou 3 au plus", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await ouvrir(page);
  const lignes = await page.evaluate(() => new Set([...document.querySelectorAll(".tab")].map(t => Math.round(t.getBoundingClientRect().top))).size);
  expect(lignes).toBeGreaterThan(1);
  expect(lignes).toBeLessThanOrEqual(3);
});

test("le premier texte de chaque onglet suit la barre à 16 px", async ({ page }) => {
  for (const largeur of [390, 1200]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    for (const onglet of ORDRE) {
      await page.locator(`.tab[data-target="${onglet}"]`).click();
      const ecart = await page.evaluate((id) => {
        const nav = document.querySelector(".topnav").getBoundingClientRect().bottom;
        const panneau = document.getElementById(`panel-${id}`);
        const premier = [...panneau.querySelectorAll("*")].find(el => el.getBoundingClientRect().height > 0 && !el.classList.contains("sr-only") && el.getBoundingClientRect().top > nav - 1);
        return Math.round(premier.getBoundingClientRect().top - nav);
      }, onglet);
      expect(ecart, `${onglet} à ${largeur}px`).toBeLessThanOrEqual(40);
    }
  }
});

// Swipes tactiles envoyés au navigateur (Chromium) : réservés à l'émulation d'un téléphone.
async function swipe(page, x1, y1, x2, y2) {
  const c = await page.context().newCDPSession(page);
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= 6; i++) {
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / 6, y: y1 + ((y2 - y1) * i) / 6 }] });
  }
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("swipe entre onglets (téléphone)", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "mobile", "swipe réservé au téléphone"));

  test("glisser à gauche ouvre l'onglet suivant, à droite le précédent", async ({ page }) => {
    await ouvrir(page);
    expect(await actif(page)).toBe("budget");
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("pc");
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("periph");
    await swipe(page, 100, 500, 300, 500);
    await expect.poll(() => actif(page)).toBe("pc");
  });

  test("aux deux bouts de la liste, rien ne se passe", async ({ page }) => {
    await ouvrir(page);
    await swipe(page, 100, 500, 300, 500);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("budget");
    await page.locator('.tab[data-target="reglages"]').click();
    await swipe(page, 300, 500, 100, 500);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("reglages");
  });

  test("un défilement vertical, un geste trop court ou près du bord ne changent pas d'onglet", async ({ page }) => {
    await ouvrir(page);
    await swipe(page, 200, 700, 190, 300);   // vertical
    await swipe(page, 250, 500, 220, 500);   // trop court
    await swipe(page, 10, 500, 250, 500);    // démarre sur le bord
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("budget");
  });

  test("un swipe qui démarre sur un tableau qui défile ne change pas d'onglet", async ({ page }) => {
    await ouvrir(page);
    await page.locator('.tab[data-target="historique"]').click();
    const zone = page.locator("#panel-historique .table-scroll").first();
    await expect(zone).toBeVisible();
    await zone.evaluate(el => { el.querySelector("table").style.minWidth = "900px"; }); // force un défilement latéral
    await expect.poll(() => zone.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(true);
    await zone.scrollIntoViewIfNeeded();
    const b = await zone.boundingBox();
    await swipe(page, b.x + b.width - 40, b.y + 20, b.x + 40, b.y + 20);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("historique");
  });

  test("après un swipe, la page revient en haut", async ({ page }) => {
    await ouvrir(page);
    await page.evaluate(() => window.scrollTo(0, 400));
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("pc");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });
});
