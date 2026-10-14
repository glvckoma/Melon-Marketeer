const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const { normalizeName } = require('../items/wikiName.js');
const { colorFromFilename, cleanImageUrl, looksLikeDate } = require('../items/WikiData.js');
const { extractImages } = require('../items/wikiExtract.js');

const IMG = 'https://static.wikia.nocookie.net/aj-item-worth/images';
const AJAM = 'https://static.wikia.nocookie.net/animaljam/images';

test('looksLikeDate flags release dates but not worth values', () => {
  assert.ok(looksLikeDate('June 20, 2016'));
  assert.ok(looksLikeDate('March 18, 2013'));
  assert.ok(looksLikeDate('2013'));
  assert.ok(looksLikeDate('3/18/2013'));
  assert.ok(!looksLikeDate('5 Den Betas'));
  assert.ok(!looksLikeDate('Bad Long Wrist'));
  assert.ok(!looksLikeDate('2-3 Den Betas'));
  assert.ok(!looksLikeDate('A Few RIMs'));
});

test('normalizeName collapses case and punctuation', () => {
  assert.strictEqual(normalizeName('Rare Spiked Collar'), 'rare spiked collar');
  assert.strictEqual(normalizeName("Mira's Feathered Collar"), 'mira s feathered collar');
  assert.strictEqual(normalizeName('Rare_Blue_Long  Collar'), 'rare blue long collar');
});

test('colorFromFilename extracts the color word', () => {
  assert.strictEqual(colorFromFilename('Rare_Blue_Long_Spiked_Collar.png'), 'Blue');
  assert.strictEqual(colorFromFilename('Rare_Purple_Long_Spiked_Collar.png'), 'Purple');
  assert.strictEqual(colorFromFilename('Rainbow_Spike.png'), 'Rainbow');
  assert.strictEqual(colorFromFilename('PrizeChest.png'), null);
});

test('cleanImageUrl strips revision/query suffixes', () => {
  assert.strictEqual(
    cleanImageUrl('https://static.wikia.nocookie.net/aj-item-worth/images/7/7f/Rare_Blue_Long_Spiked_Collar.png/revision/latest?cb=123'),
    'https://static.wikia.nocookie.net/aj-item-worth/images/7/7f/Rare_Blue_Long_Spiked_Collar.png'
  );
});

test('extractImages reads color from a worth-table column header (numbered files)', () => {
  const html = `<table>
    <tr><th>Black</th><th>Dark Blue</th><th>Rainbow</th></tr>
    <tr>
      <td><img data-src="${IMG}/a/TopHat41.png/revision/latest?cb=1"></td>
      <td><img src="${IMG}/b/TopHat11.png/revision/latest"></td>
      <td><img src="${IMG}/c/Rainbow_Top_Hat.png"></td>
    </tr></table>`;
  const imgs = extractImages(html);
  assert.strictEqual(imgs.length, 3);
  assert.strictEqual(imgs.find((i) => i.file === 'TopHat41.png').color, 'Black');
  assert.strictEqual(imgs.find((i) => i.file === 'TopHat11.png').color, 'Blue');
  assert.strictEqual(imgs.find((i) => i.file === 'Rainbow_Top_Hat.png').color, 'Rainbow');
  assert.ok(imgs.every((i) => i.kind === 'table'));
});

test('extractImages falls back to filename color and handles webp', () => {
  const html = `<table>
    <tr><th>Magenta</th></tr>
    <tr><td><img src="${IMG}/x/Worn_Collar.webp"></td></tr>
    </table>
    <table><tr><th>Acts</th></tr><tr><td><img src="${IMG}/y/Sit.png"></td></tr></table>`;
  const imgs = extractImages(html);
  assert.strictEqual(imgs.length, 1, 'the Acts (non-variant) table image is excluded');
  assert.strictEqual(imgs[0].color, 'Pink', 'Magenta header maps to the Pink bucket');
  assert.ok(imgs[0].file.endsWith('.webp'));
});

test('extractImages prefers infobox, reads den gallery filename colors, drops noise', () => {
  const html = `
    <aside class="portable-infobox"><figure class="pi-image"><img src="${AJAM}/i/Bean_bag_chair_aj.png"></figure></aside>
    <div class="wikia-gallery">
      <div class="wikia-gallery-item"><img data-src="${AJAM}/p/Shop_Bean-Bag-Chair_Purple.png/revision/latest"></div>
      <div class="wikia-gallery-item"><img data-src="${AJAM}/g/Jamaa-Journal_Vol-072.png"></div>
    </div>`;
  const imgs = extractImages(html);
  assert.strictEqual(imgs[0].kind, 'infobox');
  assert.ok(imgs.some((i) => i.color === 'Purple' && i.kind === 'gallery'));
  assert.ok(!imgs.some((i) => i.file.includes('Jamaa-Journal')), 'journal image filtered as noise');
});

test('buildMatches keeps non-rare spiked collars off the Rare wiki pages', () => {
  const { buildMatches } = require('../tools/rebuildWikiMatches.js');
  const db = new Database(':memory:');
  for (const t of ['Rare Long Spiked Collar', 'Rare Short Spiked Collar', 'Diamond Long Spiked Collars', 'Diamond Short Spiked Collars']) {
    db.upsertWikiWorth(t, 'https://aj-item-worth.fandom.com/wiki/' + t.replace(/ /g, '_'), '');
  }
  const ins = db.db.prepare('INSERT OR REPLACE INTO item_definitions (item_type, def_id, name, abbr) VALUES (?, ?, ?, ?)');
  ins.run(2, 634, 'Spiked Collar (Long)', null);
  ins.run(2, 1212, 'Spiked Collar (Short)', null);
  ins.run(2, 285, 'Rare Spiked Collar (Long)', null);
  ins.run(2, 276, 'Rare Spiked Collar (Short)', null);
  buildMatches(db);
  assert.strictEqual(db.wikiTitleForItem(2, 634), 'Diamond Long Spiked Collars');
  assert.strictEqual(db.wikiTitleForItem(2, 1212), 'Diamond Short Spiked Collars');
  assert.strictEqual(db.wikiTitleForItem(2, 285), 'Rare Long Spiked Collar');
  assert.notStrictEqual(db.wikiTitleForItem(2, 634), db.wikiTitleForItem(2, 285));
});

test('db wiki worth + images round-trip and match by normalized name', () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Rare Spiked Collar', 'https://aj-item-worth.fandom.com/wiki/Rare_Spiked_Collar', '5 Den Betas');
  db.setWikiImages('Rare Spiked Collar', [{ color: 'Blue', url: 'u', path: 'wiki/Rare_Blue.png' }]);
  const m = db.wikiByName('rare  spiked   collar');
  assert.ok(m);
  assert.strictEqual(m.worthText, '5 Den Betas');
  assert.strictEqual(m.images[0].color, 'Blue');
  assert.strictEqual(db.wikiByName('Nonexistent Item'), null);
  assert.strictEqual(db.wikiStats().withImages, 1);
});
