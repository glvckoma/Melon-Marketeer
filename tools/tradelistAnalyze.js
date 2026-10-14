const NameResolver = require('../defpacks/NameResolver.js');
const { readAnomalies } = require('../scraper/AnomalyLog.js');
const { parseTradeList } = require('../scraper/TradeListParser.js');
const { resolveColor } = require('../items/Color.js');

const ownerFilter = process.argv[2] ? process.argv[2].toLowerCase() : null;

const resolver = new NameResolver().load();

function packsFor(defId) {
  const id = String(defId);
  const hits = [];
  if (resolver.den[id]) hits.push({ itemType: 0, label: 'den', name: resolver.resolve(0, defId).name });
  if (resolver.clothing[id]) hits.push({ itemType: 2, label: 'clothing', name: resolver.resolve(2, defId).name });
  if (resolver.pets[id]) hits.push({ itemType: 1, label: 'pet', name: resolver.resolve(1, defId).name });
  return hits;
}

function colorUnder(raw, directIndex) {
  const c = resolveColor(raw, { directIndex });
  return c ? c.hexColor : 'null';
}

const captures = readAnomalies(1000)
  .filter((a) => a.kind === 'tradelist_capture')
  .filter((a) => !ownerFilter || String(a.owner || '').toLowerCase() === ownerFilter);

if (!captures.length) {
  console.log('No tradelist_capture anomalies found. Run WS `tradelist <user>` with a bot online first.');
  process.exit(0);
}

console.log(`defpack version ${resolver.version} | ${captures.length} capture(s)\n`);

const field2Values = new Map();
let ambiguous = 0;
let unknown = 0;

for (const cap of captures) {
  const parsed = parseTradeList(String(cap.raw).split('%'));
  if (!parsed) { console.log(`! unparseable capture for ${cap.owner}`); continue; }
  console.log(`=== ${parsed.owner} | count ${parsed.count} | ${parsed.items.length} parsed ===`);
  for (const it of parsed.items) {
    const hits = packsFor(it.defId);
    field2Values.set(it.field2, (field2Values.get(it.field2) || 0) + 1);
    if (hits.length === 0) unknown += 1;
    else if (hits.length > 1) ambiguous += 1;
    const f2 = it.field2;
    const f2hex = (f2 >>> 0).toString(16);
    const membership = hits.length ? hits.map((h) => `${h.label}:${h.name || '?'}`).join(' | ') : 'NONE';
    console.log(
      `  def ${String(it.defId).padEnd(6)} field2 ${String(f2).padStart(4)} (0x${f2hex}, bit7=${(f2 >> 7) & 1}, low=${f2 & 0x7f}) ` +
      `color den=${colorUnder(it.color, true)} clothing=${colorUnder(it.color, false)}  -> ${membership}`
    );
  }
  console.log('');
}

console.log('--- field2 value distribution ---');
[...field2Values.entries()].sort((a, b) => a[0] - b[0]).forEach(([v, n]) => {
  console.log(`  ${String(v).padStart(4)} (0x${(v >>> 0).toString(16)}): ${n}`);
});
console.log(`\nitems ambiguous across packs: ${ambiguous} | unknown defId: ${unknown}`);
console.log('If single-pack membership covers every item, defpack lookup alone derives itemType.');
console.log('If ambiguous > 0, inspect whether field2 (bit7 / low7) separates the colliding types.');
