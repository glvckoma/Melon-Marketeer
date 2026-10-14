const fs = require('fs');
const path = require('path');
const Database = require('../db/Database.js');
const { computeCoverage } = require('../items/Coverage.js');

if (require.main === module) {
  const db = new Database();
  const report = computeCoverage(db, { gapLimit: Number(process.argv[2]) || 500 });
  const s = report.summary;
  const pct = (n) => (s.observed ? (100 * n / s.observed).toFixed(1) : '0') + '%';
  console.log('Coverage over observed (in-shop) items:');
  console.log('  observed items :', s.observed);
  console.log('  with images    :', s.withImages, pct(s.withImages));
  console.log('  unsynced (matched, images not fetched yet):', s.unsynced, pct(s.unsynced));
  console.log('  no images on page (synced, none found)    :', s.noImagesOnPage, pct(s.noImagesOnPage));
  console.log('  UNMATCHED (no wiki link - the to-fix list):', s.unmatched, pct(s.unmatched));
  console.log('\nTop unmatched observed items (by times seen in shops):');
  report.unmatched.slice(0, 25).forEach((u) => console.log(`  ${String(u.obs).padStart(5)}  type=${u.itemType} def=${u.defId}  ${u.name}`));
  const out = path.resolve(__dirname, '..', 'data', 'coverage-gaps.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('\nFull lists written to', out);
  db.close();
}
