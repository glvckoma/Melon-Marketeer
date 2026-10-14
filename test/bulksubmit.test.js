const test = require('node:test');
const assert = require('node:assert');
const { parseSubmittedUsernames } = require('../web/server.js');

test('parseSubmittedUsernames strips logger timestamps and validates', () => {
  const raw = [
    '2025-06-17T22:07:11.222Z - Xxkitxx101',
    'givemenull',
    '  spacedName  ',
    'has space',
    'ab',
    '2025-06-17T22:11:46.087Z - halfwørlder'
  ].join('\n');
  const { valid, skipped } = parseSubmittedUsernames(raw);
  assert.deepStrictEqual(valid, ['Xxkitxx101', 'givemenull', 'spacedName', 'halfwørlder']);
  assert.strictEqual(skipped, 2); // "has space" and "ab" (accented handles like halfwørlder are valid AJ usernames)
});

test('parseSubmittedUsernames accepts an array and caps at 5000', () => {
  const arr = Array.from({ length: 6000 }, (_, i) => `user${i}`);
  const { valid } = parseSubmittedUsernames(arr);
  assert.strictEqual(valid.length, 5000);
});
