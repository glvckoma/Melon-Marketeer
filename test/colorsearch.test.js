const test = require('node:test');
const assert = require('node:assert');
const { nearestColorName } = require('../items/colorName.js');
const Database = require('../db/Database.js');
const rm = require('../api/readModel.js');

test('nearestColorName reads RGB from ARGB hex, not the alpha byte', () => {
  assert.strictEqual(nearestColorName('#FFF06FB8'), 'Pink');
  assert.strictEqual(nearestColorName('#FFE22B2B'), 'Red');
  assert.strictEqual(nearestColorName('#FF37B24D'), 'Green');
  assert.strictEqual(nearestColorName('#F06FB8'), 'Pink');
});

test('itemsByColor groups observed items by named color', async () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [
    { itemType: 2, defId: 10, name: 'Pink Shirt', abbr: null },
    { itemType: 2, defId: 11, name: 'Red Hat', abbr: null }
  ] });
  db.insertObservations([
    { ownerName: 'A', shopId: 1, invIdx: 0, defId: 10, itemType: 2, cost: 5, currencyType: 3, color: 341114880, scrapedAt: 1 },
    { ownerName: 'B', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 6, currencyType: 3, color: 341114880, scrapedAt: 2 },
    { ownerName: 'C', shopId: 1, invIdx: 2, defId: 11, itemType: 2, cost: 7, currencyType: 3, color: 357892096, scrapedAt: 3 }
  ]);
  const pink = await rm.itemsByColor(db, 'pink');
  assert.ok(pink.some((x) => x.defId === 10 && x.itemType === 2));
  assert.ok(!pink.some((x) => x.defId === 11));
  assert.strictEqual((await rm.itemsByColor(db, '')).length, 0);
});
