const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const ContinuousScraper = require('../scraper/ContinuousScraper.js');

function fakeClient(username, shops, hooks = {}) {
  return {
    username,
    activity: 'idle',
    controller: { roomid: '-1' },
    joinedWorlds: [],
    setActivity(state) { this.activity = state; },
    JoinWorld(target) {
      this.joinedWorlds.push(target);
      if (hooks.onRoam) hooks.onRoam(target);
      return Promise.resolve();
    },
    async ScrapeDenShops(owner) {
      const items = shops[owner] || [];
      return { status: items.length ? 'ok' : 'empty', shopIds: items.length ? [1] : [], items };
    }
  };
}

const ITEM = { shopId: 1, invIdx: 0, defId: 444, itemType: 2, cost: 900, currencyType: 1, shopState: 'x' };
const farFuture = 9_000_000_000_000;

test('dead mode scrapes the fallback pool without roaming', async () => {
  const db = new Database(':memory:');
  db.enqueueUsername('DeadSeller', 'import');
  const client = fakeClient('bot1', { DeadSeller: [ITEM] });
  const cs = new ContinuousScraper({
    getClients: () => [client], db, defs: {},
    options: { mode: 'dead', staleThresholdMs: farFuture }
  });

  await cs._deadCycle();

  assert.strictEqual(client.joinedWorlds.length, 0, 'dead mode must not roam');
  assert.strictEqual(db.stats().observations, 1);
  assert.strictEqual(db.hasDenScraped('DeadSeller'), true);
  db.close();
});

test('dead mode idles when the fallback pool is empty', async () => {
  const db = new Database(':memory:');
  const cs = new ContinuousScraper({
    getClients: () => [fakeClient('bot1', {})], db, defs: {},
    options: { mode: 'dead', staleThresholdMs: farFuture, idleWaitMs: 1 }
  });

  await cs._deadCycle();

  assert.strictEqual(cs._phase, 'idle');
  assert.strictEqual(db.stats().observations, 0);
  db.close();
});

test('live mode roams rooms and scrapes players collected during the dwell', async () => {
  const db = new Database(':memory:');
  const client = fakeClient('bot1', { LiveSeller: [ITEM] }, {
    onRoam: () => db.markLive('LiveSeller')
  });
  const cs = new ContinuousScraper({
    getClients: () => [client], db, defs: {},
    options: { mode: 'live', collectDurationMs: 5, staleThresholdMs: farFuture }
  });

  await cs._liveCycle('live');

  assert.strictEqual(client.joinedWorlds.length, 1, 'live mode must roam one world per cycle');
  assert.match(client.joinedWorlds[0], /\.room_main#\d+$/);
  assert.strictEqual(db.stats().observations, 1, 'collected live seller should be scraped');
  db.close();
});

test('live mode resets stale live flags before each collect', async () => {
  const db = new Database(':memory:');
  db.markLive('StaleLivePlayer');
  const client = fakeClient('bot1', { StaleLivePlayer: [ITEM] });
  const cs = new ContinuousScraper({
    getClients: () => [client], db, defs: {},
    options: { mode: 'live', collectDurationMs: 5, staleThresholdMs: farFuture }
  });

  await cs._liveCycle('live');

  assert.strictEqual(db.stats().observations, 0, 'pre-existing live flag must be cleared, not scraped');
  db.close();
});

test('getStaleSellers queues sellers by observed last_seen, independent of dens.status', () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [{ itemType: 2, defId: 1, name: 'Thing', abbr: null }] });
  db.insertObservations([
    { ownerName: 'staleseller', shopId: 1, invIdx: 1, defId: 1, itemType: 2, cost: 5, currencyType: 3, color: null, shopState: 'open', scrapedBy: 'b', scrapedAt: 1000 },
    { ownerName: 'freshseller', shopId: 1, invIdx: 1, defId: 1, itemType: 2, cost: 5, currencyType: 3, color: null, shopState: 'open', scrapedBy: 'b', scrapedAt: farFuture }
  ]);
  db.rollupStats();

  const stale = db.getStaleSellers(60 * 1000, 50);
  assert.ok(stale.includes('staleseller'), 'a seller with old observations is refreshable without any dens ok-status');
  assert.ok(!stale.includes('freshseller'), 'a recently observed seller is not re-queued');
  db.close();
});

test('in-process stall watchdog never self-restarts an unproductive-but-alive loop', () => {
  const db = new Database(':memory:');
  db.enqueueUsername('Pending', 'import');
  let online = [];
  const cs = new ContinuousScraper({
    getClients: () => online, db, defs: {},
    options: { mode: 'auto', staleThresholdMs: farFuture }
  });
  cs._running = true;
  cs._lastProgressAt = 0;

  assert.strictEqual(cs._isStalled(), false, 'no clients online is not a stall');

  online = [fakeClient('bot1', {})];
  cs._lastStallWarnAt = 0;
  assert.strictEqual(cs._isStalled(), false, 'no progress with clients online is not a stall');

  db.close();
});

test('priority re-check is scraped first with force and cleared after', async () => {
  const db = new Database(':memory:');
  db.requestRecheck('PrioritySeller');
  assert.deepStrictEqual(db.getPriorityQueued(10), ['PrioritySeller']);

  const client = fakeClient('bot1', { PrioritySeller: [ITEM] });
  const cs = new ContinuousScraper({
    getClients: () => [client], db, defs: {},
    options: { mode: 'auto', staleThresholdMs: farFuture }
  });
  await cs._scrapePriority();

  assert.strictEqual(db.stats().observations, 1, 'priority seller was scraped');
  assert.deepStrictEqual(db.getPriorityQueued(10), [], 'priority cleared after a scrape attempt with clients online');
  db.close();
});

test('priority re-check stays queued when no clients are online', async () => {
  const db = new Database(':memory:');
  db.requestRecheck('Pending2');
  const cs = new ContinuousScraper({
    getClients: () => [], db, defs: {},
    options: { mode: 'auto', staleThresholdMs: farFuture }
  });
  await cs._scrapePriority();
  assert.deepStrictEqual(db.getPriorityQueued(10), ['Pending2'], 'not cleared without clients to do the work');
  db.close();
});

test('status reports mode, online count, and queue depths', () => {
  const db = new Database(':memory:');
  db.enqueueUsername('Pooled', 'import');
  const cs = new ContinuousScraper({
    getClients: () => [fakeClient('bot1', {}), fakeClient('bot2', {})], db, defs: {},
    options: { mode: 'live' }
  });

  const s = cs.status();
  assert.strictEqual(s.mode, 'live');
  assert.strictEqual(s.onlineClients, 2);
  assert.strictEqual(s.fallbackQueued, 1);
  assert.strictEqual(s.running, false);
  db.close();
});
