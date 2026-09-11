const $ = (id) => document.getElementById(id);
const refreshButton = $('refresh-button');
const themeButton = $('theme-button');
const minimizeButton = $('minimize-button');
const miniView = $('mini-view');
const card = document.querySelector('.card');
let loading = false;
let dragState = null;

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
  const percent = 100 - clamp(window?.usedPercent);
  $(`${prefix}-percent`).textContent = `${Math.round(percent)}%`;
  $(`${prefix}-fill`).style.width = `${percent === 0 ? 0 : Math.max(percent, 2)}%`;
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
minimizeButton.addEventListener('click', () => window.codexPulse.setView(true));
miniView.addEventListener('click', () => window.codexPulse.setView(false));
miniView.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    window.codexPulse.setView(false);
  }
});
$('close-button').addEventListener('click', () => window.codexPulse.hide());
$('codex-button').addEventListener('click', () => window.codexPulse.openCodex());
window.codexPulse.onRefresh(refresh);

card.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, a, input')) return;
  dragState = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  card.classList.add('is-dragging');
  card.setPointerCapture(event.pointerId);
});

card.addEventListener('pointermove', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.screenX - dragState.x;
  const dy = event.screenY - dragState.y;
  if (dx || dy) dragState.moved = true;
  dragState.x = event.screenX;
  dragState.y = event.screenY;
  window.codexPulse.moveBy(dx, dy);
});

card.addEventListener('pointerup', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const wasMiniClick = document.body.dataset.view === 'mini' && !dragState.moved;
  dragState = null;
  card.classList.remove('is-dragging');
  if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
  if (wasMiniClick) window.codexPulse.setView(false);
});

card.addEventListener('pointercancel', () => {
  dragState = null;
  card.classList.remove('is-dragging');
});

window.codexPulse.onViewChange((view) => {
  document.body.dataset.view = view;
  minimizeButton.setAttribute('aria-label', view === 'mini' ? 'Restore Codex Pulse' : 'Minimize to floating logo');
});
applyTheme(localStorage.getItem('codex-pulse-theme') || 'light');
refresh();
