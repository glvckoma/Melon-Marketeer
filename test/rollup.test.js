const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');

function seed(db, rows) {
  db.insertObservations(rows.map((r) => ({ shopState: 'open', scrapedBy: 'bot', ...r })));
}

test('materialized item stats match aggregates including odd median', () => {
  const db = new Database(':memory:');
  seed(db, [
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, color: 5, scrapedAt: 10 },
    { ownerName: 'B', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 200, currencyType: 1, color: 5, scrapedAt: 20 },
    { ownerName: 'C', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 300, currencyType: 1, color: 7, scrapedAt: 30 }
  ]);
  const stats = db.itemStats(2, 10);
  assert.strictEqual(stats.length, 1);
  const s = stats[0];
  assert.strictEqual(s.observations, 3);
  assert.strictEqual(s.sellers, 3);
  assert.strictEqual(s.min_cost, 100);
  assert.strictEqual(s.max_cost, 300);
  assert.strictEqual(s.avg_cost, 200);
  assert.strictEqual(s.median_cost, 200);
  assert.strictEqual(s.last_seen, 30);
  db.close();
});

test('median handles even counts (rounded average of two middles)', () => {
  const db = new Database(':memory:');
  seed(db, [
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, scrapedAt: 1 },
    { ownerName: 'B', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 101, currencyType: 1, scrapedAt: 2 },
    { ownerName: 'C', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 200, currencyType: 1, scrapedAt: 3 },
    { ownerName: 'D', shopId: 1, invIdx: 4, defId: 10, itemType: 2, cost: 203, currencyType: 1, scrapedAt: 4 }
  ]);
  assert.strictEqual(db.medianPrice(2, 10, 1), 151);
  db.close();
});

test('itemColors materialized per color and currency', () => {
  const db = new Database(':memory:');
  seed(db, [
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, color: 5, scrapedAt: 1 },
    { ownerName: 'B', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 150, currencyType: 1, color: 5, scrapedAt: 2 },
    { ownerName: 'C', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 300, currencyType: 1, color: 7, scrapedAt: 3 }
  ]);
  const byColor = new Map(db.itemColors(2, 10).map((c) => [c.color, c]));
  assert.strictEqual(byColor.get(5).observations, 2);
  assert.strictEqual(byColor.get(5).sellers, 2);
  assert.strictEqual(byColor.get(5).min_cost, 100);
  assert.strictEqual(byColor.get(7).observations, 1);
  db.close();
});

test('stats refresh when new observations arrive', () => {
  const db = new Database(':memory:');
  seed(db, [{ ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, scrapedAt: 1 }]);
  assert.strictEqual(db.itemStats(2, 10)[0].observations, 1);
  seed(db, [{ ownerName: 'B', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 200, currencyType: 1, scrapedAt: 2 }]);
  assert.strictEqual(db.itemStats(2, 10)[0].observations, 2);
  assert.strictEqual(db.medianPrice(2, 10, 1), 150);
  db.close();
});

test('topSellers and currencySplit read materialized tables', () => {
  const db = new Database(':memory:');
  seed(db, [
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, scrapedAt: 5 },
    { ownerName: 'A', shopId: 1, invIdx: 2, defId: 11, itemType: 2, cost: 100, currencyType: 3, scrapedAt: 6 },
    { ownerName: 'B', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 100, currencyType: 3, scrapedAt: 7 }
  ]);
  const a = db.topSellers({ limit: 10, sort: 'items' }).find((r) => r.owner_name === 'A');
  assert.strictEqual(a.items, 2);
  assert.strictEqual(a.observations, 2);
  const split = new Map(db.currencySplit().map((r) => [r.currency_type, r.n]));
  assert.strictEqual(split.get(1), 1);
  assert.strictEqual(split.get(3), 2);
  db.close();
});

test('archiveAndPrune dry-run reports without deleting; apply archives and prunes', () => {
  const db = new Database(':memory:');
  const dayMs = 86400000;
  const now = Date.now();
  seed(db, [
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 100, currencyType: 1, color: 5, scrapedAt: now - 100 * dayMs },
    { ownerName: 'B', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 200, currencyType: 1, color: 5, scrapedAt: now - 100 * dayMs },
    { ownerName: 'C', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 300, currencyType: 1, color: 5, scrapedAt: now - dayMs }
  ]);

  const dry = db.archiveAndPrune({ days: 90, dryRun: true });
  assert.strictEqual(dry.total, 3);
  assert.strictEqual(dry.wouldDelete, 2);
  assert.strictEqual(db.stats().observations, 3);

  const res = db.archiveAndPrune({ days: 90, dryRun: false });
  assert.strictEqual(res.deleted, 2);
  assert.strictEqual(db.stats().observations, 1);

  const arch = db.db.prepare('SELECT SUM(observations) AS n, MIN(min_cost) AS mn, MAX(max_cost) AS mx FROM daily_rollup').get();
  assert.strictEqual(arch.n, 2);
  assert.strictEqual(arch.mn, 100);
  assert.strictEqual(arch.mx, 200);

  const stats = db.itemStats(2, 10);
  assert.strictEqual(stats[0].observations, 1);
  assert.strictEqual(stats[0].median_cost, 300);
  db.close();
});
