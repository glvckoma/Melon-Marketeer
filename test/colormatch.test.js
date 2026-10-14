const test = require('node:test');
const assert = require('node:assert');
const { nearestColorName, hexForColorName } = require('../items/colorName.js');
const { coreTokens, bestMatch } = require('../items/wikiMatch.js');

test('nearestColorName maps hex to a basic color', () => {
  assert.strictEqual(nearestColorName('#0a0a0a'), 'Black');
  assert.strictEqual(nearestColorName('#ffffff'), 'White');
  assert.strictEqual(nearestColorName('#2f6fd0'), 'Blue');
  assert.strictEqual(nearestColorName('#d61f1f'), 'Red');
  assert.strictEqual(nearestColorName(0x39b24d), 'Green');
  assert.strictEqual(nearestColorName('not a color'), null);
});

test('hexForColorName resolves known base colors and synonyms, null otherwise', () => {
  assert.strictEqual(hexForColorName('Pink'), '#f06fb8');
  assert.strictEqual(hexForColorName('blue'), '#2b6fd6');
  assert.strictEqual(hexForColorName('magenta'), '#f06fb8');
  assert.strictEqual(hexForColorName('grey'), '#9aa0a6');
  assert.strictEqual(hexForColorName('Rainbow'), null);
  assert.strictEqual(hexForColorName('Glittery Sparkle'), null);
  assert.strictEqual(hexForColorName(''), null);
  assert.strictEqual(hexForColorName(null), null);
});

test('coreTokens strips qualifiers and color words', () => {
  assert.deepStrictEqual(coreTokens('Rare Spiked Wristband'), ['spiked', 'wristband']);
  assert.deepStrictEqual(coreTokens('Magenta Rare Long Wristband'), ['wristband']);
  assert.deepStrictEqual(coreTokens('Blackout Spiked Wristband (Long)'), ['blackout', 'spiked', 'wristband']);
});

test('bestMatch prefers the most generic wiki entry and rejects different items', () => {
  const wiki = [
    'Spiked Wristband', 'Blackout Spiked Wristband (Long)', 'Magenta Rare Long Wristband', 'Spiked Collar'
  ].map((title) => ({ title, core: new Set(coreTokens(title)) }));
  const m = bestMatch('Rare Spiked Wristband', wiki);
  assert.strictEqual(m.title, 'Spiked Wristband');
  assert.strictEqual(m.extra, 0);
  // an item whose core noun is absent gets no match
  assert.strictEqual(bestMatch('Feathered Mask', wiki), null);
});
