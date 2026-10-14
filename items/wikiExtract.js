const { parse } = require('node-html-parser');
const { colorBucketFromLabel, isPureColorLabel } = require('./colorName.js');
const { parseTradeValue } = require('./tradeValue.js');

const LEADING_COUNT = /^\s*(?:a few\b|~?\s*\d)/i;

const NOISE = /site-logo|placeholder|glitch|jamaa[-_ ]?journal|gift[-_ ]?card|advertis|\bbanner\b|comparison|spinner|wiki-?logo|statue|artwork|\bart\b|choose[-_ ]an[-_ ]animal|\bphoto\b|adopt|plush|wallpaper|loading|sticker|den[-_ ]?video/i;
const NON_VARIANT_HEADER = /\bacts?\b|click to|click expand|expand to view|\bmoves?\b|\bactions?\b|\bsounds?\b|gameplay/i;

function cleanImageUrl(url) {
  return String(url).split('/revision/')[0].split('?')[0];
}

function fileNameOf(url) {
  const parts = cleanImageUrl(url).split('/');
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function isItemImage(url) {
  const clean = cleanImageUrl(url);
  return /static\.wikia\.nocookie\.net\/[^/]+\/images\//.test(clean) && /\.(png|jpe?g|gif|webp)$/i.test(clean);
}

function srcOf(img) {
  return img.getAttribute('data-src') || img.getAttribute('src') || '';
}

function tag(node) {
  return String(node && node.tagName || '').toUpperCase();
}

function rowCells(row) {
  return row.childNodes.filter((n) => tag(n) === 'TD' || tag(n) === 'TH');
}

function colorWordFromFile(file) {
  return colorBucketFromLabel(file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '));
}

function headerLabelFor(td) {
  const tr = td.parentNode;
  if (!tr) return null;
  const colIdx = rowCells(tr).indexOf(td);
  if (colIdx < 0) return null;
  let hdr = tr.previousElementSibling;
  while (hdr) {
    const hc = rowCells(hdr);
    if (hc.some((c) => tag(c) === 'TH')) {
      const cell = hc[colIdx];
      return cell ? cell.text.replace(/\s+/g, ' ').trim() : null;
    }
    hdr = hdr.previousElementSibling;
  }
  return null;
}

function push(out, seen, entry) {
  const key = cleanImageUrl(entry.url);
  if (seen.has(key)) return;
  if (NOISE.test(entry.file) || (entry.label && NOISE.test(entry.label))) return;
  seen.add(key);
  out.push(entry);
}

function extractImages(html) {
  const root = parse(String(html || ''), { blockTextElements: { script: false, style: false } });
  const out = [];
  const seen = new Set();

  const infobox = root.querySelector('.pi-image img, figure.pi-image img, aside.portable-infobox img');
  if (infobox) {
    const url = cleanImageUrl(srcOf(infobox));
    if (isItemImage(url)) {
      const file = fileNameOf(url);
      push(out, seen, { url, file, color: colorWordFromFile(file), label: null, kind: 'infobox' });
    }
  }

  for (const img of root.querySelectorAll('table img')) {
    const url = cleanImageUrl(srcOf(img));
    if (!isItemImage(url)) continue;
    const td = img.closest('td');
    if (!td) continue;
    const label = headerLabelFor(td);
    if (label && NON_VARIANT_HEADER.test(label)) continue;
    const file = fileNameOf(url);
    const color = colorBucketFromLabel(label) || colorWordFromFile(file);
    push(out, seen, { url, file, color, label: label || null, kind: 'table' });
  }

  for (const item of root.querySelectorAll('.wikia-gallery-item')) {
    const img = item.querySelector('img');
    if (!img) continue;
    const url = cleanImageUrl(srcOf(img));
    if (!isItemImage(url)) continue;
    const capEl = item.querySelector('.lightbox-caption');
    const caption = capEl ? capEl.text.replace(/\s+/g, ' ').trim() : null;
    const file = fileNameOf(url);
    const color = colorBucketFromLabel(caption) || colorWordFromFile(file);
    push(out, seen, { url, file, color, label: caption || null, kind: 'gallery' });
  }

  return out;
}

function extractColorWorth(html) {
  const root = parse(String(html || ''), { blockTextElements: { script: false, style: false } });
  const byLabel = new Map();
  for (const td of root.querySelectorAll('table td')) {
    if (td.querySelector('img')) continue;
    const text = td.text.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80 || !LEADING_COUNT.test(text)) continue;
    if (parseTradeValue(text).value == null) continue;
    const label = headerLabelFor(td);
    if (!label || NON_VARIANT_HEADER.test(label)) continue;
    const color = colorBucketFromLabel(label);
    if (!color) continue;
    if (!isPureColorLabel(label)) continue;
    const key = label.toLowerCase();
    if (byLabel.has(key)) continue;
    byLabel.set(key, { label, color, worthText: text });
  }
  return [...byLabel.values()];
}

module.exports = { extractImages, extractColorWorth, cleanImageUrl, fileNameOf, isItemImage, headerLabelFor };
