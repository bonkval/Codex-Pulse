const $ = (id) => document.getElementById(id);
const refreshButton = $('refresh-button');
const themeButton = $('theme-button');
let loading = false;

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  localStorage.setItem('codex-pulse-theme', isDark ? 'dark' : 'light');
  const nextMode = isDark ? 'light' : 'dark';
  themeButton.setAttribute('aria-label', `Switch to ${nextMode} mode`);
  themeButton.setAttribute('title', `Switch to ${nextMode} mode`);
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function formatReset(timestamp) {
  if (!timestamp) return 'reset time n/a';
  const minutes = Math.max(0, Math.round((timestamp * 1000 - Date.now()) / 60000));
  if (minutes < 1) return 'resets now';
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatWindow(window) {
  if (!window?.windowDurationMins) return 'rolling limit';
  const hours = window.windowDurationMins / 60;
  if (hours >= 24) return `${Math.round(hours / 24)} day rolling limit`;
  return `${Math.round(hours)} hour rolling limit`;
}

function setRow(prefix, window) {
  const percent = clamp(window?.usedPercent);
  $(`${prefix}-percent`).textContent = `${Math.round(percent)}%`;
  $(`${prefix}-fill`).style.width = `${Math.max(percent, 2)}%`;
  $(`${prefix}-detail`).textContent = formatWindow(window);
  $(`${prefix}-reset`).textContent = formatReset(window?.resetsAt);
}

function renderUsage(data) {
  document.body.classList.remove('loading', 'error-state');
  const dot = document.querySelector('.status-dot');
  if (!data?.ok) {
    document.body.classList.add('error-state');
    dot.classList.add('error');
    $('connection-label').textContent = 'Codex unavailable';
    $('updated-label').textContent = data?.error || 'Could not read usage';
    $('primary-percent').textContent = '—';
    $('secondary-percent').textContent = '—';
    $('primary-detail').textContent = 'Start Codex to sync usage';
    $('secondary-detail').textContent = 'Check your Codex login';
    $('primary-reset').textContent = '—';
    $('secondary-reset').textContent = '—';
    return;
  }
  dot.classList.remove('error');
  $('connection-label').textContent = data.planType ? `${data.planType} plan · live` : 'Live from Codex';
  setRow('primary', data.primary);
  setRow('secondary', data.secondary);
  $('updated-label').textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

async function refresh() {
  if (loading) return;
  loading = true;
  refreshButton.classList.add('is-loading');
  if (!$('primary-percent').textContent || $('primary-percent').textContent === '—') document.body.classList.add('loading');
  try {
    renderUsage(await window.codexPulse.readUsage());
  } finally {
    loading = false;
    refreshButton.classList.remove('is-loading');
  }
}

refreshButton.addEventListener('click', refresh);
themeButton.addEventListener('click', () => applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
$('close-button').addEventListener('click', () => window.codexPulse.hide());
$('codex-button').addEventListener('click', () => window.codexPulse.openCodex());
window.codexPulse.onRefresh(refresh);
applyTheme(localStorage.getItem('codex-pulse-theme') || 'light');
refresh();
