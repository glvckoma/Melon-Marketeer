try { if (process.loadEnvFile) process.loadEnvFile(); } catch {}
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const setTitle = require('console-title');
const clc = require('cli-color');
const { fetchFlashvars } = require('./bot/utils/Extra.js');
const Database = require('./db/Database.js');
const DenItemDefs = require('./scraper/DenItemDefs.js');
const UsernameCollector = require('./scraper/UsernameCollector.js');
const ShopScraper = require('./scraper/ShopScraper.js');
const ContinuousScraper = require('./scraper/ContinuousScraper.js');
const AccountManager = require('./fleet/AccountManager.js');
const { AccountStore, isPermanentFailure } = require('./fleet/AccountStore.js');
const FleetMaintainer = require('./fleet/FleetMaintainer.js');
const { startAdminServer } = require('./admin/server.js');

const db = new Database();
const defs = new DenItemDefs();
const collector = new UsernameCollector(db);
let shopJob = null;

const ROLLUP_INTERVAL_MS = Number(process.env.ROLLUP_INTERVAL_MS) || 180000;
function spawnRollup() {
  try {
    spawn(process.execPath, [path.join(__dirname, 'tools', 'rollupStats.js')], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    console.log(clc.red('[rollup]'), 'spawn failed:', e.message);
  }
}
if (ROLLUP_INTERVAL_MS > 0) {
  spawnRollup();
  setInterval(spawnRollup, ROLLUP_INTERVAL_MS).unref();
}

const accountStore = new AccountStore(path.join(__dirname, 'data', 'account-store.json'));
const accountManager = new AccountManager({
  onReady: (client) => {
    console.log(`Online: ${client.username}`);
    accountStore.markGood(client.username);
    client.setActivity('idle');
    collector.attach(client.controller);
  },
  onClose: (client) => {
    console.log(clc.red(`[${client.username}]`), 'Connection closed.');
  },
  onFailed: (username, error) => {
    if (isPermanentFailure(error) && accountStore.quarantine(username, error)) {
      console.log(clc.yellow(`[${username}]`), 'quarantined (bad credentials)');
    }
  }
});

const activeClients = accountManager.online;
const continuousScraper = new ContinuousScraper({ getClients: () => accountManager.online, db, defs });
const fleetMaintainer = new FleetMaintainer({
  accountManager,
  store: accountStore,
  target: Math.max(1, Number(process.env.AUTO_LOGIN_COUNT || 10)),
  staggerMs: Number(process.env.LOGIN_STAGGER_MS || 4000),
  intervalMs: Number(process.env.FLEET_CHECK_MS || 60000),
  idleRotateMs: Number(process.env.ACCOUNT_IDLE_ROTATE_MS || 8 * 60 * 1000),
  hasWork: () => { try { return continuousScraper._running && continuousScraper._hasWork(); } catch { return false; } }
});

async function loadAccounts(filePath) {
  let data;
  try {
    data = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log(clc.yellow(`${filePath} not found. Copy accounts.example.txt to accounts.txt and add your accounts to start scraping.`));
    return [];
  }
  return data
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [username, password] = line.split(':');
      return { username, password };
    });
}

process.on('uncaughtException', (err) => {
  console.error(clc.red('[uncaughtException]'), err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error(clc.red('[unhandledRejection]'), reason && reason.stack ? reason.stack : reason);
});

(async () => {
  setTitle("Animal Jam Bot's | Created By Doc/DrEmoji |");
  console.log(clc.green(`Animal Jam Classic Bot's created by Doc/DrEmoji\n`));

  try {
    await fetchFlashvars();
  } catch (err) {
    console.error(clc.red('Failed to fetch flashvars on startup:'), err.message);
  }

  const accounts = await loadAccounts('accounts.txt');
  for (const a of accounts) accountManager.add(a.username, a.password);
  console.log(`Loaded ${accounts.length} accounts (none logged in). Use the admin hub to select accounts.`);

  const scrapeControl = {
    start(usernames) {
      if (shopJob && shopJob.running) return { error: 'already running', ...shopJob.stats() };
      if (activeClients.length === 0) return { error: 'no active clients' };
      if (!defs.loaded) defs.load();
      const list = Array.isArray(usernames)
        ? usernames.map((s) => String(s).trim()).filter(Boolean)
        : null;
      shopJob = new ShopScraper({ getClients: () => activeClients, db, defs });
      shopJob.run(list && list.length ? list : undefined)
        .catch((err) => console.error('Shop scrape error:', err));
      return { started: true, ...shopJob.stats() };
    },
    stop() {
      if (shopJob) shopJob.abort();
      return { stopped: true, ...(shopJob ? shopJob.stats() : {}) };
    },
    stats() {
      return shopJob ? shopJob.stats() : { running: false, total: 0, done: 0, failed: 0, items: 0, inFlight: 0, queued: 0, startedAt: 0 };
    }
  };

  startAdminServer({ db, accountManager, continuousScraper, defs, scrapeControl, port: 3100 });

  if (process.env.AUTO_START === '1') {
    (async () => {
      try {
        console.log(clc.green('AUTO_START enabled: logging in fleet and starting continuous scraper...'));
        if (!defs.loaded) defs.load();
        const q = accountStore.stats();
        console.log(`Auto-login: target ${fleetMaintainer.options.target}, pool ${accounts.length} (good ${q.good}, quarantined ${q.quarantined})`);
        const fill = await fleetMaintainer.fill();
        console.log(`Auto-login complete: ${fill.active} online (filled ${fill.filled})`);
        fleetMaintainer.start();
        const autoHops = Number(process.env.SCRAPE_MAX_PORTAL_HOPS);
        if (Number.isFinite(autoHops) && autoHops >= 0) {
          continuousScraper.configure({ scrapeOptions: { maxPortalHops: autoHops } });
          console.log(`maxPortalHops set to ${autoHops} before auto-start`);
        }
        console.log(JSON.stringify(continuousScraper.start('auto')));
      } catch (err) {
        console.error(clc.red('Auto-start failed:'), err.message);
      }
    })();
  }
})();
