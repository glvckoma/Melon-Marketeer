const test = require('node:test');
const assert = require('node:assert');
const { searchCatalog, buildCatalog, canonicalizeByName } = require('../api/catalog.js');

const CAT = [
  { itemType: 2, defId: 634, name: 'Spiked Collar' },
  { itemType: 2, defId: 851, name: 'Rare Spiked Collar' },
  { itemType: 0, defId: 91, name: 'Pirate Chest' },
  { itemType: 1, defId: 5, name: 'Pet Spider' },
  { itemType: 2, defId: 7, name: 'Spike Couch' }
];

test('searchCatalog requires at least 2 characters', () => {
  assert.deepStrictEqual(searchCatalog(CAT, 's'), []);
  assert.deepStrictEqual(searchCatalog(CAT, ''), []);
});

test('searchCatalog matches substring case-insensitively, prefix and shorter first', () => {
  const r = searchCatalog(CAT, 'SPIK');
  assert.strictEqual(r[0].name, 'Spike Couch');
  assert.ok(r.some((x) => x.name === 'Rare Spiked Collar'));
  assert.ok(r.every((x) => typeof x.itemType === 'number' && typeof x.defId === 'number'));
});

test('searchCatalog respects the limit', () => {
  assert.ok(searchCatalog(CAT, 'co', 2).length <= 2);
});

test('searchCatalog matches all tokens in any order', () => {
  const cat = CAT.concat([{ itemType: 2, defId: 285, name: 'Rare Spiked Collar (Long)' }]);
  assert.ok(searchCatalog(cat, 'long collar').some((x) => x.name === 'Rare Spiked Collar (Long)'));
  assert.ok(searchCatalog(cat, 'collar long').some((x) => x.name === 'Rare Spiked Collar (Long)'));
});

test('searchCatalog excludes entries missing any token', () => {
  const r = searchCatalog(CAT, 'rare couch');
  assert.strictEqual(r.length, 0);
});

test('searchCatalog ranks prefix matches ahead of mid-string matches', () => {
  const r = searchCatalog(CAT, 'spiked');
  assert.strictEqual(r[0].name, 'Spiked Collar');
});

test('buildCatalog tolerates a broken resolver', () => {
  assert.deepStrictEqual(buildCatalog({ all() { throw new Error('no packs'); } }), []);
});

test('canonicalizeByName collapses re-released defs to the most-observed one', () => {
  const dupes = [
    { itemType: 2, defId: 279, name: 'Rare Spiked Collar (Long)' },
    { itemType: 2, defId: 285, name: 'Rare Spiked Collar (Long)' },
    { itemType: 2, defId: 1855, name: 'Rare Spiked Collar (Long)' },
    { itemType: 0, defId: 91, name: 'Pirate Chest' }
  ];
  const obs = new Map([['2:285', 4743], ['2:1855', 308], ['0:91', 12]]);
  const out = canonicalizeByName(dupes, obs);
  assert.strictEqual(out.length, 2, 'one entry per unique name');
  const collar = out.find((x) => x.name.startsWith('Rare Spiked'));
  assert.strictEqual(collar.defId, 285, 'keeps the observed def, not the lowest id');
  assert.strictEqual(collar.obs, 4743);
});

test('canonicalizeByName keeps the lowest def_id when no observations exist', () => {
  const dupes = [
    { itemType: 2, defId: 285, name: 'Mystery Item' },
    { itemType: 2, defId: 279, name: 'Mystery Item' }
  ];
  const out = canonicalizeByName(dupes, new Map());
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].defId, 279);
});
