const Database = require('../db/Database.js');

if (require.main === module) {
  const db = new Database();
  const start = Date.now();
  const r = db.rollupStats();
  console.log('Materialized stats rebuilt in', Date.now() - start, 'ms');
  console.log('  item_stats rows  :', r.items);
  console.log('  color_stats rows :', r.colors);
  console.log('  seller_stats rows:', r.sellers);
  console.log('  last_obs_id      :', r.lastObsId);
}
