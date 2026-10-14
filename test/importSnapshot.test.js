const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../db/Database.js');
const { buildPublicDb } = require('../tools/exportPublicData.js');
const { importInto } = require('../tools/importSnapshot.js');

function seedSource(file) {
  const db = new Database(file);
  const raw = db.db;
  raw.exec(`INSERT INTO item_definitions VALUES (2, 50, 'Tiki Mask', 'tm')`);
  raw.exec(`INSERT INTO usernames (name, source, first_seen, last_seen, scraped, is_live) VALUES ('SellerOne', 'nearby', 1, 2, 1, 1)`);
  raw.exec(`INSERT INTO price_observations (owner_name, shop_id, inv_idx, def_id, item_type, cost, currency_type, color, scraped_by, scraped_at) VALUES
    ('SellerOne', 9, 3, 50, 2, 40, 3, 4294901760, 'bot', 1790000000000),
    ('SellerOne', 9, 4, 50, 2, 60, 3, 4294901760, 'bot', 1790000000001)`);
  raw.exec(`INSERT INTO dens (owner_name, shop_ids, item_count, status, scraped_at) VALUES ('SellerOne', '[9]', 2, 'ok', 5)`);
  raw.exec(`INSERT INTO tradelist_items (owner_name, item_type, def_id, color, scraped_at) VALUES ('SellerOne', 2, 50, 0, 6)`);
  raw.exec(`INSERT INTO wiki_items (source, title, norm, url, worth_text, images_json, scraped_at) VALUES
    ('aj-item-worth', 'Tiki Mask', 'x', 'https://wiki/Tiki_Mask', '5 dens', '[{"path":"wiki/Tiki.png","url":"https://cdn/Tiki.png"}]', 7),
    ('animaljam', 'Tiki Mask', 'x', 'https://aj/Tiki_Mask', NULL, '[{"path":"wiki/Tiki_AJ.png","url":"https://cdn/Tiki_AJ.png"}]', 8)`);
  db.close();
}

test('a public snapshot imports back into the local schema with seller columns restored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-import-'));
  const src = path.join(dir, 'src.db');
  const snap = path.join(dir, 'snap.sqlite');
  seedSource(src);
  buildPublicDb(src, snap).close();

  const db = new Database(path.join(dir, 'local.db'));
  const counts = importInto(db, snap);
  const raw = db.db;

  assert.strictEqual(counts.price_observations, 2);
  assert.deepStrictEqual(
    raw.prepare('SELECT owner_name, shop_id, inv_idx, cost, currency_type, color FROM price_observations ORDER BY id').all().map((r) => ({ ...r })),
    [
      { owner_name: 'SellerOne', shop_id: 9, inv_idx: 3, cost: 40, currency_type: 3, color: 4294901760 },
      { owner_name: 'SellerOne', shop_id: 9, inv_idx: 4, cost: 60, currency_type: 3, color: 4294901760 }
    ]
  );
  assert.strictEqual(raw.prepare('SELECT owner_name FROM dens').get().owner_name, 'SellerOne');
  assert.strictEqual(raw.prepare('SELECT owner_name FROM tradelist_items').get().owner_name, 'SellerOne');
  assert.strictEqual(raw.prepare('SELECT source FROM usernames').get().source, 'snapshot');
  assert.strictEqual(db.wikiByName('Tiki Mask', 'aj-item-worth').title, 'Tiki Mask');
  assert.deepStrictEqual(db.wikiByName('Tiki Mask', 'aj-item-worth').images.map((i) => i.url), ['https://cdn/Tiki.png']);
  assert.deepStrictEqual(db.wikiByName('Tiki Mask', 'animaljam').images.map((i) => i.url), ['https://cdn/Tiki_AJ.png']);
  assert.strictEqual(counts.item_stats, 1);
  assert.strictEqual(counts.seller_stats, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
