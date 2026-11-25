// Onglet Réglages : envoi GitHub, changements locaux, thème, relevé, impression, notes de vérification.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));

async function ouvrir(page) {
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}

test("Réglages est le dernier onglet et regroupe les réglages", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator(".tab").last()).toHaveAttribute("data-target", "reglages");
  await ouvrirOnglet(page, "reglages");
  const panneau = page.locator("#panel-reglages");
  await expect(panneau.getByRole("heading", { name: "Envoyer vers le dépôt" })).toBeVisible();
  await expect(panneau.getByRole("heading", { name: "Mes changements sur cet appareil" })).toBeVisible();
  await expect(panneau.getByRole("heading", { name: "Apparence" })).toBeVisible();
  await expect(panneau.getByRole("heading", { name: "Relevé des prix" })).toBeVisible();
  await expect(panneau.locator("#fold-verification summary")).toContainText("Notes de vérification");
  await expect(panneau.locator("#print-btn")).toBeVisible();
});

// Règle commune « Interface » (25/11/2026) : Réglages se termine par la mention et la version publiée. Le site est publié
// depuis main sans build : la version est le dernier commit de site/, lue sur l'API publique de GitHub, sans token, et
// seulement au bouton « Voir la version » (aucune requête vers GitHub avant un clic, choix d'Antoni).
test("À propos : mention affichée, version lue sur GitHub au clic seulement, sans token", async ({ page }) => {
  const demandes = [];
  await page.route("https://api.github.com/**", (route) => {
    demandes.push({ url: route.request().url(), auth: route.request().headers().authorization });
    return route.fulfill({ status: 200, json: [{ sha: "a1b2c3d4e5f6", commit: { committer: { date: "2026-12-31T23:30:00Z" } } }] });
  });
  await page.addInitScript(() => localStorage.setItem("pcfw-token-v1", "jeton-de-test"));
  await ouvrir(page);
  await ouvrirOnglet(page, "reglages");
  await expect(page.locator("#mention-version")).toHaveText("Fait par AntoniMan31/Claude Code");
  expect(demandes.filter((d) => d.url.includes("/commits?"))).toHaveLength(0);
  await page.locator("#version-btn").click();
  await expect(page.locator("#mention-version")).toHaveText("Fait par AntoniMan31/Claude Code · version a1b2c3d du 01/01/2027");
  const lues = demandes.filter((d) => d.url.includes("/commits?"));
  expect(lues).toHaveLength(1);
  expect(lues[0].url).toContain("path=site");
  expect(lues[0].auth).toBeUndefined();
});

test("À propos : « version inconnue » si GitHub ne répond pas", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 503, json: {} }));
  await ouvrir(page);
  await ouvrirOnglet(page, "reglages");
  await page.locator("#version-btn").click();
  await expect(page.locator("#mention-version")).toHaveText("Fait par AntoniMan31/Claude Code · version inconnue");
});

test("Budget n'a plus ni titre visible, ni phrase, ni panneau des changements", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#panel-budget #local-panel")).toHaveCount(0);
  await expect(page.locator("#panel-budget")).not.toContainText("Le budget se suit sur ce qu'il reste à acheter");
  await expect(page.locator("#panel-budget .hero-eyebrow")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveClass(/sr-only/);
});

test("le thème se choisit dans Réglages et reste synchronisé avec l'icône du haut", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "reglages");
  await expect(page.locator('[data-theme-choice="auto"]')).toHaveAttribute("aria-checked", "true");
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-theme-choice="auto"]')).toHaveAttribute("aria-checked", "false");
  await page.locator("#theme-btn").click(); // sombre -> auto
  await expect(page.locator('[data-theme-choice="auto"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  await page.locator('[data-theme-choice="light"]').click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("le relevé indique les dates et l'usage SerpApi", async ({ page }) => {
  await ouvrir(page);
  await ouvrirOnglet(page, "reglages");
  const info = page.locator("#releve-info");
  await expect(info).toContainText("Dernière mise à jour des prix");
  await expect(info).toContainText("Prochain relevé");
});

test("l'impression n'inclut pas l'onglet Réglages", async ({ page }) => {
  await ouvrir(page);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#panel-reglages")).toBeHidden();
  await expect(page.locator("#panel-budget")).toBeVisible();
});
