const Database = require('../db/Database.js');
const { coreTokens, bestMatch, WIKI_OVERRIDES } = require('../items/wikiMatch.js');

const MAX_EXTRA = Number(process.env.WIKI_MAX_EXTRA || 2);

function buildMatches(db) {
  db.db.prepare("DELETE FROM item_wiki WHERE confidence IN ('high', 'medium', 'low')").run();
  for (const o of WIKI_OVERRIDES) db.setItemWiki(o.itemType, o.defId, o.title, 'manual', 'aj-item-worth');
  const preserved = new Set(db.db.prepare('SELECT item_type, def_id FROM item_wiki').all().map((r) => r.item_type + ':' + r.def_id));
  const wikiCores = db.allWikiTitles('aj-item-worth').map((title) => ({ title, core: new Set(coreTokens(title)) }));
  const items = db.db.prepare('SELECT item_type, def_id, name FROM item_definitions WHERE name IS NOT NULL').all();
  let matched = 0;
  let exact = 0;
  const byConfidence = { high: 0, medium: 0, low: 0 };
  for (const it of items) {
    if (preserved.has(it.item_type + ':' + it.def_id)) continue;
    if (db.wikiByName(it.name, 'aj-item-worth')) { exact += 1; continue; }
    const m = bestMatch(it.name, wikiCores);
    if (m && m.extra <= MAX_EXTRA) {
      db.setItemWiki(it.item_type, it.def_id, m.title, m.confidence, 'aj-item-worth');
      byConfidence[m.confidence] += 1;
      matched += 1;
    }
  }
  return { items: items.length, exact, fuzzyMatched: matched, preserved: preserved.size, byConfidence };
}

if (require.main === module) {
  const db = new Database();
  console.log('Building item -> wiki matches (MAX_EXTRA=' + MAX_EXTRA + ')...');
  console.log('  ', JSON.stringify(buildMatches(db)));
  db.close();
}

module.exports = { buildMatches };
