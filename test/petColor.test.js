const test = require('node:test');
const assert = require('node:assert');
const { getAnimalPalette, unpackPetBits, decodePetColor } = require('../items/petColor.js');
const Database = require('../db/Database.js');
const rm = require('../api/readModel.js');

test('unpackPetBits splits the documented bit layout', () => {
  const b = unpackPetBits(15388);
  assert.strictEqual(b.species, 28);
  assert.strictEqual(b.color1, 60);
  assert.strictEqual(b.color2, 0);
  assert.strictEqual(b.color3, 0);
  assert.strictEqual(b.pattern, 0);
  assert.strictEqual(b.eye, 0);
});

test('getAnimalPalette ports the 26 base colors plus 3x25 variants', () => {
  const p = getAnimalPalette();
  assert.strictEqual(p.length, 101);
  assert.strictEqual(p[0], 4278255615);
  assert.strictEqual(p[3], 4294901760);
});

test('decodePetColor returns a hex + css for the real AVAPUGS sample', () => {
  const c = decodePetColor('15388|27248');
  assert.ok(c);
  assert.strictEqual(c.color1, 60);
  assert.match(c.hex, /^#FF[0-9A-F]{6}$/);
  assert.match(c.css, /^rgb\(\d+,\d+,\d+\)$/);
  assert.strictEqual(c.raw, '15388|27248');
});

test('unpackPetBits decodes the 6 uBits part/accessory slots', () => {
  const b = unpackPetBits(15388, 27248);
  assert.deepStrictEqual(b.parts, [0, 7, 10, 6, 0, 0]);
});

test('decodePetColor exposes full appearance: 3 colors, pattern, eye, parts', () => {
  const c = decodePetColor('15388|27248');
  assert.deepStrictEqual(c.parts, [0, 7, 10, 6, 0, 0]);
  assert.strictEqual(c.activeParts, 3);
  assert.strictEqual(c.colors.primary.index, 60);
  assert.match(c.colors.primary.gameHex, /^#FF[0-9A-F]{6}$/);
  assert.match(c.colors.primary.animalHex, /^#FF[0-9A-F]{6}$/);
  assert.ok(c.colors.secondary && c.colors.tertiary);
});

test('decodePetColor tolerates a missing uBits half', () => {
  const c = decodePetColor('15388');
  assert.ok(c);
  assert.deepStrictEqual(c.parts, [0, 0, 0, 0, 0, 0]);
  assert.strictEqual(c.activeParts, 0);
});

test('decodePetColor is null-safe on malformed input', () => {
  assert.strictEqual(decodePetColor(null), null);
  assert.strictEqual(decodePetColor(''), null);
  assert.strictEqual(decodePetColor('nope'), null);
  assert.strictEqual(decodePetColor('|'), null);
});

test('pet appearance round-trips through tradelist and decodes in readModel', async () => {
  const db = new Database(':memory:');
  db.recordTradeList('PetSeller', [
    { defId: 57, itemType: 1, field2: 50, color: null, petAppearance: '15388|27248' },
    { defId: 286, itemType: 2, field2: 708, color: 374669312, petAppearance: null }
  ]);
  const rows = db.tradeListFor('PetSeller');
  assert.strictEqual(rows.find((r) => r.item_type === 1).pet_appearance, '15388|27248');

  const sd = await rm.sellerDetail(db, 'PetSeller');
  const pet = sd.tradeList.find((x) => x.itemType === 1);
  assert.strictEqual(pet.color, null, 'pets have no swatch');
  const clothing = sd.tradeList.find((x) => x.itemType === 2);
  assert.ok(clothing.color && !clothing.color.pet, 'clothing keeps its palette decode');
});
