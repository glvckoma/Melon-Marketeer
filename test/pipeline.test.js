const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const Client = require('../bot/Client.js');
const Database = require('../db/Database.js');
const path = require('path');
const DenItemDefs = require('../scraper/DenItemDefs.js');

const DEFS_FIXTURE = path.join(__dirname, 'fixtures', 'denitemdefs.json');
const ShopScraper = require('../scraper/ShopScraper.js');

const F10 = 'f1%f2%f3%f4%f5%f6%f7%f8%f9%f10';
const DS_OK = `%xt%ds%F%1%0%1%500%3993%${F10}%`;
const DSI = '%xt%dsi%1%1%2%open%1%500%2%111%222%q%0%1000%0%333%444%a%b%c%d%e%';

function makeController() {
  const c = new EventEmitter();
  c.roomid = '100';
  c.lastDenStateAt = 0;
  c.setMaxListeners(0);
  c.Log = () => {};
  c.sendXMLMessage = async () => {};
  c.sendXTMessage = async (args) => {
    if (args[0] === 'dj') c.emit('received', Buffer.from(DS_OK));
    else if (args[0] === 'dsi') c.emit('received', Buffer.from(DSI));
  };
  return c;
}

const FAST = { dsTimeout: 1500, dsiTimeout: 1500, dsiDelayMin: 1, dsiDelayMax: 2, denDelayMin: 1, denDelayMax: 2 };

test('ScrapeDenShops returns shop items', async () => {
  const defs = new DenItemDefs(DEFS_FIXTURE);
  defs.load();
  const client = new Client({ username: 'bot1', password: 'x' });
  client.controller = makeController();
  const r = await client.ScrapeDenShops('victim', { defs, options: FAST });
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.shopIds, [500]);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[0].cost, 500);
  assert.strictEqual(r.items[1].cost, 1000);
});

test('ShopScraper persists observations and marks den scraped', async () => {
  const defs = new DenItemDefs(DEFS_FIXTURE);
  defs.load();
  const client = new Client({ username: 'bot1', password: 'x' });
  client.controller = makeController();
  const db = new Database(':memory:');
  db.enqueueUsername('victim', 'nearby');

  const job = new ShopScraper({ getClients: () => [client], db, defs, options: FAST });
  const res = await job.run();

  assert.strictEqual(res.done, 1);
  assert.strictEqual(res.items, 2);
  assert.strictEqual(db.stats().observations, 2);
  assert.strictEqual(db.hasDenScraped('victim'), true);
  db.close();
});

test('ShopScraper reports no active clients', async () => {
  const defs = new DenItemDefs(DEFS_FIXTURE);
  defs.load();
  const db = new Database(':memory:');
  const job = new ShopScraper({ getClients: () => [], db, defs, options: FAST });
  const res = await job.run(['someone']);
  assert.strictEqual(res.error, 'no active clients');
  db.close();
});
