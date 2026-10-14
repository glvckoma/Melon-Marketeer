const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const rm = require('../api/readModel.js');
const { searchCatalog } = require('../api/catalog.js');
const { createTtlCache } = require('../api/cache.js');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const SHARED_DIR = path.resolve(__dirname, '..', 'shared');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const USERNAME_RE = /^[\p{L}\p{M}\p{N}]{3,20}$/u;

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const fresh = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (fresh.length >= max) {
      hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    hits.set(key, fresh);
    return true;
  };
}

function parseSubmittedUsernames(raw) {
  const lines = (Array.isArray(raw) ? raw : String(raw || '').split(/[\r\n,]+/)).slice(0, 5000);
  const valid = [];
  let skipped = 0;
  for (const line of lines) {
    let s = String(line).trim();
    if (!s) continue;
    if (s.includes(' - ')) s = s.slice(s.lastIndexOf(' - ') + 3).trim();
    if (USERNAME_RE.test(s)) valid.push(s);
    else skipped += 1;
  }
  return { valid, skipped };
}

const overviewCache = createTtlCache(30000);
const statusCache = createTtlCache(20000);

async function publicOverview(db) {
  const stats = await db.stats();
  return {
    stats: { items: stats.itemDefinitions, sellers: stats.sellers, observations: stats.observations },
    currencySplit: await rm.currencySplit(db),
    topSellers: await db.topSellers({ limit: 12 }),
    mostValuable: await rm.mostValuable(db, 12),
    topDeals: await rm.topDeals(db, 10),
    trending: await rm.recentRows(db, 100)
  };
}

function startWebServer({ db, port = 3200, catalog = [] }) {
  const allowSubmit = createRateLimiter({ windowMs: 600000, max: 10 });
  const allowRecheck = createRateLimiter({ windowMs: 600000, max: 20 });

  const readBody = (req, cap = 4096) => new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > cap) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });

  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  };

  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers
    });
    res.end(JSON.stringify(body));
  };

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
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, shell) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'], ...SECURITY_HEADERS });
          res.end(shell);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', ...SECURITY_HEADERS });
      res.end(data);
    });
  };

  const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    if (req.method === 'POST') {
      if (pathname === '/api/submit') {
        if (!allowSubmit(clientIp(req))) return sendJson(res, 429, { error: 'rate limit exceeded; try again later' });
        const payload = await readBody(req, 500000);
        const raw = payload.usernames != null ? payload.usernames : payload.username;
        const { valid, skipped } = parseSubmittedUsernames(raw);
        if (!valid.length && !skipped) return sendJson(res, 400, { error: 'no usernames provided' });
        const r = await db.enqueueUsernames(valid, 'user');
        return sendJson(res, 200, { ok: true, added: r.added, duplicate: r.duplicate, skipped });
      }
      if (pathname === '/api/recheck') {
        if (!allowRecheck(clientIp(req))) return sendJson(res, 429, { error: 'too many requests; try again later' });
        const payload = await readBody(req);
        const owner = String(payload.owner || '').trim();
        if (!USERNAME_RE.test(owner)) return sendJson(res, 400, { error: 'invalid seller name' });
        await db.requestRecheck(owner);
        return sendJson(res, 200, { ok: true, queued: true });
      }
      return sendJson(res, 404, { error: 'unknown endpoint' });
    }

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

    if (pathname.startsWith('/api/')) {
      const limit = Number(url.searchParams.get('limit')) || undefined;
      switch (pathname) {
        case '/api/item-colors': {
          const type = Number(url.searchParams.get('type'));
          const def = Number(url.searchParams.get('def'));
          if (!Number.isFinite(type) || !Number.isFinite(def)) return sendJson(res, 400, { error: 'type and def required' });
          return sendJson(res, 200, await rm.itemColors(db, type, def));
        }
        case '/api/overview':
          return sendJson(res, 200, await overviewCache.get('overview', () => publicOverview(db)));
        case '/api/status':
          return sendJson(res, 200, await statusCache.get('status', () => rm.scraperStatus(db, Number(process.env.STATUS_ONLINE_MIN) || 30)));
        case '/api/items':
          return sendJson(res, 200, await rm.itemRows(db, {
            q: url.searchParams.get('q') || '',
            currency: url.searchParams.get('currency') || 'all',
            sort: url.searchParams.get('sort') || 'observations',
            limit: Math.min(limit || 50, 100)
          }));
        case '/api/autocomplete': {
          const hits = searchCatalog(catalog, url.searchParams.get('q') || '', limit || 10);
          return sendJson(res, 200, await rm.autocompleteEnrich(db, hits));
        }
        case '/api/colorsearch':
          return sendJson(res, 200, await rm.itemsByColor(db, url.searchParams.get('color') || '', Math.min(limit || 60, 100)));
        case '/api/item': {
          const type = Number(url.searchParams.get('type'));
          const def = Number(url.searchParams.get('def'));
          if (Number.isNaN(type) || Number.isNaN(def)) return sendJson(res, 400, { error: 'type and def required' });
          return sendJson(res, 200, await rm.itemDetail(db, type, def));
        }
        case '/api/item/history': {
          const type = Number(url.searchParams.get('type'));
          const def = Number(url.searchParams.get('def'));
          if (Number.isNaN(type) || Number.isNaN(def)) return sendJson(res, 400, { error: 'type and def required' });
          return sendJson(res, 200, await rm.itemHistory(db, type, def, url.searchParams.get('currency') || 'diamonds', Number(url.searchParams.get('days')) || 14));
        }
        case '/api/sellers':
          return sendJson(res, 200, await db.searchSellers({ q: url.searchParams.get('q') || '', limit: Math.min(limit || 30, 100), sort: url.searchParams.get('sort') || 'recent' }));
        case '/api/seller': {
          const name = url.searchParams.get('name');
          if (!name) return sendJson(res, 400, { error: 'name required' });
          const detail = await rm.sellerDetail(db, name);
          detail.presence = await db.sellerPresence(name);
          return sendJson(res, 200, detail);
        }
        case '/api/topsellers':
          return sendJson(res, 200, await db.topSellers({ limit: Math.min(limit || 25, 100), sort: url.searchParams.get('sort') || 'recent' }));
        default:
          return sendJson(res, 404, { error: 'unknown endpoint' });
      }
    }

    if (pathname === '/tokens.css') {
      return fs.readFile(path.join(SHARED_DIR, 'tokens.css'), (err, data) => {
        if (err) { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.css'], ...SECURITY_HEADERS });
        res.end(data);
      });
    }

    serveStatic(res, pathname);
  });

  server.on('error', (err) => {
    console.error(`Public website server error: ${err.message}`);
  });

  server.listen(port, () => {
    console.log(`Public website running at http://localhost:${port}`);
  });

  return server;
}

module.exports = { startWebServer, USERNAME_RE, createRateLimiter, publicOverview, parseSubmittedUsernames };
