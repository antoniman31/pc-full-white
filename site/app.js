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
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(state.checklist));
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
      <div class="name"><span class="dot" style="background:${c.color}"></span>${c.name}</div>
      <div class="amount">${fmtEUR(c.amount)}<span class="pct">${((c.amount/total)*100).toFixed(0)}%</span></div>
    </div>
  `).join("");

  // Règles de suivi budget
  const rulesList = document.getElementById("budget-rules-list");
  if (rulesList && d.budget_rules) {
    rulesList.innerHTML = d.budget_rules.map(r => `
      <div class="risk-item">
        <div class="risk-title" style="margin-bottom:4px;">${r.rule}</div>
        <div class="risk-mitigation">${r.detail}</div>
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
      <td>${a.zone}</td>
      <td>${a.count}</td>
      <td>${a.sens}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${a.pwm}</td>
      <td style="font-family:var(--font-mono);font-size:11px;">${a.argb}</td>
    </tr>`).join("");

  // Stockage
  const stock = document.getElementById("stockage-table-body");
  stock.innerHTML = d.stockage.map(s => `
    <tr>
      <td style="font-family:var(--font-body);font-weight:600;">${s.disque}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${s.type}</td>
      <td>${s.capacite}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${s.usage}</td>
      <td style="font-family:var(--font-body);font-weight:400;">${s.smart}</td>
    </tr>`).join("");

  // RGB
  const rgb = document.getElementById("rgb-list");
  rgb.innerHTML = d.rgb_ecosystem.map(r => `
    <div class="item-row">
      <div class="item-main">
        <div class="item-name">${r.composant}</div>
        <div class="item-model">${r.note}</div>
      </div>
      <span class="status-pill bought">${r.integration}</span>
    </div>`).join("");

  const rgbNotes = document.getElementById("rgb-notes");
  if (rgbNotes && d.rgb_notes) {
    rgbNotes.innerHTML = d.rgb_notes.map(n => `<p class="section-note" style="margin:4px 0;">${n}</p>`).join("");
  }

  // Fonctionnalités SignalRGB
  const featuresList = document.getElementById("signalrgb-features-list");
  if (featuresList && d.signalrgb_features) {
    featuresList.innerHTML = d.signalrgb_features.map(f => `<li>${f}</li>`).join("");
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
      <div class="item-icon">${c.icon}</div>
      <div class="item-main">
        <div class="item-name">${c.name}</div>
        <div class="item-model">${c.model}${c.note ? " · " + c.note : ""}</div>
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
        <div class="item-icon">🖥️</div>
        <div class="item-main">
          <div class="item-name">${s.name} <span style="font-weight:400;color:var(--ink-faint);">— ${s.role}</span></div>
        </div>
        <div class="item-price">${fmtEUR(s.price)}</div>
        <span class="status-pill ${s.status === "bought" ? "bought" : "tobuy"}">${s.status === "bought" ? "Acheté" : "À acheter"}</span>
      </div>
      <div class="card-pad" style="padding-top:12px;padding-bottom:12px;">
        ${Object.entries(s.specs).map(([k,v]) => `
          <div style="display:flex;justify-content:space-between;gap:14px;font-size:12.5px;padding:4px 0;">
            <span style="color:var(--ink-faint);">${k}</span>
            <span style="text-align:right;font-family:var(--font-mono);font-size:11.5px;">${v}</span>
          </div>`).join("")}
      </div>
    </div>`).join("");

  const periph = document.getElementById("periph-list");
  periph.innerHTML = d.peripherals.map(p => {
    const isBought = p.status === "bought";
    const priceTxt = priceLabel(p);
    return `
      <div class="item-row">
        <div class="item-icon">${p.icon}</div>
        <div class="item-main">
          <div class="item-name">${p.name}</div>
          <div class="item-model">${p.note}</div>
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
      <div class="item-icon">${m.icon}</div>
      <div class="item-main">
        <div class="item-name">${m.name}</div>
        <div class="item-model">${m.model}</div>
      </div>
      <div class="item-price">${m.price === 0 ? "Gratuit" : fmtEUR(m.price)}</div>
    </div>`).join("");

  const outils = document.getElementById("outils-bureau-list");
  outils.innerHTML = d.outils_bureau.map(o => `
    <div class="item-row">
      <div class="item-icon">${o.icon}</div>
      <div class="item-main">
        <div class="item-name">${o.name}</div>
        <div class="item-model">${o.ref}</div>
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
          <span class="risk-title">${r.risk}</span>
          <span class="tag ${cls}">${label}</span>
        </div>
        <div class="risk-mitigation">${r.mitigation}</div>
      </div>`;
  }).join("");

  const decisions = document.getElementById("decisions-list");
  decisions.innerHTML = d.decisions.map(dec => `
    <div class="decision-item">
      <span class="decision-topic">${dec.topic}</span>
      <span class="decision-choice">${dec.decision}</span>
    </div>`).join("");

  const upgrades = document.getElementById("upgrades-list");
  upgrades.innerHTML = d.possible_upgrades.map(u => `
    <div class="item-row">
      <div class="item-icon">${u.icon}</div>
      <div class="item-main">
        <div class="item-name">${u.name}</div>
        <div class="item-model">${u.utility}</div>
      </div>
      <div class="item-price">${priceLabel(u)}</div>
    </div>`).join("");

  const watch = document.getElementById("watch-list");
  watch.innerHTML = d.watch_list.map(w => `
    <div class="watch-item"><span class="eye">👁️</span><span>${w}</span></div>`).join("");

  const crit = document.getElementById("critical-list");
  crit.innerHTML = d.critical_points.map(c => `<li>${c}</li>`).join("");
}

// ---------------------------------------------------------------
// Workflow — phases dépliables avec checklist persistée
// ---------------------------------------------------------------
function renderWorkflow() {
  const d = state.data;
  const wrap = document.getElementById("phase-list");
  wrap.innerHTML = d.workflow_phases.map(p => {
    const key = `phase-${p.num}`;
    return `
      <div class="phase-card" data-phase="${key}">
        <div class="phase-num">P${p.num}</div>
        <div class="phase-body">
          <div class="phase-title-row">
            <span>${p.icon}</span>
            <span class="phase-title">${p.title}</span>
            <span class="phase-meta">${p.when} · ${p.duration}</span>
          </div>
          ${p.note ? `<div class="phase-summary">${p.note}</div>` : ""}
          <div class="phase-checklist">
            ${p.groups.map(g => renderPhaseGroup(key, p.num, g)).join("")}
            <div class="phase-result">✅ <strong>Résultat attendu :</strong> ${p.result}</div>
          </div>
        </div>
        <div class="phase-chevron">▸</div>
      </div>`;
  }).join("");

  wrap.querySelectorAll(".phase-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".check-row")) return;
      card.classList.toggle("open");
    });
  });

  wrap.querySelectorAll(".check-row").forEach(row => {
    const key = row.dataset.key;
    if (state.checklist[key]) row.classList.add("checked");
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      state.checklist[key] = !state.checklist[key];
      row.classList.toggle("checked", state.checklist[key]);
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
  const warningHTML = group.warning ? `<div class="group-warning">⚠️ ${group.warning}</div>` : "";
  const itemsHTML = group.items.map((item, i) => {
    const itemKey = `${phaseKey}-${gid}-${i}`;
    const checked = state.checklist[itemKey] ? "checked" : "";
    return `
      <div class="check-row ${checked}" data-key="${itemKey}">
        <span class="check-box">
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="check-text">${item}</span>
      </div>`;
  }).join("");
  return `
    <div class="check-group">
      <div class="check-group-title">${group.title}</div>
      ${warningHTML}
      ${itemsHTML}
    </div>`;
}

function updatePhaseProgress() {
  const total = Object.keys(state.checklist).length ? Object.values(state.checklist).filter(Boolean).length : 0;
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
    const sign = c.evolution > 0 ? "+" : "";
    return `
      <tr>
        <td>${c.component}</td>
        <td>${fmtEUR(c.ref)}</td>
        <td>${fmtEUR(c.current)}</td>
        <td class="${trendCls}">${arrow} ${sign}${Math.round(c.evolution)} €</td>
      </tr>`;
  }).join("");

  const totalPC = d.price_history[d.price_history.length - 1].pc_total;
  const refPC = d.price_history[0].pc_total;
  compTable.innerHTML += `
    <tr class="total-row">
      <td>TOTAL PC</td>
      <td>${fmtEUR(refPC)}</td>
      <td>${fmtEUR(totalPC)}</td>
      <td class="${totalPC > refPC ? 'trend-up' : 'trend-down'}">${totalPC > refPC ? '▲' : '▼'} ${totalPC > refPC ? '+' : ''}${totalPC - refPC} €</td>
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
    const dots = coords.map((c,i) => `<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="#5493FF" stroke="white" stroke-width="1.5"/>`).join("");
    const labels = points.map((p,i) => `<text x="${coords[i][0]}" y="${h-1}" font-size="9" fill="#8b93a7" text-anchor="middle" font-family="JetBrains Mono, monospace">${p.label}</text>`).join("");
    svgWrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h+14}" style="width:100%;height:auto;">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#5493FF" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#5493FF" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#areaGrad)"/>
        <path d="${path}" fill="none" stroke="#5493FF" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
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
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".section[data-panel]");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      tabs.forEach(t => t.classList.toggle("active", t === tab));
      panels.forEach(p => p.classList.toggle("active-panel", p.dataset.panel === target));
      window.scrollTo({ top: 0, behavior: "smooth" });
      history.replaceState(null, "", "#" + target);
    });
  });
  const hash = location.hash.replace("#","");
  if (hash) {
    const match = document.querySelector(`.tab[data-target="${hash}"]`);
    if (match) match.click();
  }
}

function wirePrint() {
  const btn = document.getElementById("print-btn");
  if (btn) btn.addEventListener("click", () => window.print());
}

boot();
