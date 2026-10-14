function parseDenState(input, specialTypeOf) {
  const parts = Array.isArray(input) ? input : String(input).split('%');
  if (parts[1] !== 'xt' || parts[2] !== 'ds') {
    return { ok: false, reason: 'not_ds', shopInvIdxs: [], denItems: [], portals: [] };
  }
  const at = (k) => parts[2 + k];
  let i = 2;
  const numDenItems = parseInt(at(i++), 10);
  const numPets = parseInt(at(i++), 10);
  i++;
  const shopInvIdxs = [];
  const denItems = [];
  const portals = [];
  let truncated = false;
  if (Number.isFinite(numDenItems)) {
    for (let n = 0; n < numDenItems; n++) {
      if (2 + i + 2 > parts.length) { truncated = true; break; }
      const invIdx = parseInt(at(i++), 10);
      const defId = parseInt(at(i++), 10);
      if (!Number.isFinite(invIdx) || !Number.isFinite(defId)) { truncated = true; break; }
      const st = specialTypeOf(defId);
      if (st === 4) { truncated = true; break; }
      if (2 + i + 10 > parts.length) { truncated = true; break; }
      const x = parseInt(at(i + 1), 10);
      const y = parseInt(at(i + 2), 10);
      const rawName = at(i + 5);
      i += 10;
      denItems.push({ invIdx, defId, known: st !== undefined });
      if (st === 5) shopInvIdxs.push(invIdx);
      if (st === 1) {
        const name = (rawName == null || rawName === '' || rawName === 'null') ? null : rawName;
        portals.push({ invIdx, defId, x, y, name });
      }
    }
  }
  return { ok: true, numDenItems, numPets, shopInvIdxs, denItems, portals, truncated };
}

module.exports = { parseDenState };
