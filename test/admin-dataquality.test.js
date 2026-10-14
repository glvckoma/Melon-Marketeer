const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const { computeCoverageByType } = require('../items/Coverage.js');
const { normalizeName } = require('../items/wikiName.js');

function seed() {
  const db = new Database(':memory:');
  db.db.prepare(
    "INSERT INTO item_definitions (item_type, def_id, name) VALUES (2,1,'Test Hat'),(2,2,'Lonely Item'),(2,3,'Unobserved Thing')"
  ).run();
  const now = Date.now();
  db.db.prepare(
    "INSERT INTO price_observations (owner_name, shop_id, inv_idx, def_id, item_type, cost, currency_type, color, scraped_at) VALUES ('s1',1,0,1,2,5,0,NULL,?)"
  ).run(now);
  db.db.prepare(
    "INSERT INTO price_observations (owner_name, shop_id, inv_idx, def_id, item_type, cost, currency_type, color, scraped_at) VALUES ('s1',1,1,2,2,5,0,NULL,?)"
  ).run(now);
  db.db.prepare(
    "INSERT INTO wiki_items (source, norm, title, images_json) VALUES ('aj-item-worth', ?, 'Test Hat', ?)"
  ).run(normalizeName('Test Hat'), JSON.stringify([{ path: 'testhat.png' }]));
  return db;
}

test('computeCoverageByType buckets observed/imaged/unmatched/unobserved per type', () => {
  const db = seed();
  const { types } = computeCoverageByType(db);
  const c = types['2'];
  assert.strictEqual(c.observed, 2);
  assert.strictEqual(c.withImages, 1, 'Test Hat has a wiki image');
  assert.strictEqual(c.unmatched, 1, 'Lonely Item has no wiki match');
  assert.strictEqual(c.totalDefs, 3);
  assert.strictEqual(c.unobserved, 1, 'Unobserved Thing never observed');
  assert.strictEqual(c.label, 'Clothing');
  db.close();
});

test('computeCoverageByType returns drill-down gap lists', () => {
  const db = seed();
  const { gaps } = computeCoverageByType(db);
  assert.ok(gaps.unmatched.some((g) => g.name === 'Lonely Item'));
  db.close();
});

test('empty types still report zeroes', () => {
  const db = seed();
  const { types } = computeCoverageByType(db);
  assert.strictEqual(types['1'].observed, 0);
  assert.strictEqual(types['0'].observed, 0);
  db.close();
});
