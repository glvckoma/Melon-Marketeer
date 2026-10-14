const { normalizeName } = require('./wikiName.js');
const { colorInfo } = require('../api/readModel.js');

function computeCoverage(db, { gapLimit = 200 } = {}) {
  const observed = db.db.prepare(
    `SELECT o.item_type AS itemType, o.def_id AS defId, d.name AS name, COUNT(*) AS obs
     FROM price_observations o
     JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
     WHERE d.name IS NOT NULL
     GROUP BY o.item_type, o.def_id`
  ).all();

  const ajByNorm = new Map();
  const ajByTitle = new Map();
  const ajamByNorm = new Map();
  for (const r of db.db.prepare('SELECT source, norm, title, images_json FROM wiki_items').all()) {
    if (r.source === 'animaljam') {
      if (!ajamByNorm.has(r.norm)) ajamByNorm.set(r.norm, r);
    } else {
      if (!ajByNorm.has(r.norm)) ajByNorm.set(r.norm, r);
      ajByTitle.set(r.title, r);
    }
  }

  const itemWiki = new Map();
  const confidence = { high: 0, medium: 0, low: 0, manual: 0, none: 0 };
  for (const r of db.db.prepare('SELECT item_type, def_id, wiki_title, confidence FROM item_wiki').all()) {
    itemWiki.set(`${r.item_type}:${r.def_id}`, r.wiki_title);
    const c = r.confidence || 'none';
    confidence[c] = (confidence[c] || 0) + 1;
  }

  const colorsByItem = new Map();
  for (const r of db.distinctItemColors()) {
    const info = colorInfo(r.color, r.item_type);
    if (!info || !info.name) continue;
    const key = `${r.item_type}:${r.def_id}`;
    if (!colorsByItem.has(key)) colorsByItem.set(key, new Set());
    colorsByItem.get(key).add(info.name);
  }

  const summary = {
    observed: observed.length, withImages: 0, unsynced: 0, noImagesOnPage: 0, unmatched: 0,
    fromAjItemWorth: 0, fromAnimaljam: 0, observedColors: 0, withColorImage: 0, confidence
  };
  const unmatched = [];
  const noImagesOnPage = [];

  const imgs = (row) => (row && row.images_json ? JSON.parse(row.images_json).filter((i) => i.path) : []);

  for (const it of observed) {
    const norm = normalizeName(it.name);
    let aj = ajByNorm.get(norm);
    let matchType = aj ? 'exact' : null;
    if (!aj) {
      const t = itemWiki.get(`${it.itemType}:${it.defId}`);
      if (t) { aj = ajByTitle.get(t); matchType = 'fuzzy'; }
    }
    const ajam = ajamByNorm.get(norm);
    if (!aj && !ajam) { summary.unmatched += 1; unmatched.push(it); continue; }

    const ajImgs = imgs(aj);
    const ajamImgs = imgs(ajam);
    const allImgs = [...ajImgs, ...ajamImgs];
    const pendingSync = (aj && aj.images_json == null) || (ajam && ajam.images_json == null);

    if (!allImgs.length) {
      if (pendingSync) { summary.unsynced += 1; continue; }
      summary.noImagesOnPage += 1;
      noImagesOnPage.push({ ...it, wikiTitle: (aj && aj.title) || (ajam && ajam.title), matchType });
      continue;
    }

    summary.withImages += 1;
    if (ajImgs.length) summary.fromAjItemWorth += 1;
    else summary.fromAnimaljam += 1;

    const colors = colorsByItem.get(`${it.itemType}:${it.defId}`);
    if (colors && colors.size) {
      const imgColors = new Set(allImgs.map((i) => i.color).filter(Boolean));
      for (const c of colors) {
        summary.observedColors += 1;
        if (imgColors.has(c)) summary.withColorImage += 1;
      }
    }
  }

  const byObs = (a, b) => b.obs - a.obs;
  return {
    summary,
    unmatched: unmatched.sort(byObs).slice(0, gapLimit),
    noImagesOnPage: noImagesOnPage.sort(byObs).slice(0, gapLimit)
  };
}

const TYPE_LABELS = { 0: 'Den', 1: 'Pet', 2: 'Clothing' };

function computeCoverageByType(db, { gapLimit = 100 } = {}) {
  const mk = () => ({
    observed: 0, withImages: 0, unsynced: 0, noImagesOnPage: 0, unmatched: 0,
    observedColors: 0, withColorImage: 0, colorFail: 0, totalDefs: 0, unobserved: 0
  });
  const types = {};
  for (const t of Object.keys(TYPE_LABELS)) types[t] = mk();

  for (const r of db.db.prepare('SELECT item_type, COUNT(*) AS n FROM item_definitions GROUP BY item_type').all()) {
    if (types[r.item_type]) types[r.item_type].totalDefs = r.n;
  }

  const observed = db.db.prepare(
    `SELECT o.item_type AS itemType, o.def_id AS defId, d.name AS name, COUNT(*) AS obs
     FROM price_observations o
     JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
     WHERE d.name IS NOT NULL
     GROUP BY o.item_type, o.def_id`
  ).all();

  const ajByNorm = new Map();
  const ajByTitle = new Map();
  const ajamByNorm = new Map();
  for (const r of db.db.prepare('SELECT source, norm, title, images_json FROM wiki_items').all()) {
    if (r.source === 'animaljam') {
      if (!ajamByNorm.has(r.norm)) ajamByNorm.set(r.norm, r);
    } else {
      if (!ajByNorm.has(r.norm)) ajByNorm.set(r.norm, r);
      ajByTitle.set(r.title, r);
    }
  }
  const itemWiki = new Map();
  for (const r of db.db.prepare('SELECT item_type, def_id, wiki_title FROM item_wiki').all()) {
    itemWiki.set(`${r.item_type}:${r.def_id}`, r.wiki_title);
  }

  const colorsByItem = new Map();
  for (const r of db.distinctItemColors()) {
    const info = colorInfo(r.color, r.item_type);
    const tb = types[r.item_type];
    if (!info || !info.name) { if (tb) tb.colorFail += 1; continue; }
    const key = `${r.item_type}:${r.def_id}`;
    if (!colorsByItem.has(key)) colorsByItem.set(key, new Set());
    colorsByItem.get(key).add(info.name);
  }

  const imgs = (row) => (row && row.images_json ? JSON.parse(row.images_json).filter((i) => i.path) : []);
  const gaps = { unmatched: [], noImagesOnPage: [] };
  const observedDefs = {};

  for (const it of observed) {
    const tb = types[it.itemType];
    if (!tb) continue;
    tb.observed += 1;
    observedDefs[it.itemType] = (observedDefs[it.itemType] || 0) + 1;
    const norm = normalizeName(it.name);
    let aj = ajByNorm.get(norm);
    if (!aj) {
      const t = itemWiki.get(`${it.itemType}:${it.defId}`);
      if (t) aj = ajByTitle.get(t);
    }
    const ajam = ajamByNorm.get(norm);
    if (!aj && !ajam) { tb.unmatched += 1; gaps.unmatched.push({ ...it, type: TYPE_LABELS[it.itemType] }); continue; }

    const allImgs = [...imgs(aj), ...imgs(ajam)];
    const pendingSync = (aj && aj.images_json == null) || (ajam && ajam.images_json == null);
    if (!allImgs.length) {
      if (pendingSync) { tb.unsynced += 1; continue; }
      tb.noImagesOnPage += 1;
      gaps.noImagesOnPage.push({ ...it, type: TYPE_LABELS[it.itemType], wikiTitle: (aj && aj.title) || (ajam && ajam.title) });
      continue;
    }

    tb.withImages += 1;
    const colors = colorsByItem.get(`${it.itemType}:${it.defId}`);
    if (colors && colors.size) {
      const imgColors = new Set(allImgs.map((i) => i.color).filter(Boolean));
      for (const c of colors) {
        tb.observedColors += 1;
        if (imgColors.has(c)) tb.withColorImage += 1;
      }
    }
  }

  for (const t of Object.keys(types)) {
    types[t].unobserved = Math.max(0, types[t].totalDefs - (observedDefs[t] || 0));
    types[t].label = TYPE_LABELS[t];
  }

  const byObs = (a, b) => b.obs - a.obs;
  return {
    types,
    gaps: {
      unmatched: gaps.unmatched.sort(byObs).slice(0, gapLimit),
      noImagesOnPage: gaps.noImagesOnPage.sort(byObs).slice(0, gapLimit)
    }
  };
}

module.exports = { computeCoverage, computeCoverageByType };
