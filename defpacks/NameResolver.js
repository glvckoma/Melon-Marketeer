const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', 'data', 'defpacks');

const LENGTH_BY_LAYER = { 151: 'Long', 152: 'Short', 153: 'Long', 154: 'Short' };

class NameResolver {
  constructor(dir = DIR) {
    this.dir = dir;
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this;
    this.clothing = this._read('1000.json');
    this.den = this._read('1030.json');
    this.pets = this._read('1046.json');
    this.strings = this._read('10230.json');
    try {
      this.version = JSON.parse(fs.readFileSync(path.join(this.dir, 'version.json'), 'utf-8')).version;
    } catch { this.version = null; }
    this.loaded = true;
    return this;
  }

  _read(file) {
    return JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8'));
  }

  _string(id) {
    return id == null ? null : this.strings[String(id)] || null;
  }

  resolve(itemType, defId) {
    const id = String(defId);
    let def;
    let strId;
    let abbr = null;
    if (itemType === 0) { def = this.den[id]; if (def) { strId = def.nameStrId; abbr = def.abbrName || null; } }
    else if (itemType === 2) { def = this.clothing[id]; if (def) strId = def.titleStrId; }
    else if (itemType === 1) { def = this.pets[id]; if (def) strId = def.titleStrId; }
    if (!def) return { name: null, abbr: null };
    let name = this._string(strId) || abbr || null;
    if (name && itemType === 2) {
      const len = LENGTH_BY_LAYER[Number(def.layerDefId)];
      if (len && !/\b(long|short)\b/i.test(name)) name = `${name} (${len})`;
    }
    return { name, abbr };
  }

  *all() {
    const sources = [[0, this.den], [2, this.clothing], [1, this.pets]];
    for (const [itemType, pack] of sources) {
      for (const id of Object.keys(pack)) {
        const r = this.resolve(itemType, Number(id));
        if (r.name) yield { itemType, defId: Number(id), name: r.name, abbr: r.abbr };
      }
    }
  }
}

module.exports = NameResolver;
