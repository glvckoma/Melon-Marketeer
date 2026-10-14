const { resolveColor } = require('../items/Color.js');
const { nearestColorName, hexForColorName } = require('../items/colorName.js');
const { coreTokens, WIKI_IMAGE_OVERRIDES } = require('../items/wikiMatch.js');
const { normalizeName } = require('../items/wikiName.js');
const { createTtlCache } = require('./cache.js');
const { imageSrc } = require('./imageSource.js');

const imageIndexCache = createTtlCache(30000);

async function imageWikiFor(db, type, def, wiki) {
  const ov = WIKI_IMAGE_OVERRIDES.find((o) => o.itemType === type && o.defId === def);
  if (ov && db.wikiByTitle) {
    const w = await db.wikiByTitle(ov.title, 'aj-item-worth');
    if (w && (w.images || []).length) return w;
  }
  return wiki;
}

function imageIndexFor(db, type, def, name, wiki) {
  return imageIndexCache.get(`${type}:${def}`, async () => {
    return buildImageIndex(await imageWikiFor(db, type, def, wiki), name);
  });
}

function colorInfo(raw, itemType) {
  if (itemType === 0) return null;
  if (raw == null || Number(raw) === 0) return null;
  const c = resolveColor(raw, { directIndex: itemType === 0 });
  if (!c) return null;
  const name = nearestColorName(c.hexColor);
  if (itemType === 2 && name === 'Gray') return null;
  return { css: c.cssColor, hex: c.hexColor, raw: c.rawColor, name };
}

function itemColor(row, itemType) {
  if (itemType === 1) return null;
  return colorInfo(row.color, itemType);
}

function mergeColorRows(rows, itemType) {
  const byKey = new Map();
  for (const r of rows) {
    const color = colorInfo(r.color, itemType);
    if (!color) continue;
    const currency = currencyName(r.currency_type);
    const key = `${color.name}|${currency}`;
    const ex = byKey.get(key);
    if (!ex) {
      byKey.set(key, { color, currency, observations: r.observations, sellers: r.sellers, min: r.min_cost, avg: r.avg_cost, max: r.max_cost, lastSeen: r.last_seen });
    } else {
      const total = ex.observations + r.observations;
      ex.avg = total ? Math.round((ex.avg * ex.observations + r.avg_cost * r.observations) / total) : ex.avg;
      ex.observations = total;
      ex.sellers += r.sellers;
      ex.min = Math.min(ex.min, r.min_cost);
      ex.max = Math.max(ex.max, r.max_cost);
      ex.lastSeen = Math.max(ex.lastSeen, r.last_seen);
    }
  }
  return [...byKey.values()];
}

function currencyName(code) {
  return code === 3 ? 'diamonds' : 'gems';
}

function currencyCode(name) {
  return name === 'diamonds' ? 3 : 0;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function marketRows(db, limit) {
  return (await db.marketSummary(limit)).map((r) => ({
    name: r.name || `def ${r.def_id}`,
    itemType: r.item_type,
    defId: r.def_id,
    currency: currencyName(r.currency_type),
    observations: r.observations,
    sellers: r.sellers,
    min: r.min_cost,
    avg: r.avg_cost,
    max: r.max_cost,
    median: r.median_cost,
    lastSeen: r.last_seen
  }));
}

async function recentRows(db, limit) {
  return (await db.marketValues(limit)).map((r) => ({
    item: r.name || `def ${r.def_id}`,
    itemType: r.item_type,
    defId: r.def_id,
    cost: r.cost,
    currency: currencyName(r.currency_type),
    color: colorInfo(r.color, r.item_type),
    seller: r.owner_name,
    scrapedAt: r.scraped_at
  }));
}

async function itemRows(db, { q, currency, sort, limit }) {
  return (await db.searchItems({ q, currency, sort, limit })).map((r) => ({
    name: r.name || `def ${r.def_id}`,
    itemType: r.item_type,
    defId: r.def_id,
    currency: currencyName(r.currency_type),
    observations: r.observations,
    sellers: r.sellers,
    min: r.min_cost,
    avg: r.avg_cost,
    max: r.max_cost,
    median: r.median_cost,
    lastSeen: r.last_seen
  }));
}

async function itemsByColor(db, colorName, limit = 60) {
  const target = String(colorName || '').trim().toLowerCase();
  if (!target) return [];
  const cache = new Map();
  const nameOf = (raw, itemType) => {
    const key = itemType + ':' + raw;
    if (cache.has(key)) return cache.get(key);
    const ci = colorInfo(raw, itemType);
    const nm = ci && ci.name ? ci.name.toLowerCase() : null;
    cache.set(key, nm);
    return nm;
  };
  const agg = new Map();
  for (const r of await db.distinctItemColors()) {
    if (nameOf(r.color, r.item_type) !== target) continue;
    const key = r.item_type + ':' + r.def_id;
    agg.set(key, (agg.get(key) || 0) + r.n);
  }
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Promise.all(top.map(async ([key, n]) => {
    const [it, def] = key.split(':').map(Number);
    return { itemType: it, defId: def, name: (await db.itemName(it, def)) || `def ${def}`, observations: n };
  }));
}

async function gemFallback(db, item) {
  const stats = await db.itemStats(item.itemType, item.defId);
  if (!stats.length) return null;
  const top = stats[0];
  return { median: await db.medianPrice(item.itemType, item.defId, top.currency_type), max: top.max_cost, currency: currencyName(top.currency_type) };
}

function bestColorWorth(wiki) {
  const cw = (wiki && Array.isArray(wiki.colorWorth) ? wiki.colorWorth : []).filter((x) => x.trade_value != null);
  if (!cw.length) return null;
  const max = cw.reduce((m, x) => (x.trade_value > m.trade_value ? x : m), cw[0]);
  return {
    tradeValue: max.trade_value,
    tradeDisplay: max.label ? `${max.label}: ${max.trade_display || max.worth_text}` : (max.trade_display || max.worth_text),
    worthText: max.worth_text,
    label: max.label || null,
    color: max.color || null
  };
}

function pickColorImage(index, label) {
  if (!index || !label) return null;
  const want = String(label).toLowerCase().trim();
  if (!want) return null;
  if (index.byLabel && index.byLabel[want]) return index.byLabel[want];
  if (index.byColor) {
    for (const k of Object.keys(index.byColor)) {
      if (String(k).toLowerCase().trim() === want) return index.byColor[k];
    }
  }
  return null;
}

async function topDeals(db, limit = 10) {
  if (!db.marketSummary) return [];
  const rows = await db.marketSummary(4000);
  const seen = new Set();
  const deals = [];
  for (const r of rows) {
    const median = r.median_cost;
    const min = r.min_cost;
    if (median == null || min == null || median < 5 || min < 3) continue;
    if ((r.observations || 0) < 10 || (r.sellers || 0) < 3) continue;
    const ratio = min / median;
    if (ratio > 0.82 || ratio < 0.18) continue;
    const key = r.item_type + ':' + r.def_id;
    if (seen.has(key)) continue;
    seen.add(key);
    deals.push({
      name: r.name || `def ${r.def_id}`,
      itemType: r.item_type,
      defId: r.def_id,
      cost: min,
      median,
      currency: currencyName(r.currency_type),
      discount: Math.round((1 - ratio) * 100),
      sellers: r.sellers,
      lastSeen: r.last_seen
    });
  }
  deals.sort((a, b) => b.discount - a.discount || (b.sellers || 0) - (a.sellers || 0));
  return deals.slice(0, limit);
}

async function scraperStatus(db, onlineMin = 30) {
  let last = null;
  try {
    const rows = await db.marketValues(1);
    last = rows && rows[0] ? rows[0].scraped_at : null;
  } catch { last = null; }
  const ageMin = last ? (Date.now() - last) / 60000 : null;
  return {
    online: ageMin != null && ageMin <= onlineMin,
    lastObsAgoMin: ageMin == null ? null : Math.round(ageMin)
  };
}

async function mostValuable(db, limit = 12) {
  const observed = await db.topObservedItems(20000);
  const byNorm = new Map();
  for (const o of observed) {
    const n = normalizeName(o.name);
    if (n && !byNorm.has(n)) byNorm.set(n, { item_type: o.item_type, def_id: o.def_id, name: o.name, observations: o.observations, holders: 0 });
  }
  const traded = db.tradeListItems ? await db.tradeListItems(20000) : [];
  for (const t of traded) {
    const n = normalizeName(t.name);
    if (!n) continue;
    const existing = byNorm.get(n);
    if (existing) existing.holders = t.holders;
    else byNorm.set(n, { item_type: t.item_type, def_id: t.def_id, name: t.name, observations: 0, holders: t.holders });
  }
  const worthTitles = db.topWikiWorth ? await db.topWikiWorth(300) : [];
  const valued = [];
  const seen = new Set();
  for (const wt of worthTitles) {
    const o = byNorm.get(normalizeName(wt.title));
    if (!o) continue;
    const key = o.item_type + ':' + o.def_id;
    if (seen.has(key)) continue;
    const wiki = db.wikiForItem ? await db.wikiForItem(o.item_type, o.def_id, o.name) : null;
    const gate = wiki && wiki.confidence !== 'medium' && wiki.confidence !== 'low';
    if (!gate) continue;
    const cw = bestColorWorth(wiki);
    const tradeValue = cw ? cw.tradeValue : (wiki.tradeValue != null ? wiki.tradeValue : null);
    if (tradeValue == null) continue;
    seen.add(key);
    const index = await imageIndexFor(db, o.item_type, o.def_id, o.name, wiki);
    const colorImage = cw ? pickColorImage(index, cw.label) : null;
    valued.push({
      name: o.name,
      itemType: o.item_type,
      defId: o.def_id,
      observations: o.observations,
      holders: o.holders,
      confidence: wiki.confidence,
      worthText: cw ? cw.worthText : wiki.worthText,
      tradeValue,
      tradeDisplay: cw ? cw.tradeDisplay : wiki.tradeDisplay,
      topColor: cw && (cw.label || cw.color) ? { label: cw.label, color: cw.color } : null,
      image: colorImage || index.defaultImage || null,
      imageColorMatch: !!colorImage
    });
  }
  valued.sort((a, b) => b.tradeValue - a.tradeValue || b.observations - a.observations);
  if (valued.length >= limit) return valued.slice(0, limit);
  const fill = observed.slice(0, 400).filter((o) => !seen.has(o.item_type + ':' + o.def_id))
    .map((o) => ({ name: o.name, itemType: o.item_type, defId: o.def_id, observations: o.observations, worthText: null, tradeValue: null, tradeDisplay: null }));
  const enriched = await Promise.all(fill.map(async (f) => ({ ...f, ...((await gemFallback(db, f)) || {}) })));
  const filled = enriched
    .filter((f) => f.median != null || f.max != null)
    .sort((a, b) => (b.median || b.max || 0) - (a.median || a.max || 0))
    .slice(0, limit - valued.length);
  return [...valued, ...filled];
}

async function tradeHolders(db, type, def, limit = 50) {
  const owners = (await db.tradeListHolders(type, def)).slice(0, limit);
  return Promise.all(owners.map(async (owner) => ({
    owner,
    presence: await db.sellerPresence(owner)
  })));
}

const RELEVANCE_STOP = new Set(['the', 'and', 'rare', 'with', 'for', 'pet']);

function relevanceTokens(itemName) {
  return String(itemName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 3 && !RELEVANCE_STOP.has(t));
}

function relevanceScore(im, tokens) {
  if (!tokens.length) return 1;
  const hay = `${im.path || im.url || ''} ${im.label || ''}`.toLowerCase();
  return tokens.filter((t) => hay.includes(t)).length;
}

const KIND_WEIGHT = { infobox: 3, table: 2, gallery: 1, wiki: 1 };

function extraTitleTokens(wiki, itemName) {
  if (!wiki || !wiki.title) return [];
  const itemSet = new Set(coreTokens(itemName));
  return coreTokens(wiki.title).filter((t) => !itemSet.has(t) && t.length >= 3 && !/^\d+$/.test(t));
}

function buildImageIndex(wiki, itemName) {
  const tokens = relevanceTokens(itemName);
  const fuzzy = wiki && (wiki.confidence === 'medium' || wiki.confidence === 'low');
  const extra = fuzzy ? extraTitleTokens(wiki, itemName) : [];
  const hasExtra = (im) => {
    if (!extra.length) return false;
    const hay = `${im.path || im.url || ''} ${im.label || ''}`.toLowerCase();
    return extra.some((t) => hay.includes(t));
  };
  const all = ((wiki && wiki.images) || []).filter((i) => i.path && !hasExtra(i))
    .map((i) => ({ src: imageSrc(i), color: i.color || null, label: i.label || i.color || '', kind: i.kind || 'wiki', score: relevanceScore(i, tokens) }))
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score || (KIND_WEIGHT[b.kind] || 0) - (KIND_WEIGHT[a.kind] || 0));
  const byColor = {};
  const byLabel = {};
  for (const im of all) {
    if (im.color && !byColor[im.color]) byColor[im.color] = im.src;
    const lab = im.label && String(im.label).toLowerCase().trim();
    if (lab && !byLabel[lab]) byLabel[lab] = im.src;
  }
  const fullMatch = tokens.length ? all.find((i) => i.score === tokens.length) : null;
  const infobox = all.find((i) => i.kind === 'infobox');
  const firstColored = all.find((i) => i.color);
  const defaultImage = (fullMatch && fullMatch.src) || (infobox && infobox.src) || (firstColored && firstColored.src) || (all[0] && all[0].src) || null;
  return { gallery: all, byColor, byLabel, defaultImage };
}

async function itemDetail(db, type, def) {
  const itemName = await db.itemName(type, def);
  let wiki = db.wikiForItem ? await db.wikiForItem(type, def, itemName) : null;
  if (wiki) {
    const lowConf = wiki.confidence === 'medium' || wiki.confidence === 'low';
    const colorWorth = lowConf ? [] : (wiki.colorWorth || []).map((c) => ({ label: c.label, color: c.color, worthText: c.worth_text, tradeValue: c.trade_value, tradeDisplay: c.trade_display }));
    wiki = { ...wiki, colorWorth, worthText: lowConf ? null : wiki.worthText, tradeValue: lowConf ? null : wiki.tradeValue, tradeDisplay: lowConf ? null : wiki.tradeDisplay };
  }
  const imageIndex = buildImageIndex(await imageWikiFor(db, type, def, wiki), itemName);
  if (wiki && Array.isArray(wiki.colorWorth) && wiki.colorWorth.length) {
    wiki = { ...wiki, colorWorth: wiki.colorWorth.map((c) => ({
      ...c,
      image: pickColorImage(imageIndex, c.label || c.color),
      colorHex: type === 0 ? null : hexForColorName(c.color)
    })) };
  }
  const statRows = await db.itemStats(type, def);
  const sellerRows = await db.itemSellers(type, def, 50);
  const colorRows = await db.itemColors(type, def);
  return {
    itemType: type,
    defId: def,
    itemName,
    observed: statRows.length > 0 || sellerRows.length > 0,
    wiki,
    images: imageIndex.gallery,
    imageByColor: imageIndex.byColor,
    defaultImage: imageIndex.defaultImage,
    stats: statRows.map((r) => ({
      currency: currencyName(r.currency_type),
      observations: r.observations,
      sellers: r.sellers,
      min: r.min_cost,
      avg: r.avg_cost,
      max: r.max_cost,
      median: r.median_cost,
      lastSeen: r.last_seen
    })),
    colors: mergeColorRows(colorRows, type),
    sellers: sellerRows.map((r) => ({
      seller: r.owner_name,
      cost: r.cost,
      currency: currencyName(r.currency_type),
      color: itemColor(r, type),
      shopId: r.shop_id,
      lastSeen: r.last_seen
    })),
    tradeHolders: await tradeHolders(db, type, def)
  };
}

function priceRangeFrom(statRows) {
  if (!statRows || !statRows.length) return null;
  const r = statRows[0];
  return {
    currency: currencyName(r.currency_type),
    min: r.min_cost != null ? r.min_cost : null,
    max: r.max_cost != null ? r.max_cost : null,
    median: r.median_cost != null ? r.median_cost : null
  };
}

async function autocompleteEnrich(db, results) {
  return Promise.all((results || []).map(async (it) => {
    const wiki = db.wikiForItem ? await db.wikiForItem(it.itemType, it.defId, it.name) : null;
    const [index, statRows] = await Promise.all([
      imageIndexFor(db, it.itemType, it.defId, it.name, wiki),
      db.itemStats(it.itemType, it.defId)
    ]);
    return { ...it, image: index.defaultImage || null, priceRange: priceRangeFrom(statRows) };
  }));
}

async function itemColors(db, itemType, defId) {
  const rawColors = await db.itemColorNames(itemType, defId);
  const seen = new Set();
  const result = [];
  for (const raw of rawColors) {
    const resolved = resolveColor(raw, { directIndex: itemType === 0 });
    if (!resolved) continue;
    const name = nearestColorName(resolved.hexColor);
    if (!name || seen.has(name)) continue;
    if (itemType === 2 && name === 'Gray') continue;
    seen.add(name);
    result.push({ name, hex: '#' + resolved.hexColor.slice(3) });
  }
  return result;
}

async function sellerDetail(db, name) {
  const inventoryRows = await db.sellerInventory(name);
  const tradeListRows = await db.tradeListFor(name);
  return {
    seller: name,
    inventory: inventoryRows.map((r) => ({
      name: r.name || `def ${r.def_id}`,
      itemType: r.item_type,
      defId: r.def_id,
      cost: r.cost,
      currency: currencyName(r.currency_type),
      color: itemColor(r, r.item_type),
      lastSeen: r.last_seen
    })),
    tradeList: await Promise.all(tradeListRows.map(async (r) => ({
      name: (await db.itemName(r.item_type, r.def_id)) || `def ${r.def_id}`,
      itemType: r.item_type,
      defId: r.def_id,
      color: itemColor(r, r.item_type),
      lastSeen: r.scraped_at
    })))
  };
}

async function itemHistory(db, type, def, currency, days) {
  const code = currencyCode(currency);
  const span = Math.max(1, Math.min(days || 14, 90));
  const since = Date.now() - span * 86400000;
  const rows = await db.priceSeries(type, def, code, since);
  if (!rows.length) return [];
  const pts = rows.map((r) => ({ t: r.scraped_at, median: r.cost, min: r.cost, max: r.cost, n: 1 }));
  const MAX = 80;
  if (pts.length <= MAX) return pts;
  const step = pts.length / MAX;
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

async function throughput(db, hours) {
  const span = Math.max(1, Math.min(hours || 24, 168));
  const bucketMs = 3600000;
  const since = Date.now() - span * bucketMs;
  const stamps = await db.observationsOverTime(since);
  const counts = new Array(span).fill(0);
  for (const ts of stamps) {
    const idx = Math.floor((ts - since) / bucketMs);
    if (idx >= 0 && idx < span) counts[idx] += 1;
  }
  return counts.map((n, i) => ({ t: since + i * bucketMs, n }));
}

async function currencySplit(db) {
  return (await db.currencySplit()).reduce((acc, r) => {
    acc[currencyName(r.currency_type)] = (acc[currencyName(r.currency_type)] || 0) + r.n;
    return acc;
  }, { gems: 0, diamonds: 0 });
}

module.exports = {
  colorInfo,
  mergeColorRows,
  imageWikiFor,
  buildImageIndex,
  currencyName,
  currencyCode,
  median,
  marketRows,
  recentRows,
  itemRows,
  mostValuable,
  topDeals,
  scraperStatus,
  itemsByColor,
  tradeHolders,
  itemColors,
  itemDetail,
  autocompleteEnrich,
  sellerDetail,
  itemHistory,
  throughput,
  currencySplit
};
