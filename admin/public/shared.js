function makeLoadCache(now) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const store = new Map();
  return {
    load(key, fetcher, opts) {
      const ttlMs = (opts && opts.ttlMs) || 0;
      const hit = store.get(key);
      if (hit) {
        if (hit.pending) return hit.pending;
        if (hit.expiresAt > clock()) return Promise.resolve(hit.value);
      }
      const pending = Promise.resolve().then(fetcher).then(
        (value) => { store.set(key, { value, expiresAt: clock() + ttlMs }); return value; },
        (err) => { store.delete(key); throw err; }
      );
      store.set(key, { pending });
      return pending;
    },
    refresh(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

const App = {
  pages: {},
  current: null
};

App._loadCache = makeLoadCache();
App.load = (key, fetcher, opts) => App._loadCache.load(key, fetcher, opts);
App.refresh = (key) => App._loadCache.refresh(key);

App._live = new Map();
App.clearLive = () => { App._live.forEach((id) => clearInterval(id)); App._live.clear(); };
App.live = (key, fetcher, intervalMs) => {
  Promise.resolve().then(fetcher);
  if (App._live.has(key)) return;
  const id = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    Promise.resolve().then(fetcher);
  }, intervalMs || 10000);
  App._live.set(key, id);
};

App.getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
};

App.postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}).then((r) => r.json());

App.ago = (ts) => {
  if (!ts) return '-';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

App.num = (n) => (n == null ? '-' : Number(n).toLocaleString());

App.swatch = (color) => {
  if (!color || !color.css) return '<span class="muted">-</span>';
  return `<span class="swatch" style="background:${color.css}" title="${color.hex} (raw ${color.raw})"></span>`;
};

App.metric = (lbl, val) => `<div class="metric"><div class="val num">${App.num(val)}</div><div class="lbl">${lbl}</div></div>`;
App.stat = (val, lbl) => `<div class="stat-inline"><div class="val num">${App.num(val)}</div><div class="lbl">${lbl}</div></div>`;

App.CONF = { exact: ['conf-exact', 'exact'], high: ['conf-high', 'close'], medium: ['conf-med', 'fuzzy'], low: ['conf-med', 'fuzzy'] };
App.confChip = (confidence) => {
  const c = App.CONF[confidence];
  return c ? `<span class="chip ${c[0]}" title="wiki match confidence">${c[1]}</span>` : '';
};
App.freshness = (observations, lastSeen) => {
  const parts = [];
  if (observations != null) parts.push(`${App.num(observations)} obs`);
  if (lastSeen) parts.push(`seen ${App.ago(lastSeen)}`);
  return parts.length ? `<span class="freshness">${parts.join(' · ')}</span>` : '';
};
App.valueCell = ({ head, confidence, observations, lastSeen, sub }) => {
  const meta = `${App.confChip(confidence)}${App.freshness(observations, lastSeen)}`;
  return `<div class="value-cell"><div class="value-head">${head || '<span class="muted">no value</span>'}</div>${sub ? `<div class="value-sub">${sub}</div>` : ''}${meta ? `<div class="value-meta">${meta}</div>` : ''}</div>`;
};
App.skeletonRows = (cols, n = 6) => Array.from({ length: n }, () => `<tr><td colspan="${cols}" class="sk-pad"><span class="sk sk-row"></span></td></tr>`).join('');

App.dayLabel = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

App.lineChart = (series, opts = {}) => {
  if (!series || !series.length) return '<div class="empty">No price history</div>';
  const w = opts.width || 520;
  const h = opts.height || 150;
  const pad = 30;
  const xs = series.map((p) => p.t);
  const ys = series.map((p) => p.median).filter((v) => v != null);
  const minT = Math.min(...xs);
  const maxT = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanT = (maxT - minT) || 1;
  const spanY = (maxY - minY) || 1;
  const X = (t) => pad + ((t - minT) / spanT) * (w - pad * 2);
  const Y = (v) => h - pad - ((v - minY) / spanY) * (h - pad * 2);
  const line = series.map((p) => `${X(p.t).toFixed(1)},${Y(p.median).toFixed(1)}`).join(' ');
  const area = `${pad},${(h - pad).toFixed(1)} ${line} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)}`;
  const dots = series.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.median).toFixed(1)}" r="2.6"><title>${App.dayLabel(p.t)}: ${App.num(p.median)} (n=${p.n})</title></circle>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}">
    <polygon class="chart-area" points="${area}"></polygon>
    <polyline class="chart-line" points="${line}"></polyline>
    ${dots}
    <text class="chart-axis" x="2" y="${pad}">${App.num(maxY)}</text>
    <text class="chart-axis" x="2" y="${h - pad}">${App.num(minY)}</text>
    <text class="chart-axis" x="${pad}" y="${h - 6}">${App.dayLabel(minT)}</text>
    <text class="chart-axis" x="${w - pad}" y="${h - 6}" text-anchor="end">${App.dayLabel(maxT)}</text>
  </svg>`;
};

App.sparkline = (values, opts = {}) => {
  if (!values || !values.length) return '<div class="empty">No data</div>';
  const w = opts.width || 520;
  const h = opts.height || 64;
  const max = Math.max(1, ...values);
  const bw = w / values.length;
  const bars = values.map((v, i) => {
    const bh = (v / max) * (h - 4);
    return `<rect class="spark-bar" x="${(i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}"><title>${App.num(v)}</title></rect>`;
  }).join('');
  return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}">${bars}</svg>`;
};

App.donut = (parts, opts = {}) => {
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  if (!total) return '<div class="empty">No data</div>';
  const size = opts.size || 130;
  const sw = 18;
  const r = size / 2 - sw / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = parts.map((p) => {
    const frac = (p.value || 0) / total;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:none;stroke:${p.color}" stroke-width="${sw}" stroke-dasharray="${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}" stroke-dashoffset="${(-offset * C).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    offset += frac;
    return seg;
  }).join('');
  const legend = parts.map((p) => `<div class="legend-item"><span class="legend-dot" style="background:${p.color}"></span>${p.label} <b>${App.num(p.value)}</b> <span class="muted">${Math.round((p.value || 0) / total * 100)}%</span></div>`).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg><div class="donut-legend">${legend}</div></div>`;
};

App.jobCard = (s) => {
  if (!s || (!s.running && !s.total)) return '<div class="muted">No scrape job yet.</div>';
  const done = (s.done || 0) + (s.failed || 0);
  const pct = s.total ? Math.round((done / s.total) * 100) : 0;
  return `<div class="progress"><span style="width:${pct}%"></span></div>
    <div class="job-stats">${App.stat(s.total, 'total')}${App.stat(s.done, 'done')}${App.stat(s.failed, 'failed')}${App.stat(s.items, 'items')}${App.stat(s.inFlight, 'in flight')}${App.stat(s.queued, 'queued')}<div class="phase-badge ${s.running ? 'active' : ''}">${s.running ? 'running' : 'idle'}</div></div>`;
};

App.toast = (msg, type = 'info') => {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3200);
};

App.setConnected = (live) => document.getElementById('conn-dot').classList.toggle('live', live);

App.register = (id, page) => {
  App.pages[id] = page;
  if (page.init) page.init();
};

App.route = () => {
  const id = location.hash.replace('#/', '') || 'dashboard';
  const page = App.pages[id] ? id : 'dashboard';
  const switched = App.current !== page;
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === `page-${page}`));
  App.clearLive();
  if (App.closeDrawer) App.closeDrawer();
  App.current = page;
  const section = document.getElementById(`page-${page}`);
  if (switched && section) {
    section.classList.remove('entering');
    void section.offsetWidth;
    section.classList.add('entering');
  }
  if (window.lucide) window.lucide.createIcons();
  const p = App.pages[page];
  if (p && p.refresh) {
    if (p.liveMs) App.live(page, p.refresh, p.liveMs);
    else p.refresh();
  }
};

App.updateAlertBadge = (count) => {
  const el = document.getElementById('alert-badge');
  if (el) {
    if (count > 0) { el.textContent = count >= 100 ? '99+' : String(count); el.classList.add('show'); }
    else { el.textContent = ''; el.classList.remove('show'); }
  }
  if (App._lastAlertCount != null && count > App._lastAlertCount) {
    const d = count - App._lastAlertCount;
    App.toast(`${d} new alert${d === 1 ? '' : 's'}`, 'ok');
  }
  App._lastAlertCount = count;
};

App.statusTick = async () => {
  try {
    const [stats, accts, alerts] = await Promise.all([
      App.getJson('/api/stats'),
      App.getJson('/api/accounts'),
      App.getJson('/api/alerts?limit=100')
    ]);
    App.setConnected(true);
    document.getElementById('topstatus').innerHTML =
      `<span class="ts"><b>${accts.online}</b>/${accts.total} online</span>` +
      `<span class="ts"><b>${App.num(stats.observations)}</b> obs</span>` +
      `<span class="ts"><b>${App.num(stats.sellers)}</b> sellers</span>`;
    App.updateAlertBadge(alerts.count || 0);
  } catch {
    App.setConnected(false);
  }
};

App._numVal = (s) => {
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

App.markSortable = (table) => {
  const headRow = table.tHead && table.tHead.rows[0];
  if (!headRow) return;
  [...headRow.cells].forEach((th) => {
    if (th.dataset.sortReady) return;
    if (th.querySelector('input') || !th.textContent.trim()) { th.dataset.sortReady = 'skip'; return; }
    th.classList.add('sortable');
    const caret = document.createElement('span');
    caret.className = 'sort-caret';
    th.appendChild(caret);
    th.dataset.sortReady = '1';
  });
};

App.applySort = (table) => {
  if (table.dataset.sortCol == null) return;
  const idx = Number(table.dataset.sortCol);
  const dir = table.dataset.sortDir === 'descending' ? -1 : 1;
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = [...tbody.rows].filter((r) => r.cells.length > idx && !r.querySelector('[colspan]'));
  if (rows.length < 2) return;
  const decorated = rows.map((r) => {
    const text = r.cells[idx] ? r.cells[idx].textContent.trim() : '';
    return { r, s: text, n: App._numVal(text) };
  });
  const numeric = decorated.filter((d) => !Number.isNaN(d.n)).length >= Math.ceil(rows.length / 2);
  decorated.sort((a, b) => {
    if (numeric) {
      const av = Number.isNaN(a.n) ? -Infinity : a.n;
      const bv = Number.isNaN(b.n) ? -Infinity : b.n;
      return (av - bv) * dir;
    }
    return a.s.toLowerCase().localeCompare(b.s.toLowerCase()) * dir;
  });
  if (App._obs) App._obs.disconnect();
  decorated.forEach((d) => tbody.appendChild(d.r));
  if (App._obs) App._obs.observe(document.querySelector('main'), { childList: true, subtree: true });
};

App.enhanceTables = () => {
  document.querySelectorAll('main table').forEach((table) => {
    App.markSortable(table);
    if (table.dataset.sortCol != null) App.applySort(table);
  });
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const th = e.target.closest && e.target.closest('th.sortable');
    if (!th || !th.parentNode) return;
    const table = th.closest('table');
    if (!table || !table.tHead) return;
    const idx = [...th.parentNode.cells].indexOf(th);
    const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    [...th.parentNode.cells].forEach((h) => h.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', dir);
    table.dataset.sortCol = String(idx);
    table.dataset.sortDir = dir;
    App.applySort(table);
  });

  App.closeDrawer = () => {
    const sb = document.getElementById('sidebar');
    const sc = document.getElementById('scrim');
    if (sb) sb.classList.remove('open');
    if (sc) sc.classList.remove('show');
  };
  App.toggleDrawer = () => {
    const sb = document.getElementById('sidebar');
    const sc = document.getElementById('scrim');
    if (!sb) return;
    const open = sb.classList.toggle('open');
    if (sc) sc.classList.toggle('show', open);
  };

  window.addEventListener('hashchange', App.route);
  window.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('drawer-toggle');
    const scrim = document.getElementById('scrim');
    if (toggle) toggle.addEventListener('click', App.toggleDrawer);
    if (scrim) scrim.addEventListener('click', App.closeDrawer);
    App.route();
    App.statusTick();
    setInterval(App.statusTick, 3000);
    const main = document.querySelector('main');
    if (main && 'MutationObserver' in window) {
      App._obs = new MutationObserver(() => {
        if (App._enhanceQueued) return;
        App._enhanceQueued = true;
        requestAnimationFrame(() => { App._enhanceQueued = false; App.enhanceTables(); });
      });
      App._obs.observe(main, { childList: true, subtree: true });
      App.enhanceTables();
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeLoadCache, App };
}
