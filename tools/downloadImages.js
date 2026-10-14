const fs = require('fs');
const path = require('path');
const Database = require('../db/Database.js');
const { download } = require('./wikiSync.js');
const { WIKI_DIR } = require('../api/imageSource.js');

function missingImages(db) {
  const wanted = new Map();
  for (const r of db.db.prepare("SELECT images_json FROM wiki_items WHERE images_json LIKE '[{%'").all()) {
    for (const im of JSON.parse(r.images_json)) {
      if (im.url && im.path) wanted.set(path.basename(im.path), im.url);
    }
  }
  const missing = [];
  for (const [file, url] of wanted) if (!fs.existsSync(path.join(WIKI_DIR, file))) missing.push(url);
  return { total: wanted.size, missing };
}

async function main() {
  const db = new Database(process.env.SQLITE_PATH || undefined);
  const { total, missing } = missingImages(db);
  db.close();
  console.log(`${total} images referenced, ${missing.length} not downloaded yet.`);
  let saved = 0;
  let failed = 0;
  for (const url of missing) {
    try { await download(url, WIKI_DIR); saved++; } catch { failed++; }
    if ((saved + failed) % 500 === 0) console.log(`  ${saved + failed} / ${missing.length}`);
  }
  console.log(`Saved ${saved}, failed ${failed}. Images are in ${WIKI_DIR}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('download failed:', e.message); process.exit(1); });
}

module.exports = { missingImages };
