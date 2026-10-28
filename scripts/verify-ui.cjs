const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const out = path.join(root, 'verification');
fs.mkdirSync(out, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let win; let other;
  try {
    const errors = [];
    let settings = { theme: 'dark', refreshInterval: 30, primaryAlertThresholds: [50,25,10], secondaryAlertThresholds: [50,25,10], popupSize: 'normal', popupOpacity: 100, alwaysOnTop: true, notificationsEnabled: true };
    const today = new Date().toLocaleDateString('en-CA');
    const usage = { ok: true, updatedAt: Date.now(), primary: { usedPercent: 28, resetsAt: Date.now()/1000+7200 }, secondary: { usedPercent: 54, resetsAt: Date.now()/1000+86400 }, localHistory: [{ date: today, tokens: 128000 }], tokenActivity: { lifetimeTokens: 8200000, peakDailyTokens: 440000, currentStreakDays: 5 }, analytics: { sessions: [], projects: [], models: [] } };
    ipcMain.handle('settings:read', () => settings);
    ipcMain.handle('settings:update', (_, patch) => (settings = { ...settings, ...patch }));
    for (const name of ['app:check-updates','pet:set-expanded','tray:update','notifications:show']) ipcMain.handle(name, () => null);
    ipcMain.handle('usage:read', () => usage);
    win = new BrowserWindow({ width: 420, height: 620, show: false, frame: false, transparent: true, webPreferences: { preload: path.join(root, 'preload.js'), offscreen: true } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(root, 'index.html')); await delay(400);
    const run = code => win.webContents.executeJavaScript(code);
    assert.equal(await run("document.getElementById('primary-percent').textContent"), '72%');
    win.webContents.send('usage:live', { primary: { usedPercent: 40 }, liveDailyUsage: { date: today, tokens: 129000 } }); await delay(220);
    assert.equal(await run("document.getElementById('primary-percent').textContent"), '60%');
    assert.equal(await run("document.getElementById('today-tokens').textContent"), '129K');
    await run("renderUsage({ok:false}); renderUsage(" + JSON.stringify(usage) + ")");
    assert.ok(await run("document.querySelectorAll('.history-column').length > 0"));
    for (const [label, width, height] of [['normal',420,620],['small',380,560],['large',480,700]]) {
      win.setSize(width,height); await delay(80);
      assert.equal(await run("document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth"), true, label + ' header overflow');
      fs.writeFileSync(path.join(out, label + '-dark.png'), (await win.webContents.capturePage()).toPNG());
    }
    win.setSize(420,620);
    await run("document.getElementById('settings-button').click()"); await delay(100);
    fs.writeFileSync(path.join(out, 'settings-dark.png'), (await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('.advanced-settings').open=true"); await delay(80);
    assert.ok(await run("document.getElementById('export-json-button') && document.getElementById('pet-toggle') && document.getElementById('shortcut-input')"));
    await run("closeSettings(); document.getElementById('usage-details').open=true"); await delay(100);
    assert.equal(await run("getComputedStyle(document.getElementById('peak-daily-tokens').parentElement).display !== 'none'"), true);
    await run("applyTheme('light')"); await delay(80);
    fs.writeFileSync(path.join(out, 'light.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    win.destroy();
    // Exercise the production persistence function with real native Windows windows.
    win = new BrowserWindow({ width: 196, height: 36, show: true, focusable: false, frame: false, alwaysOnTop: true, transparent: true, backgroundMaterial: 'none', webPreferences: { preload: path.join(root, 'taskbar-preload.js') } });
    await win.loadFile(path.join(root, 'taskbar.html'));
    await win.webContents.executeJavaScript("document.body.dataset.theme='dark'; document.getElementById('primary-value').textContent='72%';document.getElementById('secondary-value').textContent='46%';document.getElementById('today-value').textContent='128K';");
    await delay(100); fs.writeFileSync(path.join(out, 'taskbar-dark.png'), (await win.webContents.capturePage()).toPNG());
    const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const source = main.slice(main.indexOf('function showTaskbarStatus()'), main.indexOf('\nfunction hideTaskbarStatus()'));
    let tick;
    const context = vm.createContext({ taskbarWindow: win, settings: { taskbarMode: true }, positionTaskbarStatus() {}, latestTaskbarStatus: null, taskbarStatusTimer: null, clearInterval() {}, setInterval(fn) { tick=fn; return 1; } });
    vm.runInContext(source + '\nshowTaskbarStatus()', context);
    other = new BrowserWindow({ width: 300, height: 100, show: true });
    for (let i=0;i<3;i++) {
      other.focus(); await delay(50); tick();
      assert.equal(win.isVisible(), true); assert.equal(win.isAlwaysOnTop(), true); assert.equal(win.isFocused(), false);
    }
    console.log('PASS: live numbers, offline recovery, 3 sizes, both themes, advanced features, native persistence across 3 focus switches; 0 renderer errors.');
    fs.writeFileSync(path.join(out, 'result.txt'), 'PASS: UI smoke and native persistence checks. Unit regressions run separately.\n');
    other.destroy(); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); other?.destroy(); win?.destroy(); app.exit(1); }
});

