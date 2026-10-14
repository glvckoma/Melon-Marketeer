const test = require('node:test');
const assert = require('node:assert');
const { badgeClass, kpiMarkup, toCsv } = require('../admin/public/components.js');

test('badgeClass maps variant to css class', () => {
  assert.strictEqual(badgeClass('ok'), 'sb-ok');
  assert.strictEqual(badgeClass('warn'), 'sb-warn');
  assert.strictEqual(badgeClass('danger'), 'sb-danger');
  assert.strictEqual(badgeClass('info'), 'sb-info');
  assert.strictEqual(badgeClass('zzz'), 'sb-info');
  assert.strictEqual(badgeClass(), 'sb-info');
});

test('kpiMarkup includes value, label and direction class', () => {
  const html = kpiMarkup({ value: '1.42M', k: 'Observations', delta: '+12k', dir: 'up' });
  assert.ok(html.includes('1.42M'), 'value present');
  assert.ok(html.includes('Observations'), 'label present');
  assert.ok(html.includes('+12k'), 'delta present');
  assert.ok(html.includes('kpi-up'), 'direction class present');
});

test('kpiMarkup omits the delta node when no delta is given', () => {
  const html = kpiMarkup({ value: '5', k: 'Sellers' });
  assert.ok(html.includes('5') && html.includes('Sellers'));
  assert.ok(!html.includes('kpi-delta'), 'no delta node without a delta');
});

test('kpiMarkup escapes html in value and label', () => {
  const html = kpiMarkup({ value: '<b>x</b>', k: 'a&b' });
  assert.ok(!html.includes('<b>x</b>'), 'value is escaped');
  assert.ok(html.includes('a&amp;b'), 'label is escaped');
});

test('toCsv builds the header row from column labels', () => {
  const cols = [{ key: 'name', label: 'Name' }, { key: 'n', label: 'Count' }];
  const csv = toCsv(cols, [{ name: 'a', n: 3 }]);
  assert.strictEqual(csv.split('\n')[0], 'Name,Count');
});

test('toCsv quotes fields containing comma, quote or newline', () => {
  const cols = [{ key: 'name', label: 'Name' }, { key: 'note', label: 'Note' }];
  const csv = toCsv(cols, [{ name: 'a,b', note: 'he said "hi"\nbye' }]);
  assert.ok(csv.includes('"a,b"'), 'comma field quoted');
  assert.ok(csv.includes('"he said ""hi""\nbye"'), 'quotes doubled and newline quoted');
});

test('toCsv renders null and undefined as empty', () => {
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const csv = toCsv(cols, [{ a: null, b: undefined }]);
  assert.strictEqual(csv.split('\n')[1], ',');
});
