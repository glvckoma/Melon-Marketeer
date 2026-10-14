const Database = require('../db/Database.js');

function parseDays(argv) {
  const i = argv.indexOf('--days');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]) || 90;
  return 90;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const days = parseDays(argv);
  const apply = argv.includes('--apply');
  const vacuum = argv.includes('--vacuum');
  const db = new Database();
  const res = db.archiveAndPrune({ days, dryRun: !apply, vacuum });
  const fmt = (ms) => ms ? new Date(ms).toISOString().slice(0, 10) : 'n/a';
  console.log('Retention window :', res.days, 'days (cutoff', fmt(res.cutoff) + ')');
  console.log('Total observations:', res.total);
  console.log('Older than cutoff :', res.wouldDelete, '(oldest', fmt(res.oldest) + ')');
  if (res.dryRun) {
    console.log('\nDRY RUN - nothing deleted. Re-run with --apply to archive into daily_rollup and prune.');
    console.log('  node tools/retention.js --days', res.days, '--apply [--vacuum]');
  } else {
    console.log('\nArchived + deleted:', res.deleted, 'observations. Materialized stats rebuilt over the retained window.');
    if (vacuum) console.log('VACUUM complete.');
  }
}
