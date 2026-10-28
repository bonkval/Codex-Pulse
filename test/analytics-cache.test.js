const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSessionAnalytics } = require('../session-analytics');
test('unchanged sessions are cached, appended and deleted sessions invalidate cache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cache-'));
  const day = path.join(root, '2026', '10', '28');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'session.jsonl');
  const record = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
  fs.writeFileSync(file, record('session_meta', { source: 'vscode', id: 'cached' }) + '\n');
  try {
    scanSessionAnalytics(root);
    const original = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = (...args) => { reads++; return original(...args); };
    try { scanSessionAnalytics(root); } finally { fs.readFileSync = original; }
    assert.equal(reads, 0, 'unchanged refresh must not reread session contents');
    fs.appendFileSync(file, record('token_usage_record', { turn_id: 'one', turn_token_usage: { total_tokens: 123 } }) + '\n');
    assert.equal(scanSessionAnalytics(root).sessions[0].totalTokens, 123);
    fs.unlinkSync(file);
    assert.equal(scanSessionAnalytics(root).sessions.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
