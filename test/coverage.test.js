const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const { computeCoverage } = require('../items/Coverage.js');

test('computeCoverage buckets observed items by image availability', () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [
    { itemType: 2, defId: 1, name: 'Alpha', abbr: 'a' },
    { itemType: 2, defId: 2, name: 'Beta', abbr: 'b' },
    { itemType: 2, defId: 3, name: 'Gamma', abbr: 'g' },
    { itemType: 2, defId: 4, name: 'Delta', abbr: 'd' }
  ] });
  db.insertObservations([
    { ownerName: 'S', shopId: 1, invIdx: 0, defId: 1, itemType: 2, cost: 5, currencyType: 3, color: null, scrapedAt: 10 },
    { ownerName: 'S', shopId: 1, invIdx: 1, defId: 2, itemType: 2, cost: 5, currencyType: 3, color: null, scrapedAt: 10 },
    { ownerName: 'S', shopId: 1, invIdx: 2, defId: 3, itemType: 2, cost: 5, currencyType: 3, color: null, scrapedAt: 10 },
    { ownerName: 'S', shopId: 1, invIdx: 3, defId: 4, itemType: 2, cost: 5, currencyType: 3, color: null, scrapedAt: 10 }
  ]);
  db.upsertWikiWorth('Alpha', 'u', 'worth'); db.setWikiImages('Alpha', [{ color: 'Blue', path: 'wiki/a.png' }]);
  db.upsertWikiWorth('Beta', 'u', 'worth'); // images_json stays NULL -> unsynced
  db.upsertWikiWorth('Gamma', 'u', 'worth'); db.setWikiImages('Gamma', []); // synced, none found
  // Delta: no wiki entry -> unmatched

  const r = computeCoverage(db);
  assert.strictEqual(r.summary.observed, 4);
  assert.strictEqual(r.summary.withImages, 1);
  assert.strictEqual(r.summary.unsynced, 1);
  assert.strictEqual(r.summary.noImagesOnPage, 1);
  assert.strictEqual(r.summary.unmatched, 1);
  assert.deepStrictEqual(r.unmatched.map((u) => u.name), ['Delta']);
  assert.deepStrictEqual(r.noImagesOnPage.map((u) => u.name), ['Gamma']);
});

test('a fuzzy item_wiki match counts as matched', () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [{ itemType: 2, defId: 9, name: 'Rare Spiked Wristband', abbr: 'x' }] });
  db.insertObservations([{ ownerName: 'S', shopId: 1, invIdx: 0, defId: 9, itemType: 2, cost: 5, currencyType: 3, color: null, scrapedAt: 10 }]);
  db.upsertWikiWorth('Spiked Wristband', 'u', 'worth'); db.setWikiImages('Spiked Wristband', [{ color: 'Red', path: 'wiki/r.png' }]);
  db.setItemWiki(2, 9, 'Spiked Wristband');
  const r = computeCoverage(db);
  assert.strictEqual(r.summary.withImages, 1);
  assert.strictEqual(r.summary.unmatched, 0);
});
