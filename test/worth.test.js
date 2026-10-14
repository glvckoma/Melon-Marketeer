const test = require('node:test');
const assert = require('node:assert');
const { worthScore } = require('../items/worth.js');

test('worthScore zeroes in-stores items', () => {
  assert.strictEqual(worthScore('Currently in stores'), 0);
  assert.strictEqual(worthScore('In Stores'), 0);
  assert.strictEqual(worthScore(null), 0);
  assert.strictEqual(worthScore(''), 0);
});

test('worthScore ranks rares above commons', () => {
  assert.ok(worthScore('Spike Headdress') > worthScore('A Few Clothing Betas'));
  assert.ok(worthScore('A Few Clothing Betas') > worthScore('Decent Short Collar'));
  assert.ok(worthScore('Decent Short Collar') > 0);
  assert.ok(worthScore('Some unrecognized worth note') > 0);
});
