const test = require('node:test');
const assert = require('node:assert');
const { parseDsi } = require('../scraper/DsiParser.js');
const { parseDenState } = require('../scraper/DenStateParser.js');
const path = require('path');
const DenItemDefs = require('../scraper/DenItemDefs.js');

const DEFS_FIXTURE = path.join(__dirname, 'fixtures', 'denitemdefs.json');

const defs = new DenItemDefs(DEFS_FIXTURE);
defs.load();
const specialTypeOf = (d) => defs.specialTypeOf(d);

const F10 = 'f1%f2%f3%f4%f5%f6%f7%f8%f9%f10';

test('defs load with shop and normal types', () => {
  assert.strictEqual(defs.size, 3);
  assert.strictEqual(defs.specialTypeOf(3993), 5);
  assert.strictEqual(defs.specialTypeOf(1), 0);
  assert.strictEqual(defs.specialTypeOf(888888), undefined);
});

test('parseDsi captures clothing color but not den color', () => {
  const packet = '%xt%dsi%1%1%2%open%1%500%2%111%222%2164260864%0%1000%0%333%444%41%b%c%d%e%';
  const r = parseDsi(packet);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.empty, false);
  assert.strictEqual(r.shopState, 'open');
  assert.deepStrictEqual(r.items, [
    { currencyType: 1, cost: 500, itemType: 2, invIdx: 111, defId: 222, color: 2164260864, petAppearance: null, trailing: ['2164260864'] },
    { currencyType: 0, cost: 1000, itemType: 0, invIdx: 333, defId: 444, color: null, petAppearance: null, trailing: ['41', 'b', 'c', 'd', 'e'] }
  ]);
});

test('parseDsi pet record has null color and captures a piped appearance token', () => {
  const packet = '%xt%dsi%1%1%1%open%1%2000%1%77%88%p1%p2%p3%p4%15388|27248%p6%p7%p8%p9%';
  const r = parseDsi(packet);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items, [
    { currencyType: 1, cost: 2000, itemType: 1, invIdx: 77, defId: 88, color: null, petAppearance: '15388|27248', trailing: ['p1', 'p2', 'p3', 'p4', '15388|27248', 'p6', 'p7', 'p8', 'p9'] }
  ]);
});

test('parseDsi empty shop', () => {
  const r = parseDsi('%xt%dsi%1%1%-1%');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.empty, true);
  assert.strictEqual(r.items.length, 0);
});

test('parseDsi rejects non-dsi packet', () => {
  const r = parseDsi('%xt%rp%100%');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_dsi');
});

test('parseDenState finds shop among items', () => {
  const packet = `%xt%ds%F%2%0%1%10%100%${F10}%20%3993%${F10}%`;
  const r = parseDenState(packet, specialTypeOf);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.numDenItems, 2);
  assert.strictEqual(r.truncated, false);
  assert.deepStrictEqual(r.shopInvIdxs, [20]);
  assert.strictEqual(r.denItems.length, 2);
});

test('parseDenState tolerates unknown defs and still finds later shop', () => {
  const packet = `%xt%ds%F%2%0%1%10%888888%${F10}%20%3993%${F10}%`;
  const r = parseDenState(packet, specialTypeOf);
  assert.strictEqual(r.truncated, false);
  assert.deepStrictEqual(r.shopInvIdxs, [20]);
  assert.strictEqual(r.denItems.length, 2);
});

test('parseDenState truncates on desync (non-numeric record boundary)', () => {
  const packet = `%xt%ds%F%2%0%1%10%888888%${F10}%notnum%bad%a%b%c%d%e%f%g%h%i%j%`;
  const r = parseDenState(packet, specialTypeOf);
  assert.strictEqual(r.truncated, true);
});
