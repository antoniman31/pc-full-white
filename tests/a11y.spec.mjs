// Contrôle d'accessibilité : axe-core sur chaque onglet, plus les vérifications
// qu'axe ne fait pas (taille des cibles tactiles, parcours clavier réel).
//
// Les .mjs évitent d'ajouter "type": "module" au package.json, qui changerait la
// façon dont `node --check site/app.js` interprète le fichier du site.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

const ONGLETS = ["budget", "pc", "periph", "mobilier", "risques", "workflow", "historique"];

// Attendre que app.js ait fini d'injecter le contenu : tant que le montant du
// hero vaut son tiret de remplissage, rien n'est rendu.
async function attendreRendu(page) {
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}

test.describe("axe-core", () => {
  for (const onglet of ONGLETS) {
    test(`onglet ${onglet} sans violation`, async ({ page }) => {
      await attendreRendu(page);
      await page.locator(`.tab[data-target="${onglet}"]`).click();
      await expect(page.locator(`#panel-${onglet}`)).toBeVisible();

      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      // Message lisible en CI : sans ça, l'échec ne dit pas quelle règle a sauté.
      const resume = violations.map(v => `${v.id} (${v.nodes.length}) — ${v.help}`);
      expect(resume, resume.join("\n")).toEqual([]);
    });
  }
});

test("la checklist se coche entièrement au clavier", async ({ page }) => {
  await attendreRendu(page);
  await page.locator('.tab[data-target="workflow"]').click();

  // Déplier la première phase au clavier depuis son bouton d'en-tête.
  const entete = page.locator(".phase-header").first();
  await entete.focus();
  await expect(entete).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(entete).toHaveAttribute("aria-expanded", "true");

  // Cocher la première case à la barre d'espace, puis décocher.
  const case1 = page.locator(".phase-card.open .check-row").first();
  await case1.focus();
  await expect(case1).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Space");
  await expect(case1).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Space");
  await expect(case1).toHaveAttribute("aria-checked", "false");
});

test("le cochage survit à un rechargement", async ({ page }) => {
  await attendreRendu(page);
  await page.locator('.tab[data-target="workflow"]').click();
  await page.locator(".phase-header").first().click();

  const cle = await page.locator(".phase-card.open .check-row").first().getAttribute("data-key");
  await page.locator(".phase-card.open .check-row").first().click();

  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—");
  await expect(page.locator(`.check-row[data-key="${cle}"]`)).toHaveAttribute("aria-checked", "true");
});

test("les onglets se parcourent aux flèches", async ({ page }) => {
  await attendreRendu(page);
  const premier = page.locator(".tab").first();
  await premier.focus();
  await expect(premier).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowRight");
  const second = page.locator('.tab[data-target="pc"]');
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(premier).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("End");
  await expect(page.locator('.tab[data-target="historique"]')).toHaveAttribute("aria-selected", "true");
});

test("le bouton Retour revient à l'onglet précédent", async ({ page }) => {
  await attendreRendu(page);
  await page.locator('.tab[data-target="pc"]').click();
  await page.locator('.tab[data-target="risques"]').click();
  await expect(page).toHaveURL(/#risques$/);

  await page.goBack();
  await expect(page.locator('.tab[data-target="pc"]')).toHaveAttribute("aria-selected", "true");
});

test("toute cible interactive mesure au moins 48px", async ({ page }) => {
  await attendreRendu(page);

  const trop_petites = [];
  for (const onglet of ONGLETS) {
    await page.locator(`.tab[data-target="${onglet}"]`).click();

    // Déplier les phases pour que les cases de la checklist soient mesurables.
    if (onglet === "workflow") {
      const entetes = await page.locator(".phase-header").all();
      for (const e of entetes) await e.click();
    }

    const cibles = await page.locator(
      `#panel-${onglet} button, #panel-${onglet} a[href], .tab, #theme-btn, .footer-btn, .footer a`
    ).all();

    for (const cible of cibles) {
      if (!(await cible.isVisible())) continue;
      const box = await cible.boundingBox();
      if (!box) continue;
      if (box.height < 48 || box.width < 48) {
        const texte = (await cible.textContent() || "").trim().slice(0, 40);
        trop_petites.push(`[${onglet}] "${texte}" → ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
  }

  expect(trop_petites, trop_petites.join("\n")).toEqual([]);
});

test("aucun débordement horizontal, de 320 à 1440px", async ({ page }) => {
  const debordements = [];
  for (const largeur of [320, 360, 600, 768, 840, 1024, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await attendreRendu(page);

    for (const onglet of ONGLETS) {
      await page.locator(`.tab[data-target="${onglet}"]`).click();
      if (onglet === "workflow") {
        for (const entete of await page.locator(".phase-header").all()) await entete.click();
      }
      const trop_large = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth + 1
          ? `${document.documentElement.scrollWidth}px de contenu`
          : null);
      if (trop_large) debordements.push(`${largeur}px [${onglet}] → ${trop_large}`);
    }
  }
  expect(debordements, debordements.join("\n")).toEqual([]);
});

// --- Lot 2 : conformité du CSS au système Material 3 ---------------------------
// Ces contrôles lisent la feuille de style : ils attrapent une valeur hors échelle
// dès qu'elle est écrite, sans dépendre du rendu.
const CSS = readFileSync(new URL("../site/style.css", import.meta.url), "utf-8");

test("toute taille de police passe par l'échelle typographique", () => {
  const hors_echelle = [...CSS.matchAll(/^\s*font-size:\s*([^;]+);/gm)]
    .map(m => m[1].trim())
    .filter(v => !/^var\(--(type-[a-z-]+|icon-size)\)$/.test(v));
  expect(hors_echelle, hors_echelle.join("\n")).toEqual([]);
});

test("l'échelle ne contient ni taille fractionnaire ni taille sous 11px", () => {
  const tailles = [...CSS.matchAll(/--type-[a-z-]+:\s*([^;]+);/g)].map(m => m[1].trim());
  expect(tailles.length).toBeGreaterThan(0);
  const fautives = tailles.filter(v => {
    if (v.startsWith("clamp(")) return false; // fluide par construction
    const px = parseFloat(v);
    return !Number.isInteger(px) || px < 11;
  });
  expect(fautives, fautives.join("\n")).toEqual([]);
});

test("les points de rupture sont ceux des window size classes (600 / 840 / 1200)", () => {
  const largeurs = [...CSS.matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
  const hors_classes = largeurs.filter(w => ![599, 600, 839, 840, 1199, 1200].includes(w));
  expect(hors_classes, hors_classes.join(", ")).toEqual([]);
});

test("les éléments interactifs réagissent au survol par une couche d'état", async ({ page, isMobile }) => {
  test.skip(isMobile, "pas de survol sur un écran tactile");
  await attendreRendu(page);

  const inactif = page.locator('.tab:not(.active)').first();
  const avant = await inactif.evaluate(el => getComputedStyle(el).backgroundColor);
  await inactif.hover();
  const apres = await inactif.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(avant).toBe("rgba(0, 0, 0, 0)");
  expect(apres).not.toBe(avant);

  // Une ligne de liste qui ne se clique pas ne doit pas réagir.
  await page.locator('.tab[data-target="pc"]').click();
  const ligne = page.locator("#pc-components-list .item-row").first();
  await ligne.hover();
  expect(await ligne.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});

// --- Lot 3 : thème sombre ------------------------------------------------------
const fond = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const CLAIR = "rgb(247, 249, 252)";   // --paper-off en clair
const SOMBRE = "rgb(15, 20, 32)";     // --paper-off en sombre

test.describe("thème sombre (préférence système)", () => {
  test.use({ colorScheme: "dark" });

  test("le site suit le système sans rien avoir choisi", async ({ page }) => {
    await attendreRendu(page);
    expect(await fond(page)).toBe(SOMBRE);
  });

  for (const onglet of ONGLETS) {
    test(`onglet ${onglet} sans violation en sombre`, async ({ page }) => {
      await attendreRendu(page);
      await page.locator(`.tab[data-target="${onglet}"]`).click();
      await expect(page.locator(`#panel-${onglet}`)).toBeVisible();

      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const resume = violations.map(v => `${v.id} (${v.nodes.length}) — ${v.help}`);
      expect(resume, resume.join("\n")).toEqual([]);
    });
  }

  test("un choix manuel « clair » l'emporte sur le système", async ({ page }) => {
    await attendreRendu(page);
    const bouton = page.locator("#theme-btn");
    await bouton.click(); // auto -> clair
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await fond(page)).toBe(CLAIR);
  });
});

test("le bouton parcourt auto, clair, sombre, et le choix survit au rechargement", async ({ page }) => {
  await attendreRendu(page);
  const html = page.locator("html");
  const bouton = page.locator("#theme-btn");

  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await expect(bouton).toHaveAttribute("aria-label", /automatique.*clair/);

  await bouton.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(bouton).toHaveAttribute("aria-label", /clair.*sombre/);
  await expect(page.locator("#theme-status")).toHaveText("Thème clair");

  await bouton.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await fond(page)).toBe(SOMBRE);

  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.locator("#theme-btn").click(); // retour en auto
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
});

test("le bouton de thème s'active au clavier", async ({ page }) => {
  await attendreRendu(page);
  await page.locator("#theme-btn").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("l'impression repasse en clair même en thème sombre", async ({ page }) => {
  await attendreRendu(page);
  await page.locator("#theme-btn").click();
  await page.locator("#theme-btn").click(); // sombre
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ media: "print" });
  expect(await fond(page)).toBe("rgb(255, 255, 255)");
});

test("la liste d'onglets garde une largeur utilisable de 600 à 1440px", async ({ page }) => {
  // La pastille de vérification (~370px) l'écrasait à moins de 150px : sept onglets
  // dans une fenêtre où l'on n'en voyait pas deux.
  const trop_etroits = [];
  for (const largeur of [600, 768, 840, 1024, 1199, 1200, 1440]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await attendreRendu(page);
    const w = await page.locator(".tabs").evaluate(el => el.clientWidth);
    if (w < 300) trop_etroits.push(`${largeur}px → liste d'onglets large de ${w}px`);
  }
  expect(trop_etroits, trop_etroits.join("\n")).toEqual([]);
});
