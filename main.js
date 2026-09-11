const { app, BrowserWindow, Menu, Tray, nativeImage, screen, shell, ipcMain } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');

const WINDOW_WIDTH = 368;
const WINDOW_HEIGHT = 286;
const EDGE_GAP = 22;
const POLL_INTERVAL = 60 * 1000;

let popup;
let tray;
let pollTimer;
let isQuitting = false;

function createTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="#101113"/>
    <path d="M16 5.2c2.4 0 4.3 1.9 4.3 4.3v2.2l1.9-1.1c2.1-1.2 4.7-.5 5.9 1.6 1.2 2.1.5 4.7-1.6 5.9l-1.9 1.1 1.9 1.1c2.1 1.2 2.8 3.8 1.6 5.9-1.2 2.1-3.8 2.8-5.9 1.6l-1.9-1.1V29c0 2.4-1.9 4.3-4.3 4.3s-4.3-1.9-4.3-4.3v-2.2l-1.9 1.1c-2.1 1.2-4.7.5-5.9-1.6-1.2-2.1-.5-4.7 1.6-5.9l1.9-1.1-1.9-1.1c-2.1-1.2-2.8-3.8-1.6-5.9 1.2-2.1 3.8-2.8 5.9-1.6l1.9 1.1V9.5c0-2.4 1.9-4.3 4.3-4.3Z" fill="#f4f1ec" transform="translate(0 -1.7) scale(.88) translate(2.1 2.1)"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function resolveCodexCommand() {
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
  return 'codex';
}

class CodexUsageClient {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.startPromise = null;
  }

  async start() {
    if (this.child && !this.child.killed) return;
    if (this.startPromise) return this.startPromise;

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
        this.startPromise = null;
      });
    });
    return this.startPromise;
  }

  notify(method, params) {
    if (!this.child || this.child.killed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
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
      const result = await this.request('account/rateLimits/read', { excludeResetCreditDetails: true });
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
      return { ok: false, error: error.message || 'Unable to read Codex usage', updatedAt: Date.now() };
    }
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
  }
}

const usageClient = new CodexUsageClient();

function positionPopup() {
  if (!popup) return;
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  popup.setPosition(x + width - WINDOW_WIDTH - EDGE_GAP, y + height - WINDOW_HEIGHT - EDGE_GAP, false);
}

function createWindow() {
  popup = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    maxHeight: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popup.setAlwaysOnTop(true, 'floating');
  popup.loadFile(path.join(__dirname, 'index.html'));
  popup.once('ready-to-show', () => {
    positionPopup();
    if (!process.argv.includes('--hidden')) popup.showInactive();
  });
  popup.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      popup.hide();
    }
  });
  screen.on('display-metrics-changed', positionPopup);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Codex Pulse');
  tray.on('click', () => {
    if (popup.isVisible()) popup.hide();
    else { positionPopup(); popup.showInactive(); }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Codex Pulse', click: () => { positionPopup(); popup.showInactive(); } },
    { label: 'Refresh usage', click: () => popup.webContents.send('usage:refresh') },
    { type: 'separator' },
    { label: 'Open Codex', click: () => shell.openExternal('https://chatgpt.com/codex') },
    { label: 'Launch at startup', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Quit Codex Pulse', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.codexpulse.desktop');
  createWindow();
  createTray();
  ipcMain.handle('usage:read', () => usageClient.readUsage());
  ipcMain.handle('app:hide', () => popup.hide());
  ipcMain.handle('app:show', () => { positionPopup(); popup.showInactive(); });
  ipcMain.handle('app:open-codex', () => shell.openExternal('https://chatgpt.com/codex'));
  ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); });
  app.setLoginItemSettings({ openAtLogin: true });
  pollTimer = setInterval(() => {
    if (popup && !popup.isDestroyed()) popup.webContents.send('usage:refresh');
  }, POLL_INTERVAL);
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  clearInterval(pollTimer);
  usageClient.stop();
});
