const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Database = require('../db/Database.js');
const { exportPublicData, csvCell } = require('../tools/exportPublicData.js');

function seedSource(file) {
  const db = new Database(file);
  const raw = db.db;
  raw.exec(`INSERT INTO item_definitions VALUES (1, 100, 'Rare Headdress', 'rh')`);
  raw.exec(`INSERT INTO usernames (name, source, first_seen, last_seen, scraped, is_live) VALUES
    ('Visible', 'nearby', 1, 2, 1, 1), ('BotAlpha', 'nearby', 1, 2, 1, 1)`);
  raw.exec(`INSERT INTO price_observations (owner_name, shop_id, def_id, item_type, cost, currency_type, color, scraped_by, scraped_at) VALUES
    ('Visible', 1, 100, 1, 50, 3, 0, 'botalpha', 1790000000000),
    ('Visible', 1, 7, 1, 20, 0, 4294901760, 'botalpha', 1790000000000),
    ('Visible', 1, 8, 2, 30, 0, 4294901760, 'botalpha', 1790000000000),
    ('BOTALPHA', 1, 100, 1, 77, 0, 0, 'botalpha', 1790000000000)`);
  raw.exec(`INSERT INTO dens (owner_name, shop_ids, item_count, status, scraped_at) VALUES ('Visible', '[1]', 1, 'ok', 1), ('botalpha', '[1]', 1, 'ok', 1)`);
  raw.exec(`INSERT INTO tradelist_items (owner_name, item_type, def_id, color, scraped_at) VALUES ('BotAlpha', 1, 100, 0, 1)`);
  db.close();
}

const readGz = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString();

test('public export drops bot names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-export-'));
  const src = path.join(dir, 'src.db');
  seedSource(src);
  const out = path.join(dir, 'out');
  const counts = await exportPublicData(src, out);

  assert.strictEqual(counts.price_observations, 3);
  assert.strictEqual(counts.usernames, 1);
  assert.strictEqual(counts.dens, 1);
  assert.strictEqual(counts.tradelist_items, 0);

  const obs = readGz(path.join(out, 'price_observations.csv.gz'));
  assert.match(obs, /^id,seller,shop_id,item_type,def_id,item_name,cost,currency,/);
  assert.match(obs, /Visible,1,1,100,Rare Headdress,50,diamonds,/);
  assert.match(obs, /2026-09-2\dT/);
  assert.match(obs, /,1,7,,20,gems,4294901760,,,/);
  assert.match(obs, /,2,8,,30,gems,4294901760,#[0-9A-Fa-f]{6,8},\w/);

  const everything = fs.readdirSync(out).map((f) => zlib.gunzipSync(fs.readFileSync(path.join(out, f))).toString('latin1')).join('\n');
  assert.doesNotMatch(everything, /botalpha|scraped_by/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('csv cells quote commas, quotes and newlines', () => {
  assert.strictEqual(csvCell('plain'), 'plain');
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell(null), '');
});
