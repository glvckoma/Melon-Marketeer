import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(root, 'data', 'marketeer.db');
const logPath = join(root, 'data', 'watchdog.log');
const statePath = join(root, 'data', '.watchdog-state.json');
const ecosystem = join(root, 'ecosystem.local.config.js');

const STALE_MIN = Number(process.env.WATCHDOG_STALE_MIN) || 15;
const BACKOFF_BASE_MIN = Number(process.env.WATCHDOG_BACKOFF_BASE_MIN) || 5;
const BACKOFF_MAX_MIN = Number(process.env.WATCHDOG_BACKOFF_MAX_MIN) || 60;
const BOT = process.env.WATCHDOG_BOT_NAME || 'marketeer-bot';

const log = (line) => {
  const stamp = new Date().toISOString();
  try { appendFileSync(logPath, `${stamp} ${line}\n`); } catch {}
  console.log(`${stamp} ${line}`);
};

const minutesSinceLastObs = () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT MAX(scraped_at) AS m FROM price_observations').get();
    if (!row || !row.m) return Infinity;
    return (Date.now() - row.m) / 60000;
  } finally {
    db.close();
  }
};

const pm2 = (args) => {
  if (process.env.PM2_BIN) {
    return execFileSync(process.env.PM2_BIN, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  }
  const require = createRequire(import.meta.url);
  try {
    const bin = require.resolve('pm2/bin/pm2');
    return execFileSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  } catch {}
  return execFileSync('pm2', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
};

const restartBot = () => {
  for (const args of [['startOrReload', ecosystem, '--only', BOT, '--update-env'], ['save']]) {
    try {
      pm2(args);
      log(`pm2 ${args.join(' ')} -> ok`);
    } catch (err) {
      log(`pm2 ${args.join(' ')} -> FAILED: ${String(err.message).split('\n')[0]}`);
    }
  }
};

const readState = () => {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return {}; }
};

const minutes = (() => {
  try { return minutesSinceLastObs(); } catch (err) {
    log(`db read FAILED: ${String(err.message).split('\n')[0]}; treating as stale`);
    return Infinity;
  }
})();

const stale = minutes > STALE_MIN;
const prev = readState();
const ageLabel = minutes === Infinity ? 'no-data' : `${minutes.toFixed(1)}m`;

const next = {
  stale,
  minutes: minutes === Infinity ? null : minutes,
  ts: Date.now(),
  attempts: Number(prev.attempts) || 0,
  lastRestartTs: Number(prev.lastRestartTs) || 0
};

if (stale) {
  const attempts = next.attempts;
  const requiredGapMin = attempts === 0 ? 0 : Math.min(BACKOFF_BASE_MIN * 2 ** attempts, BACKOFF_MAX_MIN);
  const sinceLastMin = next.lastRestartTs ? (Date.now() - next.lastRestartTs) / 60000 : Infinity;
  if (sinceLastMin >= requiredGapMin) {
    log(`STALE: last observation ${ageLabel} ago (> ${STALE_MIN}m). Restart attempt #${attempts + 1} (${BOT} only).`);
    restartBot();
    next.attempts = attempts + 1;
    next.lastRestartTs = Date.now();
  } else {
    const waitMin = (requiredGapMin - sinceLastMin).toFixed(1);
    log(`STALE: last observation ${ageLabel} ago, holding off (already restarted ${attempts}x; next restart in ~${waitMin}m). Restarting won't fix account starvation - add fresh accounts; the fleet keeps trying meanwhile.`);
  }
} else {
  if (prev.stale || next.attempts > 0) log(`RECOVERED: last observation ${ageLabel} ago (healthy). Backoff reset.`);
  next.attempts = 0;
  next.lastRestartTs = 0;
}

try {
  writeFileSync(statePath, JSON.stringify(next));
} catch {}
