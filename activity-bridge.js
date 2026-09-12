const fs = require('node:fs');
const path = require('node:path');

const IDLE_ACTIVITY = { state: 'idle', text: 'Waiting for Codex' };
const ACTIVE_STALE_MS = 15 * 60 * 1000;
const DONE_VISIBLE_MS = 10 * 60 * 1000;

function safeReadDirectory(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function latestSessionFile(root) {
  let latest = null;
  for (const year of safeReadDirectory(root).filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))) {
    const yearPath = path.join(root, year.name);
    for (const month of safeReadDirectory(yearPath).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
      const monthPath = path.join(yearPath, month.name);
      for (const day of safeReadDirectory(monthPath).filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
        const dayPath = path.join(monthPath, day.name);
        for (const file of safeReadDirectory(dayPath).filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))) {
          const filePath = path.join(dayPath, file.name);
          try {
            const stat = fs.statSync(filePath);
            if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { filePath, mtimeMs: stat.mtimeMs };
          } catch (_) {
            // The current session can be rotated while the directory is scanned.
          }
        }
      }
    }
  }
  return latest?.filePath || null;
}

function recordTime(record) {
  const timestamp = Date.parse(record?.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function liveLimit(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    usedPercent: number(value.used_percent ?? value.usedPercent),
    windowDurationMins: number(value.window_minutes ?? value.windowDurationMins),
    resetsAt: number(value.resets_at ?? value.resetsAt),
  };
}

function toolActivity(name) {
  if (name === 'exec') return 'Running a command...';
  if (name === 'js') return 'Working with a tool...';
  if (name === 'wait') return 'Waiting for the next update...';
  return 'Working with Codex...';
}

class CodexActivityBridge {
  constructor({ homeDir, onActivity, onUsage, intervalMs = 750 } = {}) {
    this.root = path.join(homeDir || process.env.USERPROFILE || process.env.HOME || '', '.codex', 'sessions');
    this.onActivity = typeof onActivity === 'function' ? onActivity : () => {};
    this.onUsage = typeof onUsage === 'function' ? onUsage : () => {};
    this.intervalMs = intervalMs;
    this.timer = null;
    this.filePath = null;
    this.offset = 0;
    this.remainder = '';
    this.accepted = false;
    this.activeTask = false;
    this.taskId = null;
    this.turnUsage = new Map();
    this.latestUsageSignature = '';
    this.latestPrimary = null;
    this.latestSecondary = null;
    this.sessionId = null;
    this.state = IDLE_ACTIVITY.state;
    this.text = IDLE_ACTIVITY.text;
    this.lastEventAt = 0;
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  emit(state, text, timestamp = Date.now()) {
    this.lastEventAt = timestamp;
    if (this.state === state && this.text === text) return;
    this.state = state;
    this.text = text;
    this.onActivity({ state, text, source: 'vscode-session-bridge', sessionId: this.sessionId, threadId: this.taskId });
  }

  resetForFile(filePath) {
    this.filePath = filePath;
    this.offset = 0;
    this.remainder = '';
    this.accepted = false;
    this.activeTask = false;
    this.taskId = null;
    this.turnUsage.clear();
    this.latestUsageSignature = '';
    this.latestPrimary = null;
    this.latestSecondary = null;
    this.sessionId = null;
    this.state = IDLE_ACTIVITY.state;
    this.text = IDLE_ACTIVITY.text;
    this.lastEventAt = 0;
  }

  processEvent(record, timestamp) {
    const payload = record?.payload || {};
    const type = payload.type;
    if (type === 'task_started') {
      this.activeTask = true;
      this.taskId = payload.turn_id || payload.turnId || null;
      this.emit('working', 'Starting Codex...', timestamp);
      return;
    }
    if (type === 'task_complete') {
      this.activeTask = false;
      this.emit('done', 'Codex finished the task.', timestamp);
      return;
    }
    if (type === 'turn_aborted') {
      this.activeTask = false;
      this.emit('done', 'Codex stopped the task.', timestamp);
      return;
    }
    if (!this.activeTask) return;
    const labels = {
      patch_apply_begin: 'Updating your files...',
      patch_apply_end: 'Updating your files...',
      mcp_tool_call_begin: 'Working with a tool...',
      mcp_tool_call_end: 'Reviewing the result...',
      web_search_begin: 'Searching for context...',
      web_search_end: 'Reviewing search results...',
      agent_message: 'Writing a response...',
    };
    if (labels[type]) this.emit('working', labels[type], timestamp);
  }

  processTokenCount(record, timestamp) {
    const info = record?.payload?.info || {};
    const usage = info.last_token_usage || info.lastTokenUsage;
    if (!usage) return;
    const inputTokens = number(usage.input_tokens ?? usage.inputTokens);
    const outputTokens = number(usage.output_tokens ?? usage.outputTokens);
    const reasoningTokens = number(usage.reasoning_output_tokens ?? usage.reasoningTokens ?? usage.reasoning);
    const totalTokens = number(usage.total_tokens ?? usage.totalTokens);
    const turnKey = this.taskId || `session:${this.sessionId || 'current'}`;
    const day = dateKey(timestamp);
    const usageKey = `${day}:${turnKey}`;
    if (totalTokens !== null) this.turnUsage.set(usageKey, Math.max(this.turnUsage.get(usageKey) || 0, totalTokens));
    const dailyTokens = [...this.turnUsage.entries()]
      .filter(([key]) => key.startsWith(`${day}:`))
      .reduce((sum, [, value]) => sum + value, 0);
    const primary = liveLimit(record.payload.rate_limits?.primary || record.payload.rateLimits?.primary);
    const secondary = liveLimit(record.payload.rate_limits?.secondary || record.payload.rateLimits?.secondary);
    if (primary) this.latestPrimary = primary;
    if (secondary) this.latestSecondary = secondary;
    const next = {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      dailyTokens,
      date: day,
      primary: this.latestPrimary,
      secondary: this.latestSecondary,
      sessionId: this.sessionId,
      threadId: this.taskId,
      updatedAt: timestamp,
    };
    const signature = JSON.stringify(next);
    if (signature === this.latestUsageSignature) return;
    this.latestUsageSignature = signature;
    this.onUsage(next);
  }

  processTokenUsageRecord(record, timestamp) {
    const payload = record.payload || {};
    const usage = payload.turn_token_usage || payload.turnTokenUsage;
    const totalTokens = number(usage?.total_tokens ?? usage?.totalTokens);
    if (totalTokens === null) return;
    const day = dateKey(timestamp);
    const turnKey = payload.turn_id || payload.turnId || this.taskId || `session:${this.sessionId || 'current'}`;
    const usageKey = `${day}:${turnKey}`;
    this.turnUsage.set(usageKey, Math.max(this.turnUsage.get(usageKey) || 0, totalTokens));
    const dailyTokens = [...this.turnUsage.entries()]
      .filter(([key]) => key.startsWith(`${day}:`))
      .reduce((sum, [, value]) => sum + value, 0);
    const next = {
      inputTokens: number(usage.input_tokens ?? usage.inputTokens),
      outputTokens: number(usage.output_tokens ?? usage.outputTokens),
      reasoningTokens: number(usage.reasoning_output_tokens ?? usage.reasoningTokens ?? usage.reasoning),
      totalTokens,
      dailyTokens,
      date: day,
      primary: this.latestPrimary,
      secondary: this.latestSecondary,
      sessionId: this.sessionId,
      threadId: turnKey,
      updatedAt: timestamp,
    };
    const signature = JSON.stringify(next);
    if (signature === this.latestUsageSignature) return;
    this.latestUsageSignature = signature;
    this.onUsage(next);
  }

  processRecord(record) {
    if (!record || typeof record !== 'object') return;
    const timestamp = recordTime(record);
    if (record.type === 'session_meta') {
      const payload = record.payload || {};
      this.accepted = payload.source === 'vscode' || payload.originator === 'codex_vscode';
      this.sessionId = payload.session_id || payload.id || null;
      return;
    }
    if (!this.accepted) return;
    if (record.type === 'event_msg') {
      this.processEvent(record, timestamp);
      if (record.payload?.type === 'token_count') this.processTokenCount(record, timestamp);
      return;
    }
    if (record.type === 'token_usage_record') {
      this.processTokenUsageRecord(record, timestamp);
      return;
    }
    if (record.type !== 'response_item' || !this.activeTask) return;
    const payload = record.payload || {};
    if (payload.type === 'reasoning') this.emit('working', 'Thinking through it...', timestamp);
    else if (payload.type === 'custom_tool_call' || payload.type === 'function_call') this.emit('working', toolActivity(payload.name), timestamp);
    else if (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output') this.emit('working', 'Reviewing the result...', timestamp);
    else if (payload.type === 'message' && payload.role === 'assistant') this.emit('working', 'Writing a response...', timestamp);
  }

  readAppendedData(stat) {
    if (stat.size < this.offset) {
      this.offset = 0;
      this.remainder = '';
    }
    if (stat.size === this.offset) return false;
    let bytesRead = 0;
    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const buffer = Buffer.alloc(stat.size - this.offset);
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, this.offset);
      const lines = (this.remainder + buffer.toString('utf8', 0, bytesRead)).split(/\r?\n/);
      this.remainder = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.processRecord(JSON.parse(line)); } catch (_) { /* Ignore malformed or incomplete records. */ }
      }
    } catch (_) {
      return false;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) { /* The file may have been rotated. */ }
      }
    }
    this.offset += bytesRead;
    return bytesRead > 0;
  }

  poll() {
    const nextFile = latestSessionFile(this.root);
    if (!nextFile) {
      const hadActivity = this.activeTask || this.state !== IDLE_ACTIVITY.state;
      this.filePath = null;
      this.offset = 0;
      this.remainder = '';
      this.accepted = false;
      this.activeTask = false;
      this.taskId = null;
      this.sessionId = null;
      this.turnUsage.clear();
      this.latestUsageSignature = '';
      this.latestPrimary = null;
      this.latestSecondary = null;
      if (hadActivity) this.emit('idle', IDLE_ACTIVITY.text);
      return;
    }
    if (nextFile !== this.filePath) {
      const hadActivity = this.activeTask || this.state !== IDLE_ACTIVITY.state;
      this.resetForFile(nextFile);
      if (hadActivity) this.onActivity({ ...IDLE_ACTIVITY, source: 'vscode-session-bridge', sessionId: null, threadId: null });
    }
    let stat;
    try { stat = fs.statSync(this.filePath); } catch (_) { return; }
    const changed = this.readAppendedData(stat);
    const age = Date.now() - this.lastEventAt;
    if (!changed && this.activeTask && this.lastEventAt && age > ACTIVE_STALE_MS) {
      this.activeTask = false;
      this.emit('idle', IDLE_ACTIVITY.text);
    } else if (!changed && this.state === 'done' && this.lastEventAt && age > DONE_VISIBLE_MS) {
      this.emit('idle', IDLE_ACTIVITY.text);
    }
  }
}

module.exports = { CodexActivityBridge, latestSessionFile };
