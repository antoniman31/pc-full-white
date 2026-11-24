// Aucune couleur écrite en dur dans site/style.css hors des définitions de jetons (règle commune « Design », 24/11/2026).
// Pourquoi : à l'audit, 6 couleurs étaient écrites dans les règles (un dégradé, des ombres, un voile, le fond du schéma
// de flux d'air) au lieu d'un jeton : le thème ne pouvait pas les corriger et rien ne le voyait. Lancer : node --test tests/unit/couleurs.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../site/style.css", import.meta.url), "utf-8");
const COULEUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

function couleursEnDur(source) {
  const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const trouvees = [];
  sansCommentaires.split("\n").forEach((ligne, i) => {
    // Une définition de jeton (« --am31-blue: #5493FF; ») est l'endroit où une couleur doit vivre.
    const horsJetons = ligne.replace(/--[\w-]+\s*:[^;]*;/g, "");
    for (const m of horsJetons.matchAll(COULEUR)) trouvees.push(`site/style.css:${i + 1} ${m[0]}`);
  });
  return trouvees;
}

test("aucune couleur en dur dans site/style.css hors des définitions de jetons", () => {
  assert.deepEqual(couleursEnDur(css), [], "couleur à passer en jeton --…");
});

test("le détecteur voit une couleur et ignore jetons et commentaires", () => {
  // Le contrôle du contrôle : une expression cassée donnerait du vert partout.
  assert.equal(couleursEnDur(".a { background: #fff; box-shadow: 0 0 2px rgba(0,0,0,.5); }").length, 2);
  assert.deepEqual(couleursEnDur(":root { --x: light-dark(#fff, #000); }"), []);
  assert.deepEqual(couleursEnDur("/* était #8b93a7 */ .a { color: var(--ink); }"), []);
});
