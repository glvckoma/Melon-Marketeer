const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const Database = require('../db/Database.js');
const { normalizeName } = require('../items/wikiName.js');
const { buildMatches } = require('./rebuildWikiMatches.js');

const RELEASE_API = 'https://api.github.com/repos/glvckoma/Marketeer-Data/releases/latest';
const ASSET_NAME = 'marketeer-public.sqlite.gz';

const COPIES = [
  ['item_definitions', 'item_type, def_id, name, abbr', 'item_type, def_id, name, abbr'],
  ['usernames', "name, source, first_seen, last_seen, is_live", "name, 'snapshot', first_seen, last_seen, is_live"],
  ['dens', 'owner_name, item_count, status, scraped_at', 'owner, item_count, status, scraped_at'],
  ['price_observations', 'id, owner_name, shop_id, inv_idx, item_type, def_id, cost, currency_type, color, pet_appearance, scraped_at',
    'id, seller, shop_id, inv_idx, item_type, def_id, cost, currency_type, color, pet_appearance, scraped_at'],
  ['tradelist_items', 'owner_name, item_type, def_id, color, pet_appearance, scraped_at', 'owner, item_type, def_id, color, pet_appearance, scraped_at'],
  ['wiki_color_worth', 'title, label, color, worth_text, trade_value, trade_display', 'title, label, color, worth_text, trade_value, trade_display']
];

async function latestAssetUrl() {
  const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'melon-marketeer' } });
  if (!res.ok) throw new Error(`GitHub release lookup failed (status ${res.status})`);
  const release = await res.json();
  const asset = (release.assets || []).find((a) => a.name === ASSET_NAME);
  if (!asset) throw new Error(`${ASSET_NAME} not found in release ${release.tag_name}`);
  return { url: asset.browser_download_url, tag: release.tag_name };
}

async function fetchSnapshot(outFile) {
  const { url, tag } = await latestAssetUrl();
  console.log(`Downloading ${ASSET_NAME} from ${tag}...`);
  const res = await fetch(url, { headers: { 'User-Agent': 'melon-marketeer' } });
  if (!res.ok) throw new Error(`download failed (status ${res.status})`);
  await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(outFile));
}

async function extractLocal(source, outFile) {
  if (!source.endsWith('.gz')) return source;
  await pipeline(fs.createReadStream(source), zlib.createGunzip(), fs.createWriteStream(outFile));
  return outFile;
}

function importInto(db, snapshotPath) {
  const raw = db.db;
  raw.exec(`ATTACH '${snapshotPath.replace(/\\/g, '/').replace(/'/g, "''")}' AS snap`);
  const counts = {};
  try {
    raw.exec('BEGIN');
    for (const [table, cols, select] of COPIES) {
      raw.exec(`INSERT OR IGNORE INTO ${table} (${cols}) SELECT ${select} FROM snap.${table}`);
      counts[table] = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }
    const insertWiki = raw.prepare(
      "INSERT OR IGNORE INTO wiki_items (source, title, norm, url, worth_text, scraped_at) VALUES ('aj-item-worth', ?, ?, ?, ?, ?)"
    );
    for (const w of raw.prepare('SELECT title, url, worth_text, scraped_at FROM snap.wiki_items').all()) {
      insertWiki.run(w.title, normalizeName(w.title), w.url, w.worth_text, w.scraped_at);
    }
    if (raw.prepare("SELECT 1 FROM snap.sqlite_master WHERE type = 'table' AND name = 'wiki_images'").get()) {
      const upsertImages = raw.prepare(
        `INSERT INTO wiki_items (source, title, norm, url, images_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (source, title) DO UPDATE SET images_json = excluded.images_json`
      );
      for (const w of raw.prepare('SELECT source, title, url, images_json FROM snap.wiki_images').all()) {
        upsertImages.run(w.source, w.title, normalizeName(w.title), w.url, w.images_json);
      }
    }
    counts.wiki_items = raw.prepare('SELECT COUNT(*) AS n FROM wiki_items').get().n;
    raw.exec('COMMIT');
  } catch (e) {
    raw.exec('ROLLBACK');
    throw e;
  } finally {
    raw.exec('DETACH snap');
  }
  counts.wikiMatches = buildMatches(db);
  const stats = db.rollupStats();
  counts.item_stats = stats.items;
  counts.seller_stats = stats.sellers;
  return counts;
}

async function main() {
  const dbPath = process.env.SQLITE_PATH || path.resolve(__dirname, '..', 'data', 'marketeer.db');
  const db = new Database(dbPath);
  const existing = db.db.prepare('SELECT COUNT(*) AS n FROM price_observations').get().n;
  if (existing > 0) {
    db.close();
    throw new Error(`${dbPath} already has ${existing} observations. Set SQLITE_PATH to a new file to import the snapshot separately.`);
  }
  const workDir = path.join(path.dirname(dbPath), 'snapshot');
  fs.mkdirSync(workDir, { recursive: true });
  const extracted = path.join(workDir, 'marketeer-public.sqlite');
  const local = process.argv[2];
  const snapshotPath = local ? await extractLocal(path.resolve(local), extracted) : (await fetchSnapshot(extracted), extracted);
  console.log('Importing into', dbPath, '...');
  const counts = importInto(db, snapshotPath);
  db.close();
  if (snapshotPath === extracted) fs.rmSync(workDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  console.log('Done. Run "npm run serve" and open http://localhost:3200');
}

if (require.main === module) {
  main().catch((e) => { console.error('import failed:', e.message); process.exit(1); });
}

module.exports = { importInto, COPIES };
