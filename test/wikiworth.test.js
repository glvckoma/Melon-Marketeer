const test = require('node:test');
const assert = require('node:assert');
const { extractColorWorth } = require('../items/wikiExtract.js');
const { parseTradeValue } = require('../items/tradeValue.js');
const { isPureColorLabel } = require('../items/colorName.js');
const Database = require('../db/Database.js');
const rm = require('../api/readModel.js');

const HEADDRESS_HTML = `
<table class="article-table">
  <tr><th>Rare Item Monday</th><th>Dark Pink</th><th>Light Pink</th><th>Black</th></tr>
  <tr><td>RIM Headdress</td><td>Dark Pink Headdress</td><td>Light Pink Headdress</td><td>Black Headdress</td></tr>
  <tr>
    <td><img src="https://static.wikia.nocookie.net/x/images/RIMHeaddress.png"></td>
    <td><img src="https://static.wikia.nocookie.net/x/images/DarkPinkHeaddress.png"></td>
    <td><img src="https://static.wikia.nocookie.net/x/images/LightPinkHeaddress.png"></td>
    <td><img src="https://static.wikia.nocookie.net/x/images/BlackHeaddress.png"></td>
  </tr>
  <tr><td>4.5-5 Black Long Collars</td><td>10 Black Long Collars</td><td>60 Black Long Collars, maybe more</td><td>20 Black Long Collars</td></tr>
  <tr><td>5 Variety</td><td>10 Variety</td><td>60 Variety</td><td>20 Variety</td></tr>
</table>`;

test('parseTradeValue reads per-color "X Black Long Collars" directly', () => {
  assert.strictEqual(parseTradeValue('4.5-5 Black Long Collars').value, 4.75, 'range mid in black-long units');
  assert.strictEqual(parseTradeValue('60 Black Long Collars, maybe more').value, 60, 'hedge stripped, 60 units');
  assert.strictEqual(parseTradeValue('20 Black Long Collars').value, 20);
  assert.strictEqual(parseTradeValue('5 Variety').value, null, 'variety is not a denomination');
});

test('extractColorWorth pulls per-color worth, keyed by label, color columns only', () => {
  const rows = extractColorWorth(HEADDRESS_HTML);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));

  assert.ok(by['Light Pink'], 'Light Pink column captured');
  assert.strictEqual(by['Light Pink'].worthText, '60 Black Long Collars, maybe more', 'black-long row wins over Variety');
  assert.strictEqual(by['Light Pink'].color, 'Pink', 'bucketed to Pink');
  assert.strictEqual(by['Dark Pink'].worthText, '10 Black Long Collars');
  assert.strictEqual(by['Black'].worthText, '20 Black Long Collars');
  assert.ok(!by['Rare Item Monday'], 'non-color columns (item-comparison tables) are skipped');

  for (const r of rows) {
    assert.ok(r.color, 'every captured worth is tied to a recognized color');
    assert.ok(!/Headdress/i.test(r.worthText), 'item-name cells are never treated as worth');
    assert.ok(parseTradeValue(r.worthText).value != null, 'every captured worth parses to a value');
  }
});

test('extractColorWorth ignores item-name comparison tables (no color columns)', () => {
  const PLUSHIES = `<table>
    <tr><th>Rare Dolphin Plushie</th><th>Koala Plushie</th></tr>
    <tr><td>8-10 Black Long Collars</td><td>2 Black Long Collars</td></tr>
  </table>`;
  assert.deepStrictEqual(extractColorWorth(PLUSHIES), [], 'sibling-item columns are not color variants');
});

test('isPureColorLabel keeps multi-word and /Default colors and rejects item names', () => {
  for (const ok of ['Black', 'Dark Pink', 'Slime Green', 'Bright Orange', 'Red/Default', 'Hot Pink', 'Rainbow', 'Magenta']) {
    assert.ok(isPureColorLabel(ok), `${ok} is a color label`);
  }
  for (const bad of ['Magenta Candy Cane Socks', 'Cyan Kite', 'Slime Green Yeti Face', 'Rare Item Monday', 'Koala Plushie']) {
    assert.ok(!isPureColorLabel(bad), `${bad} is an item name, not a color`);
  }
});

test('extractColorWorth rejects cross-item reference rows whose color column header is an item name', () => {
  const POLLUTED = `<table>
    <tr><th>Magenta Candy Cane Socks</th><th>Slime Green</th><th>Dark Pink</th><th>Cyan Kite</th></tr>
    <tr><td>80-85 Black Long Collars</td><td>5 Black Long Collars</td><td>10 Black Long Collars</td><td>3 Black Long Collars</td></tr>
  </table>`;
  const rows = extractColorWorth(POLLUTED);
  const labels = rows.map((r) => r.label).sort();
  assert.deepStrictEqual(labels, ['Dark Pink', 'Slime Green'], 'pure-color columns kept, item-name columns dropped');
  assert.ok(!rows.some((r) => /80-85/.test(r.worthText)), 'the foreign 80-85 worth is dropped');
});

test('mostValuable ranks by per-color max worth; itemDetail exposes colorWorth', async () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [
    { itemType: 2, defId: 1, name: 'Headdress', abbr: null },
    { itemType: 2, defId: 2, name: 'Rare Elf Helmet', abbr: null }
  ] });
  db.insertObservations([
    { ownerName: 'A', shopId: 1, invIdx: 1, defId: 1, itemType: 2, cost: 500, currencyType: 3, color: null, shopState: 'open', scrapedBy: 'b', scrapedAt: 1 },
    { ownerName: 'B', shopId: 1, invIdx: 2, defId: 2, itemType: 2, cost: 400, currencyType: 3, color: null, shopState: 'open', scrapedBy: 'b', scrapedAt: 2 }
  ]);
  db.upsertWikiWorth('Headdress', 'http://x/hd', null, 'aj-item-worth');
  db.setWikiColorWorth('Headdress', [
    { label: 'Dark Pink', color: 'Pink', worthText: '10 Black Long Collars' },
    { label: 'Light Pink', color: 'Pink', worthText: '60 Black Long Collars' }
  ], 'aj-item-worth');
  db.upsertWikiWorth('Rare Elf Helmet', 'http://x/elf', '1 Black Long Collar', 'aj-item-worth');
  db.rollupStats();

  const top = await rm.mostValuable(db, 12);
  assert.strictEqual(top[0].name, 'Headdress', 'per-color max (60) outranks the single-worth elf helmet (1)');
  assert.strictEqual(top[0].tradeValue, 60);
  assert.match(top[0].tradeDisplay, /Light Pink/);

  const detail = await rm.itemDetail(db, 2, 1);
  assert.strictEqual(detail.wiki.colorWorth.length, 2, 'per-color worth surfaced on item detail');
  assert.strictEqual(detail.wiki.colorWorth[0].tradeValue, 60, 'highest-worth color first');
  assert.strictEqual(detail.wiki.colorWorth[0].worthText, '60 Black Long Collars');
  const cw0 = detail.wiki.colorWorth[0];
  assert.strictEqual(cw0.colorHex, '#f06fb8', 'Pink bucket enriched with a swatch hex');
  assert.ok('image' in cw0, 'colorWorth rows carry an image field');
});

test('mostValuable includes items seen only in trade lists', async () => {
  const db = new Database(':memory:');
  db.importDefinitions({ all: () => [{ itemType: 2, defId: 7, name: 'Headdress', abbr: null }] });
  const insTl = db.db.prepare('INSERT INTO tradelist_items (owner_name, item_type, def_id, field2, color, scraped_at) VALUES (?, ?, ?, ?, ?, ?)');
  insTl.run('trader1', 2, 7, 0, null, 1);
  insTl.run('trader2', 2, 7, 0, null, 2);
  db.upsertWikiWorth('Headdress', 'http://x/hd', null, 'aj-item-worth');
  db.setWikiColorWorth('Headdress', [{ label: 'Light Pink', color: 'Pink', worthText: '60 Black Long Collars' }], 'aj-item-worth');
  db.rollupStats();

  const top = await rm.mostValuable(db, 12);
  const hd = top.find((t) => t.name === 'Headdress');
  assert.ok(hd, 'a trade-listed item with no shop observations still appears in Most Valuable');
  assert.strictEqual(hd.tradeValue, 60);
  assert.strictEqual(hd.observations, 0, 'never observed in a shop');
  assert.strictEqual(hd.holders, 2, 'surfaced via its two trade-list holders');
});
