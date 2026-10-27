// Tests unitaires de la logique pure de app.js (nettoyage des changements locaux, calcul du budget).
// Pas de navigateur : les blocs repérés par « >>> logique pure » / « <<< fin logique pure » sont extraits du
// fichier et exécutés dans un contexte vide. Lancer : node --test tests/unit/logique.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../site/app.js", import.meta.url), "utf-8");
const blocs = [...src.matchAll(/\/\/ >>> logique pure[^\n]*\n([\s\S]*?)\n\/\/ <<< fin logique pure/g)].map((m) => m[1]);
assert.ok(blocs.length >= 4, `blocs de logique pure trouvés : ${blocs.length}`);
const L = vm.runInNewContext(
  blocs.join("\n") + "\n({ round2, priceOK, priceOf, isLeft, sumLeft, sumBought, cleanOverlay, recomputeBudget, recomputeRecap, ITEM_SECTIONS })",
  {},
);
const BASE = JSON.parse(readFileSync(new URL("../../scraper/tests/fixtures/prices_baseline.json", import.meta.url), "utf-8"));
const copie = () => structuredClone(BASE);
// Les objets créés dans le contexte vm ont d'autres prototypes : on compare des copies JSON.
const json = (x) => JSON.parse(JSON.stringify(x));

test("round2 et priceOK", () => {
  assert.equal(L.round2(1.005 * 100), 100.5);
  assert.equal(L.round2(2.346), 2.35);
  for (const v of [0, -1, NaN, Infinity, "12", null, undefined, 100000, 1e6]) assert.equal(L.priceOK(v), false, String(v));
  for (const v of [0.01, 12, 99999.99]) assert.equal(L.priceOK(v), true, String(v));
});

test("priceOf : prix fixe, milieu d'une fourchette, sinon 0", () => {
  assert.equal(L.priceOf({ price: 450 }), 450);
  assert.equal(L.priceOf({ price: 0 }), 0);
  assert.equal(L.priceOf({ price_min: 100, price_max: 200 }), 150);
  assert.equal(L.priceOf({}), 0);
});

test("cleanOverlay rejette ce qui n'est pas un fichier de changements valide", () => {
  for (const raw of [null, undefined, "x", 42, [], {}, { version: 2, items: {} }, { version: "1" }]) assert.equal(L.cleanOverlay(raw), null, JSON.stringify(raw));
});

test("cleanOverlay écarte les identifiants dangereux et les achats sans prix valable", () => {
  const raw = {
    version: 1,
    items: {
      cpu: { status: "bought", paid: 449.999, vendor: "  LDLC  ", date: "2026-10-21" },
      "__proto__": { status: "to_buy" },
      "a b": { status: "to_buy" },
      ram: { status: "bought", paid: -5 },
      gpu: { status: "bought", paid: "1400" },
      ssd: { price: null },
      alim: { price: 129.994, name: "  Alim  ", model: "x".repeat(300) },
      os: { date: "n'importe quoi", status: "bought", paid: 10, vendor: "y".repeat(100) },
      vide: { rien: true },
    },
  };
  const out = json(L.cleanOverlay(raw));
  assert.deepEqual(out.items.cpu, { status: "bought", paid: 450, vendor: "LDLC", date: "2026-10-21" });
  assert.equal(out.items.ram, undefined);          // prix payé négatif : tout l'achat tombe
  assert.equal(out.items.gpu, undefined);          // prix en texte : écarté
  assert.deepEqual(out.items.ssd, { price: null }); // revenir au prix automatique
  assert.equal(out.items.alim.price, 129.99);
  assert.equal(out.items.alim.name, "Alim");
  assert.equal(out.items.alim.model.length, 160);
  assert.equal(out.items.os.date, "");              // date invalide vidée, achat gardé
  assert.equal(out.items.os.vendor.length, 60);
  assert.equal(out.items.vide, undefined);
  assert.equal(Object.keys(out.items).includes("__proto__"), false);
  assert.equal(Object.keys(out.items).includes("a b"), false);
});

test("cleanOverlay : articles ajoutés (doublons, section inconnue, icône et lien par défaut)", () => {
  const raw = {
    version: 1,
    items: {},
    added: [
      { id: "u1", section: "mobilier", name: "Étagère", price: 30, url: "https://ex.fr/a" },
      { id: "u1", section: "mobilier", name: "Doublon", price: 1 },
      { id: "u2", section: "nimporte", name: "Section inconnue" },
      { id: "u3", section: "screens", name: "   " },
      { id: "u4", section: "screens", name: "Écran", price: -3, url: "http://pas-https.fr" },
      { id: "!!", section: "screens", name: "Mauvais id" },
    ],
  };
  const out = json(L.cleanOverlay(raw));
  assert.deepEqual(out.added.map((a) => a.id), ["u1", "u4"]);
  assert.equal(out.added[0].icon, "📦");
  assert.equal(out.added[0].url, "https://ex.fr/a");
  assert.equal(out.added[1].price, 0);
  assert.equal("url" in out.added[1], false);
});

test("budget : sans changement, les totaux recalculés égalent ceux du relevé", () => {
  const b = json(L.recomputeBudget(BASE, copie()));
  const ref = BASE.budget_summary;
  for (const k of ["remaining_to_buy", "already_bought", "total_complete", "pc_total", "margin_vs_prime", "pc_margin"]) {
    if (k in ref) assert.equal(b[k], ref[k], k);
  }
});

test("budget : acheter un article du PC baisse le reste à acheter de son prix et monte le déjà acheté du prix payé", () => {
  const d = copie();
  const cpu = d.pc_components.find((i) => i.id === "cpu");
  const avant = json(L.recomputeBudget(BASE, copie()));
  cpu.status = "bought";
  cpu.price = 400;                       // prix payé : l'article acheté porte son prix payé
  const apres = json(L.recomputeBudget(BASE, d));
  const prixPlanifie = BASE.pc_components.find((i) => i.id === "cpu").price;
  assert.equal(apres.remaining_to_buy, L.round2(avant.remaining_to_buy - prixPlanifie));
  assert.equal(apres.already_bought, L.round2(avant.already_bought + 400));
  assert.equal(apres.pc_total, L.round2(avant.pc_total - prixPlanifie));
});

test("budget : un article en main (owned_external) ne compte ni dans le reste ni dans le déjà acheté", () => {
  const d = copie();
  const avant = json(L.recomputeBudget(BASE, copie()));
  const it = d.pc_components.find((i) => i.id === "ram");
  it.status = "owned_external";
  const apres = json(L.recomputeBudget(BASE, d));
  assert.equal(apres.already_bought, avant.already_bought);
  assert.equal(apres.remaining_to_buy, L.round2(avant.remaining_to_buy - BASE.pc_components.find((i) => i.id === "ram").price));
});

test("récapitulatif : une ligne dont tous les articles sont achetés disparaît, un article ajouté a sa ligne", () => {
  const d = copie();
  const avant = json(L.recomputeRecap(BASE, copie()));
  assert.ok(avant.length > 0);
  assert.ok(avant.every((r) => r.price > 0));
  d.mobilier.push({ id: "u1", name: "Étagère", price: 30, user: true, status: "to_buy" });
  const apres = json(L.recomputeRecap(BASE, d));
  const ajoute = apres.find((r) => r.refs?.[0] === "recap_added");
  assert.ok(ajoute, "ligne « Articles ajoutés »");
  assert.equal(ajoute.price, 30);
});
