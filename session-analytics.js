const fs = require('node:fs');
const path = require('node:path');

const MAX_ANALYTICS_FILES = 1000;
const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;

function safeEntries(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return []; }
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function timestamp(record) {
  const parsed = Date.parse(record?.timestamp || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value) {
  const date = new Date(value);
  return date.toISOString().slice(0, 10);
}

function firstValue(records, keys) {
  for (const record of records) {
    const payload = record?.payload || record?.params || record || {};
    for (const key of keys) {
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') return payload[key];
      if (payload.info?.[key] !== undefined && payload.info?.[key] !== null && payload.info?.[key] !== '') return payload.info[key];
    }
  }
  return null;
}

function cleanProject(value) {
  if (!value || typeof value !== 'string') return 'Unknown project';
  const normalized = value.trim().replace(/[\\/]+$/, '');
  return normalized ? path.basename(normalized) : 'Unknown project';
}

function parseSession(filePath, stat) {
  const records = [];
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (_) { /* Ignore incomplete records. */ }
  }
  const meta = records.find((record) => record?.type === 'session_meta')?.payload || {};
  if (!(meta.source === 'vscode' || meta.originator === 'codex_vscode')) return null;
  const times = records.map(timestamp).filter((value) => value !== null);
  if (!times.length) return null;

  const sessionId = meta.session_id || meta.sessionId || meta.id || path.basename(filePath, '.jsonl');
  const turns = new Map();
  let currentTurn = null;
  let completed = false;
  let aborted = false;
  for (const record of records) {
    const payload = record?.payload || {};
    const type = payload.type;
    if (type === 'task_started') {
      currentTurn = payload.turn_id || payload.turnId || `turn-${turns.size + 1}`;
      if (!turns.has(currentTurn)) turns.set(currentTurn, { total: 0, input: 0, output: 0, reasoning: 0, startedAt: timestamp(record) });
    }
    if (type === 'task_complete') { completed = true; currentTurn = null; }
    if (type === 'turn_aborted') { aborted = true; currentTurn = null; }
    const usage = payload.turn_token_usage || payload.turnTokenUsage || payload.info?.last_token_usage || payload.info?.lastTokenUsage;
    if (!usage) continue;
    const turnId = payload.turn_id || payload.turnId || currentTurn || `turn-${turns.size + 1}`;
    const turn = turns.get(turnId) || { total: 0, input: 0, output: 0, reasoning: 0, startedAt: timestamp(record) };
    turn.total = Math.max(turn.total, numeric(usage.total_tokens ?? usage.totalTokens) || 0);
    turn.input = Math.max(turn.input, numeric(usage.input_tokens ?? usage.inputTokens) || 0);
    turn.output = Math.max(turn.output, numeric(usage.output_tokens ?? usage.outputTokens) || 0);
    turn.reasoning = Math.max(turn.reasoning, numeric(usage.reasoning_output_tokens ?? usage.reasoningTokens ?? usage.reasoning) || 0);
    turns.set(turnId, turn);
  }

  const totals = [...turns.values()].reduce((result, turn) => ({
    total: result.total + turn.total,
    input: result.input + turn.input,
    output: result.output + turn.output,
    reasoning: result.reasoning + turn.reasoning,
  }), { total: 0, input: 0, output: 0, reasoning: 0 });
  const project = cleanProject(firstValue(records, ['cwd', 'workspace', 'workspace_path', 'workspacePath', 'repository', 'repo', 'project', 'projectPath']));
  const model = String(firstValue(records, ['model', 'model_name', 'modelName']) || 'Unknown model');
  const lastTime = times[times.length - 1];
  return {
    id: String(sessionId),
    file: filePath,
    project,
    model,
    date: dateKey(times[0]),
    startedAt: times[0],
    endedAt: lastTime,
    durationMinutes: Math.max(0, Math.round((lastTime - times[0]) / 60000)),
    totalTokens: totals.total,
    inputTokens: totals.input,
    outputTokens: totals.output,
    reasoningTokens: totals.reasoning,
    turns: turns.size,
    status: completed ? 'Complete' : (aborted ? 'Stopped' : 'In progress'),
    updatedAt: stat?.mtimeMs || lastTime,
  };
}

function sessionFiles(root) {
  const files = [];
  for (const year of safeEntries(root).filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))) {
    for (const month of safeEntries(path.join(root, year.name)).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
      for (const day of safeEntries(path.join(root, year.name, month.name)).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
        const directory = path.join(root, year.name, month.name, day.name);
        for (const entry of safeEntries(directory).filter((item) => item.isFile() && item.name.endsWith('.jsonl'))) files.push(path.join(directory, entry.name));
      }
    }
  }
  return files;
}

function aggregate(sessions, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86400000;
  const retained = sessions.filter((session) => session.startedAt >= cutoff).sort((a, b) => b.startedAt - a.startedAt).slice(0, 250);
  const projectMap = new Map();
  const modelMap = new Map();
  for (const session of retained) {
    const project = projectMap.get(session.project) || { name: session.project, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, sessions: 0, lastUsedAt: 0 };
    project.totalTokens += session.totalTokens; project.inputTokens += session.inputTokens; project.outputTokens += session.outputTokens; project.reasoningTokens += session.reasoningTokens; project.sessions += 1; project.lastUsedAt = Math.max(project.lastUsedAt, session.endedAt);
    projectMap.set(session.project, project);
    const model = modelMap.get(session.model) || { name: session.model, totalTokens: 0, sessions: 0 };
    model.totalTokens += session.totalTokens; model.sessions += 1; modelMap.set(session.model, model);
  }
  return {
    sessions: retained,
    projects: [...projectMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    models: [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
  };
}

function scanSessionAnalytics(root, { retentionDays = 90 } = {}) {
  const sessions = [];
  const candidates = sessionFiles(root).map((filePath) => {
    try { return { filePath, stat: fs.statSync(filePath) }; } catch (_) { return null; }
  }).filter((candidate) => candidate && candidate.stat.size <= MAX_SESSION_FILE_BYTES)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, MAX_ANALYTICS_FILES);
  for (const { filePath, stat } of candidates) {
    const session = parseSession(filePath, stat);
    if (session) sessions.push(session);
  }
  return aggregate(sessions, Math.max(1, Number(retentionDays) || 90));
}

module.exports = { scanSessionAnalytics, parseSession };
