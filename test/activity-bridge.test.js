const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexActivityBridge } = require('../activity-bridge');

function record(type, payload) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
}

test('bridges an active VS Code Codex session and completion', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pulse-'));
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '09', '11');
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, 'rollout-test.jsonl');
  fs.writeFileSync(sessionPath, record('session_meta', { source: 'vscode', originator: 'codex_vscode', session_id: 'test-session' }) + record('event_msg', { type: 'task_started', turn_id: 'test-turn' }));
  const events = [];
  const bridge = new CodexActivityBridge({ homeDir, onActivity: (activity) => events.push(activity) });
  bridge.poll();
  assert.equal(events.at(-1).state, 'working');
  assert.equal(events.at(-1).source, 'vscode-session-bridge');
  fs.appendFileSync(sessionPath, record('event_msg', { type: 'patch_apply_end' }) + record('event_msg', { type: 'task_complete' }));
  bridge.poll();
  assert.equal(events.at(-1).state, 'done');
  bridge.stop();
  fs.rmSync(homeDir, { recursive: true, force: true });
});
