const $ = (id) => document.getElementById(id);
const refreshButton = $('refresh-button');
const themeButton = $('theme-button');
const settingsButton = $('settings-button');
const settingsBack = $('settings-back');
const settingsPanel = $('settings-panel');
const retryButton = $('retry-button');
const minimizeButton = $('minimize-button');
const miniView = $('mini-view');
const historyChart = $('history-chart');
const historyTooltip = $('history-tooltip');
const historyTooltipDate = $('history-tooltip-date');
const historyTooltipValue = $('history-tooltip-value');
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
let currentPetActivity = { state: 'idle', text: 'Waiting for Codex' };
let activeHistoryBar = null;
let historyTooltipPinned = false;
let suppressMiniClick = false;
let settings = { launchAtStartup: true, refreshInterval: 30, codexPath: '', theme: 'system', notificationsEnabled: true, quietMode: false, taskbarMode: false, dailyTokenTarget: 0, globalShortcut: 'CommandOrControl+Shift+Alt+P', primaryAlertThresholds: [50, 25, 10], secondaryAlertThresholds: [50, 25, 10], alwaysOnTop: true, popupOpacity: 100, popupSize: 'normal', compactMode: false, startMinimized: false, monitoringPaused: false, historyRetentionDays: 90, rememberPerMonitor: false };
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

function formatDateTime(timestamp) {
  if (!timestamp) return dash;
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateLabel(date, range) {
  const parsed = new Date(`${date}T12:00:00`);
  return range === 7 ? parsed.toLocaleDateString([], { weekday: 'short' }).slice(0, 2) : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fullDateLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function hideHistoryTooltip(force = false) {
  if (!force && historyTooltipPinned) return;
  activeHistoryBar = null;
  historyTooltipPinned = false;
  historyTooltip.hidden = true;
}

function showHistoryTooltip(bar, entry, pinned = false) {
  const section = historyChart.closest('.history-section');
  const sectionRect = section.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const above = barRect.top - sectionRect.top > 58;
  historyTooltipDate.textContent = fullDateLabel(entry.date);
  historyTooltipValue.textContent = `${formatTokens(entry.tokens)} tokens`;
  historyTooltip.classList.toggle('below', !above);
  historyTooltip.style.left = `${barRect.left - sectionRect.left + barRect.width / 2}px`;
  historyTooltip.style.top = `${(above ? barRect.top : barRect.bottom) - sectionRect.top + (above ? -8 : 8)}px`;
  historyTooltipPinned = pinned;
  activeHistoryBar = bar;
  historyTooltip.hidden = false;
}

function getDailyHistory(data) {
  const byDate = new Map();
  for (const entry of data.localHistory || []) if (entry && entry.date) byDate.set(entry.date, numeric(entry.tokens) || 0);
  for (const entry of data.dailyUsageBuckets || []) if (entry && entry.startDate) byDate.set(entry.startDate, numeric(entry.tokens) || 0);
  if (data.liveDailyUsage?.date) {
    const liveTokens = numeric(data.liveDailyUsage.tokens);
    if (liveTokens !== null) byDate.set(data.liveDailyUsage.date, Math.max(byDate.get(data.liveDailyUsage.date) || 0, liveTokens));
  }
  return [...byDate.entries()].map(([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date));
}

function todayTokensFrom(data, history) {
  const today = history.find((entry) => entry.date === localDateString());
  return today ? today.tokens : null;
}

function renderAnalytics(data) {
  const analytics = data.analytics || {};
  const sessions = Array.isArray(analytics.sessions) ? analytics.sessions : [];
  const projects = Array.isArray(analytics.projects) ? analytics.projects : [];
  const models = Array.isArray(analytics.models) ? analytics.models : [];
  const recentCutoff = Date.now() - 7 * 86400000;
  const recentProjects = projects.map((project) => ({ ...project, totalTokens: sessions.filter((session) => session.project === project.name && session.startedAt >= recentCutoff).reduce((sum, session) => sum + Number(session.totalTokens || 0), 0) })).filter((project) => project.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5);
  const renderRank = (target, entries, valueLabel) => {
    target.replaceChildren();
    if (!entries.length) { const empty = document.createElement('span'); empty.className = 'empty-state'; empty.textContent = target.id === 'model-list' ? 'Model data will appear when Codex provides it.' : 'No project sessions found yet.'; target.append(empty); return; }
    for (const entry of entries) {
      const item = document.createElement('div'); item.className = 'rank-item';
      const main = document.createElement('div'); main.className = 'rank-item-main';
      const name = document.createElement('span'); name.className = 'rank-item-name'; name.textContent = entry.name;
      const meta = document.createElement('span'); meta.className = 'rank-item-meta'; meta.textContent = `${entry.sessions} session${entry.sessions === 1 ? '' : 's'}${entry.inputTokens !== undefined ? ` · in ${formatTokens(entry.inputTokens)} · out ${formatTokens(entry.outputTokens)} · reasoning ${formatTokens(entry.reasoningTokens)}` : ''}`;
      main.append(name, meta); const value = document.createElement('span'); value.className = 'rank-item-value'; value.textContent = `${formatTokens(entry.totalTokens)} ${valueLabel}`; item.append(main, value); target.append(item);
    }
  };
  renderRank($('project-list'), recentProjects, 'tokens');
  renderRank($('model-list'), models.slice(0, 5), 'tokens');

  const history = getDailyHistory(data);
  const byDate = new Map(history.map((entry) => [entry.date, entry.tokens]));
  const values = [...byDate.values()];
  const max = Math.max(...values, 0);
  const heatmap = $('heatmap'); heatmap.replaceChildren();
  for (let offset = 89; offset >= 0; offset -= 1) {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - offset);
    const key = localDateString(date); const tokens = byDate.get(key) || 0;
    const cell = document.createElement('i'); cell.className = 'heatmap-cell';
    const level = !tokens || !max ? 0 : Math.min(4, Math.ceil(tokens / max * 4));
    cell.classList.add(`level-${level}`); cell.title = `${fullDateLabel(key)}: ${formatTokens(tokens)} tokens`; cell.setAttribute('aria-label', cell.title); heatmap.append(cell);
  }

  const sessionHistory = $('session-history'); sessionHistory.replaceChildren();
  if (!sessions.length) { const empty = document.createElement('span'); empty.className = 'empty-state'; empty.textContent = 'No recent sessions found.'; sessionHistory.append(empty); }
  else for (const session of sessions.slice(0, 8)) {
    const item = document.createElement('div'); item.className = 'session-item'; item.dataset.status = session.status;
    const main = document.createElement('div'); main.className = 'session-item-main';
    const project = document.createElement('span'); project.className = 'session-item-project'; project.textContent = `${session.project} · ${session.status}`;
    const meta = document.createElement('span'); meta.className = 'session-item-meta'; meta.textContent = `${formatDateTime(session.startedAt)} · ${session.durationMinutes || 0}m · ${session.turns || 0} turn${session.turns === 1 ? '' : 's'}`;
    main.append(project, meta); const value = document.createElement('span'); value.className = 'session-item-value'; value.textContent = `${formatTokens(session.totalTokens)}\nin ${formatTokens(session.inputTokens)} / out ${formatTokens(session.outputTokens)}`; item.append(main, value); sessionHistory.append(item);
  }
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
  const peak = entries.reduce((best, entry) => !best || entry.tokens > best.tokens ? entry : best, null);
  hideHistoryTooltip(true);
  chart.replaceChildren();
  chart.setAttribute('aria-label', `${selectedHistoryRange}-day token usage history; maximum ${formatTokens(max)} tokens`);
  for (const entry of entries) {
    const column = document.createElement('div');
    column.className = 'history-column';
    const bar = document.createElement('div');
    bar.className = 'history-bar';
    if (peak && peak.tokens > 0 && entry.date === peak.date) bar.classList.add('is-peak');
    bar.title = `${entry.date}: ${formatTokens(entry.tokens)} tokens`;
    bar.setAttribute('role', 'button');
    bar.tabIndex = 0;
    bar.setAttribute('aria-label', `${fullDateLabel(entry.date)}: ${formatTokens(entry.tokens)} tokens`);
    const fill = document.createElement('div');
    fill.className = 'history-bar-fill';
    fill.style.setProperty('--bar-height', max && entry.tokens ? `${Math.max(5, entry.tokens / max * 100)}%` : '0%');
    bar.append(fill);
    column.append(bar);
    chart.append(column);
    bar.addEventListener('pointerenter', () => showHistoryTooltip(bar, entry));
    bar.addEventListener('pointerleave', () => hideHistoryTooltip());
    bar.addEventListener('focus', () => showHistoryTooltip(bar, entry));
    bar.addEventListener('blur', () => hideHistoryTooltip());
    bar.addEventListener('click', (event) => {
      event.stopPropagation();
      if (activeHistoryBar === bar && historyTooltipPinned) hideHistoryTooltip(true);
      else showHistoryTooltip(bar, entry, true);
    });
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
  renderAnalytics(data);
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
  const details = [];
  for (const [label, key] of [['5-hour', 'primaryUsed'], ['Weekly', 'secondaryUsed']]) {
    const used = numeric(current?.[key]);
    const old = numeric(previous?.[key]);
    const elapsedHours = previous && current ? (current.timestamp - previous.timestamp) / 3600000 : 0;
    const rate = elapsedHours > 0 && old !== null && used !== null && used > old ? (used - old) / elapsedHours : null;
    const hours = rate ? (100 - used) / rate : null;
    const estimate = formatEstimate(hours);
    if (estimate) estimates.push(`${label}: ~${estimate} remaining`);
    const window = label === '5-hour' ? data.primary : data.secondary;
    const resetHours = numeric(window?.resetsAt) ? Math.max(0, (Number(window.resetsAt) * 1000 - Date.now()) / 3600000) : null;
    if (rate && resetHours && resetHours > 0) {
      const safeRate = Math.max(0, (100 - used) / resetHours);
      details.push(`${label}: ${rate.toFixed(1)}%/h used · safe pace ${safeRate.toFixed(1)}%/h · ${hours > resetHours ? 'likely to last until reset' : 'may run out before reset'}`);
    }
  }
  $('forecast-text').textContent = estimates.length
    ? estimates.join(' · ') + ' at the recent rate. This is an estimate, not a guaranteed reset time.'
    : 'Waiting for another sync. The forecast compares how quickly your usage rises with what remains, then estimates when the window could run out.';
  const sessions = Array.isArray(data.analytics?.sessions) ? data.analytics.sessions.filter((session) => Number(session.durationMinutes) > 0 && Number(session.totalTokens) > 0).slice(0, 5) : [];
  const sessionMinutes = sessions.reduce((sum, session) => sum + Number(session.durationMinutes || 0), 0);
  const tokenHours = sessionMinutes ? sessions.reduce((sum, session) => sum + Number(session.totalTokens || 0), 0) / (sessionMinutes / 60) : 0;
  if (tokenHours) details.push(`Recent activity: ${formatTokens(tokenHours)} tokens/hour`);
  $('forecast-detail').textContent = details.join(' · ');
}

function renderPet(activity) {
  if (activity && typeof activity === 'object') currentPetActivity = { ...currentPetActivity, ...activity };
  const pet = currentPetActivity;
  const enabled = settings.petEnabled !== false;
  const visible = enabled && pet.state !== 'idle';
  const bubble = $('pet-bubble');
  const badge = $('pet-badge');
  const kicker = $('pet-kicker');
  bubble.hidden = !visible;
  badge.hidden = !(visible && pet.state === 'done');
  document.body.dataset.petState = pet.state || 'idle';
  kicker.textContent = pet.state === 'done' ? 'TASK COMPLETE' : 'CODEX ACTIVITY';
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
  // The main process owns the native mini-window bounds and sends the
  // authoritative pet:expanded event. Do not apply the asynchronous return
  // value here: a stale response can arrive after dragging has collapsed the
  // native window and make the bubble render inside 48x48 bounds.
  void window.codexPulse.setPetExpanded(visible).catch(() => {});
}

function renderAccount(data) {
  const account = data.account || {};
  $('account-plan').textContent = data.planType || account.planType || dash;
  $('account-status').textContent = data.ok ? (account.type ? 'Connected' : 'Live') : (data.error || 'Unavailable');
  $('account-health').textContent = data.ok ? (data.diagnostics?.monitoringPaused ? 'Paused' : 'Healthy') : 'Offline';
  $('account-sync').textContent = data.updatedAt ? formatTime(data.updatedAt) : dash;
  $('reset-credits').textContent = data.resetCredits && numeric(data.resetCredits.availableCount) !== null ? String(Math.round(data.resetCredits.availableCount)) : dash;
}

function clearDashboard() {
  for (const id of ['today-tokens', 'seven-day-tokens', 'lifetime-tokens', 'peak-daily-tokens', 'current-streak', 'session-total', 'session-input', 'session-output', 'session-reasoning', 'account-plan', 'account-status', 'account-sync', 'reset-credits']) $(id).textContent = dash;
  $('session-status').textContent = 'Waiting for Codex';
  $('account-health').textContent = 'Offline';
  $('forecast-text').textContent = 'Connect to Codex to estimate your usage pace.';
  $('forecast-detail').textContent = '';
  renderHistory({ localHistory: [] });
  renderAnalytics({ localHistory: [] });
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

function notificationsSuppressed(data) {
  return !settings.notificationsEnabled;
}

function notificationThreshold(percent, thresholds) {
  if (percent === null || !Array.isArray(thresholds)) return null;
  return [...thresholds].sort((a, b) => b - a).find((threshold) => percent <= threshold) ?? null;
}

function checkNotifications(data, today) {
  const values = { primary: remainingPercent(data.primary), secondary: remainingPercent(data.secondary) };
  const crossed = Object.entries(values).some(([prefix, percent]) => {
    const nextLevel = notificationThreshold(percent, settings[`${prefix}AlertThresholds`]);
    const previousLevel = notificationLevels[prefix];
    notificationLevels[prefix] = nextLevel;
    return nextLevel !== null && (previousLevel !== null && previousLevel !== undefined) && nextLevel < previousLevel;
  });
  if (crossed && !notificationsSuppressed(data)) window.codexPulse.showNotification({ ...values, activity: data.activity });
  for (const [prefix, value] of Object.entries(data)) {
    if (!['primary', 'secondary'].includes(prefix)) continue;
    const reset = numeric(value?.resetsAt);
    const oldReset = previousResetTimes[prefix];
    if (!notificationsSuppressed(data) && reset && oldReset && reset !== oldReset && reset * 1000 <= Date.now() + 120000) window.codexPulse.showNotification({ kind: 'rate-reset', label: prefix === 'primary' ? '5-hour window' : 'Weekly window' });
    previousResetTimes[prefix] = reset;
  }
  const target = numeric(settings.dailyTokenTarget);
  if (target && today !== null && (lastTodayTokens === null || lastTodayTokens < target) && today >= target && !notificationsSuppressed(data)) window.codexPulse.showNotification({ kind: 'token-target', target });
  if (today !== null) lastTodayTokens = today;
}

function renderUsage(data) {
  if (!data || !data.ok) {
    document.body.classList.add('error-state');
    document.querySelector('.status-dot').classList.add('error');
    document.querySelector('.status-dot').classList.remove('live');
    $('connection-label').textContent = 'Codex unavailable';
    $('updated-label').textContent = lastSuccessfulSync ? 'Last synced ' + formatTime(lastSuccessfulSync) : 'Waiting for Codex';
    setRow('primary', null);
    setRow('secondary', null);
    retryButton.hidden = false;
    clearDashboard();
    window.codexPulse.updateTray({ primary: null, secondary: null, todayTokens: null, activity: { state: 'error', text: 'Codex unavailable' } });
    return;
  }
  document.body.classList.remove('loading', 'error-state');
  document.querySelector('.status-dot').classList.remove('error');
  document.querySelector('.status-dot').classList.add('live');
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
  window.codexPulse.updateTray({ primary: remainingPercent(data.primary), secondary: remainingPercent(data.secondary), todayTokens: today, activity: data.activity });
  checkNotifications(data, today);
}

function renderLiveUsage(update) {
  if (!update || !currentUsage) return;
  currentUsage = {
    ...currentUsage,
    liveSession: update.liveSession || currentUsage.liveSession,
    liveDailyUsage: update.liveDailyUsage || currentUsage.liveDailyUsage,
    localHistory: update.localHistory || currentUsage.localHistory,
    snapshots: update.snapshots || currentUsage.snapshots,
    primary: update.primary || currentUsage.primary,
    secondary: update.secondary || currentUsage.secondary,
    analytics: update.analytics || currentUsage.analytics,
    activity: update.activity || currentUsage.activity,
  };
  const today = renderTokenActivity(currentUsage);
  renderLiveSession(currentUsage);
  renderForecast(currentUsage);
  window.codexPulse.updateTray({ primary: remainingPercent(currentUsage.primary), secondary: remainingPercent(currentUsage.secondary), todayTokens: today, activity: currentUsage.activity });
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
  $('taskbar-toggle').checked = settings.taskbarMode;
  $('pet-toggle').checked = settings.petEnabled !== false;
  $('daily-target-input').value = settings.dailyTokenTarget || '';
  $('codex-path-label').textContent = settings.codexPath || 'Automatically detected';
  document.body.dataset.compact = settings.compactMode ? 'true' : 'false';
  $('popup-size-select').value = settings.popupSize;
  $('opacity-select').value = String(settings.popupOpacity);
  $('always-on-top-toggle').checked = settings.alwaysOnTop;
  $('compact-mode-toggle').checked = settings.compactMode;
  $('start-minimized-toggle').checked = settings.startMinimized;
  $('pause-monitoring-toggle').checked = settings.monitoringPaused;
  $('per-monitor-toggle').checked = settings.rememberPerMonitor;
  $('retention-select').value = String(settings.historyRetentionDays);
  for (const input of document.querySelectorAll('.threshold-toggle')) input.checked = (settings[`${input.dataset.window}AlertThresholds`] || []).includes(Number(input.dataset.threshold));
  $('shortcut-input').value = displayShortcut(settings.globalShortcut);
  $('shortcut-status').textContent = next.globalShortcutError || (settings.globalShortcut ? 'Global shortcut is active while Codex Pulse is running.' : 'Global shortcut is disabled.');
  $('shortcut-status').classList.toggle('is-error', Boolean(next.globalShortcutError));
}

function displayShortcut(accelerator) {
  if (!accelerator) return '';
  return accelerator.replaceAll('CommandOrControl', 'Ctrl').replaceAll('Command', 'Ctrl');
}

function shortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (!modifiers.length || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;

  const codeKeys = {
    Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`',
  };
  let key = codeKeys[event.code];
  if (!key && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (!key && /^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  if (!key && /^F([1-9]|1[0-2])$/.test(event.key)) key = event.key;
  return key ? [...modifiers, key].join('+') : null;
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
$('taskbar-toggle').addEventListener('change', (event) => saveSetting({ taskbarMode: event.target.checked }));
$('pet-toggle').addEventListener('change', (event) => saveSetting({ petEnabled: event.target.checked }));
$('daily-target-input').addEventListener('change', (event) => saveSetting({ dailyTokenTarget: event.target.value }));
$('popup-size-select').addEventListener('change', (event) => saveSetting({ popupSize: event.target.value }));
$('opacity-select').addEventListener('change', (event) => saveSetting({ popupOpacity: Number(event.target.value) }));
$('always-on-top-toggle').addEventListener('change', (event) => saveSetting({ alwaysOnTop: event.target.checked }));
$('compact-mode-toggle').addEventListener('change', (event) => saveSetting({ compactMode: event.target.checked }));
$('start-minimized-toggle').addEventListener('change', (event) => saveSetting({ startMinimized: event.target.checked }));
$('pause-monitoring-toggle').addEventListener('change', (event) => saveSetting({ monitoringPaused: event.target.checked }));
$('per-monitor-toggle').addEventListener('change', (event) => saveSetting({ rememberPerMonitor: event.target.checked }));
$('retention-select').addEventListener('change', (event) => saveSetting({ historyRetentionDays: Number(event.target.value) }));
document.querySelectorAll('.threshold-toggle').forEach((input) => input.addEventListener('change', () => {
  const primaryAlertThresholds = [...document.querySelectorAll('.threshold-toggle[data-window="primary"]:checked')].map((element) => Number(element.dataset.threshold));
  const secondaryAlertThresholds = [...document.querySelectorAll('.threshold-toggle[data-window="secondary"]:checked')].map((element) => Number(element.dataset.threshold));
  saveSetting({ primaryAlertThresholds, secondaryAlertThresholds });
}));
$('import-button').addEventListener('click', async () => { const result = await window.codexPulse.importHistory(); if (result.imported) refresh(); });
$('clear-history-button').addEventListener('click', async () => { const result = await window.codexPulse.clearHistory(); if (result.cleared) refresh(); });
$('diagnostics-button').addEventListener('click', async () => {
  const result = await window.codexPulse.runDiagnostics();
  $('diagnostics-result').textContent = result.checks.map((check) => `${check.ok ? '✓' : '!' } ${check.label}: ${check.detail}`).join('\n') + '\nCopied to clipboard.';
});
$('shortcut-input').addEventListener('keydown', async (event) => {
  event.preventDefault();
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) {
    $('shortcut-status').textContent = 'Use Ctrl, Alt, or Shift plus another key.';
    $('shortcut-status').classList.add('is-error');
    return;
  }
  await saveSetting({ globalShortcut: shortcut });
});
$('shortcut-clear').addEventListener('click', () => saveSetting({ globalShortcut: '' }));
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
document.addEventListener('pointerdown', (event) => { if (!historyChart.contains(event.target)) hideHistoryTooltip(true); });
window.codexPulse.onRefresh(refresh);
window.codexPulse.onLiveUsage(renderLiveUsage);
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
  window.codexPulse.setMiniDragging(true);
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
  window.codexPulse.setMiniDragging(false);
  miniView.classList.remove('is-dragging');
  if (miniView.hasPointerCapture(event.pointerId)) miniView.releasePointerCapture(event.pointerId);
  if (suppressMiniClick) setTimeout(() => { suppressMiniClick = false; }, 100);
});
miniView.addEventListener('pointercancel', () => { window.codexPulse.setMiniDragging(false); });
window.addEventListener('blur', () => {
  if (!dragState) return;
  dragState = null;
  miniView.classList.remove('is-dragging');
  window.codexPulse.setMiniDragging(false);
});
window.codexPulse.onViewChange((view) => { document.body.dataset.view = view; minimizeButton.setAttribute('aria-label', view === 'mini' ? 'Restore the full Codex Pulse window' : 'Minimize to floating logo'); minimizeButton.setAttribute('title', view === 'mini' ? 'Restore the full Codex Pulse window' : 'Minimize to a floating logo'); });

(async () => { updateSettingsPanel(await window.codexPulse.getSettings()); renderUpdateState({ status: 'checking' }); await window.codexPulse.checkForUpdates(); await refresh(); })();
setInterval(refreshResetLabels, 60 * 1000);
