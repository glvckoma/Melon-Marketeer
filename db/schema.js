const SCHEMA = `
CREATE TABLE IF NOT EXISTS usernames (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  source TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  scraped INTEGER DEFAULT 0,
  is_live INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dens (
  owner_name TEXT PRIMARY KEY COLLATE NOCASE,
  shop_ids TEXT,
  item_count INTEGER,
  status TEXT,
  scraped_at INTEGER
);
CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY,
  owner_name TEXT COLLATE NOCASE,
  shop_id INTEGER,
  inv_idx INTEGER,
  def_id INTEGER,
  item_type INTEGER,
  cost INTEGER,
  currency_type INTEGER,
  color INTEGER,
  pet_appearance TEXT,
  shop_state TEXT,
  scraped_by TEXT,
  scraped_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_obs_def ON price_observations(def_id);
CREATE INDEX IF NOT EXISTS idx_obs_owner ON price_observations(owner_name);
CREATE INDEX IF NOT EXISTS idx_obs_item_cur ON price_observations(item_type, def_id, currency_type, cost);
CREATE INDEX IF NOT EXISTS idx_obs_owner_seen ON price_observations(owner_name, scraped_at);
CREATE INDEX IF NOT EXISTS idx_obs_recent ON price_observations(scraped_at DESC, cost DESC);
CREATE TABLE IF NOT EXISTS item_stats (
  item_type INTEGER,
  def_id INTEGER,
  currency_type INTEGER,
  observations INTEGER,
  sellers INTEGER,
  min_cost INTEGER,
  max_cost INTEGER,
  avg_cost INTEGER,
  median_cost INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (item_type, def_id, currency_type)
);
CREATE INDEX IF NOT EXISTS idx_item_stats_obs ON item_stats(observations DESC);
CREATE TABLE IF NOT EXISTS item_color_stats (
  item_type INTEGER,
  def_id INTEGER,
  color INTEGER,
  currency_type INTEGER,
  observations INTEGER,
  sellers INTEGER,
  min_cost INTEGER,
  max_cost INTEGER,
  avg_cost INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (item_type, def_id, color, currency_type)
);
CREATE TABLE IF NOT EXISTS seller_stats (
  owner_name TEXT PRIMARY KEY COLLATE NOCASE,
  observations INTEGER,
  items INTEGER,
  last_seen INTEGER
);
CREATE INDEX IF NOT EXISTS idx_seller_stats_seen ON seller_stats(last_seen DESC);
CREATE TABLE IF NOT EXISTS stats_meta (
  key TEXT PRIMARY KEY,
  value INTEGER
);
CREATE TABLE IF NOT EXISTS daily_rollup (
  day INTEGER,
  item_type INTEGER,
  def_id INTEGER,
  color INTEGER,
  currency_type INTEGER,
  observations INTEGER,
  sellers INTEGER,
  min_cost INTEGER,
  max_cost INTEGER,
  sum_cost INTEGER,
  last_seen INTEGER,
  PRIMARY KEY (day, item_type, def_id, color, currency_type)
);
CREATE TABLE IF NOT EXISTS item_definitions (
  item_type INTEGER,
  def_id INTEGER,
  name TEXT,
  abbr TEXT,
  PRIMARY KEY (item_type, def_id)
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY,
  kind TEXT,
  item_type INTEGER,
  def_id INTEGER,
  owner_name TEXT COLLATE NOCASE,
  currency_type INTEGER,
  max_cost INTEGER,
  label TEXT,
  created_at INTEGER,
  last_seen_id INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS priority_rescrape (
  owner_name TEXT PRIMARY KEY COLLATE NOCASE,
  requested_at INTEGER
);
CREATE TABLE IF NOT EXISTS wiki_items (
  source TEXT NOT NULL DEFAULT 'aj-item-worth',
  title TEXT COLLATE NOCASE,
  norm TEXT,
  url TEXT,
  worth_text TEXT,
  images_json TEXT,
  scraped_at INTEGER,
  PRIMARY KEY (source, title)
);
CREATE INDEX IF NOT EXISTS idx_wiki_norm ON wiki_items(norm);
CREATE TABLE IF NOT EXISTS item_wiki (
  item_type INTEGER,
  def_id INTEGER,
  wiki_title TEXT,
  confidence TEXT,
  source TEXT,
  PRIMARY KEY (item_type, def_id)
);
CREATE TABLE IF NOT EXISTS wiki_color_worth (
  source TEXT NOT NULL DEFAULT 'aj-item-worth',
  title TEXT COLLATE NOCASE,
  label TEXT,
  color TEXT,
  worth_text TEXT,
  trade_value REAL,
  trade_display TEXT,
  PRIMARY KEY (source, title, label)
);
CREATE INDEX IF NOT EXISTS idx_wiki_color_worth ON wiki_color_worth(source, title);
CREATE TABLE IF NOT EXISTS tradelist_items (
  owner_name TEXT COLLATE NOCASE,
  item_type INTEGER,
  def_id INTEGER,
  field2 INTEGER,
  color INTEGER,
  pet_appearance TEXT,
  scraped_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tl_def ON tradelist_items(item_type, def_id);
CREATE INDEX IF NOT EXISTS idx_tl_owner ON tradelist_items(owner_name);
`;

module.exports = { SCHEMA };
