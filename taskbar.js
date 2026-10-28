const $ = (id) => document.getElementById(id);

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function renderStatus(status) {
  if (!status) return;
  document.body.dataset.theme = status.theme === 'light' ? 'light' : 'dark';
  $('primary-value').textContent = valueOrDash(status.primary);
  $('secondary-value').textContent = valueOrDash(status.secondary);
  const tokens = Number(String(status.today).replace(/[^0-9.]/g, ''));
  $('today-value').textContent = status.today === '-' ? '-' : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);
  document.body.dataset.activity = status.activity?.state || 'idle';
  const activity = status.activity?.state === 'error'
    ? (status.activity.text || 'Offline')
    : status.activity?.state === 'working'
      ? (status.activity.text || 'Working')
      : 'Idle';
  $('taskbar-status').title = `5h: ${status.primary} | Week: ${status.secondary} | Today: ${status.today} | ${activity}`;
  $('taskbar-status').setAttribute('aria-label', $('taskbar-status').title + '. Open Codex Pulse');
}

$('taskbar-status').addEventListener('click', () => window.codexPulseTaskbar.show());
$('taskbar-status').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    window.codexPulseTaskbar.show();
  }
});
window.codexPulseTaskbar.onStatus(renderStatus);
