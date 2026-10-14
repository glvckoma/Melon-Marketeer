const test = require('node:test');
const assert = require('node:assert');
const { parseTradeValue, formatTradeValue, UNIT } = require('../items/tradeValue.js');
const Database = require('../db/Database.js');

const val = (t) => parseTradeValue(t).value;

test('ranks denominations in the right order', () => {
  const chain = [
    '2.5 black long collars',
    '1 black long collar',
    'good long wrist',
    'bad long wrist',
    '1 den beta',
    'a few rims'
  ].map(val);
  for (let i = 1; i < chain.length; i++) {
    assert.ok(chain[i - 1] > chain[i], `${chain[i - 1]} should exceed ${chain[i]} (index ${i})`);
  }
});

test('headdress outranks a black long collar', () => {
  assert.ok(val('spike headdress') > val('1 black long collar'));
});

test('non-values resolve to null', () => {
  for (const s of ['', null, undefined, 'hard to value', 'under investigation', 'returns annually.', 'january', 'appondale', 'item', '8000 sataru g.', '1', '1-2', '2']) {
    assert.strictEqual(parseTradeValue(s).value, null, `${JSON.stringify(s)} should be null`);
  }
});

test('in-stores is flagged as instore, not parsed', () => {
  for (const s of ['currently in stores', 'not much; in stores', 'In Stores']) {
    const r = parseTradeValue(s);
    assert.strictEqual(r.value, null);
    assert.strictEqual(r.basis, 'instore');
  }
});

test('a value clause beats an in-stores clause in the same string', () => {
  const r = parseTradeValue('consistently in and out of stores; a few rims');
  assert.ok(r.value > 0);
  assert.strictEqual(r.basis, 'parsed');
});

test('ranges use the midpoint and preserve the original range in display', () => {
  const r = parseTradeValue('13-14 black long collars');
  assert.strictEqual(r.value, 13.5);
  assert.match(r.display, /13-14/);
  assert.strictEqual(parseTradeValue('1-2 den betas').value, parseTradeValue('1.5 den betas').value);
});

test('"black" is a top grade, never zero', () => {
  assert.ok(val('black long collar') > 0);
  assert.ok(val('black short collar') > val('bad short collar'));
  assert.ok(val('black long collar') > val('good long collar'));
});

test('"a few" is a fixed multiple, deterministic', () => {
  assert.strictEqual(val('a few rims'), parseTradeValue('a few rims').value);
  assert.ok(val('a few clothing betas') > val('1 clothing beta'));
});

test('compound worth strings stay finite', () => {
  for (const s of ['good - black short collar', 'black short collar - bad long collar', 'good long collar - 1 black long collar', 'a few clothing betas - 1 den beta', 'decent long wrist or 4-5 den betas']) {
    const v = val(s);
    assert.ok(Number.isFinite(v) && v > 0, `${s} -> ${v}`);
  }
});

test('hedges do not change the parsed value', () => {
  assert.strictEqual(val('good short collar, maybe less'), val('good short collar'));
  assert.strictEqual(val('1 den beta, maybe more'), val('1 den beta'));
});

test('result shape carries unit and basis', () => {
  const r = parseTradeValue('2 den betas');
  assert.strictEqual(r.unit, UNIT);
  assert.strictEqual(r.basis, 'parsed');
  assert.strictEqual(typeof r.display, 'string');
  assert.strictEqual(formatTradeValue(null), null);
});

test('upsertWikiWorth populates trade value from worth_text', () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Spike', 'u', '1 black long collar');
  const w = db.wikiByTitle('Spike');
  assert.ok(w.tradeValue > 0);
  assert.strictEqual(w.tradeBasis, 'parsed');
  assert.strictEqual(typeof w.tradeDisplay, 'string');
});

test('admin override wins and survives a worth re-scrape', () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Spike', 'u', '1 den beta');
  const parsed = db.wikiByTitle('Spike').tradeValue;
  assert.ok(parsed > 0 && parsed < 5);

  db.setWikiTradeOverride('Spike', 5, '≈ 5 Black Longs');
  assert.strictEqual(db.wikiByTitle('Spike').tradeValue, 5);

  db.upsertWikiWorth('Spike', 'u', '2 den betas');
  const after = db.wikiByTitle('Spike');
  assert.strictEqual(after.tradeValue, 5, 'override still wins after recompute');
  assert.strictEqual(after.tradeDisplay, '≈ 5 Black Longs');
  assert.strictEqual(after.worthText, '2 den betas');

  db.setWikiTradeOverride('Spike', null, null);
  const cleared = db.wikiByTitle('Spike');
  assert.notStrictEqual(cleared.tradeValue, 5);
  assert.ok(cleared.tradeValue > 0, 'falls back to the recomputed parsed value');
});
