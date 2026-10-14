const fs = require('fs');
const path = require('path');

const WIKI_DIR = path.resolve(__dirname, '..', 'web', 'public', 'wiki');
const REFRESH_MS = 60000;

let cached = new Set();
let loadedAt = 0;

function cachedFiles() {
  if (Date.now() - loadedAt > REFRESH_MS) {
    cached = new Set(fs.existsSync(WIKI_DIR) ? fs.readdirSync(WIKI_DIR) : []);
    loadedAt = Date.now();
  }
  return cached;
}

function imageSrc(image) {
  if (image.path && cachedFiles().has(path.basename(image.path))) return `/${image.path}`;
  return image.url || (image.path ? `/${image.path}` : null);
}

module.exports = { imageSrc, WIKI_DIR };
