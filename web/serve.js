const Database = require('../db/Database.js');
const { startWebServer } = require('./server.js');
const NameResolver = require('../defpacks/NameResolver.js');
const { buildCatalog } = require('../api/catalog.js');

try { process.loadEnvFile(); } catch { /* no .env present */ }

const db = new Database(process.env.SQLITE_PATH || undefined);
const port = Number(process.env.PORT || process.env.WEB_PORT || 3200);

async function boot() {
  let catalog = [];
  try {
    const resolver = new NameResolver();
    resolver.load();
    let obsMap = null;
    try { obsMap = await db.observationCountMap(); } catch (e) { console.error('observation counts unavailable (catalog not canonicalized):', e.message); }
    catalog = buildCatalog(resolver, obsMap);
  } catch (e) {
    console.error('catalog build failed (autocomplete disabled):', e.message);
  }
  startWebServer({ db, port, catalog });
  console.log(`Melon Marketeer public site listening on :${port} (catalog ${catalog.length})`);
}

boot();

const warmMs = Number(process.env.OVERVIEW_WARM_MS || 10000);
if (warmMs > 0) {
  const http = require('http');
  const warm = () => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/overview', timeout: 15000 }, (res) => res.resume());
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
  };
  setTimeout(warm, 1500);
  setInterval(warm, warmMs).unref();
}
