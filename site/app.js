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
  renderPC();
  renderScreensAndPeriph();
  renderMobilier();
  renderRisks();
  renderWorkflow();
  renderHistory();
  renderFooter();
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

  // Répartition par catégorie (PC / Mobilier / Périphériques)
  const periphTotal = sumPeriphTotal(d);
  const cats = [
    { name: "PC", amount: b.pc_total, color: "#5493FF" },
    { name: "Mobilier", amount: b.mobilier_2026_total, color: "#d98a1f" },
    { name: "Périphériques", amount: periphTotal, color: "#1fa971" },
  ];
  const total = cats.reduce((s, c) => s + c.amount, 0);
  const wrap = document.getElementById("category-split");
  wrap.innerHTML = cats.map(c => `
    <div class="split-item">
      <div class="name"><span class="dot" style="background:${c.color}" aria-hidden="true"></span>${c.name}</div>
      <div class="amount">${fmtEUR(c.amount)}<span class="pct">${((c.amount/total)*100).toFixed(0)}%</span></div>
    </div>
  `).join("");

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
    </div>`;
}

// ---------------------------------------------------------------
// Écrans + Périphériques
// ---------------------------------------------------------------
function renderScreensAndPeriph() {
  const d = state.data;

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
      </div>
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
      </div>`;
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
    </div>`).join("");

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
          ${p.groups.map(g => renderPhaseGroup(key, p.num, g)).join("")}
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

  updatePhaseProgress();
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

  const compTable = document.getElementById("history-components-body");
  compTable.innerHTML = d.price_history_components.map(c => {
    const trendCls = c.trend === "up" ? "trend-up" : (c.trend === "down" ? "trend-down" : "trend-stable");
    const arrow = c.trend === "up" ? "▲" : (c.trend === "down" ? "▼" : "●");
    // La flèche et la couleur portent la même information : le mot la rend
    // lisible sans distinguer les couleurs et audible au lecteur d'écran.
    const trendWord = c.trend === "up" ? "en hausse" : (c.trend === "down" ? "en baisse" : "stable");
    const sign = c.evolution > 0 ? "+" : "";
    return `
      <tr>
        <td>${esc(c.component)}</td>
        <td>${fmtEUR(c.ref)}</td>
        <td>${fmtEUR(c.current)}</td>
        <td class="${trendCls}"><span aria-hidden="true">${arrow}</span> ${sign}${Math.round(c.evolution)} €<span class="sr-only"> ${trendWord}</span></td>
      </tr>`;
  }).join("");

  const totalPC = d.price_history[d.price_history.length - 1].pc_total;
  const refPC = d.price_history[0].pc_total;
  compTable.innerHTML += `
    <tr class="total-row">
      <td>TOTAL PC</td>
      <td>${fmtEUR(refPC)}</td>
      <td>${fmtEUR(totalPC)}</td>
      <td class="${totalPC > refPC ? 'trend-up' : 'trend-down'}"><span aria-hidden="true">${totalPC > refPC ? '▲' : '▼'}</span> ${totalPC > refPC ? '+' : ''}${totalPC - refPC} €<span class="sr-only"> ${totalPC > refPC ? 'en hausse' : 'en baisse'}</span></td>
    </tr>`;

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
    const labels = points.map((p,i) => `<text x="${coords[i][0]}" y="${h-1}" font-size="11" fill="var(--ink-faint)" text-anchor="middle" font-family="JetBrains Mono, monospace">${esc(p.label)}</text>`).join("");

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

  document.getElementById("history-note").textContent =
    `Prochaine vérification : ${d.meta.next_verification} · Dernière mise à jour : ${formatDateFR(d.meta.last_verified)}`;
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

boot();
