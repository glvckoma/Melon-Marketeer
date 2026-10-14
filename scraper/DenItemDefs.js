const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.resolve(__dirname, '..', 'data', 'defpacks', '1030.json');

class DenItemDefs {
  constructor(filePath = DEFAULT_PATH) {
    this.filePath = filePath;
    this.defs = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    if (!fs.existsSync(this.filePath)) {
      throw new Error(`Den item definitions not found at ${this.filePath}. Run "npm run refresh-defpacks" first.`);
    }
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const json = JSON.parse(raw);
    for (const key of Object.keys(json)) {
      const entry = json[key];
      const id = parseInt(entry.id != null ? entry.id : key, 10);
      if (!Number.isFinite(id)) continue;
      this.defs.set(id, parseInt(entry.specialType, 10) || 0);
    }
    this.loaded = true;
    return this;
  }

  specialTypeOf(defId) {
    return this.defs.get(Number(defId));
  }

  get size() {
    return this.defs.size;
  }
}

module.exports = DenItemDefs;
