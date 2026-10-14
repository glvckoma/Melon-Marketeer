const test = require('node:test');
const assert = require('node:assert');
const { makeLoadCache } = require('../admin/public/shared.js');

test('load cache memoizes within ttl', async () => {
  let calls = 0;
  const cache = makeLoadCache(() => 1000);
  const f = async () => (++calls, calls);
  assert.strictEqual(await cache.load('k', f, { ttlMs: 50 }), 1);
  assert.strictEqual(await cache.load('k', f, { ttlMs: 50 }), 1);
  assert.strictEqual(calls, 1);
});

test('load cache refetches after ttl expires', async () => {
  let t = 1000;
  let calls = 0;
  const cache = makeLoadCache(() => t);
  const f = async () => (++calls, calls);
  assert.strictEqual(await cache.load('k', f, { ttlMs: 50 }), 1);
  t = 1100;
  assert.strictEqual(await cache.load('k', f, { ttlMs: 50 }), 2);
  assert.strictEqual(calls, 2);
});

test('refresh forces a refetch on next load', async () => {
  let calls = 0;
  const cache = makeLoadCache(() => 1000);
  const f = async () => (++calls, calls);
  await cache.load('k', f, { ttlMs: 9999 });
  cache.refresh('k');
  await cache.load('k', f, { ttlMs: 9999 });
  assert.strictEqual(calls, 2);
});

test('a rejected fetch is not cached', async () => {
  let calls = 0;
  const cache = makeLoadCache(() => 1000);
  const f = async () => { calls++; throw new Error('boom'); };
  await assert.rejects(() => cache.load('k', f, { ttlMs: 9999 }));
  await assert.rejects(() => cache.load('k', f, { ttlMs: 9999 }));
  assert.strictEqual(calls, 2);
});

test('distinct keys are cached independently', async () => {
  const cache = makeLoadCache(() => 1000);
  assert.strictEqual(await cache.load('a', async () => 'A', { ttlMs: 99 }), 'A');
  assert.strictEqual(await cache.load('b', async () => 'B', { ttlMs: 99 }), 'B');
  assert.strictEqual(await cache.load('a', async () => 'X', { ttlMs: 99 }), 'A');
});
