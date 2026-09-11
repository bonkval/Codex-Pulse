const test = require('node:test');
const assert = require('node:assert/strict');
const { remainingPercent, levelFor, thresholdFor } = require('../usage-logic');

test('calculates remaining usage from used percent', () => {
  assert.equal(remainingPercent({ usedPercent: 98 }), 2);
  assert.equal(remainingPercent({ usedPercent: 0 }), 100);
  assert.equal(remainingPercent({ usedPercent: 140 }), 0);
});

test('returns null for missing usage data', () => {
  assert.equal(remainingPercent(null), null);
  assert.equal(remainingPercent({}), null);
});

test('assigns warning levels and notification thresholds', () => {
  assert.equal(levelFor(80), 'healthy');
  assert.equal(levelFor(25), 'warning');
  assert.equal(levelFor(10), 'critical');
  assert.equal(thresholdFor(24), 25);
  assert.equal(thresholdFor(10), 10);
  assert.equal(thresholdFor(5), 5);
  assert.equal(thresholdFor(26), null);
});
