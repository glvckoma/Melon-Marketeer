const TIERS = [
  [/headdress/, 1000],
  [/founder/, 900],
  [/black long|solid long/, 850],
  [/\blongs?\b/, 700],
  [/\bbetas?\b/, 500],
  [/\brims?\b|rare item monday/, 450],
  [/collars?/, 350],
  [/wrists?/, 300],
  [/crown of woven|worn blanket|\bworn\b/, 250],
  [/\bdens?\b/, 200]
];

function worthScore(text) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  if (t.includes('in store')) return 0;
  let base = 0;
  for (const [re, w] of TIERS) if (re.test(t)) base = Math.max(base, w);
  if (base === 0) base = 60;
  if (/\bbad\b|\blow\b|common/.test(t)) base *= 0.6;
  else if (/\bgood\b|\bnice\b|\bgreat\b|decent/.test(t)) base *= 1.15;
  const m = t.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (m) { const n = Number(m[2] || m[1]) || 1; base *= 1 + Math.min(n, 10) * 0.08; }
  return Math.round(base);
}

module.exports = { worthScore };
