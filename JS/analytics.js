/* ============================================================
   CASEFLOW — ANALYTICS.JS  (full-system analytics)
   One page that reads EVERY module and shows:
     • KPI tiles (cases, clients, hearings, documents/AI,
       case health, team)
     • Collapsible cards (closed by default — click to open):
       Monthly Trend, Cases, AI Case Health, Hearings, Clients,
       Documents & AI, Team Activity
       Each closed card shows a one-line summary in its header.
   Period filter, Expand/Collapse all, Export CSV, Print.
   Remembers which cards you opened. Auto-refreshes when data
   changes in another tab or when the Doc AI finishes a scan.

   Depends on: storage.js, auth.js, navigation.js
   Optional:   doc-intelligence.js, case-intelligence.js (health,
               case type, "Open AI Summary")
   ============================================================ */

let currentAnalyticsSession = null;
let currentAnalyticsUser = null;

const AN_PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
  { value: 0, label: 'All time' }
];

const AN_CARD_IDS = ['trend', 'cases', 'health', 'hearings', 'clients', 'docs', 'team'];
const AN_OPEN_KEY = 'an_ui_open_cards';

const AN_COLORS = {
  gold: '#c9a227',
  orange: '#f5642d',
  purple: '#6a4be0',
  green: '#22a55a',
  red: '#ef4444',
  amber: '#f59e0b',
  slate: '#64748b',
  teal: '#14b8a6'
};
const AN_SERIES = [AN_COLORS.gold, AN_COLORS.orange, AN_COLORS.purple, AN_COLORS.green, AN_COLORS.slate];

const AN_STATUS_COLOR = {
  active: AN_COLORS.gold, 'in-transit': AN_COLORS.gold, 'in-progress': AN_COLORS.gold,
  pending: AN_COLORS.amber,
  completed: AN_COLORS.green, delivered: AN_COLORS.green, approved: AN_COLORS.green, submitted: AN_COLORS.green,
  cancelled: AN_COLORS.red, rejected: AN_COLORS.red,
  'awaiting-approval': AN_COLORS.purple, redo: AN_COLORS.orange, draft: AN_COLORS.slate
};

const anState = { period: 30, cache: null, open: anLoadOpen() };

document.addEventListener('DOMContentLoaded', () => {
  currentAnalyticsSession = requireAuth();
  if (!currentAnalyticsSession) return;

  currentAnalyticsUser = getCurrentUser();
  initLayout('analytics');

  anInjectControls();
  renderAnalytics();
  anAttachEvents();
});

/* ============================================================
   OPEN / CLOSED CARDS (remembered per browser)
   ============================================================ */
function anLoadOpen() {
  try {
    const raw = localStorage.getItem(AN_OPEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch (e) {
    return new Set();
  }
}

function anSaveOpen() {
  try { localStorage.setItem(AN_OPEN_KEY, JSON.stringify([...anState.open])); } catch (e) { /* ignore */ }
}

function anSetCardOpen(id, open) {
  if (open) anState.open.add(id); else anState.open.delete(id);

  const card = document.querySelector(`[data-an-card="${id}"]`);
  if (card) {
    card.classList.toggle('is-open', open);
    const body = card.querySelector('.an-card-body');
    if (body) body.hidden = !open;
    const btn = card.querySelector('[data-an-toggle]');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

function anToggleCard(id) {
  anSetCardOpen(id, !anState.open.has(id));
  anSaveOpen();
  anUpdateToggleAllLabel();
}

function anToggleAll() {
  const openAll = anState.open.size < AN_CARD_IDS.length;
  AN_CARD_IDS.forEach(id => anSetCardOpen(id, openAll));
  anSaveOpen();
  anUpdateToggleAllLabel();
}

function anUpdateToggleAllLabel() {
  const btn = document.getElementById('anToggleAllBtn');
  if (!btn) return;
  const allOpen = anState.open.size >= AN_CARD_IDS.length;
  btn.innerHTML = allOpen
    ? '<i class="fa-solid fa-compress"></i> Collapse all'
    : '<i class="fa-solid fa-expand"></i> Expand all';
}

/* ============================================================
   CONTROLS (period, expand, export, print) — in page heading
   ============================================================ */
function anInjectControls() {
  const heading = document.querySelector('.page-heading');
  if (!heading || document.getElementById('anPeriodSelect')) return;

  const box = document.createElement('div');
  box.className = 'an-controls';
  box.innerHTML = `
    <select class="sort-select" id="anPeriodSelect" title="Period">
      ${AN_PERIODS.map(p => `<option value="${p.value}" ${p.value === anState.period ? 'selected' : ''}>${p.label}</option>`).join('')}
    </select>
    <button type="button" class="btn-outline" id="anToggleAllBtn"><i class="fa-solid fa-expand"></i> Expand all</button>
    <button type="button" class="btn-outline" id="anExportBtn"><i class="fa-solid fa-file-csv"></i> Export CSV</button>
    <button type="button" class="btn-outline" id="anPrintBtn"><i class="fa-solid fa-print"></i> Print</button>
  `;
  heading.appendChild(box);
  anUpdateToggleAllLabel();
}

function anAttachEvents() {
  document.getElementById('anPeriodSelect').addEventListener('change', (e) => {
    anState.period = Number(e.target.value);
    renderAnalytics();
  });
  document.getElementById('anToggleAllBtn').addEventListener('click', anToggleAll);
  document.getElementById('anExportBtn').addEventListener('click', anExportCsv);
  document.getElementById('anPrintBtn').addEventListener('click', () => window.print());

  const root = document.getElementById('analyticsRoot');
  root.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-an-toggle]');
    if (toggle) {
      anToggleCard(toggle.dataset.anToggle);
      return;
    }
    const caseBtn = e.target.closest('[data-an-case]');
    if (caseBtn) anOpenCase(caseBtn.dataset.anCase);
  });

  // live refresh
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.indexOf('caseflow_') === 0) renderAnalytics();
  });
  window.addEventListener('docai:updated', () => renderAnalytics());
}

function anOpenCase(caseId) {
  if (typeof openCaseSummaryModal === 'function') {
    openCaseSummaryModal(caseId);
  } else {
    try { sessionStorage.setItem('caseflow_nav_target', `case:${caseId}`); } catch (e) { /* ignore */ }
    window.location.href = 'dashboard.html';
  }
}

/* ============================================================
   DATA
   ============================================================ */
function anSafe(fn, fallback) {
  try { const v = fn(); return v === undefined || v === null ? fallback : v; } catch (e) { return fallback; }
}

function anCollect() {
  const d = {
    cases: anSafe(() => getCases(), []),
    clients: anSafe(() => getClients(), []),
    hearings: anSafe(() => getHearings(), []),
    docs: anSafe(() => getDocuments(), []),
    activity: anSafe(() => getActivityLog(), []),
    users: anSafe(() => getUsers(), []),
    movements: anSafe(() => (typeof getDocMovements === 'function' ? getDocMovements() : []), [])
  };

  // AI case analysis (only if case-intelligence.js is loaded)
  d.caseAi = {};
  if (typeof caseAiAnalyze === 'function') {
    d.cases.forEach(c => {
      const a = anSafe(() => caseAiAnalyze(c.id), null);
      if (a) d.caseAi[c.id] = a;
    });
  }
  return d;
}

/* ---------- dates ---------- */
function anDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);          // plain date = local day
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return isNaN(d) ? null : d;
}
function anToday() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}
function anDayDiff(from, to) {
  return Math.round((to - from) / 86400000);
}
function anInPeriod(v) {
  if (!anState.period) return true;
  const d = anDate(v);
  if (!d) return false;
  const start = new Date(anToday().getTime() - (anState.period - 1) * 86400000);
  return d >= start;
}
function anPeriodLabel() {
  const p = AN_PERIODS.find(x => x.value === anState.period);
  return p ? p.label.toLowerCase() : '';
}
function anYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- misc ---------- */
function anClientName(c) {
  if (!c) return 'Unknown client';
  return c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed client';
}
function anUserName(id, users) {
  const u = users.find(x => x.id === id);
  return u ? `${u.firstName} ${u.lastName}` : 'Unknown user';
}
function anPeso(n, compact) {
  const v = Number(n) || 0;
  if (compact && Math.abs(v) >= 1000000) return '₱' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (compact && Math.abs(v) >= 10000) return '₱' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function anPct(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}
function anTitle(str) {
  if (!str) return 'Unknown';
  return String(str).replace(/[-_]/g, ' ').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function anCount(list, keyFn) {
  const out = {};
  list.forEach(item => {
    const k = keyFn(item);
    if (k === null || k === undefined || k === '') return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}
function anEsc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* ============================================================
   MAIN RENDER
   ============================================================ */
function renderAnalytics() {
  const root = document.getElementById('analyticsRoot');
  if (!root) return;

  const d = anCollect();
  anState.cache = d;

  root.innerHTML = `
    ${anRenderKpis(d)}
    <div class="an-grid">
      ${anRenderTrend(d)}
      ${anRenderCases(d)}
      ${anRenderHealth(d)}
      ${anRenderHearings(d)}
      ${anRenderClients(d)}
      ${anRenderDocs(d)}
      ${anRenderTeam(d)}
    </div>
    <p class="an-footnote"><i class="fa-solid fa-circle-info"></i>
      Click a card to open it. Generated ${new Date().toLocaleString('en-PH')} · Period: ${anEsc(anPeriodLabel())}
      · Figures marked "in period" follow the filter; totals and statuses are current.</p>
  `;
  anUpdateToggleAllLabel();
}

/* ---------- card shell (collapsible) ----------
   opts: { wide, link, linkLabel, summary, tone } */
function anCard(id, title, icon, body, opts = {}) {
  const open = anState.open.has(id);
  return `
    <section class="an-card ${opts.wide ? 'an-wide' : ''} ${open ? 'is-open' : ''}" data-an-card="${id}">
      <div class="an-card-head">
        <button type="button" class="an-card-toggle" data-an-toggle="${id}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="an-card-title"><i class="fa-solid ${icon}"></i> ${title}</span>
          ${opts.summary !== undefined ? `<span class="an-card-summary ${opts.tone || ''}">${opts.summary}</span>` : ''}
          <i class="fa-solid fa-chevron-down an-chevron"></i>
        </button>
        ${opts.link ? `<a class="an-card-link" href="${opts.link}" title="Go to ${anEsc(opts.linkLabel || '')}"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
      </div>
      <div class="an-card-body" ${open ? '' : 'hidden'}>${body}</div>
    </section>
  `;
}

function anEmpty(msg) {
  return `<div class="an-empty"><i class="fa-regular fa-folder-open"></i><span>${msg}</span></div>`;
}

function anStatRow(items) {
  return `<div class="an-stats">${items.map(i => `
    <div class="an-stat ${i.tone || ''}">
      <strong>${i.value}</strong><span>${i.label}</span>
    </div>`).join('')}</div>`;
}

/* ============================================================
   CHART HELPERS (pure SVG / CSS — no library needed)
   ============================================================ */

/** Horizontal bars. data = [{ label, value, color?, display? }] */
function anBars(data, opts = {}) {
  const rows = data.filter(r => r.value > 0);
  if (!rows.length) return anEmpty(opts.empty || 'No data yet.');
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<div class="an-bars">${rows.slice(0, opts.limit || 8).map(r => `
    <div class="an-bar-row">
      <div class="an-bar-label" title="${anEsc(r.label)}">${anEsc(r.label)}</div>
      <div class="an-bar-track"><div class="an-bar-fill" style="width:${Math.max(3, Math.round((r.value / max) * 100))}%;${r.color ? `background:${r.color};` : ''}"></div></div>
      <div class="an-bar-value">${r.display !== undefined ? r.display : r.value}</div>
    </div>`).join('')}</div>`;
}

/** Donut. segments = [{ label, value, color }] */
function anDonut(segments, centerValue, centerLabel) {
  const segs = segments.filter(s => s.value > 0);
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) return anEmpty('No data yet.');

  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segs.map(s => {
    const len = (s.value / total) * c;
    const arc = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="16"
      stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 60 60)"><title>${anEsc(s.label)}: ${s.value}</title></circle>`;
    offset += len;
    return arc;
  }).join('');

  return `
    <div class="an-donut-wrap">
      <svg class="an-donut" viewBox="0 0 120 120" role="img" aria-label="${anEsc(centerLabel)}">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--color-gray-bg, #f2f2f2)" stroke-width="16"></circle>
        ${arcs}
        <text x="60" y="58" text-anchor="middle" class="an-donut-num">${centerValue !== undefined ? centerValue : total}</text>
        <text x="60" y="74" text-anchor="middle" class="an-donut-sub">${anEsc(centerLabel || 'total')}</text>
      </svg>
      <ul class="an-legend">${segs.map(s => `
        <li><span class="an-dot" style="background:${s.color}"></span>${anEsc(s.label)}
          <b>${s.value}</b><small>${anPct(s.value, total)}%</small></li>`).join('')}
      </ul>
    </div>
  `;
}

/** Multi-series line chart. labels = [..], series = [{ name, color, values }] */
function anLine(labels, series) {
  const all = series.flatMap(s => s.values);
  if (!all.some(v => v > 0)) return anEmpty('No activity in this range yet.');

  const W = 640, H = 230, L = 34, R = 12, T = 14, B = 30;
  const max = Math.max(4, Math.ceil(Math.max(...all) / 4) * 4);
  const x = i => L + (labels.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = v => T + (H - T - B) * (1 - v / max);

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const val = Math.round(max * f);
    return `<line x1="${L}" x2="${W - R}" y1="${y(val)}" y2="${y(val)}" class="an-grid-line"></line>
            <text x="${L - 6}" y="${y(val) + 3}" text-anchor="end" class="an-axis">${val}</text>`;
  }).join('');

  const xLabels = labels.map((lb, i) =>
    `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="an-axis">${anEsc(lb)}</text>`).join('');

  const lines = series.map(s => {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const dots = s.values.map((v, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${s.color}"><title>${anEsc(s.name)} · ${anEsc(labels[i])}: ${v}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join('');

  return `
    <svg class="an-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly trend">${grid}${xLabels}${lines}</svg>
    <ul class="an-legend an-legend-row">${series.map(s => `
      <li><span class="an-dot" style="background:${s.color}"></span>${anEsc(s.name)} <b>${s.values.reduce((a, b) => a + b, 0)}</b></li>`).join('')}
    </ul>
  `;
}

/* ============================================================
   KPI TILES (always visible)
   ============================================================ */
function anRenderKpis(d) {
  const today = anToday();
  const in30 = new Date(today.getTime() + 30 * 86400000);

  const activeCases = d.cases.filter(c => (c.status || '').toLowerCase() === 'active').length;
  const newClients = d.clients.filter(c => anInPeriod(c.createdAt)).length;
  const hearings30 = d.hearings.filter(h => { const x = anDate(h.hearingDate); return x && x >= today && x <= in30; }).length;
  const newCases = d.cases.filter(c => anInPeriod(c.createdAt)).length;
  const actsInPeriod = d.activity.filter(a => anInPeriod(a.createdAt)).length;
  const scanned = d.docs.filter(x => x.aiStatus === 'done').length;

  const aiList = Object.values(d.caseAi).filter(a => !a.isClosed);
  const avgHealth = aiList.length ? Math.round(aiList.reduce((s, a) => s + (a.health || 0), 0) / aiList.length) : null;
  const needsAttention = aiList.filter(a => a.health < 80).length;

  const tile = (icon, value, label) => `
    <div class="tile">
      <div class="tile-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="tile-info"><h3>${value}</h3><p>${label}</p></div>
    </div>`;

  return `<div class="tiles-grid an-tiles">
    ${tile('fa-gavel', activeCases, `Active cases · ${d.cases.length} total`)}
    ${tile('fa-users', d.clients.length, `Clients · +${newClients} ${anPeriodLabel()}`)}
    ${tile('fa-calendar-days', hearings30, 'Hearings in next 30 days')}
    ${tile('fa-folder-plus', newCases, `New cases · ${anPeriodLabel()}`)}
    ${tile('fa-file-lines', d.docs.length, `Documents · ${anPct(scanned, d.docs.length)}% AI-scanned`)}
    ${avgHealth !== null
      ? tile('fa-heart-pulse', avgHealth + '%', `Avg. case health · ${needsAttention} need attention`)
      : tile('fa-people-group', actsInPeriod, `Team actions · ${anPeriodLabel()}`)}
  </div>`;
}

/* ============================================================
   TREND (monthly)
   ============================================================ */
function anRenderTrend(d) {
  const monthsBack = anState.period === 0 || anState.period === 365 ? 12 : 6;
  const now = anToday();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: m.getFullYear(), m: m.getMonth(), label: m.toLocaleDateString('en-US', { month: 'short' }) });
  }
  const bucket = (list, getDate) => months.map(mo => list.filter(item => {
    const x = anDate(getDate(item));
    return x && x.getFullYear() === mo.y && x.getMonth() === mo.m;
  }).length);

  const series = [
    { name: 'New cases', color: AN_SERIES[0], values: bucket(d.cases, c => c.createdAt) },
    { name: 'New clients', color: AN_SERIES[1], values: bucket(d.clients, c => c.createdAt) },
    { name: 'Documents uploaded', color: AN_SERIES[2], values: bucket(d.docs, x => x.uploadedAt) },
    { name: 'Hearings', color: AN_SERIES[3], values: bucket(d.hearings, h => h.hearingDate) }
  ];
  const totalRecords = series.reduce((s, x) => s + x.values.reduce((a, b) => a + b, 0), 0);

  return anCard('trend', `Monthly Trend <small>last ${monthsBack} months</small>`, 'fa-chart-line',
    anLine(months.map(m => m.label), series),
    { wide: true, summary: `${totalRecords} records` });
}

/* ============================================================
   CASES
   ============================================================ */
function anRenderCases(d) {
  const statuses = ['active', 'pending', 'completed', 'cancelled'];
  const counts = anCount(d.cases, c => (c.status || 'unknown').toLowerCase());
  const segs = statuses.map(s => ({ label: anTitle(s), value: counts[s] || 0, color: AN_STATUS_COLOR[s] }));
  Object.keys(counts).filter(k => !statuses.includes(k)).forEach(k =>
    segs.push({ label: anTitle(k), value: counts[k], color: AN_COLORS.slate }));

  let typeBlock = '';
  if (Object.keys(d.caseAi).length) {
    const types = anCount(Object.values(d.caseAi), a => {
      const pb = a.playbook || {};
      return pb.category || (pb.label ? String(pb.label).split(/[—–-]/)[0].trim() : 'General');
    });
    typeBlock = `<h4 class="an-sub">By case type</h4>` + anBars(
      Object.entries(types).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: AN_SERIES[i % AN_SERIES.length] })));
  }

  const newInPeriod = d.cases.filter(c => anInPeriod(c.createdAt)).length;
  const withDrawer = d.cases.filter(c => c.drawerNumber).length;

  return anCard('cases', 'Cases', 'fa-folder-open',
    anStatRow([
      { value: d.cases.length, label: 'Total' },
      { value: newInPeriod, label: 'New in period' },
      { value: `${anPct(withDrawer, d.cases.length)}%`, label: 'Filed in cabinet' }
    ]) +
    anDonut(segs, d.cases.length, 'cases') + typeBlock,
    { link: 'dashboard.html', linkLabel: 'Dashboard', summary: `${d.cases.length} · ${counts.active || 0} active` });
}

function anRenderHealth(d) {
  const list = Object.values(d.caseAi).filter(a => !a.isClosed);
  if (!list.length) {
    const msg = typeof caseAiAnalyze === 'function'
      ? 'No open cases to analyze.'
      : 'Load case-intelligence.js on this page to see AI case health.';
    return anCard('health', 'AI Case Health', 'fa-heart-pulse', anEmpty(msg), { summary: '—' });
  }

  const good = list.filter(a => a.health >= 80).length;
  const warn = list.filter(a => a.health >= 50 && a.health < 80).length;
  const bad = list.filter(a => a.health < 50).length;
  const avg = Math.round(list.reduce((s, a) => s + a.health, 0) / list.length);

  const worst = list.slice().sort((a, b) => a.health - b.health).filter(a => a.health < 100).slice(0, 5);
  const listHtml = worst.length ? `
    <h4 class="an-sub">Needs attention</h4>
    <ul class="an-list">${worst.map(a => {
      const tone = a.health >= 80 ? 'good' : a.health >= 50 ? 'warn' : 'bad';
      const top = (a.issues || [])[0];
      const issueText = top ? String(top.text || top.title || '').replace(/<[^>]+>/g, '') : '';
      return `
        <li>
          <span class="an-health ${tone}">${a.health}</span>
          <div class="an-list-main">
            <strong>${anEsc(a.caseObj.caseNumber)} — ${anEsc(a.caseObj.caseName || '')}</strong>
            <small>${anEsc(a.clientName || '')}${issueText ? ' · ' + anEsc(issueText.slice(0, 90)) : ''}</small>
          </div>
          <button type="button" class="an-mini-btn" data-an-case="${anEsc(a.caseObj.id)}" title="Open AI Case Summary"><i class="fa-solid fa-robot"></i></button>
        </li>`;
    }).join('')}</ul>` : '<p class="an-ok"><i class="fa-solid fa-circle-check"></i> All open cases are on track.</p>';

  return anCard('health', 'AI Case Health', 'fa-heart-pulse',
    anDonut([
      { label: 'On track (80–100)', value: good, color: AN_COLORS.green },
      { label: 'Needs attention (50–79)', value: warn, color: AN_COLORS.amber },
      { label: 'Urgent (below 50)', value: bad, color: AN_COLORS.red }
    ], avg + '%', 'avg health') + listHtml,
    { summary: `avg ${avg}%${bad ? ` · ${bad} urgent` : ''}`, tone: bad ? 'warn' : '' });
}

/* ============================================================
   HEARINGS
   ============================================================ */
function anRenderHearings(d) {
  const today = anToday();
  const upcoming = d.hearings
    .map(h => ({ h, date: anDate(h.hearingDate) }))
    .filter(x => x.date && x.date >= today)
    .sort((a, b) => a.date - b.date);

  const thisWeek = upcoming.filter(x => anDayDiff(today, x.date) <= 7).length;
  const past = d.hearings.filter(h => { const x = anDate(h.hearingDate); return x && x < today && anInPeriod(h.hearingDate); }).length;

  const items = upcoming.slice(0, 6).map(({ h, date }) => {
    const c = h.caseId ? anSafe(() => findCaseById(h.caseId), null) : null;
    const client = c ? anSafe(() => findClientById(c.clientId), null) : null;
    const days = anDayDiff(today, date);
    const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`;
    return `
      <li>
        <span class="an-date"><b>${date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</b>${date.getDate()}</span>
        <div class="an-list-main">
          <strong>${anEsc(c ? `${c.caseNumber} — ${c.caseName}` : (h.title || 'Hearing'))}</strong>
          <small>${anEsc(client ? anClientName(client) : (c ? c.courtName || '' : ''))}${h.time ? ' · ' + anEsc(h.time) : ''}</small>
        </div>
        <span class="an-pill ${days <= 3 ? 'hot' : ''}">${when}</span>
      </li>`;
  }).join('');

  return anCard('hearings', 'Hearings', 'fa-calendar-days',
    anStatRow([
      { value: upcoming.length, label: 'Upcoming' },
      { value: thisWeek, label: 'Next 7 days', tone: thisWeek ? 'warn' : '' },
      { value: past, label: 'Held in period' }
    ]) +
    (items ? `<ul class="an-list">${items}</ul>` : anEmpty('No upcoming hearings scheduled.')),
    { link: 'calendar.html', linkLabel: 'Calendar', summary: `${upcoming.length} upcoming · ${thisWeek} this week`, tone: thisWeek ? 'warn' : '' });
}

/* ============================================================
   CLIENTS
   ============================================================ */
function anRenderClients(d) {
  const byClient = anCount(d.cases, c => c.clientId);
  const rows = Object.entries(byClient)
    .map(([id, value]) => ({ label: anClientName(d.clients.find(c => c.id === id)), value }))
    .sort((a, b) => b.value - a.value);

  const withoutCase = d.clients.filter(c => !byClient[c.id]).length;
  const locked = d.clients.filter(c => c.isLocked).length;

  return anCard('clients', 'Clients', 'fa-users',
    anStatRow([
      { value: d.clients.length, label: 'Total' },
      { value: d.clients.filter(c => anInPeriod(c.createdAt)).length, label: 'New in period' },
      { value: withoutCase, label: 'No case yet', tone: withoutCase ? 'warn' : '' },
      { value: locked, label: 'Portal locked' }
    ]) +
    `<h4 class="an-sub">Most cases</h4>` +
    anBars(rows.map((r, i) => ({ ...r, color: AN_SERIES[i % AN_SERIES.length] })), { limit: 6, empty: 'No cases linked to clients yet.' }),
    { link: 'clients.html', linkLabel: 'Clients', summary: `${d.clients.length} · ${withoutCase} no case` });
}

/* ============================================================
   DOCUMENTS & AI
   ============================================================ */
function anRenderDocs(d) {
  const docs = d.docs;
  const scanned = docs.filter(x => x.aiStatus === 'done');
  const waiting = docs.filter(x => ['queued', 'scanning', 'pending'].includes(x.aiStatus) || !x.aiStatus).length;
  const failed = docs.filter(x => x.aiStatus === 'failed').length;
  const uploadedInPeriod = docs.filter(x => anInPeriod(x.uploadedAt)).length;

  const q = anCount(scanned, x => x.aiQuality || 'none');
  const types = anCount(scanned, x => x.aiDocType || null);

  const moves = d.movements.filter(m => anInPeriod(m.createdAt));
  const moveCounts = anCount(moves, m => m.action);
  const moveLabels = {
    upload: 'Uploaded', view: 'Viewed', rename: 'Renamed', replace: 'Replaced', download: 'Downloaded',
    delete: 'Deleted', 'ai-scan': 'AI scanned', 'ai-open': 'Opened from AI', 'auto-route': 'Auto-routed'
  };

  return anCard('docs', 'Documents & AI', 'fa-file-lines',
    anStatRow([
      { value: docs.length, label: 'Total files' },
      { value: uploadedInPeriod, label: 'Uploaded in period' },
      { value: `${anPct(scanned.length, docs.length)}%`, label: 'AI-scanned' },
      { value: waiting + failed, label: 'Waiting / failed', tone: failed ? 'bad' : '' }
    ]) +
    anDonut([
      { label: 'High quality', value: q.high || 0, color: AN_COLORS.green },
      { label: 'Medium', value: q.medium || 0, color: AN_COLORS.gold },
      { label: 'Low / blurry', value: q.low || 0, color: AN_COLORS.amber },
      { label: 'Name only', value: q.none || 0, color: AN_COLORS.slate }
    ], scanned.length, 'scanned') +
    (Object.keys(types).length ? `<h4 class="an-sub">Detected document types</h4>` + anBars(
      Object.entries(types).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: AN_SERIES[i % AN_SERIES.length] })),
      { limit: 6 }) : '') +
    (Object.keys(moveCounts).length ? `<h4 class="an-sub">File movements in period</h4>` + anBars(
      Object.entries(moveCounts).sort((a, b) => b[1] - a[1]).map(([k, value]) => ({ label: moveLabels[k] || anTitle(k), value, color: AN_COLORS.purple })),
      { limit: 6 }) : ''),
    {
      summary: `${docs.length} files · ${anPct(scanned.length, docs.length)}% scanned`,
      tone: failed ? 'warn' : ''
    });
}

/* ============================================================
   TEAM ACTIVITY
   ============================================================ */
function anRenderTeam(d) {
  const acts = d.activity.filter(a => anInPeriod(a.createdAt));
  const activeUsers = new Set(acts.map(a => a.userId).filter(Boolean)).size;

  const byUser = anCount(acts, a => a.userId);
  const topUsers = Object.entries(byUser).sort((a, b) => b[1] - a[1])
    .map(([id, value], i) => ({ label: anUserName(id, d.users), value, color: AN_SERIES[i % AN_SERIES.length] }));

  const recent = d.activity.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 7)
    .map(a => `
      <li>
        <span class="an-avatar">${anEsc(anUserName(a.userId, d.users).split(' ').map(p => p[0] || '').join('').slice(0, 2).toUpperCase())}</span>
        <div class="an-list-main">
          <strong>${anEsc(a.description || a.action)}</strong>
          <small>${anEsc(anUserName(a.userId, d.users))} · ${anEsc(typeof formatTimeAgo === 'function' ? formatTimeAgo(a.createdAt) : a.createdAt)}</small>
        </div>
      </li>`).join('');

  return anCard('team', 'Team Activity', 'fa-people-group',
    anStatRow([
      { value: d.users.length, label: 'Users' },
      { value: acts.length, label: 'Actions in period' },
      { value: activeUsers, label: 'Active members' }
    ]) +
    `<h4 class="an-sub">Most active</h4>` + anBars(topUsers, { limit: 5, empty: 'No activity in this period.' }) +
    (recent ? `<h4 class="an-sub">Recent</h4><ul class="an-list an-list-compact">${recent}</ul>` : ''),
    { link: 'control-panel.html', linkLabel: 'Control Panel', summary: `${acts.length} actions · ${activeUsers} active` });
}

/* ============================================================
   EXPORT CSV
   ============================================================ */
function anExportCsv() {
  const d = anState.cache || anCollect();
  const today = anToday();
  const rows = [['Section', 'Metric', 'Value']];
  const add = (s, m, v) => rows.push([s, m, v]);

  add('Report', 'Generated', new Date().toLocaleString('en-PH'));
  add('Report', 'Period', AN_PERIODS.find(p => p.value === anState.period).label);

  const caseCounts = anCount(d.cases, c => (c.status || 'unknown').toLowerCase());
  add('Cases', 'Total', d.cases.length);
  Object.entries(caseCounts).forEach(([k, v]) => add('Cases', anTitle(k), v));
  add('Cases', 'New in period', d.cases.filter(c => anInPeriod(c.createdAt)).length);

  const ai = Object.values(d.caseAi).filter(a => !a.isClosed);
  if (ai.length) {
    add('AI Case Health', 'Average health', Math.round(ai.reduce((s, a) => s + a.health, 0) / ai.length) + '%');
    ai.sort((a, b) => a.health - b.health).forEach(a =>
      add('AI Case Health', `${a.caseObj.caseNumber} — ${a.caseObj.caseName || ''}`, a.health));
  }

  add('Clients', 'Total', d.clients.length);
  add('Clients', 'New in period', d.clients.filter(c => anInPeriod(c.createdAt)).length);

  add('Hearings', 'Upcoming', d.hearings.filter(h => { const x = anDate(h.hearingDate); return x && x >= today; }).length);

  add('Documents', 'Total', d.docs.length);
  add('Documents', 'AI-scanned', d.docs.filter(x => x.aiStatus === 'done').length);
  const types = anCount(d.docs.filter(x => x.aiStatus === 'done'), x => x.aiDocType || null);
  Object.entries(types).forEach(([k, v]) => add('Documents', `Type: ${k}`, v));

  add('Team', 'Actions in period', d.activity.filter(a => anInPeriod(a.createdAt)).length);

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CaseFlow_Analytics_${anYmd(today)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (typeof showToast === 'function') showToast('Analytics report exported.', 'success');
}