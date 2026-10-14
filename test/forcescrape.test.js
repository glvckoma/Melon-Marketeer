const test = require('node:test');
const assert = require('node:assert');
const ShopScraper = require('../scraper/ShopScraper.js');

function fakeDb() {
  return { enqueueUsername() {}, hasDenScraped() { return true; }, getQueuedUsernames() { return []; } };
}

test('force:false skips a username whose den is already known', async () => {
  const job = new ShopScraper({ getClients: () => [], db: fakeDb(), defs: {}, options: { force: false } });
  await job.run(['Madeleine1203']);
  assert.deepStrictEqual(job.queue, []);
});

test('force:true re-scrapes a known den', async () => {
  const job = new ShopScraper({ getClients: () => [], db: fakeDb(), defs: {}, options: { force: true } });
  await job.run(['Madeleine1203']);
  assert.deepStrictEqual(job.queue, ['Madeleine1203']);
});
