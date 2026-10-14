const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { readAnomalies } = require('../scraper/AnomalyLog.js');
const { computeCoverage, computeCoverageByType } = require('../items/Coverage.js');
const rm = require('../api/readModel.js');
const { createTtlCache } = require('../api/cache.js');
const { colorInfo, currencyName } = rm;

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const SHARED_DIR = path.resolve(__dirname, '..', 'shared');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function startAdminServer({ db, accountManager, continuousScraper, defs, scrapeControl, port = 3100 }) {
  const cache = createTtlCache(15000);
  const accounts = () => ({
    online: accountManager.online.length,
    total: accountManager.list().length,
    accounts: accountManager.list()
  });

  const readBody = (req) => new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });

  const namesFrom = (payload) => {
    if (Array.isArray(payload.usernames)) return payload.usernames;
    if (payload.username) return [payload.username];
    return [];
  };

  const overview = async () => ({
    stats: db.stats(),
    scraper: continuousScraper.status(),
    currencySplit: await rm.currencySplit(db),
    mostValuable: await rm.itemRows(db, { sort: 'max', limit: 10 }),
    recent: await rm.recentRows(db, 10)
  });

  const diagnostics = async () => {
    const sample = (code) => db.sampleByCurrency(code, 8).map((r) => ({
      seller: r.owner_name,
      cost: r.cost,
      item: r.name || `def ${r.def_id}`,
      itemType: r.item_type,
      scrapedAt: r.scraped_at
    }));
    return {
      currencySplit: await rm.currencySplit(db),
      samples: { gems: sample(0), diamonds: sample(3) },
      scrape: scrapeControl ? scrapeControl.stats() : null
    };
  };

  const alertList = (limit) => {
    const alerts = db.watchAlerts(limit).map((a) => ({
      watchId: a.watchId,
      kind: a.kind,
      watchLabel: a.label,
      item: a.row.name || `def ${a.row.def_id}`,
      itemType: a.row.item_type,
      defId: a.row.def_id,
      cost: a.row.cost,
      currency: currencyName(a.row.currency_type),
      color: colorInfo(a.row.color, a.row.item_type),
      seller: a.row.owner_name,
      scrapedAt: a.row.scraped_at
    }));
    return { count: alerts.length, alerts };
  };

  const sendJson = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    res.end(payload);
  };

  const noCacheFor = (ext) => ext === '.html' || ext === '.js';

  const serveStatic = (res, pathname) => {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (noCacheFor(ext)) headers['Cache-Control'] = 'no-store';
      res.writeHead(200, headers);
      res.end(data);
    });
  };

  const handleControl = (res, payload) => {
    const action = payload.action;
    if (action === 'continuous-start') {
      if (defs && !defs.loaded) defs.load();
      return sendJson(res, 200, continuousScraper.start(payload.mode));
    }
    if (action === 'continuous-stop') {
      return sendJson(res, 200, continuousScraper.stop());
    }
    return sendJson(res, 400, { error: 'unknown action' });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    if (req.method === 'POST') {
      const payload = await readBody(req);
      switch (pathname) {
        case '/api/control': return handleControl(res, payload);
        case '/api/config': return sendJson(res, 200, continuousScraper.configure(payload));
        case '/api/accounts/login': return sendJson(res, 200, await accountManager.loginMany(namesFrom(payload)));
        case '/api/accounts/logout': return sendJson(res, 200, await accountManager.logoutMany(namesFrom(payload)));
        case '/api/scrape': {
          if (!scrapeControl) return sendJson(res, 501, { error: 'scrape control unavailable' });
          if (continuousScraper.status().running) {
            return sendJson(res, 409, { error: 'continuous scraper is running; stop it first' });
          }
          return sendJson(res, 200, scrapeControl.start(namesFrom(payload)));
        }
        case '/api/scrape/stop':
          if (!scrapeControl) return sendJson(res, 501, { error: 'scrape control unavailable' });
          return sendJson(res, 200, scrapeControl.stop());
        case '/api/coverage/match': {
          if (payload.itemType == null || payload.defId == null || !payload.wikiTitle) {
            return sendJson(res, 400, { error: 'itemType, defId, wikiTitle required' });
          }
          db.setItemWiki(Number(payload.itemType), Number(payload.defId), String(payload.wikiTitle));
          return sendJson(res, 200, { ok: true });
        }
        case '/api/trade-value/override': {
          if (!payload.wikiTitle) return sendJson(res, 400, { error: 'wikiTitle required' });
          const value = payload.value == null || payload.value === '' ? null : Number(payload.value);
          if (value != null && !Number.isFinite(value)) return sendJson(res, 400, { error: 'value must be a number or null' });
          db.setWikiTradeOverride(String(payload.wikiTitle), value, payload.display ? String(payload.display) : null);
          return sendJson(res, 200, { ok: true });
        }
        case '/api/usernames/enqueue': {
          const added = namesFrom(payload).reduce((n, name) => n + (db.enqueueUsername(String(name).trim(), 'manual') ? 1 : 0), 0);
          return sendJson(res, 200, { added });
        }
        case '/api/watches': {
          const kind = payload.kind === 'seller' ? 'seller' : 'item';
          if (kind === 'item' && (payload.itemType == null || payload.defId == null)) {
            return sendJson(res, 400, { error: 'itemType and defId required' });
          }
          if (kind === 'seller' && !payload.ownerName) {
            return sendJson(res, 400, { error: 'ownerName required' });
          }
          const currencyType = payload.currency === 'gems' ? 0 : (payload.currency === 'diamonds' ? 3 : null);
          const label = payload.label || (kind === 'seller' ? payload.ownerName : `def ${payload.defId}`);
          return sendJson(res, 200, db.addWatch({
            kind,
            itemType: kind === 'item' ? payload.itemType : null,
            defId: kind === 'item' ? payload.defId : null,
            ownerName: kind === 'seller' ? payload.ownerName : null,
            currencyType,
            maxCost: payload.maxCost === '' || payload.maxCost == null ? null : payload.maxCost,
            label
          }));
        }
        case '/api/watches/remove': {
          if (payload.id == null) return sendJson(res, 400, { error: 'id required' });
          db.removeWatch(payload.id);
          return sendJson(res, 200, { ok: true });
        }
        case '/api/alerts/ack': {
          db.markWatchesSeen(payload.id == null ? null : payload.id);
          return sendJson(res, 200, { ok: true });
        }
        default: return sendJson(res, 404, { error: 'unknown endpoint' });
      }
    }

    if (pathname.startsWith('/api/')) {
      const limit = Number(url.searchParams.get('limit')) || undefined;
      switch (pathname) {
        case '/api/accounts': return sendJson(res, 200, accounts());
        case '/api/config': return sendJson(res, 200, continuousScraper.config());
        case '/api/usernames': return sendJson(res, 200, db.searchUsernames({
          q: url.searchParams.get('q') || '',
          filter: url.searchParams.get('filter') || 'all',
          limit: limit || 100
        }));
        case '/api/stats': return sendJson(res, 200, cache.get('stats', () => db.stats(), 15000));
        case '/api/continuous': return sendJson(res, 200, continuousScraper.status());
        case '/api/overview': return sendJson(res, 200, await cache.get('overview', () => overview(), 15000));
        case '/api/scrape': return sendJson(res, 200, scrapeControl ? scrapeControl.stats() : { error: 'scrape control unavailable' });
        case '/api/throughput': return sendJson(res, 200, await rm.throughput(db, Number(url.searchParams.get('hours')) || 24));
        case '/api/anomalies': return sendJson(res, 200, readAnomalies(limit || 100));
        case '/api/diagnostics': return sendJson(res, 200, await cache.get('diagnostics', () => diagnostics(), 15000));
        case '/api/coverage': return sendJson(res, 200, cache.get(`coverage:${limit || 300}`, () => computeCoverage(db, { gapLimit: limit || 300 }), 15000));
        case '/api/dataquality': return sendJson(res, 200, cache.get(`dataquality:${limit || 100}`, () => computeCoverageByType(db, { gapLimit: limit || 100 }), 15000));
        case '/api/operations': return sendJson(res, 200, {
          priority: db.getPriorityQueued(100),
          stale: db.getStaleSellers(undefined, 50)
        });
        case '/api/tradelists': return sendJson(res, 200, { totals: db.tradeListTotals(), owners: db.tradeListOwners(limit || 100) });
        case '/api/watches': return sendJson(res, 200, db.listWatches());
        case '/api/alerts': return sendJson(res, 200, alertList(limit || 100));
        case '/api/item/history': {
          const type = Number(url.searchParams.get('type'));
          const def = Number(url.searchParams.get('def'));
          if (Number.isNaN(type) || Number.isNaN(def)) return sendJson(res, 400, { error: 'type and def required' });
          return sendJson(res, 200, await rm.itemHistory(db, type, def, url.searchParams.get('currency') || 'gems', Number(url.searchParams.get('days')) || 14));
        }
        case '/api/market': return sendJson(res, 200, await rm.marketRows(db, limit || 100));
        case '/api/recent': return sendJson(res, 200, await rm.recentRows(db, limit || 50));
        case '/api/topsellers': return sendJson(res, 200, db.topSellers(limit || 25));
        case '/api/items': return sendJson(res, 200, await rm.itemRows(db, {
          q: url.searchParams.get('q') || '',
          currency: url.searchParams.get('currency') || 'all',
          sort: url.searchParams.get('sort') || 'observations',
          limit: limit || 100
        }));
        case '/api/sellers': return sendJson(res, 200, db.searchSellers({
          q: url.searchParams.get('q') || '',
          limit: limit || 50
        }));
        case '/api/seller': {
          const name = url.searchParams.get('name');
          if (!name) return sendJson(res, 400, { error: 'name required' });
          return sendJson(res, 200, await rm.sellerDetail(db, name));
        }
        case '/api/item': {
          const type = Number(url.searchParams.get('type'));
          const def = Number(url.searchParams.get('def'));
          if (Number.isNaN(type) || Number.isNaN(def)) return sendJson(res, 400, { error: 'type and def required' });
          return sendJson(res, 200, await rm.itemDetail(db, type, def));
        }
        default: return sendJson(res, 404, { error: 'unknown endpoint' });
      }
    }

    if (pathname === '/tokens.css') {
      return fs.readFile(path.join(SHARED_DIR, 'tokens.css'), (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
        res.end(data);
      });
    }

    serveStatic(res, pathname);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Admin hub running at http://localhost:${port}`);
  });

  return server;
}

module.exports = { startAdminServer };
