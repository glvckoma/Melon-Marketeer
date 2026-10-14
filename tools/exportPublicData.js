const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { once } = require('events');
const { DatabaseSync } = require('node:sqlite');
const { colorInfo, currencyName } = require('../api/readModel.js');

const VISIBLE = 'NOT IN (SELECT name FROM temp.hidden)';

const TABLES = {
  item_definitions: `SELECT item_type, def_id, name, abbr FROM src.item_definitions`,
  price_observations: `SELECT id, owner_name AS seller, shop_id, inv_idx, item_type, def_id, cost, currency_type, color, pet_appearance, scraped_at
    FROM src.price_observations WHERE owner_name ${VISIBLE}`,
  usernames: `SELECT name, first_seen, last_seen, is_live FROM src.usernames WHERE name ${VISIBLE}`,
  dens: `SELECT owner_name AS owner, item_count, status, scraped_at FROM src.dens WHERE owner_name ${VISIBLE}`,
  tradelist_items: `SELECT owner_name AS owner, item_type, def_id, color, pet_appearance, scraped_at
    FROM src.tradelist_items WHERE owner_name ${VISIBLE}`,
  item_stats: `SELECT * FROM src.item_stats`,
  item_color_stats: `SELECT * FROM src.item_color_stats`,
  wiki_items: `SELECT title, url, worth_text, scraped_at FROM src.wiki_items`,
  wiki_color_worth: `SELECT title, label, color, worth_text, trade_value, trade_display FROM src.wiki_color_worth`,
  wiki_images: `SELECT source, title, url, images_json FROM src.wiki_items WHERE images_json IS NOT NULL AND images_json <> '[]'`
};

const INDEXES = [
  'CREATE INDEX idx_obs_item ON price_observations(item_type, def_id)',
  'CREATE INDEX idx_obs_seller ON price_observations(seller)',
  'CREATE INDEX idx_tl_item ON tradelist_items(item_type, def_id)',
  'CREATE UNIQUE INDEX idx_defs ON item_definitions(item_type, def_id)'
];

const CSV_QUERIES = {
  price_observations: `SELECT o.id, o.seller, o.shop_id, o.item_type, o.def_id, d.name AS item_name, o.cost, o.currency_type,
      o.color AS color_raw, c.hex AS color_hex, c.name AS color_name, o.pet_appearance, o.scraped_at
    FROM price_observations o
    LEFT JOIN item_definitions d USING (item_type, def_id)
    LEFT JOIN colors c ON c.item_type = o.item_type AND c.raw = o.color
    ORDER BY o.id`,
  tradelist_items: `SELECT t.owner, t.item_type, t.def_id, d.name AS item_name, t.color AS color_raw, c.hex AS color_hex,
      c.name AS color_name, t.pet_appearance, t.scraped_at
    FROM tradelist_items t
    LEFT JOIN item_definitions d USING (item_type, def_id)
    LEFT JOIN colors c ON c.item_type = t.item_type AND c.raw = t.color`,
  usernames: 'SELECT * FROM usernames ORDER BY name',
  dens: 'SELECT * FROM dens ORDER BY owner',
  item_definitions: 'SELECT * FROM item_definitions ORDER BY item_type, def_id',
  item_stats: `SELECT s.*, d.name AS item_name FROM item_stats s LEFT JOIN item_definitions d USING (item_type, def_id)`,
  item_color_stats: `SELECT s.*, d.name AS item_name, c.hex AS color_hex, c.name AS color_name FROM item_color_stats s
    LEFT JOIN item_definitions d USING (item_type, def_id)
    LEFT JOIN colors c ON c.item_type = s.item_type AND c.raw = s.color`,
  wiki_items: 'SELECT * FROM wiki_items ORDER BY title',
  wiki_color_worth: 'SELECT * FROM wiki_color_worth ORDER BY title, label'
};

const TIME_COLUMNS = new Set(['scraped_at', 'first_seen', 'last_seen']);
const CLOTHING = 2;

function buildPublicDb(srcPath, outPath) {
  fs.rmSync(outPath, { force: true });
  const out = new DatabaseSync(outPath);
  out.exec(`ATTACH '${srcPath.replace(/\\/g, '/').replace(/'/g, "''")}' AS src`);
  out.exec(`CREATE TEMP TABLE hidden (name TEXT PRIMARY KEY COLLATE NOCASE);
    INSERT OR IGNORE INTO hidden SELECT DISTINCT scraped_by FROM src.price_observations WHERE scraped_by IS NOT NULL;`);
  for (const [name, select] of Object.entries(TABLES)) out.exec(`CREATE TABLE ${name} AS ${select}`);
  out.exec('DETACH src');
  for (const sql of INDEXES) out.exec(sql);
  buildColorTable(out);
  out.exec('VACUUM');
  return out;
}

function buildColorTable(db) {
  db.exec('CREATE TABLE colors (item_type INTEGER, raw INTEGER, hex TEXT, name TEXT, PRIMARY KEY (item_type, raw))');
  const insert = db.prepare('INSERT INTO colors VALUES (?, ?, ?, ?)');
  const pairs = db.prepare(`SELECT DISTINCT item_type, color FROM price_observations WHERE item_type = ${CLOTHING} AND color IS NOT NULL
    UNION SELECT DISTINCT item_type, color FROM tradelist_items WHERE item_type = ${CLOTHING} AND color IS NOT NULL
    UNION SELECT DISTINCT item_type, color FROM item_color_stats WHERE item_type = ${CLOTHING} AND color IS NOT NULL`).all();
  db.exec('BEGIN');
  for (const { item_type, color } of pairs) {
    const c = colorInfo(color, item_type);
    if (c) insert.run(item_type, color, c.hex, c.name);
  }
  db.exec('COMMIT');
}

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function shapeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'currency_type') out.currency = v == null ? null : currencyName(v);
    else if (TIME_COLUMNS.has(k)) out[k] = v ? new Date(Number(v)).toISOString() : null;
    else out[k] = v;
  }
  return out;
}

async function writeCsv(db, sql, file) {
  const gz = zlib.createGzip({ level: 9 });
  const done = pipeline(gz, fs.createWriteStream(file));
  let rows = 0;
  for (const raw of db.prepare(sql).iterate()) {
    const row = shapeRow(raw);
    if (rows === 0) gz.write(Object.keys(row).join(',') + '\n');
    if (!gz.write(Object.values(row).map(csvCell).join(',') + '\n')) await once(gz, 'drain');
    rows += 1;
  }
  gz.end();
  await done;
  return rows;
}

async function gzipFile(src, dest) {
  await pipeline(fs.createReadStream(src), zlib.createGzip({ level: 9 }), fs.createWriteStream(dest));
}

async function exportPublicData(srcPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const dbPath = path.join(outDir, 'marketeer-public.sqlite');
  const db = buildPublicDb(srcPath, dbPath);
  const counts = {};
  for (const [name, sql] of Object.entries(CSV_QUERIES)) {
    counts[name] = await writeCsv(db, sql, path.join(outDir, `${name}.csv.gz`));
  }
  db.close();
  await gzipFile(dbPath, dbPath + '.gz');
  fs.rmSync(dbPath);
  return counts;
}

if (require.main === module) {
  const src = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'marketeer.db');
  const outDir = process.argv[2] || path.join(path.dirname(src), 'public-export');
  exportPublicData(src, outDir).then((counts) => {
    for (const [name, n] of Object.entries(counts)) console.log(`${name}: ${n} rows`);
    console.log(`Written to ${outDir}`);
  });
}

module.exports = { exportPublicData, buildPublicDb, csvCell, shapeRow };
