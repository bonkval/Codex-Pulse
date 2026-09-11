const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSessionAnalytics } = require('../session-analytics');

test('scans local session metadata without retaining message content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-pulse-'));
  const day = path.join(root, '2026', '09', '11');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'rollout-analytics.jsonl');
  const record = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
  fs.writeFileSync(file, [
    record('2026-09-11T10:00:00.000Z', 'session_meta', { source: 'vscode', session_id: 'session-1', cwd: 'C:\\Projects\\Pulse' }),
    record('2026-09-11T10:01:00.000Z', 'event_msg', { type: 'task_started', turn_id: 'turn-1' }),
    record('2026-09-11T10:02:00.000Z', 'token_usage_record', { turn_id: 'turn-1', turn_token_usage: { input_tokens: 100, output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 150 } }),
    record('2026-09-11T10:03:00.000Z', 'event_msg', { type: 'task_complete' }),
  ].join('\n'));
  const result = scanSessionAnalytics(root, { retentionDays: 90 });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].project, 'Pulse');
  assert.equal(result.sessions[0].totalTokens, 150);
  assert.equal(result.sessions[0].status, 'Complete');
  assert.equal(result.projects[0].totalTokens, 150);
  assert.equal(result.sessions[0].prompt, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});
