const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../db/Database.js');
const { readAnomalies } = require('../scraper/AnomalyLog.js');

function seed() {
  const db = new Database(':memory:');
  db.insertObservations([
    { ownerName: 'A', shopId: 1, invIdx: 0, defId: 10, itemType: 2, cost: 100, currencyType: 0, color: 0, scrapedAt: 1000 },
    { ownerName: 'B', shopId: 1, invIdx: 1, defId: 10, itemType: 2, cost: 300, currencyType: 0, color: 0, scrapedAt: 2000 },
    { ownerName: 'C', shopId: 1, invIdx: 2, defId: 10, itemType: 2, cost: 500, currencyType: 0, color: 0, scrapedAt: 3000 },
    { ownerName: 'D', shopId: 1, invIdx: 3, defId: 10, itemType: 2, cost: 7, currencyType: 3, color: 0, scrapedAt: 4000 }
  ]);
  return db;
}

test('priceSeries returns time-ordered rows since cutoff for one currency', () => {
  const db = seed();
  const all = db.priceSeries(2, 10, 0, 0);
  assert.strictEqual(all.length, 3);
  assert.deepStrictEqual(all.map((r) => r.scraped_at), [1000, 2000, 3000]);
  const since = db.priceSeries(2, 10, 0, 2000);
  assert.deepStrictEqual(since.map((r) => r.cost), [300, 500]);
  assert.strictEqual(db.priceSeries(2, 10, 3, 0).length, 1);
  db.close();
});

test('observationsOverTime returns timestamps since cutoff ascending', () => {
  const db = seed();
  assert.deepStrictEqual(db.observationsOverTime(0), [1000, 2000, 3000, 4000]);
  assert.deepStrictEqual(db.observationsOverTime(2500), [3000, 4000]);
  db.close();
});

test('sampleByCurrency returns newest-first rows for a currency', () => {
  const db = seed();
  const gems = db.sampleByCurrency(0, 8);
  assert.strictEqual(gems.length, 3);
  assert.strictEqual(gems[0].scraped_at, 3000);
  assert.strictEqual(db.sampleByCurrency(3, 8).length, 1);
  db.close();
});

test('readAnomalies tails the file newest-first and skips bad lines', () => {
  const file = path.join(os.tmpdir(), `anom-${process.pid}.jsonl`);
  const lines = [
    JSON.stringify({ ts: 1, kind: 'a', owner: 'x', raw: 'one' }),
    'not json',
    JSON.stringify({ ts: 2, kind: 'b', owner: 'y', raw: 'two' }),
    JSON.stringify({ ts: 3, kind: 'c', owner: 'z', raw: 'three' })
  ];
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const all = readAnomalies(100, file);
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].ts, 3);
  const limited = readAnomalies(2, file);
  assert.deepStrictEqual(limited.map((r) => r.ts), [3, 2]);
  fs.unlinkSync(file);
});

test('readAnomalies returns empty for missing file', () => {
  assert.deepStrictEqual(readAnomalies(10, path.join(os.tmpdir(), 'does-not-exist-xyz.jsonl')), []);
});
