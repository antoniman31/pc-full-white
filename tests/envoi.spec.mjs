// Envoi des changements vers GitHub : token, bandeau « Envoyer », création et mise à jour de la PR.
// GitHub est simulé (aucun appel réseau réel) ; les données de base sont figées.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const API = "https://api.github.com/repos/antoniman31/pc-full-white";

// Un faux GitHub qui note chaque appel ; `prState` règle ce que répond GET /pulls/N.
async function ouvrir(page, { token = true, status = 200, prState = {} } = {}) {
  const calls = [];
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.route(`${API}**`, async (route) => {
    const req = route.request();
    const path = req.url().slice(API.length);
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, body, auth: req.headers().authorization });
    if (status !== 200) return route.fulfill({ status, json: { message: "refus" } });
    if (path === "") return route.fulfill({ json: { full_name: "antoniman31/pc-full-white" } });
    if (path.startsWith("/git/ref/")) return route.fulfill({ json: { object: { sha: "abc123" } } });
    if (path === "/git/refs") return route.fulfill({ status: 201, json: {} });
    if (path.startsWith("/contents/") && req.method() === "GET") return route.fulfill({ status: 404, json: { message: "Not Found" } });
    if (path.startsWith("/contents/")) return route.fulfill({ status: 201, json: {} });
    if (path === "/pulls") return route.fulfill({ status: 201, json: { number: 12, html_url: "https://github.com/antoniman31/pc-full-white/pull/12" } });
    if (path === "/pulls/12") return route.fulfill({ json: { state: "open", merged_at: null, ...prState } });
    return route.fulfill({ status: 500, json: { message: "inattendu" } });
  });
  if (token) await page.addInitScript(() => localStorage.setItem("pcfw-token-v1", "ghp_test"));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  return calls;
}

async function acheterCPU(page, prix = 440) {
  await page.locator('.tab[data-target="pc"]').click();
  const carte = page.locator('[data-card="cpu"]');
  if ((await carte.getAttribute("open")) === null) await carte.locator("summary").click();
  await page.locator('[data-buy-toggle="cpu"]').click();
  await page.locator("#paid-cpu").fill(String(prix));
  await page.getByRole("button", { name: /Enregistrer l'achat|Confirmer quand même/ }).click();
}

test("le bandeau n'apparaît qu'avec des changements pas encore envoyés", async ({ page }) => {
  await ouvrir(page);
  await expect(page.locator("#send-bar")).toBeHidden();
  await acheterCPU(page);
  await expect(page.locator("#send-bar")).toBeVisible();
  await expect(page.locator("#send-bar")).toContainText("1 changement pas encore envoyé");
  await expect(page.locator("#send-bar #send-now")).toBeVisible();
});

test("sans token, « Envoyer » mène au champ du token dans Budget", async ({ page }) => {
  const calls = await ouvrir(page, { token: false });
  await acheterCPU(page);
  await page.locator("#send-now").click();
  await expect(page.locator("#panel-budget")).toBeVisible();
  await expect(page.locator("#gh-token")).toBeFocused();
  expect(calls).toHaveLength(0);
});

test("un token refusé n'est pas enregistré", async ({ page }) => {
  await ouvrir(page, { token: false, status: 401 });
  await page.locator('.tab[data-target="budget"]').click();
  await page.locator("#gh-token").fill("mauvais");
  await page.getByRole("button", { name: "Enregistrer le token" }).click();
  await expect(page.locator("#local-panel")).toContainText("GitHub refuse le token");
  expect(await page.evaluate(() => localStorage.getItem("pcfw-token-v1"))).toBeNull();
});

test("envoi : branche, changes.json, Pull Request, puis bandeau masqué", async ({ page }) => {
  const calls = await ouvrir(page);
  await acheterCPU(page);
  await page.locator("#send-now").click();
  await expect(page.locator("#send-bar")).toBeHidden();
  await page.locator('.tab[data-target="budget"]').click();
  await expect(page.locator("#local-panel")).toContainText("PR n° 12");
  await expect(page.locator("#local-panel a", { hasText: "PR n° 12" })).toHaveAttribute("href", /pull\/12$/);

  const refs = calls.find(c => c.path === "/git/refs");
  expect(refs.body.sha).toBe("abc123");
  expect(refs.body.ref).toMatch(/^refs\/heads\/site-changes\/\d{14}$/);
  expect(refs.auth).toBe("Bearer ghp_test");
  const put = calls.find(c => c.method === "PUT");
  expect(put.path).toBe("/contents/data/changes.json");
  expect(put.body.branch).toBe(refs.body.ref.replace("refs/heads/", ""));
  const doc = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf-8"));
  expect(doc.version).toBe(1);
  expect(doc.items.cpu).toMatchObject({ status: "bought", paid: 440 });
  const pr = calls.find(c => c.path === "/pulls");
  expect(pr.body).toMatchObject({ base: "main", head: put.body.branch });
  expect(pr.body.body).toContain("Acheté : ");
});

test("un changement de plus met à jour la même PR au lieu d'en ouvrir une autre", async ({ page }) => {
  const calls = await ouvrir(page);
  await acheterCPU(page);
  await page.locator("#send-now").click();
  await expect(page.locator("#send-bar")).toBeHidden();

  await page.locator('.tab[data-target="pc"]').click();
  await page.locator('[data-card="cpu"] [data-item-edit]').click();
  await page.locator("#iname-cpu").fill("Autre CPU");
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.locator("#send-bar")).toBeVisible();
  await page.locator("#send-now").click();
  await expect(page.locator("#send-bar")).toBeHidden();

  expect(calls.filter(c => c.path === "/pulls" && c.method === "POST")).toHaveLength(1);
  expect(calls.filter(c => c.path === "/git/refs")).toHaveLength(1);
  const puts = calls.filter(c => c.method === "PUT");
  expect(puts).toHaveLength(2);
  expect(puts[1].body.branch).toBe(puts[0].body.branch);
});

test("PR fusionnée : l'état s'affiche et on peut vider la liste locale", async ({ page }) => {
  await ouvrir(page, { prState: { state: "closed", merged_at: "2026-11-01T10:00:00Z" } });
  await acheterCPU(page);
  await page.locator("#send-now").click();
  await expect(page.locator("#send-bar")).toBeHidden();
  await page.reload();
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
  await page.locator('.tab[data-target="budget"]').click();
  await expect(page.locator("#local-panel")).toContainText("fusionnée");
  await page.locator("#gh-clean").click();
  await expect(page.locator("#local-panel")).not.toContainText("PR n° 12");
  await expect(page.locator("#local-panel")).toContainText("Liste locale vidée");
  expect(await page.evaluate(() => localStorage.getItem("pcfw-sent-v1"))).toBeNull();
});

test("échec de l'envoi : message d'erreur, changements gardés, bandeau toujours là", async ({ page }) => {
  await ouvrir(page, { status: 403 });
  await acheterCPU(page);
  await page.locator("#send-now").click();
  await expect(page.locator("#send-bar")).toContainText("n'a pas les droits");
  await expect(page.locator("#send-now")).toBeEnabled();
});
