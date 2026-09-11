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
const dash = '\u2014';

let loading = false;
let dragState = null;
let currentUsage = null;
let lastSuccessfulSync = null;
let selectedHistoryRange = 7;
let lastTodayTokens = null;
let previousResetTimes = { primary: null, secondary: null };
let petTypingTimer = null;
let petTypingTarget = '';
let suppressMiniClick = false;
let settings = { launchAtStartup: true, refreshInterval: 30, codexPath: '', theme: 'system', notificationsEnabled: true, quietMode: false, dailyTokenTarget: 0 };
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
  themeButton.setAttribute('aria-label', `Switch to ${nextMode} mode`);
  themeButton.setAttribute('title', `Switch to ${nextMode} mode`);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTokens(value) {
  const number = numeric(value);
  if (number === null) return dash;
  if (Math.abs(number) >= 1000000) return (number / 1000000).toFixed(number >= 10000000 ? 0 : 1) + 'M';
  if (Math.abs(number) >= 1000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1) + 'K';
  return Math.round(number).toLocaleString();
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

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(date, range) {
  const parsed = new Date(`${date}T12:00:00`);
  return range === 7 ? parsed.toLocaleDateString([], { weekday: 'short' }).slice(0, 2) : parsed.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function getDailyHistory(data) {
  const byDate = new Map();
  for (const entry of data.localHistory || []) if (entry && entry.date) byDate.set(entry.date, numeric(entry.tokens) || 0);
  for (const entry of data.dailyUsageBuckets || []) if (entry && entry.startDate) byDate.set(entry.startDate, numeric(entry.tokens) || 0);
  return [...byDate.entries()].map(([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date));
}

function todayTokensFrom(data, history) {
  const today = history.find((entry) => entry.date === localDateString());
  return today ? today.tokens : null;
}

function renderHistory(data) {
  const chart = $('history-chart');
  const history = getDailyHistory(data);
  const today = new Date();
  const entries = [];
  for (let offset = selectedHistoryRange - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setHours(12, 0, 0, 0);
    date.setDate(today.getDate() - offset);
    const key = localDateString(date);
    entries.push({ date: key, tokens: history.find((entry) => entry.date === key)?.tokens || 0 });
  }
  const max = Math.max(...entries.map((entry) => entry.tokens), 0);
  chart.replaceChildren();
  chart.setAttribute('aria-label', `${selectedHistoryRange}-day token usage history; maximum ${formatTokens(max)} tokens`);
  for (const [index, entry] of entries.entries()) {
    const column = document.createElement('div');
    column.className = 'history-column';
    const bar = document.createElement('div');
    bar.className = 'history-bar';
    bar.title = `${entry.date}: ${formatTokens(entry.tokens)} tokens`;
    const fill = document.createElement('div');
    fill.className = 'history-bar-fill';
    fill.style.setProperty('--bar-height', max && entry.tokens ? `${Math.max(5, entry.tokens / max * 100)}%` : '0%');
    const label = document.createElement('span');
    label.className = 'history-bar-label';
    label.textContent = selectedHistoryRange === 7 || index % 5 === 0 || index === entries.length - 1 ? dateLabel(entry.date, selectedHistoryRange) : '';
    bar.append(fill);
    column.append(bar, label);
    chart.append(column);
  }
  const nonZero = history.filter((entry) => entry.tokens > 0);
  const highest = nonZero.reduce((best, entry) => !best || entry.tokens > best.tokens ? entry : best, null);
  const rangeValues = entries.map((entry) => entry.tokens);
  const average = rangeValues.length ? rangeValues.reduce((sum, value) => sum + value, 0) / rangeValues.length : 0;
  $('highest-day').textContent = 'Highest day: ' + (highest ? `${dateLabel(highest.date, selectedHistoryRange)} (${formatTokens(highest.tokens)})` : dash);
  $('average-day').textContent = 'Average: ' + (average ? formatTokens(average) : dash);
}

function renderTokenActivity(data) {
  const history = getDailyHistory(data);
  const today = todayTokensFrom(data, history);
  const sevenDay = history.filter((entry) => entry.date >= localDateString(new Date(Date.now() - 6 * 86400000))).reduce((sum, entry) => sum + entry.tokens, 0);
  const activity = data.tokenActivity || {};
  $('today-tokens').textContent = formatTokens(today);
  $('seven-day-tokens').textContent = formatTokens(sevenDay);
  $('lifetime-tokens').textContent = formatTokens(activity.lifetimeTokens);
  $('peak-daily-tokens').textContent = formatTokens(activity.peakDailyTokens);
  $('current-streak').textContent = numeric(activity.currentStreakDays) === null ? dash : `${Math.round(activity.currentStreakDays)}d`;
  $('token-range-label').textContent = data.dailyUsageBuckets ? 'Synced from Codex' : 'Local history';
  renderHistory(data);
  return today;
}

function tokenField(source, names) {
  for (const name of names) {
    const value = numeric(source?.[name]);
    if (value !== null) return value;
  }
  return null;
}

function renderLiveSession(data) {
  const source = data.liveSession?.usage || data.liveSession?.tokenUsage || data.liveSession || null;
  const total = tokenField(source, ['totalTokens', 'total', 'tokens']);
  const input = tokenField(source, ['inputTokens', 'input']);
  const output = tokenField(source, ['outputTokens', 'output']);
  const reasoning = tokenField(source, ['reasoningTokens', 'reasoning']);
  $('session-total').textContent = formatTokens(total === null && input !== null && output !== null ? input + output : total);
  $('session-input').textContent = formatTokens(input);
  $('session-output').textContent = formatTokens(output);
  $('session-reasoning').textContent = formatTokens(reasoning);
  $('session-status').textContent = source ? 'Live thread updates' : 'Waiting for an active thread';
}

function formatEstimate(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + 'm';
  if (hours < 24) return Math.round(hours * 10) / 10 + 'h';
  return Math.round(hours / 24 * 10) / 10 + 'd';
}

function renderForecast(data) {
  const snapshots = (data.snapshots || []).filter((entry) => Number.isFinite(Number(entry.timestamp))).sort((a, b) => a.timestamp - b.timestamp);
  const current = snapshots[snapshots.length - 1];
  const previous = snapshots.slice(0, -1).reverse().find((entry) => entry.primaryUsed !== null || entry.secondaryUsed !== null);
  const estimates = [];
  for (const [label, key] of [['5-hour', 'primaryUsed'], ['Weekly', 'secondaryUsed']]) {
    const used = numeric(current?.[key]);
    const old = numeric(previous?.[key]);
    const hours = previous && current && old !== null && used !== null && used > old
      ? (100 - used) / ((used - old) / ((current.timestamp - previous.timestamp) / 3600000))
      : null;
    const estimate = formatEstimate(hours);
    if (estimate) estimates.push(`${label}: ~${estimate} remaining`);
  }
  $('forecast-text').textContent = estimates.length
    ? estimates.join(' · ') + ' at the recent rate. This is an estimate, not a guaranteed reset time.'
    : 'Waiting for another sync. The forecast compares how quickly your usage rises with what remains, then estimates when the window could run out.';
}

function renderPet(activity) {
  const pet = activity || { state: 'idle', text: 'Waiting for Codex' };
  const enabled = settings.petEnabled !== false;
  const visible = enabled && pet.state !== 'idle';
  const bubble = $('pet-bubble');
  const badge = $('pet-badge');
  bubble.hidden = !visible;
  badge.hidden = !(visible && pet.state === 'done');
  document.body.dataset.petState = pet.state || 'idle';
  if (visible && pet.text !== petTypingTarget) {
    clearTimeout(petTypingTimer);
    petTypingTarget = pet.text || 'Codex is working...';
    $('pet-message').textContent = '';
    let index = 0;
    const typeNext = () => {
      $('pet-message').textContent = petTypingTarget.slice(0, index);
      index += 1;
      if (index <= petTypingTarget.length) petTypingTimer = setTimeout(typeNext, pet.state === 'working' ? 24 : 12);
    };
    typeNext();
  }
  if (!visible) {
    clearTimeout(petTypingTimer);
    petTypingTarget = '';
    $('pet-message').textContent = '';
  }
  window.codexPulse.setPetExpanded(visible).then((expanded) => { document.body.dataset.petExpanded = expanded ? 'true' : 'false'; });
}

function renderAccount(data) {
  const account = data.account || {};
  $('account-plan').textContent = data.planType || account.planType || dash;
  $('account-status').textContent = data.ok ? (account.type ? 'Connected' : 'Live') : 'Unavailable';
  $('account-health').textContent = data.ok ? 'Healthy' : 'Offline';
  $('account-sync').textContent = data.updatedAt ? formatTime(data.updatedAt) : dash;
  $('reset-credits').textContent = data.resetCredits && numeric(data.resetCredits.availableCount) !== null ? String(Math.round(data.resetCredits.availableCount)) : dash;
}

function clearDashboard() {
  for (const id of ['today-tokens', 'seven-day-tokens', 'lifetime-tokens', 'peak-daily-tokens', 'current-streak', 'session-total', 'session-input', 'session-output', 'session-reasoning', 'account-plan', 'account-status', 'account-sync', 'reset-credits']) $(id).textContent = dash;
  $('session-status').textContent = 'Waiting for Codex';
  $('account-health').textContent = 'Offline';
  $('forecast-text').textContent = 'Connect to Codex to estimate your usage pace.';
  renderHistory({ localHistory: [] });
}

function setRow(prefix, window) {
  const row = document.querySelector(`[data-window="${prefix}"]`);
  const percent = remainingPercent(window);
  row.dataset.level = levelFor(percent);
  $(`${prefix}-percent`).textContent = percent === null ? dash : Math.round(percent) + '%';
  $(`${prefix}-fill`).style.width = percent === null || percent === 0 ? '0%' : Math.max(percent, 2) + '%';
  $(`${prefix}-detail`).textContent = percent === null ? 'Usage unavailable' : formatWindow(window);
  $(`${prefix}-reset`).textContent = percent === null ? dash : formatReset(window && window.resetsAt);
}

function refreshResetLabels() {
  if (!currentUsage || document.body.classList.contains('error-state')) return;
  $('primary-reset').textContent = formatReset(currentUsage.primary && currentUsage.primary.resetsAt);
  $('secondary-reset').textContent = formatReset(currentUsage.secondary && currentUsage.secondary.resetsAt);
}

function checkNotifications(data, today) {
  const values = { primary: remainingPercent(data.primary), secondary: remainingPercent(data.secondary) };
  const crossed = Object.entries(values).some(([prefix, percent]) => {
    const nextLevel = thresholdFor(percent);
    const previousLevel = notificationLevels[prefix];
    notificationLevels[prefix] = nextLevel;
    return nextLevel !== null && (previousLevel !== null && previousLevel !== undefined) && nextLevel < previousLevel;
  });
  if (crossed && settings.notificationsEnabled) window.codexPulse.showNotification(values);
  for (const [prefix, value] of Object.entries(data)) {
    if (!['primary', 'secondary'].includes(prefix)) continue;
    const reset = numeric(value?.resetsAt);
    const oldReset = previousResetTimes[prefix];
    if (settings.notificationsEnabled && reset && oldReset && reset !== oldReset && reset * 1000 <= Date.now() + 120000) window.codexPulse.showNotification({ kind: 'rate-reset', label: prefix === 'primary' ? '5-hour window' : 'Weekly window' });
    previousResetTimes[prefix] = reset;
  }
  const target = numeric(settings.dailyTokenTarget);
  if (target && today !== null && (lastTodayTokens === null || lastTodayTokens < target) && today >= target && settings.notificationsEnabled) window.codexPulse.showNotification({ kind: 'token-target', target });
  if (today !== null) lastTodayTokens = today;
}

function renderUsage(data) {
  if (!data || !data.ok) {
    document.body.classList.add('error-state');
    document.querySelector('.status-dot').classList.add('error');
    $('connection-label').textContent = 'Codex unavailable';
    $('updated-label').textContent = lastSuccessfulSync ? 'Last synced ' + formatTime(lastSuccessfulSync) : 'Waiting for Codex';
    setRow('primary', null);
    setRow('secondary', null);
    retryButton.hidden = false;
    clearDashboard();
    return;
  }
  document.body.classList.remove('loading', 'error-state');
  document.querySelector('.status-dot').classList.remove('error');
  retryButton.hidden = true;
  currentUsage = data;
  lastSuccessfulSync = data.updatedAt;
  $('connection-label').textContent = data.planType ? `${data.planType} plan · live` : 'Live from Codex';
  setRow('primary', data.primary);
  setRow('secondary', data.secondary);
  const today = renderTokenActivity(data);
  renderLiveSession(data);
  renderForecast(data);
  renderAccount(data);
  $('updated-label').textContent = 'Updated ' + formatTime(data.updatedAt);
  renderPet(data.activity);
  refreshResetLabels();
  window.codexPulse.updateTray({ primary: remainingPercent(data.primary), secondary: remainingPercent(data.secondary), todayTokens: today });
  checkNotifications(data, today);
}

async function refresh() {
  if (loading) return;
  loading = true;
  refreshButton.classList.add('is-loading');
  if (!$('primary-percent').textContent || $('primary-percent').textContent === dash) document.body.classList.add('loading');
  try { renderUsage(await window.codexPulse.readUsage()); }
  finally { loading = false; refreshButton.classList.remove('is-loading'); }
}

function updateSettingsPanel(next) {
  settings = { ...settings, ...next };
  applyTheme(settings.theme);
  $('theme-select').value = settings.theme;
  $('refresh-select').value = String(settings.refreshInterval);
  $('startup-toggle').checked = settings.launchAtStartup;
  $('notifications-toggle').checked = settings.notificationsEnabled;
  $('quiet-toggle').checked = settings.quietMode;
  $('pet-toggle').checked = settings.petEnabled !== false;
  $('daily-target-input').value = settings.dailyTokenTarget || '';
  $('codex-path-label').textContent = settings.codexPath || 'Automatically detected';
}

async function saveSetting(patch) { updateSettingsPanel(await window.codexPulse.updateSettings(patch)); }
async function openSettings() { updateSettingsPanel(await window.codexPulse.getSettings()); settingsPanel.hidden = false; settingsButton.setAttribute('aria-expanded', 'true'); settingsBack.focus({ preventScroll: true }); }
function closeSettings() { settingsPanel.hidden = true; settingsButton.setAttribute('aria-expanded', 'false'); settingsButton.focus({ preventScroll: true }); }

function renderUpdateState(state) {
  const updateButton = $('update-button');
  if (state.status === 'available') { $('update-status').textContent = 'Version ' + state.version + ' is available'; updateButton.textContent = 'Download'; updateButton.hidden = false; updateButton.dataset.action = 'download'; updateButton.title = 'Download the available update'; }
  else if (state.status === 'downloaded') { $('update-status').textContent = 'Update ready to install'; updateButton.textContent = 'Restart'; updateButton.hidden = false; updateButton.dataset.action = 'install'; updateButton.title = 'Restart and install the update'; }
  else if (state.status === 'checking') { $('update-status').textContent = 'Checking for updates...'; updateButton.hidden = true; }
  else if (state.status === 'error') { $('update-status').textContent = 'Update check unavailable'; updateButton.textContent = 'Retry'; updateButton.hidden = false; updateButton.dataset.action = 'check'; updateButton.title = 'Retry the update check'; }
  else { $('update-status').textContent = 'Codex Pulse is up to date'; updateButton.hidden = true; }
}

refreshButton.addEventListener('click', refresh);
retryButton.addEventListener('click', refresh);
minimizeButton.addEventListener('click', () => window.codexPulse.setView(true));
themeButton.addEventListener('click', () => saveSetting({ theme: document.body.dataset.theme === 'dark' ? 'light' : 'dark' }));
settingsButton.addEventListener('click', openSettings);
settingsBack.addEventListener('click', closeSettings);
$('theme-select').addEventListener('change', (event) => saveSetting({ theme: event.target.value }));
$('refresh-select').addEventListener('change', (event) => saveSetting({ refreshInterval: Number(event.target.value) }));
$('startup-toggle').addEventListener('change', (event) => saveSetting({ launchAtStartup: event.target.checked }));
$('notifications-toggle').addEventListener('change', (event) => saveSetting({ notificationsEnabled: event.target.checked }));
$('quiet-toggle').addEventListener('change', (event) => saveSetting({ quietMode: event.target.checked }));
$('pet-toggle').addEventListener('change', (event) => saveSetting({ petEnabled: event.target.checked }));
$('daily-target-input').addEventListener('change', (event) => saveSetting({ dailyTokenTarget: event.target.value }));
$('choose-codex-button').addEventListener('click', async () => { updateSettingsPanel(await window.codexPulse.chooseCodex()); refresh(); });
$('reset-position-button').addEventListener('click', () => window.codexPulse.resetPosition());
$('history-seven-button').addEventListener('click', () => { selectedHistoryRange = 7; $('history-seven-button').classList.add('active'); $('history-thirty-button').classList.remove('active'); if (currentUsage) renderHistory(currentUsage); });
$('history-thirty-button').addEventListener('click', () => { selectedHistoryRange = 30; $('history-thirty-button').classList.add('active'); $('history-seven-button').classList.remove('active'); if (currentUsage) renderHistory(currentUsage); });
$('export-button').addEventListener('click', () => window.codexPulse.exportHistory('json'));
$('export-json-button').addEventListener('click', () => window.codexPulse.exportHistory('json'));
$('export-csv-button').addEventListener('click', () => window.codexPulse.exportHistory('csv'));
$('update-button').addEventListener('click', async () => { const action = $('update-button').dataset.action; if (action === 'download') await window.codexPulse.downloadUpdate(); else if (action === 'install') await window.codexPulse.installUpdate(); else await window.codexPulse.checkForUpdates(); });
$('close-button').addEventListener('click', () => window.codexPulse.hide());
$('codex-button').addEventListener('click', () => window.codexPulse.openCodex());
miniView.addEventListener('click', () => { if (suppressMiniClick) { suppressMiniClick = false; return; } window.codexPulse.clearPet(); window.codexPulse.setView(false); });
window.codexPulse.onRefresh(refresh);
window.codexPulse.onSettingsOpen(openSettings);
window.codexPulse.onUpdate(renderUpdateState);
window.codexPulse.onPetActivity(renderPet);
window.codexPulse.onPetExpanded((expanded) => { document.body.dataset.petExpanded = expanded ? 'true' : 'false'; });
systemTheme.addEventListener?.('change', () => { if (settings.theme === 'system') applyTheme('system'); });

card.addEventListener('pointerdown', (event) => {
  const interactive = event.target.closest('button, a, input, select');
  const scrollable = event.target.closest('.dashboard-scroll, .settings-scroll');
  const header = event.target.closest('.topbar, .settings-header');
  if (event.button !== 0 || event.target.closest('#mini-view') || (interactive && !event.target.closest('#mini-view')) || (scrollable && !header)) return;
  dragState = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, startX: event.screenX, startY: event.screenY };
  card.classList.add('is-dragging');
  card.setPointerCapture(event.pointerId);
});
card.addEventListener('pointermove', (event) => { if (!dragState || event.pointerId !== dragState.pointerId) return; const dx = event.screenX - dragState.x; const dy = event.screenY - dragState.y; dragState.x = event.screenX; dragState.y = event.screenY; window.codexPulse.moveBy(dx, dy); });
card.addEventListener('pointerup', (event) => { if (!dragState || event.pointerId !== dragState.pointerId) return; dragState = null; card.classList.remove('is-dragging'); if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId); });
card.addEventListener('pointercancel', () => { dragState = null; card.classList.remove('is-dragging'); });

miniView.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  suppressMiniClick = false;
  dragState = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, startX: event.screenX, startY: event.screenY };
  miniView.classList.add('is-dragging');
  miniView.setPointerCapture(event.pointerId);
});
miniView.addEventListener('pointermove', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.screenX - dragState.x;
  const dy = event.screenY - dragState.y;
  if (Math.abs(event.screenX - dragState.startX) > 4 || Math.abs(event.screenY - dragState.startY) > 4) suppressMiniClick = true;
  dragState.x = event.screenX;
  dragState.y = event.screenY;
  window.codexPulse.moveBy(dx, dy);
});
miniView.addEventListener('pointerup', (event) => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState = null;
  miniView.classList.remove('is-dragging');
  if (miniView.hasPointerCapture(event.pointerId)) miniView.releasePointerCapture(event.pointerId);
  if (suppressMiniClick) setTimeout(() => { suppressMiniClick = false; }, 100);
});
miniView.addEventListener('pointercancel', () => { dragState = null; miniView.classList.remove('is-dragging'); suppressMiniClick = false; });
window.codexPulse.onViewChange((view) => { document.body.dataset.view = view; minimizeButton.setAttribute('aria-label', view === 'mini' ? 'Restore the full Codex Pulse window' : 'Minimize to floating logo'); minimizeButton.setAttribute('title', view === 'mini' ? 'Restore the full Codex Pulse window' : 'Minimize to a floating logo'); });

(async () => { updateSettingsPanel(await window.codexPulse.getSettings()); renderUpdateState({ status: 'checking' }); await window.codexPulse.checkForUpdates(); await refresh(); })();
setInterval(refreshResetLabels, 60 * 1000);
