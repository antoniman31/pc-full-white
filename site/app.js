// ============================================================
// PC FULL WHITE — app.js
// Charge data/prices.json et génère tout le contenu de la page.
// Aucune donnée n'est codée en dur ici — tout vient du JSON.
// ============================================================

// Pictogrammes : définis une fois dans le sprite de index.html, tracés en currentColor.
const ICO = (nom) => `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`;

// Les données gardent des emojis (prices.json, scraper, articles ajoutés) ; l'affichage les traduit en pictogrammes Material.
const EMOJI_ICON = {
  "🖥": "cpu",
  "🧩": "mb",
  "💾": "ram",
  "💿": "ssd",
  "🗄": "hdd",
  "🎮": "pad",
  "📦": "box",
  "🔌": "power",
  "❄": "cool",
  "🌀": "fan",
  "🪟": "os",
  "🔧": "tool",
  "📺": "tv",
  "🦾": "arm",
  "🎧": "headphones",
  "🔊": "speaker",
  "⌨": "keyboard",
  "🖱": "mouse",
  "🔋": "battery",
  "🪵": "table",
  "🔩": "hardware",
  "🪑": "chair",
  "💡": "bulb",
  "🪚": "saw",
  "🪢": "cable",
  "📌": "pin",
  "⚡": "bolt",
  "📷": "camera",
  "🎨": "palette",
  "🔒": "lock",
  "🎛": "tune",
  "🏠": "home",
  "💻": "laptop",
  "⚙": "gear",
};
const itemIcon = (emoji) => ICO(EMOJI_ICON[String(emoji || "").replace(/\uFE0F/g, "").trim()] || "box");   // emoji inconnu : boîte

const state = {
  data: null,       // ce qui s'affiche : prices.json + les achats saisis sur cet appareil
  base: null,       // prices.json tel que publié
  overlay: { version: 1, items: Object.create(null), added: [] }, // changements saisis ici (voir cleanOverlay)
  editing: null,    // id de l'article dont le formulaire d'achat est ouvert
  editingItem: null, // id de l'article dont le formulaire de modification est ouvert
  adding: null,     // section dont le formulaire d'ajout est ouvert
  confirmDelete: null, // id de l'article dont la suppression attend confirmation
  open: new Set(),  // cartes dépliées (survit aux rendus)
  gapConfirm: false, // l'écart de prix a été signalé : le prochain envoi vaut confirmation
  notice: "",       // message annoncé aux lecteurs d'écran après une action
  confirmReset: false,
  localMsg: "",
  sync: { token: "", sent: null, prState: "", busy: false, msg: "", tokenMsg: "" }, // envoi vers GitHub
  onlyToBuy: false, // listes : masque les articles déjà achetés
  toast: null,      // { text, snap } : dernière action annulable
  checklist: {}, // { "phase-0-item-2": true, ... }
};

const CHECKLIST_KEY = "pcfw-checklist-v1";
const OVERLAY_KEY = "pcfw-overlay-v1";
const TOKEN_KEY = "pcfw-token-v1";
const SENT_KEY = "pcfw-sent-v1";
const ONLY_TODO_KEY = "pcfw-only-todo";
const SEEN_KEY = "pcfw-seen-v1";
const REPO = "antoniman31/pc-full-white";
const REPO_BASE = "main";
const CHANGES_PATH = "data/changes.json";
const ITEM_SECTIONS = ["pc_components", "screens", "peripherals", "mobilier", "outils_bureau"];
const MAX_PRICE = 100000;
const GAP_LIMIT = 0.3; // au-delà de 30 % d'écart avec le prix relevé, le prix payé est à confirmer
const fmtEUR = (n) => {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
};
const fmtEURprecise = (n) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " €";

const fmtEURsmart = (n) => Number.isInteger(n) ? fmtEUR(n) : fmtEURprecise(n);
const signedEUR = (n) => `${n > 0 ? "+" : "−"}${Math.abs(n)} €`;
// Affiche un texte, ou masque l'élément quand la donnée est absente.
function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value || "";
  el.hidden = !value;
}

// Tout ce qui vient de prices.json passe ici avant d'entrer dans un gabarit HTML.
// Le fichier est écrit à la main et par le scraper (qui n'écrit que des nombres),
// donc le risque est faible — mais une balise collée par inadvertance dans un nom
// de composant ne doit pas s'exécuter.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

async function loadPrices() {
  try {
    const res = await fetch("../data/prices.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    // fallback : chemin relatif alternatif si servi depuis /site directement
    const res2 = await fetch("data/prices.json", { cache: "no-store" });
    if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
    return await res2.json();
  }
}

let booted = false;
async function boot() {
  document.body.classList.add("is-loading");
  document.getElementById("load-error").hidden = true;
  if (!booted) {
    loadChecklist();
    loadOverlay();
    loadSync();
    try { state.onlyToBuy = localStorage.getItem(ONLY_TODO_KEY) === "1"; } catch { /* stockage bloqué */ }
  }
  try {
    state.base = await loadPrices();
  } catch {
    document.body.classList.remove("is-loading");
    const err = document.getElementById("load-error");
    err.hidden = false;
    if (!booted) document.getElementById("load-retry").addEventListener("click", boot);
    booted = true;
    return;
  }
  state.data = buildView(state.base, state.overlay);
  renderAll();
  document.body.classList.remove("is-loading");
  if (booted) return;
  booted = true;
  renderSinceVisit();
  wirePurchases();
  wireTabs();
  wirePrint();
  wireTheme();
  wireHistView();
  wireAirflow();
  wireMiniSummary();
  document.getElementById("csv-export").addEventListener("click", exportCSV);
  refreshPrState().then(() => renderLocalPanel());
}

function loadChecklist() {
  try {
    state.checklist = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "{}");
  } catch { state.checklist = {}; }
}
function saveChecklist() {
  // setItem lève une exception en navigation privée et quand le quota est plein.
  // Cocher une case ne doit pas casser la page pour autant : l'état reste en
  // mémoire pour la session en cours.
  try {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state.checklist));
  } catch { /* persistance indisponible, on continue sans */ }
}

// ---------------------------------------------------------------
// Changements saisis sur cet appareil (achats, prix, produits, ajouts, suppressions)
// ---------------------------------------------------------------
// prices.json reste la base publiée. Ce que tu saisis ici est gardé dans le navigateur
// (clé pcfw-overlay-v1) et appliqué par-dessus à chaque affichage ; les totaux sont
// recalculés avec les mêmes règles que scripts/check_prices.py. Le fichier exporté a le
// format de data/changes.json (voir scraper/changes.py) : mêmes champs, mêmes limites.
const round2 = (n) => Math.round(n * 100) / 100;
const todayISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const formatISOFR = (iso) => String(iso || "").split("-").reverse().join("/");
const textOf = (v, n) => String(v ?? "").trim().slice(0, n);
const priceOK = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < MAX_PRICE;
const newOverlay = () => ({ version: 1, items: Object.create(null), added: [] });
const SECTION_LABELS = { pc_components: "PC", screens: "Écrans", peripherals: "Périphériques", mobilier: "Mobilier", outils_bureau: "Outils du bureau" };
const ID_RE = /^[a-z0-9_-]{1,40}$/i;

// Une entrée de `items` décrit un état, jamais une variation :
//   { status: "bought", paid, date, vendor } | { status: "to_buy" }   achat, ou achat annulé
//   { price: 450 | null }                                              prix saisi (null : revenir à l'automatique)
//   { name, model }                                                    produit changé
//   { deleted: true }                                                  article supprimé
// Tout ce qui est douteux est écarté : le fichier d'import vient de l'extérieur.
function cleanOverlay(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
  const out = newOverlay();
  for (const [id, o] of Object.entries(raw.items && typeof raw.items === "object" ? raw.items : {})) {
    if (!ID_RE.test(id) || id === "__proto__" || !o || typeof o !== "object") continue;
    const e = {};
    if (o.deleted === true) e.deleted = true;
    if (o.status === "to_buy") e.status = "to_buy";
    else if (o.status === "bought" && priceOK(o.paid)) {
      Object.assign(e, { status: "bought", paid: round2(o.paid), vendor: textOf(o.vendor, 60),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || "")) ? o.date : "" });
    }
    if (o.price === null) e.price = null;
    else if (priceOK(o.price)) e.price = round2(o.price);
    if (textOf(o.name, 80)) e.name = textOf(o.name, 80);
    if (textOf(o.model, 160)) e.model = textOf(o.model, 160);
    if (Object.keys(e).length) out.items[id] = e;
  }
  const seen = new Set();
  for (const a of Array.isArray(raw.added) ? raw.added : []) {
    if (!a || typeof a !== "object" || !ID_RE.test(String(a.id)) || seen.has(a.id)) continue;
    if (!(a.section in SECTION_LABELS) || !textOf(a.name, 80)) continue;
    seen.add(a.id);
    const entry = { id: a.id, section: a.section, name: textOf(a.name, 80), model: textOf(a.model, 160),
      icon: textOf(a.icon, 4) || "📦", price: priceOK(a.price) ? round2(a.price) : 0 };
    if (textOf(a.url, 300).startsWith("https://")) entry.url = textOf(a.url, 300);
    out.added.push(entry);
  }
  return out;
}

function loadOverlay() {
  try {
    const clean = cleanOverlay(JSON.parse(localStorage.getItem(OVERLAY_KEY) || "null"));
    if (clean) state.overlay = clean;
  } catch { /* stockage indisponible ou illisible : on repart de zéro */ }
}
function saveOverlay() {
  state.sync.msg = "";
  // Toute nouvelle modification invalide le « Annuler » en cours (il restaurerait un état périmé).
  state.toast = null;
  document.getElementById("toast").hidden = true;
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(state.overlay));
  } catch { /* l'état reste en mémoire pour la session */ }
}
const overlayCount = (o = state.overlay) => Object.keys(o.items).length + o.added.length;

// Fusionne des champs dans l'entrée d'un article ; `undefined` retire le champ, une entrée vide disparaît.
function patchEntry(id, patch) {
  const next = { ...(state.overlay.items[id] || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  if (Object.keys(next).length) state.overlay.items[id] = next;
  else delete state.overlay.items[id];
}

const isLeft = (i) => i.status !== "bought" && i.status !== "owned_external";
const sumLeft = (items) => round2(items.filter(isLeft).reduce((s, i) => s + priceOf(i), 0));
const sumBought = (items) => round2(items.filter(i => i.status === "bought").reduce((s, i) => s + (i.price || 0), 0));
const allItems = (d) => ITEM_SECTIONS.flatMap(sec => d[sec] || []);

function findBaseItem(id) {
  return allItems(state.base).find(i => i.id === id) || null;
}

// Mêmes formules que check_prices.py : pc_total garde l'écart d'arrondi du relevé (il ajoute la
// variation des lignes plutôt que de se recalculer), le reste se déduit des lignes restantes.
function recomputeBudget(base, d) {
  const b0 = base.budget_summary, limits = d.meta;
  const pcTotal = round2(b0.pc_total + sumLeft(d.pc_components) - sumLeft(base.pc_components));
  const periphLeft = round2(sumLeft(d.screens) + sumLeft(d.peripherals));
  const mobilier = round2(sumLeft(d.mobilier) + sumLeft(d.outils_bureau));
  const already = round2(sumBought(allItems(d)));
  const remaining = round2(pcTotal + periphLeft + mobilier);
  return {
    ...b0,
    already_bought: already,
    remaining_to_buy: remaining,
    total_complete: round2(remaining + already),
    margin_vs_prime: round2(limits.prime_limit - remaining),
    pc_total: pcTotal,
    pc_margin: round2(limits.pc_limit - pcTotal),
    mobilier_2026_total: mobilier,
    periph_2027_remaining: round2(pcTotal + periphLeft),
  };
}

// Récapitulatif : chaque ligne se recalcule depuis ses références, les lignes vides disparaissent,
// et les articles ajoutés hors PC (déjà dans pc_total pour le PC) ont leur propre ligne.
function recomputeRecap(base, d) {
  const value = (ref) => {
    if (ref === "pc_total") return d.budget_summary.pc_total;
    if (ref === "outils_bureau") return sumLeft(d.outils_bureau);
    const it = allItems(d).find(i => i.id === ref);
    return it && isLeft(it) ? priceOf(it) : 0;
  };
  const rows = (base.purchase_recap || [])
    .map(r => ({ ...r, price: r.refs ? round2(r.refs.reduce((s, ref) => s + value(ref), 0)) : r.price }))
    .filter(r => r.price > 0);
  const extra = ITEM_SECTIONS.filter(sec => sec !== "pc_components").flatMap(sec => d[sec]).filter(i => i.user && isLeft(i));
  if (extra.length) rows.push({ label: `Articles ajoutés (${extra.length})`, when: "Ajoutés par toi", price: sumLeft(extra), refs: ["recap_added"] });
  return rows;
}

// Vue affichée = base + changements locaux. Sans changement, la base passe telle quelle.
function buildView(base, overlay) {
  const d = structuredClone(base);
  if (!overlayCount(overlay)) return d;
  for (const a of overlay.added) {
    if (allItems(d).some(i => i.id === a.id)) continue;      // déjà publié dans prices.json
    const it = { id: a.id, icon: a.icon, name: a.name, price: a.price, status: "to_buy", user: true, local: true };
    if (a.section === "outils_bureau") it.ref = a.model;
    else if (a.section === "peripherals") it.note = a.model;
    else it.model = a.model;
    if (a.url) it.source_url = a.url;
    d[a.section].push(it);
  }
  for (const sec of ITEM_SECTIONS) d[sec] = d[sec].filter(i => !overlay.items[i.id]?.deleted);
  for (const item of allItems(d)) {
    const o = overlay.items[item.id];
    if (!o) continue;
    item.local = true;
    if (o.status === "bought") {
      item.price_relevé = item.price;
      item.status = "bought";
      item.price = o.paid;
      item.bought_date = o.date;
      item.vendor = o.vendor;
    } else if (o.status === "to_buy" && item.status === "bought") {
      item.status = "to_buy";
    }
    if (o.price !== undefined && item.status !== "bought") {
      if (o.price === null) delete item.price_manual;
      else { item.price = o.price; item.price_manual = true; }
    }
    if (o.name || o.model) {
      if (o.name) item.name = o.name;
      if (o.model) {
        const sec = sectionOf(d, item.id);
        if (sec === "outils_bureau") item.ref = o.model;
        else if (sec === "peripherals") item.note = o.model;
        else item.model = o.model;
      }
      item.product_changed = true;
      item.offers = [];                                     // les offres de l'ancien produit ne valent plus rien
      delete item.specs;
    }
  }
  d.budget_summary = recomputeBudget(base, d);
  d.purchase_recap = recomputeRecap(base, d);
  return d;
}

function sectionOf(d, id) {
  return ITEM_SECTIONS.find(sec => (d[sec] || []).some(i => i.id === id)) || null;
}

function refreshView(focusSel) {
  state.data = buildView(state.base, state.overlay);
  renderPurchases();
  if (focusSel) document.querySelector(focusSel)?.focus();
  const live = document.getElementById("buy-live");
  if (live) live.textContent = state.notice;
}

function boughtMetaHTML(item) {
  if (item.status !== "bought") return "";
  const bits = [`payé ${fmtEURsmart(item.price)}`];
  if (item.bought_date) bits.push(formatISOFR(item.bought_date));
  if (item.vendor) bits.push(esc(item.vendor));
  return bits.join(" · ");
}

// Case « Acheté » (même gabarit que la checklist : un bouton role=checkbox de 48 px) et, à
// l'ouverture, le formulaire du prix payé, de la date et de la boutique.
function buyHTML(item) {
  if (!item.id || item.status === "owned_external") return "";
  const bought = item.status === "bought";
  const meta = bought
    ? `<span class="buy-meta">${boughtMetaHTML(item)}</span>`
    : "";
  const edit = bought
    ? `<button type="button" class="icon-btn" data-buy-edit="${esc(item.id)}" title="Modifier l'achat">${ICO("pencil")}<span class="sr-only">Modifier l'achat : ${esc(item.name)}</span></button>`
    : "";
  return `
    <div class="buy-row">
      <button type="button" role="checkbox" class="check-row buy-toggle${bought ? " checked" : ""}"
              data-buy-toggle="${esc(item.id)}" aria-checked="${bought}">
        <span class="check-box" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="check-text">Acheté<span class="sr-only"> : ${esc(item.name)}</span></span>
      </button>
      ${meta}${edit}
    </div>${state.editing === item.id ? buyFormHTML(item) : ""}${itemToolsHTML(item)}`;
}

function buyFormHTML(item) {
  const paid = item.status === "bought" ? item.price : priceOf(item);
  const date = (item.status === "bought" && item.bought_date) || todayISO();
  const vendor = (item.status === "bought" && item.vendor) || "";
  const shops = [...new Set((item.offers || []).map(x => String(x.retailer).replace(/ \(via Google Shopping\)$/, "")))];
  const id = esc(item.id);
  return `
    <form class="buy-form" data-buy-form="${id}" novalidate>
      <div class="buy-field">
        <label for="paid-${id}">Prix payé (€)</label>
        <input id="paid-${id}" name="paid" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${esc(paid)}">
      </div>
      <div class="buy-field">
        <label for="date-${id}">Date d'achat</label>
        <input id="date-${id}" name="date" type="date" value="${esc(date)}">
      </div>
      <div class="buy-field">
        <label for="shop-${id}">Boutique</label>
        <input id="shop-${id}" name="vendor" type="text" maxlength="60" list="shops-${id}" autocomplete="off" value="${esc(vendor)}">
        <datalist id="shops-${id}">${shops.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      </div>
      <p class="buy-error" role="alert" id="buy-error">${esc(state.notice && state.editing === item.id ? state.notice : "")}</p>
      <div class="buy-actions">
        <button type="submit" class="buy-save">${state.gapConfirm ? "Confirmer quand même" : "Enregistrer l'achat"}</button>
        <button type="button" class="buy-cancel" data-buy-cancel="${id}">Annuler</button>
      </div>
    </form>`;
}

// Modifier le produit, saisir un prix à la main ou supprimer l'article.
function itemToolsHTML(item) {
  const id = esc(item.id);
  const badges = [
    item.user ? "Article ajouté par toi : son prix est cherché par nom au prochain relevé, proposé mais jamais écrit sans ton accord." : "",
    item.product_changed ? "Produit modifié : les anciennes offres sont abandonnées, le prochain relevé cherche le nouveau par nom." : "",
    item.price_manual ? "Prix saisi à la main : le relevé le propose mais ne l'écrase jamais." : "",
  ].filter(Boolean).map(t => `<p class="item-hint">${esc(t)}</p>`).join("");
  const form = state.editingItem === item.id ? itemFormHTML(item) : "";
  return `${badges}
    <div class="buy-row item-tools">
      <button type="button" class="buy-edit" data-item-edit="${id}">${ICO("pencil")}Modifier l'article<span class="sr-only"> : ${esc(item.name)}</span></button>
      ${item.local ? '<span class="local-badge">modifié ici</span>' : ""}
    </div>${form}`;
}

function itemFormHTML(item) {
  const id = esc(item.id);
  const sec = sectionOf(state.data, item.id);
  const model = sec === "outils_bureau" ? item.ref : sec === "peripherals" ? item.note : item.model;
  const manual = item.price_manual || state.overlay.items[item.id]?.price != null;
  const confirm = state.confirmDelete === item.id;
  return `
    <form class="buy-form" data-item-form="${id}" novalidate>
      <div class="buy-field">
        <label for="iname-${id}">Nom</label>
        <input id="iname-${id}" name="name" type="text" maxlength="80" required value="${esc(item.name)}">
      </div>
      <div class="buy-field">
        <label for="imodel-${id}">Modèle / détails</label>
        <input id="imodel-${id}" name="model" type="text" maxlength="160" value="${esc(model || "")}">
      </div>
      <div class="buy-field">
        <label for="iprice-${id}">Prix saisi (€)${manual ? "" : " — facultatif"}</label>
        <input id="iprice-${id}" name="price" type="number" inputmode="decimal" step="0.01" min="0.01" value="${item.status === "bought" || !manual ? "" : esc(item.price)}"
               ${item.status === "bought" ? "disabled" : ""} aria-describedby="iprice-help-${id}">
        <span class="item-hint" id="iprice-help-${id}">${item.status === "bought" ? "Article acheté : le prix est celui de l'achat." : "Vide : prix automatique du relevé."}</span>
      </div>
      <p class="buy-error" role="alert" id="item-error">${esc(state.editingItem === item.id ? state.notice : "")}</p>
      <div class="buy-actions">
        <button type="submit" class="buy-save">Enregistrer</button>
        <button type="button" class="buy-cancel" data-item-cancel="${id}">Annuler</button>
        <button type="button" class="icon-btn danger${confirm ? " armed" : ""}" data-item-delete="${id}" title="${confirm ? "Confirmer la suppression" : "Supprimer l'article"}">${ICO("trash")}<span class="sr-only">${confirm ? "Confirmer la suppression" : "Supprimer l'article"}</span></button>
      </div>
    </form>`;
}

// Formulaire d'ajout, en tête de chaque liste.
// `tools` : la première liste d'un onglet porte aussi « Déplier » et « À acheter » (ils valent pour tout l'onglet).
// Une seule ligne, mots courts ; les noms complets sont dans le texte masqué et dans l'info-bulle.
function addBlockHTML(section, tools = false) {
  const open = state.adding === section;
  const nom = esc(SECTION_LABELS[section]);
  return `
    <div class="add-block">
      <div class="add-row">
        <button type="button" class="buy-edit tonal" data-add-open="${section}" aria-expanded="${open}" title="Ajouter un article : ${nom}">${open ? `Fermer<span class="sr-only"> : ${nom}</span>` : `+ Ajouter<span class="sr-only"> un article : ${nom}</span>`}</button>
        ${tools ? `
        <button type="button" class="buy-edit text-btn" data-toggle-all title="${state.open.size ? "Tout replier" : "Tout déplier"}">${state.open.size ? "Replier" : "Déplier"}<span class="sr-only"> tout</span></button>
        <button type="button" class="buy-edit filter-chip" data-only-todo aria-pressed="${state.onlyToBuy}" title="Afficher seulement les articles à acheter">À acheter<span class="sr-only"> seulement</span></button>` : ""}
      </div>
      ${open ? `
      <form class="buy-form" data-add-form="${section}" novalidate>
        <div class="buy-field"><label for="aname-${section}">Nom</label>
          <input id="aname-${section}" name="name" type="text" maxlength="80" required></div>
        <div class="buy-field"><label for="amodel-${section}">Modèle / détails</label>
          <input id="amodel-${section}" name="model" type="text" maxlength="160"></div>
        <div class="buy-field"><label for="aprice-${section}">Prix estimé (€)</label>
          <input id="aprice-${section}" name="price" type="number" inputmode="decimal" step="0.01" min="0"></div>
        <div class="buy-field"><label for="aurl-${section}">Lien de la boutique — facultatif</label>
          <input id="aurl-${section}" name="url" type="url" maxlength="300" placeholder="https://"></div>
        <p class="buy-error" role="alert" id="add-error">${esc(state.adding === section ? state.notice : "")}</p>
        <div class="buy-actions">
          <button type="submit" class="buy-save">Ajouter</button>
          <button type="button" class="buy-cancel" data-add-cancel="${section}">Annuler</button>
        </div>
      </form>` : ""}
    </div>`;
}

function wirePurchases() {
  // L'événement toggle ne remonte pas : on l'écoute en capture pour retenir quelles cartes sont dépliées.
  document.addEventListener("toggle", (e) => {
    const card = e.target;
    if (!(card instanceof HTMLDetailsElement) || !card.dataset.card) return;
    if (card.open) state.open.add(card.dataset.card); else state.open.delete(card.dataset.card);
  }, true);

  const snapshot = () => JSON.stringify({ version: 1, items: state.overlay.items, added: state.overlay.added });
  // Le message reste jusqu'à l'action suivante ou sa fermeture (un message qui disparaît seul est inaccessible).
  const hideToast = () => { state.toast = null; document.getElementById("toast").hidden = true; };
  const offerUndo = (text, snap) => {
    state.toast = { text, snap };
    document.getElementById("toast-text").textContent = text;
    document.getElementById("toast").hidden = false;
  };
  document.getElementById("toast-close").addEventListener("click", hideToast);
  document.addEventListener("pcfw:navigate", hideToast);   // changer d'écran (clic, lien, Retour) ferme le message
  // Le message reste jusqu'à la prochaine action : un clic ailleurs le retire (phase de capture, donc avant
  // que cette action ne le remplace par le sien). Sans ça il restait posé sur les champs et boutons des formulaires.
  document.addEventListener("click", (e) => { if (!e.target.closest("#toast")) hideToast(); }, true);
  document.getElementById("toast-undo").addEventListener("click", () => {
    if (!state.toast) return;
    const clean = cleanOverlay(JSON.parse(state.toast.snap));
    hideToast();
    if (!clean) return;
    state.overlay = clean;
    state.editing = state.editingItem = state.adding = state.confirmDelete = null;
    state.notice = "Action annulée.";
    saveOverlay();
    refreshView();
  });
  const closeForms = () => { state.editing = state.editingItem = state.adding = state.confirmDelete = null; state.gapConfirm = false; state.notice = ""; };
  const sel = (id) => `[data-buy-toggle="${CSS.escape(id)}"]`;

  document.addEventListener("click", (e) => {
    const t = (attr) => e.target.closest(`[${attr}]`);
    if (t("data-buy-toggle")) {
      const id = t("data-buy-toggle").dataset.buyToggle;
      const item = allItems(state.data).find(i => i.id === id);
      if (!item) return;
      if (item.status === "bought") {
        // Décocher annule l'achat : l'article repasse « à acheter » à son prix relevé.
        const snap = snapshot();
        const fromBase = findBaseItem(id)?.status === "bought";
        patchEntry(id, { status: fromBase ? "to_buy" : undefined, paid: undefined, date: undefined, vendor: undefined });
        closeForms();
        state.notice = `Achat annulé : ${item.name}`;
        saveOverlay();
        refreshView(sel(id));
        offerUndo(`Achat annulé : ${item.name}`, snap);
      } else {
        const reopen = state.editing !== id;
        closeForms();
        if (reopen) state.editing = id;
        refreshView(reopen ? `#paid-${CSS.escape(id)}` : sel(id));
      }
    } else if (t("data-buy-edit")) {
      closeForms();
      state.editing = t("data-buy-edit").dataset.buyEdit;
      refreshView(`#paid-${CSS.escape(state.editing)}`);
    } else if (t("data-buy-cancel")) {
      const id = t("data-buy-cancel").dataset.buyCancel;
      closeForms();
      refreshView(sel(id));
    } else if (t("data-item-edit")) {
      const id = t("data-item-edit").dataset.itemEdit;
      const reopen = state.editingItem !== id;
      closeForms();
      if (reopen) state.editingItem = id;
      refreshView(reopen ? `#iname-${CSS.escape(id)}` : `[data-item-edit="${CSS.escape(id)}"]`);
    } else if (t("data-item-cancel")) {
      const id = t("data-item-cancel").dataset.itemCancel;
      closeForms();
      refreshView(`[data-item-edit="${CSS.escape(id)}"]`);
    } else if (t("data-item-delete")) {
      const id = t("data-item-delete").dataset.itemDelete;
      if (state.confirmDelete !== id) {              // premier clic : on demande confirmation
        state.confirmDelete = id;
        state.notice = "Supprimer retire l'article du budget. Clique encore pour confirmer.";
        refreshView(`[data-item-delete="${CSS.escape(id)}"]`);
        return;
      }
      const item = allItems(state.data).find(i => i.id === id);
      const section = sectionOf(state.data, id);
      const snap = snapshot();
      const added = state.overlay.added.findIndex(a => a.id === id);
      if (added >= 0) { state.overlay.added.splice(added, 1); delete state.overlay.items[id]; }
      else patchEntry(id, { deleted: true });
      state.open.delete(id);
      closeForms();
      state.notice = `Article supprimé : ${item ? item.name : id}`;
      saveOverlay();
      refreshView(`[data-add-open="${section}"]`);
      offerUndo(`Article supprimé : ${item ? item.name : id}`, snap);
    } else if (t("data-toggle-all")) {
      if (state.open.size) state.open.clear();
      else for (const i of allItems(state.data)) state.open.add(i.id);
      refreshView("[data-toggle-all]");
    } else if (t("data-only-todo")) {
      state.onlyToBuy = !state.onlyToBuy;
      try { localStorage.setItem(ONLY_TODO_KEY, state.onlyToBuy ? "1" : "0"); } catch { /* choix valable pour la session */ }
      refreshView("[data-only-todo]");
    } else if (t("data-add-open")) {
      const section = t("data-add-open").dataset.addOpen;
      const reopen = state.adding !== section;
      closeForms();
      if (reopen) state.adding = section;
      refreshView(reopen ? `#aname-${section}` : `[data-add-open="${section}"]`);
    } else if (t("data-add-cancel")) {
      const section = t("data-add-cancel").dataset.addCancel;
      closeForms();
      refreshView(`[data-add-open="${section}"]`);
    } else if (t("data-restore")) {
      const id = t("data-restore").dataset.restore;
      patchEntry(id, { deleted: undefined });
      state.notice = "Article rétabli.";
      saveOverlay();
      refreshView(sel(id));
    }
  });

  document.addEventListener("submit", (e) => {
    const buyForm = e.target.closest("[data-buy-form]");
    const itemForm = e.target.closest("[data-item-form]");
    const addForm = e.target.closest("[data-add-form]");
    if (!buyForm && !itemForm && !addForm) return;
    e.preventDefault();
    const data = new FormData(e.target);
    const num = (k) => parseFloat(String(data.get(k) ?? "").replace(",", "."));
    if (buyForm) submitPurchase(buyForm.dataset.buyForm, data, num("paid"));
    else if (itemForm) submitItem(itemForm.dataset.itemForm, data, num("price"));
    else submitAdd(addForm.dataset.addForm, data, num("price"));
  });

  // Corriger le prix après un message d'écart : le prochain envoi doit de nouveau être signalé.
  document.addEventListener("input", (e) => {
    if (e.target.matches('[data-buy-form] input[name="paid"]') && state.gapConfirm) {
      state.gapConfirm = false;
      const btn = e.target.closest("form").querySelector(".buy-save");
      if (btn) btn.textContent = "Enregistrer l'achat";
      e.target.closest("form").querySelector(".buy-error").textContent = "";
    }
  });

  function submitPurchase(id, data, paidRaw) {
    const item = allItems(state.data).find(i => i.id === id);
    const paid = round2(paidRaw);
    const date = String(data.get("date") || "");
    const vendor = textOf(data.get("vendor"), 60);
    const show = (msg) => { state.notice = msg; refreshView(`#paid-${CSS.escape(id)}`); };
    if (!priceOK(paid)) return show("Saisis un prix payé supérieur à 0 €.");
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return show("La date n'est pas valide.");
    const ref = findBaseItem(id)?.price;
    if (ref > 0 && Math.abs(paid - ref) / ref > GAP_LIMIT && !state.gapConfirm) {
      state.gapConfirm = true;
      return show(`Tu as saisi ${fmtEURsmart(paid)}, le prix relevé est ${fmtEURsmart(ref)} : confirmer ?`);
    }
    const snap = snapshot();
    patchEntry(id, { status: "bought", paid, date, vendor });
    closeForms();
    state.notice = `Achat enregistré : ${item ? item.name : id}, ${fmtEURsmart(paid)}`;
    saveOverlay();
    refreshView(sel(id));
    offerUndo(`Acheté : ${item ? item.name : id}`, snap);
  }

  function submitItem(id, data, priceRaw) {
    const item = allItems(state.data).find(i => i.id === id);
    const base = findBaseItem(id) || state.overlay.added.find(a => a.id === id);
    const show = (msg) => { state.notice = msg; refreshView(`#iname-${CSS.escape(id)}`); };
    const name = textOf(data.get("name"), 80);
    const model = textOf(data.get("model"), 160);
    if (!name) return show("Le nom ne peut pas être vide.");
    const rawPrice = String(data.get("price") ?? "").trim();
    if (rawPrice && !priceOK(priceRaw)) return show("Le prix saisi doit être supérieur à 0 €.");
    const sec = sectionOf(state.base, id) || state.overlay.added.find(a => a.id === id)?.section;
    const baseModel = base ? (base.model ?? base.ref ?? base.note ?? "") : "";
    const added = state.overlay.added.find(a => a.id === id);
    if (added) {                                            // article ajouté ici : on modifie sa fiche directement
      Object.assign(added, { name, model });
      if (rawPrice) added.price = round2(priceRaw);
    } else {
      patchEntry(id, {
        name: name !== base.name ? name : undefined,
        model: model && model !== baseModel ? model : undefined,
        price: rawPrice ? round2(priceRaw) : (item?.price_manual && item.status !== "bought" ? null : undefined),
      });
    }
    closeForms();
    state.notice = `Article modifié : ${name}`;
    saveOverlay();
    refreshView(`[data-item-edit="${CSS.escape(id)}"]`);
  }

  function submitAdd(section, data, priceRaw) {
    const show = (msg) => { state.notice = msg; refreshView(`#aname-${section}`); };
    const name = textOf(data.get("name"), 80);
    if (!name) return show("Donne un nom à l'article.");
    const rawPrice = String(data.get("price") ?? "").trim();
    if (rawPrice && !(priceRaw >= 0 && priceRaw < MAX_PRICE)) return show("Le prix estimé n'est pas valide.");
    const url = textOf(data.get("url"), 300);
    if (url && !url.startsWith("https://")) return show("Le lien doit commencer par https://");
    const id = `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const entry = { id, section, name, model: textOf(data.get("model"), 160), icon: "📦",
      price: priceOK(priceRaw) ? round2(priceRaw) : 0 };
    if (url) entry.url = url;
    const snap = snapshot();
    state.overlay.added.push(entry);
    state.open.add(id);
    closeForms();
    state.notice = `Article ajouté : ${name}`;
    saveOverlay();
    refreshView(`[data-card="${id}"] summary`);
    offerUndo(`Article ajouté : ${name}`, snap);
  }
}

// ---------- Envoi des changements vers GitHub (Pull Request) ----------
// Le jeton reste dans ce navigateur. L'envoi écrit data/changes.json sur une branche `site-changes/…`
// et ouvre une PR ; la CI y recalcule prices.json, puis la PR est fusionnée à la main.
function loadSync() {
  try { state.sync.token = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* pas de stockage */ }
  try {
    const s = JSON.parse(localStorage.getItem(SENT_KEY) || "null");
    if (s && Number.isInteger(s.pr) && String(s.url).startsWith("https://github.com/")
        && /^site-changes\/[\w-]+$/.test(s.branch) && typeof s.snapshot === "string") state.sync.sent = s;
  } catch { /* envoi précédent illisible : on l'oublie */ }
}
function saveSync() {
  try {
    if (state.sync.token) localStorage.setItem(TOKEN_KEY, state.sync.token); else localStorage.removeItem(TOKEN_KEY);
    if (state.sync.sent) localStorage.setItem(SENT_KEY, JSON.stringify(state.sync.sent)); else localStorage.removeItem(SENT_KEY);
  } catch { /* l'état reste en mémoire */ }
}

const changesText = () => JSON.stringify({ version: 1, items: state.overlay.items, added: state.overlay.added }, null, 2) + "\n";
const hasPending = () => overlayCount() > 0 && changesText() !== state.sync.sent?.snapshot;
const b64 = (text) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};

async function gh(path, method = "GET", body, token = state.sync.token) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { status: res.status });
  return data;
}
function ghError(e) {
  if (e.status === 401) return "GitHub refuse le token (erroné ou expiré).";
  if (e.status === 403 || e.status === 404) return "Le token n'a pas les droits sur ce dépôt (Contents et Pull requests en écriture).";
  if (e instanceof TypeError) return "Pas de connexion à GitHub.";
  return `GitHub a répondu : ${e.message}`;
}

function describeChanges() {
  const added = new Map(state.overlay.added.map(a => [a.id, a.name]));
  const nom = (id) => added.get(id) || findBaseItem(id)?.name || id;
  const lines = [];
  for (const [id, o] of Object.entries(state.overlay.items)) {
    if (o.deleted) { lines.push(`Supprimé : ${nom(id)}`); continue; }
    if (o.status === "bought") lines.push(`Acheté : ${nom(id)} — ${o.paid} €${o.vendor ? ` chez ${o.vendor}` : ""}${o.date ? ` le ${o.date}` : ""}`);
    if (o.status === "to_buy") lines.push(`Achat annulé : ${nom(id)}`);
    if ("price" in o) lines.push(`Prix ${o.price === null ? "remis en automatique" : `saisi à ${o.price} €`} : ${nom(id)}`);
    if (o.name || o.model) lines.push(`Produit modifié : ${nom(id)}`);
  }
  for (const a of state.overlay.added) lines.push(`Ajouté : ${a.name} (${SECTION_LABELS[a.section]})`);
  return lines;
}

async function refreshPrState() {
  const sent = state.sync.sent;
  if (!sent) return;
  try {
    const pr = await gh(`/pulls/${sent.pr}`);
    state.sync.prState = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open";
  } catch { state.sync.prState = ""; }
}

async function sendChanges() {
  const sy = state.sync;
  if (sy.busy) return;
  if (!sy.token) { goToTokenForm(); return; }
  sy.busy = true;
  sy.msg = "Envoi en cours…";
  renderLocalPanel();
  try {
    if (sy.sent && !sy.prState) await refreshPrState();
    const reuse = sy.sent && sy.prState === "open" ? sy.sent : null;
    const text = changesText();
    const n = overlayCount();
    const titre = `Changements du site : ${n} changement${n > 1 ? "s" : ""}`;
    let branch;
    if (reuse) branch = reuse.branch;
    else {
      const base = await gh(`/git/ref/heads/${REPO_BASE}`);
      branch = `site-changes/${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
      await gh("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: base.object.sha });
    }
    let sha;
    try { sha = (await gh(`/contents/${CHANGES_PATH}?ref=${encodeURIComponent(branch)}`)).sha; }
    catch (e) { if (e.status !== 404) throw e; }
    await gh(`/contents/${CHANGES_PATH}`, "PUT", { message: titre, content: b64(text), branch, ...(sha ? { sha } : {}) });
    if (reuse) {
      sy.sent = { ...reuse, snapshot: text, at: todayISO() };
      sy.msg = `PR n° ${reuse.pr} mise à jour.`;
    } else {
      const lignes = describeChanges().slice(0, 60).map(l => `- ${l}`).join("\n");
      const pr = await gh("/pulls", "POST", { title: titre, head: branch, base: REPO_BASE,
        body: `Envoyé depuis la page du suivi.\n\n${lignes}\n\nLa CI applique \`${CHANGES_PATH}\` à \`data/prices.json\` sur cette branche (commit automatique). Fusionne ensuite la PR.` });
      sy.sent = { pr: pr.number, url: pr.html_url, branch, snapshot: text, at: todayISO() };
      sy.prState = "open";
      sy.msg = `PR n° ${pr.number} ouverte.`;
    }
    saveSync();
  } catch (e) {
    sy.msg = ghError(e);
  }
  sy.busy = false;
  renderLocalPanel();
  document.getElementById("sync-msg")?.focus();
}

function goToTokenForm() {
  document.getElementById("tab-reglages")?.click();
  const field = document.getElementById("gh-token");
  field?.scrollIntoView({ block: "center" });
  field?.focus();
}

function syncHTML() {
  const sy = state.sync, sent = sy.sent;
  const etat = !sent ? "" : {
    open: "en attente de fusion",
    merged: "fusionnée : le site se met à jour dans quelques minutes",
    closed: "fermée sans fusion",
  }[sy.prState] || "état inconnu";
  return `
    <div class="sync-block">
      <h2 class="section-title sub">Envoyer vers le dépôt</h2>
      ${sy.token ? `
        <p class="section-note" style="margin:0 0 8px;">Token enregistré dans ce navigateur.</p>
        <div class="local-actions">
          <button type="button" class="buy-save" id="gh-send"${overlayCount() ? "" : " disabled"}>${sent && sy.prState === "open" ? "Mettre à jour la PR" : "Envoyer"}</button>
          <button type="button" class="local-btn" id="gh-forget">Oublier le token</button>
        </div>` : `
        <p class="section-note" style="margin:0 0 8px;">Colle un token GitHub limité à ce dépôt (Contents et Pull requests en écriture, 90 jours maximum). Il reste uniquement dans ce navigateur.</p>
        <form class="buy-field" id="gh-form">
          <label for="gh-token">Token GitHub</label>
          <input id="gh-token" type="password" autocomplete="off" spellcheck="false" required>
          <div class="local-actions"><button type="submit" class="buy-save">Enregistrer le token</button></div>
        </form>
        <p class="local-msg" role="status">${esc(sy.tokenMsg)}</p>`}
      ${sent ? `<p class="sync-pr"><a href="${esc(sent.url)}">PR n° ${sent.pr}</a> : ${esc(etat)}.</p>` : ""}
      ${sent && sy.prState === "merged" ? `<button type="button" class="local-btn" id="gh-clean">Vider ma liste locale (déjà publiée)</button>` : ""}
      <p class="local-msg" id="sync-msg" role="status" tabindex="-1">${esc(sy.msg)}</p>
    </div>`;
}

function wireSync() {
  document.getElementById("gh-send")?.addEventListener("click", sendChanges);
  document.getElementById("gh-forget")?.addEventListener("click", () => {
    state.sync.token = "";
    state.sync.tokenMsg = "";
    saveSync();
    renderLocalPanel();
    document.getElementById("gh-token")?.focus();
  });
  document.getElementById("gh-clean")?.addEventListener("click", () => {
    state.overlay = newOverlay();
    state.sync.sent = null;
    state.sync.prState = "";
    state.sync.msg = "";
    state.localMsg = "Liste locale vidée : ces changements sont publiés.";
    saveOverlay();
    saveSync();
    refreshView("#local-export");
  });
  document.getElementById("gh-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.getElementById("gh-token").value.trim();
    if (!token) return;
    state.sync.tokenMsg = "Vérification du token…";
    renderLocalPanel();
    try {
      await gh("", "GET", undefined, token);
      state.sync.token = token;
      state.sync.tokenMsg = "";
      state.sync.msg = "Token enregistré.";
      saveSync();
    } catch (err) {
      state.sync.tokenMsg = ghError(err);
    }
    renderLocalPanel();
    (document.getElementById("gh-send") || document.getElementById("gh-token"))?.focus();
  });
}

// Bandeau fixe en bas de page : visible dès qu'il y a des changements pas encore envoyés.
function renderSendBar() {
  const bar = document.getElementById("send-bar");
  if (!bar) return;
  const sy = state.sync;
  const show = hasPending() || sy.busy;
  bar.hidden = !show;
  document.body.classList.toggle("has-send-bar", show);
  if (!show) return;
  const n = overlayCount();
  bar.innerHTML = `
    <div class="send-bar-in">
      <p class="send-text" role="status">${esc(sy.busy || sy.msg.startsWith("GitHub") || sy.msg.startsWith("Le token") || sy.msg.startsWith("Pas de")
        ? sy.msg : `${n} changement${n > 1 ? "s" : ""} pas encore envoyé${n > 1 ? "s" : ""} au dépôt`)}</p>
      <button type="button" class="buy-save" id="send-now"${sy.busy ? " disabled" : ""}>Envoyer</button>
    </div>`;
  document.getElementById("send-now").addEventListener("click", sendChanges);
}

// Encart de l'onglet Budget : ce qui est modifié ici, plus export, import et remise à zéro.
function renderLocalPanel() {
  const el = document.getElementById("local-panel");
  if (!el) return;
  const n = overlayCount();
  const deleted = Object.entries(state.overlay.items).filter(([, o]) => o.deleted)
    .map(([id]) => ({ id, name: findBaseItem(id)?.name || id }));
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:24px;">${syncHTML()}</div>
    <div class="card card-pad local-card">
      <h2 class="section-title sub">Mes changements sur cet appareil</h2>
      <p class="section-note" style="margin:6px 0 12px;">${n
        ? `${n} changement${n > 1 ? "s" : ""} ici : ils s'affichent avec le budget recalculé, mais ne sont enregistrés que dans ce navigateur. Exporte-les de temps en temps.`
        : "Coche « Acheté », modifie, ajoute ou supprime un article (onglets PC, Périphériques, Mobilier) : le budget se recalcule. Rien n'est envoyé nulle part, tout reste dans ce navigateur."}</p>
      ${deleted.length ? `<ul class="plain-list local-deleted" aria-label="Articles supprimés ici">${deleted.map(x => `
        <li><span>${esc(x.name)} <span class="sr-only">(supprimé)</span></span>
        <button type="button" class="local-btn" data-restore="${esc(x.id)}">Rétablir<span class="sr-only"> : ${esc(x.name)}</span></button></li>`).join("")}</ul>` : ""}
      <div class="local-actions">
        <button type="button" class="local-btn" id="local-export"${n ? "" : " disabled"}>Exporter</button>
        <label class="local-btn local-import">Importer<input type="file" id="local-import" accept="application/json,.json" class="sr-only"></label>
        <button type="button" class="local-btn" id="local-reset"${n ? "" : " disabled"}>${state.confirmReset ? "Confirmer" : "Réinitialiser"}</button>
      </div>
      <p class="local-msg" id="local-msg" role="status">${esc(state.localMsg || (n ? "" : "Aucun changement pour l'instant : Exporter et Réinitialiser s'activent dès le premier."))}</p>
    </div>`;
  renderSendBar();
  wireSync();
  document.getElementById("local-export").addEventListener("click", exportOverlay);
  document.getElementById("local-import").addEventListener("change", importOverlay);
  document.getElementById("local-reset").addEventListener("click", () => {
    if (!state.confirmReset) {
      state.confirmReset = true;
      state.localMsg = "Cela efface tous les changements saisis sur cet appareil. Clique encore pour confirmer.";
      renderLocalPanel();
      document.getElementById("local-reset").focus();
      return;
    }
    state.confirmReset = false;
    state.overlay = newOverlay();
    state.editing = state.editingItem = state.adding = state.confirmDelete = null;
    state.localMsg = "Changements locaux effacés.";
    saveOverlay();
    refreshView("#local-reset");
  });
}

function exportOverlay() {
  const doc = { version: 1, exported: new Date().toISOString(), items: state.overlay.items, added: state.overlay.added };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pc-full-white-changements-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.localMsg = "Fichier exporté.";
  renderLocalPanel();
  document.getElementById("local-export")?.focus();
}

async function importOverlay(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const clean = cleanOverlay(JSON.parse(await file.text()));
    if (!clean) throw new Error("format");
    const n = overlayCount(clean);
    state.overlay = clean;
    state.editing = state.editingItem = state.adding = state.confirmDelete = null;
    state.localMsg = `${n} changement${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""}.`;
    saveOverlay();
    refreshView("#local-import");
  } catch {
    state.localMsg = "Ce fichier n'est pas un export valide de cette page.";
    renderLocalPanel();
  }
  e.target.value = "";
}

// Tout ce qui dépend des achats : à rejouer après chaque coche, sans toucher au reste
// (la checklist du workflow garde ses phases dépliées).
// Boutique d'une offre : « Cdiscount (via Google Shopping) » et « Cdiscount » forment un seul groupe.
const shopName = (label) => String(label || "").replace(/\s*\(via [^)]*\)/, "").replace(/\s+-\s+Seller/i, " (vendeur tiers)").trim();

// Articles à acheter, rangés chez la boutique de leur meilleure offre.
function renderAchats() {
  const d = state.data;
  const groups = new Map();
  let total = 0, n = 0;
  const NONE = "Sans offre en ligne connue";
  for (const sec of ITEM_SECTIONS) {
    for (const item of d[sec]) {
      if (!isLeft(item)) continue;
      const offers = (item.offers || []).filter(o => typeof o.price === "number" && String(o.url).startsWith("https://")).sort((a, b) => a.price - b.price);
      const best = offers[0];
      const shop = best ? shopName(best.retailer) : NONE;
      const price = priceOf(item) || 0;
      if (!groups.has(shop)) groups.set(shop, []);
      groups.get(shop).push({ item, best, price, section: SECTION_LABELS[sec] });
      total += price;
      n += 1;
    }
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || sumOf(b[1]) - sumOf(a[1]));
  function sumOf(rows) { return rows.reduce((x, r) => x + r.price, 0); }
  document.getElementById("achats-list").innerHTML = ordered.map(([shop, rows]) => `
    <section class="shop-group" aria-label="${esc(shop)}">
      <div class="shop-head"><h3 class="shop-name">${esc(shop)} <span class="section-note">(${rows.length} article${rows.length > 1 ? "s" : ""})</span></h3><span class="shop-total">${fmtEUR(sumOf(rows))}</span></div>
      <div class="card">${rows.map(r => `
        <div class="shop-row">
          <div class="shop-item">${esc(r.item.name)}<span>${esc(r.section)}${r.best && Math.abs(r.best.price - r.price) >= 0.5 ? ` · offre à ${fmtEURsmart(r.best.price)}` : ""}</span></div>
          <div class="shop-price">${r.price ? fmtEURsmart(r.price) : "—"}</div>
          ${r.best ? `<a class="shop-link" href="${esc(r.best.url)}" target="_blank" rel="noopener noreferrer">Voir<span class="sr-only"> l'offre : ${esc(r.item.name)} chez ${esc(shop)}</span></a>` : ""}
        </div>`).join("")}</div>
    </section>`).join("");
  document.getElementById("summary-achats").textContent = `${n} article${n > 1 ? "s" : ""} à acheter · ${fmtEUR(total)} · ${groups.size} boutique${groups.size > 1 ? "s" : ""}`;
  const ecart = round2(d.budget_summary.remaining_to_buy - total);
  document.getElementById("achats-note").textContent = Math.abs(ecart) >= 0.5
    ? `Somme article par article : ${fmtEUR(total)}. Le budget affiche ${fmtEUR(d.budget_summary.remaining_to_buy)} : l'écart de ${fmtEUR(Math.abs(ecart))} vient de l'arrondi des relevés conservé dans le total PC.`
    : "";
}

// « Depuis ta dernière visite » : compare les prix publiés à ceux que ce navigateur avait vus.
function currentSnapshot() {
  const prices = {};
  for (const i of allItems(state.base)) if (isLeft(i) && priceOf(i) > 0) prices[i.id] = priceOf(i);
  return { at: todayISO(), prices, remaining: state.base.budget_summary.remaining_to_buy };
}
function renderSinceVisit() {
  const box = document.getElementById("since-visit");
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); } catch { /* illisible : première visite */ }
  const now = currentSnapshot();
  const save = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(now)); } catch { /* stockage bloqué */ } };
  if (!seen || typeof seen.prices !== "object" || !seen.prices) { save(); box.hidden = true; return; }   // première visite : rien à comparer
  const names = new Map(allItems(state.base).map(i => [i.id, i.name]));
  const changes = Object.entries(now.prices)
    .filter(([id, p]) => seen.prices[id] !== undefined && Math.abs(p - seen.prices[id]) >= 0.01)
    .map(([id, p]) => ({ name: names.get(id) || id, from: seen.prices[id], to: p, delta: round2(p - seen.prices[id]) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const totalDelta = round2(now.remaining - (seen.remaining ?? now.remaining));
  if (!changes.length && Math.abs(totalDelta) < 0.5) { box.hidden = true; return; }
  const down = changes.filter(c => c.delta < 0).length, up = changes.length - down;
  const shown = changes.slice(0, 8);
  box.hidden = false;
  box.innerHTML = `
    <h2 id="since-title">Depuis ta dernière visite${seen.at ? ` (${esc(formatISOFR(seen.at))})` : ""}</h2>
    <p>${down ? `<strong class="since-down">${down} prix en baisse</strong>` : ""}${down && up ? " · " : ""}${up ? `<strong class="since-up">${up} en hausse</strong>` : ""}${!changes.length ? "Aucun prix d'article n'a changé" : ""}. Reste à acheter : <strong>${esc(signedEUR(Math.round(totalDelta)))}</strong> (${esc(fmtEUR(now.remaining))}).</p>
    ${changes.length ? `<details><summary>Voir le détail</summary><ul>${shown.map(c => `<li><span>${esc(c.name)}</span><span class="${c.delta < 0 ? "since-down" : "since-up"}">${esc(fmtEURsmart(c.from))} → ${esc(fmtEURsmart(c.to))}</span></li>`).join("")}${changes.length > shown.length ? `<li><span>… et ${changes.length - shown.length} autre${changes.length - shown.length > 1 ? "s" : ""}</span><span></span></li>` : ""}</ul></details>` : ""}
    <button type="button" class="buy-save" id="since-ok">Compris</button>`;
  document.getElementById("since-ok").addEventListener("click", () => { save(); box.hidden = true; });
}

function renderTabCounts() {
  const d = state.data;
  const n = (items) => items.filter(isLeft).length;
  for (const [id, count] of [["pc", n(d.pc_components)], ["periph", n(d.screens) + n(d.peripherals)], ["mobilier", n(d.mobilier) + n(d.outils_bureau)]]) {
    const el = document.getElementById(`count-${id}`);
    if (el) el.innerHTML = count ? `${count}<span class="sr-only"> à acheter</span>` : "";
  }
}

function renderPurchases() {
  renderHero();
  renderTabCounts();
  renderTabSummaries();
  renderAchats();
  renderPC();
  renderScreensAndPeriph();
  renderMobilier();
  renderHistory();
  renderLocalPanel();
}

function renderReglages() {
  const d = state.data, run = d.meta.last_run;
  const lignes = [
    ["Dernière mise à jour des prix", formatDateFR(d.meta.last_verified)],
    ["Prochain relevé", formatMonthFR(d.meta.next_verification)],
  ];
  if (run) {
    lignes.push(["Prix vérifiés au dernier relevé", `${run.verified} sur ${run.tracked} articles suivis`]);
    if (run.searches) lignes.push(["Recherches SerpApi utilisées", `${run.searches.used} sur ${run.searches.budget} prévues`]);
  }
  document.getElementById("releve-info").innerHTML =
    lignes.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
}

function renderAll() {
  renderPurchases();
  renderReglages();
  renderRisks();
  renderWorkflow();
  renderFooter();
}

// ---------------------------------------------------------------
// Résumé de chaque onglet (PC, Périphériques, Mobilier)
// ---------------------------------------------------------------
function renderTabSummaries() {
  const d = state.data;
  const groups = {
    pc: d.pc_components,
    periph: [...d.screens, ...d.peripherals],
    mobilier: [...d.mobilier, ...d.outils_bureau],
  };
  for (const [id, items] of Object.entries(groups)) {
    const left = items.filter(i => i.status !== "bought" && i.status !== "owned_external");
    const bought = items.filter(i => i.status === "bought").length;
    const el = document.getElementById(`summary-${id}`);
    if (!el) continue;
    // Même chiffre que l'en-tête de l'onglet : pc_total et mobilier_2026_total sont des totaux relevés.
    const exact = { pc: d.budget_summary.pc_total, mobilier: d.budget_summary.mobilier_2026_total }[id];
    const remaining = exact ?? left.reduce((s, i) => s + priceOf(i), 0);
    el.textContent = `Reste à acheter ${fmtEUR(remaining)} · ` +
      `${bought} acheté${bought > 1 ? "s" : ""} sur ${items.length}`;
  }
}

// ---------------------------------------------------------------
// HERO / progress
// ---------------------------------------------------------------
function renderHero() {
  const d = state.data;
  const b = d.budget_summary;
  const limit = d.meta.prime_limit;

  document.getElementById("progress-cur").textContent = fmtEUR(b.remaining_to_buy);
  document.getElementById("progress-goal").textContent = fmtEUR(limit);
  document.getElementById("mini-cur").textContent = fmtEUR(b.remaining_to_buy);
  document.getElementById("mini-margin").textContent = fmtEUR(b.margin_vs_prime);
  const age = document.getElementById("data-age");
  const jours = Math.floor((Date.now() - new Date(`${d.meta.last_verified}T12:00:00`).getTime()) / 86400000);
  age.textContent = `Prix relevés le ${formatDateFR(d.meta.last_verified)} · ${jours <= 0 ? "aujourd'hui" : jours === 1 ? "hier" : `il y a ${jours} jours`}${jours > 21 ? " : relevé ancien, les prix ont pu bouger" : ""}`;
  age.classList.toggle("stale", jours > 21);
  document.getElementById("stat-bought").textContent = fmtEUR(b.already_bought);
  document.getElementById("stat-total").textContent = fmtEUR(b.total_complete);
  document.getElementById("stat-margin").textContent = fmtEUR(b.margin_vs_prime);
  document.getElementById("stat-pcmargin").textContent = fmtEUR(b.pc_margin);
  document.getElementById("stat-pcmargin-sub").textContent = `limite ${fmtEUR(d.meta.pc_limit)}`;

  // Cartes 2026 / 2027 : le montant vient du résumé, jamais recopié ici.
  const tl = document.getElementById("timeline");
  if (tl && d.timeline) {
    tl.innerHTML = d.timeline.map((t, i) => `
      <div class="timeline-card tl-${i}">
        <div class="timeline-year">${esc(t.year)}</div>
        <div class="timeline-title"><span aria-hidden="true">${itemIcon(t.icon)}</span> ${esc(t.title)} · ${fmtEUR(b[t.amount])}</div>
        <div class="timeline-detail">${esc(t.detail)}</div>
      </div>`).join("");
  }

  // Barre segmentée du reste à acheter : PC, périphériques, mobilier (leur somme vaut le reste à acheter).
  // La limite de la prime est un repère sur la même échelle.
  const segs = [
    { name: "PC", amount: b.pc_total, cls: "pc" },
    { name: "Périphériques", amount: round2(sumLeft([...d.screens, ...d.peripherals])), cls: "periph" },
    { name: "Mobilier", amount: b.mobilier_2026_total, cls: "mob" },
  ];
  const scale = Math.max(limit, b.remaining_to_buy, 1) * 1.06;
  const bar = document.getElementById("seg-bar");
  bar.innerHTML = segs.filter(x => x.amount > 0).map(x => `<span class="seg ${x.cls}" style="width:${((x.amount / scale) * 100).toFixed(2)}%"></span>`).join("");
  bar.setAttribute("aria-label", `Reste à acheter ${fmtEUR(b.remaining_to_buy)} sur une limite de ${fmtEUR(limit)} : ${segs.map(x => `${x.name} ${fmtEUR(x.amount)}`).join(", ")}`);
  const lim = document.getElementById("seg-limit");
  lim.style.left = `${((limit / scale) * 100).toFixed(2)}%`;
  lim.classList.toggle("is-right", limit / scale > 0.8);
  document.getElementById("seg-limit-label").textContent = `limite ${fmtEUR(limit)}`;
  lim.setAttribute("aria-hidden", "true");
  const totalSeg = segs.reduce((x, y) => x + y.amount, 0) || 1;
  document.getElementById("seg-legend").innerHTML = segs.map(x =>
    `<li><i class="dot ${x.cls}" aria-hidden="true"></i>${x.name} <b>${fmtEUR(x.amount)}</b> <span>(${Math.round((x.amount / totalSeg) * 100)} %)</span></li>`).join("");
  for (const [id, v] of [["stat-margin", b.margin_vs_prime], ["stat-pcmargin", b.pc_margin]]) {
    document.getElementById(id).closest(".stat-tile").classList.toggle("neg", v < 0);
  }

  const order = document.getElementById("purchase-order");
  if (order && d.purchase_order) order.innerHTML = d.purchase_order.map(s => `<li>${esc(s)}</li>`).join("");

  // Règles de suivi budget
  const rulesList = document.getElementById("budget-rules-list");
  if (rulesList && d.budget_rules) {
    rulesList.innerHTML = d.budget_rules.map(r => `
      <div class="risk-item">
        <div class="risk-title" style="margin-bottom:4px;">${esc(r.rule)}</div>
        <div class="risk-mitigation">${esc(r.detail)}</div>
      </div>`).join("");
  }
}

// Donut en SVG : un cercle par catégorie, découpé au stroke-dasharray. La part
// déjà payée est un second tracé hachuré posé au début du segment périphériques.
function priceOf(item) {
  if (item.price !== undefined) return item.price;
  if (item.price_min !== undefined && item.price_max !== undefined) return (item.price_min + item.price_max) / 2;
  return 0;
}
function priceLabel(item) {
  if (item.price !== undefined) return fmtEUR(item.price);
  if (item.price_min !== undefined) return `${Math.round(item.price_min)}-${Math.round(item.price_max)} €`;
  return "—";
}

// "2026-11-15" -> "15 novembre 2026", "2026-11" -> "novembre 2026" ; une valeur non reconnue est affichée telle quelle.
function formatMonthFR(ym) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(ym))) return formatDateFR(ym);
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym));
  if (!m) return ym;
  const months = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

function formatDateFR(iso) {
  const months = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  const [y,m,day] = iso.split("-").map(Number);
  return `${day} ${months[m-1]} ${y}`;
}

// ---------------------------------------------------------------
// PC — composants, airflow, RGB, stockage
// ---------------------------------------------------------------
function renderPC() {
  const d = state.data;


  const list = document.getElementById("pc-components-list");
  list.innerHTML = addBlockHTML("pc_components", true) + cardGroupsHTML(d.pc_components, d.budget_summary.pc_total);

  // Airflow (avec PWM/ARGB)
  const airflow = document.getElementById("airflow-table-body");
  airflow.innerHTML = d.airflow.map(a => `
    <tr>
      <td>${esc(a.zone)}</td>
      <td>${esc(a.count)}</td>
      <td>${esc(a.sens)}</td>
      <td class="cell-mono">${esc(a.pwm)}</td>
      <td class="cell-mono">${esc(a.argb)}</td>
    </tr>`).join("");

  setText("airflow-summary", d.airflow_summary);
  setText("airflow-note", d.airflow_note);

  // Stockage — le total vient des capacités du tableau, pas d'un titre figé
  // (le titre disait « ~11 To » alors que le 990 PRO retenu est le 2 To).
  const totalTo = d.stockage.reduce((s, x) => s + parseFloat(String(x.capacite).replace(",", ".")), 0);
  document.getElementById("stockage-title").textContent = `Stockage — ~${totalTo} To`;
  document.getElementById("stockage-smart-th").textContent =
    d.stockage_smart_date ? `État SMART (${d.stockage_smart_date})` : "SMART";
  const sw = document.getElementById("stockage-warning");
  sw.innerHTML = d.stockage_warning ? `${ICO("alert")} ${esc(d.stockage_warning)}` : "";
  sw.hidden = !d.stockage_warning;
  { const tip = document.getElementById("stockage-tip"); tip.innerHTML = d.stockage_tip ? `${ICO("bulb")} ${esc(d.stockage_tip)}` : ""; }

  // Stockage
  const stock = document.getElementById("stockage-table-body");
  stock.innerHTML = d.stockage.map(s => `
    <tr>
      <td style="font-family:var(--font-body);font-weight:600;">${esc(s.disque)}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${esc(s.type)}</td>
      <td>${esc(s.capacite)}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${esc(s.usage)}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${esc(s.smart)}</td>
    </tr>`).join("");

  // RGB
  const rgb = document.getElementById("rgb-list");
  rgb.innerHTML = d.rgb_ecosystem.map(r => `
    <div class="item-row">
      <div class="item-main">
        <div class="item-name">${esc(r.composant)}</div>
        <div class="item-model">${esc(r.note)}</div>
      </div>
      <span class="status-pill bought">${esc(r.integration)}</span>
    </div>`).join("");

  const rgbNotes = document.getElementById("rgb-notes");
  if (rgbNotes && d.rgb_notes) {
    rgbNotes.innerHTML = d.rgb_notes.map(n => `<p class="section-note" style="margin:4px 0;">${esc(n)}</p>`).join("");
  }

  // Fonctionnalités SignalRGB
  const featuresList = document.getElementById("signalrgb-features-list");
  if (featuresList && d.signalrgb_features) {
    featuresList.innerHTML = d.signalrgb_features.map(f => `<li>${esc(f)}</li>`).join("");
  }
}

// Liens d'achat relevés par le scraper (offers), du moins cher au plus cher. Ouvrent le
// revendeur dans un nouvel onglet : le texte caché le dit aux lecteurs d'écran.
function offersHTML(item) {
  const offers = (item.offers || []).filter(o => /^https:\/\//.test(o.url))
    .sort((a, b) => (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0));
  if (!offers.length) return "";
  const links = offers.map(o => `
    <a class="offer-link" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">
      <span class="offer-shop">${esc(o.retailer)}</span>
      <span class="offer-price">${o.price == null ? "prix sur le site" : fmtEURprecise(o.price)}</span>
      <span class="offer-seen">${o.seen ? "vu le " + esc(o.seen.split("-").reverse().join("/")) : ""}</span>
      <span aria-hidden="true">${ICO("out")}</span>
      <span class="sr-only">, s'ouvre dans un nouvel onglet</span>
    </a>`).join("");
  return `<div class="item-offers"><p class="item-section-title">Où acheter (${offers.length})<span class="sr-only"> : ${esc(item.name)}</span></p><div class="offer-list">${links}</div></div>`;
}

// Les articles se présentent en cartes repliables : une ligne (nom, modèle abrégé, prix), puis,
// au clic, pastilles de caractéristiques, notes, offres et case d'achat. Un <details> natif
// porte le clavier et l'accessibilité ; l'état ouvert est gardé d'un rendu à l'autre.
function factsOf(item) {
  const hasModel = Boolean(item.model || item.ref);
  const segs = String(item.model || item.ref || item.role || item.note || "")
    .split("·").map(x => x.trim()).filter(Boolean);
  const chips = [], longer = [];
  for (const x of segs.slice(1)) (x.length <= 30 && chips.length < 4 ? chips : longer).push(x);
  const note = hasModel ? [longer.join(" · "), item.note || ""] : [longer.join(" · ")];
  return { short: segs[0] || "", chips, note: note.filter(Boolean).join(" · ") };
}

function priceText(item) {
  if (item.status === "owned_external" && item.price === 0) return "déjà en main";
  if (item.price === 0) return "Gratuit";
  return item.price_min !== undefined && item.price === undefined ? priceLabel(item) : fmtEURsmart(item.price);
}

function specsHTML(item) {
  if (!item.specs) return "";
  const rows = Object.entries(item.specs).map(([k, v]) =>
    `<div class="spec-row"><span class="spec-k">${esc(k)}</span><span class="spec-v">${esc(v)}</span></div>`).join("");
  return `<p class="item-section-title">Caractéristiques<span class="sr-only"> : ${esc(item.name)}</span></p><div class="spec-grid">${rows}</div>`;
}

// Variation depuis le dernier relevé précédent, pour les articles qui ont leur propre ligne dans
// l'historique (les lignes qui regroupent plusieurs articles, comme les ventilos, n'en ont pas).
function variationHTML(item) {
  if (item.status === "bought" || item.status === "owned_external" || !(item.price > 0)) return "";
  const comp = (state.data.price_history_components || []).find(c => c.refs && c.refs.length === 1 && c.refs[0] === item.id);
  const before = comp && (comp.series || []).slice(0, -1).filter(v => v != null).pop();
  if (!(before > 0)) return "";
  const delta = round2(item.price - before);
  if (Math.abs(delta) < 1) return "";
  const up = delta > 0;
  return `<span class="item-delta ${up ? "up" : "down"}"><span aria-hidden="true">${ICO(up ? "up" : "down")}${up ? "+" : "−"}${Math.round(Math.abs(delta))} €</span>`
    + `<span class="sr-only">${up ? "en hausse" : "en baisse"} de ${Math.round(Math.abs(delta))} € depuis le relevé précédent</span></span>`;
}

function cardHTML(item) {
  item = { icon: item.specs && item.role ? "🖥️" : "📦", ...item };   // les écrans n'ont pas d'icône dans les données
  const bought = item.status === "bought", owned = item.status === "owned_external";
  const f = factsOf(item);
  const open = state.open.has(item.id) || state.editing === item.id || state.editingItem === item.id;
  return `
    <details class="item-card${bought || owned ? " is-done" : ""}" data-card="${esc(item.id)}"${open ? " open" : ""}>
      <summary class="item-head">
        <span class="item-icon" aria-hidden="true">${itemIcon(item.icon)}</span>
        <span class="item-main"><span class="item-name">${esc(item.name)}${item.local ? ' <span class="local-badge">modifié ici</span>' : ""}</span><span class="item-model">${esc(f.short)}</span></span>
        <span class="item-money"><span class="item-price">${priceText(item)}</span>${variationHTML(item)}</span>
        ${bought ? '<span class="status-pill bought">Acheté</span>' : owned ? '<span class="status-pill bought">Possédé</span>' : ""}
        <span class="chev" aria-hidden="true">${ICO("expand")}</span>
      </summary>
      <div class="item-body">
        ${f.chips.length ? `<div class="item-chips">${f.chips.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
        ${f.note ? `<p class="item-note">${esc(f.note)}</p>` : ""}
        ${specsHTML(item)}${offersHTML(item)}${buyHTML(item)}
      </div>
    </details>`;
}

// Deux groupes, avec leur total : ce qui reste à acheter, puis ce qui est acheté ou déjà en main.
// `leftTotal` impose le total du groupe « à acheter » quand le fichier en publie un (pc_total).
function cardGroupsHTML(items, leftTotal) {
  const todo = items.filter(isLeft), done = items.filter(i => !isLeft(i));
  const group = (title, list, total) => list.length ? `
    <div class="group-head"><h3 class="group-title">${title} (${list.length})</h3><span class="group-total">${fmtEURsmart(total)}</span></div>
    <div class="card item-cards">${list.map(cardHTML).join("")}</div>` : "";
  const masques = state.onlyToBuy && done.length ? `<p class="section-note" style="margin:10px 0 0;">${done.length} article${done.length > 1 ? "s" : ""} acheté${done.length > 1 ? "s" : ""} masqué${done.length > 1 ? "s" : ""} (filtre « À acheter seulement »).</p>` : "";
  return group("À acheter", todo, leftTotal ?? sumLeft(items)) + (state.onlyToBuy ? masques : group("Acheté ou en main", done, sumBought(items)));
}

// ---------------------------------------------------------------
// Écrans + Périphériques
// ---------------------------------------------------------------
function renderScreensAndPeriph() {
  const d = state.data;
  setText("screens-note", d.screens_note);
  document.getElementById("screens-list").innerHTML = addBlockHTML("screens", true) + cardGroupsHTML(d.screens);
  document.getElementById("periph-list").innerHTML = addBlockHTML("peripherals") + cardGroupsHTML(d.peripherals);
}

// ---------------------------------------------------------------
// Mobilier
// ---------------------------------------------------------------
function renderMobilier() {
  const d = state.data;
  document.getElementById("mobilier-list").innerHTML = addBlockHTML("mobilier", true) + cardGroupsHTML(d.mobilier);
  document.getElementById("outils-bureau-list").innerHTML = addBlockHTML("outils_bureau") + cardGroupsHTML(d.outils_bureau);
}

// ---------------------------------------------------------------
// Risques, décisions, améliorations, veille
// ---------------------------------------------------------------
function renderRisks() {
  const d = state.data;

  const risks = document.getElementById("risks-list");
  const impactMap = { high: ["risk-high","Élevé"], medium: ["risk-medium","Moyen"], low: ["risk-low","Faible"] };
  risks.innerHTML = d.risks.map(r => {
    const [cls, label] = impactMap[r.impact];
    return `
      <div class="risk-item">
        <div class="risk-top">
          <span class="risk-title">${esc(r.risk)}</span>
          <span class="tag ${cls}">Impact ${label}</span>
        </div>
        <div class="risk-mitigation">${esc(r.mitigation)}</div>
      </div>`;
  }).join("");

  const decisions = document.getElementById("decisions-list");
  decisions.innerHTML = d.decisions.map(dec => `
    <div class="decision-item">
      <span class="decision-topic">${esc(dec.topic)}</span>
      <span class="decision-choice">${esc(dec.decision)}</span>
    </div>`).join("");

  const upgrades = document.getElementById("upgrades-list");
  upgrades.innerHTML = d.possible_upgrades.map(u => `
    <div class="item-row">
      <div class="item-icon" aria-hidden="true">${itemIcon(u.icon)}</div>
      <div class="item-main">
        <div class="item-name">${esc(u.name)}</div>
        <div class="item-model">${esc(u.utility)}</div>
      </div>
      <div class="item-price">${priceLabel(u)}</div>
    </div>`).join("");

  const watch = document.getElementById("watch-list");
  watch.innerHTML = d.watch_list.map(w => `
    <li class="watch-item"><span class="eye">${ICO("eye")}</span><span>${esc(w)}</span></li>`).join("");

  const crit = document.getElementById("critical-list");
  crit.innerHTML = d.critical_points.map(c => `<li>${esc(c)}</li>`).join("");
}

// ---------------------------------------------------------------
// Workflow — phases dépliables avec checklist persistée
// ---------------------------------------------------------------
function renderWorkflow() {
  const d = state.data;
  const wrap = document.getElementById("phase-list");
  wrap.innerHTML = d.workflow_phases.map(p => {
    const key = `phase-${p.num}`;
    const panelId = `${key}-panel`;
    return `
      <div class="phase-card" data-phase="${key}">
        <button type="button" class="phase-header" aria-expanded="false" aria-controls="${panelId}">
          <span class="phase-num" aria-hidden="true">P${esc(p.num)}</span>
          <span class="phase-body">
            <span class="phase-title-row">
              <span class="phase-title-main"><span aria-hidden="true">${itemIcon(p.icon)}</span><span class="phase-title">Phase ${esc(p.num)} — ${esc(p.title)}</span></span>
              <span class="phase-meta">${esc(p.when)} · ${esc(p.duration)}</span>
            </span>
            ${p.note ? `<span class="phase-summary">${esc(p.note)}</span>` : ""}
          </span>
          <span class="phase-chevron" aria-hidden="true">${ICO("chev")}</span>
        </button>
        <div class="phase-checklist" id="${panelId}" role="group" aria-label="Checklist de la phase ${esc(p.num)}">
          ${(p.extra_notes || []).map(n => `<p class="phase-callout">${esc(n)}</p>`).join("")}
          ${p.groups.map(g => renderPhaseGroup(key, p.num, g)).join("")}
          ${p.tips ? `<div class="phase-tips"><div class="phase-tips-title">${ICO("alert")} ${esc(p.tips.title)}</div><ul>${p.tips.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
          <div class="phase-result">${ICO("check")} <strong>Résultat attendu :</strong> ${esc(p.result)}</div>
        </div>
      </div>`;
  }).join("");

  // Dépliage : le bouton d'en-tête porte l'état, la classe sur la carte pilote
  // l'affichage et la rotation du chevron. Entrée et Espace sont gratuits
  // puisque c'est un vrai <button>.
  wrap.querySelectorAll(".phase-header").forEach(header => {
    header.addEventListener("click", () => {
      const card = header.closest(".phase-card");
      const open = card.classList.toggle("open");
      header.setAttribute("aria-expanded", String(open));
    });
  });

  wrap.querySelectorAll(".check-row").forEach(row => {
    const key = row.dataset.key;
    const setChecked = (value) => {
      state.checklist[key] = value;
      row.classList.toggle("checked", value);
      row.setAttribute("aria-checked", String(value));
    };
    setChecked(Boolean(state.checklist[key]));

    row.addEventListener("click", () => {
      setChecked(!state.checklist[key]);
      saveChecklist();
      updatePhaseProgress();
    });
  });

  setText("workflow-subtitle", d.meta.workflow_subtitle);
  renderFinale(d);
  updatePhaseProgress();
}

// Fin de montage : rangement du MSI Pulse 17 et bandeau « Setup terminé ».
function renderFinale(d) {
  const f = d.workflow_finale, el = document.getElementById("workflow-finale");
  if (!f || !el) return;
  el.innerHTML = `
    <div class="finale-grid">
      <section class="card card-pad" aria-labelledby="finale-msi">
        <h3 class="sub-title" id="finale-msi">${ICO("laptop")} ${esc(f.msi_title)}</h3>
        <p class="finale-text">${esc(f.msi_text)}</p>
      </section>
      <section class="card card-pad finale-done" aria-labelledby="finale-done">
        <h3 class="sub-title" id="finale-done">${ICO("check")} ${esc(f.done_title)}</h3>
        <ul class="plain-list">${f.done_items.map(i => `<li>${ICO("check")} <span>${esc(i)}</span></li>`).join("")}</ul>
        <p class="finale-text">${ICO("camera")} ${esc(f.photo)}</p>
      </section>
    </div>`;
}

let groupCounter = 0;
function renderPhaseGroup(phaseKey, phaseNum, group) {
  groupCounter++;
  const gid = `g${groupCounter}`;
  const titleId = `${gid}-title`;
  const warningHTML = group.warning
    ? `<div class="group-warning">${ICO("alert")} ${esc(group.warning)}</div>`
    : "";
  const itemsHTML = group.items.map((item, i) => {
    const itemKey = `${phaseKey}-${gid}-${i}`;
    const checked = Boolean(state.checklist[itemKey]);
    return `
      <button type="button" role="checkbox" class="check-row${checked ? " checked" : ""}"
              data-key="${itemKey}" aria-checked="${checked}">
        <span class="check-box" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="check-text">${esc(item)}</span>
      </button>`;
  }).join("");
  return `
    <div class="check-group" role="group" aria-labelledby="${titleId}">
      <div class="check-group-title" id="${titleId}">${esc(group.title)}</div>
      ${warningHTML}
      ${itemsHTML}
    </div>`;
}

function updatePhaseProgress() {
  const el = document.getElementById("workflow-progress-note");
  if (el) {
    const allKeys = document.querySelectorAll(".check-row").length;
    const done = document.querySelectorAll(".check-row.checked").length;
    el.textContent = allKeys ? `${done} / ${allKeys} étapes cochées · sauvegardé sur cet appareil` : "";
  }
}

// ---------------------------------------------------------------
// Historique des prix
// ---------------------------------------------------------------
function renderHistory() {
  const d = state.data;

  const b = d.budget_summary;
  const dates = d.price_history_dates || [];
  const cellEUR = (v) => (v === null || v === undefined) ? "introuvable" : fmtEUR(v);
  // La flèche et la couleur portent la même information : le mot la rend
  // lisible sans distinguer les couleurs et audible au lecteur d'écran.
  const evoCell = (delta, trend) => {
    const cls = trend === "up" ? "trend-up" : (trend === "down" ? "trend-down" : "trend-stable");
    const arrow = ICO(trend === "up" ? "up" : (trend === "down" ? "down" : "flat"));
    const word = trend === "up" ? "en hausse" : (trend === "down" ? "en baisse" : "stable");
    return `<td class="${cls}"><span aria-hidden="true">${arrow}</span> ${delta > 0 ? "+" : ""}${Math.round(delta)} €<span class="sr-only"> ${word}</span></td>`;
  };

  // Carte thermique : chaque case compare le prix du relevé au prix de référence. La flèche et le mot
  // cachés portent la même information que la teinte (lisible sans distinguer les couleurs).
  const heatCell = (v, ref) => {
    if (v === null || v === undefined) return `<td class="heat">introuvable</td>`;
    const p = ref ? (v - ref) / ref : 0, a = Math.abs(p);
    if (a < 0.01) return `<td class="heat">${fmtEUR(v)}</td>`;
    const lvl = a < 0.05 ? 1 : a < 0.15 ? 2 : 3, dir = p > 0 ? "up" : "down";
    return `<td class="heat heat-${dir}-${lvl}"><i aria-hidden="true">${ICO(p > 0 ? "up" : "down")}</i>${fmtEUR(v)}<span class="sr-only">, ${p > 0 ? "plus cher" : "moins cher"} de ${Math.round(a * 100)} % que la référence</span></td>`;
  };
  document.getElementById("history-head").innerHTML =
    `<tr><th scope="col">Composant</th>${dates.map(x => `<th scope="col">${esc(x)}</th>`).join("")}<th scope="col">Évolution</th></tr>`;

  const totalSerie = d.price_history_total_series || [d.price_history[0].pc_total, d.price_history[d.price_history.length - 1].pc_total];
  const totalDelta = totalSerie[totalSerie.length - 1] - totalSerie[0];
  const lines = d.price_history_components.map(c => ({ name: c.component, serie: c.series || [c.ref, c.current], ref: c.ref, delta: c.evolution, trend: c.trend }));
  document.getElementById("history-components-body").innerHTML = lines.map(c =>
    `<tr><th scope="row">${esc(c.name)}</th>${c.serie.map((v, i) => i === 0 ? `<td>${cellEUR(v)}</td>` : heatCell(v, c.ref)).join("")}${evoCell(c.delta, c.trend)}</tr>`).join("")
    + `<tr class="total-row"><th scope="row">TOTAL PC</th>${totalSerie.map(v => `<td>${cellEUR(v)}</td>`).join("")}${evoCell(totalDelta, totalDelta > 0 ? "up" : "down")}</tr>`;

  // Mini-courbes : une ligne par composant, courbe + pastille de variation.
  const sparkSVG = (serie, trend) => {
    const vals = serie.filter(v => v !== null && v !== undefined);
    if (vals.length < 2) return "";
    const w = 84, h = 28, lo = Math.min(...vals), hi = Math.max(...vals), rng = (hi - lo) || 1;
    const pts = vals.map((v, i) => [2 + i * (w - 4) / (vals.length - 1), h - 3 - ((v - lo) / rng) * (h - 6)]);
    const path = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");
    const col = trend === "up" ? "var(--risk-red)" : trend === "down" ? "var(--ok-green)" : "var(--on-surface-faint)";
    const alt = `De ${fmtEUR(vals[0])} à ${fmtEUR(vals[vals.length - 1])} sur ${vals.length} relevés`;
    return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(alt)}"><path d="${path} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z" fill="${col}" opacity="0.12"/><path d="${path}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.8" fill="${col}"/></svg>`;
  };
  const chipHTML = (delta, trend) => {
    const cls = trend === "up" ? "up" : trend === "down" ? "down" : "flat";
    const arrow = ICO(trend === "up" ? "up" : trend === "down" ? "down" : "flat");
    const word = trend === "up" ? "en hausse" : trend === "down" ? "en baisse" : "stable";
    return `<span class="spark-chip ${cls}"><span aria-hidden="true">${arrow}</span> ${delta > 0 ? "+" : ""}${Math.round(delta)} €<span class="sr-only"> ${word}</span></span>`;
  };
  const rowHTML = (name, serie, ref, cur, delta, trend, total) =>
    `<div class="spark-row${total ? " is-total" : ""}" role="listitem"><div class="spark-name"><b>${esc(name)}</b><span>${cellEUR(ref)} → ${cellEUR(cur)}</span></div>${sparkSVG(serie, trend)}${chipHTML(delta, trend)}</div>`;
  const last = (arr) => arr[arr.length - 1];
  document.getElementById("hist-spark").setAttribute("role", "list");
  document.getElementById("hist-spark").innerHTML = lines.map(c => rowHTML(c.name, c.serie, c.ref, last(c.serie), c.delta, c.trend, false)).join("")
    + rowHTML("TOTAL PC", totalSerie, totalSerie[0], last(totalSerie), totalDelta, totalDelta > 0 ? "up" : "down", true);

  // Récapitulatif des achats : le total affiché est recalculé et contrôlé par
  // check_prices.py contre remaining_to_buy.
  const recap = d.purchase_recap || [];
  const recapTotal = recap.reduce((s, r) => s + r.price, 0);
  document.getElementById("recap-title").textContent = `Reste à acheter (${fmtEUR(recapTotal)})`;
  const rows = [...recap].sort((x, y) => y.price - x.price), maxRow = rows[0]?.price || 1;
  document.getElementById("recap-body").innerHTML = rows.map(r =>
    `<div class="recap-row" role="listitem"><span class="recap-label">${esc(r.label)}</span><span class="recap-amt">${fmtEURsmart(r.price)}</span><span class="recap-meter" aria-hidden="true"><span class="recap-fill${/2027/.test(r.when) ? " y2027" : ""}" style="width:${Math.max((r.price / maxRow) * 100, 2).toFixed(1)}%"></span></span><span class="recap-when">${esc(r.when)}</span></div>`).join("")
    + `<div class="recap-total" role="listitem"><span>Total</span><span>${fmtEUR(recapTotal)}</span></div>`;

  document.getElementById("bought-title").textContent = `Déjà acheté (${fmtEUR(b.already_bought)}) — prix figés`;
  document.getElementById("bought-list").innerHTML = allItems(d).filter(p => p.status === "bought").map(p =>
    `<li><span>${ICO("check")} ${esc(p.name)}</span><span class="amt">${fmtEURsmart(p.price)}</span></li>`).join("");

  const lv = d.price_levers, lvEl = document.getElementById("levers");
  if (lv) {
    const line = (items) => items.map(x => `${esc(x.label)} ${signedEUR(x.delta)}`).join(" · ");
    lvEl.innerHTML = `
      <h3 class="sub-title">Leviers du ${esc(lv.date)}</h3>
      <p class="lever-line"><strong>Baisses :</strong> ${line(lv.down)}</p>
      <p class="lever-line"><strong>Hausses :</strong> ${line(lv.up)}</p>
      ${lv.note ? `<p class="section-note">${esc(lv.note)}</p>` : ""}`;
  }

  const v = d.verification, vEl = document.getElementById("verification");
  if (v) {
    vEl.innerHTML = `
      <p class="ver-line"><strong>Sources.</strong> ${esc(v.sources)}</p>
      <p class="ver-line"><strong>Risque principal.</strong> ${esc(v.main_risk)}</p>
      <p class="ver-line"><strong>Priorité actuelle.</strong> ${esc(v.priority)}</p>
      ${d.meta.gpu_watch ? `<p class="ver-line"><strong>Veille GPU.</strong> ${esc(d.meta.gpu_watch)}</p>` : ""}
      <ul class="ver-notes">${v.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
  }

  // Courbe du budget total : aire, limite de la prime en pointillés, points touchables (valeur du relevé dessous).
  const points = d.price_history.filter(h => h.budget_total !== null);
  const svgWrap = document.getElementById("history-sparkline");
  if (points.length > 1) {
  // Le dessin suit la largeur réelle du conteneur (échelle 1 : le texte garde sa taille, 12 px au minimum),
  // et se redessine quand cette largeur change (le panneau Historique est caché au premier rendu).
  const draw = () => {
    const w = Math.min(640, Math.max(240, svgWrap.clientWidth || 340)), h = 230, L = 44, R = 12, T = 34, B = 26;
    const vals = points.map(p => p.budget_total), limit = d.meta.prime_limit;
    const lo = Math.floor((Math.min(...vals, limit) * 0.97) / 100) * 100, hi = Math.ceil((Math.max(...vals, limit) * 1.03) / 100) * 100;
    const X = (i) => L + i * (w - L - R) / (points.length - 1), Y = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
    const coords = points.map((p, i) => [X(i), Y(p.budget_total)]);
    const path = coords.map((c, i) => (i === 0 ? "M" : "L") + c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
    const area = path + ` L${coords[coords.length - 1][0].toFixed(1)},${h - B} L${coords[0][0].toFixed(1)},${h - B} Z`;
    const step = Math.ceil((hi - lo) / 4 / 100) * 100;
    let grid = "";
    for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      grid += `<line x1="${L}" x2="${w - R}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}" stroke="var(--outline-variant)"/><text x="${L - 6}" y="${(Y(g) + 4).toFixed(1)}" font-size="12" fill="var(--on-surface-variant)" text-anchor="end" font-family="JetBrains Mono, monospace">${g}</text>`;
    }
    const dots = coords.map((c, i) => `<g class="chart-dot" tabindex="0" role="button" data-i="${i}" aria-label="${esc(points[i].label)} : ${esc(fmtEUR(points[i].budget_total))}"><circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="24" fill="transparent"/><circle class="chart-dot-ring" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="5" fill="var(--surface)" stroke="var(--primary)" stroke-width="2.2"/></g>`).join("");
    const pas = Math.max(1, Math.ceil(56 / ((w - L - R) / (points.length - 1))));   // une date sur `pas` si elles se chevauchent (la dernière reste)
    const labels = points.map((p, i) => (points.length - 1 - i) % pas ? "" : `<text x="${coords[i][0].toFixed(1)}" y="${h - 8}" font-size="12" fill="var(--on-surface-variant)" text-anchor="${i === 0 ? "start" : (i === points.length - 1 ? "end" : "middle")}" font-family="JetBrains Mono, monospace">${esc(p.label)}</text>`).join("");
    const lastC = coords[coords.length - 1], badge = fmtEUR(vals[vals.length - 1]);
    const first = points[0], lastP = points[points.length - 1];
    const sens = lastP.budget_total > first.budget_total ? "en hausse" : (lastP.budget_total < first.budget_total ? "en baisse" : "stable");
    const alt = `Évolution du budget total, ${sens} : de ${fmtEUR(first.budget_total)} (${first.label}) à ${fmtEUR(lastP.budget_total)} (${lastP.label}). Limite de la prime : ${fmtEUR(limit)}.`;
    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;" role="group" aria-label="${esc(alt)}">
        <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--am31-blue)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--am31-blue)" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <line x1="${L}" x2="${w - R}" y1="${Y(limit).toFixed(1)}" y2="${Y(limit).toFixed(1)}" stroke="var(--risk-red)" stroke-width="1.6" stroke-dasharray="5 4"/>
        <text x="${w - R}" y="${(Y(limit) - 6).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="var(--risk-red)">limite ${esc(fmtEUR(limit))}</text>
        <path d="${area}" fill="url(#areaGrad)"/>
        <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <rect x="${(lastC[0] - 78).toFixed(1)}" y="${(lastC[1] - 36).toFixed(1)}" width="80" height="22" rx="11" fill="var(--on-surface)"/>
        <text x="${(lastC[0] - 38).toFixed(1)}" y="${(lastC[1] - 21).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--surface)" font-family="JetBrains Mono, monospace">${esc(badge)}</text>
        ${labels}
      </svg>`;
    const tip = document.getElementById("chart-tip");
    const show = (i) => {
      const p = points[i], prev = points[i - 1];
      const diff = prev ? ` (${signedEUR(p.budget_total - prev.budget_total)} depuis le ${prev.label})` : "";
      tip.innerHTML = `<strong>${esc(p.label)}</strong> · ${esc(fmtEUR(p.budget_total))}${esc(diff)}`;
    };
    svgWrap.onclick = (e) => { const g = e.target.closest(".chart-dot"); if (g) show(Number(g.dataset.i)); };
    svgWrap.onkeydown = (e) => { const g = e.target.closest?.(".chart-dot"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); show(Number(g.dataset.i)); } };
  };
  draw();
  svgWrap._ro?.disconnect();
  if (typeof ResizeObserver !== "undefined") {
    let derniere = svgWrap.clientWidth;
    svgWrap._ro = new ResizeObserver(() => {
      const cw = svgWrap.clientWidth;
      if (cw && Math.abs(cw - derniere) > 1) { derniere = cw; draw(); }
    });
    svgWrap._ro.observe(svgWrap);
  }
  }

  // Le bilan du dernier relevé dit combien de prix ont réellement été vérifiés : la date seule
  // laisserait croire que tous l'ont été, alors que seuls les articles ayant des sources le sont.
  const run = d.meta.last_run;
  const bilan = run
    ? ` · Dernier relevé automatique (${formatDateFR(run.date)}) : ${run.verified} prix vérifiés sur ${run.tracked} articles suivis, ${run.updated} mis à jour.` +
      (run.searches ? ` Recherches de prix : ${run.searches.used} sur ${run.searches.budget}.` : "")
    : "";
  document.getElementById("history-note").textContent =
    `Prochaine vérification : ${formatMonthFR(d.meta.next_verification)} · Dernière mise à jour : ${formatDateFR(d.meta.last_verified)}${bilan}`;
}

// ---------------------------------------------------------------
// Footer
// ---------------------------------------------------------------
function renderFooter() {
  const d = state.data;
  document.getElementById("footer-date").textContent = `Généré le ${formatDateFR(d.meta.last_verified)}`;
}

// ---------------------------------------------------------------
// Navigation par onglets
// ---------------------------------------------------------------
// Swipe de gauche à droite sur téléphone : un glissement vers la gauche ouvre l'onglet suivant, vers la
// droite le précédent. Il ne démarre pas près des bords (geste Retour d'Android), ni sur un tableau qui
// défile, un champ de saisie ou la barre d'onglets elle-même.
const SWIPE_MIN = 60;      // px parcourus au minimum
const SWIPE_EDGE = 24;     // zone morte sur chaque bord
const SWIPE_MAX_MS = 800;
function scrollableX(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}
function wireSwipe(getTabs) {
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  let start = null;
  document.addEventListener("touchstart", (e) => {
    start = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0], el = e.target;
    if (t.clientX < SWIPE_EDGE || t.clientX > window.innerWidth - SWIPE_EDGE) return;
    if (el.closest("input, textarea, select, [contenteditable], .tabs, .destinations, .send-bar") || scrollableX(el)) return;
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!start || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.at;
    start = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 1.5 * Math.abs(dy) || dt > SWIPE_MAX_MS) return;
    const tabs = getTabs();
    const i = tabs.findIndex(x => x.classList.contains("active"));
    const next = tabs[i + (dx < 0 ? 1 : -1)];
    if (next) next.click();
  }, { passive: true });
  document.addEventListener("touchcancel", () => { start = null; }, { passive: true });
}

// Historique des prix : mini-courbes ou carte thermique, le choix est gardé sur l'appareil.
function wireHistView() {
  const group = document.getElementById("hist-view");
  if (!group) return;
  let vue = "spark";
  try { if (localStorage.getItem(HIST_VIEW_KEY) === "heat") vue = "heat"; } catch { /* stockage bloqué */ }
  const apply = (v) => {
    document.getElementById("hist-spark").hidden = v !== "spark";
    document.getElementById("hist-heat").hidden = v !== "heat";
    group.querySelectorAll("[data-hist-view]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.histView === v)));
    if (v === "heat") {   // arrive sur le dernier relevé : le nom du composant reste figé à gauche
      const defile = document.querySelector("#hist-heat .table-scroll");
      if (defile) defile.scrollLeft = defile.scrollWidth;
    }
  };
  group.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hist-view]");
    if (!b) return;
    apply(b.dataset.histView);
    try { localStorage.setItem(HIST_VIEW_KEY, b.dataset.histView); } catch { /* choix valable pour la session */ }
  });
  apply(vue);
}

// Schéma d'airflow : un tap l'ouvre en grand (dialogue natif : Échap, focus rendu au bouton).
function wireAirflow() {
  const dlg = document.getElementById("airflow-dialog"), open = document.getElementById("airflow-open");
  if (!dlg || !open || typeof dlg.showModal !== "function") return;
  open.addEventListener("click", () => dlg.showModal());
  document.getElementById("airflow-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

// Cinq destinations (barre du bas / rail latéral) ; Matériel et Suivi ouvrent des sous-onglets.
const GROUP_LABELS = { budget: "Budget", materiel: "Matériel", achats: "Achats", suivi: "Suivi", reglages: "Réglages" };

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".section[data-panel]"));
  const dests = Array.from(document.querySelectorAll(".dest"));
  const strip = document.querySelector(".tabs");
  const title = document.getElementById("nav-title");
  const last = {};   // dernier sous-onglet vu par destination
  const visibleTabs = () => tabs.filter(t => !t.hidden);

  // Un seul sous-onglet est atteignable au Tab : à l'intérieur du groupe, on circule
  // aux flèches (comportement attendu d'un tablist).
  function activate(target, { focusPanel = false } = {}) {
    const tab = tabs.find(t => t.dataset.target === target);
    if (!tab) return;
    const group = tab.dataset.group;
    last[group] = target;

    tabs.forEach(t => {
      const on = t === tab;
      t.hidden = t.dataset.group !== group;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    strip.hidden = visibleTabs().length < 2;
    title.textContent = GROUP_LABELS[group];
    dests.forEach(d => {
      const on = d.dataset.dest === group;
      d.classList.toggle("active", on);
      if (on) d.setAttribute("aria-current", "page"); else d.removeAttribute("aria-current");
    });
    // Pas d'attribut hidden sur les panneaux : l'affichage est piloté par la classe, que la
    // règle @media print surcharge pour sortir tous les panneaux d'un coup.
    panels.forEach(p => p.classList.toggle("active-panel", p.dataset.panel === target));
    // Sur petit écran le dernier relevé est tout à droite : on y arrive directement, le nom du composant reste figé.
    if (target === "historique") {
      const defile = document.querySelector("#hist-heat:not([hidden]) .table-scroll");
      if (defile) defile.scrollLeft = defile.scrollWidth;
    }

    if (focusPanel) {
      const panel = panels.find(p => p.dataset.panel === target);
      if (panel) panel.focus();
    }
  }

  const go = (target) => {
    document.dispatchEvent(new Event("pcfw:navigate"));
    activate(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (location.hash.replace("#", "") !== target) {
      history.pushState({ tab: target }, "", "#" + target);
    }
  };

  dests.forEach(d => d.addEventListener("click", () => {
    const group = d.dataset.dest;
    go(last[group] || tabs.find(t => t.dataset.group === group).dataset.target);
  }));

  tabs.forEach(tab => {
    tab.addEventListener("click", () => go(tab.dataset.target));

    tab.addEventListener("keydown", (e) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1 };
      const liste = visibleTabs();
      let next = null;

      if (e.key in keys) {
        next = liste[(liste.indexOf(tab) + keys[e.key] + liste.length) % liste.length];
      } else if (e.key === "Home") {
        next = liste[0];
      } else if (e.key === "End") {
        next = liste[liste.length - 1];
      } else if (e.key === "ArrowDown") {
        // Descendre des sous-onglets vers le contenu.
        e.preventDefault();
        activate(tab.dataset.target, { focusPanel: true });
        return;
      } else {
        return;
      }

      e.preventDefault();
      next.focus();
      next.click();
    });
  });

  // Le bouton Retour doit ramener à l'onglet précédent, d'où pushState plus cet
  // écouteur (replaceState écrasait l'entrée et rendait le retour inopérant).
  window.addEventListener("popstate", () => {
    document.dispatchEvent(new Event("pcfw:navigate"));
    activate(location.hash.replace("#", "") || tabs[0].dataset.target);
  });

  wireSwipe(visibleTabs);

  const hash = location.hash.replace("#", "");
  activate(tabs.some(t => t.dataset.target === hash) ? hash : tabs[0].dataset.target);
}

function wirePrint() {
  const btn = document.getElementById("print-btn");
  if (btn) btn.addEventListener("click", () => window.print());
  // Les blocs repliés ne s'impriment pas : on les ouvre le temps de l'impression.
  let fermes = [];
  window.addEventListener("beforeprint", () => {
    fermes = [...document.querySelectorAll("details.fold:not([open])")];
    fermes.forEach(f => { f.open = true; });
  });
  window.addEventListener("afterprint", () => { fermes.forEach(f => { f.open = false; }); fermes = []; });
}

// Mini-résumé sous la barre d'onglets : visible quand on a fait défiler une longue liste hors du Budget.
function wireMiniSummary() {
  const bar = document.getElementById("mini-summary");
  const update = () => {
    const budget = document.getElementById("tab-budget").classList.contains("active");
    bar.hidden = budget || window.scrollY < 240;
  };
  window.addEventListener("scroll", update, { passive: true });
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTimeout(update, 0)));
  update();
}

// Export CSV du budget : séparateur « ; » et virgule décimale, comme l'attend un tableur en français.
function exportCSV() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
  const statut = (i) => i.status === "bought" ? "Acheté" : i.status === "owned_external" ? "En main" : "À acheter";
  const rows = [["Section", "Article", "Statut", "Prix (€)", "Date d'achat", "Boutique"]];
  for (const sec of ITEM_SECTIONS) {
    for (const i of state.data[sec]) rows.push([SECTION_LABELS[sec], i.name, statut(i), num(priceOf(i)), i.bought_date || "", i.vendor || ""]);
  }
  const b = state.data.budget_summary;
  rows.push([], ["Total", "Reste à acheter", "", num(b.remaining_to_buy)], ["Total", "Déjà acheté", "", num(b.already_bought)], ["Total", "Total complet", "", num(b.total_complete)]);
  const text = "\uFEFF" + rows.map(r => r.map(q).join(";")).join("\r\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pc-full-white-budget-${todayISO()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------
// Thème : auto (suit le système) → clair → sombre
// ---------------------------------------------------------------
const THEME_KEY = "pcfw-theme";
const HIST_VIEW_KEY = "pcfw-hist-view";
// Icônes en SVG plutôt qu'en glyphes Unicode : ◐ ☀ ☾ dépendent de la police de
// repli du système et s'affichaient en demi-cercle minuscule sur certaines.
const SVG = (corps) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${corps}</svg>`;
const THEMES = [
  { id: "auto",  nom: "automatique", icone: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>') },
  { id: "light", nom: "clair",       icone: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>') },
  { id: "dark",  nom: "sombre",      icone: SVG('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>') },
];

function wireTheme() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;
  const root = document.documentElement;

  let courant = "auto";
  try {
    const sauve = localStorage.getItem(THEME_KEY);
    if (sauve === "oled") courant = "dark";   // ancien thème OLED = sombre
    else if (sauve === "light" || sauve === "dark") courant = sauve;
  } catch { /* stockage bloqué : on reste en auto */ }

  function appliquer(id, { annoncer = false } = {}) {
    const i = THEMES.findIndex(t => t.id === id);
    const theme = THEMES[i];
    const suivant = THEMES[(i + 1) % THEMES.length];

    if (id === "auto") root.removeAttribute("data-theme");
    else root.dataset.theme = id;

    document.getElementById("theme-icon").innerHTML = theme.icone;
    document.querySelectorAll("[data-theme-choice]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.themeChoice === id)));
    btn.setAttribute("aria-label", `Thème : ${theme.nom}. Passer au thème ${suivant.nom}`);
    if (annoncer) document.getElementById("theme-status").textContent = `Thème ${theme.nom}`;
    courant = id;
    majThemeColor();
  }

  // Barre d'état du navigateur : même couleur que le fond de la page.
  function majThemeColor() {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(document.body).backgroundColor;
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => requestAnimationFrame(majThemeColor));

  function choisir(id) {
    appliquer(id, { annoncer: true });
    try {
      if (id === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, id);
    } catch { /* persistance indisponible, le choix vaut pour la session */ }
  }

  btn.addEventListener("click", () => {
    choisir(THEMES[(THEMES.findIndex(t => t.id === courant) + 1) % THEMES.length].id);
  });
  document.querySelectorAll("[data-theme-choice]").forEach(b => b.addEventListener("click", () => choisir(b.dataset.themeChoice)));

  appliquer(courant);
}

boot();
