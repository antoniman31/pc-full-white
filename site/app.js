// ============================================================
// PC FULL WHITE — app.js
// Charge data/prices.json et génère tout le contenu de la page.
// Aucune donnée n'est codée en dur ici — tout vient du JSON.
// ============================================================

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
  checklist: {}, // { "phase-0-item-2": true, ... }
};

const CHECKLIST_KEY = "pcfw-checklist-v1";
const OVERLAY_KEY = "pcfw-overlay-v1";
const TOKEN_KEY = "pcfw-token-v1";
const SENT_KEY = "pcfw-sent-v1";
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

async function boot() {
  loadChecklist();
  loadOverlay();
  loadSync();
  try {
    const res = await fetch("../data/prices.json", { cache: "no-store" });
    state.base = await res.json();
  } catch (e) {
    // fallback : chemin relatif alternatif si servi depuis /site directement
    const res2 = await fetch("data/prices.json", { cache: "no-store" });
    state.base = await res2.json();
  }
  state.data = buildView(state.base, state.overlay);
  renderAll();
  wirePurchases();
  wireTabs();
  wirePrint();
  wireTheme();
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
const SECTION_LABELS = { pc_components: "PC", peripherals: "Périphériques", mobilier: "Mobilier", outils_bureau: "Outils du bureau" };
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
    ? `<button type="button" class="buy-edit" data-buy-edit="${esc(item.id)}">Modifier<span class="sr-only"> l'achat : ${esc(item.name)}</span></button>`
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
      <button type="button" class="buy-edit" data-item-edit="${id}">Modifier l'article<span class="sr-only"> : ${esc(item.name)}</span></button>
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
        <button type="button" class="buy-cancel danger" data-item-delete="${id}">${confirm ? "Confirmer la suppression" : "Supprimer l'article"}</button>
      </div>
    </form>`;
}

// Formulaire d'ajout, en tête de chaque liste.
function addBlockHTML(section) {
  const open = state.adding === section;
  return `
    <div class="add-block">
      <button type="button" class="buy-edit" data-add-open="${section}" aria-expanded="${open}">${open ? "Fermer" : "Ajouter un article"}<span class="sr-only"> : ${esc(SECTION_LABELS[section])}</span></button>
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
        const fromBase = findBaseItem(id)?.status === "bought";
        patchEntry(id, { status: fromBase ? "to_buy" : undefined, paid: undefined, date: undefined, vendor: undefined });
        closeForms();
        state.notice = `Achat annulé : ${item.name}`;
        saveOverlay();
        refreshView(sel(id));
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
      const added = state.overlay.added.findIndex(a => a.id === id);
      if (added >= 0) { state.overlay.added.splice(added, 1); delete state.overlay.items[id]; }
      else patchEntry(id, { deleted: true });
      state.open.delete(id);
      closeForms();
      state.notice = `Article supprimé : ${item ? item.name : id}`;
      saveOverlay();
      refreshView(`[data-add-open="${section}"]`);
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
    patchEntry(id, { status: "bought", paid, date, vendor });
    closeForms();
    state.notice = `Achat enregistré : ${item ? item.name : id}, ${fmtEURsmart(paid)}`;
    saveOverlay();
    refreshView(sel(id));
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
    state.overlay.added.push(entry);
    state.open.add(id);
    closeForms();
    state.notice = `Article ajouté : ${name}`;
    saveOverlay();
    refreshView(`[data-card="${id}"] summary`);
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
      <h2 class="section-title" style="font-size:17px;">Envoyer vers le dépôt</h2>
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
      <h2 class="section-title" style="font-size:17px;">Mes changements sur cet appareil</h2>
      <p class="section-note" style="margin:6px 0 12px;">${n
        ? `${n} changement${n > 1 ? "s" : ""} ici : ils s'affichent avec le budget recalculé, mais ne sont enregistrés que dans ce navigateur. Exporte-les de temps en temps.`
        : "Coche « Acheté », modifie, ajoute ou supprime un article (onglets PC, Périphériques, Mobilier) : le budget se recalcule. Rien n'est envoyé nulle part, tout reste dans ce navigateur."}</p>
      ${deleted.length ? `<ul class="plain-list local-deleted" aria-label="Articles supprimés ici">${deleted.map(x => `
        <li><span>${esc(x.name)} <span class="sr-only">(supprimé)</span></span>
        <button type="button" class="local-btn" data-restore="${esc(x.id)}">Rétablir<span class="sr-only"> : ${esc(x.name)}</span></button></li>`).join("")}</ul>` : ""}
      <div class="local-actions">
        <button type="button" class="local-btn" id="local-export"${n ? "" : " disabled"}>Exporter</button>
        <label class="local-btn local-import">Importer<input type="file" id="local-import" accept="application/json,.json" class="sr-only"></label>
        <button type="button" class="local-btn" id="local-reset"${n ? "" : " disabled"}>${state.confirmReset ? "Confirmer la remise à zéro" : "Tout réinitialiser"}</button>
      </div>
      <p class="local-msg" id="local-msg" role="status">${esc(state.localMsg || "")}</p>
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
function renderPurchases() {
  renderHero();
  renderTabSummaries();
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

  document.getElementById("hero-verif").textContent =
    `Prix relevés chez plusieurs revendeurs · ${formatDateFR(d.meta.last_verified)}`;

  document.getElementById("progress-cur").textContent = fmtEUR(b.remaining_to_buy);
  document.getElementById("progress-goal").textContent = fmtEUR(limit);
  document.getElementById("stat-bought").textContent = fmtEUR(b.already_bought);
  document.getElementById("stat-total").textContent = fmtEUR(b.total_complete);
  document.getElementById("stat-margin").textContent = fmtEUR(b.margin_vs_prime);
  document.getElementById("stat-pcmargin").textContent = fmtEUR(b.pc_margin);
  document.getElementById("stat-pcmargin-label").textContent = `Marge PC seul · limite ${fmtEUR(d.meta.pc_limit)}`;

  // Cartes 2026 / 2027 : le montant vient du résumé, jamais recopié ici.
  const tl = document.getElementById("timeline");
  if (tl && d.timeline) {
    tl.innerHTML = d.timeline.map((t, i) => `
      <div class="timeline-card tl-${i}">
        <div class="timeline-year">${esc(t.year)}</div>
        <div class="timeline-title"><span aria-hidden="true">${esc(t.icon)}</span> ${esc(t.title)} · ${fmtEUR(b[t.amount])}</div>
        <div class="timeline-detail">${esc(t.detail)}</div>
      </div>`).join("");
  }

  const pct = Math.min(100, (b.remaining_to_buy / limit) * 100);
  const fill = document.getElementById("bar-fill");
  requestAnimationFrame(() => { fill.style.width = pct.toFixed(1) + "%"; });

  // La barre est annoncée comme une jauge : la valeur seule ("62") ne dit rien,
  // d'où le aria-valuetext qui porte le montant et la limite.
  const track = document.getElementById("bar-track");
  if (track) {
    track.setAttribute("aria-valuenow", pct.toFixed(0));
    track.setAttribute("aria-valuetext",
      `${fmtEUR(b.remaining_to_buy)} restant à acheter sur une limite de ${fmtEUR(limit)}, soit ${pct.toFixed(0)} %`);
  }

  document.getElementById("bar-pct").textContent = pct.toFixed(0) + "% de la limite";
  document.getElementById("bar-remaining").textContent = `Marge restante : ${fmtEUR(b.margin_vs_prime)}`;

  // Répartition par catégorie : donut + légende. Le donut seul ne se lit pas
  // sans la vue ; la légende en texte porte les mêmes valeurs.
  const paidIn = (...secs) => sumBought(secs.flatMap(sec => d[sec]));
  const cats = [
    { name: "PC", amount: round2(b.pc_total + paidIn("pc_components")), cls: "pc", paid: paidIn("pc_components") },
    { name: "Périphériques", amount: round2(sumLeft([...d.screens, ...d.peripherals]) + paidIn("screens", "peripherals")), cls: "periph", paid: paidIn("screens", "peripherals") },
    { name: "Mobilier", amount: round2(b.mobilier_2026_total + paidIn("mobilier", "outils_bureau")), cls: "mob", paid: paidIn("mobilier", "outils_bureau") },
  ];
  const paid = round2(cats.reduce((x, c) => x + c.paid, 0));
  const total = cats.reduce((s, c) => s + c.amount, 0);
  document.getElementById("donut").innerHTML = donutHTML(cats, total, paid);
  document.getElementById("category-split").innerHTML = cats.map(c => `
    <div class="split-item">
      <div class="name"><span class="dot ${c.cls}" aria-hidden="true"></span>${c.name}</div>
      <div class="amount">${fmtEUR(c.amount)}<span class="pct">${((c.amount/total)*100).toFixed(1)}%</span></div>
      ${c.paid ? `<div class="split-sub"><span class="hatch-swatch" aria-hidden="true"></span>dont ${fmtEUR(c.paid)} déjà payés</div>` : ""}
    </div>
  `).join("");

  // Avancement : ce qui est déjà dépensé sur le total (la barre du haut mesure
  // l'inverse : le reste à acheter par rapport à la limite).
  const spentPct = (b.already_bought / b.total_complete) * 100;
  const spendText = `${fmtEUR(b.already_bought)} déjà dépensés sur ${fmtEUR(b.total_complete)} · reste ${fmtEUR(b.remaining_to_buy)}`;
  document.getElementById("spend-pct").textContent = `${Math.round(spentPct)} %`;
  const sf = document.getElementById("spend-fill");
  requestAnimationFrame(() => { sf.style.width = spentPct.toFixed(1) + "%"; });
  const st = document.getElementById("spend-track");
  st.setAttribute("aria-valuenow", spentPct.toFixed(0));
  st.setAttribute("aria-valuetext", `${spendText}, soit ${spentPct.toFixed(0)} %`);
  document.getElementById("spend-caption").textContent = spendText;

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
function donutHTML(cats, total, paid) {
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = cats.map(c => {
    const len = (c.amount / total) * C;
    const arc = `<circle class="donut-seg ${c.cls}" cx="90" cy="90" r="${R}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    const hatch = c.paid
      ? `<circle class="donut-hatch" cx="90" cy="90" r="${R}" stroke-dasharray="${((c.paid / total) * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`
      : "";
    offset += len;
    return arc + hatch;
  }).join("");
  const label = `Répartition du budget total de ${fmtEUR(total)} : `
    + cats.map(c => `${c.name} ${fmtEUR(c.amount)}, ${Math.round((c.amount / total) * 100)} %`).join(" ; ")
    + `, dont ${fmtEUR(paid)} déjà payés`;
  return `
    <svg viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect class="hatch-bg" width="6" height="6"/><rect class="hatch-bar" width="3" height="6"/>
        </pattern>
      </defs>
      <g transform="rotate(-90 90 90)">${arcs}</g>
      <text class="donut-total" x="90" y="89" text-anchor="middle">${fmtEUR(total)}</text>
      <text class="donut-label" x="90" y="107" text-anchor="middle">Budget total</text>
    </svg>`;
}

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

  document.getElementById("pc-total-label").textContent = fmtEUR(d.budget_summary.pc_total);

  const list = document.getElementById("pc-components-list");
  list.innerHTML = addBlockHTML("pc_components") + cardGroupsHTML(d.pc_components, d.budget_summary.pc_total);

  // Airflow (avec PWM/ARGB)
  const airflow = document.getElementById("airflow-table-body");
  airflow.innerHTML = d.airflow.map(a => `
    <tr>
      <td>${esc(a.zone)}</td>
      <td>${esc(a.count)}</td>
      <td>${esc(a.sens)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${esc(a.pwm)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${esc(a.argb)}</td>
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
  sw.innerHTML = d.stockage_warning ? `<span aria-hidden="true">⚠️</span> ${esc(d.stockage_warning)}` : "";
  sw.hidden = !d.stockage_warning;
  setText("stockage-tip", d.stockage_tip ? `💡 ${d.stockage_tip}` : "");

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
      <span aria-hidden="true">↗</span>
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
  return `<span class="item-delta ${up ? "up" : "down"}"><span aria-hidden="true">${up ? "▲" : "▼"} ${up ? "+" : "−"}${Math.round(Math.abs(delta))} €</span>`
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
        <span class="item-icon" aria-hidden="true">${esc(item.icon || "📦")}</span>
        <span class="item-main"><span class="item-name">${esc(item.name)}${item.local ? ' <span class="local-badge">modifié ici</span>' : ""}</span><span class="item-model">${esc(f.short)}</span></span>
        <span class="item-money"><span class="item-price">${priceText(item)}</span>${variationHTML(item)}</span>
        ${bought ? '<span class="status-pill bought">Acheté</span>' : owned ? '<span class="status-pill bought">Possédé</span>' : ""}
        <span class="chev" aria-hidden="true"></span>
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
  return group("À acheter", todo, leftTotal ?? sumLeft(items)) + group("Acheté ou en main", done, sumBought(items));
}

// ---------------------------------------------------------------
// Écrans + Périphériques
// ---------------------------------------------------------------
function renderScreensAndPeriph() {
  const d = state.data;
  setText("screens-note", d.screens_note);
  document.getElementById("screens-list").innerHTML = cardGroupsHTML(d.screens);
  document.getElementById("periph-list").innerHTML = addBlockHTML("peripherals") + cardGroupsHTML(d.peripherals);
}

// ---------------------------------------------------------------
// Mobilier
// ---------------------------------------------------------------
function renderMobilier() {
  const d = state.data;
  document.getElementById("mobilier-total-label").textContent = fmtEUR(d.budget_summary.mobilier_2026_total);
  document.getElementById("mobilier-list").innerHTML = addBlockHTML("mobilier") + cardGroupsHTML(d.mobilier);
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
      <div class="item-icon" aria-hidden="true">${esc(u.icon)}</div>
      <div class="item-main">
        <div class="item-name">${esc(u.name)}</div>
        <div class="item-model">${esc(u.utility)}</div>
      </div>
      <div class="item-price">${priceLabel(u)}</div>
    </div>`).join("");

  const watch = document.getElementById("watch-list");
  watch.innerHTML = d.watch_list.map(w => `
    <li class="watch-item"><span class="eye" aria-hidden="true">👁️</span><span>${esc(w)}</span></li>`).join("");

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
              <span aria-hidden="true">${esc(p.icon)}</span>
              <span class="phase-title">Phase ${esc(p.num)} — ${esc(p.title)}</span>
              <span class="phase-meta">${esc(p.when)} · ${esc(p.duration)}</span>
            </span>
            ${p.note ? `<span class="phase-summary">${esc(p.note)}</span>` : ""}
          </span>
          <span class="phase-chevron" aria-hidden="true">▸</span>
        </button>
        <div class="phase-checklist" id="${panelId}" role="group" aria-label="Checklist de la phase ${esc(p.num)}">
          ${(p.extra_notes || []).map(n => `<p class="phase-callout">${esc(n)}</p>`).join("")}
          ${p.groups.map(g => renderPhaseGroup(key, p.num, g)).join("")}
          ${p.tips ? `<div class="phase-tips"><div class="phase-tips-title"><span aria-hidden="true">⚠️</span> ${esc(p.tips.title)}</div><ul>${p.tips.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
          <div class="phase-result"><span aria-hidden="true">✅</span> <strong>Résultat attendu :</strong> ${esc(p.result)}</div>
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
        <h3 class="sub-title" id="finale-msi"><span aria-hidden="true">💻</span> ${esc(f.msi_title)}</h3>
        <p class="finale-text">${esc(f.msi_text)}</p>
      </section>
      <section class="card card-pad finale-done" aria-labelledby="finale-done">
        <h3 class="sub-title" id="finale-done"><span aria-hidden="true">🎉</span> ${esc(f.done_title)}</h3>
        <ul class="plain-list">${f.done_items.map(i => `<li><span aria-hidden="true">✅</span> ${esc(i)}</li>`).join("")}</ul>
        <p class="finale-text"><span aria-hidden="true">📸</span> ${esc(f.photo)}</p>
      </section>
    </div>`;
}

let groupCounter = 0;
function renderPhaseGroup(phaseKey, phaseNum, group) {
  groupCounter++;
  const gid = `g${groupCounter}`;
  const titleId = `${gid}-title`;
  const warningHTML = group.warning
    ? `<div class="group-warning"><span aria-hidden="true">⚠️</span> ${esc(group.warning)}</div>`
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
    const arrow = trend === "up" ? "▲" : (trend === "down" ? "▼" : "●");
    const word = trend === "up" ? "en hausse" : (trend === "down" ? "en baisse" : "stable");
    return `<td class="${cls}"><span aria-hidden="true">${arrow}</span> ${delta > 0 ? "+" : ""}${Math.round(delta)} €<span class="sr-only"> ${word}</span></td>`;
  };

  document.getElementById("history-head").innerHTML =
    `<tr><th scope="col">Composant</th>${dates.map(x => `<th scope="col">${esc(x)}</th>`).join("")}<th scope="col">Évolution</th></tr>`;

  const compTable = document.getElementById("history-components-body");
  compTable.innerHTML = d.price_history_components.map(c => {
    const serie = c.series || [c.ref, c.current];
    return `<tr><th scope="row">${esc(c.component)}</th>${serie.map(v => `<td>${cellEUR(v)}</td>`).join("")}${evoCell(c.evolution, c.trend)}</tr>`;
  }).join("");

  const totalSerie = d.price_history_total_series || [d.price_history[0].pc_total, d.price_history[d.price_history.length - 1].pc_total];
  const totalDelta = totalSerie[totalSerie.length - 1] - totalSerie[0];
  compTable.innerHTML += `
    <tr class="total-row"><th scope="row">TOTAL PC</th>${totalSerie.map(v => `<td>${cellEUR(v)}</td>`).join("")}${evoCell(totalDelta, totalDelta > 0 ? "up" : "down")}</tr>`;

  // Récapitulatif des achats : le total affiché est recalculé et contrôlé par
  // check_prices.py contre remaining_to_buy.
  const recap = d.purchase_recap || [];
  const recapTotal = recap.reduce((s, r) => s + r.price, 0);
  document.getElementById("recap-title").textContent = `Reste à acheter (${fmtEUR(recapTotal)})`;
  document.getElementById("recap-body").innerHTML = recap.map(r =>
    `<tr><td>${esc(r.label)}</td><td>${esc(r.when)}</td><td>${fmtEURsmart(r.price)}</td></tr>`).join("")
    + `<tr class="total-row"><td>Total</td><td></td><td>${fmtEUR(recapTotal)}</td></tr>`;

  document.getElementById("bought-title").textContent = `Déjà acheté (${fmtEUR(b.already_bought)}) — prix figés`;
  document.getElementById("bought-list").innerHTML = allItems(d).filter(p => p.status === "bought").map(p =>
    `<li><span><span aria-hidden="true">✅</span> ${esc(p.name)}</span><span class="amt">${fmtEURsmart(p.price)}</span></li>`).join("");

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

  // Mini graphique évolution budget total (sparkline SVG simple)
  const points = d.price_history.filter(h => h.budget_total !== null);
  const svgWrap = document.getElementById("history-sparkline");
  if (points.length > 1) {
    const w = 600, h = 120, pad = 14;
    const vals = points.map(p => p.budget_total);
    const min = Math.min(...vals) * 0.98, max = Math.max(...vals) * 1.02;
    const stepX = (w - pad*2) / (points.length - 1);
    const coords = points.map((p,i) => {
      const x = pad + i*stepX;
      const y = pad + (h - pad*2) * (1 - (p.budget_total - min)/(max-min));
      return [x,y];
    });
    const path = coords.map((c,i) => (i===0?"M":"L") + c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
    const areaPath = path + ` L${coords[coords.length-1][0]},${h-pad} L${coords[0][0]},${h-pad} Z`;
    const dots = coords.map((c) => `<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="var(--am31-blue)" stroke="var(--paper)" stroke-width="1.5"/>`).join("");
    const labels = points.map((p,i) => `<text x="${coords[i][0]}" y="${h-1}" font-size="11" fill="var(--ink-faint)" text-anchor="${i === 0 ? "start" : (i === points.length - 1 ? "end" : "middle")}" font-family="JetBrains Mono, monospace">${esc(p.label)}</text>`).join("");

    // Le graphe est une image : son équivalent textuel donne les bornes et le sens,
    // ce que la courbe seule ne transmet pas à un lecteur d'écran.
    const first = points[0], last = points[points.length - 1];
    const sens = last.budget_total > first.budget_total ? "en hausse" : (last.budget_total < first.budget_total ? "en baisse" : "stable");
    const alt = `Évolution du budget total, ${sens} : de ${fmtEUR(first.budget_total)} (${first.label}) à ${fmtEUR(last.budget_total)} (${last.label}).`;

    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h+14}" style="width:100%;height:auto;" role="img" aria-label="${esc(alt)}">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--am31-blue)" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="var(--am31-blue)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#areaGrad)"/>
        <path d="${path}" fill="none" stroke="var(--am31-blue)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        ${labels}
      </svg>`;
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
function wireSwipe(tabs) {
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  let start = null;
  document.addEventListener("touchstart", (e) => {
    start = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0], el = e.target;
    if (t.clientX < SWIPE_EDGE || t.clientX > window.innerWidth - SWIPE_EDGE) return;
    if (el.closest("input, textarea, select, [contenteditable], .tabs, .send-bar") || scrollableX(el)) return;
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!start || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.at;
    start = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < 1.5 * Math.abs(dy) || dt > SWIPE_MAX_MS) return;
    const i = tabs.findIndex(x => x.classList.contains("active"));
    const next = tabs[i + (dx < 0 ? 1 : -1)];
    if (next) next.click();
  }, { passive: true });
  document.addEventListener("touchcancel", () => { start = null; }, { passive: true });
}

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".section[data-panel]"));

  // Un seul onglet est atteignable au Tab : à l'intérieur du groupe, on circule
  // aux flèches. C'est le comportement attendu d'un tablist, et ça évite de
  // traverser sept boutons avant d'arriver au contenu.
  function activate(target, { focusPanel = false } = {}) {
    const tab = tabs.find(t => t.dataset.target === target);
    if (!tab) return;

    tabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    // Pas d'attribut hidden ici : l'affichage est piloté par la classe, que la
    // règle @media print surcharge pour sortir tous les panneaux d'un coup.
    // display:none suffit à masquer un panneau aux lecteurs d'écran.
    panels.forEach(p => p.classList.toggle("active-panel", p.dataset.panel === target));

    if (focusPanel) {
      const panel = panels.find(p => p.dataset.panel === target);
      if (panel) panel.focus();
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      activate(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (location.hash.replace("#", "") !== target) {
        history.pushState({ tab: target }, "", "#" + target);
      }
    });

    tab.addEventListener("keydown", (e) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1 };
      let next = null;

      if (e.key in keys) {
        next = tabs[(tabs.indexOf(tab) + keys[e.key] + tabs.length) % tabs.length];
      } else if (e.key === "Home") {
        next = tabs[0];
      } else if (e.key === "End") {
        next = tabs[tabs.length - 1];
      } else if (e.key === "ArrowDown") {
        // Descendre de la barre d'onglets vers le contenu de l'onglet courant.
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
    activate(location.hash.replace("#", "") || tabs[0].dataset.target);
  });

  wireSwipe(tabs);

  const hash = location.hash.replace("#", "");
  activate(tabs.some(t => t.dataset.target === hash) ? hash : tabs[0].dataset.target);
}

function wirePrint() {
  const btn = document.getElementById("print-btn");
  if (btn) btn.addEventListener("click", () => window.print());
}

// ---------------------------------------------------------------
// Thème : auto (suit le système) → clair → sombre
// ---------------------------------------------------------------
const THEME_KEY = "pcfw-theme";
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
    if (sauve === "light" || sauve === "dark") courant = sauve;
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
  }

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
