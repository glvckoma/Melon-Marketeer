const ShopScraper = require('./ShopScraper');

const DEFAULT_OPTIONS = {
  mode: 'auto',
  collectDurationMs: 45000,
  staleThresholdMs: 4 * 60 * 60 * 1000,
  fallbackBatchSize: 100,
  liveBatchSize: 500,
  staleBatchSize: 200,
  idleWaitMs: 5000,
  roamWorlds: [
    'jamaa_township.room_main',
    'coral_canyons.room_main',
    'sarepia_forest.room_main',
    'crystal_sands.room_main',
    'appondale.room_main'
  ],
  roamInstances: 8,
  scrapeOptions: {
    denDelayMin: 1500,
    denDelayMax: 3500,
    dsiDelayMin: 150,
    dsiDelayMax: 400,
    maxShopsPerDen: 50,
    maxPortalHops: 0,
    captureTradeLists: false
  }
};

const NUM_KEYS = ['collectDurationMs', 'staleThresholdMs', 'fallbackBatchSize', 'liveBatchSize', 'staleBatchSize', 'idleWaitMs', 'roamInstances'];
const SCRAPE_KEYS = ['denDelayMin', 'denDelayMax', 'dsiDelayMin', 'dsiDelayMax', 'maxShopsPerDen', 'maxPortalHops'];
const PROGRESS_STALE_MS = Number(process.env.PROGRESS_STALE_MS) || 10 * 60 * 1000;
const STALL_WARN_THROTTLE_MS = 60 * 1000;

class ContinuousScraper {
  constructor({ getClients, db, defs, options = {} }) {
    this.getClients = getClients;
    this.db = db;
    this.defs = defs;
    this.options = { ...DEFAULT_OPTIONS, ...options, scrapeOptions: { ...DEFAULT_OPTIONS.scrapeOptions, ...(options.scrapeOptions || {}) } };
    this.mode = this.options.mode;
    this._running = false;
    this._stopped = false;
    this._phase = 'idle';
    this._totalScraped = 0;
    this._cycles = 0;
    this._lastProgressAt = Date.now();
    this._lastStallWarnAt = 0;
  }

  start(mode) {
    if (mode) this.mode = mode;
    if (this._running) return this.status();
    this._stopped = false;
    this._running = true;
    this._lastProgressAt = Date.now();
    this._loop().catch((err) => {
      console.error('[ContinuousScraper] loop error:', err);
      this._running = false;
      this._phase = 'idle';
    });
    return this.status();
  }

  stop() {
    this._stopped = true;
    return this.status();
  }

  configure(patch = {}) {
    for (const k of NUM_KEYS) {
      const v = Number(patch[k]);
      if (patch[k] != null && Number.isFinite(v) && v >= 0) this.options[k] = v;
    }
    if (patch.mode && ['dead', 'live', 'auto'].includes(patch.mode)) this.mode = patch.mode;
    if (patch.scrapeOptions) {
      for (const k of SCRAPE_KEYS) {
        const v = Number(patch.scrapeOptions[k]);
        if (patch.scrapeOptions[k] != null && Number.isFinite(v) && v >= 0) this.options.scrapeOptions[k] = v;
      }
      if (patch.scrapeOptions.captureTradeLists != null) {
        this.options.scrapeOptions.captureTradeLists = !!patch.scrapeOptions.captureTradeLists;
      }
    }
    return this.config();
  }

  config() {
    return {
      mode: this.mode,
      collectDurationMs: this.options.collectDurationMs,
      staleThresholdMs: this.options.staleThresholdMs,
      liveBatchSize: this.options.liveBatchSize,
      fallbackBatchSize: this.options.fallbackBatchSize,
      staleBatchSize: this.options.staleBatchSize,
      idleWaitMs: this.options.idleWaitMs,
      roamInstances: this.options.roamInstances,
      scrapeOptions: { ...this.options.scrapeOptions }
    };
  }

  status() {
    return {
      running: this._running,
      mode: this.mode,
      phase: this._phase,
      cycles: this._cycles,
      totalScraped: this._totalScraped,
      onlineClients: this.getClients().length,
      lastProgressAt: this._lastProgressAt,
      priorityQueued: this.db.getPriorityQueued(1000).length,
      liveQueued: this.db.getLiveQueued(1000).length,
      staleQueued: this.db.getStaleSellers(this.options.staleThresholdMs, 1000).length,
      fallbackQueued: this.db.getFallbackQueued(1000).length
    };
  }

  async _loop() {
    while (!this._stopped) {
      this._cycles++;
      if (this._isStalled()) process.exit(1);
      await this._scrapePriority();
      if (this._stopped) break;
      if (this.mode === 'dead') await this._deadCycle();
      else await this._liveCycle(this.mode);
      if (this._stopped) break;
    }
    this._setActivityAll('idle');
    this._running = false;
    this._phase = 'idle';
    console.log('[ContinuousScraper] stopped');
  }

  async _deadCycle() {
    await this._scrapeStale();
    if (this._stopped) return;
    const names = this.db.getFallbackQueued(this.options.fallbackBatchSize);
    if (names.length) {
      this._phase = 'scraping_fallback';
      console.log(`[ContinuousScraper] dead: scraping ${names.length} from fallback pool`);
      this._totalScraped += (await this._runScraper(names, false)).done || 0;
    } else {
      this._phase = 'idle';
      console.log('[ContinuousScraper] dead: fallback pool exhausted, idling');
      await this._sleep(this.options.idleWaitMs);
    }
  }

  async _liveCycle(mode) {
    this._phase = 'collecting';
    this.db.resetLiveFlags();
    this._roam();
    await this._sleep(this.options.collectDurationMs);
    if (this._stopped) return;

    const live = this.db.getLiveQueued(this.options.liveBatchSize);
    if (live.length) {
      this._phase = 'scraping_live';
      console.log(`[ContinuousScraper] live: scraping ${live.length} live users`);
      this._totalScraped += (await this._runScraper(live, false)).done || 0;
    }
    if (this._stopped) return;

    await this._scrapeStale();
    if (this._stopped) return;

    if (mode === 'auto' && !live.length) {
      const names = this.db.getFallbackQueued(this.options.fallbackBatchSize);
      if (names.length) {
        this._phase = 'scraping_fallback';
        console.log(`[ContinuousScraper] auto: live empty, scraping ${names.length} from fallback`);
        this._totalScraped += (await this._runScraper(names, false)).done || 0;
      }
    }
  }

  async _scrapePriority() {
    const owners = this.db.getPriorityQueued(this.options.staleBatchSize);
    if (!owners.length) return;
    if (!this.getClients().length) return;
    this._phase = 'scraping_priority';
    console.log(`[ContinuousScraper] priority re-checking ${owners.length} requested seller(s)`);
    this._totalScraped += (await this._runScraper(owners, true)).done || 0;
    this.db.clearPriority(owners);
  }

  async _scrapeStale() {
    const stale = this.db.getStaleSellers(this.options.staleThresholdMs, this.options.staleBatchSize);
    if (!stale.length) return;
    this._phase = 'scraping_stale';
    console.log(`[ContinuousScraper] re-scraping ${stale.length} stale sellers`);
    this._totalScraped += (await this._runScraper(stale, true)).done || 0;
  }

  _roam() {
    const clients = this.getClients();
    const worlds = this.options.roamWorlds;
    clients.forEach((client, i) => {
      const world = worlds[(this._cycles + i) % worlds.length];
      const instance = 1 + ((this._cycles + i) % this.options.roamInstances);
      const target = `${world}#${instance}`;
      try {
        if (client.setActivity) client.setActivity(`roaming ${world.split('.')[0]}#${instance}`);
        if (client.JoinWorld) {
          const p = client.JoinWorld(target);
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {}
    });
  }

  _setActivityAll(state) {
    for (const client of this.getClients()) {
      if (client.setActivity) client.setActivity(state);
    }
  }

  async _runScraper(names, force) {
    const scraper = new ShopScraper({
      getClients: this.getClients,
      db: this.db,
      defs: this.defs,
      options: { force, ...this.options.scrapeOptions }
    });
    const res = await scraper.run(names);
    if (res && (res.done || 0) > 0) this._lastProgressAt = Date.now();
    return res;
  }

  _isStalled() {
    if (!this._running) return false;
    if (Date.now() - this._lastProgressAt < PROGRESS_STALE_MS) return false;
    if (!this._hasWork()) return false;
    const now = Date.now();
    if (now - this._lastStallWarnAt >= STALL_WARN_THROTTLE_MS) {
      this._lastStallWarnAt = now;
      const online = this.getClients().length;
      const mins = Math.round((now - this._lastProgressAt) / 60000);
      console.warn(`[ContinuousScraper] no progress for ${mins}m with ${online} client(s) online; add more working accounts`);
    }
    return false;
  }

  _hasWork() {
    try {
      if (this.db.getLiveQueued(1).length) return true;
      if (this.db.getStaleSellers(this.options.staleThresholdMs, 1).length) return true;
      if (this.db.getFallbackQueued(1).length) return true;
    } catch {}
    return false;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ContinuousScraper;
