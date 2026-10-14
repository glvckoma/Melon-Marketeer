const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const { looksLikeDate } = require('../items/WikiData.js');
const { itemDetail, mostValuable } = require('../api/readModel.js');

test('looksLikeDate flags month/date strings, keeps real worth', () => {
  for (const bad of ['February', 'march', 'August.', 'December 2019', 'June 5, 2020', '2021', '07/14/2020']) {
    assert.strictEqual(looksLikeDate(bad), true, bad);
  }
  for (const ok of ['2-3 Black Longs', 'decent', '13-14', 'a few diamonds', 'Summer', 'rare']) {
    assert.strictEqual(looksLikeDate(ok), false, ok);
  }
});

test('wiki read suppresses date-like worth at the chokepoint', () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Amethyst', 'https://x/amethyst', 'February');
  db.upsertWikiWorth('Rare Gem', 'https://x/rare', '2-3 Black Longs');
  assert.strictEqual(db.wikiByName('Amethyst').worthText, null);
  assert.strictEqual(db.wikiByName('Rare Gem').worthText, '2-3 Black Longs');
  db.close();
});

function defineItem(db, itemType, defId, name) {
  db.db.prepare('INSERT OR REPLACE INTO item_definitions (item_type, def_id, name, abbr) VALUES (?, ?, ?, ?)').run(itemType, defId, name, null);
}

test('unobserved item still renders a page with gated wiki worth', async () => {
  const db = new Database(':memory:');
  defineItem(db, 0, 175, 'Amethyst');
  db.upsertWikiWorth('Amethyst', 'https://x/amethyst', 'February');

  const d = await itemDetail(db, 0, 175);
  assert.strictEqual(d.observed, false);
  assert.strictEqual(d.itemName, 'Amethyst');
  assert.ok(d.wiki, 'wiki data present for unobserved item');
  assert.strictEqual(d.wiki.worthText, null, 'date-like worth suppressed');
  assert.deepStrictEqual(d.stats, []);
  assert.deepStrictEqual(d.sellers, []);
  db.close();
});

test('mostValuable never surfaces date-like worth', async () => {
  const db = new Database(':memory:');
  defineItem(db, 2, 10, 'Spike');
  db.upsertWikiWorth('Spike', 'https://x/spike', 'August');
  db.insertObservations([
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 500, currencyType: 3, shopState: 'open', scrapedBy: 'b', scrapedAt: 1 }
  ]);
  const list = await mostValuable(db, 12);
  const spike = list.find((r) => r.itemType === 2 && r.defId === 10);
  assert.ok(spike, 'observed item appears');
  assert.strictEqual(spike.worthText, null, 'date-like worth never shown');
  db.close();
});
