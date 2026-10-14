const DEFAULTS = {
  target: 10,
  staggerMs: 4000,
  intervalMs: 60000,
  retryCooldownMs: 30 * 60 * 1000,
  idleRotateMs: 0,
  hasWork: null
};

class FleetMaintainer {
  constructor({ accountManager, store, ...options } = {}) {
    this.am = accountManager;
    this.store = store;
    this.options = { ...DEFAULTS, ...options };
    this._timer = null;
    this._busy = false;
  }

  activeCount() {
    let n = 0;
    for (const e of this.am.entries.values()) {
      if (e.status === 'online' || e.status === 'connecting') n++;
    }
    return n;
  }

  selectCandidates(n, now = Date.now()) {
    if (n <= 0) return [];
    const good = [];
    const fresh = [];
    const retry = [];
    for (const e of this.am.entries.values()) {
      if (e.status === 'online' || e.status === 'connecting') continue;
      if (this.store.isQuarantined(e.username)) continue;
      const attempted = e.lastAttemptAt || 0;
      if (attempted && now - attempted < this.options.retryCooldownMs) continue;
      if (this.store.isGood(e.username)) good.push(e.username);
      else if (!attempted) fresh.push(e.username);
      else retry.push(e.username);
    }
    return [...good, ...fresh, ...retry].slice(0, n);
  }

  async fill() {
    if (this._busy) return { filled: 0, active: this.activeCount() };
    this._busy = true;
    let filled = 0;
    try {
      const candidates = this.selectCandidates(this.options.target - this.activeCount());
      for (const username of candidates) {
        const entry = this.am.entries.get(username);
        if (entry) entry.lastAttemptAt = Date.now();
        const res = await this.am.login(username);
        if (res && res.status === 'online') filled++;
        if (this.activeCount() >= this.options.target) break;
        await this._sleep(this.options.staggerMs);
      }
    } finally {
      this._busy = false;
    }
    return { filled, active: this.activeCount() };
  }

  rotateIdle(now = Date.now()) {
    if (!(this.options.idleRotateMs > 0) || typeof this.options.hasWork !== 'function') return [];
    if (!this.options.hasWork()) return [];
    const kicked = [];
    for (const e of this.am.entries.values()) {
      if (e.status !== 'online' || !e.client) continue;
      if (now - (e.client.lastProductiveAt || 0) > this.options.idleRotateMs) kicked.push(e.username);
    }
    return kicked;
  }

  async _tick() {
    if (!this._busy) {
      this._busy = true;
      try {
        for (const username of this.rotateIdle()) {
          try {
            await this.am.logout(username);
            console.log(`[FleetMaintainer] rotated idle account ${username} (no scrape in ${Math.round(this.options.idleRotateMs / 60000)}m); recycling slot`);
          } catch {}
        }
      } finally {
        this._busy = false;
      }
    }
    return this.fill();
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => { this._tick().catch(() => {}); }, this.options.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = FleetMaintainer;
