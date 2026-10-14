const test = require('node:test');
const assert = require('node:assert');
const { parsePacket, parseTradeList } = require('../scraper/TradeListParser.js');
const Database = require('../db/Database.js');
const ShopScraper = require('../scraper/ShopScraper.js');
const rm = require('../api/readModel.js');

const AVAPUGS = '%xt%tl%2239330%Avapugs%5%755%199%1063590144%705%136%1075123520%542%216%807153152%727%217%1061159423%399%171%-127309463%0%1%57%50%1527607923%570508857%16%0%15388|27248%25926%380%548%';
const PEPPER = '%xt%tl%2239572%pepperonijuice%7%286%708%374669312%148%772%-748027904%286%1050%156565504%286%1004%357892096%277%1500%1734947327%277%413%417608191%148%1151%1785331712%5%1094%1136%0%true%%0%%973%1346%0%true%%0%%44%1350%0%true%%0%%695%43%0%true%%0%%482%158%0%true%%0%%0%';

function captureHarness(tl) {
  const recorded = [];
  let tlCalls = 0;
  const db = {
    enqueueUsername() {}, hasDenScraped() { return false; }, getQueuedUsernames() { return ['Seller1']; },
    insertObservations() {}, recordDen() {}, markUsernameScraped() {},
    recordTradeList(owner, items) { recorded.push({ owner, items }); }
  };
  const client = {
    username: 'bot1', controller: {}, setActivity() {},
    async ScrapeDenShops() { return { status: 'ok', shopIds: [1], items: [] }; },
    async RequestTradeList() { tlCalls++; return tl; }
  };
  return { db, client, recorded, calls: () => tlCalls };
}

test('parseTradeList assigns itemType by section (clothing, den, pet)', () => {
  const r = parsePacket(PEPPER);
  assert.strictEqual(r.owner, 'pepperonijuice');
  assert.strictEqual(r.count, 12);
  assert.strictEqual(r.items.filter((i) => i.itemType === 2).length, 7);
  assert.strictEqual(r.items.filter((i) => i.itemType === 0).length, 5);
  assert.strictEqual(r.items.filter((i) => i.itemType === 1).length, 0);
});

test('clothing records are defId/field2/color triplets', () => {
  const r = parsePacket(PEPPER);
  assert.deepStrictEqual(r.items[0], { defId: 286, itemType: 2, field2: 708, color: 374669312, petAppearance: null });
});

test('den records use stride 7 and carry no color', () => {
  const r = parsePacket(PEPPER);
  const den = r.items.filter((i) => i.itemType === 0);
  assert.deepStrictEqual(den.map((d) => d.defId), [1094, 973, 44, 695, 482]);
  assert.ok(den.every((d) => d.color === null));
});

test('pet records parse with null color and capture the colorPair appearance', () => {
  const r = parsePacket(AVAPUGS);
  assert.strictEqual(r.count, 6);
  const pets = r.items.filter((i) => i.itemType === 1);
  assert.strictEqual(pets.length, 1);
  assert.deepStrictEqual(pets[0], { defId: 57, itemType: 1, field2: 50, color: null, petAppearance: '15388|27248' });
});

test('duplicate defIds in a section are kept as separate items', () => {
  const r = parsePacket(PEPPER);
  assert.strictEqual(r.items.filter((i) => i.defId === 286 && i.itemType === 2).length, 3);
});

test('parseTradeList returns null for a non-tradelist packet', () => {
  assert.strictEqual(parseTradeList(['', 'xt', 'dsi', '7718', 'X', '1'].slice()), null);
});

test('recordTradeList round-trips typed rows and queries holders by (itemType, defId)', () => {
  const db = new Database(':memory:');
  const r = parsePacket(PEPPER);
  db.recordTradeList(r.owner, r.items);
  assert.strictEqual(db.tradeListFor(r.owner).length, 12);
  assert.strictEqual(db.tradeListFor(r.owner).filter((x) => x.def_id === 286).length, 3);
  assert.deepStrictEqual(db.tradeListHolders(2, 286), ['pepperonijuice']);
  assert.deepStrictEqual(db.tradeListHolders(0, 1094), ['pepperonijuice']);
  assert.deepStrictEqual(db.tradeListHolders(2, 1094), []);
  assert.deepStrictEqual(db.tradeListHolders(0, 286), []);
  db.recordTradeList(r.owner, r.items.slice(0, 3));
  assert.strictEqual(db.tradeListFor(r.owner).length, 3);
});

test('readModel tradeHolders + sellerDetail.tradeList shape the data', async () => {
  const db = new Database(':memory:');
  db.recordTradeList(parsePacket(PEPPER).owner, parsePacket(PEPPER).items);
  const holders = await rm.tradeHolders(db, 2, 286);
  assert.deepStrictEqual(holders.map((h) => h.owner), ['pepperonijuice']);
  assert.deepStrictEqual((await rm.tradeHolders(db, 0, 1094)).map((h) => h.owner), ['pepperonijuice']);
  assert.deepStrictEqual(await rm.tradeHolders(db, 2, 1094), []);
  const sd = await rm.sellerDetail(db, 'pepperonijuice');
  assert.strictEqual(sd.tradeList.length, 12);
  assert.ok(sd.tradeList.some((x) => x.itemType === 0));
  assert.ok(sd.tradeList.every((x) => typeof x.name === 'string'));
});

test('captureTradeLists records a holder trade list during a den scrape', async () => {
  const h = captureHarness({ status: 'ok', items: parsePacket(AVAPUGS).items });
  const job = new ShopScraper({ getClients: () => [h.client], db: h.db, defs: {}, options: { force: true, captureTradeLists: true, denDelayMin: 0, denDelayMax: 0, dsiDelayMin: 0, dsiDelayMax: 0 } });
  const stats = await job.run(['Seller1']);
  assert.strictEqual(h.calls(), 1);
  assert.strictEqual(h.recorded.length, 1);
  assert.strictEqual(h.recorded[0].items.length, 6);
  assert.strictEqual(stats.tradelists, 1);
});

test('captureTradeLists off never requests a trade list', async () => {
  const h = captureHarness({ status: 'ok', items: parsePacket(AVAPUGS).items });
  const job = new ShopScraper({ getClients: () => [h.client], db: h.db, defs: {}, options: { force: true, captureTradeLists: false, denDelayMin: 0, denDelayMax: 0 } });
  await job.run(['Seller1']);
  assert.strictEqual(h.calls(), 0);
  assert.strictEqual(h.recorded.length, 0);
});

test('an empty trade list is not recorded', async () => {
  const h = captureHarness({ status: 'ok', items: [] });
  const job = new ShopScraper({ getClients: () => [h.client], db: h.db, defs: {}, options: { force: true, captureTradeLists: true, denDelayMin: 0, denDelayMax: 0, dsiDelayMin: 0, dsiDelayMax: 0 } });
  const stats = await job.run(['Seller1']);
  assert.strictEqual(h.calls(), 1);
  assert.strictEqual(h.recorded.length, 0);
  assert.strictEqual(stats.tradelists, 0);
});
