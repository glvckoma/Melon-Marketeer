const SECTIONS = [
  { itemType: 2, stride: 3, colorIdx: 2, petColorIdx: -1 },
  { itemType: 0, stride: 7, colorIdx: -1, petColorIdx: -1 },
  { itemType: 1, stride: 10, colorIdx: -1, petColorIdx: 6 }
];

function parseTradeList(parts) {
  const i = parts.indexOf('tl');
  if (i < 0 || parts.length < i + 4) return null;
  const roomId = parts[i + 1];
  const owner = parts[i + 2];
  let p = i + 3;
  const items = [];
  let sawCount = false;
  for (const sec of SECTIONS) {
    const count = parseInt(parts[p], 10);
    if (Number.isNaN(count)) break;
    sawCount = true;
    p += 1;
    for (let k = 0; k < count; k += 1) {
      const rec = parts.slice(p, p + sec.stride);
      const defId = parseInt(rec[0], 10);
      if (Number.isNaN(defId)) { p = parts.length; break; }
      const field2 = parseInt(rec[1], 10);
      let color = null;
      if (sec.colorIdx >= 0) {
        const c = parseInt(rec[sec.colorIdx], 10);
        if (!Number.isNaN(c)) color = c >>> 0;
      }
      let petAppearance = null;
      if (sec.petColorIdx >= 0 && rec[sec.petColorIdx] != null && /\d\|\d/.test(rec[sec.petColorIdx])) {
        petAppearance = rec[sec.petColorIdx];
      }
      items.push({ defId, itemType: sec.itemType, field2: Number.isNaN(field2) ? null : field2, color, petAppearance });
      p += sec.stride;
    }
  }
  if (!sawCount) return null;
  return { roomId, owner, count: items.length, items };
}

function parsePacket(packet) {
  return parseTradeList(String(packet).split('%'));
}

module.exports = { parseTradeList, parsePacket };
