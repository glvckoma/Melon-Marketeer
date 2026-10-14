const path = require('path');
const fs = require('fs');

let palette = null;

function loadPalette() {
  if (palette) return palette;
  try {
    const file = path.resolve(__dirname, '..', 'data', 'palette.json');
    palette = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    palette = [];
  }
  return palette;
}

function uint32ToHex(value) {
  const hex = (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `#${hex}`;
}

function argbToRgba(value, forceOpaque = false) {
  value = value >>> 0;
  let a = (value >>> 24) & 0xFF;
  const r = (value >>> 16) & 0xFF;
  const g = (value >>> 8) & 0xFF;
  const b = value & 0xFF;
  if (forceOpaque || a === 0) a = 255;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function resolveColor(rawColor, opts = {}) {
  const value = Number(rawColor);
  if (!Number.isFinite(value)) return null;
  const colors = loadPalette();
  const u = value >>> 0;

  if (opts.directIndex && u < colors.length) {
    const pv = colors[u];
    return {
      hexColor: uint32ToHex(pv | 0xFF000000),
      cssColor: argbToRgba(pv, true),
      isPaletteIndex: true,
      paletteIndex: u,
      rawColor: value
    };
  }

  const paletteIndex = (u >>> 24) & 0xFF;
  const paletteColorValue = colors[paletteIndex];
  if (paletteColorValue == null) {
    return {
      hexColor: uint32ToHex(u | 0xFF000000),
      cssColor: argbToRgba(u, true),
      isPaletteIndex: false,
      paletteIndex: null,
      rawColor: value
    };
  }

  return {
    hexColor: uint32ToHex(paletteColorValue | 0xFF000000),
    cssColor: argbToRgba(paletteColorValue, true),
    isPaletteIndex: true,
    paletteIndex,
    rawColor: value
  };
}

module.exports = { resolveColor, loadPalette };
