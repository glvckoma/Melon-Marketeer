const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../db/Database.js');

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

const DEFAULT_FILES = [path.join(appDataDir(), 'strawberry-jam', 'UsernameLogger', 'collected_usernames.txt')];

function extractUsernames(text) {
  return text.split(/\r?\n/).map((line) => {
    line = line.trim();
    const m = line.match(/ - (.+)$/);
    return (m ? m[1] : line).trim();
  }).filter((name) => name && !/^\d+$/.test(name));
}

const args = process.argv.slice(2);
const files = args.length ? args : DEFAULT_FILES;
const db = new Database();

let processed = 0;
let added = 0;
for (const file of files) {
  if (!fs.existsSync(file)) { console.log('skip (missing):', file); continue; }
  const names = extractUsernames(fs.readFileSync(file, 'utf-8'));
  for (const name of names) { processed++; if (db.enqueueUsername(name, 'import')) added++; }
  console.log(`processed ${names.length} from ${file}`);
}
console.log(`Imported ${added} new usernames (${processed} lines processed).`);
console.log('pool stats:', JSON.stringify(db.stats()));
db.close();
