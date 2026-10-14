const test = require('node:test');
const assert = require('node:assert');
const { parseDenState } = require('../scraper/DenStateParser.js');
const ShopScraper = require('../scraper/ShopScraper.js');

const portalType = (defId) => (defId === 999 ? 1 : 0);

test('parseDenState extracts den portals with coordinates and name', () => {
  const wire = '%xt%ds%12345%1%0%0%50%999%0%800%600%0%0%TargetAlt%0%0%0%0%';
  const r = parseDenState(wire, portalType);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.shopInvIdxs.length, 0);
  assert.strictEqual(r.portals.length, 1);
  assert.deepStrictEqual(r.portals[0], { invIdx: 50, defId: 999, x: 800, y: 600, name: 'TargetAlt' });
});

test('parseDenState portal name is null when blank or literal null', () => {
  const wire = '%xt%ds%12345%1%0%0%50%999%0%800%600%0%0%null%0%0%0%0%';
  const r = parseDenState(wire, portalType);
  assert.strictEqual(r.portals[0].name, null);
});

test('parseDenState still finds shops alongside portals', () => {
  const shopOrPortal = (defId) => (defId === 999 ? 1 : (defId === 777 ? 5 : 0));
  const portal = '50%999%0%800%600%0%0%Alt%0%0%0%0';
  const shop = '60%777%0%100%100%0%0%null%0%0%0%0';
  const wire = `%xt%ds%12345%2%0%0%${portal}%${shop}%`;
  const r = parseDenState(wire, shopOrPortal);
  assert.deepStrictEqual(r.shopInvIdxs, [60]);
  assert.strictEqual(r.portals.length, 1);
  assert.strictEqual(r.portals[0].invIdx, 50);
});

test('ShopScraper persists each den in a multi-den result under its own owner', () => {
  const dens = [];
  const obs = [];
  const scraped = [];
  const fakeDb = {
    insertObservations: (rows) => obs.push(...rows),
    recordDen: (owner, shopIds, count, status) => dens.push({ owner, count, status }),
    markUsernameScraped: (name) => scraped.push(name)
  };
  const scraper = new ShopScraper({ getClients: () => [], db: fakeDb, defs: {} });
  const client = { username: 'bot1', controller: {} };
  const result = {
    status: 'ok',
    shopIds: [1],
    items: [{ shopId: 1, invIdx: 0, defId: 10, itemType: 2, cost: 100, currencyType: 0, color: 0 }],
    dens: [
      { owner: 'Origin', status: 'ok', shopIds: [1], items: [{ shopId: 1, invIdx: 0, defId: 10, itemType: 2, cost: 100, currencyType: 0, color: 0 }] },
      { owner: 'TargetAlt', status: 'ok', shopIds: [2], items: [{ shopId: 2, invIdx: 1, defId: 20, itemType: 2, cost: 5, currencyType: 3, color: 0 }] }
    ]
  };
  scraper._persist(client, 'Origin', result);
  assert.strictEqual(obs.length, 2);
  assert.deepStrictEqual(scraped.sort(), ['Origin', 'TargetAlt']);
  assert.strictEqual(dens.length, 2);
  assert.ok(dens.find((d) => d.owner === 'TargetAlt'));
  assert.strictEqual(scraper.stats_.done, 1);
  assert.strictEqual(scraper.stats_.items, 2);
});

test('ShopScraper falls back to single-den persist when no dens array', () => {
  const dens = [];
  const fakeDb = {
    insertObservations: () => {},
    recordDen: (owner) => dens.push(owner),
    markUsernameScraped: () => {}
  };
  const scraper = new ShopScraper({ getClients: () => [], db: fakeDb, defs: {} });
  scraper._persist({ username: 'b' }, 'Solo', { status: 'ok', shopIds: [], items: [] });
  assert.deepStrictEqual(dens, ['Solo']);
  assert.strictEqual(scraper.stats_.done, 1);
});

test('_portalOwner rejects numeric and malformed names, accepts usernames', () => {
  const Client = require('../bot/Client.js');
  const c = Object.create(Client.prototype);
  assert.strictEqual(c._portalOwner({ name: 'CoolSeller' }), 'CoolSeller');
  assert.strictEqual(c._portalOwner({ name: '12345' }), null);
  assert.strictEqual(c._portalOwner({ name: null }), null);
  assert.strictEqual(c._portalOwner({ name: 'a b' }), null);
});
