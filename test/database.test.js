const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');

test('enqueue dedupes case-insensitively', () => {
  const db = new Database(':memory:');
  assert.strictEqual(db.enqueueUsername('Alpha', 'nearby'), true);
  assert.strictEqual(db.enqueueUsername('alpha', 'buddy'), false);
  assert.deepStrictEqual(db.getQueuedUsernames(), ['Alpha']);
  db.close();
});

test('scraped dens are excluded from queue and resume works', () => {
  const db = new Database(':memory:');
  db.enqueueUsername('Alpha', 'nearby');
  db.enqueueUsername('Beta', 'nearby');
  db.recordDen('Alpha', [3993], 5, 'ok');
  db.markUsernameScraped('Alpha');
  assert.deepStrictEqual(db.getQueuedUsernames(), ['Beta']);
  assert.strictEqual(db.hasDenScraped('alpha'), true);
  assert.strictEqual(db.hasDenScraped('Beta'), false);
  db.close();
});

test('observations insert and stats', () => {
  const db = new Database(':memory:');
  db.insertObservations([
    { ownerName: 'Alpha', shopId: 500, invIdx: 111, defId: 222, itemType: 2, cost: 500, currencyType: 1, shopState: 'open', scrapedBy: 'bot1', scrapedAt: 1 },
    { ownerName: 'Alpha', shopId: 500, invIdx: 333, defId: 444, itemType: 0, cost: 1000, currencyType: 0, shopState: 'open', scrapedBy: 'bot1', scrapedAt: 1 }
  ]);
  const s = db.stats();
  assert.strictEqual(s.observations, 2);
  db.close();
});

test('recent market values read the newest rows from an index', () => {
  const db = new Database(':memory:');
  const plan = db.db.prepare(
    `EXPLAIN QUERY PLAN SELECT o.owner_name FROM price_observations o
     LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
     ORDER BY o.scraped_at DESC, o.cost DESC LIMIT 100`
  ).all().map((r) => r.detail).join('\n');
  assert.doesNotMatch(plan, /TEMP B-TREE FOR ORDER BY/);
  db.close();
});
