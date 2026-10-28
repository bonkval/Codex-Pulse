const { parentPort } = require('node:worker_threads');
const { scanSessionAnalytics } = require('./session-analytics');
parentPort.on('message', ({ root, retentionDays }) => {
  try { parentPort.postMessage(scanSessionAnalytics(root, { retentionDays })); }
  catch (_) { parentPort.postMessage(null); }
});
