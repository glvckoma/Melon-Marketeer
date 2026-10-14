const { normalizeName } = require('./wikiName.js');

const QUALIFIERS = new Set(['rare', 'long', 'short', 'the', 'of', 'a', 'an', 'aj', 'pet']);
const COLOR_WORDS = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'purple', 'pink', 'orange',
  'brown', 'gray', 'grey', 'gold', 'silver', 'rainbow', 'cyan', 'magenta'
]);

const WIKI_OVERRIDES = [
  { itemType: 2, defId: 634, title: 'Diamond Long Spiked Collars' },
  { itemType: 2, defId: 1212, title: 'Diamond Short Spiked Collars' }
];

const WIKI_IMAGE_OVERRIDES = [
  { itemType: 2, defId: 634, title: 'Rare Long Spiked Collar' },
  { itemType: 2, defId: 1212, title: 'Rare Short Spiked Collar' }
];

function coreTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t && !QUALIFIERS.has(t) && !COLOR_WORDS.has(t));
}

function confidenceFor(itemCoreCount, extra) {
  if (extra === 0) return 'high';
  if (itemCoreCount >= 2 && extra === 1) return 'medium';
  return null;
}

function lengthOf(name) {
  const n = String(name).toLowerCase();
  if (/\blong\b/.test(n)) return 'long';
  if (/\bshort\b/.test(n)) return 'short';
  return null;
}

function bestMatch(defName, wikiCores) {
  const dc = coreTokens(defName);
  if (!dc.length) return null;
  const dset = new Set(dc);
  const noun = dc[dc.length - 1];
  const itemLen = lengthOf(defName);
  let best = null;
  for (const entry of wikiCores) {
    const wset = entry.core;
    if (!wset.has(noun)) continue;
    let contained = true;
    for (const t of dset) { if (!wset.has(t)) { contained = false; break; } }
    if (!contained) continue;
    const extra = wset.size - dset.size;
    let penalty = 0;
    if (itemLen) {
      const cl = lengthOf(entry.title);
      penalty = cl === itemLen ? 0 : (cl ? 2 : 1);
    }
    const rawLen = normalizeName(entry.title).split(' ').filter(Boolean).length;
    const better = !best
      || extra < best.extra
      || (extra === best.extra && penalty < best.penalty)
      || (extra === best.extra && penalty === best.penalty && rawLen < best.rawLen);
    if (better) best = { title: entry.title, extra, penalty, rawLen };
  }
  if (!best) return null;
  const confidence = confidenceFor(dc.length, best.extra);
  if (!confidence) return null;
  return { title: best.title, extra: best.extra, confidence };
}

module.exports = { coreTokens, bestMatch, confidenceFor, QUALIFIERS, COLOR_WORDS, WIKI_OVERRIDES, WIKI_IMAGE_OVERRIDES };
