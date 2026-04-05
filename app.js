/* ═══════════════════════════════════════════════════════════════════════
   MaMony — Expense Tracker
   Vanilla ES6+ · localStorage · No dependencies beyond HTML/CSS
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mamony_transactions';

const CATEGORIES = {
  income: [
    { id: 'salary',     label: 'Salary',       icon: 'fa-briefcase' },
    { id: 'freelance',  label: 'Freelance',     icon: 'fa-laptop-code' },
    { id: 'investment', label: 'Investment',    icon: 'fa-chart-line' },
    { id: 'gift',       label: 'Gift',          icon: 'fa-gift' },
    { id: 'refund',     label: 'Refund',        icon: 'fa-rotate-left' },
    { id: 'other_in',   label: 'Other',         icon: 'fa-circle-plus' },
  ],
  expense: [
    { id: 'food',       label: 'Food & Dining', icon: 'fa-utensils' },
    { id: 'transport',  label: 'Transport',     icon: 'fa-car' },
    { id: 'housing',    label: 'Housing',       icon: 'fa-house' },
    { id: 'utilities',  label: 'Utilities',     icon: 'fa-bolt' },
    { id: 'health',     label: 'Health',        icon: 'fa-heart-pulse' },
    { id: 'shopping',   label: 'Shopping',      icon: 'fa-bag-shopping' },
    { id: 'entertainment', label: 'Entertainment', icon: 'fa-film' },
    { id: 'education',  label: 'Education',     icon: 'fa-graduation-cap' },
    { id: 'travel',     label: 'Travel',        icon: 'fa-plane' },
    { id: 'subscriptions', label: 'Subscriptions', icon: 'fa-repeat' },
    { id: 'other_ex',   label: 'Other',         icon: 'fa-circle-minus' },
  ],
};

const CUSTOM_CATS_KEY = 'mamony_custom_categories';

const PICKABLE_ICONS = [
  'fa-utensils','fa-coffee','fa-pizza-slice','fa-wine-glass',
  'fa-car','fa-bus','fa-bicycle','fa-plane','fa-train','fa-taxi',
  'fa-house','fa-building','fa-store','fa-hotel',
  'fa-bolt','fa-droplet','fa-fire','fa-wifi',
  'fa-heart-pulse','fa-pills','fa-dumbbell','fa-stethoscope',
  'fa-bag-shopping','fa-shirt','fa-gem','fa-scissors',
  'fa-film','fa-music','fa-gamepad','fa-tv',
  'fa-book','fa-graduation-cap','fa-palette','fa-pen',
  'fa-paw','fa-baby','fa-users','fa-user-tie',
  'fa-briefcase','fa-laptop','fa-chart-line','fa-gift',
  'fa-wrench','fa-phone','fa-globe','fa-leaf',
  'fa-wallet','fa-piggy-bank','fa-coins','fa-credit-card',
];

const ALL_CATS = [...CATEGORIES.income, ...CATEGORIES.expense];

const RATES_KEY    = 'mamony_rates';
const BASE_CURR_KEY = 'mamony_base_currency';

const CURRENCIES = {
  USD: { symbol: '$',    code: 'USD', label: 'USD', decimals: 2, locale: 'en-US' },
  PYG: { symbol: '₲',   code: 'PYG', label: 'PYG', decimals: 0, locale: 'es-PY' },
  ARS: { symbol: 'ARS$', code: 'ARS', label: 'ARS', decimals: 0, locale: 'es-AR' },
};

const DEFAULT_RATES = { USD_PYG: 7800, USD_ARS: 1200 };

const CHART_PALETTE = [
  '#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee',
  '#818cf8', '#c084fc', '#fb7185', '#6ee7b7', '#67e8f9',
  '#a5b4fc', '#fde68a',
];

// ─── State ────────────────────────────────────────────────────────────────────

let transactions    = [];
let currentType     = 'income';
let viewYear        = new Date().getFullYear();
let viewMonth       = new Date().getMonth(); // 0-indexed
let pendingDeleteId   = null;
let chartMode         = 'expense';
let chartInstance     = null;
let customCategories  = { income: [], expense: [] };
let catModalType      = 'expense';
let selectedIcon      = PICKABLE_ICONS[0];
let liveRates         = { ...DEFAULT_RATES };
let currentCurrency   = 'USD';
let baseCurrency      = 'USD';

// ─── Sync State ───────────────────────────────────────────────────────────────

const FIREBASE_DB_URL  = (window.FIREBASE_DB_URL || '').replace(/\/$/, '');
const SYNC_KEY_STORAGE = 'mamony_sync_key';

let syncKey         = null;
let syncEventSource = null;
let isSyncing       = false;
let syncPushTimer   = null;

// ─── Dark mode ────────────────────────────────────────────────────────────────

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const isDark  = () => darkMQ.matches;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Format an amount in a specific currency (e.g. for transaction rows)
function formatAmount(amount, currency) {
  const c   = CURRENCIES[currency] || CURRENCIES.USD;
  const abs = Math.abs(amount);
  return c.symbol + '\u00a0' + abs.toLocaleString(c.locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  });
}

// Format in the current base/display currency (e.g. for summary cards)
function formatCurrency(amount) {
  return formatAmount(amount, baseCurrency);
}

// Convert amount between any two currencies using given rates (or liveRates)
function convertTo(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amount;
  const r = rates || liveRates;
  let usd;
  if      (fromCurrency === 'PYG') usd = amount / r.USD_PYG;
  else if (fromCurrency === 'ARS') usd = amount / r.USD_ARS;
  else                              usd = amount; // already USD
  if      (toCurrency === 'PYG')  return usd * r.USD_PYG;
  else if (toCurrency === 'ARS')  return usd * r.USD_ARS;
  return usd; // to USD
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(y, m - 1, d));
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function monthLabel(year, month) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
    .format(new Date(year, month, 1));
}

function getCatsForType(type) {
  return [...CATEGORIES[type], ...customCategories[type]];
}

function getAllCatsList() {
  return [...getCatsForType('income'), ...getCatsForType('expense')];
}

function getCatMeta(categoryId) {
  return getAllCatsList().find(c => c.id === categoryId) || { label: categoryId, icon: 'fa-circle' };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t =>
      t && typeof t.id === 'string' &&
      (t.type === 'income' || t.type === 'expense') &&
      typeof t.amount === 'number' && t.amount > 0 &&
      typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
      typeof t.category === 'string'
    );
  } catch {
    return [];
  }
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  schedulePush();
}

function loadCustomCategories() {
  try {
    const raw = localStorage.getItem(CUSTOM_CATS_KEY);
    if (!raw) return { income: [], expense: [] };
    const parsed = JSON.parse(raw);
    const valid = { income: [], expense: [] };
    ['income', 'expense'].forEach(t => {
      if (Array.isArray(parsed[t])) {
        valid[t] = parsed[t].filter(c =>
          c && typeof c.id === 'string' &&
          typeof c.label === 'string' &&
          typeof c.icon === 'string'
        );
      }
    });
    return valid;
  } catch { return { income: [], expense: [] }; }
}

function saveCustomCategories() {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(customCategories));
  schedulePush();
}

// ─── Rates ────────────────────────────────────────────────────────────────────

function loadRates() {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.USD_PYG && p.USD_ARS) { liveRates = p; return; }
    }
  } catch {}
  liveRates = { ...DEFAULT_RATES };
}

function saveRates() {
  localStorage.setItem(RATES_KEY, JSON.stringify(liveRates));
}

async function fetchRates() {
  const btn = document.getElementById('btnRefreshRates');
  if (btn) btn.classList.add('spinning');
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    liveRates  = {
      USD_PYG: Math.round(data.rates.PYG),
      USD_ARS: Math.round(data.rates.ARS),
    };
    saveRates();
    renderRatesBar();
    renderSummary();
    renderChart();
  } catch {
    // silently use cached / default rates
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

// ─── Derived data ─────────────────────────────────────────────────────────────

function transactionsForMonth(year, month) {
  return transactions.filter(t => {
    const [y, m] = t.date.split('-').map(Number);
    return y === year && m === month + 1;
  });
}

function computeSummary(txList) {
  let income = 0, expense = 0;
  txList.forEach(t => {
    const rates = t.savedRates || liveRates;
    const base  = convertTo(t.amount, t.currency || 'USD', baseCurrency, rates);
    if (t.type === 'income') income  += base;
    else                      expense += base;
  });
  return { income, expense, balance: income - expense };
}

function hasMixedCurrencies(txList) {
  return txList.some(t => (t.currency || 'USD') !== baseCurrency);
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function buildChartData(type) {
  const monthTx = transactionsForMonth(viewYear, viewMonth).filter(t => t.type === type);
  const totals  = {};
  monthTx.forEach(t => {
    const rates = t.savedRates || liveRates;
    const base  = convertTo(t.amount, t.currency || 'USD', baseCurrency, rates);
    totals[t.category] = (totals[t.category] || 0) + base;
  });
  return Object.entries(totals)
    .map(([id, amount]) => ({ id, amount, meta: getCatMeta(id) }))
    .sort((a, b) => b.amount - a.amount);
}

function setChartMode(type) {
  chartMode = type;
  const expBtn = document.getElementById('chartModeExpense');
  const incBtn = document.getElementById('chartModeIncome');
  expBtn.className = 'type-btn' + (type === 'expense' ? ' active-expense' : '');
  incBtn.className = 'type-btn' + (type === 'income'  ? ' active-income'  : '');
  renderChart();
}

function renderChart() {
  if (typeof Chart === 'undefined') return;

  const canvas    = document.getElementById('pieChart');
  const chartWrap = document.getElementById('chartWrap');
  const chartEmpty= document.getElementById('chartEmpty');
  const legendEl  = document.getElementById('chartLegend');
  const centerEl  = document.getElementById('chartCenter');

  const sorted = buildChartData(chartMode);

  if (sorted.length === 0) {
    chartWrap.classList.add('hidden');
    legendEl.innerHTML   = '';
    centerEl.innerHTML   = '';
    chartEmpty.classList.remove('hidden');
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    return;
  }

  chartWrap.classList.remove('hidden');
  chartEmpty.classList.add('hidden');

  const labels = sorted.map(d => d.meta.label);
  const data   = sorted.map(d => d.amount);
  const colors = CHART_PALETTE.slice(0, data.length);
  const total  = data.reduce((s, v) => s + v, 0);

  // Center label
  centerEl.innerHTML = `
    <span class="chart-center-label">${chartMode === 'expense' ? 'Expenses' : 'Income'}</span>
    <span class="chart-center-value">${formatCurrency(total)}</span>
  `;

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const dark = isDark();

  chartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: dark ? '#1e293b' : '#ffffff',
        borderWidth: 3,
        hoverOffset: 10,
        hoverBorderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: dark ? '#334155' : '#111827',
          titleColor:       dark ? '#f1f5f9' : '#ffffff',
          bodyColor:        dark ? '#f1f5f9' : '#ffffff',
          borderColor:      dark ? '#475569' : 'transparent',
          borderWidth:      dark ? 1 : 0,
          callbacks: {
            label: (ctx) => {
              const val = ctx.raw;
              const pct = ((val / total) * 100).toFixed(1);
              return `  ${formatCurrency(val)}  (${pct}%)`;
            },
          },
          bodyFont: { family: 'Inter, system-ui, sans-serif', size: 12 },
          padding: 10,
          cornerRadius: 8,
        },
      },
      animation: { animateRotate: true, animateScale: false, duration: 400 },
    },
  });

  // Legend rows
  legendEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  sorted.forEach((d, i) => {
    const pct = ((d.amount / total) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'chart-legend-row';
    row.innerHTML = `
      <span class="chart-legend-dot" style="background:${colors[i]}"></span>
      <span class="chart-legend-icon"><i class="fa-solid ${d.meta.icon}"></i></span>
      <span class="chart-legend-label">${escapeHtml(d.meta.label)}</span>
      <span class="chart-legend-pct">${pct}%</span>
      <span class="chart-legend-amount">${formatCurrency(d.amount)}</span>
    `;
    frag.appendChild(row);
  });
  legendEl.appendChild(frag);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderMonthLabel();
  renderSummary();
  renderCategoryFilters();
  renderTransactions();
  renderChart();
}

function renderMonthLabel() {
  document.getElementById('currentMonthLabel').textContent = monthLabel(viewYear, viewMonth);
}

function renderSummary() {
  const monthTx = transactionsForMonth(viewYear, viewMonth);
  const { income, expense, balance } = computeSummary(monthTx);

  const mixed  = hasMixedCurrencies(monthTx);
  const prefix = mixed ? '≈\u00a0' : '';

  const balEl = document.getElementById('totalBalance');
  balEl.textContent = prefix + formatCurrency(balance);
  balEl.className   = 'summary-value ' + (balance >= 0 ? 'text-gray-900' : 'text-expense');

  document.getElementById('totalIncome').textContent   = prefix + formatCurrency(income);
  document.getElementById('totalExpenses').textContent = prefix + formatCurrency(expense);

  // Update base-currency toggle label
  const bc = CURRENCIES[baseCurrency];
  const btn = document.getElementById('baseCurrBtn');
  if (btn) btn.textContent = bc.symbol + '\u00a0' + bc.code;
}

function renderRatesBar() {
  const el = document.getElementById('ratesBar');
  if (!el) return;
  const pyg = Math.round(liveRates.USD_PYG).toLocaleString('es-PY');
  const ars = Math.round(liveRates.USD_ARS).toLocaleString('es-AR');
  el.textContent = `1 USD = ₲\u00a0${pyg}  ·  1 USD = ARS$\u00a0${ars}`;
}

function renderCategoryFilters() {
  const sel = document.getElementById('filterCategory');
  const current = sel.value;

  // collect categories that appear in transactions for this month
  const monthTx  = transactionsForMonth(viewYear, viewMonth);
  const usedCats = [...new Set(monthTx.map(t => t.category))];

  // rebuild options
  while (sel.options.length > 1) sel.remove(1);
  usedCats.forEach(id => {
    const meta = getCatMeta(id);
    const opt  = new Option(meta.label, id);
    sel.add(opt);
  });

  sel.value = usedCats.includes(current) ? current : 'all';
}

function renderTransactions() {
  const list        = document.getElementById('transactionList');
  const emptyState  = document.getElementById('emptyState');
  const filterCat   = document.getElementById('filterCategory').value;
  const filterType  = document.getElementById('filterType').value;

  let monthTx = transactionsForMonth(viewYear, viewMonth);

  if (filterType !== 'all')  monthTx = monthTx.filter(t => t.type === filterType);
  if (filterCat  !== 'all')  monthTx = monthTx.filter(t => t.category === filterCat);

  // sort newest first
  monthTx.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.createdAt - a.createdAt));

  list.innerHTML = '';

  if (monthTx.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const frag = document.createDocumentFragment();
  monthTx.forEach(tx => {
    frag.appendChild(createTxElement(tx));
  });
  list.appendChild(frag);
}

function buildConversions(tx) {
  const from   = tx.currency || 'USD';
  const rates  = tx.savedRates || liveRates;
  const others = Object.keys(CURRENCIES).filter(c => c !== from);
  return others.map(to => {
    const converted = convertTo(tx.amount, from, to, rates);
    return `<span class="tx-conv-item">${formatAmount(converted, to)}</span>`;
  }).join('<span class="tx-conv-sep">·</span>');
}

function toggleTxExpand(item) {
  const isOpen = item.classList.contains('tx-expanded');
  // close all
  document.querySelectorAll('.tx-item.tx-expanded').forEach(el => {
    el.classList.remove('tx-expanded');
    const conv = el.querySelector('.tx-conversions');
    if (conv) conv.classList.add('hidden');
  });
  if (!isOpen) {
    item.classList.add('tx-expanded');
    const conv = item.querySelector('.tx-conversions');
    if (conv) conv.classList.remove('hidden');
  }
}

function createTxElement(tx) {
  const meta = getCatMeta(tx.category);
  const div  = document.createElement('div');
  div.className = 'tx-item';
  div.dataset.id = tx.id;

  const sign = tx.type === 'income' ? '+' : '-';

  div.innerHTML = `
    <div class="tx-row">
      <div class="tx-icon ${tx.type}">
        <i class="fa-solid ${meta.icon}"></i>
      </div>
      <div class="tx-meta">
        <div class="tx-note">${escapeHtml(tx.note || meta.label)}</div>
        <div class="tx-cat-date">
          <span>${escapeHtml(meta.label)}</span>
          <span>·</span>
          <span>${formatDate(tx.date)}</span>
        </div>
      </div>
      <div class="tx-amount ${tx.type}">${sign}${formatAmount(tx.amount, tx.currency || 'USD')}</div>
      <button class="tx-delete" data-id="${tx.id}" aria-label="Delete transaction" title="Delete">
        <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
      </button>
    </div>
    <div class="tx-conversions hidden">
      <i class="fa-solid fa-right-left tx-conv-icon"></i>
      ${buildConversions(tx)}
    </div>
  `;

  return div;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Category Select ──────────────────────────────────────────────────────────

function populateCategorySelect(type) {
  const sel = document.getElementById('category');
  sel.innerHTML = '';
  getCatsForType(type).forEach(cat => {
    const opt = new Option(cat.label, cat.id);
    sel.add(opt);
  });
}

// ─── Type Toggle ──────────────────────────────────────────────────────────────

function setType(type) {
  currentType = type;

  const incBtn = document.getElementById('typeIncome');
  const expBtn = document.getElementById('typeExpense');
  const subBtn = document.getElementById('submitBtn');
  const subLabel = document.getElementById('submitBtnLabel');

  incBtn.className = 'type-btn' + (type === 'income'  ? ' active-income'  : '');
  expBtn.className = 'type-btn' + (type === 'expense' ? ' active-expense' : '');

  subBtn.className = `submit-btn ${type}-mode`;
  subLabel.textContent = type === 'income' ? 'Add Income' : 'Add Expense';

  populateCategorySelect(type);
  clearFormError();
}

// ─── Currency ─────────────────────────────────────────────────────────────────

function setCurrency(currency) {
  currentCurrency = currency;
  document.querySelectorAll('.curr-btn').forEach(b => {
    b.classList.remove('active-usd', 'active-pyg', 'active-ars');
    if (b.dataset.currency === currency) b.classList.add(`active-${currency.toLowerCase()}`);
  });
  const inp = document.getElementById('amount');
  if (currency === 'USD') {
    inp.step = '0.01'; inp.min = '0.01'; inp.placeholder = '0.00';
  } else {
    inp.step = '1';    inp.min = '1';    inp.placeholder = '0';
  }
}

function setBaseCurrency(currency) {
  baseCurrency = currency;
  localStorage.setItem(BASE_CURR_KEY, currency);
  renderSummary();
  renderChart();
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearFormError() {
  const el = document.getElementById('formError');
  el.textContent = '';
  el.classList.add('hidden');
  document.getElementById('amount').classList.remove('error');
}

function handleFormSubmit(e) {
  e.preventDefault();
  clearFormError();

  const amountRaw = document.getElementById('amount').value.trim();
  const date      = document.getElementById('date').value;
  const category  = document.getElementById('category').value;
  const note      = document.getElementById('note').value.trim();

  // Validate
  const amount = parseFloat(amountRaw);
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    document.getElementById('amount').classList.add('error');
    showFormError('Please enter a valid positive amount.');
    document.getElementById('amount').focus();
    return;
  }

  if (!date) {
    showFormError('Please select a date.');
    return;
  }

  const roundedAmount = CURRENCIES[currentCurrency].decimals === 0
    ? Math.round(amount)
    : Math.round(amount * 100) / 100;

  const tx = {
    id:         generateId(),
    type:       currentType,
    amount:     roundedAmount,
    currency:   currentCurrency,
    savedRates: { ...liveRates },
    category,
    date,
    note:       note.slice(0, 80),
    createdAt:  Date.now(),
  };

  transactions.unshift(tx);
  saveTransactions();

  // Reset form fields (keep type, category, date)
  document.getElementById('amount').value = '';
  document.getElementById('note').value   = '';

  // Sync view to transaction's month in case user entered a past/future date
  const [y, m] = date.split('-').map(Number);
  viewYear  = y;
  viewMonth = m - 1;

  renderAll();
  showToast(`${currentType === 'income' ? 'Income' : 'Expense'} added!`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

function openDeleteModal(id) {
  pendingDeleteId = id;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('deleteModal').classList.add('hidden');
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  transactions = transactions.filter(t => t.id !== pendingDeleteId);
  saveTransactions();
  closeDeleteModal();
  renderAll();
  showToast('Transaction deleted.');
}

// ─── Export / Import ──────────────────────────────────────────────────────────

function exportData() {
  if (transactions.length === 0) {
    showToast('Nothing to export yet.');
    return;
  }
  const blob = new Blob(
    [JSON.stringify(transactions, null, 2)],
    { type: 'application/json' }
  );
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mamony-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data exported successfully.');
}

function triggerImport() {
  document.getElementById('importFileInput').click();
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    showToast('Please select a valid .json file.');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (!Array.isArray(parsed)) throw new Error('Root must be an array');

      const valid = parsed.filter(t =>
        t && typeof t.id === 'string' &&
        (t.type === 'income' || t.type === 'expense') &&
        typeof t.amount === 'number' && t.amount > 0 &&
        typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
        typeof t.category === 'string'
      );

      if (valid.length === 0) {
        showToast('No valid transactions found in file.');
        return;
      }

      // Merge: keep existing, add new ones by id
      const existingIds = new Set(transactions.map(t => t.id));
      const newOnes     = valid.filter(t => !existingIds.has(t.id));

      transactions = [...transactions, ...newOnes];
      saveTransactions();
      renderAll();

      const msg = newOnes.length > 0
        ? `Imported ${newOnes.length} transaction${newOnes.length > 1 ? 's' : ''}.`
        : 'All records already exist — nothing new imported.';
      showToast(msg);
    } catch {
      showToast('Invalid JSON file. Please check the format.');
    } finally {
      e.target.value = '';
    }
  };
  reader.onerror = () => {
    showToast('Failed to read file.');
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Month Navigation ─────────────────────────────────────────────────────────

function prevMonth() {
  if (viewMonth === 0) { viewMonth = 11; viewYear--; }
  else                 { viewMonth--; }
  renderAll();
}

function nextMonth() {
  const now = new Date();
  // Allow navigating up to current month only
  if (viewYear === now.getFullYear() && viewMonth === now.getMonth()) return;
  if (viewMonth === 11) { viewMonth = 0; viewYear++; }
  else                  { viewMonth++; }
  renderAll();
}

// ─── Category Management ──────────────────────────────────────────────────────

function openCatModal() {
  catModalType = currentType;
  document.getElementById('catModal').classList.remove('hidden');
  setCatTab(catModalType);
}

function closeCatModal() {
  document.getElementById('catModal').classList.add('hidden');
  document.getElementById('newCatName').value = '';
  selectedIcon = PICKABLE_ICONS[0];
}

function setCatTab(type) {
  catModalType = type;
  const expBtn = document.getElementById('catTabExpense');
  const incBtn = document.getElementById('catTabIncome');
  expBtn.className = 'type-btn' + (type === 'expense' ? ' active-expense' : '');
  incBtn.className = 'type-btn' + (type === 'income'  ? ' active-income'  : '');

  const addBtn = document.getElementById('btnAddCat');
  addBtn.className = 'submit-btn ' + (type === 'income' ? 'income-mode' : 'expense-mode');

  document.getElementById('catModal').dataset.type = type;
  selectedIcon = PICKABLE_ICONS[0];
  renderCatList();
  renderIconPicker();
}

function renderCatList() {
  const list = document.getElementById('catList');
  const cats = getCatsForType(catModalType);
  list.innerHTML = '';

  if (cats.length === 0) {
    list.innerHTML = '<p class="cat-empty">No categories yet.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  cats.forEach(cat => {
    const isBuiltIn = CATEGORIES[catModalType].some(c => c.id === cat.id);
    const row = document.createElement('div');
    row.className = 'cat-item';
    row.innerHTML = `
      <span class="cat-item-icon tx-icon ${catModalType}">
        <i class="fa-solid ${cat.icon}"></i>
      </span>
      <span class="cat-item-label">${escapeHtml(cat.label)}</span>
      ${isBuiltIn
        ? '<span class="cat-item-lock"><i class="fa-solid fa-lock"></i></span>'
        : `<button class="tx-delete cat-del-btn" data-id="${cat.id}" data-type="${catModalType}" aria-label="Delete category">
             <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
           </button>`
      }
    `;
    frag.appendChild(row);
  });
  list.appendChild(frag);
}

function renderIconPicker() {
  const picker = document.getElementById('iconPicker');
  picker.innerHTML = '';
  const frag = document.createDocumentFragment();
  PICKABLE_ICONS.forEach(icon => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-option' + (icon === selectedIcon ? ' selected' : '');
    btn.dataset.icon = icon;
    btn.setAttribute('aria-label', icon.replace('fa-', ''));
    btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    frag.appendChild(btn);
  });
  picker.appendChild(frag);
}

function handleAddCategory() {
  const nameInput = document.getElementById('newCatName');
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.classList.add('error');
    nameInput.focus();
    setTimeout(() => nameInput.classList.remove('error'), 1500);
    return;
  }

  const existing = getCatsForType(catModalType);
  if (existing.some(c => c.label.toLowerCase() === name.toLowerCase())) {
    showToast('A category with that name already exists.');
    nameInput.focus();
    return;
  }

  const newCat = {
    id:    'custom_' + generateId(),
    label: name.slice(0, 30),
    icon:  selectedIcon,
  };

  customCategories[catModalType].push(newCat);
  saveCustomCategories();
  nameInput.value = '';
  selectedIcon = PICKABLE_ICONS[0];
  renderCatList();
  renderIconPicker();
  populateCategorySelect(currentType);
  showToast(`"${newCat.label}" added.`);
}

function handleDeleteCategory(id, type) {
  const cat = customCategories[type].find(c => c.id === id);
  if (!cat) return;
  customCategories[type] = customCategories[type].filter(c => c.id !== id);
  saveCustomCategories();
  renderCatList();
  populateCategorySelect(currentType);
  renderCategoryFilters();
  showToast(`"${cat.label}" removed.`);
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

function generateSyncKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function loadSyncKey()    { return localStorage.getItem(SYNC_KEY_STORAGE) || null; }
function saveSyncKey(key) { localStorage.setItem(SYNC_KEY_STORAGE, key); }
function clearSyncKey()   { localStorage.removeItem(SYNC_KEY_STORAGE); }

function schedulePush() {
  if (!syncKey || !FIREBASE_DB_URL) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(pushToCloud, 5);
}

async function pushToCloud() {
  if (!syncKey || !FIREBASE_DB_URL) return;
  isSyncing = true;
  setSyncStatus('syncing');
  const payload = { transactions, customCategories, lastModified: Date.now() };
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/mamony/${syncKey}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.setItem('mamony_last_modified', String(payload.lastModified));
    setSyncStatus('connected');
  } catch {
    setSyncStatus('error');
  } finally {
    setTimeout(() => { isSyncing = false; }, 500);
  }
}

function startSyncListener() {
  if (!syncKey || !FIREBASE_DB_URL) return;
  stopSyncListener();
  syncEventSource = new EventSource(`${FIREBASE_DB_URL}/mamony/${syncKey}.json`);
  syncEventSource.addEventListener('put', handleRemoteData);
  syncEventSource.onerror = () => setSyncStatus('error');
  setSyncStatus('connected');
}

function stopSyncListener() {
  if (syncEventSource) { syncEventSource.close(); syncEventSource = null; }
  setSyncStatus('off');
}

function handleRemoteData(event) {
  if (isSyncing) return;
  let parsed; try { parsed = JSON.parse(event.data); } catch { return; }
  const remote = parsed.data;
  if (!remote || typeof remote.lastModified !== 'number') return;
  const localModified = parseInt(localStorage.getItem('mamony_last_modified') || '0', 10);
  if (remote.lastModified <= localModified) return;

  transactions     = Array.isArray(remote.transactions) ? remote.transactions : [];
  customCategories = (remote.customCategories && typeof remote.customCategories === 'object')
    ? remote.customCategories : { income: [], expense: [] };

  isSyncing = true;
  localStorage.setItem(STORAGE_KEY,     JSON.stringify(transactions));
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(customCategories));
  localStorage.setItem('mamony_last_modified', String(remote.lastModified));
  isSyncing = false;

  renderAll();
  showToast('Data synced from another device.');
}

function setSyncStatus(status) {
  const dot = document.getElementById('syncDot');
  if (dot) dot.className = `sync-dot sync-dot--${status}`;
}

function renderSyncModal() {
  const hasSyncKey = !!syncKey;
  document.getElementById('syncSetupSection').classList.toggle('hidden', hasSyncKey);
  document.getElementById('syncActiveSection').classList.toggle('hidden', !hasSyncKey);
  if (hasSyncKey) {
    document.getElementById('syncKeyDisplay').textContent =
      syncKey.slice(0, 8) + '••••••••••••••••••••' + syncKey.slice(-4);
    const dot = document.getElementById('syncDot')?.className || '';
    const statusMap = { connected: 'Connected', syncing: 'Syncing…', error: 'Error — check connection' };
    const s = Object.keys(statusMap).find(k => dot.includes(k));
    document.getElementById('syncStatusText').textContent = statusMap[s] || 'Connecting…';
  }
}

function openSyncModal()  { renderSyncModal(); document.getElementById('syncModal').classList.remove('hidden'); }
function closeSyncModal() { document.getElementById('syncModal').classList.add('hidden'); }

function activateSync(key) {
  syncKey = key;
  saveSyncKey(key);
  startSyncListener();
  pushToCloud();
  renderSyncModal();
}

function deactivateSync() {
  stopSyncListener();
  syncKey = null;
  clearSyncKey();
  renderSyncModal();
  showToast('Sync disconnected.');
}

function handleGenerateKey() {
  activateSync(generateSyncKey());
  showToast('Sync key generated. Syncing…');
  closeSyncModal();
}

function handleUseSyncKey() {
  const input = document.getElementById('syncKeyInput');
  const raw   = input.value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw)) {
    showToast('Invalid key format — paste the full UUID.');
    return;
  }
  input.value = '';
  activateSync(raw);
  showToast('Sync key accepted. Pulling data…');
  closeSyncModal();
}

function handleCopyKey() {
  if (!syncKey) return;
  navigator.clipboard.writeText(syncKey)
    .then(() => showToast('Sync key copied.'))
    .catch(() => showToast('Copy failed — select key manually.'));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

function init() {
  transactions     = loadTransactions();
  customCategories = loadCustomCategories();
  loadRates();
  baseCurrency = localStorage.getItem(BASE_CURR_KEY) || 'USD';

  // Set default date to today
  document.getElementById('date').value = todayISO();

  // Initialise type & currency
  setType('expense');
  setCurrency('USD');

  // Month nav
  document.getElementById('btnPrevMonth').addEventListener('click', prevMonth);
  document.getElementById('btnNextMonth').addEventListener('click', nextMonth);

  // Type toggle
  document.getElementById('typeIncome').addEventListener('click',  () => setType('income'));
  document.getElementById('typeExpense').addEventListener('click', () => setType('expense'));

  // Form
  document.getElementById('transactionForm').addEventListener('submit', handleFormSubmit);

  // Delete via event delegation
  document.getElementById('transactionList').addEventListener('click', e => {
    const btn = e.target.closest('.tx-delete');
    if (btn) { openDeleteModal(btn.dataset.id); return; }
    const item = e.target.closest('.tx-item');
    if (item) toggleTxExpand(item);
  });

  // Modal
  document.getElementById('modalCancel').addEventListener('click',  closeDeleteModal);
  document.getElementById('modalConfirm').addEventListener('click', confirmDelete);
  document.getElementById('deleteModal').addEventListener('click', e => {
    if (e.target === document.getElementById('deleteModal')) closeDeleteModal();
  });

  // Keyboard: Escape closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDeleteModal(); closeCatModal(); closeSyncModal(); }
  });

  // Export / Import
  document.getElementById('btnExport').addEventListener('click',     exportData);
  document.getElementById('btnOpenImport').addEventListener('click', triggerImport);
  document.getElementById('importFileInput').addEventListener('change', handleImport);

  // Chart mode toggle
  document.getElementById('chartModeExpense').addEventListener('click', () => setChartMode('expense'));
  document.getElementById('chartModeIncome').addEventListener('click',  () => setChartMode('income'));

  // Re-render chart when OS theme changes so tooltip/border colors update
  darkMQ.addEventListener('change', renderChart);

  // Currency toggle (transaction form)
  document.querySelectorAll('.curr-btn').forEach(btn =>
    btn.addEventListener('click', () => setCurrency(btn.dataset.currency))
  );

  // Base currency toggle (summary)
  document.getElementById('baseCurrBtn').addEventListener('click', () => {
    const order = ['USD', 'PYG', 'ARS'];
    setBaseCurrency(order[(order.indexOf(baseCurrency) + 1) % order.length]);
  });

  // Refresh rates button
  document.getElementById('btnRefreshRates').addEventListener('click', fetchRates);

  // Fetch live rates on load (async – uses cached rates until it returns)
  renderRatesBar();
  fetchRates();

  // Category management modal
  document.getElementById('btnManageCats').addEventListener('click', openCatModal);
  document.getElementById('catModalClose').addEventListener('click', closeCatModal);
  document.getElementById('catModal').addEventListener('click', e => {
    if (e.target === document.getElementById('catModal')) closeCatModal();
  });
  document.getElementById('catTabExpense').addEventListener('click', () => setCatTab('expense'));
  document.getElementById('catTabIncome').addEventListener('click',  () => setCatTab('income'));
  document.getElementById('btnAddCat').addEventListener('click', handleAddCategory);
  document.getElementById('newCatName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); }
  });
  document.getElementById('catList').addEventListener('click', e => {
    const btn = e.target.closest('.cat-del-btn');
    if (btn) handleDeleteCategory(btn.dataset.id, btn.dataset.type);
  });
  document.getElementById('iconPicker').addEventListener('click', e => {
    const btn = e.target.closest('.icon-option');
    if (!btn) return;
    selectedIcon = btn.dataset.icon;
    document.querySelectorAll('#iconPicker .icon-option').forEach(b =>
      b.classList.toggle('selected', b.dataset.icon === selectedIcon)
    );
  });

  // Filters
  document.getElementById('filterCategory').addEventListener('change', renderTransactions);
  document.getElementById('filterType').addEventListener('change', () => {
    renderCategoryFilters();
    renderTransactions();
  });

  renderAll();

  // Sync modal
  document.getElementById('btnSync').addEventListener('click', openSyncModal);
  document.getElementById('syncModalClose').addEventListener('click', closeSyncModal);
  document.getElementById('syncModal').addEventListener('click', e => {
    if (e.target === document.getElementById('syncModal')) closeSyncModal();
  });
  document.getElementById('btnGenerateKey').addEventListener('click', handleGenerateKey);
  document.getElementById('btnUseSyncKey').addEventListener('click', handleUseSyncKey);
  document.getElementById('btnCopyKey').addEventListener('click', handleCopyKey);
  document.getElementById('btnDisconnect').addEventListener('click', deactivateSync);
  document.getElementById('syncKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleUseSyncKey(); }
  });

  // Bootstrap sync if key was saved in a previous session
  syncKey = loadSyncKey();
  if (syncKey && FIREBASE_DB_URL) startSyncListener();
}

document.addEventListener('DOMContentLoaded', init);
