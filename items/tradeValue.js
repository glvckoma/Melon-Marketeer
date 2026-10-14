const UNIT = 'black-long';
const AFEW = 3;

const SPIKE_BASE = {
  'long collar': 0.5,
  'long wrist': 0.3,
  'short collar': 0.28,
  'short wrist': 0.18
};

const GRADE_MULT = { bad: 0.55, decent: 0.78, good: 1.0, red: 1.3, black: 2.0 };

const FLAT = {
  headdress: 8,
  founder: 6,
  tiki: 5,
  beta: 0.05,
  'clothing beta': 0.03,
  'den beta': 0.035,
  rim: 0.008,
  den: 0.02
};

const DENOM_LABEL = {
  'long collar': 'Long Collar',
  'short collar': 'Short Collar',
  'long wrist': 'Long Wrist',
  'short wrist': 'Short Wrist',
  headdress: 'Headdress',
  founder: 'Founder Hat',
  tiki: 'Tiki Mask',
  beta: 'Beta',
  'clothing beta': 'Clothing Beta',
  'den beta': 'Den Beta',
  rim: 'RIM',
  den: 'Den Item'
};

function round(v, places = 2) {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function isSpike(key) {
  return key.endsWith('collar') || key.endsWith('wrist');
}

function perItemValue(key, grade) {
  if (key == null) return null;
  if (SPIKE_BASE[key] != null) return round(SPIKE_BASE[key] * GRADE_MULT[grade || 'decent'], 4);
  return FLAT[key] != null ? FLAT[key] : null;
}

function denomDisplay(key, grade) {
  const base = DENOM_LABEL[key] || key;
  const prefix = isSpike(key) && grade ? cap(grade) + ' ' : '';
  return prefix + base;
}

function formatTradeValue(value) {
  if (value == null) return null;
  if (value >= 0.5) {
    const n = round(value, 2);
    return `≈ ${n} Black Long${n === 1 ? '' : 's'}`;
  }
  const betas = Math.max(1, Math.round(value / FLAT['den beta']));
  return `≈ ${betas} Den Beta${betas === 1 ? '' : 's'}`;
}

function matchDenom(phrase) {
  const p = ' ' + phrase + ' ';
  let grade = null;
  if (/\bblack\b|\bsolid\b/.test(p)) grade = 'black';
  else if (/\bred\b/.test(p)) grade = 'red';
  else if (/\bgood\b/.test(p)) grade = 'good';
  else if (/\bdecent\b/.test(p)) grade = 'decent';
  else if (/\bbad\b/.test(p)) grade = 'bad';
  let denomKey = null;
  const isCollar = /\bcollars?\b/.test(p);
  const isWrist = /\bwrist(?:band)?s?\b/.test(p);
  if (/\bheaddress(?:es)?\b/.test(p)) denomKey = 'headdress';
  else if (/\bfounder\b/.test(p)) denomKey = 'founder';
  else if (/\b(?:tan tiki|tiki)\b/.test(p)) denomKey = 'tiki';
  else if (isCollar || isWrist) {
    const len = /\bshort\b/.test(p) ? 'short' : 'long';
    denomKey = len + ' ' + (isCollar ? 'collar' : 'wrist');
  } else if (/\bclothing betas?\b/.test(p)) denomKey = 'clothing beta';
  else if (/\bden betas?\b/.test(p)) denomKey = 'den beta';
  else if (/\brims?\b|rare item monday/.test(p)) denomKey = 'rim';
  else if (/\bbetas?\b/.test(p)) denomKey = 'beta';
  else if (/\bdens?\b/.test(p)) denomKey = 'den';
  return { grade, denomKey };
}

function parseUnitSeg(seg) {
  const s = seg.trim();
  if (!s) return null;
  let count = [1, 1];
  let countText = null;
  let rest = s;
  let m;
  if ((m = rest.match(/^a few\s+(.*)$/))) { count = [AFEW, AFEW]; countText = 'a few'; rest = m[1]; }
  else if ((m = rest.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+(.*)$/))) { count = [parseFloat(m[1]), parseFloat(m[2])]; countText = `${m[1]}-${m[2]}`; rest = m[3]; }
  else if ((m = rest.match(/^(\d+(?:\.\d+)?)\s+(.*)$/))) { count = [parseFloat(m[1]), parseFloat(m[1])]; countText = m[1]; rest = m[2]; }
  else if (/^\d+(?:\.\d+)?$/.test(rest)) { return { value: null, denomKey: null, grade: null, mid: 1, display: null }; }
  const { grade, denomKey } = matchDenom(rest);
  if (denomKey == null && grade == null) return null;
  const mid = (count[0] + count[1]) / 2;
  const per = perItemValue(denomKey, grade);
  const display = denomKey != null && countText && countText.indexOf('-') >= 0
    ? `${countText} ${denomDisplay(denomKey, grade)}s`
    : null;
  return { value: per != null ? round(mid * per, 4) : null, denomKey, grade, mid, display };
}

function inheritDenoms(segs) {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s || s.value != null || !s.grade || s.denomKey != null) continue;
    let key = null;
    for (let j = i + 1; j < segs.length && !key; j++) if (segs[j] && segs[j].denomKey) key = segs[j].denomKey;
    for (let j = i - 1; j >= 0 && !key; j--) if (segs[j] && segs[j].denomKey) key = segs[j].denomKey;
    if (key) { s.denomKey = key; s.value = round(s.mid * perItemValue(key, s.grade), 4); }
  }
}

function combine(values) {
  const nums = values.filter((v) => v != null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseAlt(alt) {
  const segs = alt.split(/\s+-\s+/).map(parseUnitSeg).filter(Boolean);
  inheritDenoms(segs);
  const value = combine(segs.map((s) => s.value));
  if (value == null) return null;
  const display = segs.length === 1 && segs[0].display ? segs[0].display : null;
  return { value, display };
}

function parseClause(clause) {
  if (/\bin stores?\b/.test(clause) || /^not much$/.test(clause)) return { value: null, display: null, basis: 'instore' };
  const t = clause
    .replace(/[,;]\s*(?:maybe|sometimes)\s+(?:more|less)\b.*$/g, '')
    .replace(/\b(?:maybe|sometimes)\s+(?:more|less)\b/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim();
  if (!t) return { value: null, display: null, basis: 'unknown' };
  const alts = t.split(/\s+or\s+/).map((a) => a.trim()).filter(Boolean).map(parseAlt).filter(Boolean);
  if (!alts.length) return { value: null, display: null, basis: 'unknown' };
  const value = combine(alts.map((a) => a.value));
  const display = alts.find((a) => a.display);
  return { value, display: display ? display.display : null, basis: 'parsed' };
}

function parseTradeValue(text) {
  const raw = text == null ? '' : String(text);
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, display: null, unit: UNIT, basis: 'unknown', raw };
  const t = trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
  const clauses = t.split(/;/).map((c) => c.trim()).filter(Boolean).map(parseClause);
  const parsed = clauses.filter((c) => c.value != null);
  if (parsed.length) {
    const value = round(combine(parsed.map((c) => c.value)), 2);
    const withDisplay = parsed.find((c) => c.display);
    return { value, display: withDisplay ? withDisplay.display : formatTradeValue(value), unit: UNIT, basis: 'parsed', raw };
  }
  if (clauses.some((c) => c.basis === 'instore')) return { value: null, display: null, unit: UNIT, basis: 'instore', raw };
  return { value: null, display: null, unit: UNIT, basis: 'unknown', raw };
}

module.exports = { parseTradeValue, formatTradeValue, perItemValue, combine, UNIT };
