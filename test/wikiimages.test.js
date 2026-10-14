const test = require('node:test');
const assert = require('node:assert');
const Database = require('../db/Database.js');
const { canonicalColor, colorBucketFromLabel } = require('../items/colorName.js');
const { bestMatch, coreTokens } = require('../items/wikiMatch.js');
const { buildImageIndex } = require('../api/readModel.js');
const { fetchWithBackoff } = require('../items/WikiData.js');

test('fetchWithBackoff retries on 429/503 then returns the success response', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 429, headers: { get: () => null } };
    return { ok: true, status: 200 };
  };
  const res = await fetchWithBackoff('http://x', {}, fetchImpl, [1, 1, 1]);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(calls, 3);
});

test('fetchWithBackoff does not retry non-rate-limit errors', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: false, status: 404, headers: { get: () => null } }; };
  const res = await fetchWithBackoff('http://x', {}, fetchImpl, [1, 1]);
  assert.strictEqual(res.status, 404);
  assert.strictEqual(calls, 1);
});

test('colorBucketFromLabel maps wiki labels to canonical buckets', () => {
  assert.strictEqual(colorBucketFromLabel('Dark Pink'), 'Pink');
  assert.strictEqual(colorBucketFromLabel('Black & White/Default'), 'Black');
  assert.strictEqual(colorBucketFromLabel('Magenta Green'), 'Pink');
  assert.strictEqual(colorBucketFromLabel('Tan'), 'Brown');
  assert.strictEqual(colorBucketFromLabel('Rainbow'), 'Rainbow');
  assert.strictEqual(colorBucketFromLabel("Founders'"), null);
  assert.strictEqual(colorBucketFromLabel('Rare Item Monday'), null);
});

test('canonicalColor folds synonyms and case', () => {
  assert.strictEqual(canonicalColor('Pink'), 'pink');
  assert.strictEqual(canonicalColor('Magenta'), 'pink');
  assert.strictEqual(canonicalColor('Grey'), 'gray');
  assert.strictEqual(canonicalColor(null), null);
});

test('bestMatch assigns confidence and rejects loose single-token matches', () => {
  const wiki = ['Spiked Wristband', 'Feathered Mask Deluxe', 'Top Hat']
    .map((title) => ({ title, core: new Set(coreTokens(title)) }));
  const exact = bestMatch('Rare Spiked Wristband', wiki);
  assert.strictEqual(exact.title, 'Spiked Wristband');
  assert.strictEqual(exact.confidence, 'high');
  const medium = bestMatch('Feathered Mask', wiki);
  assert.strictEqual(medium.title, 'Feathered Mask Deluxe');
  assert.strictEqual(medium.confidence, 'medium');
  assert.strictEqual(bestMatch('Hat', wiki), null, 'single token with extra tokens is rejected');
});

test('bestMatch prefers the length-matching wiki page for long/short variants', () => {
  const wiki = ['Rare Spiked Collar', 'Rare Long Spiked Collar']
    .map((title) => ({ title, core: new Set(coreTokens(title)) }));
  assert.strictEqual(bestMatch('Rare Spiked Collar (Long)', wiki).title, 'Rare Long Spiked Collar');
  assert.strictEqual(bestMatch('Rare Spiked Collar (Short)', wiki).title, 'Rare Spiked Collar');
});

test('buildImageIndex maps colors to images and picks a default hero', () => {
  const wiki = {
    images: [
      { path: 'wiki/Icon.png', color: null, kind: 'infobox' },
      { path: 'wiki/Blue.png', color: 'Blue', kind: 'table' },
      { path: 'wiki/Pink.png', color: 'Pink', kind: 'table' }
    ]
  };
  const idx = buildImageIndex(wiki);
  assert.strictEqual(idx.byColor.Blue, '/wiki/Blue.png');
  assert.strictEqual(idx.byColor.Pink, '/wiki/Pink.png');
  assert.strictEqual(idx.defaultImage, '/wiki/Icon.png', 'infobox is the default hero');
  assert.strictEqual(idx.gallery.length, 3);
});

test('buildImageIndex serves uncached images from their wiki URL', () => {
  const wiki = { images: [{ path: 'wiki/Not_Downloaded.png', url: 'https://static.wikia.nocookie.net/x/Not_Downloaded.png', color: 'Blue', kind: 'table' }] };
  assert.strictEqual(buildImageIndex(wiki).byColor.Blue, 'https://static.wikia.nocookie.net/x/Not_Downloaded.png');
});

test('buildImageIndex drops wiki images unrelated to the item name', () => {
  const wiki = {
    images: [
      { path: 'wiki/Wood_Floor.png', color: null, kind: 'gallery' },
      { path: 'wiki/Beach_House.png', color: null, kind: 'gallery' },
      { path: 'wiki/Cosmos_Den.png', color: null, kind: 'gallery' }
    ]
  };
  const idx = buildImageIndex(wiki, 'Wood Floor');
  assert.strictEqual(idx.gallery.length, 1, 'only the wood-floor image survives');
  assert.ok(idx.gallery[0].src.includes('Wood_Floor'));
  assert.strictEqual(buildImageIndex(wiki).gallery.length, 3, 'no item name keeps every image');
});

test('wikiForItem merges images across both wikis and keeps aj-item-worth worth', () => {
  const db = new Database(':memory:');
  db.upsertWikiWorth('Bean Bag Chair', 'https://aj-item-worth.fandom.com/wiki/Bean_Bag_Chair', '2 Den Betas', 'aj-item-worth');
  db.setWikiImages('Bean Bag Chair', [{ color: 'Red', path: 'wiki/ajiw_red.png', kind: 'table' }], 'aj-item-worth');
  db.upsertWikiWorth('Bean Bag Chair', 'https://animaljam.fandom.com/wiki/Bean_Bag_Chair', null, 'animaljam');
  db.setWikiImages('Bean Bag Chair', [{ color: 'Purple', path: 'wiki/ajam_purple.png', kind: 'gallery' }], 'animaljam');

  const w = db.wikiForItem(0, 500, 'Bean Bag Chair');
  assert.strictEqual(w.worthText, '2 Den Betas');
  const colors = w.images.map((i) => i.color).sort();
  assert.deepStrictEqual(colors, ['Purple', 'Red']);
});

test('migration: legacy title-keyed wiki_items survives the source rebuild', () => {
  const db = new Database(':memory:');
  db.db.exec('DROP TABLE wiki_items');
  db.db.exec('CREATE TABLE wiki_items (title TEXT PRIMARY KEY COLLATE NOCASE, norm TEXT, url TEXT, worth_text TEXT, images_json TEXT, scraped_at INTEGER)');
  db.db.prepare('INSERT INTO wiki_items (title, norm, url, worth_text) VALUES (?, ?, ?, ?)')
    .run('Old Item', 'old item', 'u', 'worth');
  db._migrate();
  const w = db.wikiByName('Old Item', 'aj-item-worth');
  assert.ok(w);
  assert.strictEqual(w.worthText, 'worth');
  assert.strictEqual(w.source, 'aj-item-worth');
});
