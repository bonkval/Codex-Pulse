const $ = (id) => document.getElementById(id);

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function renderStatus(status) {
  if (!status) return;
  $('primary-value').textContent = valueOrDash(status.primary);
  $('secondary-value').textContent = valueOrDash(status.secondary);
  $('today-value').textContent = valueOrDash(status.today).replace(' tokens', '');
  const activity = status.activity?.state === 'working' ? (status.activity.text || 'Working') : 'Idle';
  $('activity-value').textContent = activity;
}

$('taskbar-status').addEventListener('click', () => window.codexPulse.show());
$('taskbar-status').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    window.codexPulse.show();
  }
});
window.codexPulse.onTaskbarStatus(renderStatus);
