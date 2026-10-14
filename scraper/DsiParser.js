const TRAILING_FIELDS = { 0: 5, 1: 9, 2: 1 };

function parseDsi(input) {
  const parts = Array.isArray(input) ? input : String(input).split('%');
  if (parts[1] !== 'xt' || parts[2] !== 'dsi') {
    return { ok: false, reason: 'not_dsi', items: [] };
  }
  const at = (k) => parts[2 + k];
  let i = 3;
  const numItems = parseInt(at(i++), 10);
  if (!Number.isFinite(numItems) || numItems <= -1) {
    return { ok: true, empty: true, shopState: '', items: [] };
  }
  const shopState = at(i++);
  const items = [];
  for (let n = 0; n < numItems; n++) {
    if (2 + i + 5 > parts.length) {
      return { ok: false, truncated: true, shopState, items };
    }
    const currencyType = parseInt(at(i++), 10);
    const cost = parseInt(at(i++), 10);
    const itemType = parseInt(at(i++), 10);
    const invIdx = parseInt(at(i++), 10);
    const defId = parseInt(at(i++), 10);
    const trailingCount = TRAILING_FIELDS[itemType];
    if (trailingCount === undefined) {
      return { ok: false, badType: itemType, shopState, items };
    }
    const trailing = [];
    for (let t = 0; t < trailingCount; t++) trailing.push(at(i++));
    const color = colorFrom(itemType, trailing);
    const petAppearance = petAppearanceFrom(itemType, trailing);
    items.push({ currencyType, cost, itemType, invIdx, defId, color, petAppearance, trailing });
  }
  return { ok: true, empty: false, shopState, items };
}

function colorFrom(itemType, trailing) {
  if (itemType !== 2) return null;
  const value = parseInt(trailing[0], 10);
  return Number.isFinite(value) ? value : null;
}

function petAppearanceFrom(itemType, trailing) {
  if (itemType !== 1) return null;
  const piped = trailing.find((f) => typeof f === 'string' && /^\d+\|\d+$/.test(f));
  return piped || null;
}

module.exports = { parseDsi };
