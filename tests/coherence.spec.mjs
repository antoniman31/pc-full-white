// Cohérence de l'interface : mêmes formes de boutons, mêmes cartes, rangées d'actions sur une seule ligne,
// pictogrammes à la place des emojis dans les titres.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ouvrirOnglet } from "./nav.mjs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const LARGEURS = [360, 412, 600];

async function ouvrir(page, onglet = "pc") {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  // L'écran voulu est-il bien affiché ? (sur un runner chargé, l'initialisation peut revenir sur Budget après le clic)
  await expect(async () => {
    await ouvrirOnglet(page, onglet);
    await expect(page.locator(`#panel-${onglet}`)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

// Les boutons visibles d'un conteneur sont-ils alignés sur une même ligne, sans déborder de la fenêtre ?
async function surUneLigne(page, selecteur, contexte) {
  // Attendre que la rangée soit réellement affichée (écran actif, animation d'arrivée commencée) avant de mesurer.
  await expect(page.locator(selecteur).first().locator("button, a, label.local-btn").first(), `${contexte} : rangée non affichée`).toBeVisible();
  const r = await page.locator(selecteur).first().evaluate((el) => {
    const bs = [...el.querySelectorAll("button, a, label.local-btn")].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest("[hidden]"));
    const tops = bs.map((b) => Math.round(b.getBoundingClientRect().top));
    return { n: bs.length, ecart: Math.max(...tops) - Math.min(...tops), debord: Math.max(...bs.map((b) => b.getBoundingClientRect().right)) - window.innerWidth };
  });
  expect(r.n, `${contexte} : aucun bouton`).toBeGreaterThan(0);
  expect(r.ecart, `${contexte} : boutons sur plusieurs lignes`).toBeLessThan(6);
  expect(r.debord, `${contexte} : déborde de la fenêtre`).toBeLessThanOrEqual(0);
}

for (const largeur of LARGEURS) {
  test.describe(`rangées d'actions à ${largeur} px`, () => {
    test.use({ viewport: { width: largeur, height: 900 } });

    test("outils de liste, formulaires d'achat, de modification et d'ajout", async ({ page }) => {
      await ouvrir(page, "pc");
      await surUneLigne(page, "#pc-components-list .add-row", "Ajouter / Déplier / À acheter");

      await page.locator('[data-card="cpu"] summary').click();
      await page.locator('[data-buy-toggle="cpu"]').click();
      await surUneLigne(page, '[data-buy-form] .buy-actions', "formulaire d'achat");
      await page.locator("#paid-cpu").fill("440");
      await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();

      await page.locator('[data-card="cpu"] [data-item-edit]').click();
      await surUneLigne(page, "[data-item-form] .buy-actions", "formulaire de modification");
      await page.locator("[data-item-delete]").click();     // état « à confirmer »
      await expect(page.locator("[data-item-delete]")).toHaveClass(/armed/);
      await surUneLigne(page, "[data-item-form] .buy-actions", "suppression à confirmer");

      await page.locator("[data-add-open]").first().click();
      await surUneLigne(page, "[data-add-form] .buy-actions", "formulaire d'ajout");
    });

    test("Réglages : thème, export / import / réinitialisation, avec et sans changement", async ({ page }) => {
      await ouvrir(page, "reglages");
      await surUneLigne(page, '[aria-label="Thème"]', "thème");
      await surUneLigne(page, "#local-panel .local-actions", "export / import / réinitialisation (vide)");
      await ouvrirOnglet(page, "pc");
      await page.locator('[data-card="cpu"] summary').click();
      await page.locator('[data-buy-toggle="cpu"]').click();
      await page.locator("#paid-cpu").fill("440");
      await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
      await ouvrirOnglet(page, "reglages");
      await surUneLigne(page, "#local-panel .local-actions", "export / import / réinitialisation (avec changement)");
      await page.locator("#local-reset").click();   // « Confirmer »
      await surUneLigne(page, "#local-panel .local-actions", "réinitialisation à confirmer");
    });

    test("barre d'envoi et Historique", async ({ page }) => {
      await ouvrir(page, "pc");
      await page.locator('[data-card="cpu"] summary').click();
      await page.locator('[data-buy-toggle="cpu"]').click();
      await page.locator("#paid-cpu").fill("440");
      await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
      await surUneLigne(page, ".send-bar-in", "barre d'envoi");
      await ouvrirOnglet(page, "historique");
      await expect(page.locator("#hist-view button").first()).toBeVisible();
      await expect(page.locator("#hist-view button").last()).toBeVisible();
      await surUneLigne(page, "#hist-view", "Mini-courbes / Carte thermique");
    });
  });
}

test("tous les boutons visibles ont la forme pilule, 48 px de haut", async ({ page }) => {
  await ouvrir(page, "pc");
  await page.locator('[data-card="cpu"] summary').click();
  const fautifs = [];
  for (const onglet of ["pc", "achats", "reglages"]) {
    await ouvrirOnglet(page, onglet);
    const liste = await page.locator(".buy-edit, .buy-save, .buy-cancel, .local-btn:not(.seg), .shop-link, .icon-btn").evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().width > 0 && !e.closest("dialog:not([open])"))
        .map((e) => { const b = e.getBoundingClientRect(); return { t: (e.textContent || e.className).trim().slice(0, 30), r: parseFloat(getComputedStyle(e).borderTopLeftRadius), h: Math.round(b.height) }; }));
    for (const b of liste) if (b.r < 24 || b.h < 48) fautifs.push(`${onglet} « ${b.t} » rayon ${b.r} hauteur ${b.h}`);
  }
  expect(fautifs, fautifs.join("\n")).toEqual([]);
});

test("les cartes ont toutes le même arrondi (12 px) et la même marge intérieure", async ({ page }) => {
  const fautifs = [];
  for (const onglet of ["budget", "pc", "achats", "risques", "reglages"]) {
    await ouvrir(page, onglet);
    const r = await page.locator(".card, .progress-card, .stat-tile, .timeline-card, .since-visit, .crit-banner").evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => [e.className.split(" ")[0], getComputedStyle(e).borderTopLeftRadius]));
    for (const [cls, rayon] of r) if (rayon !== "12px") fautifs.push(`${onglet} .${cls} : ${rayon}`);
  }
  expect(fautifs, fautifs.join("\n")).toEqual([]);
  await page.setViewportSize({ width: 412, height: 900 });
  const pad = await page.locator(".card-pad").first().evaluate((e) => getComputedStyle(e).paddingLeft);
  expect(pad).toBe("16px");
});

test("les titres n'utilisent plus d'emoji : ce sont des pictogrammes du même jeu", async ({ page }) => {
  const emoji = /[\u{1F300}-\u{1FAFF}☀-➿⭐]/u;
  const fautifs = [];
  await ouvrir(page, "budget");
  for (const onglet of ["budget", "pc", "periph", "mobilier", "achats", "risques", "workflow", "historique", "reglages"]) {
    await ouvrirOnglet(page, onglet);
    const textes = await page.locator(`#panel-${onglet} h2, #panel-${onglet} h3, #panel-${onglet} .fold-title, #panel-${onglet} .group-warning, #panel-${onglet} .watch-item, #panel-${onglet} .phase-result`).allTextContents();
    for (const t of textes) if (emoji.test(t)) fautifs.push(`${onglet} : ${t.trim().slice(0, 40)}`);
  }
  expect(fautifs, fautifs.join("\n")).toEqual([]);
  expect(await page.locator("svg.ico").count()).toBeGreaterThan(5);
});

test("changer d'écran ferme le message d'annulation, même par le bouton Retour", async ({ page }) => {
  await ouvrir(page, "pc");
  await page.locator('[data-card="cpu"] summary').click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill("440");
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
  await expect(page.locator("#toast")).toBeVisible();
  await page.locator('.dest[data-dest="achats"]').click();
  await expect(page.locator("#toast")).toBeHidden();
});

test("le bouton Retour ferme aussi le message d'annulation", async ({ page }) => {
  await ouvrir(page, "pc");
  await page.locator('[data-card="cpu"] summary').click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill("440");
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
  await expect(page.locator("#toast")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#toast")).toBeHidden();
});

test("les boutons-icônes gardent un nom accessible", async ({ page }) => {
  await ouvrir(page, "pc");
  await page.locator('[data-card="cpu"] summary').click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill("440");
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
  await expect(page.getByRole("button", { name: /Modifier l'achat : / }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Fermer le message" })).toBeVisible();
});

test("barre de destinations : texte seul dans une pilule, sans icône, qui tient à 360 px", async ({ page }) => {
  for (const largeur of [360, 412, 700]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await ouvrir(page, "budget");
    expect(await page.locator(".destinations svg").count(), "aucun pictogramme dans la barre").toBe(0);
    const r = await page.locator(".dest").evaluateAll((els) => els.map((e) => {
      const l = e.querySelector(".dest-label"), b = e.getBoundingClientRect(), lb = l.getBoundingClientRect();
      return { t: l.textContent.trim(), h: Math.round(b.height), w: Math.round(b.width), coupe: l.scrollWidth > l.clientWidth + 1 || lb.width > b.width + 1, actif: e.classList.contains("active"), fond: getComputedStyle(l).backgroundColor };
    }));
    for (const d of r) {
      expect(d.coupe, `« ${d.t} » coupé à ${largeur}px`).toBe(false);
      expect(d.h, `« ${d.t} » trop bas`).toBeGreaterThanOrEqual(48);
      expect(d.w, `« ${d.t} » trop étroit`).toBeGreaterThanOrEqual(48);
      if (d.actif) expect(d.fond, "la destination active est en pilule").not.toBe("rgba(0, 0, 0, 0)");
      else expect(d.fond).toBe("rgba(0, 0, 0, 0)");
    }
  }
  await page.setViewportSize({ width: 412, height: 900 });
  await expect.poll(() => page.locator(".destinations").evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(72);
});

test("la carte du Budget dit « Reste à acheter », sans « avant la prime »", async ({ page }) => {
  await ouvrir(page, "budget");
  await expect(page.locator(".progress-label")).toHaveText("Reste à acheter");
  expect(await page.locator("body").innerText()).not.toContain("avant la prime");
});

// Plus aucun emoji ni symbole de texte (▲ ▼ ▸ ● ✓ ✅ ↗) dans l'interface : des pictogrammes Material à la place.
const INTERDITS = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B50\u25A0-\u25FF\u2197\uFE0F]/u;

test("aucun emoji ni symbole de texte dans l'interface, sur les 9 écrans", async ({ page }) => {
  const fautifs = [];
  await ouvrir(page, "budget");
  for (const onglet of ["budget", "pc", "periph", "mobilier", "achats", "risques", "workflow", "historique", "reglages"]) {
    await ouvrirOnglet(page, onglet);
    // textContent couvre aussi ce qui est replié ou caché : tout ce que le site peut afficher.
    const texte = await page.locator(`#panel-${onglet}`).evaluate((el) => el.textContent);
    for (const m of texte.matchAll(new RegExp(INTERDITS.source, "gu"))) fautifs.push(`${onglet} : « ${m[0]} » U+${m[0].codePointAt(0).toString(16)}`);
  }
  expect([...new Set(fautifs)], fautifs.join("\n")).toEqual([]);
});

test("chaque emoji des données a son pictogramme (sinon une boîte générique s'affiche)", async ({ page }) => {
  await ouvrir(page, "budget");
  const emojis = new Set();
  const marche = (o) => {
    if (Array.isArray(o)) o.forEach(marche);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "icon" && typeof v === "string") emojis.add(v.replace(/\uFE0F/g, "").trim()); marche(v); }
  };
  marche(BASE);
  marche(JSON.parse(readFileSync(new URL("../data/prices.json", import.meta.url), "utf-8")));   // les vraies données, pas seulement le jeu figé
  const table = await page.evaluate(() => Object.keys(EMOJI_ICON));
  const manquants = [...emojis].filter((e) => !table.includes(e));
  expect(manquants, `emojis sans pictogramme : ${manquants.join(" ")}`).toEqual([]);
  // Les symboles référencés par la table existent bien dans le sprite.
  const absents = await page.evaluate(() => [...new Set(Object.values(EMOJI_ICON))].filter((n) => !document.getElementById("i-" + n)));
  expect(absents, `symboles absents du sprite : ${absents.join(" ")}`).toEqual([]);
});

test("pictogrammes partout : chaque titre et chaque ligne de liste d'Achats, Suivi, Réglages en porte un", async ({ page }) => {
  const manques = [];
  await ouvrir(page, "budget");
  for (const onglet of ["budget", "pc", "periph", "mobilier", "achats", "historique", "risques", "workflow", "reglages"]) {
    await ouvrirOnglet(page, onglet);
    const r = await page.locator(`#panel-${onglet}`).evaluate((el) => {
      const sans = (sel, ok) => [...el.querySelectorAll(sel)].filter((e) => !e.closest(".item-card, .phase-card") && !ok(e)).map((e) => `${sel} « ${e.textContent.trim().slice(0, 30)} »`);
      const aIco = (e) => !!e.querySelector("svg.ico");
      const aPastille = (e) => !!e.querySelector(".row-ico");
      return [
        ...sans("h2, h3, .fold-title, .shop-name, .group-title, .check-group-title", aIco),
        ...sans(".shop-row, .recap-row, .risk-item, .decision-item", aPastille),
      ];
    });
    for (const m of r) manques.push(`${onglet} : ${m}`);
  }
  expect(manques, manques.join("\n")).toEqual([]);
});
