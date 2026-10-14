const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'anomalies.jsonl');

function logAnomaly(kind, owner, raw, extra = {}) {
  try {
    const line = JSON.stringify({
      ts: Date.now(),
      kind,
      owner,
      raw: String(raw).slice(0, 4000),
      ...extra
    });
    fs.appendFileSync(FILE, line + '\n');
  } catch {}
}

function readAnomalies(limit = 100, file = FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const tail = lines.slice(-Math.max(1, Math.min(Number(limit) || 100, 1000)));
  const out = [];
  for (const line of tail) {
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out.reverse();
}

module.exports = { logAnomaly, readAnomalies };
