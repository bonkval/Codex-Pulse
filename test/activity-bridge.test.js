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

test('bridges live token counts and rate limits from the VS Code session', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pulse-'));
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '09', '11');
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, 'rollout-token-test.jsonl');
  const timestamp = new Date().toISOString();
  const tokenPayload = {
    type: 'token_count',
    info: { last_token_usage: { input_tokens: 120, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 160 } },
    rate_limits: { primary: { used_percent: 12 }, secondary: { used_percent: 4 } },
  };
  fs.writeFileSync(sessionPath, [
    JSON.stringify({ timestamp, type: 'session_meta', payload: { source: 'vscode', session_id: 'token-session' } }),
    JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'token-turn' } }),
    JSON.stringify({ timestamp, type: 'event_msg', payload: tokenPayload }),
    '',
  ].join('\n'));
  const usage = [];
  const bridge = new CodexActivityBridge({ homeDir, onUsage: (value) => usage.push(value) });
  bridge.poll();
  assert.equal(usage.at(-1).totalTokens, 160);
  assert.equal(usage.at(-1).dailyTokens, 160);
  assert.equal(usage.at(-1).primary.used_percent, 12);
  bridge.stop();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('returns to idle when the active session file disappears', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pulse-'));
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '09', '11');
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, 'rollout-disappearing.jsonl');
  const record = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
  fs.writeFileSync(sessionPath, record('session_meta', { source: 'vscode' }) + record('event_msg', { type: 'task_started', turn_id: 'disappearing-turn' }));
  const events = [];
  const bridge = new CodexActivityBridge({ homeDir, onActivity: (activity) => events.push(activity) });
  bridge.poll();
  assert.equal(events.at(-1).state, 'working');
  fs.rmSync(sessionPath);
  bridge.poll();
  assert.equal(events.at(-1).state, 'idle');
  bridge.stop();
  fs.rmSync(homeDir, { recursive: true, force: true });
});
