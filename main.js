const { app, BrowserWindow, Menu, Tray, nativeImage, screen, shell, ipcMain, dialog, Notification, globalShortcut, clipboard } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { CodexActivityBridge } = require('./activity-bridge');
const { scanSessionAnalytics } = require('./session-analytics');

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 620;
const WINDOW_SIZES = { small: { width: 380, height: 560 }, normal: { width: 420, height: 620 }, large: { width: 480, height: 700 } };
const MINI_WIDTH = 48;
const MINI_HEIGHT = 48;
const PET_WIDTH = 240;
const PET_HEIGHT = 118;
const LOGO_ANCHOR_X = 22;
const LOGO_ANCHOR_Y = 22;
const LOGO_MARK_SIZE = 39;
const EDGE_GAP = 22;
const DEFAULT_SETTINGS = {
  launchAtStartup: true,
  refreshInterval: 30,
  codexPath: '',
  theme: 'system',
  notificationsEnabled: true,
  quietMode: false,
  dailyTokenTarget: 0,
  petEnabled: true,
  globalShortcut: 'CommandOrControl+Shift+Alt+P',
  primaryAlertThresholds: [50, 25, 10],
  secondaryAlertThresholds: [50, 25, 10],
  alwaysOnTop: true,
  popupOpacity: 100,
  popupSize: 'normal',
  compactMode: false,
  startMinimized: false,
  monitoringPaused: false,
  historyRetentionDays: 90,
  rememberPerMonitor: false,
  positions: {},
  position: null,
};

let popup;
let tray;
let pollTimer;
let activityBridge;
let positionSaveTimer;
let isQuitting = false;
let isMinimized = false;
let expandedBounds = null;
let settings = { ...DEFAULT_SETTINGS };
let usageHistory = { daily: [], snapshots: [] };
let historySaveTimer;
let petExpanded = false;
let petUnread = false;
let miniAnchor = null;
let miniDragging = false;
let currentActivity = { state: 'idle', text: 'Waiting for Codex' };
let latestLiveUsage = null;
let latestUpdateState = { status: 'checking' };
let registeredGlobalShortcut = null;
let globalShortcutError = null;
let latestAnalytics = { sessions: [], projects: [], models: [] };
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function getWindowSize() {
  return WINDOW_SIZES[settings.popupSize] || WINDOW_SIZES.normal;
}

function retentionDays() {
  const value = Number(settings.historyRetentionDays);
  return [30, 90, 365].includes(value) ? value : 90;
}

function trimHistory() {
  const cutoff = Date.now() - retentionDays() * 86400000;
  usageHistory.daily = usageHistory.daily.filter((entry) => Date.parse(`${entry.date}T23:59:59`) >= cutoff).slice(-365);
  usageHistory.snapshots = usageHistory.snapshots.filter((entry) => entry.timestamp >= cutoff).slice(-5000);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function historyPath() {
  return path.join(app.getPath('userData'), 'usage-history.json');
}

function loadHistory() {
  try {
    const saved = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    usageHistory = {
      daily: Array.isArray(saved.daily) ? saved.daily.filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(Number(entry.tokens))) : [],
      snapshots: Array.isArray(saved.snapshots) ? saved.snapshots.filter((entry) => entry && Number.isFinite(Number(entry.timestamp))) : [],
    };
    trimHistory();
  } catch (_) {
    usageHistory = { daily: [], snapshots: [] };
  }
}

function saveHistory() {
  trimHistory();
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(historyPath(), JSON.stringify(usageHistory, null, 2));
}

function saveHistorySoon() {
  if (historySaveTimer) return;
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    saveHistory();
  }, 5000);
}

function mergeDailyHistory(buckets) {
  if (!Array.isArray(buckets)) return;
  const byDate = new Map(usageHistory.daily.map((entry) => [entry.date, entry]));
  for (const bucket of buckets) {
    if (!bucket || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.startDate) || !Number.isFinite(Number(bucket.tokens))) continue;
    byDate.set(bucket.startDate, { date: bucket.startDate, tokens: Math.max(0, Number(bucket.tokens)) });
  }
  usageHistory.daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-365);
}

function addUsageSnapshot(primary, secondary) {
  const now = Date.now();
  const latest = usageHistory.snapshots.at(-1);
  if (latest && now - latest.timestamp < 15000) return;
  usageHistory.snapshots.push({
    timestamp: now,
    primaryUsed: Number.isFinite(Number(primary?.usedPercent)) ? Number(primary.usedPercent) : null,
    secondaryUsed: Number.isFinite(Number(secondary?.usedPercent)) ? Number(secondary.usedPercent) : null,
  });
  usageHistory.snapshots = usageHistory.snapshots.filter((entry) => entry.timestamp > Date.now() - retentionDays() * 24 * 60 * 60 * 1000).slice(-5000);
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    delete saved.notifyOnlyWhenActive;
    delete saved.quietHoursEnabled;
    delete saved.quietHoursStart;
    delete saved.quietHoursEnd;
    delete saved.notificationSnoozeUntil;
    settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      refreshInterval: [15, 30, 60].includes(Number(saved.refreshInterval)) ? Number(saved.refreshInterval) : DEFAULT_SETTINGS.refreshInterval,
      theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
      dailyTokenTarget: Number.isFinite(Number(saved.dailyTokenTarget)) ? Math.max(0, Math.min(1000000000, Math.round(Number(saved.dailyTokenTarget)))) : DEFAULT_SETTINGS.dailyTokenTarget,
      globalShortcut: typeof saved.globalShortcut === 'string' ? saved.globalShortcut.trim() : DEFAULT_SETTINGS.globalShortcut,
      primaryAlertThresholds: Array.isArray(saved.primaryAlertThresholds) ? saved.primaryAlertThresholds.map(Number).filter((value) => [50, 25, 10].includes(value)) : DEFAULT_SETTINGS.primaryAlertThresholds,
      secondaryAlertThresholds: Array.isArray(saved.secondaryAlertThresholds) ? saved.secondaryAlertThresholds.map(Number).filter((value) => [50, 25, 10].includes(value)) : DEFAULT_SETTINGS.secondaryAlertThresholds,
      alwaysOnTop: saved.alwaysOnTop !== false,
      popupOpacity: [70, 85, 100].includes(Number(saved.popupOpacity)) ? Number(saved.popupOpacity) : DEFAULT_SETTINGS.popupOpacity,
      popupSize: Object.prototype.hasOwnProperty.call(WINDOW_SIZES, saved.popupSize) ? saved.popupSize : DEFAULT_SETTINGS.popupSize,
      compactMode: Boolean(saved.compactMode),
      startMinimized: Boolean(saved.startMinimized),
      monitoringPaused: Boolean(saved.monitoringPaused),
      historyRetentionDays: [30, 90, 365].includes(Number(saved.historyRetentionDays)) ? Number(saved.historyRetentionDays) : DEFAULT_SETTINGS.historyRetentionDays,
      rememberPerMonitor: Boolean(saved.rememberPerMonitor),
      positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
      position: saved.position && Number.isFinite(Number(saved.position.x)) && Number.isFinite(Number(saved.position.y))
        ? { x: Number(saved.position.x), y: Number(saved.position.y) }
        : null,
    };
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function togglePopup() {
  if (!popup || popup.isDestroyed()) return;
  if (popup.isVisible()) popup.hide();
  else showPopup();
}

function registerGlobalShortcut(accelerator) {
  const nextShortcut = typeof accelerator === 'string' ? accelerator.trim() : '';
  if (registeredGlobalShortcut === nextShortcut) {
    globalShortcutError = null;
    return { ok: true };
  }

  if (registeredGlobalShortcut) globalShortcut.unregister(registeredGlobalShortcut);
  registeredGlobalShortcut = null;
  globalShortcutError = null;

  if (!nextShortcut) return { ok: true };
  try {
    if (globalShortcut.register(nextShortcut, togglePopup)) {
      registeredGlobalShortcut = nextShortcut;
      return { ok: true };
    }
  } catch (_) {
    globalShortcutError = 'That shortcut is not supported.';
    return { ok: false, error: globalShortcutError };
  }

  globalShortcutError = 'That shortcut is already in use by another application.';
  return { ok: false, error: globalShortcutError };
}

function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function updateSettings(patch) {
  if (!patch || typeof patch !== 'object') return { ...settings };
  if (typeof patch.launchAtStartup === 'boolean') settings.launchAtStartup = patch.launchAtStartup;
  if ([15, 30, 60].includes(Number(patch.refreshInterval))) settings.refreshInterval = Number(patch.refreshInterval);
  if (typeof patch.codexPath === 'string') settings.codexPath = patch.codexPath.trim();
  if (['system', 'light', 'dark'].includes(patch.theme)) settings.theme = patch.theme;
  if (typeof patch.notificationsEnabled === 'boolean') settings.notificationsEnabled = patch.notificationsEnabled;
  if (typeof patch.quietMode === 'boolean') settings.quietMode = patch.quietMode;
  if (typeof patch.petEnabled === 'boolean') settings.petEnabled = patch.petEnabled;
  if (Array.isArray(patch.primaryAlertThresholds)) settings.primaryAlertThresholds = patch.primaryAlertThresholds.map(Number).filter((value) => [50, 25, 10].includes(value));
  if (Array.isArray(patch.secondaryAlertThresholds)) settings.secondaryAlertThresholds = patch.secondaryAlertThresholds.map(Number).filter((value) => [50, 25, 10].includes(value));
  if (typeof patch.alwaysOnTop === 'boolean') settings.alwaysOnTop = patch.alwaysOnTop;
  if ([70, 85, 100].includes(Number(patch.popupOpacity))) settings.popupOpacity = Number(patch.popupOpacity);
  if (Object.prototype.hasOwnProperty.call(WINDOW_SIZES, patch.popupSize)) settings.popupSize = patch.popupSize;
  if (typeof patch.compactMode === 'boolean') settings.compactMode = patch.compactMode;
  if (typeof patch.startMinimized === 'boolean') settings.startMinimized = patch.startMinimized;
  if (typeof patch.monitoringPaused === 'boolean') settings.monitoringPaused = patch.monitoringPaused;
  if ([30, 90, 365].includes(Number(patch.historyRetentionDays))) settings.historyRetentionDays = Number(patch.historyRetentionDays);
  if (typeof patch.rememberPerMonitor === 'boolean') settings.rememberPerMonitor = patch.rememberPerMonitor;
  if (Object.prototype.hasOwnProperty.call(patch, 'dailyTokenTarget')) {
    if (patch.dailyTokenTarget === '' || patch.dailyTokenTarget === null || patch.dailyTokenTarget === undefined) settings.dailyTokenTarget = 0;
    else if (Number.isFinite(Number(patch.dailyTokenTarget))) settings.dailyTokenTarget = Math.max(0, Math.min(1000000000, Math.round(Number(patch.dailyTokenTarget))));
  }
  saveSettings();
  return { ...settings };
}

function commitSettings(patch) {
  const previous = { ...settings };
  let shortcutResult = { ok: true };
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'globalShortcut')) {
    const requested = typeof patch.globalShortcut === 'string' ? patch.globalShortcut.trim() : '';
    if (requested !== settings.globalShortcut) {
      const previousShortcut = settings.globalShortcut;
      shortcutResult = registerGlobalShortcut(requested);
      if (shortcutResult.ok) settings.globalShortcut = requested;
      else {
        registerGlobalShortcut(previousShortcut);
        globalShortcutError = shortcutResult.error;
      }
    }
  }
  const next = updateSettings(patch);
  if (previous.launchAtStartup !== next.launchAtStartup) applyStartupSetting();
  if (previous.refreshInterval !== next.refreshInterval) startPolling();
  if (previous.codexPath !== next.codexPath) usageClient.stop();
  if (previous.petEnabled !== next.petEnabled && !miniDragging) setPetExpanded(next.petEnabled && currentActivity.state !== 'idle');
  if (previous.alwaysOnTop !== next.alwaysOnTop) popup?.setAlwaysOnTop(next.alwaysOnTop, 'screen-saver');
  if (previous.popupOpacity !== next.popupOpacity) popup?.setOpacity(next.popupOpacity / 100);
  if (previous.popupSize !== next.popupSize && popup && !popup.isDestroyed() && !isMinimized) {
    const size = getWindowSize();
    const bounds = popup.getBounds();
    popup.setBounds({ ...clampPosition(bounds.x, bounds.y), width: size.width, height: size.height }, false);
  }
  if (previous.historyRetentionDays !== next.historyRetentionDays) { trimHistory(); saveHistory(); }
  if (previous.monitoringPaused !== next.monitoringPaused) {
    if (next.monitoringPaused) activityBridge?.stop();
    else startActivityBridge();
  }
  return { ...next, globalShortcutError };
}

function applyStartupSetting() {
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup });
}

function startPolling() {
  clearInterval(pollTimer);
  if (settings.monitoringPaused) return;
  pollTimer = setInterval(() => {
    if (popup && !popup.isDestroyed()) popup.webContents.send('usage:refresh');
  }, settings.refreshInterval * 1000);
}

function startActivityBridge() {
  activityBridge?.stop();
  if (settings.monitoringPaused) return;
  activityBridge = new CodexActivityBridge({
    homeDir: app.getPath('home'),
    onActivity: setActivity,
    onUsage: setLiveUsage,
  });
  activityBridge.start();
}

function setLiveUsage(usage) {
  if (!usage || typeof usage !== 'object') return;
  latestLiveUsage = usage;
  if (usage.date && Number.isFinite(Number(usage.dailyTokens))) {
    const byDate = new Map(usageHistory.daily.map((entry) => [entry.date, entry]));
    const previous = Number(byDate.get(usage.date)?.tokens) || 0;
    byDate.set(usage.date, { date: usage.date, tokens: Math.max(previous, Number(usage.dailyTokens)) });
    usageHistory.daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
    saveHistorySoon();
  }
  if (usage.primary || usage.secondary) {
    addUsageSnapshot(usage.primary, usage.secondary);
    saveHistorySoon();
  }
  if (popup && !popup.isDestroyed() && !popup.webContents.isLoading()) {
    popup.webContents.send('usage:live', {
      liveSession: latestLiveUsage,
      liveDailyUsage: usage.date ? { date: usage.date, tokens: usage.dailyTokens } : null,
      localHistory: usageHistory.daily,
      primary: usage.primary || null,
      secondary: usage.secondary || null,
      snapshots: usageHistory.snapshots,
      analytics: latestAnalytics,
      activity: currentActivity,
      updatedAt: Date.now(),
    });
  }
}

function schedulePositionSave() {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    if (!popup || popup.isDestroyed()) return;
    const bounds = expandedBounds || popup.getBounds();
    if (isMinimized && miniAnchor) {
      settings.position = {
        x: Math.round(miniAnchor.x - LOGO_ANCHOR_X - (LOGO_MARK_SIZE - MINI_WIDTH) / 2),
        y: Math.round(miniAnchor.y - LOGO_ANCHOR_Y - (LOGO_MARK_SIZE - MINI_HEIGHT) / 2),
      };
      saveSettings();
      return;
    }
    settings.position = { x: bounds.x, y: bounds.y };
    if (settings.rememberPerMonitor) {
      const display = screen.getDisplayMatching(bounds);
      settings.positions[String(display.id)] = { x: bounds.x, y: bounds.y };
    }
    saveSettings();
  }, 250);
}

function legacyTrayTooltip(data) {
  if (!tray || tray.isDestroyed()) return;
  const primaryValue = data?.primary === null || data?.primary === undefined || data?.primary === '' ? null : Number(data.primary);
  const secondaryValue = data?.secondary === null || data?.secondary === undefined || data?.secondary === '' ? null : Number(data.secondary);
  const primary = Number.isFinite(primaryValue) ? `${Math.round(primaryValue)}%` : '—';
  const secondary = Number.isFinite(secondaryValue) ? `${Math.round(secondaryValue)}%` : '—';
  tray.setToolTip(`Codex Pulse · 5-hour ${primary} remaining · weekly ${secondary} remaining`);
}

function updateTrayTooltip(data) {
  if (!tray || tray.isDestroyed()) return;
  const primary = Number.isFinite(Number(data?.primary)) ? `${Math.round(Number(data.primary))}%` : '-';
  const secondary = Number.isFinite(Number(data?.secondary)) ? `${Math.round(Number(data.secondary))}%` : '-';
  const today = Number.isFinite(Number(data?.todayTokens)) ? `${Math.round(Number(data.todayTokens)).toLocaleString()} tokens` : '-';
  const active = data?.activity?.state === 'working' ? ` - ${data.activity.text || 'Codex working'}` : '';
  tray.setToolTip(`Codex Pulse - 5-hour ${primary} left - weekly ${secondary} left - today ${today}${active}`);
}

function showUsageNotification(data) {
  if (!settings.notificationsEnabled || !Notification.isSupported()) return false;
  if (data?.kind === 'token-target') {
    const notification = new Notification({ title: 'Codex daily target reached', body: `Today\'s token activity reached ${Number(data.target).toLocaleString()} tokens.`, silent: true });
    notification.on('click', showPopup); notification.show();
    return true;
  }
  if (data?.kind === 'rate-reset') {
    const notification = new Notification({ title: 'Codex limit reset', body: `${data.label || 'A usage window'} is available again.`, silent: true });
    notification.on('click', showPopup); notification.show();
    return true;
  }
  const primary = data?.primary === null || data?.primary === undefined || data?.primary === '' ? null : Number(data.primary);
  const secondary = data?.secondary === null || data?.secondary === undefined || data?.secondary === '' ? null : Number(data.secondary);
  const windows = [
    Number.isFinite(primary) ? { label: '5-hour', value: primary } : null,
    Number.isFinite(secondary) ? { label: 'weekly', value: secondary } : null,
  ].filter(Boolean).sort((a, b) => a.value - b.value);
  if (!windows.length) return false;
  const lowest = windows[0];
  const title = lowest.value <= 10 ? 'Codex usage is very low' : 'Codex usage is getting low';
  const body = windows.map(({ label, value }) => `${label}: ${Math.round(value)}% remaining`).join(' · ');
  const notification = new Notification({ title, body, silent: true });
  notification.on('click', showPopup); notification.show();
  return true;
}

function sendUpdateState(state) {
  latestUpdateState = state;
  if (popup && !popup.isDestroyed() && !popup.webContents.isLoading()) popup.webContents.send('update:state', state);
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    sendUpdateState({ status: 'up-to-date' });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateState({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateState({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateState({ status: 'up-to-date' }));
  autoUpdater.on('update-downloaded', () => sendUpdateState({ status: 'downloaded' }));
  autoUpdater.on('error', () => sendUpdateState({ status: 'error' }));
  checkForUpdates();
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateState({ status: 'up-to-date' });
    return { status: 'up-to-date' };
  }
  try {
    sendUpdateState({ status: 'checking' });
    await autoUpdater.checkForUpdates();
    return latestUpdateState;
  } catch (_) {
    sendUpdateState({ status: 'error' });
    return latestUpdateState;
  }
}

function isPositionVisible(x, y) {
  return screen.getAllDisplays().some(({ workArea }) => (
    x < workArea.x + workArea.width && x + MINI_WIDTH > workArea.x
      && y < workArea.y + workArea.height && y + MINI_HEIGHT > workArea.y
  ));
}

function clampPosition(x, y) {
  const display = screen.getDisplayMatching({ x, y, width: MINI_WIDTH, height: MINI_HEIGHT });
  const { workArea } = display;
  const size = getWindowSize();
  return {
    x: Math.max(workArea.x + EDGE_GAP, Math.min(x, workArea.x + workArea.width - size.width - EDGE_GAP)),
    y: Math.max(workArea.y + EDGE_GAP, Math.min(y, workArea.y + workArea.height - size.height - EDGE_GAP)),
  };
}

function isPositionFullyVisible(x, y, width = MINI_WIDTH, height = MINI_HEIGHT) {
  return screen.getAllDisplays().some(({ workArea }) => (
    x >= workArea.x && y >= workArea.y
      && x + width <= workArea.x + workArea.width
      && y + height <= workArea.y + workArea.height
  ));
}

function isBoundsFullyVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => (
    bounds.x >= workArea.x && bounds.y >= workArea.y
      && bounds.x + bounds.width <= workArea.x + workArea.width
      && bounds.y + bounds.height <= workArea.y + workArea.height
  ));
}

function logoAnchorForBounds(bounds) {
  return {
    x: Math.round(bounds.x + LOGO_ANCHOR_X + (LOGO_MARK_SIZE - MINI_WIDTH) / 2),
    y: Math.round(bounds.y + LOGO_ANCHOR_Y + (LOGO_MARK_SIZE - MINI_HEIGHT) / 2),
  };
}

function getDefaultPopupBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const size = getWindowSize();
  const position = clampPosition(x + width - size.width - EDGE_GAP, y + height - size.height - EDGE_GAP);
  return { x: position.x, y: position.y, width: size.width, height: size.height };
}

function createTrayIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
}

function resolveCodexCommand() {
  if (settings.codexPath) return settings.codexPath;
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  try {
    const result = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }).trim().split(/\r?\n/)[0];
    if (result) return result;
  } catch (_) {
    // The default command is still useful when the shell resolver is unavailable.
  }

  const home = app.getPath('home');
  const roots = [
    path.join(home, '.vscode', 'extensions'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin') : null,
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const base = path.join(root, entry.name);
        const direct = [
          path.join(base, 'bin', 'windows-x86_64', 'codex.exe'),
          path.join(base, 'codex.exe'),
        ];
        for (const candidate of direct) if (fs.existsSync(candidate)) candidates.push(candidate);
        if (root.endsWith(path.join('OpenAI', 'Codex', 'bin'))) {
          const nested = path.join(base, 'codex.exe');
          if (fs.existsSync(nested)) candidates.push(nested);
        }
      }
    } catch (_) {
      // A missing extension folder should not prevent the app from starting.
    }
  }
  if (candidates.length) return candidates[candidates.length - 1];
  return 'codex';
}

function runDiagnostics() {
  const codexCommand = resolveCodexCommand();
  const sessionsDirectory = path.join(app.getPath('home'), '.codex', 'sessions');
  const commandExists = codexCommand !== 'codex' || fs.existsSync(codexCommand);
  const sessionDirectoryExists = fs.existsSync(sessionsDirectory);
  const sessionDirectoryReadable = safeReadableDirectory(sessionsDirectory);
  const checks = [
    { label: 'Codex executable', ok: commandExists, detail: codexCommand },
    { label: 'Session directory', ok: sessionDirectoryExists, detail: sessionsDirectory },
    { label: 'Session directory readable', ok: sessionDirectoryReadable, detail: sessionDirectoryReadable ? 'Readable' : 'Permission denied or unavailable' },
    { label: 'Codex app-server', ok: Boolean(usageClient.ready), detail: usageClient.ready ? 'Connected' : 'Not connected yet' },
    { label: 'Codex authentication', ok: usageClient.lastAccountAuthRequired !== true, detail: usageClient.lastAccountAuthRequired === true ? 'Sign-in required' : 'No sign-in error reported' },
    { label: 'VS Code activity bridge', ok: Boolean(activityBridge && !settings.monitoringPaused), detail: settings.monitoringPaused ? 'Paused' : 'Running' },
  ];
  const report = [
    'Codex Pulse diagnostics',
    `Generated: ${new Date().toISOString()}`,
    `Version: ${app.getVersion()}`,
    `Platform: ${process.platform} ${process.arch}`,
    ...checks.map((check) => `${check.ok ? 'PASS' : 'WARN'} - ${check.label}: ${check.detail}`),
  ].join('\n');
  clipboard.writeText(report);
  return { checks, report };
}

function safeReadableDirectory(directory) {
  try { fs.readdirSync(directory); return true; } catch (_) { return false; }
}

function setActivity(next) {
  const previous = currentActivity;
  currentActivity = { ...currentActivity, ...next, updatedAt: Date.now() };
  if (currentActivity.state === 'done' && previous.state !== 'done') petUnread = true;
  if (popup && !popup.isDestroyed() && !popup.webContents.isLoading()) popup.webContents.send('pet:activity', currentActivity);
  if (!miniDragging) setPetExpanded(currentActivity.state !== 'idle' && settings.petEnabled);
}

function petBoundsForAnchor(anchor, expanded = petExpanded) {
  if (expanded) {
    return {
      x: Math.round(anchor.x - (PET_WIDTH - MINI_WIDTH) / 2),
      y: Math.round(anchor.y - (PET_HEIGHT - MINI_HEIGHT)),
      width: PET_WIDTH,
      height: PET_HEIGHT,
    };
  }
  return { x: Math.round(anchor.x), y: Math.round(anchor.y), width: MINI_WIDTH, height: MINI_HEIGHT };
}

function safePetAnchor(anchor, expanded = true) {
  if (!isPositionFullyVisible(anchor.x, anchor.y)) return logoAnchorForBounds(getDefaultPopupBounds());
  if (!expanded || isBoundsFullyVisible(petBoundsForAnchor(anchor, true))) return anchor;

  const display = screen.getDisplayMatching({ x: anchor.x, y: anchor.y, width: MINI_WIDTH, height: MINI_HEIGHT });
  const { workArea } = display;
  const adjusted = {
    x: Math.round(Math.max(workArea.x + (PET_WIDTH - MINI_WIDTH) / 2, Math.min(anchor.x, workArea.x + workArea.width - (PET_WIDTH + MINI_WIDTH) / 2))),
    y: Math.round(Math.max(workArea.y + (PET_HEIGHT - MINI_HEIGHT), Math.min(anchor.y, workArea.y + workArea.height - MINI_HEIGHT))),
  };
  return isBoundsFullyVisible(petBoundsForAnchor(adjusted, true)) ? adjusted : logoAnchorForBounds(getDefaultPopupBounds());
}

function setPetExpanded(expanded) {
  if (!popup || popup.isDestroyed() || !isMinimized) return;
  const next = Boolean(expanded && settings.petEnabled);
  if (petExpanded === next) return;
  petExpanded = next;
  let anchor = miniAnchor || popup.getBounds();
  if (next) {
    const safeAnchor = safePetAnchor(anchor, next);
    if (safeAnchor.x !== anchor.x || safeAnchor.y !== anchor.y) {
      anchor = safeAnchor;
      miniAnchor = safeAnchor;
      expandedBounds = getDefaultPopupBounds();
      settings.position = { x: expandedBounds.x, y: expandedBounds.y };
      schedulePositionSave();
    }
  }
  popup.setBounds(petBoundsForAnchor(anchor, next), false);
  if (!popup.webContents.isLoading()) popup.webContents.send('pet:expanded', petExpanded);
}

function clearPetNotification() {
  petUnread = false;
  if (currentActivity.state === 'done') currentActivity = { state: 'idle', text: 'Waiting for Codex', updatedAt: Date.now() };
  setPetExpanded(false);
}

class CodexUsageClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.ready = false;
    this.latestTokenUsage = null;
    this.lastAccountAuthRequired = null;
  }

  async start() {
    if (this.child && !this.child.killed && this.ready) return;
    if (this.startPromise) return this.startPromise;
    if (this.child && !this.child.killed) this.stop();

    this.startPromise = new Promise((resolve, reject) => {
      const command = resolveCodexCommand();
      const child = spawn(command, ['app-server', '--stdio'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      this.buffer = '';

      let settled = false;
      const finishStart = (error) => {
        if (settled) return;
        settled = true;
        this.startPromise = null;
        if (error) {
          this.ready = false;
          if (this.child && !this.child.killed) this.child.kill();
          this.child = null;
        }
        if (error) reject(error); else resolve();
      };

      child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.method === 'thread/tokenUsage/updated') {
              this.latestTokenUsage = message.params || null;
            }
            if (message.id && this.pending.has(message.id)) {
              const request = this.pending.get(message.id);
              this.pending.delete(message.id);
              if (message.error) request.reject(new Error(message.error.message || 'Codex request failed'));
              else request.resolve(message.result);
            }
          } catch (_) {
            // Ignore non-JSON output; app-server keeps the protocol on stdout.
          }
        }
      });
      child.stderr.on('data', () => {});
      child.once('error', (error) => finishStart(error));
      child.once('spawn', async () => {
        try {
          await this.request('initialize', {
            clientInfo: { name: 'codex-pulse', title: 'Codex Pulse', version: app.getVersion() },
            capabilities: { experimentalApi: true },
          });
          this.ready = true;
          this.notify('initialized', {});
          finishStart();
        } catch (error) {
          finishStart(error);
        }
      });
      child.once('exit', () => {
        for (const request of this.pending.values()) request.reject(new Error('Codex app-server stopped'));
        this.pending.clear();
        this.child = null;
        this.ready = false;
        this.startPromise = null;
      });
    });
    return this.startPromise;
  }

  notify(method, params) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) return;
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch (_) {
      this.stop();
    }
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || !this.child.stdin.writable) {
        reject(new Error('Codex app-server is not running'));
        return;
      }
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex request timed out'));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, id, params })}\n`);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async readUsage() {
    try {
      await this.start();
      const result = await this.request('account/rateLimits/read');
      const snapshot = result?.rateLimitsByLimitId?.codex || result?.rateLimits;
      if (!snapshot) throw new Error('Codex did not return a usage snapshot');
      const [tokenResult, accountResult] = await Promise.all([
        this.request('account/usage/read').catch(() => null),
        this.request('account/read', { refreshToken: false }).catch(() => null),
      ]);
      this.lastAccountAuthRequired = accountResult?.requiresOpenaiAuth ?? null;
      const activity = currentActivity;
      latestAnalytics = scanSessionAnalytics(path.join(app.getPath('home'), '.codex', 'sessions'), { retentionDays: retentionDays() });
      mergeDailyHistory(tokenResult?.dailyUsageBuckets);
      addUsageSnapshot(snapshot.primary, snapshot.secondary);
      saveHistory();
      return {
        ok: true,
        primary: snapshot.primary || null,
        secondary: snapshot.secondary || null,
        planType: snapshot.planType || accountResult?.account?.planType || null,
        credits: snapshot.credits || null,
        ordinaryUsageAllowed: result.ordinaryUsageAllowed,
        rateLimitReachedType: snapshot.rateLimitReachedType || null,
        resetCredits: result.rateLimitResetCredits || null,
        tokenActivity: tokenResult?.summary || null,
        dailyUsageBuckets: tokenResult?.dailyUsageBuckets || null,
        localHistory: usageHistory.daily,
        snapshots: usageHistory.snapshots,
        analytics: latestAnalytics,
        liveSession: latestLiveUsage || this.latestTokenUsage,
        liveDailyUsage: latestLiveUsage?.date ? { date: latestLiveUsage.date, tokens: latestLiveUsage.dailyTokens } : null,
        activity,
        account: accountResult?.account || null,
        accountAuthRequired: accountResult?.requiresOpenaiAuth ?? null,
        updatedAt: Date.now(),
        diagnostics: { sessionDirectory: path.join(app.getPath('home'), '.codex', 'sessions'), monitoringPaused: settings.monitoringPaused },
      };
    } catch (error) {
      this.stop();
      return { ok: false, error: error.message || 'Unable to read Codex usage', updatedAt: Date.now() };
    }
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.ready = false;
    this.startPromise = null;
    for (const request of this.pending.values()) request.reject(new Error('Codex app-server stopped'));
    this.pending.clear();
  }
}

const usageClient = new CodexUsageClient();

function positionPopup() {
  if (!popup) return;
  const display = screen.getPrimaryDisplay();
  const defaultBounds = getDefaultPopupBounds();
  const saved = settings.rememberPerMonitor ? settings.positions[String(display.id)] || settings.position : settings.position;
  if (saved && isPositionVisible(saved.x, saved.y)) {
    const position = clampPosition(saved.x, saved.y);
    popup.setPosition(position.x, position.y, false);
    return;
  }
  popup.setPosition(defaultBounds.x, defaultBounds.y, false);
}

function showPopup() {
  if (!popup || popup.isDestroyed()) return;
  if (!isMinimized) {
    const bounds = popup.getBounds();
    const size = getWindowSize();
    if (bounds.width !== size.width || bounds.height !== size.height) {
      popup.setBounds({ x: bounds.x, y: bounds.y, width: size.width, height: size.height }, false);
    }
  }
  app.focus({ steal: true });
  popup.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  popup.show();
  popup.focus();
  popup.moveTop();
  if (!popup.webContents.isLoading()) {
    popup.webContents.send('window:view', isMinimized ? 'mini' : 'full');
    popup.webContents.send('pet:activity', currentActivity);
    popup.webContents.send('pet:expanded', petExpanded);
    popup.webContents.send('usage:refresh');
  }
}

function setPopupView(minimized) {
  if (!popup || popup.isDestroyed() || isMinimized === minimized) return;
  const bounds = popup.getBounds();
  isMinimized = minimized;
  if (minimized) {
    const candidateAnchor = {
      x: Math.round(bounds.x + LOGO_ANCHOR_X + (LOGO_MARK_SIZE - MINI_WIDTH) / 2),
      y: Math.round(bounds.y + LOGO_ANCHOR_Y + (LOGO_MARK_SIZE - MINI_HEIGHT) / 2),
    };
    if (isPositionFullyVisible(candidateAnchor.x, candidateAnchor.y)) {
      expandedBounds = bounds;
      miniAnchor = candidateAnchor;
    } else {
      expandedBounds = getDefaultPopupBounds();
      miniAnchor = logoAnchorForBounds(expandedBounds);
      settings.position = { x: expandedBounds.x, y: expandedBounds.y };
    }
    popup.setBounds({ ...miniAnchor, width: MINI_WIDTH, height: MINI_HEIGHT }, false);
  } else {
    const restoreBounds = expandedBounds || bounds;
    const size = getWindowSize();
    miniDragging = false;
    popup.setBounds({
      x: restoreBounds.x,
      y: restoreBounds.y,
      width: size.width,
      height: size.height,
    }, false);
    expandedBounds = null;
    miniAnchor = null;
    petExpanded = false;
    petUnread = false;
  }
  schedulePositionSave();
  popup.webContents.send('window:view', minimized ? 'mini' : 'full');
  popup.webContents.send('pet:activity', currentActivity);
  if (minimized) setPetExpanded(currentActivity.state !== 'idle' && settings.petEnabled);
  showPopup();
}

function createWindow() {
  const size = getWindowSize();
  popup = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: MINI_WIDTH,
    maxWidth: size.width,
    minHeight: MINI_HEIGHT,
    maxHeight: size.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popup.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  popup.setOpacity(settings.popupOpacity / 100);
  positionPopup();
  popup.loadFile(path.join(__dirname, 'index.html'));
  const revealPopup = () => {
    if (popup.isDestroyed() || process.argv.includes('--hidden') || settings.quietMode) return;
    if (settings.startMinimized && !isMinimized) setPopupView(true);
    showPopup();
  };
  if (!process.argv.includes('--hidden') && !settings.quietMode) {
    showPopup();
  }
  popup.once('ready-to-show', revealPopup);
  popup.webContents.once('did-finish-load', () => setTimeout(revealPopup, 80));
  setTimeout(revealPopup, 1500);
  popup.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      popup.hide();
    }
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Codex Pulse');
  tray.on('click', () => {
    if (popup.isVisible()) popup.hide();
    else showPopup();
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Codex Pulse', click: () => showPopup() },
    { label: 'Refresh usage', click: () => popup.webContents.send('usage:refresh') },
    { label: 'Open settings', click: () => { showPopup(); popup.webContents.send('settings:open'); } },
    { type: 'separator' },
    { label: 'Open Codex', click: () => shell.openExternal('https://chatgpt.com/codex') },
    { label: 'Launch at startup', type: 'checkbox', checked: settings.launchAtStartup, click: (item) => commitSettings({ launchAtStartup: item.checked }) },
    { label: 'Quiet mode', type: 'checkbox', checked: settings.quietMode, click: (item) => commitSettings({ quietMode: item.checked }) },
    { type: 'separator' },
    { label: 'Quit Codex Pulse', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPopup();
  });
}

app.whenReady().then(() => {
  loadSettings();
  loadHistory();
  registerGlobalShortcut(settings.globalShortcut);
  applyStartupSetting();
  app.setAppUserModelId('com.codexpulse.desktop');
  createWindow();
  createTray();
  ipcMain.handle('usage:read', () => usageClient.readUsage());
  ipcMain.handle('app:hide', () => popup.hide());
  ipcMain.handle('app:show', () => showPopup());
  ipcMain.handle('app:set-view', (_event, minimized) => setPopupView(Boolean(minimized)));
  ipcMain.handle('app:mini-dragging', (_event, dragging) => {
    miniDragging = Boolean(dragging);
    if (miniDragging) setPetExpanded(false);
    else setPetExpanded(currentActivity.state !== 'idle' && settings.petEnabled);
    return miniDragging;
  });
  ipcMain.handle('app:open-codex', () => shell.openExternal('https://chatgpt.com/codex'));
  ipcMain.handle('settings:read', () => ({ ...settings, globalShortcutError }));
  ipcMain.handle('settings:update', (_event, patch) => commitSettings(patch));
  ipcMain.handle('settings:choose-codex', async () => {
    const result = await dialog.showOpenDialog(popup, {
      title: 'Choose Codex executable',
      properties: ['openFile'],
      filters: [{ name: 'Codex executable', extensions: ['exe'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ...settings };
    return commitSettings({ codexPath: result.filePaths[0] });
  });
  ipcMain.handle('settings:reset-position', () => {
    settings.position = null;
    saveSettings();
    if (isMinimized) setPopupView(false);
    positionPopup();
    return { ...settings };
  });
  ipcMain.handle('history:export', async (_event, format = 'json') => {
    const extension = format === 'csv' ? 'csv' : 'json';
    const result = await dialog.showSaveDialog(popup, {
      title: 'Export Codex usage history',
      defaultPath: path.join(app.getPath('downloads'), `codex-pulse-history.${extension}`),
      filters: [{ name: extension.toUpperCase() + ' file', extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const daily = usageHistory.daily;
    const content = extension === 'csv'
      ? ['date,tokens', ...daily.map((entry) => `${entry.date},${entry.tokens}`)].join('\n')
      : JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), daily, snapshots: usageHistory.snapshots, analytics: latestAnalytics }, null, 2);
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('history:import', async () => {
    const result = await dialog.showOpenDialog(popup, {
      title: 'Import Codex Pulse history backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      const imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      if (!Array.isArray(imported.daily) && !Array.isArray(imported.snapshots)) throw new Error('This file is not a Codex Pulse history backup.');
      if (Array.isArray(imported.daily)) usageHistory.daily = imported.daily.filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(Number(entry.tokens))).map((entry) => ({ date: entry.date, tokens: Math.max(0, Number(entry.tokens)) }));
      if (Array.isArray(imported.snapshots)) usageHistory.snapshots = imported.snapshots.filter((entry) => entry && Number.isFinite(Number(entry.timestamp)));
      saveHistory();
      return { canceled: false, imported: true };
    } catch (error) {
      return { canceled: false, imported: false, error: error.message || 'Unable to import history.' };
    }
  });
  ipcMain.handle('history:clear', async () => {
    const result = await dialog.showMessageBox(popup, {
      type: 'warning',
      buttons: ['Cancel', 'Clear local history'],
      defaultId: 0,
      cancelId: 0,
      title: 'Clear Codex Pulse history?',
      message: 'This removes only Codex Pulse\'s local history. Codex session files will not be changed.',
    });
    if (result.response !== 1) return { cleared: false };
    usageHistory = { daily: [], snapshots: [] };
    saveHistory();
    return { cleared: true };
  });
  ipcMain.handle('tray:update', (_event, data) => {
    updateTrayTooltip(data);
    return true;
  });
  ipcMain.handle('notifications:show', (_event, data) => showUsageNotification(data));
  ipcMain.handle('diagnostics:run', () => runDiagnostics());
  ipcMain.handle('pet:set-expanded', (_event, expanded) => { setPetExpanded(Boolean(expanded)); return petExpanded; });
  ipcMain.handle('pet:clear', () => { clearPetNotification(); return true; });
  ipcMain.handle('app:check-updates', () => checkForUpdates());
  ipcMain.handle('app:download-update', async () => {
    if (!app.isPackaged) return false;
    await autoUpdater.downloadUpdate();
    return true;
  });
  ipcMain.handle('app:install-update', () => {
    if (app.isPackaged) autoUpdater.quitAndInstall();
    return true;
  });
  ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); });
  ipcMain.on('app:move', (_event, delta) => {
    if (!popup || popup.isDestroyed() || !delta) return;
    const dx = Number(delta.dx || 0);
    const dy = Number(delta.dy || 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const moveX = Math.round(dx);
    const moveY = Math.round(dy);
    if (!moveX && !moveY) return;
    if (isMinimized && miniAnchor) {
      // Keep the logo anchor authoritative. Moving the native window first and
      // updating the anchor afterward can race with the pet resize, which makes
      // the activity bubble appear to stretch or drift during a drag.
      expandedBounds = null;
      miniAnchor = safePetAnchor({ x: miniAnchor.x + moveX, y: miniAnchor.y + moveY }, petExpanded);
      popup.setBounds(petBoundsForAnchor(miniAnchor), false);
    } else {
      const [x, y] = popup.getPosition();
      popup.setPosition(Math.round(x + moveX), Math.round(y + moveY), false);
    }
    schedulePositionSave();
  });
  startPolling();
  startActivityBridge();
  setupAutoUpdater();
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  clearInterval(pollTimer);
  activityBridge?.stop();
  clearTimeout(positionSaveTimer);
  clearTimeout(historySaveTimer);
  usageClient.stop();
  globalShortcut.unregisterAll();
  registeredGlobalShortcut = null;
});
