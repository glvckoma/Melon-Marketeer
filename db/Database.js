const path = require('path');
const fs = require('fs');
const { normalizeName } = require('../items/wikiName.js');
const { parseTradeValue } = require('../items/tradeValue.js');
const { looksLikeDate } = require('../items/WikiData.js');
const { SCHEMA } = require('./schema.js');

const STATS_TTL_MS = Number(process.env.STATS_TTL_MS) || 0;

function openDriver(dbPath) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(dbPath);
  } catch (betterErr) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(dbPath);
    } catch (nativeErr) {
      throw new Error(
        `No SQLite driver available. Install better-sqlite3 or use Node >= 22.13. ` +
        `better-sqlite3 error: ${betterErr.message}`
      );
    }
  }
}

class Database {
  constructor(dbPath = path.resolve(__dirname, '..', 'data', 'marketeer.db')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = openDriver(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA cache_size = -16000');
    this.db.exec('PRAGMA mmap_size = 268435456');
    this.db.exec('PRAGMA temp_store = MEMORY');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
    this._migrate();
    this._prepare();
  }

  _addColumn(sql) {
    try {
      this.db.exec(sql);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }

  _migrate() {
    const cols = this.db.prepare('PRAGMA table_info(usernames)').all().map((c) => c.name);
    if (!cols.includes('last_seen')) {
      this._addColumn('ALTER TABLE usernames ADD COLUMN last_seen INTEGER');
    }
    if (!cols.includes('is_live')) {
      this._addColumn('ALTER TABLE usernames ADD COLUMN is_live INTEGER DEFAULT 0');
    }
    const obsCols = this.db.prepare('PRAGMA table_info(price_observations)').all().map((c) => c.name);
    if (!obsCols.includes('color')) {
      this._addColumn('ALTER TABLE price_observations ADD COLUMN color INTEGER');
    }
    if (!obsCols.includes('pet_appearance')) {
      this._addColumn('ALTER TABLE price_observations ADD COLUMN pet_appearance TEXT');
    }
    const tlTable = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tradelist_items'").get();
    if (tlTable && /PRIMARY KEY/i.test(tlTable.sql)) {
      this.db.exec('DROP TABLE tradelist_items');
      this.db.exec(SCHEMA);
    }
    const tlCols = this.db.prepare('PRAGMA table_info(tradelist_items)').all().map((c) => c.name);
    if (tlCols.length && !tlCols.includes('pet_appearance')) {
      this._addColumn('ALTER TABLE tradelist_items ADD COLUMN pet_appearance TEXT');
    }
    const wikiCols = this.db.prepare('PRAGMA table_info(wiki_items)').all().map((c) => c.name);
    if (wikiCols.length && !wikiCols.includes('source')) {
      this.db.exec('ALTER TABLE wiki_items RENAME TO wiki_items_old');
      this.db.exec(SCHEMA);
      this.db.exec(
        "INSERT OR IGNORE INTO wiki_items (source, title, norm, url, worth_text, images_json, scraped_at) " +
        "SELECT 'aj-item-worth', title, norm, url, worth_text, images_json, scraped_at FROM wiki_items_old"
      );
      this.db.exec('DROP TABLE wiki_items_old');
    }
    const wikiCols2 = this.db.prepare('PRAGMA table_info(wiki_items)').all().map((c) => c.name);
    for (const [col, type] of [['trade_value', 'REAL'], ['trade_display', 'TEXT'], ['trade_basis', 'TEXT'], ['trade_value_override', 'REAL'], ['trade_display_override', 'TEXT'], ['trade_computed_at', 'INTEGER']]) {
      if (!wikiCols2.includes(col)) this._addColumn(`ALTER TABLE wiki_items ADD COLUMN ${col} ${type}`);
    }
    const iwCols = this.db.prepare('PRAGMA table_info(item_wiki)').all().map((c) => c.name);
    if (iwCols.length && !iwCols.includes('confidence')) {
      this._addColumn('ALTER TABLE item_wiki ADD COLUMN confidence TEXT');
    }
    if (iwCols.length && !iwCols.includes('source')) {
      this._addColumn('ALTER TABLE item_wiki ADD COLUMN source TEXT');
    }
  }

  _prepare() {
    this._enqueue = this.db.prepare(
      'INSERT OR IGNORE INTO usernames (name, source, first_seen) VALUES (?, ?, ?)'
    );
    this._queued = this.db.prepare(
      'SELECT name FROM usernames WHERE scraped = 0 AND name NOT IN (SELECT owner_name FROM dens) ORDER BY first_seen ASC'
    );
    this._markScraped = this.db.prepare('UPDATE usernames SET scraped = 1 WHERE name = ?');
    this._denDone = this.db.prepare('SELECT 1 FROM dens WHERE owner_name = ? LIMIT 1');
    this._recordDen = this.db.prepare(
      'INSERT OR REPLACE INTO dens (owner_name, shop_ids, item_count, status, scraped_at) VALUES (?, ?, ?, ?, ?)'
    );
    this._insertObs = this.db.prepare(
      `INSERT INTO price_observations
        (owner_name, shop_id, inv_idx, def_id, item_type, cost, currency_type, color, pet_appearance, shop_state, scraped_by, scraped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this._upsertDef = this.db.prepare(
      'INSERT OR REPLACE INTO item_definitions (item_type, def_id, name, abbr) VALUES (?, ?, ?, ?)'
    );
    this._countDefs = this.db.prepare('SELECT COUNT(*) AS n FROM item_definitions');
    this._marketValues = this.db.prepare(
      `SELECT o.owner_name, o.shop_id, o.def_id, o.item_type, o.cost, o.currency_type, o.color, o.scraped_at,
              d.name, d.abbr
       FROM price_observations o
       LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
       ORDER BY o.scraped_at DESC, o.cost DESC
       LIMIT ?`
    );
    this._countUsernames = this.db.prepare('SELECT COUNT(*) AS n FROM usernames');
    this._countQueued = this.db.prepare('SELECT COUNT(*) AS n FROM usernames WHERE scraped = 0');
    this._countLive = this.db.prepare('SELECT COUNT(*) AS n FROM usernames WHERE is_live = 1');
    this._countLivePool = this.db.prepare(
      'SELECT COUNT(*) AS n FROM usernames WHERE is_live = 1 AND scraped = 0 AND name NOT IN (SELECT owner_name FROM dens)'
    );
    this._countDeadPool = this.db.prepare(
      'SELECT COUNT(*) AS n FROM usernames WHERE is_live = 0 AND scraped = 0 AND name NOT IN (SELECT owner_name FROM dens)'
    );
    this._countSellers = this.db.prepare('SELECT COUNT(DISTINCT owner_name) AS n FROM price_observations');
    this._countEmptyDens = this.db.prepare("SELECT COUNT(*) AS n FROM dens WHERE status <> 'ok'");
    this._countDens = this.db.prepare('SELECT COUNT(*) AS n FROM dens');
    this._countObs = this.db.prepare('SELECT COUNT(*) AS n FROM price_observations');
    this._markLive = this.db.prepare(
      `INSERT INTO usernames (name, source, first_seen, last_seen, is_live)
       VALUES (?, 'nearby', ?, ?, 1)
       ON CONFLICT (name) DO UPDATE SET is_live = 1, last_seen = excluded.last_seen`
    );
    this._liveQueued = this.db.prepare(
      `SELECT name FROM usernames
       WHERE is_live = 1 AND scraped = 0 AND name NOT IN (SELECT owner_name FROM dens)
       ORDER BY last_seen DESC
       LIMIT ?`
    );
    this._fallbackQueued = this.db.prepare(
      `SELECT name FROM usernames
       WHERE is_live = 0 AND scraped = 0 AND name NOT IN (SELECT owner_name FROM dens)
       ORDER BY first_seen ASC
       LIMIT ?`
    );
    this._staleSellers = this.db.prepare(
      `SELECT owner_name FROM seller_stats
       WHERE last_seen < ?
       ORDER BY last_seen ASC
       LIMIT ?`
    );
    this._resetLive = this.db.prepare('UPDATE usernames SET is_live = 0 WHERE is_live = 1');
    this._marketSummary = this.db.prepare(
      `SELECT s.item_type, s.def_id, s.currency_type,
              s.observations, s.sellers, s.min_cost, s.max_cost, s.avg_cost, s.median_cost, s.last_seen,
              d.name, d.abbr
       FROM item_stats s
       LEFT JOIN item_definitions d ON d.item_type = s.item_type AND d.def_id = s.def_id
       ORDER BY s.observations DESC
       LIMIT ?`
    );
    this._itemSellers = this.db.prepare(
      `SELECT o.owner_name, o.cost, o.currency_type, o.color, o.pet_appearance, o.shop_id, MAX(o.scraped_at) AS last_seen
       FROM price_observations o
       WHERE o.item_type = ? AND o.def_id = ?
       GROUP BY o.owner_name
       ORDER BY o.cost ASC
       LIMIT ?`
    );
    this._medianLookup = this.db.prepare(
      'SELECT median_cost FROM item_stats WHERE item_type = ? AND def_id = ? AND currency_type = ?'
    );
    this._itemColors = this.db.prepare(
      `SELECT color, currency_type, observations, sellers, min_cost, max_cost, avg_cost, last_seen
       FROM item_color_stats
       WHERE item_type = ? AND def_id = ?
       ORDER BY observations DESC`
    );
    this._sellerInventory = this.db.prepare(
      `SELECT o.item_type, o.def_id, o.cost, o.currency_type, o.color, o.pet_appearance, o.shop_id,
              MAX(o.scraped_at) AS last_seen, d.name, d.abbr
       FROM price_observations o
       LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
       WHERE o.owner_name = ?
       GROUP BY o.item_type, o.def_id
       ORDER BY o.currency_type DESC, o.cost DESC
       LIMIT ?`
    );
    this._currencySplit = this.db.prepare(
      'SELECT currency_type, SUM(observations) AS n FROM item_stats GROUP BY currency_type'
    );
    this._itemStats = this.db.prepare(
      `SELECT currency_type, observations, sellers, min_cost, max_cost, avg_cost, median_cost, last_seen
       FROM item_stats
       WHERE item_type = ? AND def_id = ?
       ORDER BY observations DESC`
    );
    this._priceSeries = this.db.prepare(
      `SELECT scraped_at, cost FROM price_observations
       WHERE item_type = ? AND def_id = ? AND currency_type = ? AND scraped_at >= ?
       ORDER BY scraped_at ASC`
    );
    this._obsOverTime = this.db.prepare(
      'SELECT scraped_at FROM price_observations WHERE scraped_at >= ? ORDER BY scraped_at ASC'
    );
    this._sampleByCurrency = this.db.prepare(
      `SELECT o.owner_name, o.cost, o.item_type, o.def_id, o.scraped_at, d.name
       FROM price_observations o
       LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
       WHERE o.currency_type = ?
       ORDER BY o.scraped_at DESC
       LIMIT ?`
    );
    this._maxObsId = this.db.prepare('SELECT MAX(id) AS m FROM price_observations');
    this._addWatch = this.db.prepare(
      `INSERT INTO watches (kind, item_type, def_id, owner_name, currency_type, max_cost, label, created_at, last_seen_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this._removeWatch = this.db.prepare('DELETE FROM watches WHERE id = ?');
    this._listWatches = this.db.prepare('SELECT * FROM watches ORDER BY created_at DESC');
    this._getWatch = this.db.prepare('SELECT * FROM watches WHERE id = ?');
    this._markWatchSeen = this.db.prepare('UPDATE watches SET last_seen_id = ? WHERE id = ?');
    this._markAllWatchesSeen = this.db.prepare('UPDATE watches SET last_seen_id = ?');
    this._itemWatchMatches = this.db.prepare(
      `SELECT o.id, o.owner_name, o.cost, o.item_type, o.def_id, o.currency_type, o.color, o.scraped_at, d.name
       FROM price_observations o
       LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
       WHERE o.id > ? AND o.item_type = ? AND o.def_id = ?
         AND (? IS NULL OR o.currency_type = ?)
         AND (? IS NULL OR o.cost <= ?)
       ORDER BY o.scraped_at DESC
       LIMIT ?`
    );
    this._sellerWatchMatches = this.db.prepare(
      `SELECT o.id, o.owner_name, o.cost, o.item_type, o.def_id, o.currency_type, o.color, o.scraped_at, d.name
       FROM price_observations o
       LEFT JOIN item_definitions d ON d.item_type = o.item_type AND d.def_id = o.def_id
       WHERE o.id > ? AND o.owner_name = ?
       ORDER BY o.scraped_at DESC
       LIMIT ?`
    );
  }

  enqueueUsername(name, source = 'nearby') {
    if (!name) return false;
    const result = this._enqueue.run(String(name), source, Date.now());
    return result.changes > 0;
  }

  enqueueUsernames(names, source = 'user') {
    const out = { added: 0, duplicate: 0 };
    const run = () => {
      for (const raw of names) {
        const name = String(raw || '');
        if (!name) continue;
        if (this._enqueue.run(name, source, Date.now()).changes > 0) out.added += 1;
        else out.duplicate += 1;
      }
    };
    if (this.db.transaction) this.db.transaction(run)();
    else { this.db.exec('BEGIN'); try { run(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
    return out;
  }

  getQueuedUsernames(limit = 0) {
    const rows = this._queued.all();
    const names = rows.map(r => r.name);
    return limit > 0 ? names.slice(0, limit) : names;
  }

  markUsernameScraped(name) {
    this._markScraped.run(name);
  }

  hasDenScraped(name) {
    return !!this._denDone.get(name);
  }

  recordDen(ownerName, shopIds, itemCount, status) {
    this._recordDen.run(ownerName, JSON.stringify(shopIds || []), itemCount || 0, status, Date.now());
  }

  insertObservations(records) {
    if (!records || records.length === 0) return;
    const insert = this.db.transaction
      ? this.db.transaction((rows) => {
          for (const r of rows) this._writeObservation(r);
        })
      : null;
    if (insert) {
      insert(records);
    } else {
      this.db.exec('BEGIN');
      try {
        for (const r of records) this._writeObservation(r);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  _writeObservation(r) {
    this._insertObs.run(
      r.ownerName,
      r.shopId,
      r.invIdx,
      r.defId,
      r.itemType,
      r.cost,
      r.currencyType,
      r.color == null ? null : r.color,
      r.petAppearance == null ? null : r.petAppearance,
      r.shopState || '',
      r.scrapedBy || '',
      r.scrapedAt || Date.now()
    );
  }

  importDefinitions(resolver) {
    let n = 0;
    const rows = [...resolver.all()];
    const run = () => { for (const r of rows) { this._upsertDef.run(r.itemType, r.defId, r.name, r.abbr); n++; } };
    if (this.db.transaction) this.db.transaction(run)();
    else { this.db.exec('BEGIN'); try { run(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
    return n;
  }

  markLive(name) {
    if (!name) return;
    const now = Date.now();
    this._markLive.run(String(name), now, now);
  }

  getLiveQueued(limit = 500) {
    return this._liveQueued.all(limit).map((r) => r.name);
  }

  getFallbackQueued(limit = 200) {
    return this._fallbackQueued.all(limit).map((r) => r.name);
  }

  getStaleSellers(staleThresholdMs = 4 * 60 * 60 * 1000, limit = 200) {
    const cutoff = Date.now() - staleThresholdMs;
    return this._staleSellers.all(cutoff, limit).map((r) => r.owner_name);
  }

  resetLiveFlags() {
    this._resetLive.run();
  }

  marketValues(limit = 100) {
    return this._marketValues.all(limit);
  }

  marketSummary(limit = 100) {
    this.ensureStats();
    return this._marketSummary.all(limit);
  }

  observationCountMap() {
    this.ensureStats();
    const map = new Map();
    let rows = this.db.prepare('SELECT item_type, def_id, SUM(observations) AS obs FROM item_stats GROUP BY item_type, def_id').all();
    if (!rows.length) {
      rows = this.db.prepare('SELECT item_type, def_id, COUNT(*) AS obs FROM price_observations GROUP BY item_type, def_id').all();
    }
    for (const r of rows) map.set(r.item_type + ':' + r.def_id, Number(r.obs) || 0);
    return map;
  }

  itemSellers(itemType, defId, limit = 50) {
    return this._itemSellers.all(itemType, defId, limit);
  }

  topSellers({ limit = 25, sort = 'recent' } = {}) {
    this.ensureStats();
    const orderBy = sort === 'items' ? 'items DESC, observations DESC' : 'last_seen DESC';
    return this.db.prepare(
      `SELECT ss.owner_name,
              ss.observations,
              ss.items,
              ss.last_seen
       FROM seller_stats ss
       ORDER BY ${orderBy}
       LIMIT ?`
    ).all(Math.min(Number(limit) || 25, 500));
  }

  medianPrice(itemType, defId, currencyType = 1) {
    this.ensureStats();
    const row = this._medianLookup.get(itemType, defId, currencyType);
    return row && row.median_cost != null ? row.median_cost : null;
  }

  searchItems({ q = '', currency = 'all', sort = 'observations', limit = 100 } = {}) {
    this.ensureStats();
    const where = [];
    const params = [];
    if (q) { where.push('d.name LIKE ?'); params.push(`%${q}%`); }
    if (currency === 'gems') where.push('s.currency_type <> 3');
    else if (currency === 'diamonds') where.push('s.currency_type = 3');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = {
      min: 'min_cost ASC',
      max: 'max_cost DESC',
      sellers: 'sellers DESC',
      lastSeen: 'last_seen DESC',
      observations: 'observations DESC'
    }[sort] || 'observations DESC';
    const sql = `SELECT s.item_type, s.def_id, s.currency_type,
                        s.observations, s.sellers, s.min_cost, s.max_cost, s.avg_cost, s.median_cost, s.last_seen,
                        d.name, d.abbr
                 FROM item_stats s
                 LEFT JOIN item_definitions d ON d.item_type = s.item_type AND d.def_id = s.def_id
                 ${clause}
                 ORDER BY ${orderBy}
                 LIMIT ?`;
    params.push(Math.min(Number(limit) || 100, 500));
    return this.db.prepare(sql).all(...params);
  }

  itemStats(itemType, defId) {
    this.ensureStats();
    return this._itemStats.all(itemType, defId);
  }

  itemColors(itemType, defId) {
    this.ensureStats();
    return this._itemColors.all(itemType, defId);
  }

  itemName(itemType, defId) {
    const row = this.db.prepare('SELECT name FROM item_definitions WHERE item_type = ? AND def_id = ?').get(itemType, defId);
    return row ? row.name : null;
  }

  requestRecheck(owner, now = Date.now()) {
    const name = String(owner || '').trim();
    if (!name) return { ok: false };
    this.db.prepare('INSERT OR REPLACE INTO priority_rescrape (owner_name, requested_at) VALUES (?, ?)').run(name, now);
    return { ok: true };
  }

  getPriorityQueued(limit = 50) {
    return this.db.prepare(
      'SELECT owner_name FROM priority_rescrape ORDER BY requested_at ASC LIMIT ?'
    ).all(limit).map((r) => r.owner_name);
  }

  clearPriority(owners) {
    if (!owners || !owners.length) return;
    const stmt = this.db.prepare('DELETE FROM priority_rescrape WHERE owner_name = ?');
    const run = () => { for (const o of owners) stmt.run(o); };
    if (this.db.transaction) this.db.transaction(run)(); else run();
  }

  upsertWikiWorth(title, url, worthText, source = 'aj-item-worth') {
    this.db.prepare(
      `INSERT INTO wiki_items (source, title, norm, url, worth_text, scraped_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, title) DO UPDATE SET url = excluded.url,
         worth_text = COALESCE(excluded.worth_text, wiki_items.worth_text), norm = excluded.norm`
    ).run(source, title, normalizeName(title), url, worthText || null, Date.now());
    if (worthText) {
      const tv = parseTradeValue(worthText);
      this.setWikiTradeValue(title, tv, source);
    }
  }

  setWikiTradeValue(title, { value, display, basis }, source = 'aj-item-worth') {
    this.db.prepare(
      'UPDATE wiki_items SET trade_value = ?, trade_display = ?, trade_basis = ?, trade_computed_at = ? WHERE source = ? AND title = ?'
    ).run(value == null ? null : value, display || null, basis || null, Date.now(), source, title);
  }

  setWikiTradeOverride(title, value, display, source = 'aj-item-worth') {
    this.db.prepare(
      'UPDATE wiki_items SET trade_value_override = ?, trade_display_override = ? WHERE source = ? AND title = ?'
    ).run(value == null ? null : value, display || null, source, title);
  }

  wikiItemsForRecompute(source = 'aj-item-worth') {
    return this.db.prepare('SELECT title, worth_text FROM wiki_items WHERE source = ?').all(source);
  }

  setWikiImages(title, images, source = 'aj-item-worth') {
    this.db.prepare('UPDATE wiki_items SET images_json = ?, scraped_at = ? WHERE source = ? AND title = ?')
      .run(JSON.stringify(images || []), Date.now(), source, title);
  }

  setWikiColorWorth(title, rows, source = 'aj-item-worth') {
    const del = this.db.prepare('DELETE FROM wiki_color_worth WHERE source = ? AND title = ?');
    const ins = this.db.prepare(
      'INSERT INTO wiki_color_worth (source, title, label, color, worth_text, trade_value, trade_display) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const run = () => {
      del.run(source, title);
      for (const r of rows || []) {
        const tv = parseTradeValue(r.worthText);
        ins.run(source, title, r.label, r.color || null, r.worthText || null, tv.value == null ? null : tv.value, tv.display || null);
      }
    };
    if (this.db.transaction) this.db.transaction(run)(); else run();
    return (rows || []).length;
  }

  colorWorthFor(title, source = 'aj-item-worth') {
    return this.db.prepare(
      'SELECT label, color, worth_text, trade_value, trade_display FROM wiki_color_worth WHERE source = ? AND title = ? ORDER BY trade_value DESC, label ASC'
    ).all(source, title);
  }

  topWikiWorth(limit = 300, source = 'aj-item-worth') {
    return this.db.prepare(
      `SELECT title, MAX(tv) AS worth FROM (
         SELECT title, COALESCE(trade_value_override, trade_value) AS tv FROM wiki_items WHERE source = ? AND COALESCE(trade_value_override, trade_value) IS NOT NULL
         UNION ALL
         SELECT title, trade_value AS tv FROM wiki_color_worth WHERE source = ? AND trade_value IS NOT NULL
       ) GROUP BY title ORDER BY worth DESC LIMIT ?`
    ).all(source, source, limit);
  }

  wikiTitlesNeedingImages(limit = 100, source = 'aj-item-worth') {
    return this.db.prepare('SELECT title FROM wiki_items WHERE source = ? AND images_json IS NULL ORDER BY title LIMIT ?')
      .all(source, limit).map((r) => r.title);
  }

  _shapeWiki(row) {
    if (!row) return null;
    const tradeValue = row.trade_value_override != null ? row.trade_value_override : (row.trade_value != null ? row.trade_value : null);
    const tradeDisplay = row.trade_display_override != null ? row.trade_display_override : (row.trade_display != null ? row.trade_display : null);
    const worthText = looksLikeDate(row.worth_text) ? null : row.worth_text;
    return { source: row.source, title: row.title, url: row.url, worthText, tradeValue, tradeDisplay, tradeBasis: row.trade_basis || null, images: row.images_json ? JSON.parse(row.images_json) : [] };
  }

  _mergeWikiImages(images) {
    const seen = new Set();
    const out = [];
    for (const im of images) {
      const key = im && (im.path || im.url || im.file);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(im);
    }
    return out;
  }

  wikiByName(name, source = 'aj-item-worth') {
    return this._shapeWiki(this.db.prepare('SELECT * FROM wiki_items WHERE norm = ? AND source = ? LIMIT 1').get(normalizeName(name), source));
  }

  wikiByTitle(title, source = 'aj-item-worth') {
    return this._shapeWiki(this.db.prepare('SELECT * FROM wiki_items WHERE title = ? AND source = ? LIMIT 1').get(title, source));
  }

  allWikiTitles(source = 'aj-item-worth') {
    return this.db.prepare('SELECT title FROM wiki_items WHERE source = ?').all(source).map((r) => r.title);
  }

  setItemWiki(itemType, defId, wikiTitle, confidence = 'manual', source = 'aj-item-worth') {
    this.db.prepare('INSERT OR REPLACE INTO item_wiki (item_type, def_id, wiki_title, confidence, source) VALUES (?, ?, ?, ?, ?)')
      .run(itemType, defId, wikiTitle, confidence, source);
  }

  wikiTitleForItem(itemType, defId) {
    const row = this.db.prepare('SELECT wiki_title FROM item_wiki WHERE item_type = ? AND def_id = ?').get(itemType, defId);
    return row ? row.wiki_title : null;
  }

  wikiForItem(itemType, defId, name) {
    let aj = this.wikiByName(name, 'aj-item-worth');
    let confidence = aj ? 'exact' : null;
    if (!aj) {
      const row = this.db.prepare('SELECT wiki_title, confidence FROM item_wiki WHERE item_type = ? AND def_id = ?').get(itemType, defId);
      if (row && row.wiki_title) { aj = this.wikiByTitle(row.wiki_title, 'aj-item-worth'); confidence = row.confidence || 'low'; }
    }
    const ajam = this.wikiByName(name, 'animaljam');
    if (!aj && !ajam) return null;
    if (!aj && ajam) confidence = 'exact';
    const base = aj || ajam;
    return {
      title: base.title,
      url: (aj && aj.url) || (ajam && ajam.url),
      worthText: aj ? aj.worthText : null,
      tradeValue: aj ? aj.tradeValue : null,
      tradeDisplay: aj ? aj.tradeDisplay : null,
      tradeBasis: aj ? aj.tradeBasis : null,
      confidence,
      images: this._mergeWikiImages([...(aj ? aj.images : []), ...(ajam ? ajam.images : [])]),
      colorWorth: aj ? this.colorWorthFor(aj.title) : []
    };
  }

  rollupStats() {
    const now = Date.now();
    const maxId = (this._maxObsId.get() || {}).m || 0;
    const statRows = this.db.prepare(
      `SELECT item_type, def_id, currency_type,
              COUNT(*) AS observations,
              COUNT(DISTINCT owner_name) AS sellers,
              MIN(cost) AS min_cost, MAX(cost) AS max_cost,
              CAST(AVG(cost) AS INTEGER) AS avg_cost,
              MAX(scraped_at) AS last_seen
       FROM price_observations
       GROUP BY item_type, def_id, currency_type`
    ).all();
    const colorRows = this.db.prepare(
      `SELECT item_type, def_id, color, currency_type,
              COUNT(*) AS observations,
              COUNT(DISTINCT owner_name) AS sellers,
              MIN(cost) AS min_cost, MAX(cost) AS max_cost,
              CAST(AVG(cost) AS INTEGER) AS avg_cost,
              MAX(scraped_at) AS last_seen
       FROM price_observations
       GROUP BY item_type, def_id, color, currency_type`
    ).all();
    const medianRows = this.db.prepare(
      `SELECT item_type, def_id, currency_type, CAST(AVG(cost) + 0.5 AS INTEGER) AS median_cost
       FROM (SELECT item_type, def_id, currency_type, cost,
                    ROW_NUMBER() OVER (PARTITION BY item_type, def_id, currency_type ORDER BY cost) AS rn,
                    COUNT(*) OVER (PARTITION BY item_type, def_id, currency_type) AS cnt
             FROM price_observations)
       WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
       GROUP BY item_type, def_id, currency_type`
    ).all();
    const medianBy = new Map();
    for (const m of medianRows) medianBy.set(`${m.item_type}:${m.def_id}:${m.currency_type}`, m.median_cost);
    const sellerRows = this.db.prepare(
      `SELECT owner_name,
              COUNT(*) AS observations,
              COUNT(DISTINCT item_type || ':' || def_id) AS items,
              MAX(scraped_at) AS last_seen
       FROM price_observations
       GROUP BY owner_name`
    ).all();

    const insStat = this.db.prepare(
      'INSERT INTO item_stats (item_type, def_id, currency_type, observations, sellers, min_cost, max_cost, avg_cost, median_cost, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insColor = this.db.prepare(
      'INSERT INTO item_color_stats (item_type, def_id, color, currency_type, observations, sellers, min_cost, max_cost, avg_cost, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insSeller = this.db.prepare(
      'INSERT INTO seller_stats (owner_name, observations, items, last_seen) VALUES (?, ?, ?, ?)'
    );
    const setMeta = this.db.prepare(
      'INSERT INTO stats_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM item_stats');
      this.db.exec('DELETE FROM item_color_stats');
      this.db.exec('DELETE FROM seller_stats');
      for (const r of statRows) {
        insStat.run(r.item_type, r.def_id, r.currency_type, r.observations, r.sellers, r.min_cost, r.max_cost, r.avg_cost, medianBy.get(`${r.item_type}:${r.def_id}:${r.currency_type}`) ?? null, r.last_seen);
      }
      for (const r of colorRows) {
        insColor.run(r.item_type, r.def_id, r.color, r.currency_type, r.observations, r.sellers, r.min_cost, r.max_cost, r.avg_cost, r.last_seen);
      }
      for (const r of sellerRows) {
        insSeller.run(r.owner_name, r.observations, r.items, r.last_seen);
      }
      setMeta.run('rolled_at', now);
      setMeta.run('last_obs_id', maxId);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { items: statRows.length, colors: colorRows.length, sellers: sellerRows.length, rolledAt: now, lastObsId: maxId };
  }

  ensureStats(maxAgeMs = STATS_TTL_MS) {
    let rolledAt = 0;
    let lastObsId = 0;
    for (const r of this.db.prepare('SELECT key, value FROM stats_meta').all()) {
      if (r.key === 'rolled_at') rolledAt = r.value;
      else if (r.key === 'last_obs_id') lastObsId = r.value;
    }
    if (rolledAt === 0) return this.rollupStats();
    const maxId = (this._maxObsId.get() || {}).m || 0;
    if (maxId === lastObsId) return null;
    if (Date.now() - rolledAt < maxAgeMs) return null;
    return this.rollupStats();
  }

  archiveAndPrune({ days = 90, dryRun = true, vacuum = false } = {}) {
    const cutoff = Date.now() - Math.max(1, Number(days) || 90) * 86400000;
    const candidate = this.db.prepare('SELECT COUNT(*) AS n, MIN(scraped_at) AS oldest FROM price_observations WHERE scraped_at < ?').get(cutoff);
    const total = (this._countObs.get() || {}).n || 0;
    const result = { days: Number(days) || 90, cutoff, total, wouldDelete: candidate.n || 0, oldest: candidate.oldest || null, dryRun: !!dryRun };
    if (dryRun || result.wouldDelete === 0) return result;

    const archive = this.db.prepare(
      `INSERT INTO daily_rollup (day, item_type, def_id, color, currency_type, observations, sellers, min_cost, max_cost, sum_cost, last_seen)
       SELECT scraped_at / 86400000 AS day, item_type, def_id, color, currency_type,
              COUNT(*), COUNT(DISTINCT owner_name), MIN(cost), MAX(cost), SUM(cost), MAX(scraped_at)
       FROM price_observations
       WHERE scraped_at < ?
       GROUP BY day, item_type, def_id, color, currency_type
       ON CONFLICT(day, item_type, def_id, color, currency_type) DO UPDATE SET
         observations = observations + excluded.observations,
         sellers = sellers + excluded.sellers,
         min_cost = MIN(min_cost, excluded.min_cost),
         max_cost = MAX(max_cost, excluded.max_cost),
         sum_cost = sum_cost + excluded.sum_cost,
         last_seen = MAX(last_seen, excluded.last_seen)`
    );
    const prune = this.db.prepare('DELETE FROM price_observations WHERE scraped_at < ?');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      archive.run(cutoff);
      const del = prune.run(cutoff);
      result.deleted = del.changes;
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.rollupStats();
    if (vacuum) this.db.exec('VACUUM');
    return result;
  }

  distinctItemColors() {
    this.ensureStats();
    return this.db.prepare('SELECT item_type, def_id, color, SUM(observations) AS n FROM item_color_stats WHERE color IS NOT NULL AND color != 0 GROUP BY item_type, def_id, color').all();
  }

  topObservedItems(limit = 400) {
    this.ensureStats();
    return this.db.prepare(
      `SELECT s.item_type, s.def_id,
              COALESCE(di.name, 'def ' || s.def_id) AS name,
              SUM(s.observations) AS observations
       FROM item_stats s
       LEFT JOIN item_definitions di ON di.item_type = s.item_type AND di.def_id = s.def_id
       GROUP BY s.item_type, s.def_id
       ORDER BY observations DESC
       LIMIT ?`
    ).all(limit);
  }

  recordTradeList(owner, items) {
    const del = this.db.prepare('DELETE FROM tradelist_items WHERE owner_name = ?');
    const ins = this.db.prepare(
      'INSERT INTO tradelist_items (owner_name, item_type, def_id, field2, color, pet_appearance, scraped_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const now = Date.now();
    const run = () => {
      del.run(owner);
      for (const it of items || []) ins.run(owner, it.itemType == null ? null : it.itemType, it.defId, it.field2 == null ? null : it.field2, it.color == null ? null : it.color, it.petAppearance == null ? null : it.petAppearance, now);
    };
    if (this.db.transaction) this.db.transaction(run)(); else run();
    return (items || []).length;
  }

  tradeListFor(owner) {
    return this.db.prepare('SELECT item_type, def_id, field2, color, pet_appearance, scraped_at FROM tradelist_items WHERE owner_name = ? ORDER BY item_type, def_id').all(owner);
  }

  tradeListHolders(itemType, defId) {
    return this.db.prepare('SELECT DISTINCT owner_name FROM tradelist_items WHERE item_type = ? AND def_id = ? ORDER BY scraped_at DESC').all(itemType, defId).map((r) => r.owner_name);
  }

  tradeListTotals() {
    return this.db.prepare('SELECT COUNT(*) AS items, COUNT(DISTINCT owner_name) AS owners FROM tradelist_items').get();
  }

  tradeListItems(limit = 20000) {
    return this.db.prepare(
      `SELECT t.item_type, t.def_id,
              COALESCE(di.name, 'def ' || t.def_id) AS name,
              COUNT(DISTINCT t.owner_name) AS holders
       FROM tradelist_items t
       LEFT JOIN item_definitions di ON di.item_type = t.item_type AND di.def_id = t.def_id
       GROUP BY t.item_type, t.def_id
       ORDER BY holders DESC
       LIMIT ?`
    ).all(limit);
  }

  itemColorNames(itemType, defId) {
    return this.db.prepare(
      'SELECT DISTINCT color FROM price_observations WHERE item_type = ? AND def_id = ? AND color IS NOT NULL'
    ).all(itemType, defId).map((r) => r.color);
  }

  tradeListOwners(limit = 100) {
    return this.db.prepare(`SELECT owner_name,
        COUNT(*) AS items,
        SUM(CASE WHEN item_type = 2 THEN 1 ELSE 0 END) AS clothing,
        SUM(CASE WHEN item_type = 0 THEN 1 ELSE 0 END) AS den,
        SUM(CASE WHEN item_type = 1 THEN 1 ELSE 0 END) AS pet,
        MAX(scraped_at) AS last_captured
      FROM tradelist_items GROUP BY owner_name ORDER BY last_captured DESC LIMIT ?`).all(limit);
  }

  sellerPresence(name) {
    const row = this.db.prepare('SELECT is_live, last_seen FROM usernames WHERE name = ?').get(name);
    if (!row) return null;
    return { isLive: !!row.is_live, lastSeen: row.last_seen || null };
  }

  wikiStats() {
    return {
      items: this.db.prepare('SELECT COUNT(*) n FROM wiki_items').get().n,
      withImages: this.db.prepare('SELECT COUNT(*) n FROM wiki_items WHERE images_json IS NOT NULL').get().n
    };
  }

  searchSellers({ q = '', limit = 50, sort = 'recent' } = {}) {
    this.ensureStats();
    const orderBy = sort === 'items' ? 'items DESC, observations DESC' : 'last_seen DESC';
    const where = q ? 'WHERE ss.owner_name LIKE ?' : '';
    const params = q ? [`%${q}%`] : [];
    const sql = `SELECT ss.owner_name,
                        ss.observations,
                        ss.items,
                        ss.last_seen
                 FROM seller_stats ss
                 ${where}
                 ORDER BY ${orderBy}
                 LIMIT ?`;
    params.push(Math.min(Number(limit) || 50, 500));
    return this.db.prepare(sql).all(...params);
  }

  sellerInventory(ownerName, limit = 200) {
    return this._sellerInventory.all(ownerName, Math.min(Number(limit) || 200, 500));
  }

  currencySplit() {
    this.ensureStats();
    return this._currencySplit.all();
  }

  priceSeries(itemType, defId, currencyType, sinceMs = 0) {
    return this._priceSeries.all(itemType, defId, currencyType, sinceMs);
  }

  observationsOverTime(sinceMs = 0) {
    return this._obsOverTime.all(sinceMs).map((r) => r.scraped_at);
  }

  sampleByCurrency(currencyType, limit = 10) {
    return this._sampleByCurrency.all(currencyType, Math.min(Number(limit) || 10, 100));
  }

  maxObsId() {
    return this._maxObsId.get().m || 0;
  }

  addWatch({ kind, itemType = null, defId = null, ownerName = null, currencyType = null, maxCost = null, label = null } = {}) {
    const seen = this.maxObsId();
    const res = this._addWatch.run(
      kind,
      itemType == null ? null : Number(itemType),
      defId == null ? null : Number(defId),
      ownerName,
      currencyType == null ? null : Number(currencyType),
      maxCost == null ? null : Number(maxCost),
      label,
      Date.now(),
      seen
    );
    return this._getWatch.get(res.lastInsertRowid);
  }

  removeWatch(id) {
    this._removeWatch.run(Number(id));
  }

  listWatches() {
    return this._listWatches.all();
  }

  markWatchesSeen(id = null) {
    const seen = this.maxObsId();
    if (id == null) this._markAllWatchesSeen.run(seen);
    else this._markWatchSeen.run(seen, Number(id));
  }

  watchAlerts(limit = 100) {
    const perWatch = Math.min(Number(limit) || 100, 200);
    const alerts = [];
    for (const w of this._listWatches.all()) {
      const rows = w.kind === 'seller'
        ? this._sellerWatchMatches.all(w.last_seen_id, w.owner_name, perWatch)
        : this._itemWatchMatches.all(
            w.last_seen_id, w.item_type, w.def_id,
            w.currency_type, w.currency_type,
            w.max_cost, w.max_cost,
            perWatch
          );
      for (const r of rows) {
        alerts.push({ watchId: w.id, kind: w.kind, label: w.label, row: r });
      }
    }
    alerts.sort((a, b) => b.row.scraped_at - a.row.scraped_at);
    return alerts.slice(0, perWatch);
  }

  stats() {
    return {
      usernames: this._countUsernames.get().n,
      queued: this._countQueued.get().n,
      live: this._countLive.get().n,
      livePool: this._countLivePool.get().n,
      deadPool: this._countDeadPool.get().n,
      sellers: this._countSellers.get().n,
      emptyDens: this._countEmptyDens.get().n,
      densScraped: this._countDens.get().n,
      observations: this._countObs.get().n,
      itemDefinitions: this._countDefs.get().n
    };
  }

  searchUsernames({ q = '', filter = 'all', limit = 100 } = {}) {
    const where = [];
    const params = [];
    if (q) { where.push('name LIKE ?'); params.push(`%${q}%`); }
    if (filter === 'live') where.push('is_live = 1');
    else if (filter === 'dead') where.push('is_live = 0');
    else if (filter === 'scraped') where.push('scraped = 1');
    else if (filter === 'unscraped') where.push('scraped = 0');
    else if (filter === 'sellers') where.push('name IN (SELECT DISTINCT owner_name FROM price_observations)');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT name, source, first_seen, last_seen, scraped, is_live
                 FROM usernames ${clause}
                 ORDER BY (last_seen IS NULL), last_seen DESC, first_seen DESC
                 LIMIT ?`;
    params.push(Math.min(Number(limit) || 100, 500));
    return this.db.prepare(sql).all(...params);
  }

  close() {
    try { this.db.close(); } catch {}
  }
}

module.exports = Database;
