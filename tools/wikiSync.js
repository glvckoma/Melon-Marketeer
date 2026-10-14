const fs = require('fs');
const path = require('path');
const Database = require('../db/Database.js');
const { fetchPageImages, fetchPageColorWorth, cleanImageUrl, fileNameOf, looksLikeDate, HOSTS, fetchWithBackoff, sleep } = require('../items/WikiData.js');
const { normalizeName } = require('../items/wikiName.js');
const { WIKI_DIR: IMG_DIR } = require('../api/imageSource.js');

const PACE_MS = Number(process.env.WIKI_PACE_MS || 250);

const PRICES_JSON = process.env.PRICES_JSON || path.resolve(__dirname, '..', 'data', 'prices.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const WIKI_API = 'https://aj-item-worth.fandom.com/api.php';

function wikiUrl(title, source) {
  return `https://${HOSTS[source] || HOSTS['aj-item-worth']}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

async function crawlAllPages(db, { maxPages = Infinity } = {}) {
  const existing = new Set(db.allWikiTitles('aj-item-worth'));
  let apcontinue = null;
  let seen = 0;
  let added = 0;
  do {
    const qs = new URLSearchParams({ action: 'query', list: 'allpages', apnamespace: '0', aplimit: '500', format: 'json' });
    if (apcontinue) qs.set('apcontinue', apcontinue);
    const res = await fetch(`${WIKI_API}?${qs}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`allpages ${res.status}`);
    const data = await res.json();
    for (const p of (data.query && data.query.allpages) || []) {
      seen += 1;
      if (existing.has(p.title)) continue;
      db.upsertWikiWorth(p.title, wikiUrl(p.title, 'aj-item-worth'), null, 'aj-item-worth');
      existing.add(p.title);
      added += 1;
    }
    apcontinue = data.continue && data.continue.apcontinue;
    if (seen >= maxPages) break;
    if (added % 1000 === 0 && added) console.log(`  crawled ${seen} pages, ${added} new`);
  } while (apcontinue);
  return { seen, added };
}

function importWorth(db) {
  const data = JSON.parse(fs.readFileSync(PRICES_JSON, 'utf-8'));
  let n = 0;
  for (const [name, item] of Object.entries(data.items || {})) {
    const variant = item.variants && (item.variants[name] || Object.values(item.variants)[0]);
    let worth = variant ? (variant.value || variant.fullText || null) : null;
    if (looksLikeDate(worth)) worth = null;
    db.upsertWikiWorth(name, item.pageUrl, worth, 'aj-item-worth');
    n += 1;
  }
  return n;
}

function pageTitleFromUrl(url) {
  const seg = String(url).split('/wiki/')[1] || '';
  return decodeURIComponent(seg).replace(/_/g, ' ');
}

async function download(url, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const file = fileNameOf(url);
  const dest = path.join(destDir, file);
  if (fs.existsSync(dest)) return `wiki/${file}`;
  const res = await fetchWithBackoff(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`img ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return `wiki/${file}`;
}

async function saveImages(images) {
  const saved = [];
  const failed = [];
  for (const img of images) {
    try {
      saved.push({ color: img.color, label: img.label, kind: img.kind, url: cleanImageUrl(img.url), path: await download(img.url, IMG_DIR) });
    } catch (e) {
      failed.push({ url: cleanImageUrl(img.url), error: e.message });
    }
  }
  return { saved, failed };
}

async function syncImages(db, { limit = 25, onlyMatched = true } = {}) {
  let relevant = null;
  if (onlyMatched) {
    relevant = new Set(db.db.prepare('SELECT DISTINCT wiki_title FROM item_wiki').all().map((r) => r.wiki_title));
    const defNorms = new Set(db.db.prepare('SELECT DISTINCT name FROM item_definitions WHERE name IS NOT NULL').all().map((r) => normalizeName(r.name)));
    for (const t of db.allWikiTitles('aj-item-worth')) if (defNorms.has(normalizeName(t))) relevant.add(t);
  }
  let titles = db.wikiTitlesNeedingImages(20000, 'aj-item-worth');
  if (relevant) titles = titles.filter((t) => relevant.has(t));
  titles = titles.slice(0, limit);
  let done = 0;
  let withImg = 0;
  let failedTotal = 0;
  for (const title of titles) {
    const row = db.db.prepare("SELECT url FROM wiki_items WHERE source = 'aj-item-worth' AND title = ?").get(title);
    try {
      const { images } = await fetchPageImages(pageTitleFromUrl(row.url), { source: 'aj-item-worth' });
      const { saved, failed } = await saveImages(images);
      if (failed.length) { failedTotal += failed.length; console.log(`  ! ${title}: ${failed.length} image(s) failed (${failed[0].error})`); }
      db.setWikiImages(title, saved, 'aj-item-worth');
      if (saved.length) withImg += 1;
    } catch (e) {
      db.setWikiImages(title, [], 'aj-item-worth');
    }
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${titles.length} pages, ${withImg} with images`);
    if (PACE_MS) await sleep(PACE_MS);
  }
  return { processed: done, withImages: withImg, failedDownloads: failedTotal };
}

async function syncImagesForTitles(db, titles, { source = 'aj-item-worth' } = {}) {
  const out = [];
  for (const title of titles) {
    const row = db.db.prepare('SELECT url FROM wiki_items WHERE source = ? AND title = ?').get(source, title);
    if (!row) { out.push({ title, error: 'unknown title' }); continue; }
    try {
      const { images } = await fetchPageImages(pageTitleFromUrl(row.url), { source });
      const { saved, failed } = await saveImages(images);
      db.setWikiImages(title, saved, source);
      out.push({ title, images: saved.length, failed: failed.length });
    } catch (e) {
      out.push({ title, error: e.message });
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  return out;
}

function stuckTitlesByObservation(db, { source = 'aj-item-worth', dedicatedOnly = true } = {}) {
  const hasImg = new Map();
  const urlByTitle = new Map();
  for (const r of db.db.prepare('SELECT title, url, images_json FROM wiki_items WHERE source = ?').all(source)) {
    hasImg.set(r.title, !!(r.images_json && r.images_json !== '[]'));
    urlByTitle.set(r.title, r.url);
  }
  const isDedicated = (title, url) => normalizeName(pageTitleFromUrl(url || '')) === normalizeName(title);
  const wikiByNorm = new Map();
  for (const r of db.db.prepare('SELECT title, norm FROM wiki_items WHERE source = ?').all(source)) if (!wikiByNorm.has(r.norm)) wikiByNorm.set(r.norm, r.title);
  const itemWiki = new Map();
  for (const r of db.db.prepare('SELECT item_type, def_id, wiki_title FROM item_wiki').all()) itemWiki.set(`${r.item_type}:${r.def_id}`, r.wiki_title);
  const nameOf = new Map();
  for (const r of db.db.prepare('SELECT item_type, def_id, name FROM item_definitions WHERE name IS NOT NULL').all()) nameOf.set(`${r.item_type}:${r.def_id}`, r.name);
  const byTitle = new Map();
  for (const o of db.db.prepare('SELECT item_type, def_id, SUM(observations) AS obs FROM item_stats GROUP BY item_type, def_id').all()) {
    const key = `${o.item_type}:${o.def_id}`;
    const nm = nameOf.get(key);
    const title = (nm && wikiByNorm.get(normalizeName(nm))) || itemWiki.get(key);
    if (!title || hasImg.get(title)) continue;
    if (dedicatedOnly && !isDedicated(title, urlByTitle.get(title))) continue;
    byTitle.set(title, (byTitle.get(title) || 0) + (o.obs || 0));
  }
  return [...byTitle.entries()].sort((a, b) => b[1] - a[1]).map(([title, obs]) => ({ title, obs, url: urlByTitle.get(title) }));
}

async function syncStuckImages(db, { limit = 150, source = 'aj-item-worth' } = {}) {
  const candidates = stuckTitlesByObservation(db, { source }).slice(0, limit);
  let recovered = 0;
  let stillEmpty = 0;
  let failedTotal = 0;
  for (const c of candidates) {
    try {
      const { images } = await fetchPageImages(pageTitleFromUrl(c.url), { source });
      const { saved, failed } = await saveImages(images);
      db.setWikiImages(c.title, saved, source);
      if (saved.length) { recovered += 1; } else { stillEmpty += 1; }
      failedTotal += failed.length;
    } catch (e) {
      stillEmpty += 1;
    }
    if (PACE_MS) await sleep(PACE_MS);
  }
  return { processed: candidates.length, recovered, stillEmpty, failedDownloads: failedTotal };
}

async function syncAnimaljam(db, { limit = 25 } = {}) {
  const observed = db.db.prepare(
    `SELECT o.item_type AS itemType, o.def_id AS defId, d.name AS name, COUNT(*) AS obs
     FROM price_observations o
     JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
     WHERE d.name IS NOT NULL
     GROUP BY o.item_type, o.def_id ORDER BY obs DESC`
  ).all();
  const haveNorms = new Set(db.db.prepare("SELECT norm FROM wiki_items WHERE source = 'animaljam'").all().map((r) => r.norm));
  const candidates = observed.filter((it) => {
    if (haveNorms.has(normalizeName(it.name))) return false;
    const w = db.wikiForItem(it.itemType, it.defId, it.name);
    return !w || !w.images.length;
  }).slice(0, limit);
  let done = 0;
  let withImg = 0;
  let failedTotal = 0;
  for (const it of candidates) {
    try {
      const { images, resolved, error } = await fetchPageImages(it.name, { source: 'animaljam' });
      if (error || !images.length) {
        db.upsertWikiWorth(it.name, wikiUrl(resolved || it.name, 'animaljam'), null, 'animaljam');
        db.setWikiImages(it.name, [], 'animaljam');
      } else {
        const { saved, failed } = await saveImages(images);
        if (failed.length) { failedTotal += failed.length; console.log(`  ! ${it.name}: ${failed.length} image(s) failed`); }
        db.upsertWikiWorth(it.name, wikiUrl(resolved || it.name, 'animaljam'), null, 'animaljam');
        db.setWikiImages(it.name, saved, 'animaljam');
        if (saved.length) withImg += 1;
      }
    } catch (e) {
      db.upsertWikiWorth(it.name, wikiUrl(it.name, 'animaljam'), null, 'animaljam');
      db.setWikiImages(it.name, [], 'animaljam');
    }
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${candidates.length} animaljam pages, ${withImg} with images`);
    if (PACE_MS) await sleep(PACE_MS);
  }
  return { processed: done, withImages: withImg, failedDownloads: failedTotal };
}

async function recolorImages(db, { limit = 50 } = {}) {
  const { colorInfo } = require('../api/readModel.js');
  const colorsByItem = new Map();
  for (const r of db.distinctItemColors()) {
    const info = colorInfo(r.color, r.item_type);
    if (!info || !info.name) continue;
    const k = `${r.item_type}:${r.def_id}`;
    if (!colorsByItem.has(k)) colorsByItem.set(k, new Set());
    colorsByItem.get(k).add(info.name);
  }
  const observed = db.db.prepare('SELECT DISTINCT o.item_type t, o.def_id d FROM price_observations o').all();
  const titles = new Set();
  for (const it of observed) {
    const nm = db.itemName(it.t, it.d);
    if (!nm) continue;
    const w = db.wikiForItem(it.t, it.d, nm);
    if (!w || !w.images || !w.images.length) continue;
    const imgColors = new Set(w.images.map((i) => i.color).filter(Boolean));
    if (!imgColors.size) continue;
    const obs = colorsByItem.get(`${it.t}:${it.d}`);
    if (!obs) continue;
    let gap = false;
    for (const c of obs) if (!imgColors.has(c)) { gap = true; break; }
    if (!gap) continue;
    const exact = db.wikiByName(nm, 'aj-item-worth');
    const title = exact ? exact.title : db.wikiTitleForItem(it.t, it.d);
    if (title) titles.add(title);
  }
  const list = [...titles].slice(0, limit);
  let done = 0;
  let gained = 0;
  for (const title of list) {
    const row = db.db.prepare("SELECT url, images_json FROM wiki_items WHERE source = 'aj-item-worth' AND title = ?").get(title);
    if (!row || !row.url) { done += 1; continue; }
    const old = row.images_json ? JSON.parse(row.images_json) : [];
    const beforeColors = new Set(old.map((i) => i.color).filter(Boolean)).size;
    try {
      const { images } = await fetchPageImages(pageTitleFromUrl(row.url), { source: 'aj-item-worth' });
      const { saved } = await saveImages(images);
      const newByKey = new Map(saved.map((i) => [i.path || i.url, i]));
      const merged = [...saved, ...old.filter((i) => !newByKey.has(i.path || i.url))];
      db.setWikiImages(title, merged, 'aj-item-worth');
      if (new Set(merged.map((i) => i.color).filter(Boolean)).size > beforeColors) gained += 1;
    } catch (e) { /* keep existing on fetch error */ }
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${list.length} pages, ${gained} gained colors`);
    if (PACE_MS) await sleep(PACE_MS);
  }
  return { processed: done, targetItems: titles.size, pagesGainedColors: gained };
}

async function syncColorWorth(db, { limit = 50 } = {}) {
  const observed = db.db.prepare(
    `SELECT DISTINCT item_type t, def_id d FROM price_observations
     UNION
     SELECT DISTINCT item_type t, def_id d FROM tradelist_items`
  ).all();
  const titles = new Set();
  for (const it of observed) {
    const nm = db.itemName(it.t, it.d);
    if (!nm) continue;
    const exact = db.wikiByName(nm, 'aj-item-worth');
    const title = exact ? exact.title : db.wikiTitleForItem(it.t, it.d);
    if (title) titles.add(title);
  }
  const list = [...titles].slice(0, limit);
  let done = 0;
  let withWorth = 0;
  let pairs = 0;
  for (const title of list) {
    const row = db.db.prepare("SELECT url FROM wiki_items WHERE source = 'aj-item-worth' AND title = ?").get(title);
    if (!row || !row.url) { done += 1; continue; }
    try {
      const { colorWorth } = await fetchPageColorWorth(pageTitleFromUrl(row.url), { source: 'aj-item-worth' });
      db.setWikiColorWorth(title, colorWorth, 'aj-item-worth');
      if (colorWorth.length) { withWorth += 1; pairs += colorWorth.length; }
    } catch (e) { /* keep existing on fetch error */ }
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${list.length} pages, ${withWorth} with per-color worth`);
    if (PACE_MS) await sleep(PACE_MS);
  }
  return { processed: done, targetItems: titles.size, withColorWorth: withWorth, colorPairs: pairs };
}

if (require.main === module) {
  (async () => {
    const db = new Database(process.env.SQLITE_PATH || undefined);
    const mode = process.argv[2] || 'all';
    if (mode === 'crawl') {
      console.log('Crawling all wiki pages...');
      console.log('  ', JSON.stringify(await crawlAllPages(db, { maxPages: Number(process.argv[3]) || Infinity })));
    }
    if (mode === 'worth' || (mode === 'all' && fs.existsSync(PRICES_JSON))) {
      console.log(`Importing worth from ${PRICES_JSON}...`);
      console.log('  imported', importWorth(db), 'wiki items');
    }
    if (mode === 'images' || mode === 'all') {
      const limit = Number(process.argv[3]) || 25;
      console.log(`Fetching aj-item-worth images for up to ${limit} matched items...`);
      console.log('  ', JSON.stringify(await syncImages(db, { limit })));
    }
    if (mode === 'imagefor') {
      const titles = process.argv.slice(3);
      console.log(`Force-syncing images for ${titles.length} title(s): ${titles.join(', ')}`);
      console.log('  ', JSON.stringify(await syncImagesForTitles(db, titles)));
    }
    if (mode === 'images-stuck') {
      const limit = Number(process.argv[3]) || 150;
      console.log(`Re-fetching up to ${limit} stuck (empty-image, observed) titles, highest-traffic first...`);
      console.log('  ', JSON.stringify(await syncStuckImages(db, { limit })));
    }
    if (mode === 'animaljam') {
      const limit = Number(process.argv[3]) || 25;
      console.log(`Fetching animaljam images for up to ${limit} observed items...`);
      console.log('  ', JSON.stringify(await syncAnimaljam(db, { limit })));
    }
    if (mode === 'recolor') {
      const limit = Number(process.argv[3]) || 50;
      console.log(`Re-fetching aj-item-worth pages for up to ${limit} items with a color gap...`);
      console.log('  ', JSON.stringify(await recolorImages(db, { limit })));
    }
    if (mode === 'colorworth') {
      const limit = Number(process.argv[3]) || 50;
      console.log(`Fetching per-color worth for up to ${limit} observed items...`);
      console.log('  ', JSON.stringify(await syncColorWorth(db, { limit })));
    }
    console.log('wikiStats:', JSON.stringify(db.wikiStats()));
    db.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { importWorth, download, syncImages, syncImagesForTitles, syncStuckImages, stuckTitlesByObservation, syncAnimaljam, recolorImages, syncColorWorth, pageTitleFromUrl, crawlAllPages };
