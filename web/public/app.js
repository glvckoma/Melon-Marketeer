const view = document.getElementById('view');

const api = async (path) => {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
};
const post = async (path, body) => {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US'));
const ago = (ts) => {
  if (!ts) return 'unknown';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const plural = (n, word) => `${num(n)} ${word}${Number(n) === 1 ? '' : 's'}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const KNOWN_COLORS = new Set(['black', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'gold']);
const swatch =(color) => (color && color.css ? `<span class="swatch" style="background:${esc(color.css)}" title="${esc(color.hex || '')}"></span>` : '');
const swatchHex = (hex) => (hex ? `<span class="swatch" style="background:${esc(hex)}"></span>` : '');
const curIcon = (cur) => cur === 'diamonds'
  ? '<svg class="cur-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14l3 6-10 12L2 9z" opacity=".9"/><path d="M2 9h20l-10 12z" opacity=".55"/></svg>'
  : '<svg class="cur-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10l5 7-10 11L2 10z" opacity=".9"/><path d="M7 3l5 7 5-7M2 10h20" stroke="currentColor" stroke-width="1" fill="none" opacity=".5"/></svg>';
const curTag = (cur) => `<span class="cur-tag ${cur}">${curIcon(cur)}${cur}</span>`;
const priceFmt = (cost, cur) => `<span class="price ${cur}">${num(cost)}</span> ${curTag(cur)}`;
const itemLink = (it) => `#/item/${it.itemType}/${it.defId}`;
const sellerLink = (name) => `#/seller/${encodeURIComponent(name)}`;

const SEO_DEFAULT = {
  title: 'Melon Marketeer - Live Animal Jam Classic Item Worth & Shop Prices',
  description: "Look up any Animal Jam Classic item's worth by color, see live player shop prices, who is selling it, and how values trend."
};
function setMeta(selector, attr, value, create) {
  let el = document.head.querySelector(selector);
  if (!el && create) { el = document.createElement('meta'); el.setAttribute(create.key, create.val); document.head.appendChild(el); }
  if (el) el.setAttribute(attr, value);
}
function setSEO({ title, description } = {}) {
  const t = title || SEO_DEFAULT.title;
  const d = description || SEO_DEFAULT.description;
  document.title = t;
  setMeta('meta[name="description"]', 'content', d, { key: 'name', val: 'description' });
  setMeta('meta[property="og:title"]', 'content', t, { key: 'property', val: 'og:title' });
  setMeta('meta[property="og:description"]', 'content', d, { key: 'property', val: 'og:description' });
  setMeta('meta[name="twitter:title"]', 'content', t, { key: 'name', val: 'twitter:title' });
  setMeta('meta[name="twitter:description"]', 'content', d, { key: 'name', val: 'twitter:description' });
}

const spinner = () => { view.innerHTML = '<div class="spinner">Loading...</div>'; };
const errorView = (msg) => { view.innerHTML = `<div class="empty">Something went wrong: ${esc(msg)}</div>`; };

const CONF = { exact: ['conf-exact', 'exact match'], high: ['conf-high', 'close match'], medium: ['conf-med', 'fuzzy match'], low: ['conf-med', 'fuzzy match'] };
function confChip(confidence) {
  const c = CONF[confidence];
  return c ? `<span class="chip ${c[0]}" title="wiki match confidence">${c[1]}</span>` : '';
}
function freshness(observations, lastSeen) {
  const parts = [];
  if (observations != null) parts.push(`${num(observations)} obs`);
  if (lastSeen) parts.push(`seen ${ago(lastSeen)}`);
  return parts.length ? `<span class="freshness">${parts.join(' · ')}</span>` : '';
}
function dataTable(columns, rows, opts = {}) {
  const head = columns.map((c, i) => {
    const sortable = c.sortable !== false;
    const cls = [c.num ? 'num' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ');
    return `<th${cls ? ` class="${cls}"` : ''}${sortable ? ` data-col="${i}"` : ''}${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}${sortable ? '<span class="sort-caret"></span>' : ''}</th>`;
  }).join('');
  if (!rows.length) {
    return `<div class="dt-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody><tr><td class="empty-cell" colspan="${columns.length}">${esc(opts.empty || 'Nothing here yet.')}</td></tr></tbody></table></div>`;
  }
  const body = rows.map((r) => `<tr>${columns.map((c) => {
    const sv = c.sortVal ? c.sortVal(r) : null;
    const isNum = typeof sv === 'number';
    const ds = sv != null ? ` data-sort="${esc(String(sv))}" data-num="${isNum ? 1 : 0}"` : '';
    return `<td${c.num ? ' class="num"' : ''} data-label="${esc(c.label)}"${ds}>${c.cell(r)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="dt-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

document.addEventListener('click', (e) => {
  const th = e.target.closest && e.target.closest('th.sortable');
  if (!th || !th.closest('.dt')) return;
  const table = th.closest('table');
  const tbody = table.querySelector('tbody');
  const idx = Number(th.dataset.col);
  const rows = [...tbody.querySelectorAll('tr')].filter((r) => !r.querySelector('.empty-cell'));
  if (!rows.length) return;
  const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
  table.querySelectorAll('th[aria-sort]').forEach((h) => h.removeAttribute('aria-sort'));
  th.setAttribute('aria-sort', dir);
  const cellAt = (tr) => tr.children[idx];
  const isNum = cellAt(rows[0]) && cellAt(rows[0]).getAttribute('data-num') === '1';
  rows.sort((a, b) => {
    const ca = cellAt(a), cb = cellAt(b);
    let va = ca ? ca.getAttribute('data-sort') : '';
    let vb = cb ? cb.getAttribute('data-sort') : '';
    if (isNum) {
      va = parseFloat(va); vb = parseFloat(vb);
      if (Number.isNaN(va)) va = -Infinity;
      if (Number.isNaN(vb)) vb = -Infinity;
      return dir === 'ascending' ? va - vb : vb - va;
    }
    va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase();
    return dir === 'ascending' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  rows.forEach((r) => tbody.appendChild(r));
});

const LOADING_MSGS = [
  'Fetching the freshest prices',
  'Counting diamonds',
  'Polling the jammers',
  'Checking the dens'
];
function rotateLoadingMsg() {
  let i = Math.floor(Math.random() * LOADING_MSGS.length);
  let id;
  const paint = () => {
    const el = document.getElementById('sk-msg');
    if (!el) { clearInterval(id); return; }
    el.textContent = LOADING_MSGS[i % LOADING_MSGS.length] + '...';
    i++;
  };
  id = setInterval(paint, 1500);
  paint();
}

function skeleton(kind = 'list') {
  const bar = (w) => `<span class="sk sk-bar" style="width:${w}"></span>`;
  const card = `<div class="sk-card">${bar('70%')}${bar('40%')}${bar('55%')}</div>`;
  if (kind === 'item') {
    view.innerHTML = `<div class="sk-wrap"><div class="sk sk-line" style="width:240px;height:30px;"></div><div class="sk sk-hero"></div><div class="sk-grid">${card.repeat(0)}</div><div class="sk sk-block"></div></div>`;
    return;
  }
  view.innerHTML = `<div class="sk-wrap"><div class="sk-caption"><img class="sk-melon" src="melon-icon.png" alt="" width="24" height="24" /><span id="sk-msg">Loading...</span></div><div class="sk-grid">${card.repeat(kind === 'home' ? 8 : 6)}</div></div>`;
  rotateLoadingMsg();
}

function lineChart(points) {
  if (!points || points.length < 2) return '<div class="muted">Not enough history yet.</div>';
  const vals = points.map((p) => p.median).filter((v) => v != null);
  if (vals.length < 2) return '<div class="muted">Not enough history yet.</div>';
  const W = 720, H = 200, padX = 6, padY = 10;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX * 2);
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  let d = '';
  points.forEach((p, i) => { if (p.median == null) return; d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.median).toFixed(1)} `; });
  const area = `M${x(0).toFixed(1)},${(H - padY).toFixed(1)} ${d.replace(/^M/, 'L')} L${x(points.length - 1).toFixed(1)},${(H - padY).toFixed(1)} Z`;
  const r = points.length > 40 ? 1.8 : 3;
  const dots = points.map((p, i) => (p.median == null ? '' : `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(p.median).toFixed(1)}" r="${r}" />`)).join('');
  const mid = Math.round((min + max) / 2);
  return `<div style="display:flex;gap:10px;align-items:stretch;">
    <div style="display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:var(--muted);text-align:right;min-width:40px;">
      <span>${num(max)}</span>${min !== max ? `<span>${num(mid)}</span>` : ''}<span>${num(min)}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="flex:1;min-width:0;">
      <path class="chart-area" d="${area}" />
      <path class="chart-line" d="${d.trim()}" />
      ${dots}
    </svg>
  </div>
  <div class="muted" style="font-size:12px;margin-top:6px;padding-left:50px;">${plural(points.length, 'capture')}, oldest to newest</div>`;
}

function dedupeByName(list) {
  const score = (it) => Number(it.obs != null ? it.obs : (it.observations != null ? it.observations : (it.sellers || 0))) || 0;
  const best = new Map();
  for (const it of list || []) {
    const key = String(it.name || '').trim().toLowerCase();
    if (!key) continue;
    const cur = best.get(key);
    if (!cur || score(it) > score(cur)) best.set(key, it);
  }
  const emitted = new Set();
  const out = [];
  for (const it of list || []) {
    const key = String(it.name || '').trim().toLowerCase();
    if (!key) { out.push(it); continue; }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push(best.get(key));
  }
  return out;
}

function itemCard(it) {
  const price = it.median != null ? it.median : it.min;
  return `<a class="card" href="${itemLink(it)}">
    <div class="title">${esc(it.name)}</div>
    <div class="row"><span>median</span><span>${priceFmt(price, it.currency)}</span></div>
    <div class="row"><span>${plural(it.sellers, 'seller')}</span><span class="muted">${ago(it.lastSeen)}</span></div>
  </a>`;
}

function colorItemCard(it) {
  return `<a class="card" href="#/item/${it.itemType}/${it.defId}">
    <div class="title">${esc(it.name)}</div>
    <div class="row"><span class="muted">${TYPE_LABEL[it.itemType] || ''}</span><span class="muted">${plural(it.observations, 'sighting')}</span></div>
  </a>`;
}

function sellerCard(s) {
  return `<a class="card" href="${sellerLink(s.owner_name)}">
    <div class="title">${esc(s.owner_name)}</div>
    <div class="row"><span>${plural(s.items, 'item')}</span><span class="muted">${ago(s.last_seen)}</span></div>
  </a>`;
}

let viewTimer = null;
let homeData = null;
let recentShown = 25;
const RECENT_PAGE = 25;

function showcaseCard(it, i) {
  const worth = it.worthText || it.tradeDisplay
    || ((it.median != null || it.max != null) ? priceFmt(it.median != null ? it.median : it.max, it.currency) : '');
  const thumb = it.image
    ? `<div class="scard-thumb"><img src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy" /></div>`
    : '<div class="scard-thumb empty"></div>';
  const color = it.imageColorMatch && it.topColor && (it.topColor.label || it.topColor.color)
    ? `<div class="scard-color">${swatchHex(it.topColor.color)}${esc(it.topColor.label || '')}</div>`
    : '';
  return `<a class="scard" href="${itemLink(it)}">
    <span class="rankbadge">${i + 1}</span>
    ${thumb}
    <div class="scard-name">${esc(it.name)}</div>
    ${color}
    <div class="scard-worth">${esc(worth)}</div>
  </a>`;
}

function dealCard(d) {
  return `<a class="deal-card" href="${itemLink(d)}">
    <div class="deal-top"><span class="deal-name">${esc(d.name)}</span><span class="deal-badge">-${d.discount}%</span></div>
    <div class="deal-prices">${priceFmt(d.cost, d.currency)}<span class="deal-median">median ${num(d.median)}</span></div>
    <div class="deal-meta muted">${plural(d.sellers, 'seller')} &middot; seen ${ago(d.lastSeen)}</div>
  </a>`;
}

function worthRailCard(c, i) {
  const label = c.label || c.color || 'default';
  const worth = c.worthText || c.tradeDisplay || '';
  const thumb = c.image
    ? `<div class="wc-rail-thumb"><img src="${esc(c.image)}" alt="${esc(label)}" loading="lazy" /></div>`
    : '<div class="wc-rail-thumb empty"></div>';
  return `<div class="wc-rail clickable${i === 0 ? ' active' : ''}" role="button" tabindex="0" data-img="${esc(c.image || '')}" data-label="${esc(label)}" data-hex="${esc(c.colorHex || '')}" data-worth="${esc(worth)}">
    ${thumb}
    <div class="wc-rail-body"><div class="wc-color">${swatchHex(c.colorHex)}${esc(label)}</div><div class="wc-worth">${esc(worth)}</div></div>
  </div>`;
}

function recentRowsHtml(rows) {
  if (!rows.length) return '<tr><td class="empty-cell" colspan="4">No recent activity yet.</td></tr>';
  return rows.map((r) => `<tr>
    <td data-label="Item"><a href="#/item/${r.itemType}/${r.defId}">${swatch(r.color)}${esc(r.item)}</a></td>
    <td class="num" data-label="Price">${priceFmt(r.cost, r.currency)}</td>
    <td data-label="Seller"><a href="${sellerLink(r.seller)}">${esc(r.seller)}</a></td>
    <td class="num" data-label="Seen"><span class="muted">${ago(r.scrapedAt)}</span></td>
  </tr>`).join('');
}

const renderShowcase = (items) => ((items || []).slice(0, 8).map(showcaseCard).join('') || '<div class="empty">No data yet.</div>');
const renderDeals = (deals) => ((deals || []).map(dealCard).join('') || '<div class="empty">No standout deals right now.</div>');

const BROWSE_TILES = `<div class="cat-tiles">
  <a class="cat-tile" href="#/sellers"><span class="tico"><i data-lucide="store"></i></span><span>Browse sellers<span class="tsub">every tracked shop</span></span></a>
  <a class="cat-tile" href="#/submit"><span class="tico"><i data-lucide="plus"></i></span><span>Add usernames<span class="tsub">track a shop</span></span></a>
</div>`;

const recentHasMore = () => !!(homeData && homeData.trending && recentShown < homeData.trending.length);
function syncRecentBody() {
  const body = document.getElementById('recent-body');
  if (!body || !homeData) return;
  body.innerHTML = recentRowsHtml((homeData.trending || []).slice(0, recentShown));
  const btn = document.getElementById('recent-more-btn');
  if (btn) btn.style.display = recentHasMore() ? '' : 'none';
}

async function home() {
  skeleton('home');
  homeData = await api('/overview');
  recentShown = RECENT_PAGE;
  const o = homeData;
  const dealsSection = (o.topDeals && o.topDeals.length) ? `
    <section class="section">
      <div class="section-head"><h2>Top deals</h2><span class="muted">best price seen vs typical</span></div>
      <div class="deals-grid" id="deals-wrap">${renderDeals(o.topDeals)}</div>
    </section>` : '';
  view.innerHTML = `
    <section class="hero">
      <h1>Animal Jam Classic prices and worth</h1>
      <p>Look up any item to see its worth by color. See who is selling it and how the price moves. Always check a trade in game.</p>
      <form class="hero-search" id="hero-search">
        <input id="hero-input" type="search" placeholder="Try 'Spiked Collar', 'Headdress', or a color..." autocomplete="off" />
        <button type="submit">Search</button>
      </form>
      <div class="stat-strip">
        <div class="stat-pill"><b>${num(o.stats.observations)}</b><span>price observations</span></div>
        <div class="stat-pill"><b>${num(o.stats.sellers)}</b><span>shops tracked</span></div>
        <div class="stat-pill"><b>${num(o.stats.items)}</b><span>items known</span></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Most valuable right now</h2></div>
      <div class="showcase" id="showcase-wrap">${renderShowcase(o.mostValuable)}</div>
    </section>
    ${dealsSection}
    <section class="section">
      <div class="section-head"><h2>Browse</h2></div>
      ${BROWSE_TILES}
    </section>
    <section class="section">
      <div class="section-head"><h2>Recently seen</h2><span class="muted">live shop activity</span></div>
      <div class="recent-feed">
        <div class="dt-wrap"><table class="dt"><thead><tr><th>Item</th><th class="num">Price</th><th>Seller</th><th class="num">Seen</th></tr></thead><tbody id="recent-body">${recentRowsHtml((o.trending || []).slice(0, recentShown))}</tbody></table></div>
        <div class="recent-more"><button class="btn ghost" id="recent-more-btn" type="button"${recentHasMore() ? '' : ' style="display:none"'}>Load more</button></div>
      </div>
    </section>`;
  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('hero-input').value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
  const moreBtn = document.getElementById('recent-more-btn');
  if (moreBtn) moreBtn.addEventListener('click', () => { recentShown += RECENT_PAGE; syncRecentBody(); });
  bindTypeahead(document.getElementById('hero-search'), document.getElementById('hero-input'));
  startHomeLive();
}

function startHomeLive() {
  clearInterval(viewTimer);
  viewTimer = setInterval(async () => {
    const seg = location.hash.slice(1).split('?')[0];
    const showcaseWrap = document.getElementById('showcase-wrap');
    const body = document.getElementById('recent-body');
    if ((seg && seg !== '/') || (!showcaseWrap && !body)) { clearInterval(viewTimer); viewTimer = null; return; }
    try {
      homeData = await api('/overview');
      if (showcaseWrap) showcaseWrap.innerHTML = renderShowcase(homeData.mostValuable);
      const dealsWrap = document.getElementById('deals-wrap');
      if (dealsWrap) dealsWrap.innerHTML = renderDeals(homeData.topDeals);
      const wrap = document.querySelector('.recent-feed .dt-wrap');
      if (body && wrap && wrap.scrollTop <= 40) syncRecentBody();
      if (window.lucide) window.lucide.createIcons();
    } catch {}
  }, 25000);
}

async function search(params) {
  const q = params.get('q') || '';
  const colorFilter = KNOWN_COLORS.has((params.get('color') || '').trim().toLowerCase()) ? (params.get('color') || '').trim().toLowerCase() : '';
  spinner();
  const colorQ = q.trim().toLowerCase() === 'grey' ? 'gray' : q.trim().toLowerCase();
  const isColor = KNOWN_COLORS.has(q.trim().toLowerCase());
  const [items, sellers, colorItems, filterItems] = await Promise.all([
    api(`/items?q=${encodeURIComponent(q)}&limit=60`),
    api(`/sellers?q=${encodeURIComponent(q)}&limit=12`),
    isColor ? api(`/colorsearch?color=${encodeURIComponent(colorQ)}&limit=60`).catch(() => []) : Promise.resolve([]),
    colorFilter ? api(`/colorsearch?color=${encodeURIComponent(colorFilter)}&limit=400`).catch(() => []) : Promise.resolve(null)
  ]);
  let itemList = dedupeByName(items);
  if (colorFilter && filterItems) {
    const allow = new Set(filterItems.map((x) => x.itemType + ':' + x.defId));
    itemList = itemList.filter((it) => allow.has(it.itemType + ':' + it.defId));
  }
  const colorHits = (colorItems && colorItems.length)
    ? `<section class="section"><div class="section-head"><h2>${esc(cap(colorQ))} items <span class="muted">${plural(colorItems.length, 'item')}</span></h2></div><div class="grid">${colorItems.map(colorItemCard).join('')}</div></section>`
    : '';
  const sellerHits = sellers.length
    ? `<section class="section"><div class="section-head"><h2>Sellers matching "${esc(q)}"</h2></div><div class="grid">${sellers.map(sellerCard).join('')}</div></section>`
    : '';
  const colorOpts = ['<option value="">All colors</option>']
    .concat([...KNOWN_COLORS].sort().map((c) => `<option value="${c}"${c === colorFilter ? ' selected' : ''}>${esc(cap(c))}</option>`))
    .join('');
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Search</div>
    ${colorHits}
    <section class="section">
      <div class="section-head"><h2>Items matching "${esc(q)}"${colorFilter ? ` in ${esc(cap(colorFilter))}` : ''}</h2><select id="search-color" style="max-width:160px;">${colorOpts}</select></div>
      <div class="grid">${itemList.map(itemCard).join('') || `<div class="empty">No items match that search${colorFilter ? ` in ${esc(cap(colorFilter))}` : ''}.</div>`}</div>
    </section>
    ${sellerHits}`;
  const csel = document.getElementById('search-color');
  if (csel) csel.addEventListener('change', () => {
    const c = csel.value;
    location.hash = `#/search?q=${encodeURIComponent(q)}${c ? `&color=${encodeURIComponent(c)}` : ''}`;
  });
}

async function itemView(type, def) {
  skeleton('item');
  const d = await api(`/item?type=${type}&def=${def}`);
  const observed = d.observed;
  const primary = d.stats[0] || {};
  const totalObs = d.stats.reduce((a, s) => a + (s.observations || 0), 0);
  const lastSeen = Math.max(0, ...d.stats.map((s) => s.lastSeen || 0)) || null;
  const seoName = d.itemName || `Item ${def}`;
  const seoTopCw = d.wiki && d.wiki.colorWorth && d.wiki.colorWorth[0];
  const seoWorth = seoTopCw && (seoTopCw.worthText || seoTopCw.tradeDisplay) ? ` Worth about ${seoTopCw.worthText || seoTopCw.tradeDisplay}.` : '';
  setSEO({ title: `${seoName} Worth & Value - Animal Jam Classic | Melon Marketeer`, description: `${seoName} for Animal Jam Classic.${seoWorth} See live player shop prices, worth by color, and who is selling it.` });
  const trustParts = [];
  if (d.wiki && d.wiki.confidence) trustParts.push(confChip(d.wiki.confidence));
  if (observed) trustParts.push(freshness(totalObs, lastSeen));
  if (observed) trustParts.push(`<span class="freshness">${plural(d.sellers.length, 'seller')}</span>`);
  const trustStrip = trustParts.filter(Boolean).length ? `<div class="trust-strip">${trustParts.filter(Boolean).join('')}</div>` : '';
  const metrics = d.stats.map((s) => `
    <div class="metric"><div class="k">median (${s.currency})</div><div class="v price ${s.currency}">${num(s.median)}</div></div>
    <div class="metric"><div class="k">range (${s.currency})</div><div class="v">${num(s.min)} - ${num(s.max)}</div></div>
    <div class="metric"><div class="k">sellers (${s.currency})</div><div class="v">${num(s.sellers)}</div></div>`).join('');
  const colorMed = (c) => (c.median != null ? c.median : c.min);
  const colorLabel = (c) => (c.color ? (c.color.name || c.color.hex || 'colored') : 'default');
  const sellerColorOptions = [...new Set(d.sellers.map((s) => s.color && s.color.name).filter(Boolean))].sort()
    .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const colorsSection = d.colors.length ? `<section class="section">
      <div class="section-head"><h2>Color variants</h2>
        <div class="filters"><select id="cv-sort"><option value="common">Most common</option><option value="color">By color name</option><option value="cheapest">Cheapest</option><option value="priciest">Priciest</option></select></div>
      </div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Color</th><th>Currency</th><th class="num">Median</th><th class="num">Range</th><th class="num">Seen</th></tr></thead><tbody id="colors-body"></tbody></table></div>
    </section>` : '';
  const holders = d.tradeHolders || [];
  const holdersSection = holders.length ? `<section class="section">
      <div class="section-head"><h2>In tradelist (${holders.length} ${holders.length === 1 ? 'holder' : 'holders'})</h2></div>
      ${dataTable([
        { label: 'Holder', cell: (h) => `<a href="${sellerLink(h.owner)}">${esc(h.owner)}</a>`, sortVal: (h) => (h.owner || '').toLowerCase() },
        { label: 'Status', sortable: false, cell: (h) => renderPresence(h.presence) || '<span class="muted">not seen lately</span>' }
      ], holders)}
    </section>` : '';
  const historyCur = primary.currency || 'diamonds';
  const w = d.wiki;
  const realColorNames = new Set((d.colors || []).map((c) => c.color && c.color.name).filter(Boolean).map((n) => n.toLowerCase()));
  const rawColorWorth = (w && w.colorWorth) || [];
  let colorWorth = rawColorWorth;
  if (realColorNames.size) {
    const matched = rawColorWorth.filter((c) => c.color && realColorNames.has(String(c.color).toLowerCase()));
    colorWorth = matched.length ? matched : (d.colors || []).map((c) => ({
      label: c.color && c.color.name,
      color: c.color && c.color.name,
      worthText: null,
      tradeDisplay: null,
      image: d.defaultImage || null,
      colorHex: (c.color && (c.color.css || c.color.hex)) || null
    }));
  }
  if (colorWorth.length > 1) {
    const byLabel = new Map();
    colorWorth.forEach((c) => {
      const key = String(c.label || c.color || '').toLowerCase();
      const prev = byLabel.get(key);
      if (!prev || (Number(c.tradeValue) || 0) > (Number(prev.tradeValue) || 0)) byLabel.set(key, c);
    });
    colorWorth = [...byLabel.values()];
  }
  const hasWorthRail = colorWorth.length > 0;
  const gallery = d.images || [];
  const topCw = colorWorth[0] || null;
  const heroSrc = (topCw && topCw.image) || d.defaultImage || (gallery[0] && gallery[0].src) || null;
  const heroColorHtml = topCw ? `${swatchHex(topCw.colorHex)}${esc(topCw.label || topCw.color || '')}` : '';
  const heroWorthText = topCw ? esc(topCw.worthText || topCw.tradeDisplay || '') : '';
  const heroHtml = (heroSrc || hasWorthRail)
    ? `<div class="d-hero">
        <div class="d-hero-thumb${heroSrc ? '' : ' empty'}" id="hero-thumb"><img id="hero-img" alt="${esc(d.itemName || '')}"${heroSrc ? ` src="${esc(heroSrc)}"` : ''} /></div>
        <div class="d-hero-meta"><div class="d-hero-color" id="hero-color">${heroColorHtml}</div><div class="d-hero-worth" id="hero-worth">${heroWorthText ? `worth in this color <b>${heroWorthText}</b>` : ''}</div></div>
      </div>`
    : '<div class="muted" style="margin-bottom:16px;">No image yet.</div>';
  const galleryHtml = (!hasWorthRail && gallery.length > 1)
    ? `<div class="wiki-gallery">${gallery.slice(0, 24).map((i) => `<figure class="wiki-img${i.src === heroSrc ? ' active' : ''}" data-full="${esc(i.src)}" data-label="${esc(i.label || '')}" role="button" tabindex="0"><img src="${esc(i.src)}" alt="${esc(i.label || '')}" loading="lazy" /><figcaption>${esc(i.label || '')}</figcaption></figure>`).join('')}</div>`
    : '';
  const wikiLinkHtml = (w && w.url) ? `<a class="chip link" href="${esc(w.url)}" target="_blank" rel="noopener">View on wiki &#8599;</a>` : '';
  const wikiWorthBits = [w && w.tradeDisplay ? `Trade value: <b>${esc(w.tradeDisplay)}</b>` : '', w && w.worthText ? `Wiki worth: <b>${esc(w.worthText)}</b>` : ''].filter(Boolean);
  const wikiBar = (wikiWorthBits.length || wikiLinkHtml) ? `<div class="wiki-price">${wikiWorthBits.join(' &middot; ')}${wikiWorthBits.length && wikiLinkHtml ? ' ' : ''}${wikiLinkHtml}</div>` : '';
  const railHtml = hasWorthRail ? `<aside class="item-rail"><div class="rail-card">
      <div class="section-head"><h2>Worth by color</h2></div>
      <div class="rail-hint">Click a color to preview it &middot; community worth</div>
      <div class="wc-rail-list">${colorWorth.map(worthRailCard).join('')}</div>
    </div></aside>` : '';
  const marketHtml = observed ? `
    <div class="stat-row">${metrics}</div>
    <section class="section">
      <div class="section-head"><h2>Price history</h2>
        <div class="filters">
          <select id="hist-cur"><option value="diamonds">Diamonds</option><option value="gems">Gems</option></select>
          <select id="hist-days"><option value="90">90 days</option><option value="30">30 days</option><option value="7">7 days</option></select>
        </div>
      </div>
      <div class="chart-wrap" id="chart">Loading chart...</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Who's selling</h2>
        <div class="filters">
          <select id="sf-cur"><option value="all">All currency</option><option value="diamonds">Diamonds</option><option value="gems">Gems</option></select>
          <select id="sf-color"><option value="all">All colors</option>${sellerColorOptions}</select>
          <select id="sf-sort"><option value="cheapest">Cheapest</option><option value="priciest">Priciest</option><option value="recent">Recently seen</option></select>
        </div>
      </div>
      <div class="dt-wrap"><table class="dt"><thead><tr><th>Seller</th><th>Color</th><th class="num">Price</th><th class="num">Seen</th></tr></thead><tbody id="sellers-body"></tbody></table></div>
    </section>
    ${holdersSection}
    ${colorsSection}` : `
    <section class="section">
      <div class="section-head"><h2>Market data</h2></div>
      <div class="empty">No shop prices tracked yet.${w && w.worthText ? ' The community worth above is the best guess for now.' : ''} Be the first to report a seller below.</div>
    </section>
    ${holdersSection}`;
  const ctaHtml = `
    <section class="section">
      <div class="section-head"><h2>Have this item or know someone who does?</h2></div>
      <div class="cta-have">
        <p class="muted">Add the Animal Jam username of someone who has it. We will start tracking it.</p>
        <form id="have-form" class="have-form" autocomplete="off">
          <input id="have-user" type="text" placeholder="Animal Jam username" maxlength="20" />
          <button class="btn" type="submit">Submit</button>
        </form>
        <div id="have-msg" class="muted"></div>
      </div>
    </section>`;
  const mainInner = hasWorthRail
    ? `${heroHtml}${marketHtml}`
    : `${heroHtml}${galleryHtml}${marketHtml}`;
  const detailBody = hasWorthRail
    ? `<div class="item-cols"><div class="item-main">${mainInner}</div>${railHtml}</div>`
    : mainInner;
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Item</div>
    <div class="detail-head"><h1>${esc(d.itemName || `Item #${def}`)}</h1></div>
    ${trustStrip}
    ${wikiBar}
    ${detailBody}
    ${ctaHtml}`;
  const haveForm = document.getElementById('have-form');
  if (haveForm) {
    const hmsg = document.getElementById('have-msg');
    const huser = document.getElementById('have-user');
    haveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = huser.value.trim();
      if (!username) { hmsg.textContent = 'Enter a username.'; return; }
      hmsg.textContent = 'Submitting...';
      const { status, data } = await post('/submit', { username });
      hmsg.textContent = status === 200 ? "Thanks! We'll scrape their den soon." : (data.error || 'Could not submit.');
      if (status === 200) huser.value = '';
    });
  }
  const setHero = ({ src, label, hex, worth }) => {
    const thumb = document.getElementById('hero-thumb');
    const img = document.getElementById('hero-img');
    if (!thumb || !img) return;
    if (src) { thumb.classList.remove('empty'); img.src = src; }
    else { thumb.classList.add('empty'); img.removeAttribute('src'); }
    const colorEl = document.getElementById('hero-color');
    if (colorEl) colorEl.innerHTML = label ? `${swatchHex(hex)}${esc(label)}` : '';
    const worthEl = document.getElementById('hero-worth');
    if (worthEl) worthEl.innerHTML = worth ? `worth in this color <b>${esc(worth)}</b>` : '';
  };
  view.querySelectorAll('.wc-rail.clickable').forEach((card) => {
    const pick = () => {
      view.querySelectorAll('.wc-rail.active').forEach((a) => a.classList.remove('active'));
      card.classList.add('active');
      setHero({ src: card.dataset.img || null, label: card.dataset.label, hex: card.dataset.hex, worth: card.dataset.worth });
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  const galleryEl = view.querySelector('.wiki-gallery');
  if (galleryEl) {
    galleryEl.querySelectorAll('.wiki-img').forEach((fig) => {
      const pick = () => {
        if (!fig.dataset.full) return;
        setHero({ src: fig.dataset.full, label: fig.dataset.label || '' });
        galleryEl.querySelectorAll('.wiki-img.active').forEach((a) => a.classList.remove('active'));
        fig.classList.add('active');
      };
      fig.addEventListener('click', pick);
      fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }
  if (!observed) return;
  function renderSellers() {
    const cur = document.getElementById('sf-cur').value;
    const colr = document.getElementById('sf-color').value;
    const sort = document.getElementById('sf-sort').value;
    let rows = d.sellers.slice();
    if (cur !== 'all') rows = rows.filter((s) => s.currency === cur);
    if (colr !== 'all') rows = rows.filter((s) => (s.color && s.color.name) === colr);
    rows.sort((a, b) => sort === 'recent' ? (b.lastSeen || 0) - (a.lastSeen || 0) : sort === 'priciest' ? b.cost - a.cost : a.cost - b.cost);
    document.getElementById('sellers-body').innerHTML = rows.length
      ? rows.map((s) => `<tr><td data-label="Seller"><a href="${sellerLink(s.seller)}">${esc(s.seller)}</a></td><td data-label="Color">${s.color && s.color.name ? `${swatch(s.color)}<span class="muted" style="font-size:12px;">${esc(s.color.name)}</span>` : ''}</td><td class="num" data-label="Price">${priceFmt(s.cost, s.currency)}</td><td class="num muted" data-label="Seen">${ago(s.lastSeen)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No sellers match these filters.</td></tr>';
  }
  ['sf-cur', 'sf-color', 'sf-sort'].forEach((id) => document.getElementById(id).addEventListener('change', renderSellers));
  renderSellers();
  if (d.colors.length) {
    const wikiColors = new Set(((w && w.colorWorth) || []).map((c) => String(c.label || c.color || '').toLowerCase().trim()).filter(Boolean));
    const NEUTRAL = new Set(['black', 'white']);
    const reliableColors = d.colors.filter((c) => {
      const nm = c.color && c.color.name ? c.color.name.toLowerCase() : '';
      if (wikiColors.size >= 3 && nm && NEUTRAL.has(nm) && !wikiColors.has(nm)) return false;
      return true;
    });
    const renderColors = () => {
      const sort = document.getElementById('cv-sort').value;
      const rows = reliableColors.slice();
      if (sort === 'color') rows.sort((a, b) => colorLabel(a).localeCompare(colorLabel(b)));
      else if (sort === 'cheapest') rows.sort((a, b) => colorMed(a) - colorMed(b));
      else if (sort === 'priciest') rows.sort((a, b) => colorMed(b) - colorMed(a));
      else rows.sort((a, b) => (b.observations || 0) - (a.observations || 0));
      document.getElementById('colors-body').innerHTML = rows.map((c) => `<tr><td data-label="Color">${swatch(c.color)}${esc(colorLabel(c))}</td><td data-label="Currency">${curTag(c.currency)}</td><td class="num" data-label="Median">${num(colorMed(c))}</td><td class="num" data-label="Range">${num(c.min)} - ${num(c.max)}</td><td class="num muted" data-label="Seen">${ago(c.lastSeen)}</td></tr>`).join('');
    };
    document.getElementById('cv-sort').addEventListener('change', renderColors);
    renderColors();
  }
  const histCur = document.getElementById('hist-cur');
  if ([...histCur.options].some((o) => o.value === historyCur)) histCur.value = historyCur;
  const loadHistory = () => {
    document.getElementById('chart').innerHTML = 'Loading chart...';
    api(`/item/history?type=${type}&def=${def}&currency=${histCur.value}&days=${document.getElementById('hist-days').value}`)
      .then((h) => { document.getElementById('chart').innerHTML = lineChart(h); })
      .catch(() => { document.getElementById('chart').innerHTML = '<div class="muted">History unavailable.</div>'; });
  };
  histCur.addEventListener('change', loadHistory);
  document.getElementById('hist-days').addEventListener('change', loadHistory);
  loadHistory();
}

function renderPresence(pr) {
  if (!pr) return '';
  if (pr.isLive) return '<span class="presence online"><span class="dot"></span>Online now</span>';
  if (pr.lastSeen) return `<span class="presence offline"><span class="dot"></span>Seen ${ago(pr.lastSeen)}</span>`;
  return '';
}

async function sellerView(name) {
  spinner();
  const d = await api(`/seller?name=${encodeURIComponent(name)}`);
  setSEO({ title: `${name}'s Animal Jam Classic shop - prices & trades | Melon Marketeer`, description: `Shop prices, inventory, and trades for ${name} on Animal Jam Classic. Tracked by Melon Marketeer.` });
  const inventoryTable = dataTable([
    { label: 'Item', cell: (r) => `<a href="#/item/${r.itemType}/${r.defId}">${swatch(r.color)}${esc(r.name)}</a>`, sortVal: (r) => (r.name || '').toLowerCase() },
    { label: 'Price', num: true, cell: (r) => priceFmt(r.cost, r.currency), sortVal: (r) => r.cost },
    { label: 'Seen', num: true, cell: (r) => `<span class="muted">${ago(r.lastSeen)}</span>`, sortVal: (r) => r.lastSeen }
  ], d.inventory, { empty: 'No items recorded for this seller.' });
  const tradeList = d.tradeList || [];
  const tradeListSection = tradeList.length ? `<section class="section">
      <div class="section-head"><h2>Trade list <span class="muted">${plural(tradeList.length, 'item')}</span></h2></div>
      ${dataTable([
        { label: 'Item', cell: (r) => `<a href="#/item/${r.itemType}/${r.defId}">${swatch(r.color)}${esc(r.name)}</a>`, sortVal: (r) => (r.name || '').toLowerCase() },
        { label: 'Captured', num: true, cell: (r) => `<span class="muted">${ago(r.lastSeen)}</span>`, sortVal: (r) => r.lastSeen }
      ], tradeList)}
    </section>` : '';
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Seller</div>
    <div class="seller-head">
      <div class="seller-banner"></div>
      <div class="seller-head-body">
        <div class="seller-id"><h1>${esc(name)}${renderPresence(d.presence)}</h1></div>
        <div class="seller-actions">
          <button class="btn ghost" id="recheck-btn" title="Queue a priority re-check of this shop">Re-check shop</button>
        </div>
      </div>
      <div class="seller-head-body shopstat-row">
        <div class="shopstat">
          <div><div class="n">${num(d.inventory.length)}</div><div class="l">items in shop</div></div>
          ${tradeList.length ? `<div><div class="n">${num(tradeList.length)}</div><div class="l">in trade list</div></div>` : ''}
        </div>
      </div>
    </div>
    <section class="section"><div class="section-head"><h2>Shop inventory</h2><span class="muted" style="font-size:12px;">latest observed prices</span></div>${inventoryTable}</section>
    ${tradeListSection}`;
  const recheckBtn = document.getElementById('recheck-btn');
  recheckBtn.addEventListener('click', async () => {
    recheckBtn.disabled = true;
    const { status, data } = await post('/recheck', { owner: name });
    if (status === 200) {
      recheckBtn.textContent = 'Queued for re-check';
    } else {
      recheckBtn.disabled = false;
      recheckBtn.textContent = (data && data.error) || 'Try again';
    }
  });
}

async function sellersView(params) {
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'recent';
  spinner();
  const sellers = await api(`/sellers?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&limit=60`);
  const sortTabs = [
    { key: 'recent', label: 'Recently Active' },
    { key: 'items', label: 'Most Items' }
  ].map((t) => {
    const href = q ? `#/sellers?q=${encodeURIComponent(q)}&sort=${t.key}` : `#/sellers?sort=${t.key}`;
    return `<a class="tab${sort === t.key ? ' active' : ''}" href="${href}">${t.label}</a>`;
  }).join('');
  const table = dataTable([
    { label: 'Seller', cell: (s) => `<a href="${sellerLink(s.owner_name)}">${esc(s.owner_name)}</a>`, sortVal: (s) => (s.owner_name || '').toLowerCase() },
    { label: 'Items', num: true, cell: (s) => num(s.items), sortVal: (s) => s.items || 0 },
    { label: 'Last active', num: true, cell: (s) => `<span class="muted">${ago(s.last_seen)}</span>`, sortVal: (s) => s.last_seen || 0 }
  ], sellers, { empty: q ? 'No sellers match that search.' : 'No sellers found.' });
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Sellers</div>
    <div class="detail-head"><h1>${q ? `Sellers matching "${esc(q)}"` : 'Browse sellers'}</h1></div>
    <div class="trust-strip"><span class="freshness">${plural(sellers.length, 'seller')}</span></div>
    <form id="sellers-search" class="nav-search" style="margin:14px 0 16px;max-width:420px;"><input id="sellers-q" type="search" placeholder="Search sellers by name..." value="${esc(q)}" autocomplete="off" /><button type="submit">Search</button></form>
    <div class="tabs">${sortTabs}</div>
    <section class="section">${table}</section>`;
  document.getElementById('sellers-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = document.getElementById('sellers-q').value.trim();
    location.hash = v ? `#/sellers?q=${encodeURIComponent(v)}&sort=${sort}` : `#/sellers?sort=${sort}`;
  });
}

function submitPanelHtml() {
  return `
      <h2>Add usernames to track</h2>
      <p class="muted">Tell us about players with stocked shops. Add their Animal Jam usernames below, one per line. We will start tracking their prices.</p>
      <p class="muted">You can also paste a <code>collected_usernames.txt</code> from the <b>Username Logger</b>. We strip the timestamps for you.</p>
      <textarea id="submit-input" rows="8" placeholder="givemenull&#10;anotherjammer&#10;...or paste your collected_usernames.txt here"></textarea>
      <div class="field"><button class="btn" id="submit-btn">Submit usernames</button></div>
      <div id="submit-note"></div>`;
}
function bindSubmit() {
  const btn = document.getElementById('submit-btn');
  if (!btn) return;
  const note = document.getElementById('submit-note');
  btn.addEventListener('click', async () => {
    const usernames = document.getElementById('submit-input').value.trim();
    if (!usernames) return;
    note.className = 'note';
    note.textContent = 'Submitting...';
    const { status, data } = await post('/submit', { usernames });
    if (status === 200) {
      note.className = 'note ok';
      const bits = [`Added ${data.added} new`];
      if (data.duplicate) bits.push(`${data.duplicate} already tracked`);
      if (data.skipped) bits.push(`${data.skipped} invalid`);
      note.textContent = `Thanks! ${bits.join(', ')}. Fresh names join the scrape queue and can take a while to fill in.`;
      document.getElementById('submit-input').value = '';
    } else {
      note.className = 'note err';
      note.textContent = data.error || 'Could not submit those usernames.';
    }
  });
}
function submitView() {
  view.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / Submit</div>
    <section class="section form-card mm-form">${submitPanelHtml()}</section>`;
  bindSubmit();
}

function acPriceLabel(pr) {
  if (!pr) return '';
  const unit = pr.currency === 'diamonds' ? 'diamonds' : 'gems';
  if (pr.min != null && pr.max != null && pr.min !== pr.max) return `${num(pr.min)}-${num(pr.max)} ${unit}`;
  const single = pr.median != null ? pr.median : (pr.min != null ? pr.min : pr.max);
  return single != null ? `${num(single)} ${unit}` : '';
}
function bindTypeahead(form, input, onSelect) {
  let dropdown = null;
  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;
  const place = () => {
    if (!dropdown) return;
    const r = input.getBoundingClientRect();
    dropdown.style.left = `${r.left}px`;
    dropdown.style.top = `${r.bottom + 6}px`;
    dropdown.style.width = `${r.width}px`;
  };
  const close = () => {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    }
    items = []; active = -1;
  };
  const render = () => {
    if (!items.length) { close(); return; }
    if (!dropdown) {
      dropdown = document.createElement('ul');
      dropdown.className = 'ac-dropdown';
      document.body.appendChild(dropdown);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
    }
    dropdown.innerHTML = items.map((it, i) => {
      const thumb = it.image
        ? `<img class="ac-thumb" src="${esc(it.image)}" alt="" loading="lazy" />`
        : '<span class="ac-thumb ac-thumb-empty"></span>';
      const price = acPriceLabel(it.priceRange);
      const priceEl = price ? `<span class="ac-price">${esc(price)}</span>` : '';
      return `<li data-i="${i}" class="${i === active ? 'active' : ''}">${thumb}<span class="ac-text"><span class="ac-name">${esc(it.name)}</span>${priceEl}</span><span class="ac-type">${TYPE_LABEL[it.itemType] || ''}</span></li>`;
    }).join('');
    dropdown.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', (e) => { e.preventDefault(); select(Number(li.dataset.i)); }));
    place();
  };
  const select = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    if (onSelect) { input.value = it.name; onSelect(it); }
    else { input.value = ''; input.blur(); location.hash = `#/item/${it.itemType}/${it.defId}`; }
  };
  const query = async () => {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const my = ++seq;
    try {
      const res = await api(`/autocomplete?q=${encodeURIComponent(q)}&limit=10`);
      if (my !== seq) return;
      items = dedupeByName(res || []).slice(0, 10);
      active = -1;
      render();
    } catch { close(); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(query, 200); });
  input.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); select(active); }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

function setActiveNav(section) {
  document.querySelectorAll('.nav-links a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) { a.classList.remove('active'); return; }
    const target = href === '#/' ? '' : href.replace(/^#\//, '').split('/')[0];
    a.classList.toggle('active', target === section);
  });
}

function wrapTables() {
  view.querySelectorAll('table').forEach((t) => {
    if (t.parentElement && t.parentElement.classList.contains('table-scroll')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  });
}

function reveal() {
  wrapTables();
  view.classList.remove('reveal-in');
  void view.offsetWidth;
  view.classList.add('reveal-in');
}

function routeSEO(parts, params) {
  const q = params && params.get('q');
  switch (parts[0]) {
    case 'sellers': return { title: 'Animal Jam Classic shops & sellers | Melon Marketeer', description: 'Browse tracked Animal Jam Classic player shops, their inventory, and live presence.' };
    case 'search': return q ? { title: `"${q}" - search | Melon Marketeer`, description: `Search results for "${q}" - Animal Jam Classic item worth and shop prices.` } : { title: 'Search | Melon Marketeer' };
    case 'submit': return { title: 'Submit a shop | Melon Marketeer', description: 'Add Animal Jam Classic player shops for Melon Marketeer to track.' };
    default: return undefined;
  }
}

function router() {
  if (viewTimer) { clearInterval(viewTimer); viewTimer = null; }
  const hash = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = hash.split('?');
  const params = new URLSearchParams(queryPart || '');
  const parts = pathPart.split('/').filter(Boolean);
  setActiveNav(parts[0] || '');
  setSEO(routeSEO(parts, params));
  const run = (fn) => Promise.resolve().then(fn).then(reveal).catch((e) => errorView(e.message));
  if (parts[0] === 'item' && parts[1] && parts[2]) return run(() => itemView(Number(parts[1]), Number(parts[2])));
  if (parts[0] === 'seller' && parts[1]) return run(() => sellerView(decodeURIComponent(parts[1])));
  if (parts[0] === 'sellers') return run(() => sellersView(params));
  if (parts[0] === 'search') return run(() => search(params));
  if (parts[0] === 'submit') return run(submitView);
  return run(home);
}

document.getElementById('nav-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('nav-search-input').value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});
bindTypeahead(document.getElementById('nav-search'), document.getElementById('nav-search-input'));

async function refreshScraperStatus() {
  const el = document.getElementById('scraper-status');
  if (!el) return;
  try {
    const s = await api('/status');
    el.className = 'scraper-status ' + (s.online ? 'online' : 'offline');
    el.innerHTML = `<span class="dot"></span><span class="status-label">${s.online ? 'Live' : 'Offline'}</span>`;
    el.title = s.lastObsAgoMin == null
      ? 'Bot status: no shop data yet'
      : `Bots ${s.online ? 'live' : 'paused'}, last shop price seen ${s.lastObsAgoMin}m ago`;
    el.hidden = false;
  } catch { el.hidden = true; }
}
refreshScraperStatus();
setInterval(refreshScraperStatus, 60000);

if (window.lucide) {
  const iconObserver = new MutationObserver(() => {
    iconObserver.disconnect();
    window.lucide.createIcons();
    iconObserver.observe(view, { childList: true, subtree: true });
  });
  iconObserver.observe(view, { childList: true, subtree: true });
}

window.addEventListener('hashchange', router);
router();

