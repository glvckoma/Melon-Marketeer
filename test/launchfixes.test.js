const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const rm = require('../api/readModel.js');

test('mergeColorRows drops undecodable colors and merges duplicate names', () => {
  const rows = [
    { color: 408223744, currency_type: 3, observations: 10, sellers: 5, min_cost: 100, avg_cost: 200, max_cost: 300, last_seen: 5 },
    { color: -1804926976, currency_type: 3, observations: 30, sellers: 3, min_cost: 50, avg_cost: 100, max_cost: 400, last_seen: 9 },
    { color: 374669312, currency_type: 3, observations: 8, sellers: 2, min_cost: 160, avg_cost: 210, max_cost: 300, last_seen: 7 },
    { color: 0, currency_type: 3, observations: 7, sellers: 2, min_cost: 1, avg_cost: 1, max_cost: 1, last_seen: 1 }
  ];
  const merged = rm.mergeColorRows(rows, 2);
  assert.ok(merged.every((m) => m.color && m.color.name), 'no null colors remain');
  const green = merged.find((m) => m.color.name === 'Green');
  const orange = merged.find((m) => m.color.name === 'Orange');
  assert.ok(green, 'green present');
  assert.ok(orange, 'orange stays separate');
  assert.strictEqual(green.observations, 40, 'merged observations summed');
  assert.strictEqual(green.min, 50, 'merged min widened');
  assert.strictEqual(green.max, 400, 'merged max widened');
  assert.strictEqual(green.avg, 125, 'observation-weighted average');
  assert.ok(!merged.some((m) => m.color.name === 'Gray'), 'no gray on clothing');
});

test('mergeColorRows keeps gems and diamonds of the same color separate', () => {
  const rows = [
    { color: 408223744, currency_type: 3, observations: 4, sellers: 1, min_cost: 10, avg_cost: 10, max_cost: 10, last_seen: 1 },
    { color: 408223744, currency_type: 0, observations: 4, sellers: 1, min_cost: 20, avg_cost: 20, max_cost: 20, last_seen: 1 }
  ];
  const merged = rm.mergeColorRows(rows, 2);
  assert.strictEqual(merged.length, 2, 'same color but different currency stays split');
});

test('imageWikiFor swaps in the override image source when the target has images', async () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Rare Long Spiked Collar', 'https://aj-item-worth.fandom.com/wiki/Rare_Long_Spiked_Collar', '');
  db.setWikiImages('Rare Long Spiked Collar', [{ path: 'wiki/Rare_Orange_Long_Spiked_Collar.png', color: 'Orange', label: 'Orange' }], 'aj-item-worth');
  const diamond = { title: 'Diamond Long Spiked Collars', images: [] };
  const used = await rm.imageWikiFor(db, 2, 634, diamond);
  assert.strictEqual(used.title, 'Rare Long Spiked Collar', 'def 634 borrows the rare image source');
  assert.strictEqual(used.images.length, 1);
  const passthrough = await rm.imageWikiFor(db, 2, 999, diamond);
  assert.strictEqual(passthrough.title, 'Diamond Long Spiked Collars', 'non-overridden items keep their own wiki');
  db.close();
});
