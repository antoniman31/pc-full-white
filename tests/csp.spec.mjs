// Politique de sécurité du contenu : le site marche entièrement avec elle, et elle bloque ce qui n'est pas à lui.
import { test, expect } from "@playwright/test";
import { ouvrirOnglet } from "./nav.mjs";
import { readFileSync } from "node:fs";

const BASE = JSON.parse(readFileSync(new URL("../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));

async function ouvrir(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} : ${e.blockedURI}`));
  });
  await page.route("**/data/prices.json", (route) => route.fulfill({ json: structuredClone(BASE) }));
  await page.goto("/site/");
  await expect(page.locator("#progress-cur")).not.toHaveText("—", { timeout: 10_000 });
}

test("la politique est posée, et le site marche sans aucune violation sur les 9 écrans", async ({ page }) => {
  await ouvrir(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self' 'sha256-");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);   // la seule protection qui compte : pas de script en ligne arbitraire
  for (const onglet of ["budget", "pc", "periph", "mobilier", "achats", "historique", "workflow", "risques", "reglages"]) await ouvrirOnglet(page, onglet);
  expect(await page.evaluate(() => window.__csp), "violations de la politique").toEqual([]);
  // Le script du <head> (thème avant le premier rendu) est bien autorisé par son empreinte.
  await page.addInitScript(() => localStorage.setItem("pcfw-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("un script injecté dans la page ne s'exécute pas, et une requête vers un site tiers est refusée", async ({ page }) => {
  await ouvrir(page);
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__pwned = true";
    document.body.appendChild(s);
    document.body.insertAdjacentHTML("beforeend", '<img src="x" onerror="window.__pwned2 = true">');
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => [window.__pwned, window.__pwned2])).toEqual([undefined, undefined]);
  const refuse = await page.evaluate(() => fetch("https://example.com/").then(() => false, () => true));
  expect(refuse, "fetch vers example.com").toBe(true);
  expect((await page.evaluate(() => window.__csp)).join("\n")).toContain("connect-src");
});

test("la politique garde l'empreinte du script du head à jour", async () => {
  const { execFileSync } = await import("node:child_process");
  expect(() => execFileSync("python3", ["scripts/stamp_assets.py", "--check"], { cwd: new URL("..", import.meta.url).pathname })).not.toThrow();
});
