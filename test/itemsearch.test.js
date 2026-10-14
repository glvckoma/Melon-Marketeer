const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');

function seed() {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [
    { itemType: 2, defId: 444, name: 'Spiked Collar', abbr: 'spike' },
    { itemType: 2, defId: 445, name: 'Spiked Wristband', abbr: 'spikew' },
    { itemType: 0, defId: 99, name: 'Rare Item Monday', abbr: 'rim' }
  ] });
  db.insertObservations([
    { ownerName: 'AlphaSeller', shopId: 1, invIdx: 0, defId: 444, itemType: 2, cost: 900, currencyType: 0, color: 4294901760, scrapedAt: 10 },
    { ownerName: 'BetaSeller', shopId: 2, invIdx: 0, defId: 444, itemType: 2, cost: 700, currencyType: 0, color: 0, scrapedAt: 20 },
    { ownerName: 'BetaSeller', shopId: 2, invIdx: 1, defId: 444, itemType: 2, cost: 1100, currencyType: 0, color: 4294901760, scrapedAt: 30 },
    { ownerName: 'AlphaSeller', shopId: 1, invIdx: 2, defId: 99, itemType: 0, cost: 5, currencyType: 3, color: null, scrapedAt: 40 }
  ]);
  return db;
}

test('searchItems filters by name and currency', () => {
  const db = seed();
  const all = db.searchItems({ q: 'Spiked', limit: 50 });
  assert.ok(all.every((r) => r.name.startsWith('Spiked')));
  const collar = all.find((r) => r.def_id === 444);
  assert.strictEqual(collar.observations, 3);
  assert.strictEqual(collar.sellers, 2);
  assert.strictEqual(collar.min_cost, 700);
  assert.strictEqual(collar.max_cost, 1100);
  const diamonds = db.searchItems({ currency: 'diamonds' });
  assert.ok(diamonds.every((r) => r.currency_type === 3));
  const gems = db.searchItems({ currency: 'gems' });
  assert.ok(gems.every((r) => r.currency_type !== 3));
  db.close();
});

test('searchItems sorts by chosen key', () => {
  const db = seed();
  const byMin = db.searchItems({ sort: 'min' });
  assert.strictEqual(byMin[0].min_cost, Math.min(...byMin.map((r) => r.min_cost)));
  const bySellers = db.searchItems({ sort: 'sellers' });
  assert.ok(bySellers[0].sellers >= bySellers[bySellers.length - 1].sellers);
  db.close();
});

test('itemColors groups observations by color', () => {
  const db = seed();
  const colors = db.itemColors(2, 444);
  const red = colors.find((c) => c.color === 4294901760);
  const palette = colors.find((c) => c.color === 0);
  assert.strictEqual(red.observations, 2);
  assert.strictEqual(palette.observations, 1);
  assert.strictEqual(palette.min_cost, 700);
  db.close();
});

test('itemStats aggregates per currency with median', () => {
  const db = seed();
  const stats = db.itemStats(2, 444);
  assert.strictEqual(stats.length, 1);
  assert.strictEqual(stats[0].observations, 3);
  assert.strictEqual(db.medianPrice(2, 444, 0), 900);
  db.close();
});

test('searchSellers filters by name', () => {
  const db = seed();
  const all = db.searchSellers({});
  assert.strictEqual(all.length, 2);
  const alpha = db.searchSellers({ q: 'Alpha' });
  assert.strictEqual(alpha.length, 1);
  assert.strictEqual(alpha[0].owner_name, 'AlphaSeller');
  db.close();
});

test('sellerInventory returns latest observation per item', () => {
  const db = seed();
  const inv = db.sellerInventory('BetaSeller');
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(inv[0].def_id, 444);
  assert.strictEqual(inv[0].cost, 1100);
  assert.strictEqual(inv[0].name, 'Spiked Collar');
  db.close();
});

test('currencySplit counts by currency', () => {
  const db = seed();
  const split = db.currencySplit();
  const gems = split.find((r) => r.currency_type === 0);
  const diamonds = split.find((r) => r.currency_type === 3);
  assert.strictEqual(gems.n, 3);
  assert.strictEqual(diamonds.n, 1);
  db.close();
});
