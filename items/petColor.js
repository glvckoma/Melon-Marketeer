const { loadPalette } = require('./Color.js');

const ANIMAL_BASE = [
  4278255615, 4286513152, 4290707456, 4294901760, 4278222592, 4278238976,
  4278255360, 4278190207, 4278190271, 4278190335, 4286545791, 4290756543,
  4294967295, 4282400768, 4286611456, 4278206528, 4278222976, 4282384448,
  4286578816, 4286595136, 4294934656, 4282417216, 4286644096, 4282400896,
  4286611711, 4278190080
];

let animalPalette = null;

function getAnimalPalette() {
  if (animalPalette) return animalPalette;
  const out = ANIMAL_BASE.slice();
  let alpha = 4294967295;
  for (let s = 0; s < 3; s += 1) {
    for (let i = 1; i <= 25; i += 1) {
      out.push(((ANIMAL_BASE[i] & 0xFFFFFF) | alpha) >>> 0);
    }
    alpha = (alpha - 1073741824) >>> 0;
  }
  animalPalette = out;
  return out;
}

function unpackPetBits(lBits, uBits = 0) {
  const lo = lBits >>> 0;
  const hi = uBits >>> 0;
  return {
    species: lo & 0xFF,
    color1: (lo >>> 8) & 0x3F,
    color2: (lo >>> 14) & 0x1F,
    color3: (lo >>> 19) & 0x1F,
    pattern: (lo >>> 24) & 0x0F,
    eye: (lo >>> 28) & 0x0F,
    parts: [
      hi & 0x0F,
      (hi >>> 4) & 0x0F,
      (hi >>> 8) & 0x0F,
      (hi >>> 12) & 0x0F,
      (hi >>> 16) & 0x0F,
      (hi >>> 20) & 0x0F
    ]
  };
}

function rgbHex(value) {
  return `#FF${((value >>> 0) & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0')}`;
}

function rgbCss(value) {
  const v = value >>> 0;
  return `rgb(${(v >>> 16) & 0xFF},${(v >>> 8) & 0xFF},${v & 0xFF})`;
}

function paletteEntry(palette, index) {
  if (index == null || index >= palette.length) return null;
  const value = palette[index];
  return { index, hex: rgbHex(value), css: rgbCss(value) };
}

function colorCandidates(index) {
  const game = paletteEntry(loadPalette(), index);
  const animal = paletteEntry(getAnimalPalette(), index);
  if (!game && !animal) return null;
  return {
    index,
    gameHex: game ? game.hex : null,
    gameCss: game ? game.css : null,
    animalHex: animal ? animal.hex : null,
    animalCss: animal ? animal.css : null
  };
}

function parsePair(pairStr) {
  if (pairStr == null) return null;
  const parts = String(pairStr).split('|');
  const a = parseInt(parts[0], 10);
  if (!Number.isFinite(a)) return null;
  const b = parseInt(parts[1], 10);
  return { a, b: Number.isFinite(b) ? b : 0 };
}

function decodePetColor(pairStr) {
  const pair = parsePair(pairStr);
  if (!pair) return null;
  const bits = unpackPetBits(pair.a, pair.b);
  const primary = colorCandidates(bits.color1);
  if (!primary) return null;
  const secondary = colorCandidates(bits.color2);
  const tertiary = colorCandidates(bits.color3);
  return {
    species: bits.species,
    color1: bits.color1,
    color2: bits.color2,
    color3: bits.color3,
    pattern: bits.pattern,
    eye: bits.eye,
    parts: bits.parts,
    activeParts: bits.parts.filter((p) => p > 0).length,
    colors: { primary, secondary, tertiary },
    hex: primary.gameHex,
    css: primary.gameCss,
    animalHex: primary.animalHex,
    raw: String(pairStr)
  };
}

module.exports = { getAnimalPalette, unpackPetBits, decodePetColor, colorCandidates };
