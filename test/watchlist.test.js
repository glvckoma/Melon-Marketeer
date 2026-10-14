const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');

const obs = (overrides) => ({
  ownerName: 'Seller', shopId: 1, invIdx: 0, defId: 10, itemType: 2,
  cost: 100, currencyType: 0, color: 0, scrapedAt: Date.now(), ...overrides
});

test('addWatch / listWatches / removeWatch round-trip', () => {
  const db = new Database(':memory:');
  const w = db.addWatch({ kind: 'item', itemType: 2, defId: 10, currencyType: 0, maxCost: 200, label: 'Collar' });
  assert.strictEqual(w.kind, 'item');
  assert.strictEqual(w.def_id, 10);
  assert.strictEqual(w.max_cost, 200);
  assert.strictEqual(db.listWatches().length, 1);
  db.removeWatch(w.id);
  assert.strictEqual(db.listWatches().length, 0);
  db.close();
});

test('item watch alerts only on new matching observations within filters', () => {
  const db = new Database(':memory:');
  db.insertObservations([obs({ cost: 100 }), obs({ cost: 150 }), obs({ cost: 120 })]);
  const w = db.addWatch({ kind: 'item', itemType: 2, defId: 10, currencyType: 0, maxCost: 200, label: 'Collar' });
  assert.strictEqual(db.watchAlerts().length, 0, 'no alerts for observations that predate the watch');

  db.insertObservations([
    obs({ cost: 100, scrapedAt: Date.now() + 1 }),
    obs({ cost: 500, scrapedAt: Date.now() + 2 }),
    obs({ cost: 50, currencyType: 3, scrapedAt: Date.now() + 3 }),
    obs({ defId: 99, cost: 10, scrapedAt: Date.now() + 4 })
  ]);
  const alerts = db.watchAlerts();
  assert.strictEqual(alerts.length, 1, 'only the new, under-max, gem, matching-item observation');
  assert.strictEqual(alerts[0].row.cost, 100);
  assert.strictEqual(alerts[0].watchId, w.id);
  db.close();
});

test('seller watch alerts only on that owner new observations', () => {
  const db = new Database(':memory:');
  db.insertObservations([obs({ ownerName: 'Bob' })]);
  db.addWatch({ kind: 'seller', ownerName: 'Bob', label: 'Bob' });
  assert.strictEqual(db.watchAlerts().length, 0);
  db.insertObservations([
    obs({ ownerName: 'Bob', cost: 75, scrapedAt: Date.now() + 1 }),
    obs({ ownerName: 'Alice', cost: 5, scrapedAt: Date.now() + 2 })
  ]);
  const alerts = db.watchAlerts();
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].row.owner_name, 'Bob');
  db.close();
});

test('markWatchesSeen advances the watermark and clears alerts', () => {
  const db = new Database(':memory:');
  db.addWatch({ kind: 'item', itemType: 2, defId: 10, label: 'Collar' });
  db.insertObservations([obs({ cost: 30 }), obs({ cost: 40 })]);
  assert.strictEqual(db.watchAlerts().length, 2);
  db.markWatchesSeen();
  assert.strictEqual(db.watchAlerts().length, 0);
  db.insertObservations([obs({ cost: 45 })]);
  assert.strictEqual(db.watchAlerts().length, 1, 'a later observation re-triggers the watch');
  db.close();
});

test('maxObsId reflects inserted observations', () => {
  const db = new Database(':memory:');
  assert.strictEqual(db.maxObsId(), 0);
  db.insertObservations([obs(), obs()]);
  assert.strictEqual(db.maxObsId(), 2);
  db.close();
});
