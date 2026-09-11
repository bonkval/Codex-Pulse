const $ = (id) => document.getElementById(id);
const refreshButton = $('refresh-button');
const themeButton = $('theme-button');
const settingsButton = $('settings-button');
const settingsBack = $('settings-back');
const settingsPanel = $('settings-panel');
const retryButton = $('retry-button');
const minimizeButton = $('minimize-button');
const miniView = $('mini-view');
const card = document.querySelector('.card');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const { remainingPercent, levelFor, thresholdFor } = window.codexPulseUsage;

let loading = false;
let dragState = null;
let currentUsage = null;
let lastSuccessfulSync = null;
let settings = {
  launchAtStartup: true,
  refreshInterval: 30,
  codexPath: '',
  theme: 'system',
  notificationsEnabled: true,
  quietMode: false,
};
const notificationLevels = { primary: null, secondary: null };

function effectiveTheme(theme) {
  return theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
}

function applyTheme(theme) {
  settings.theme = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
  const activeTheme = effectiveTheme(settings.theme);
  document.body.dataset.theme = activeTheme;
  themeMeta.setAttribute('content', activeTheme === 'dark' ? '#171819' : '#e9e8e5');
  const nextMode = activeTheme === 'dark' ? 'light' : 'dark';
  themeButton.setAttribute('aria-label', 'Switch to ' + nextMode + ' mode');
  themeButton.setAttribute('title', 'Switch to ' + nextMode + ' mode');
}

function formatReset(timestamp) {
  if (!timestamp) return 'reset time n/a';
  const minutes = Math.max(0, Math.round((timestamp * 1000 - Date.now()) / 60000));
  if (minutes < 1) return 'resets now';
  if (minutes < 60) return 'resets in ' + minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'resets in ' + hours + 'h ' + (minutes % 60) + 'm';
  return 'resets in ' + Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
}

function formatWindow(window) {
  if (!(window && window.windowDurationMins)) return 'rolling limit';
  const hours = window.windowDurationMins / 60;
  if (hours >= 24) return Math.round(hours / 24) + ' day rolling limit';
  return Math.round(hours) + ' hour rolling limit';
}

function setRow(prefix, window) {
  const row = document.querySelector('[data-window="' + prefix + '"]');
  const percent = remainingPercent(window);
  row.dataset.level = levelFor(percent);
  $(prefix + '-percent').textContent = percent === null ? '—' : Math.round(percent) + '%';
  $(prefix + '-fill').style.width = percent === null || percent === 0 ? '0%' : Math.max(percent, 2) + '%';
  $(prefix + '-detail').textContent = percent === null ? 'Usage unavailable' : formatWindow(window);
  $(prefix + '-reset').textContent = percent === null ? '—' : formatReset(window && window.resetsAt);
}

function refreshResetLabels() {
  if (!currentUsage || document.body.classList.contains('error-state')) return;
  $('primary-reset').textContent = formatReset(currentUsage.primary && currentUsage.primary.resetsAt);
  $('secondary-reset').textContent = formatReset(currentUsage.secondary && currentUsage.secondary.resetsAt);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function checkNotifications(data) {
  const values = {
    primary: remainingPercent(data.primary),
    secondary: remainingPercent(data.secondary),
  };
  const crossed = Object.entries(values).some(([prefix, percent]) => {
    const nextLevel = thresholdFor(percent);
    const previousLevel = notificationLevels[prefix];
    notificationLevels[prefix] = nextLevel;
    return nextLevel !== null && (previousLevel === null || previousLevel === undefined || nextLevel < previousLevel);
  });
  if (crossed && settings.notificationsEnabled) window.codexPulse.showNotification(values);
}

function renderUsage(data) {
  document.body.classList.remove('loading', 'error-state');
  const dot = document.querySelector('.status-dot');
  if (!data || !data.ok) {
    document.body.classList.add('error-state');
    dot.classList.add('error');
    $('connection-label').textContent = 'Codex unavailable';
    $('updated-label').textContent = lastSuccessfulSync ? 'Last synced ' + formatTime(lastSuccessfulSync) : 'Waiting for Codex';
    $('primary-percent').textContent = '—';
    $('secondary-percent').textContent = '—';
    $('primary-detail').textContent = 'Sign in to Codex, then retry';
    $('secondary-detail').textContent = 'Choose the executable in Settings';
    $('primary-reset').textContent = '—';
    $('secondary-reset').textContent = '—';
    retryButton.hidden = false;
    return;
  }
  dot.classList.remove('error');
  retryButton.hidden = true;
  currentUsage = data;
  lastSuccessfulSync = data.updatedAt;
  $('connection-label').textContent = data.planType ? data.planType + ' plan · live' : 'Live from Codex';
  setRow('primary', data.primary);
  setRow('secondary', data.secondary);
  $('updated-label').textContent = 'Updated ' + formatTime(data.updatedAt);
  refreshResetLabels();
  window.codexPulse.updateTray({
    primary: remainingPercent(data.primary),
    secondary: remainingPercent(data.secondary),
  });
  checkNotifications(data);
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

function updateSettingsPanel(next) {
  settings = { ...settings, ...next };
  applyTheme(settings.theme);
  $('theme-select').value = settings.theme;
  $('refresh-select').value = String(settings.refreshInterval);
  $('startup-toggle').checked = settings.launchAtStartup;
  $('notifications-toggle').checked = settings.notificationsEnabled;
  $('quiet-toggle').checked = settings.quietMode;
  $('codex-path-label').textContent = settings.codexPath || 'Automatically detected';
}

async function saveSetting(patch) {
  updateSettingsPanel(await window.codexPulse.updateSettings(patch));
}

async function openSettings() {
  updateSettingsPanel(await window.codexPulse.getSettings());
  settingsPanel.hidden = false;
  settingsButton.setAttribute('aria-expanded', 'true');
  settingsBack.focus({ preventScroll: true });
}

function closeSettings() {
  settingsPanel.hidden = true;
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.focus({ preventScroll: true });
}

function renderUpdateState(state) {
  const updateButton = $('update-button');
  const updateStatus = $('update-status');
  if (state.status === 'available') {
    updateStatus.textContent = 'Version ' + state.version + ' is available';
    updateButton.textContent = 'Download';
    updateButton.hidden = false;
    updateButton.dataset.action = 'download';
  } else if (state.status === 'downloaded') {
    updateStatus.textContent = 'Update ready to install';
    updateButton.textContent = 'Restart';
    updateButton.hidden = false;
    updateButton.dataset.action = 'install';
  } else if (state.status === 'checking') {
    updateStatus.textContent = 'Checking for updates…';
    updateButton.hidden = true;
  } else if (state.status === 'error') {
    updateStatus.textContent = 'Update check unavailable';
    updateButton.textContent = 'Retry';
    updateButton.hidden = false;
    updateButton.dataset.action = 'check';
  } else {
    updateStatus.textContent = 'Codex Pulse is up to date';
    updateButton.hidden = true;
  }
}

refreshButton.addEventListener('click', refresh);
retryButton.addEventListener('click', refresh);
themeButton.addEventListener('click', () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  saveSetting({ theme: next });
});
settingsButton.addEventListener('click', openSettings);
settingsBack.addEventListener('click', closeSettings);
$('theme-select').addEventListener('change', (event) => saveSetting({ theme: event.target.value }));
$('refresh-select').addEventListener('change', (event) => saveSetting({ refreshInterval: Number(event.target.value) }));
$('startup-toggle').addEventListener('change', (event) => saveSetting({ launchAtStartup: event.target.checked }));
$('notifications-toggle').addEventListener('change', (event) => saveSetting({ notificationsEnabled: event.target.checked }));
$('quiet-toggle').addEventListener('change', (event) => saveSetting({ quietMode: event.target.checked }));
$('choose-codex-button').addEventListener('click', async () => {
  updateSettingsPanel(await window.codexPulse.chooseCodex());
  refresh();
});
$('reset-position-button').addEventListener('click', () => window.codexPulse.resetPosition());
$('update-button').addEventListener('click', async () => {
  const action = $('update-button').dataset.action;
  if (action === 'download') await window.codexPulse.downloadUpdate();
  else if (action === 'install') await window.codexPulse.installUpdate();
  else await window.codexPulse.checkForUpdates();
});
$('close-button').addEventListener('click', () => window.codexPulse.hide());
$('codex-button').addEventListener('click', () => window.codexPulse.openCodex());
miniView.addEventListener('click', () => window.codexPulse.setView(false));
window.codexPulse.onRefresh(refresh);
window.codexPulse.onSettingsOpen(openSettings);
window.codexPulse.onUpdate(renderUpdateState);

systemTheme.addEventListener?.('change', () => {
  if (settings.theme === 'system') applyTheme('system');
});

card.addEventListener('pointerdown', (event) => {
  const interactive = event.target.closest('button, a, input, select');
  if (event.button !== 0 || (interactive && !event.target.closest('#mini-view'))) return;
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
  dragState = null;
  card.classList.remove('is-dragging');
  if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
});

card.addEventListener('pointercancel', () => {
  dragState = null;
  card.classList.remove('is-dragging');
});

window.codexPulse.onViewChange((view) => {
  document.body.dataset.view = view;
  minimizeButton.setAttribute('aria-label', view === 'mini' ? 'Restore Codex Pulse' : 'Minimize to floating logo');
});

(async () => {
  updateSettingsPanel(await window.codexPulse.getSettings());
  renderUpdateState({ status: 'checking' });
  await window.codexPulse.checkForUpdates();
  refresh();
})();
setInterval(refreshResetLabels, 60 * 1000);
