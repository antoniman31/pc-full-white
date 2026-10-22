// Barre d'onglets sur plusieurs lignes (plus de défilement latéral), espace sous la barre, swipe sur téléphone.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const ORDRE = ["budget", "pc", "periph", "mobilier", "achats", "risques", "workflow", "historique", "reglages"];

async function ouvrir(page) {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}
const actif = (page) => page.locator(".tab.active").getAttribute("data-target");

test("destinations et sous-onglets tiennent dans la fenêtre, sans défilement latéral", async ({ page }) => {
  const defauts = [];
  for (const largeur of [360, 390, 412, 600, 768, 840, 1024, 1200, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    await ouvrirOnglet(page, "periph");
    const r = await page.evaluate(() => {
      const tabs = document.querySelector(".tabs");
      const dehors = [...document.querySelectorAll(".tab:not([hidden]), .dest")].filter(t => {
        const b = t.getBoundingClientRect();
        return b.left < -1 || b.right > window.innerWidth + 1 || b.bottom > window.innerHeight + 1;
      }).map(t => { const b = t.getBoundingClientRect(); return `${t.textContent.trim().slice(0, 12)} [${Math.round(b.left)}-${Math.round(b.right)}, bas ${Math.round(b.bottom)}]`; });
      return { deborde: tabs.scrollWidth > tabs.clientWidth + 1, dehors, pageLarge: document.documentElement.scrollWidth > window.innerWidth };
    });
    if (r.deborde || r.dehors.length || r.pageLarge) defauts.push(`${largeur}px : ${JSON.stringify(r)}`);
  }
  expect(defauts, defauts.join("\n")).toEqual([]);
});

test("sous 600 px les destinations forment une barre en bas, dès 600 px un rail à gauche", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await ouvrir(page);
  let boites = await page.locator(".dest").evaluateAll(l => l.map(e => e.getBoundingClientRect()));
  expect(new Set(boites.map(b => Math.round(b.top))).size).toBe(1);        // une seule ligne
  expect(boites[0].top).toBeGreaterThan(700);                              // en bas
  await page.setViewportSize({ width: 700, height: 900 });
  boites = await page.locator(".dest").evaluateAll(l => l.map(e => e.getBoundingClientRect()));
  expect(new Set(boites.map(b => Math.round(b.left))).size).toBe(1);       // une seule colonne
  expect(boites[0].left).toBeLessThan(10);                                 // à gauche
});

test("Budget et Achats n'affichent pas de sous-onglets, Matériel et Suivi en ont trois", async ({ page }) => {
  await ouvrir(page);
  const visibles = () => page.locator(".tab:not([hidden])").count();
  expect(await visibles()).toBe(1);
  await page.locator('.dest[data-dest="materiel"]').click();
  await expect(page.locator(".tabs")).toBeVisible();
  expect(await visibles()).toBe(3);
  await page.locator('.dest[data-dest="suivi"]').click();
  expect(await visibles()).toBe(3);
  await page.locator('.dest[data-dest="achats"]').click();
  await expect(page.locator(".tabs")).toBeHidden();
});

test("une destination rouvre le dernier sous-onglet vu", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "mobilier");
  await page.locator('.dest[data-dest="budget"]').click();
  await page.locator('.dest[data-dest="materiel"]').click();
  expect(await actif(page)).toBe("mobilier");
});

test("le premier texte de chaque onglet suit la barre à 16 px", async ({ page }) => {
  for (const largeur of [390, 1200]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page);
    for (const onglet of ORDRE) {
      await ouvrirOnglet(page, onglet);
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

  test("glisser à gauche ouvre le sous-onglet suivant, à droite le précédent", async ({ page }) => {
    await ouvrir(page);
    await ouvrirOnglet(page, "pc");
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("periph");
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("mobilier");
    await swipe(page, 100, 500, 300, 500);
    await expect.poll(() => actif(page)).toBe("periph");
  });

  test("aux deux bouts du groupe, rien ne se passe", async ({ page }) => {
    await ouvrir(page);
    await ouvrirOnglet(page, "pc");
    await swipe(page, 100, 500, 300, 500);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("pc");
    await ouvrirOnglet(page, "mobilier");
    await swipe(page, 300, 500, 100, 500);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("mobilier");
  });

  test("un défilement vertical, un geste trop court ou près du bord ne changent pas d'onglet", async ({ page }) => {
    await ouvrir(page);
    await ouvrirOnglet(page, "pc");
    await swipe(page, 200, 700, 190, 300);   // vertical
    await swipe(page, 250, 500, 220, 500);   // trop court
    await swipe(page, 405, 500, 150, 500);   // démarre sur le bord droit
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("pc");
  });

  test("un swipe qui démarre sur un tableau qui défile ne change pas d'onglet", async ({ page }) => {
    await ouvrir(page);
    await ouvrirOnglet(page, "historique");
    await page.locator('[data-hist-view="heat"]').click();
    const zone = page.locator("#hist-heat .table-scroll");
    await expect(zone).toBeVisible();
    await zone.evaluate(el => { el.querySelector("table").style.minWidth = "900px"; }); // force un défilement latéral
    await expect.poll(() => zone.evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(true);
    await zone.evaluate(el => el.scrollIntoView({ block: "center" }));   // ni sous la barre du haut, ni sous celle du bas
    const b = await zone.boundingBox();
    await swipe(page, b.x + b.width - 40, b.y + b.height / 2, b.x + 40, b.y + b.height / 2);
    await page.waitForTimeout(200);
    expect(await actif(page)).toBe("historique");
  });

  test("après un swipe, la page revient en haut", async ({ page }) => {
    await ouvrir(page);
    await ouvrirOnglet(page, "pc");
    await page.evaluate(() => window.scrollTo(0, 400));
    await swipe(page, 300, 500, 100, 500);
    await expect.poll(() => actif(page)).toBe("periph");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });
});
