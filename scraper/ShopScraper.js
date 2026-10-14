const DEFAULT_OPTIONS = {
  denDelayMin: 1500,
  denDelayMax: 3500,
  dsiDelayMin: 150,
  dsiDelayMax: 400,
  dsTimeout: 8000,
  dsiTimeout: 8000,
  maxShopsPerDen: 50,
  maxPortalHops: 0,
  portalTimeout: 6000,
  maxConcurrent: 0,
  force: false,
  captureTradeLists: false
};

class ShopScraper {
  constructor({ getClients, db, defs, options = {} }) {
    this.getClients = getClients;
    this.db = db;
    this.defs = defs;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.queue = [];
    this.running = false;
    this.aborted = false;
    this.stats_ = this._emptyStats();
  }

  _emptyStats() {
    return { total: 0, done: 0, failed: 0, items: 0, tradelists: 0, inFlight: 0, queued: 0, running: false, startedAt: 0 };
  }

  async run(usernames) {
    if (this.running) return { error: 'already running', ...this.stats() };

    if (Array.isArray(usernames) && usernames.length) {
      for (const u of usernames) this.db.enqueueUsername(u, 'manual');
    }

    const source = (Array.isArray(usernames) && usernames.length)
      ? usernames
      : this.db.getQueuedUsernames();

    const seen = new Set();
    this.queue = [];
    for (const name of source) {
      const key = String(name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.options.force && this.db.hasDenScraped(name)) continue;
      this.queue.push(name);
    }

    const clients = this.getClients();
    const pool = this.options.maxConcurrent > 0 ? clients.slice(0, this.options.maxConcurrent) : clients;
    if (pool.length === 0) return { error: 'no active clients' };

    this.running = true;
    this.aborted = false;
    this.stats_ = { ...this._emptyStats(), total: this.queue.length, running: true, startedAt: Date.now() };

    await Promise.allSettled(pool.map((client) => this._worker(client)));

    this.running = false;
    this.stats_.running = false;
    return this.stats();
  }

  abort() {
    this.aborted = true;
    return this.stats();
  }

  stats() {
    return { ...this.stats_, queued: this.queue.length, running: this.running };
  }

  async _worker(client) {
    while (!this.aborted) {
      const owner = this.queue.shift();
      if (owner === undefined) break;

      if (!this.options.force && this.db.hasDenScraped(owner)) {
        this.stats_.done++;
        continue;
      }
      if (!client.controller) {
        this.queue.unshift(owner);
        break;
      }

      this.stats_.inFlight++;
      let result = null;
      try {
        if (client.setActivity) client.setActivity(`scraping ${owner}`);
        result = await client.ScrapeDenShops(owner, { defs: this.defs, options: this.options });
      } catch {
        result = { status: 'error', shopIds: [], items: [] };
      } finally {
        this.stats_.inFlight--;
        if (client.setActivity) client.setActivity('idle');
      }

      if (result && result.status === 'disconnected') {
        this.queue.unshift(owner);
        break;
      }

      this._persist(client, owner, result);

      if (this.options.captureTradeLists && result && (result.status === 'ok' || result.status === 'empty')) {
        await this._captureTradeList(client, owner);
      }

      if (!this.aborted) {
        await this._sleep(this._rand(this.options.denDelayMin, this.options.denDelayMax));
      }
    }
  }

  async _captureTradeList(client, owner) {
    if (!client.controller || typeof client.RequestTradeList !== 'function') return;
    try {
      await this._sleep(this._rand(this.options.dsiDelayMin, this.options.dsiDelayMax));
      const tl = await client.RequestTradeList(owner);
      if (tl && tl.status === 'ok' && Array.isArray(tl.items) && tl.items.length) {
        this.db.recordTradeList(owner, tl.items);
        this.stats_.tradelists++;
      }
    } catch {}
  }

  _persist(client, owner, result) {
    if (result && Array.isArray(result.dens) && result.dens.length) {
      result.dens.forEach((den, idx) => {
        this._writeDen(client, den.owner, den.status, den.shopIds, den.items, idx === 0);
      });
      return;
    }
    this._writeDen(client, owner, result && result.status, result && result.shopIds, result && result.items, true);
  }

  _writeDen(client, owner, status, shopIds, items, countOutcome) {
    status = status || 'error';
    const records = (items || []).map((it) => ({
      ownerName: owner,
      shopId: it.shopId,
      invIdx: it.invIdx,
      defId: it.defId,
      itemType: it.itemType,
      cost: it.cost,
      currencyType: it.currencyType,
      color: it.color == null ? null : it.color,
      petAppearance: it.petAppearance == null ? null : it.petAppearance,
      shopState: it.shopState || '',
      scrapedBy: client.username,
      scrapedAt: Date.now()
    }));

    if (records.length) {
      this.db.insertObservations(records);
      this.stats_.items += records.length;
    }
    if (countOutcome) {
      if (status === 'error' || status === 'joinfail') this.stats_.failed++;
      else this.stats_.done++;
    }

    this.db.recordDen(owner, shopIds || [], records.length, status);
    this.db.markUsernameScraped(owner);
    if (client && status !== 'error' && status !== 'joinfail') client.lastProductiveAt = Date.now();
  }

  _rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ShopScraper;
