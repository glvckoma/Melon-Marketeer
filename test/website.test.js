const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const rm = require('../api/readModel.js');
const { USERNAME_RE, createRateLimiter, publicOverview } = require('../web/server.js');

function seed() {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [
    { itemType: 2, defId: 444, name: 'Spiked Collar', abbr: 'spike' },
    { itemType: 0, defId: 99, name: 'Rare Item Monday', abbr: 'rim' }
  ] });
  db.insertObservations([
    { ownerName: 'AlphaSeller', shopId: 1, invIdx: 0, defId: 444, itemType: 2, cost: 900, currencyType: 0, color: 4294901760, scrapedAt: 10 },
    { ownerName: 'BetaSeller', shopId: 2, invIdx: 0, defId: 444, itemType: 2, cost: 700, currencyType: 0, color: 0, scrapedAt: 20 },
    { ownerName: 'AlphaSeller', shopId: 1, invIdx: 2, defId: 99, itemType: 0, cost: 5, currencyType: 3, color: null, scrapedAt: 40 }
  ]);
  db.upsertWikiWorth('Spiked Collar', 'http://wiki/spiked-collar', 'Decent Long Wrist');
  return db;
}

test('username regex accepts valid and rejects invalid handles', () => {
  assert.ok(USERNAME_RE.test('Awesomninja59'));
  assert.ok(USERNAME_RE.test('abc'));
  assert.ok(USERNAME_RE.test('Dëälunäë'));
  assert.ok(USERNAME_RE.test('Aethéria'));
  assert.ok(USERNAME_RE.test('0pégasus'));
  assert.ok(USERNAME_RE.test('Aløhæ'));
  assert.ok(!USERNAME_RE.test('ab'));
  assert.ok(!USERNAME_RE.test('has space'));
  assert.ok(!USERNAME_RE.test('has-dash'));
  assert.ok(!USERNAME_RE.test('waytoolongusernamehere123'));
  assert.ok(!USERNAME_RE.test(''));
});

test('rate limiter blocks past the max within the window', () => {
  const allow = createRateLimiter({ windowMs: 60000, max: 3 });
  assert.ok(allow('1.1.1.1'));
  assert.ok(allow('1.1.1.1'));
  assert.ok(allow('1.1.1.1'));
  assert.ok(!allow('1.1.1.1'));
  assert.ok(allow('2.2.2.2'));
});

test('itemDetail now carries a resolved itemName', async () => {
  const db = seed();
  const d = await rm.itemDetail(db, 2, 444);
  assert.strictEqual(d.itemName, 'Spiked Collar');
  assert.ok(d.sellers.length >= 2);
});

test('publicOverview exposes only public-safe fields', async () => {
  const db = seed();
  const o = await publicOverview(db);
  assert.deepStrictEqual(Object.keys(o.stats).sort(), ['items', 'observations', 'sellers']);
  assert.ok(o.topSellers.length >= 1);
  assert.ok(o.mostValuable.length >= 1);
  assert.ok(Array.isArray(o.trending));
  assert.strictEqual(o.scraper, undefined);
  assert.strictEqual(o.stats.livePool, undefined);
});

test('itemName returns null for unknown item', () => {
  const db = seed();
  assert.strictEqual(db.itemName(7, 7), null);
});
