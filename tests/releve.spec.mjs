// Lancer un relevé des prix depuis Réglages : confirmation, déclenchement du workflow, suivi, erreurs de droits.
// GitHub est simulé (aucun appel réseau réel) ; les données de base sont figées.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const API = "https://api.github.com/repos/antoniman31/pc-full-white";
const RUN_FINI = { id: 9, event: "workflow_dispatch", status: "completed", conclusion: "success", created_at: "2099-01-01T00:00:00Z", updated_at: "2099-01-01T00:05:00Z", html_url: "https://github.com/antoniman31/pc-full-white/actions/runs/9" };

// `runs` : ce que répond la liste des exécutions ; `dispatch` : statut de la réponse au lancement.
async function ouvrir(page, { token = true, runs = [], dispatch = 204, prs = [] } = {}) {
  const calls = [];
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.route(`${API}**`, async (route) => {
    const req = route.request();
    const path = req.url().slice(API.length);
    calls.push({ method: req.method(), path, body: req.postData() ? JSON.parse(req.postData()) : null });
    if (path.endsWith("/dispatches")) return route.fulfill({ status: dispatch, json: dispatch === 204 ? undefined : { message: "refus" } });
    if (path.includes("/actions/workflows/update-prices.yml/runs")) return route.fulfill({ json: { workflow_runs: runs } });
    if (path.startsWith("/pulls?")) return route.fulfill({ json: prs });
    return route.fulfill({ status: 500, json: { message: "inattendu" } });
  });
  if (token) await page.addInitScript(() => localStorage.setItem("pcfw-token-v1", "ghp_test"));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await ouvrirOnglet(page, "reglages");
  await expect(page.locator("#releve-run [data-releve]").first()).toBeVisible();
  return calls;
}

test("deux boutons, confirmation avant lancement, puis le workflow est déclenché en mode releve", async ({ page }) => {
  const calls = await ouvrir(page);
  await expect(page.locator("#releve-run [data-releve]")).toHaveCount(2);
  await page.locator('[data-releve="releve"]').click();
  await expect(page.locator(".releve-confirm")).toContainText("SerpApi");
  expect(calls.some((c) => c.path.endsWith("/dispatches"))).toBe(false);   // rien n'est lancé sans confirmation
  await page.locator("#releve-go").click();
  await expect(page.locator("#releve-msg")).toContainText("Relevé lancé");
  const d = calls.find((c) => c.path.endsWith("/dispatches"));
  expect(d.method).toBe("POST");
  expect(d.body).toEqual({ ref: "main", inputs: { mode: "releve" } });
  await expect(page.locator('[data-releve]').first()).toBeDisabled();       // pas de second lancement pendant le relevé
});

test("Annuler ne lance rien, et l'essai part en mode essai", async ({ page }) => {
  const calls = await ouvrir(page);
  await page.locator('[data-releve="releve"]').click();
  await page.locator("#releve-no").click();
  await expect(page.locator(".releve-confirm")).toHaveCount(0);
  expect(calls.some((c) => c.path.endsWith("/dispatches"))).toBe(false);
  await page.locator('[data-releve="essai"]').click();
  await expect(page.locator(".releve-confirm")).toContainText("ne modifie rien");
  await page.locator("#releve-go").click();
  await expect.poll(() => calls.find((c) => c.path.endsWith("/dispatches"))?.body?.inputs?.mode).toBe("essai");
});

test("sans le droit Actions, le message dit quoi corriger", async ({ page }) => {
  await ouvrir(page, { dispatch: 403 });
  await page.locator('[data-releve="releve"]').click();
  await page.locator("#releve-go").click();
  await expect(page.locator("#releve-msg")).toContainText("Actions : écriture");
  await expect(page.locator('[data-releve]').first()).toBeEnabled();
});

test("sans token, le bouton renvoie vers la saisie du token", async ({ page }) => {
  const calls = await ouvrir(page, { token: false });
  await page.locator('[data-releve="releve"]').click();
  await page.locator("#releve-go").click();
  await expect(page.locator("#gh-token")).toBeFocused();
  expect(calls.some((c) => c.path.endsWith("/dispatches"))).toBe(false);
});

test("le dernier lancement s'affiche, et un relevé en cours bloque les boutons", async ({ page }) => {
  await ouvrir(page, { runs: [{ ...RUN_FINI }] });
  await expect(page.locator("#releve-msg")).toContainText("Dernier lancement");
  await expect(page.locator("#releve-msg")).toContainText("réussi");
  await expect(page.locator("#releve-msg a")).toHaveAttribute("href", RUN_FINI.html_url);
  const p2 = await page.context().newPage();
  await ouvrir(p2, { runs: [{ ...RUN_FINI, status: "in_progress", conclusion: null }] });
  await expect(p2.locator("#releve-msg")).toContainText("en cours");
  await expect(p2.locator('[data-releve]').first()).toBeDisabled();
});

test("les boutons tiennent sur une ligne à 360 px et gardent 48 px de haut", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await ouvrir(page);
  const boites = await page.locator("#releve-run .local-actions button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect()));
  expect(boites).toHaveLength(2);
  expect(Math.abs(boites[0].top - boites[1].top)).toBeLessThan(2);
  for (const b of boites) expect(b.height).toBeGreaterThanOrEqual(47);
});
