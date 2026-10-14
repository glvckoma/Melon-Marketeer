const Database = require('../db/Database.js');
const { parseTradeValue } = require('../items/tradeValue.js');

function recompute(db, source = 'aj-item-worth') {
  const rows = db.wikiItemsForRecompute(source);
  const stats = { total: rows.length, parsed: 0, instore: 0, unknown: 0 };
  for (const row of rows) {
    const tv = parseTradeValue(row.worth_text);
    db.setWikiTradeValue(row.title, tv, source);
    stats[tv.basis] = (stats[tv.basis] || 0) + 1;
  }
  return stats;
}

if (require.main === module) {
  const db = new Database();
  const source = process.argv[2] || 'aj-item-worth';
  const stats = recompute(db, source);
  console.log(`recomputed trade values for ${stats.total} ${source} wiki rows: ${stats.parsed} parsed, ${stats.instore} in-store, ${stats.unknown} unvalued`);
}

module.exports = { recompute };
