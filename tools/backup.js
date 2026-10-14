const fs = require('fs');
const path = require('path');

function openDriver(dbPath) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(dbPath);
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath);
  }
}

function stamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function rotate(dir, keep) {
  const files = fs.readdirSync(dir).filter((f) => /^marketeer-\d{8}-\d{6}\.db$/.test(f)).sort();
  const excess = Math.max(0, files.length - keep);
  for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(dir, files[i]));
  return excess;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const getArg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'marketeer.db');
  const dir = getArg('--out', path.join(path.dirname(dbPath), 'backups'));
  const keep = Number(getArg('--keep', '14')) || 14;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `marketeer-${stamp(new Date())}.db`);
  const sqlPath = dest.replace(/\\/g, '/').replace(/'/g, "''");
  const db = openDriver(dbPath);
  db.exec(`VACUUM INTO '${sqlPath}'`);
  if (db.close) db.close();
  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  const removed = rotate(dir, keep);
  console.log(`Backup written: ${dest} (${mb} MB)`);
  console.log(`Retention: kept newest ${keep}, removed ${removed} old backup(s).`);
}

module.exports = { stamp, rotate };
