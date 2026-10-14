const fs = require('fs');

const PERMANENT = /AJ auth failed \(status (401|403)\)|error_code"?\s*:\s*(102|103|104)/i;

function isPermanentFailure(message) {
  return PERMANENT.test(String(message || ''));
}

class AccountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { quarantine: {}, good: {} };
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.data.quarantine = raw.quarantine || {};
      this.data.good = raw.good || {};
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[AccountStore] could not read ${this.filePath}: ${e.message}`);
    }
  }

  _save() {
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.error(`[AccountStore] could not save ${this.filePath}: ${e.message}`);
    }
  }

  isQuarantined(username) {
    return Boolean(this.data.quarantine[username]);
  }

  isGood(username) {
    return Boolean(this.data.good[username]);
  }

  quarantine(username, reason, at) {
    if (!username || this.data.quarantine[username]) return false;
    this.data.quarantine[username] = { reason: String(reason || '').slice(0, 200), at: at || Date.now() };
    delete this.data.good[username];
    this._save();
    return true;
  }

  markGood(username, at) {
    if (!username) return false;
    const wasQuarantined = Boolean(this.data.quarantine[username]);
    const wasGood = Boolean(this.data.good[username]);
    this.data.good[username] = { at: at || Date.now() };
    if (wasQuarantined) delete this.data.quarantine[username];
    if (!wasGood || wasQuarantined) this._save();
    return true;
  }

  stats() {
    return {
      quarantined: Object.keys(this.data.quarantine).length,
      good: Object.keys(this.data.good).length
    };
  }
}

module.exports = { AccountStore, isPermanentFailure };
