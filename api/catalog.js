function obsOf(obsMap, it) {
  if (!obsMap) return 0;
  const key = it.itemType + ':' + it.defId;
  const v = typeof obsMap.get === 'function' ? obsMap.get(key) : obsMap[key];
  return Number(v) || 0;
}

function canonicalizeByName(items, obsMap) {
  const reps = new Map();
  const order = [];
  for (const it of items || []) {
    const withObs = { itemType: it.itemType, defId: it.defId, name: it.name, obs: obsOf(obsMap, it) };
    const key = String(it.name || '').trim().toLowerCase();
    if (!key) { order.push({ key: null, item: withObs }); continue; }
    const cur = reps.get(key);
    if (!cur) { reps.set(key, withObs); order.push({ key, item: null }); continue; }
    const better = withObs.obs > cur.obs || (withObs.obs === cur.obs && withObs.defId < cur.defId);
    if (better) reps.set(key, withObs);
  }
  return order.map((o) => (o.key == null ? o.item : reps.get(o.key)));
}

function buildCatalog(resolver, obsMap = null) {
  const items = [];
  try {
    for (const it of resolver.all()) {
      if (it && it.name) items.push({ itemType: it.itemType, defId: it.defId, name: it.name });
    }
  } catch {}
  return obsMap ? canonicalizeByName(items, obsMap) : items;
}

function searchCatalog(catalog, q, limit = 12) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return [];
  const tokens = query.split(/\s+/).filter(Boolean);
  const matches = [];
  for (const it of catalog) {
    const name = it.name.toLowerCase();
    let earliest = Infinity;
    let ok = true;
    for (const t of tokens) {
      const i = name.indexOf(t);
      if (i < 0) { ok = false; break; }
      if (i < earliest) earliest = i;
    }
    if (ok) matches.push({ it, prefix: name.startsWith(tokens[0]) ? 0 : 1, earliest });
  }
  matches.sort((a, b) =>
    (a.prefix - b.prefix) ||
    (a.earliest - b.earliest) ||
    ((b.it.obs || 0) - (a.it.obs || 0)) ||
    (a.it.name.length - b.it.name.length) ||
    a.it.name.localeCompare(b.it.name));
  return matches.slice(0, Math.min(Math.max(1, limit), 25)).map((m) => m.it);
}

module.exports = { buildCatalog, searchCatalog, canonicalizeByName };
