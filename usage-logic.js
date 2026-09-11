(function exposeUsageLogic(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.codexPulseUsage = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function remainingPercent(window) {
    if (!window || window.usedPercent === null || window.usedPercent === undefined || window.usedPercent === '') return null;
    const used = Number(window && window.usedPercent);
    return Number.isFinite(used) ? clamp(100 - used) : null;
  }

  function levelFor(percent) {
    if (percent === null) return 'unknown';
    if (percent <= 10) return 'critical';
    if (percent <= 25) return 'warning';
    return 'healthy';
  }

  function thresholdFor(percent) {
    if (percent === null || percent > 25) return null;
    if (percent <= 5) return 5;
    if (percent <= 10) return 10;
    return 25;
  }

  return { clamp, remainingPercent, levelFor, thresholdFor };
}));
