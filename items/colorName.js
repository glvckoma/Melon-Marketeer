const NAMED = [
  ['Black', 0x111111], ['White', 0xf5f5f5], ['Gray', 0x9aa0a6],
  ['Red', 0xe22b2b], ['Orange', 0xf08a24], ['Yellow', 0xf2d61a], ['Green', 0x37b24d],
  ['Blue', 0x2b6fd6], ['Purple', 0x8b3fd1], ['Pink', 0xf06fb8], ['Brown', 0x7a4a22], ['Gold', 0xd4af37]
];

function toRgb(value) {
  let n;
  if (typeof value === 'number') n = value & 0xffffff;
  else {
    const m = String(value).match(/[0-9a-f]{6,8}/i);
    if (!m) return null;
    let hex = m[0];
    if (hex.length === 8) hex = hex.slice(2);
    n = parseInt(hex, 16);
  }
  return [n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function nearestColorName(value) {
  const rgb = toRgb(value);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (s < 0.15 || l > 0.95 || l < 0.06) {
    if (l < 0.18) return 'Black';
    if (l > 0.82) return 'White';
    return 'Gray';
  }
  if (h < 45 && l < 0.42 && s < 0.9) return 'Brown';
  if (h >= 25 && h < 50 && l < 0.7 && s < 0.45) return 'Brown';
  if (h < 15 || h >= 345) return 'Red';
  if (h < 40) return 'Orange';
  if (h < 66) return (l < 0.45 && s > 0.5) ? 'Gold' : 'Yellow';
  if (h < 170) return 'Green';
  if (h < 250) return 'Blue';
  if (h < 292) return 'Purple';
  return 'Pink';
}

const SYNONYMS = {
  grey: 'gray', silver: 'gray',
  magenta: 'pink', fuchsia: 'pink', rose: 'pink', salmon: 'pink', coral: 'pink',
  cyan: 'blue', teal: 'blue', navy: 'blue', aqua: 'blue', turquoise: 'blue', sky: 'blue',
  tan: 'brown', beige: 'brown', bronze: 'brown', chocolate: 'brown',
  cream: 'white', ivory: 'white',
  lime: 'green', mint: 'green', olive: 'green', emerald: 'green',
  maroon: 'red', crimson: 'red', scarlet: 'red',
  violet: 'purple', lavender: 'purple', indigo: 'purple', plum: 'purple', lilac: 'purple',
  golden: 'gold', amber: 'gold'
};

const QUALIFIERS = new Set(['dark', 'light', 'deep', 'pale', 'bright', 'rare', 'rim', 'custom', 'default', 'neon', 'hot', 'baby', 'pastel']);

const COLOR_TOKENS = new Set([...NAMED.map(([n]) => n.toLowerCase()), ...Object.keys(SYNONYMS), 'rainbow']);

function canonicalColor(name) {
  if (!name) return null;
  const t = String(name).toLowerCase().trim();
  if (!t) return null;
  return SYNONYMS[t] || t;
}

function hexForColorName(name) {
  const canon = canonicalColor(name);
  if (!canon) return null;
  const cap = canon.charAt(0).toUpperCase() + canon.slice(1);
  const found = NAMED.find(([n]) => n === cap);
  return found ? '#' + found[1].toString(16).padStart(6, '0') : null;
}

function colorBucketFromLabel(label) {
  if (!label) return null;
  const tokens = String(label).toLowerCase().replace(/&amp;|&/g, ' ').split(/[^a-z]+/).filter(Boolean);
  for (const tok of tokens) {
    if (QUALIFIERS.has(tok)) continue;
    if (tok === 'rainbow') return 'Rainbow';
    if (COLOR_TOKENS.has(tok)) {
      const canon = SYNONYMS[tok] || tok;
      return canon.charAt(0).toUpperCase() + canon.slice(1);
    }
  }
  return null;
}

function isPureColorLabel(label) {
  if (!label) return false;
  const tokens = String(label).toLowerCase().replace(/&amp;|&/g, ' ').split(/[^a-z]+/).filter(Boolean);
  if (!tokens.length) return false;
  const isColor = (tok) => tok === 'rainbow' || COLOR_TOKENS.has(tok);
  if (isColor(tokens[tokens.length - 1])) return true;
  return tokens.every((tok) => isColor(tok) || QUALIFIERS.has(tok));
}

module.exports = { nearestColorName, hexForColorName, NAMED, canonicalColor, colorBucketFromLabel, isPureColorLabel };
