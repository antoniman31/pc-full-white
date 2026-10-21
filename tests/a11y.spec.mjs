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
      `#panel-${onglet} button, #panel-${onglet} a[href], .tab, #theme-btn, #panel-${onglet} summary, .footer-btn, .footer a`
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

// --- Lot 4 : parité de contenu avec les PDF -----------------------------------
const aller = async (page, onglet) => {
  await attendreRendu(page);
  await page.locator(`.tab[data-target="${onglet}"]`).click();
};

test("le haut de page montre donut, avancement, cartes 2026/2027 et marge PC", async ({ page }) => {
  await attendreRendu(page);
  const donut = page.locator("#donut svg");
  await expect(donut).toHaveAttribute("role", "img");
  await expect(donut).toHaveAttribute("aria-label", /Répartition du budget total.*PC.*Périphériques.*Mobilier.*déjà payés/);
  await expect(page.locator(".donut-hatch")).toHaveCount(1);
  await expect(page.locator("#category-split .split-item")).toHaveCount(3);
  await expect(page.locator(".split-sub")).toContainText("déjà payés");

  const spend = page.locator("#spend-track");
  await expect(spend).toHaveAttribute("role", "progressbar");
  expect(Number(await spend.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await expect(page.locator("#spend-caption")).toContainText("déjà dépensés");

  await expect(page.locator(".timeline-card")).toHaveCount(2);
  await expect(page.locator("#timeline")).toContainText("Bureau + Mobilier");
  await expect(page.locator("#timeline")).toContainText("PC + Périphériques");
  await expect(page.locator("#stat-pcmargin")).toContainText("224");
});

test("l'ordre d'achat liste cinq étapes dans l'onglet Budget", async ({ page }) => {
  await attendreRendu(page);
  await expect(page.locator("#purchase-order li")).toHaveCount(5);
  await expect(page.locator("#purchase-order li").first()).toContainText("Cornières");
});

test("le récap des achats totalise le reste à acheter", async ({ page }) => {
  await aller(page, "historique");
  await expect(page.locator("#recap-title")).toContainText(/4.?699/);
  await expect(page.locator("#recap-body tr")).toHaveCount(10); // 9 lignes + total
  await expect(page.locator("#bought-title")).toContainText(/421/);
  await expect(page.locator("#levers")).toContainText("GPU Eagle ICE −159 €");
  await expect(page.locator("#levers")).toContainText("CPU +25 €");
});

test("l'historique détaillé a une colonne par relevé et le bon total", async ({ page }) => {
  await aller(page, "historique");
  // Composant + 8 relevés + Évolution
  await expect(page.locator("#history-head th")).toHaveCount(10);
  await expect(page.locator("#history-components-body tr")).toHaveCount(10); // 9 composants + total
  const total = page.locator("#history-components-body tr.total-row");
  await expect(total).toContainText(/3.?249/);
  await expect(total).toContainText(/3.?551/);
  await expect(total).toContainText("+302");
  await expect(page.locator("#history-components-body")).toContainText("introuvable");
});

test("les notes de vérification citent sources, risque principal et priorité", async ({ page }) => {
  await aller(page, "historique");
  const v = page.locator("#verification");
  await expect(v).toContainText("LDLC");
  await expect(v).toContainText("Risque principal");
  await expect(v).toContainText("Priorité actuelle");
  await expect(v).toContainText("Veille GPU");
});

test("le stockage affiche le 990 PRO à 2 To et un total cohérent", async ({ page }) => {
  await aller(page, "pc");
  await expect(page.locator("#stockage-title")).toHaveText("Stockage — ~9 To");
  await expect(page.locator("#stockage-table-body tr").first()).toContainText("2 To");
  await expect(page.locator("#stockage-smart-th")).toContainText("04/05/2026");
  await expect(page.locator("#stockage-warning")).toContainText("SMR");
  await expect(page.locator("#stockage-tip")).toContainText("SATA 2");
  await expect(page.locator("#airflow-summary")).toContainText("6E/4S");
  await expect(page.locator("#airflow-note")).toContainText("Pression positive");
});

test("les périphériques ont des caractéristiques dépliables au clavier", async ({ page }) => {
  await aller(page, "periph");
  await expect(page.locator("#screens-note")).toContainText("aucun câble à acheter");
  const resume = page.locator("#periph-list .item-specs summary").first();
  await resume.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#periph-list details[open]")).toHaveCount(1);
  await expect(page.locator("#periph-list")).toContainText("36 Ω");
  await expect(page.locator("#periph-list")).toContainText("480×854");
});

test("le workflow porte pièges, dépannage, achat groupé et fin de montage", async ({ page }) => {
  await aller(page, "workflow");
  await expect(page.locator("#workflow-subtitle")).toContainText("Mai-Juin 2027");
  await expect(page.locator("#phase-list")).toContainText("Achat groupé recommandé");
  await expect(page.locator("#phase-list")).toContainText("Pièges courants");
  await expect(page.locator("#phase-list")).toContainText("BSOD pendant OCCT");
  await expect(page.locator("#phase-list")).toContainText("Sonar");
  await expect(page.locator("#workflow-finale")).toContainText("Setup terminé");
  await expect(page.locator("#workflow-finale")).toContainText("Photos pour l'historique");
  await expect(page.locator("#workflow-finale")).toContainText("Rangement backup voyage");
});

// --- Polices auto-hébergées ----------------------------------------------------
test("aucune requête vers un tiers : tout est servi par le site", async ({ page }) => {
  const externes = [];
  page.on("request", (r) => {
    const hote = new URL(r.url()).hostname;
    if (hote !== "127.0.0.1" && hote !== "localhost") externes.push(r.url());
  });
  await attendreRendu(page);
  for (const onglet of ONGLETS) await page.locator(`.tab[data-target="${onglet}"]`).click();
  expect(externes, externes.join("\n")).toEqual([]);
});

test("les trois polices se chargent depuis le site", async ({ page }) => {
  await attendreRendu(page);
  const chargees = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
  });
  expect(chargees).toEqual(expect.arrayContaining(["Inter", "Space Grotesk", "JetBrains Mono"]));
});

test("la note de l'historique affiche le prochain passage et le bilan du dernier relevé", async ({ page }) => {
  // On injecte ce que le scraper écrit (meta.last_run, next_verification en date complète).
  await page.route("**/data/prices.json", async (route) => {
    const reponse = await route.fetch();
    const data = await reponse.json();
    data.meta.next_verification = "2026-11-15";
    data.meta.last_run = { date: "2026-11-01", tracked: 29, verified: 12, updated: 3 };
    await route.fulfill({ response: reponse, json: data });
  });
  await aller(page, "historique");
  const note = page.locator("#history-note");
  await expect(note).toContainText("Prochaine vérification : 15 novembre 2026");
  await expect(note).toContainText("12 prix vérifiés sur 29 articles suivis, 3 mis à jour");
});

test.describe("liens « Où acheter »", () => {
  // On injecte ce que le scraper écrit (offers) : sans relevé réel, le site n'en a pas encore.
  const offres = [
    { retailer: "LDLC", url: "https://www.ldlc.com/fiche/PB00000000.html", price: 396, seen: "2026-11-01" },
    { retailer: "Materiel.net", url: "https://www.materiel.net/produit/x.html", price: 389.9, seen: "2026-11-01" },
    { retailer: "Fnac", url: "https://www.fnac.com/produit/x", price: null },
  ];
  test.beforeEach(async ({ page }) => {
    await page.route("**/data/prices.json", async (route) => {
      const reponse = await route.fetch();
      const data = await reponse.json();
      data.pc_components.find(c => c.id === "cpu").offers = offres;
      await route.fulfill({ response: reponse, json: data });
    });
  });

  test("liens triés par prix, ouverts dans un nouvel onglet, cibles de 48px", async ({ page }) => {
    await aller(page, "pc");
    const bloc = page.locator("#panel-pc .item-offers");
    await expect(bloc).toHaveCount(1);
    await bloc.locator("summary").click();
    const liens = bloc.locator("a.offer-link");
    await expect(liens).toHaveCount(3);
    await expect(liens.first()).toHaveAttribute("href", offres[1].url);   // le moins cher d'abord
    await expect(liens.last()).toContainText("prix sur le site");        // sans prix : en dernier
    for (const lien of await liens.all()) {
      await expect(lien).toHaveAttribute("target", "_blank");
      await expect(lien).toHaveAttribute("rel", /noopener/);
      expect((await lien.boundingBox()).height).toBeGreaterThanOrEqual(48);
    }
    await expect(liens.first()).toContainText("s'ouvre dans un nouvel onglet");
  });

  for (const theme of ["light", "dark"]) {
    test(`sans violation axe (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await aller(page, "pc");
      await page.locator("#panel-pc .item-offers summary").click();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const resume = violations.map(v => `${v.id} (${v.nodes.length}) — ${v.help}`);
      expect(resume, resume.join("\n")).toEqual([]);
    });
  }
});
