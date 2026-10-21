// Contrôle d'accessibilité : axe-core sur chaque onglet, plus les vérifications
// qu'axe ne fait pas (taille des cibles tactiles, parcours clavier réel).
//
// Les .mjs évitent d'ajouter "type": "module" au package.json, qui changerait la
// façon dont `node --check site/app.js` interprète le fichier du site.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
      `#panel-${onglet} button, #panel-${onglet} a[href], .tab, .footer-btn, .footer a`
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
