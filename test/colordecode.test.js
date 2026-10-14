const test = require('node:test');
const assert = require('node:assert');
const { resolveColor } = require('../items/Color.js');
const { colorInfo } = require('../api/readModel.js');

test('directIndex decodes den-item colors as a direct palette index', () => {
  const wrong3 = resolveColor(3);
  const wrong7 = resolveColor(7);
  assert.strictEqual(wrong3.hexColor, wrong7.hexColor);

  const right3 = resolveColor(3, { directIndex: true });
  const right7 = resolveColor(7, { directIndex: true });
  assert.strictEqual(right3.paletteIndex, 3);
  assert.strictEqual(right7.paletteIndex, 7);
  assert.notStrictEqual(right3.hexColor, right7.hexColor);
  assert.notStrictEqual(right3.hexColor, wrong3.hexColor);
});

test('directIndex falls through for large (ARGB/clothing) values', () => {
  const big = 0x80112233 >>> 0;
  assert.deepStrictEqual(resolveColor(big, { directIndex: true }), resolveColor(big));
});

test('den items carry no color', () => {
  assert.strictEqual(colorInfo(0, 0), null);
  assert.strictEqual(colorInfo(7, 0), null);
  assert.strictEqual(colorInfo(41, 0), null);
  assert.strictEqual(colorInfo(null, 0), null);
  assert.strictEqual(colorInfo(0, 2), null);
  const real = colorInfo(408223744, 2);
  assert.ok(real && real.hex);
  assert.strictEqual(real.css, resolveColor(408223744, { directIndex: false }).cssColor);
});
