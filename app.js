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

const ALL_CATS = [...CATEGORIES.income, ...CATEGORIES.expense];

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
let pendingDeleteId = null;
let chartMode       = 'expense';
let chartInstance   = null;

// ─── Dark mode ────────────────────────────────────────────────────────────────

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const isDark  = () => darkMQ.matches;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
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

function getCatMeta(categoryId) {
  return ALL_CATS.find(c => c.id === categoryId) || { label: categoryId, icon: 'fa-circle' };
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
    if (t.type === 'income')  income  += t.amount;
    else                       expense += t.amount;
  });
  return { income, expense, balance: income - expense };
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function buildChartData(type) {
  const monthTx = transactionsForMonth(viewYear, viewMonth).filter(t => t.type === type);
  const totals  = {};
  monthTx.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
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

  const balEl = document.getElementById('totalBalance');
  balEl.textContent = formatCurrency(balance);
  balEl.className = 'summary-value ' + (balance >= 0 ? 'text-gray-900' : 'text-expense');

  document.getElementById('totalIncome').textContent   = formatCurrency(income);
  document.getElementById('totalExpenses').textContent = formatCurrency(expense);
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

function createTxElement(tx) {
  const meta = getCatMeta(tx.category);
  const div  = document.createElement('div');
  div.className = 'tx-item';
  div.dataset.id = tx.id;

  const sign = tx.type === 'income' ? '+' : '-';

  div.innerHTML = `
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
    <div class="tx-amount ${tx.type}">${sign}${formatCurrency(tx.amount)}</div>
    <button class="tx-delete" data-id="${tx.id}" aria-label="Delete transaction" title="Delete">
      <i class="fa-solid fa-xmark text-xs pointer-events-none"></i>
    </button>
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
  CATEGORIES[type].forEach(cat => {
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

  const tx = {
    id:        generateId(),
    type:      currentType,
    amount:    Math.round(amount * 100) / 100,
    category,
    date,
    note:      note.slice(0, 80),
    createdAt: Date.now(),
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

function init() {
  transactions = loadTransactions();

  // Set default date to today
  document.getElementById('date').value = todayISO();

  // Initialise type
  setType('income');

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
    if (btn) openDeleteModal(btn.dataset.id);
  });

  // Modal
  document.getElementById('modalCancel').addEventListener('click',  closeDeleteModal);
  document.getElementById('modalConfirm').addEventListener('click', confirmDelete);
  document.getElementById('deleteModal').addEventListener('click', e => {
    if (e.target === document.getElementById('deleteModal')) closeDeleteModal();
  });

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDeleteModal();
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

  // Filters
  document.getElementById('filterCategory').addEventListener('change', renderTransactions);
  document.getElementById('filterType').addEventListener('change', () => {
    renderCategoryFilters();
    renderTransactions();
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
