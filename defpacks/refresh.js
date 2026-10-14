const fs = require('fs');
const path = require('path');
const { decodeDefpack, detectLatestVersion } = require('./Decoder.js');

const OUT_DIR = path.resolve(__dirname, '..', 'data', 'defpacks');

const PACKS = {
  '1000': 'clothing',
  '1030': 'denitems',
  '1046': 'pets',
  '10230': 'enstrings'
};

async function refreshDefpacks({ version, startFrom = 1811 } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = version || await detectLatestVersion(startFrom);
  console.log(`Refreshing defpacks at version ${target}...`);
  const results = {};
  for (const id of Object.keys(PACKS)) {
    const data = await decodeDefpack(target, id);
    const count = Object.keys(data).length;
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(data));
    results[id] = count;
    console.log(`  pack ${id} (${PACKS[id]}): ${count} entries`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'version.json'), JSON.stringify({ version: target, refreshedAt: Date.now(), counts: results }, null, 2));
  console.log(`Done. Packs cached in ${OUT_DIR}`);
  return { version: target, counts: results };
}

if (require.main === module) {
  const arg = process.argv[2];
  refreshDefpacks({ version: arg ? parseInt(arg, 10) : undefined })
    .then(() => {
      const Database = require('../db/Database.js');
      const NameResolver = require('./NameResolver.js');
      const db = new Database(process.env.SQLITE_PATH || undefined);
      const imported = db.importDefinitions(new NameResolver().load());
      db.close();
      console.log(`Saved ${imported} item names to the database.`);
    })
    .catch((e) => { console.error('refresh failed:', e.message); process.exit(1); });
}

module.exports = { refreshDefpacks, OUT_DIR, PACKS };
