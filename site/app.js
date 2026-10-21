// ============================================================
// PC FULL WHITE — app.js
// Charge data/prices.json et génère tout le contenu de la page.
// Aucune donnée n'est codée en dur ici — tout vient du JSON.
// ============================================================

const state = {
  data: null,
  checklist: {}, // { "phase-0-item-2": true, ... }
};

const CHECKLIST_KEY = "pcfw-checklist-v1";
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
  try {
    const res = await fetch("../data/prices.json", { cache: "no-store" });
    state.data = await res.json();
  } catch (e) {
    // fallback : chemin relatif alternatif si servi depuis /site directement
    const res2 = await fetch("data/prices.json", { cache: "no-store" });
    state.data = await res2.json();
  }
  renderAll();
  wireTabs();
  wirePrint();
  wireTheme();
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

function renderAll() {
  renderHero();
  renderTabSummaries();
  renderPC();
  renderScreensAndPeriph();
  renderMobilier();
  renderRisks();
  renderWorkflow();
  renderHistory();
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
  const periphTotal = sumPeriphTotal(d);
  const paid = d.peripherals.filter(p => p.status === "bought").reduce((s, p) => s + (p.price || 0), 0);
  const cats = [
    { name: "PC", amount: b.pc_total, cls: "pc" },
    { name: "Périphériques", amount: periphTotal, cls: "periph", paid },
    { name: "Mobilier", amount: b.mobilier_2026_total, cls: "mob" },
  ];
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
    + `, dont ${fmtEUR(paid)} déjà payés en périphériques`;
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

function sumPeriphTotal(d) {
  const boughtP = d.peripherals.filter(p => p.status === "bought").reduce((s,p) => s + (p.price||0), 0);
  const toBuyP = d.peripherals.filter(p => p.status === "to_buy").reduce((s,p) => s + priceOf(p), 0);
  const screensP = d.screens.reduce((s,sc) => s + (sc.price||0), 0);
  return boughtP + toBuyP + screensP;
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
  list.innerHTML = d.pc_components.map(c => itemRowHTML(c)).join("");

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
  return `<details class="item-specs item-offers"><summary>Où acheter (${offers.length})<span class="sr-only"> : ${esc(item.name)}</span></summary><div class="offer-list">${links}</div></details>`;
}

function itemRowHTML(c) {
  const isBought = c.status === "bought";
  const isOwnedExternal = c.status === "owned_external";
  const priceTxt = c.price === 0 && isOwnedExternal ? "déjà en main" : (c.price_min !== undefined ? priceLabel(c) : fmtEUR(c.price));
  const pillTxt = isBought ? "Acheté" : (isOwnedExternal ? "Possédé" : "À acheter");
  const pillClass = (isBought || isOwnedExternal) ? "bought" : "tobuy";
  return `
    <div class="item-row">
      <div class="item-icon" aria-hidden="true">${esc(c.icon)}</div>
      <div class="item-main">
        <div class="item-name">${esc(c.name)}</div>
        <div class="item-model">${esc(c.model)}${c.note ? " · " + esc(c.note) : ""}</div>
      </div>
      <div class="item-price">${priceTxt}</div>
      <span class="status-pill ${pillClass}">${pillTxt}</span>
    </div>${offersHTML(c)}`;
}

// ---------------------------------------------------------------
// Écrans + Périphériques
// ---------------------------------------------------------------
// Caractéristiques détaillées d'un périphérique, repliées par défaut pour ne
// pas allonger la liste : un <details> natif, accessible sans script.
function specsHTML(item) {
  if (!item.specs) return "";
  const rows = Object.entries(item.specs).map(([k, v]) =>
    `<div class="spec-row"><span class="spec-k">${esc(k)}</span><span class="spec-v">${esc(v)}</span></div>`).join("");
  return `<details class="item-specs"><summary>Caractéristiques<span class="sr-only"> : ${esc(item.name)}</span></summary><div class="spec-grid">${rows}</div></details>`;
}

function renderScreensAndPeriph() {
  const d = state.data;
  setText("screens-note", d.screens_note);

  const screens = document.getElementById("screens-list");
  screens.innerHTML = d.screens.map(s => `
    <div class="card" style="margin-bottom:12px;">
      <div class="item-row" style="border-bottom:1px solid var(--paper-line);">
        <div class="item-icon" aria-hidden="true">🖥️</div>
        <div class="item-main">
          <div class="item-name">${esc(s.name)} <span style="font-weight:400;color:var(--ink-faint);">— ${esc(s.role)}</span></div>
        </div>
        <div class="item-price">${fmtEUR(s.price)}</div>
        <span class="status-pill ${s.status === "bought" ? "bought" : "tobuy"}">${s.status === "bought" ? "Acheté" : "À acheter"}</span>
      </div>
      <div class="card-pad" style="padding-top:12px;padding-bottom:12px;">
        ${Object.entries(s.specs).map(([k,v]) => `
          <div style="display:flex;justify-content:space-between;gap:14px;font-size:12.5px;padding:4px 0;">
            <span style="color:var(--ink-faint);">${esc(k)}</span>
            <span style="text-align:right;font-family:var(--font-mono);font-size:11.5px;">${esc(v)}</span>
          </div>`).join("")}
      </div>${offersHTML(s)}
    </div>`).join("");

  const periph = document.getElementById("periph-list");
  periph.innerHTML = d.peripherals.map(p => {
    const isBought = p.status === "bought";
    const priceTxt = priceLabel(p);
    return `
      <div class="item-row">
        <div class="item-icon" aria-hidden="true">${esc(p.icon)}</div>
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          <div class="item-model">${esc(p.note)}</div>
        </div>
        <div class="item-price">${priceTxt}</div>
        <span class="status-pill ${isBought ? "bought" : "tobuy"}">${isBought ? "Acheté" : "À acheter"}</span>
      </div>${specsHTML(p)}${offersHTML(p)}`;
  }).join("");
}

// ---------------------------------------------------------------
// Mobilier
// ---------------------------------------------------------------
function renderMobilier() {
  const d = state.data;
  document.getElementById("mobilier-total-label").textContent = fmtEUR(d.budget_summary.mobilier_2026_total);

  const list = document.getElementById("mobilier-list");
  list.innerHTML = d.mobilier.map(m => `
    <div class="item-row">
      <div class="item-icon" aria-hidden="true">${esc(m.icon)}</div>
      <div class="item-main">
        <div class="item-name">${esc(m.name)}</div>
        <div class="item-model">${esc(m.model)}</div>
      </div>
      <div class="item-price">${m.price === 0 ? "Gratuit" : fmtEUR(m.price)}</div>
    </div>${offersHTML(m)}`).join("");

  const outils = document.getElementById("outils-bureau-list");
  outils.innerHTML = d.outils_bureau.map(o => `
    <div class="item-row">
      <div class="item-icon" aria-hidden="true">${esc(o.icon)}</div>
      <div class="item-main">
        <div class="item-name">${esc(o.name)}</div>
        <div class="item-model">${esc(o.ref)}</div>
      </div>
      <div class="item-price">${fmtEURprecise(o.price)}</div>
    </div>`).join("");
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
  document.getElementById("bought-list").innerHTML = d.peripherals.filter(p => p.status === "bought").map(p =>
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
    ? ` · Dernier relevé automatique (${formatDateFR(run.date)}) : ${run.verified} prix vérifiés sur ${run.tracked} articles suivis, ${run.updated} mis à jour.`
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
    btn.setAttribute("aria-label", `Thème : ${theme.nom}. Passer au thème ${suivant.nom}`);
    if (annoncer) document.getElementById("theme-status").textContent = `Thème ${theme.nom}`;
    courant = id;
  }

  btn.addEventListener("click", () => {
    const suivant = THEMES[(THEMES.findIndex(t => t.id === courant) + 1) % THEMES.length].id;
    appliquer(suivant, { annoncer: true });
    try {
      if (suivant === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, suivant);
    } catch { /* persistance indisponible, le choix vaut pour la session */ }
  });

  appliquer(courant);
}

boot();
