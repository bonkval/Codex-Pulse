const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const main = fs.readFileSync(require.resolve('../main'), 'utf8');
const renderer = fs.readFileSync(require.resolve('../renderer'), 'utf8');
function declaration(source, name, next) { return source.slice(source.indexOf('function ' + name + '('), source.indexOf('\nfunction ' + next + '(')); }
test('taskbar persistence restores its top position without taking focus', () => {
  let tick; let raised = 0;
  const window = { isDestroyed: () => false, setAlwaysOnTop() {}, showInactive() {}, isVisible: () => true, moveTop: () => raised++, webContents: { isLoading: () => false, send() {} } };
  const context = vm.createContext({ taskbarWindow: window, settings: { taskbarMode: true }, positionTaskbarStatus() {}, latestTaskbarStatus: null, taskbarStatusTimer: null, clearInterval() {}, setInterval(fn) { tick = fn; return 1; } });
  vm.runInContext(declaration(main, 'showTaskbarStatus', 'hideTaskbarStatus'), context);
  vm.runInContext('showTaskbarStatus()', context); raised = 0; tick();
  assert.ok(raised > 0, 'taskbar must recover above Windows taskbar after switching applications');
});
test('notification thresholds advance through each configured low-usage level', () => {
  const context = vm.createContext({});
  vm.runInContext(declaration(renderer, 'notificationThreshold', 'checkNotifications'), context);
  assert.equal(vm.runInContext('notificationThreshold(8, [50,25,10])', context), 10);
  assert.equal(vm.runInContext('notificationThreshold(23, [50,25,10])', context), 25);
});
test('missing token values remain unavailable instead of displaying zero', () => {
  const context = vm.createContext({});
  vm.runInContext(declaration(renderer, 'numeric', 'formatTokens'), context);
  assert.equal(vm.runInContext('numeric(null)', context), null);
});

test('both usage windows notify on crossings and rearm after recovery', () => {
  const calls = [];
  const context = vm.createContext({ notificationLevels: { primary: undefined, secondary: undefined }, previousResetTimes: { primary: null, secondary: null }, lastTodayTokens: null, settings: { notificationsEnabled: true, primaryAlertThresholds: [50,25,10], secondaryAlertThresholds: [50,25,10], dailyTokenTarget: 0 }, numeric: value => value == null ? null : Number(value), remainingPercent: value => value ? 100-value.usedPercent : null, window: { codexPulse: { showNotification: value => calls.push(value) } } });
  vm.runInContext(declaration(renderer, 'notificationsSuppressed', 'renderUsage'), context);
  const sync = (primary, secondary) => vm.runInContext(`checkNotifications({primary:{usedPercent:${100-primary}},secondary:{usedPercent:${100-secondary}}},null)`, context);
  sync(80,80); sync(45,45); assert.equal(calls.length,1);
  sync(45,45); assert.equal(calls.length,1);
  sync(22,45); assert.equal(calls.length,2);
  sync(22,22); assert.equal(calls.length,3);
  sync(80,80); sync(8,80); assert.equal(calls.length,4);
});
const boundsSource = declaration(main, 'getTaskbarStatusBounds', 'positionTaskbarStatus');
for (const [label, workArea, expectedY] of [
  ['bottom taskbar', { x:0, y:0, width:1920, height:1032 }, 1038],
  ['top taskbar', { x:0, y:48, width:1920, height:1032 }, 6],
]) test('chip is vertically centered in ' + label, () => {
  const context = vm.createContext({ screen: { getPrimaryDisplay: () => ({ bounds: { x:0, y:0, width:1920, height:1080 }, workArea }) }, TASKBAR_WIDTH:196, TASKBAR_HEIGHT:36, TASKBAR_SYSTEM_TRAY_RESERVE:380 });
  vm.runInContext(boundsSource, context);
  assert.equal(vm.runInContext('getTaskbarStatusBounds().y', context), expectedY);
});
