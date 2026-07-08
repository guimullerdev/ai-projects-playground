'use strict';

// Minimal, uncached scan of today's transcripts, just for the popover's
// "hoje" line. This deliberately does NOT try to be the full historical
// indexer (dedup cache, per-project/model/entrypoint breakdown, pricing) —
// that's v2. Scanning only today's lines keeps this cheap enough to run on
// a slow interval even before that cache exists.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @returns {{ok: boolean, tokens: number, sessions: number, topModel: string|null}}
 */
function scanToday() {
  let files;
  try {
    files = listJsonlFiles(PROJECTS_DIR);
  } catch {
    return { ok: false, tokens: 0, sessions: 0, topModel: null };
  }

  const todayLocal = localDateStr(new Date());
  const seen = new Set();
  const sessions = new Set();
  const modelTokens = new Map();
  let tokens = 0;

  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      // Cheap pre-filter before the JSON.parse: only assistant messages
      // with token usage carry a "usage" key.
      if (!line || !line.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof entry.timestamp !== 'string') continue;
      // Compare in local time, not by string-prefixing the (UTC) ISO
      // timestamp — a plain prefix match drifts by the UTC offset and
      // mislabels the last few hours of the local day as "tomorrow".
      const ts = new Date(entry.timestamp);
      if (Number.isNaN(ts.getTime()) || localDateStr(ts) !== todayLocal) continue;
      const msg = entry.message;
      const usage = msg && msg.usage;
      if (!usage) continue;

      const dedupeKey = `${msg.id || ''}|${entry.requestId || ''}`;
      if (dedupeKey === '|') continue; // no stable id to dedupe on — skip rather than risk double count
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const total = sumUsage(usage);
      tokens += total;
      if (entry.sessionId) sessions.add(entry.sessionId);
      if (msg.model) modelTokens.set(msg.model, (modelTokens.get(msg.model) || 0) + total);
    }
  }

  let topModel = null;
  let topTokens = -1;
  for (const [model, t] of modelTokens) {
    if (t > topTokens) { topModel = model; topTokens = t; }
  }

  return { ok: true, tokens, sessions: sessions.size, topModel };
}

function sumUsage(usage) {
  return (usage.input_tokens || 0)
    + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

function listJsonlFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      result.push(full);
    }
  }
  return result;
}

module.exports = { scanToday };
