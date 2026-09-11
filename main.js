const { app, BrowserWindow, Menu, Tray, nativeImage, screen, shell, ipcMain, dialog, Notification } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const WINDOW_WIDTH = 368;
const WINDOW_HEIGHT = 286;
const MINI_SIZE = 48;
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
  position: null,
};

let popup;
let tray;
let pollTimer;
let positionSaveTimer;
let isQuitting = false;
let isMinimized = false;
let expandedBounds = null;
let settings = { ...DEFAULT_SETTINGS };
let latestUpdateState = { status: 'checking' };
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      refreshInterval: [15, 30, 60].includes(Number(saved.refreshInterval)) ? Number(saved.refreshInterval) : DEFAULT_SETTINGS.refreshInterval,
      theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
      position: saved.position && Number.isFinite(Number(saved.position.x)) && Number.isFinite(Number(saved.position.y))
        ? { x: Number(saved.position.x), y: Number(saved.position.y) }
        : null,
    };
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
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
  saveSettings();
  return { ...settings };
}

function commitSettings(patch) {
  const previous = { ...settings };
  const next = updateSettings(patch);
  if (previous.launchAtStartup !== next.launchAtStartup) applyStartupSetting();
  if (previous.refreshInterval !== next.refreshInterval) startPolling();
  if (previous.codexPath !== next.codexPath) usageClient.stop();
  if (next.quietMode && !previous.quietMode && popup && !popup.isDestroyed()) popup.hide();
  return next;
}

function applyStartupSetting() {
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (popup && !popup.isDestroyed()) popup.webContents.send('usage:refresh');
  }, settings.refreshInterval * 1000);
}

function schedulePositionSave() {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    if (!popup || popup.isDestroyed()) return;
    const bounds = expandedBounds || popup.getBounds();
    settings.position = { x: bounds.x, y: bounds.y };
    saveSettings();
  }, 250);
}

function updateTrayTooltip(data) {
  if (!tray || tray.isDestroyed()) return;
  const primaryValue = data?.primary === null || data?.primary === undefined || data?.primary === '' ? null : Number(data.primary);
  const secondaryValue = data?.secondary === null || data?.secondary === undefined || data?.secondary === '' ? null : Number(data.secondary);
  const primary = Number.isFinite(primaryValue) ? `${Math.round(primaryValue)}%` : '—';
  const secondary = Number.isFinite(secondaryValue) ? `${Math.round(secondaryValue)}%` : '—';
  tray.setToolTip(`Codex Pulse · 5-hour ${primary} remaining · weekly ${secondary} remaining`);
}

function showUsageNotification(data) {
  if (!settings.notificationsEnabled || !Notification.isSupported()) return false;
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
  new Notification({ title, body, silent: true }).show();
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
    x < workArea.x + workArea.width && x + MINI_SIZE > workArea.x
      && y < workArea.y + workArea.height && y + MINI_SIZE > workArea.y
  ));
}

function clampPosition(x, y) {
  const display = screen.getDisplayMatching({ x, y, width: MINI_SIZE, height: MINI_SIZE });
  const { workArea } = display;
  return {
    x: Math.max(workArea.x + EDGE_GAP, Math.min(x, workArea.x + workArea.width - WINDOW_WIDTH - EDGE_GAP)),
    y: Math.max(workArea.y + EDGE_GAP, Math.min(y, workArea.y + workArea.height - WINDOW_HEIGHT - EDGE_GAP)),
  };
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

class CodexUsageClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.ready = false;
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
      return {
        ok: true,
        primary: snapshot.primary || null,
        secondary: snapshot.secondary || null,
        planType: snapshot.planType || null,
        credits: snapshot.credits || null,
        ordinaryUsageAllowed: result.ordinaryUsageAllowed,
        updatedAt: Date.now(),
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
  const { x, y, width, height } = display.workArea;
  const saved = settings.position;
  if (saved && isPositionVisible(saved.x, saved.y)) {
    const position = clampPosition(saved.x, saved.y);
    popup.setPosition(position.x, position.y, false);
    return;
  }
  const position = clampPosition(x + width - WINDOW_WIDTH - EDGE_GAP, y + height - WINDOW_HEIGHT - EDGE_GAP);
  popup.setPosition(position.x, position.y, false);
}

function showPopup() {
  if (!popup || popup.isDestroyed()) return;
  if (!isMinimized) {
    const bounds = popup.getBounds();
    if (bounds.width !== WINDOW_WIDTH || bounds.height !== WINDOW_HEIGHT) {
      popup.setBounds({ x: bounds.x, y: bounds.y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }, false);
    }
  }
  app.focus({ steal: true });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.show();
  popup.focus();
  popup.moveTop();
  if (!popup.webContents.isLoading()) popup.webContents.send('usage:refresh');
}

function setPopupView(minimized) {
  if (!popup || popup.isDestroyed() || isMinimized === minimized) return;
  const bounds = popup.getBounds();
  isMinimized = minimized;
  if (minimized) {
    expandedBounds = bounds;
    popup.setBounds({
      x: Math.round(bounds.x + LOGO_ANCHOR_X + (LOGO_MARK_SIZE - MINI_SIZE) / 2),
      y: Math.round(bounds.y + LOGO_ANCHOR_Y + (LOGO_MARK_SIZE - MINI_SIZE) / 2),
      width: MINI_SIZE,
      height: MINI_SIZE,
    }, false);
  } else {
    const restoreBounds = expandedBounds || bounds;
    popup.setBounds({
      x: restoreBounds.x,
      y: restoreBounds.y,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    }, false);
    expandedBounds = null;
  }
  schedulePositionSave();
  popup.webContents.send('window:view', minimized ? 'mini' : 'full');
  showPopup();
}

function createWindow() {
  popup = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MINI_SIZE,
    maxWidth: WINDOW_WIDTH,
    minHeight: MINI_SIZE,
    maxHeight: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
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
  popup.setAlwaysOnTop(true, 'screen-saver');
  positionPopup();
  popup.loadFile(path.join(__dirname, 'index.html'));
  const revealPopup = () => {
    if (popup.isDestroyed() || process.argv.includes('--hidden') || settings.quietMode) return;
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
  applyStartupSetting();
  app.setAppUserModelId('com.codexpulse.desktop');
  createWindow();
  createTray();
  ipcMain.handle('usage:read', () => usageClient.readUsage());
  ipcMain.handle('app:hide', () => popup.hide());
  ipcMain.handle('app:show', () => showPopup());
  ipcMain.handle('app:set-view', (_event, minimized) => setPopupView(Boolean(minimized)));
  ipcMain.handle('app:open-codex', () => shell.openExternal('https://chatgpt.com/codex'));
  ipcMain.handle('settings:read', () => ({ ...settings }));
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
  ipcMain.handle('tray:update', (_event, data) => {
    updateTrayTooltip(data);
    return true;
  });
  ipcMain.handle('notifications:show', (_event, data) => showUsageNotification(data));
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
    if (isMinimized) expandedBounds = null;
    const [x, y] = popup.getPosition();
    popup.setPosition(Math.round(x + Number(delta.dx || 0)), Math.round(y + Number(delta.dy || 0)), false);
    schedulePositionSave();
  });
  startPolling();
  setupAutoUpdater();
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  clearInterval(pollTimer);
  clearTimeout(positionSaveTimer);
  usageClient.stop();
});
