(() => {
  let openItem = null;
  let dqData = null;
  const esc = (window.Components && window.Components.esc) || ((s) => String(s == null ? '' : s));
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  function renderDataQuality(dq) {
    dqData = dq;
    const order = ['2', '0', '1'];
    const rows = order.filter((t) => dq.types[t]).map((t) => {
      const x = dq.types[t];
      return `<tr>
        <td><b>${x.label}</b></td>
        <td class="num">${App.num(x.observed)}</td>
        <td class="num">${App.num(x.withImages)} <span class="muted">(${pct(x.withImages, x.observed)}%)</span></td>
        <td class="num"><a href="#" class="dq-cell" data-type="${t}" data-kind="unmatched">${App.num(x.unmatched)}</a></td>
        <td class="num"><a href="#" class="dq-cell" data-type="${t}" data-kind="noImagesOnPage">${App.num(x.noImagesOnPage)}</a></td>
        <td class="num">${App.num(x.unsynced)}</td>
        <td class="num">${App.num(x.withColorImage)}/${App.num(x.observedColors)} <span class="muted">(${pct(x.withColorImage, x.observedColors)}%)</span></td>
        <td class="num">${App.num(x.colorFail)}</td>
        <td class="num">${App.num(x.unobserved)}</td>
      </tr>`;
    }).join('');
    document.getElementById('dq-matrix').innerHTML = `
      <table class="sub-table">
        <thead><tr><th>Type</th><th>Observed</th><th>With image</th><th>Unmatched</th><th>No image</th><th>Awaiting sync</th><th>Color cov.</th><th>Color fail</th><th>Unobserved</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    document.querySelectorAll('#dq-matrix .dq-cell').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); drill(a.dataset.type, a.dataset.kind); });
    });
  }

  function drill(type, kind) {
    if (!dqData) return;
    const label = kind === 'unmatched' ? 'Unmatched (no wiki)' : 'Matched but no image';
    const tName = dqData.types[type] ? dqData.types[type].label : type;
    const list = (dqData.gaps[kind] || []).filter((g) => String(g.itemType) === String(type));
    const body = list.length ? list.map((g) => `
      <tr>
        <td>${esc(g.name)}</td>
        <td class="num muted">${App.num(g.obs)}</td>
        <td><input class="select dq-wiki" data-type="${g.itemType}" data-def="${g.defId}" type="text" placeholder="wiki title" value="${g.wikiTitle ? esc(g.wikiTitle) : ''}" style="min-width:170px"></td>
        <td><button class="btn sm ok dq-assign" data-type="${g.itemType}" data-def="${g.defId}">Assign</button></td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty">No items</td></tr>';
    document.getElementById('dq-drill').innerHTML = `
      <div class="detail-section">
        <h3>${label} - ${tName}</h3>
        <table class="sub-table">
          <thead><tr><th>Item</th><th>Obs</th><th>Wiki title</th><th></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    document.querySelectorAll('#dq-drill .dq-assign').forEach((b) => {
      b.addEventListener('click', async () => {
        const input = document.querySelector(`#dq-drill .dq-wiki[data-type="${b.dataset.type}"][data-def="${b.dataset.def}"]`);
        const wikiTitle = input.value.trim();
        if (!wikiTitle) return App.toast('Enter a wiki title', 'warn');
        try {
          await App.postJson('/api/coverage/match', { itemType: Number(b.dataset.type), defId: Number(b.dataset.def), wikiTitle });
          App.toast('Wiki mapping saved', 'ok');
          loadDataQuality();
        } catch { App.toast('Save failed', 'danger'); }
      });
    });
  }

  async function loadDataQuality() {
    try { renderDataQuality(await App.getJson('/api/dataquality')); } catch {}
  }

  function controls() {
    return {
      q: document.getElementById('item-search').value.trim(),
      currency: document.getElementById('item-currency').value,
      sort: document.getElementById('item-sort').value
    };
  }

  function renderItems(rows) {
    document.getElementById('items-count').textContent = `${rows.length} shown`;
    const tbody = document.querySelector('#items-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No matching items</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr class="clickable" data-type="${r.itemType}" data-def="${r.defId}" data-name="${r.name.replace(/"/g, '&quot;')}">
        <td>${r.name}</td>
        <td>${r.currency}</td>
        <td class="num">${App.num(r.sellers)}</td>
        <td class="num">${App.num(r.observations)}</td>
        <td class="num">${App.num(r.min)}</td>
        <td class="num">${App.num(r.median)}</td>
        <td class="num">${App.num(r.avg)}</td>
        <td class="num">${App.num(r.max)}</td>
        <td class="muted">${App.ago(r.lastSeen)}</td>
      </tr>`).join('');
    tbody.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(Number(tr.dataset.type), Number(tr.dataset.def), tr.dataset.name));
    });
  }

  async function loadItems() {
    const { q, currency, sort } = controls();
    try {
      renderItems(await App.getJson(`/api/items?limit=200&q=${encodeURIComponent(q)}&currency=${currency}&sort=${sort}`));
    } catch {}
  }

  function renderDetail(d, name, histories) {
    const stats = d.stats.map((s) => `
      <div class="stat-block">
        <div class="stat-block-head">${s.currency}</div>
        ${App.stat(s.median, 'median')}
        ${App.stat(s.min, 'min')}
        ${App.stat(s.avg, 'avg')}
        ${App.stat(s.max, 'max')}
        ${App.stat(s.sellers, 'sellers')}
        ${App.stat(s.observations, '#')}
      </div>`).join('') || '<div class="empty">No price data</div>';

    const colors = d.colors.length ? `
      <table class="sub-table">
        <thead><tr><th>Color</th><th>Cur</th><th>#</th><th>Sellers</th><th>Min</th><th>Avg</th><th>Max</th></tr></thead>
        <tbody>${d.colors.map((c) => `
          <tr>
            <td>${App.swatch(c.color)} <span class="muted">${c.color ? c.color.hex : '-'}</span></td>
            <td>${c.currency}</td>
            <td class="num">${App.num(c.observations)}</td>
            <td class="num">${App.num(c.sellers)}</td>
            <td class="num">${App.num(c.min)}</td>
            <td class="num">${App.num(c.avg)}</td>
            <td class="num">${App.num(c.max)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No color data</div>';

    const sellers = d.sellers.length ? `
      <table class="sub-table">
        <thead><tr><th>Seller</th><th>Color</th><th>Cost</th><th>Cur</th><th>Last seen</th></tr></thead>
        <tbody>${d.sellers.map((s) => `
          <tr>
            <td>${s.seller}</td>
            <td>${App.swatch(s.color)}</td>
            <td class="num">${App.num(s.cost)}</td>
            <td>${s.currency}</td>
            <td class="muted">${App.ago(s.lastSeen)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No sellers</div>';

    const history = d.stats.length ? `
      <div class="history-charts">${d.stats.map((s) => `
        <div class="history-chart">
          <div class="history-label">${s.currency} <span class="muted">median, last 14d</span></div>
          ${App.lineChart((histories && histories[s.currency]) || [])}
        </div>`).join('')}</div>` : '<div class="empty">No price data</div>';

    document.getElementById('item-detail-title').textContent = name;
    document.getElementById('item-detail').innerHTML = `
      <div class="detail-section"><h3>Price stats</h3><div class="stat-row">${stats}</div></div>
      <div class="detail-section"><h3>Price history</h3>${history}</div>
      <div class="detail-section"><h3>Color breakdown</h3>${colors}</div>
      <div class="detail-section"><h3>Sellers</h3>${sellers}</div>`;
  }

  async function openDetail(type, def, name) {
    openItem = { type, def, name };
    document.getElementById('item-detail-card').style.display = '';
    try {
      const d = await App.getJson(`/api/item?type=${type}&def=${def}`);
      const histories = {};
      await Promise.all(d.stats.map(async (s) => {
        try {
          histories[s.currency] = await App.getJson(`/api/item/history?type=${type}&def=${def}&currency=${s.currency}&days=14`);
        } catch { histories[s.currency] = []; }
      }));
      renderDetail(d, name, histories);
    } catch {}
  }

  App.register('items', {
    init() {
      document.getElementById('item-search').addEventListener('input', loadItems);
      document.getElementById('item-currency').addEventListener('change', loadItems);
      document.getElementById('item-sort').addEventListener('change', loadItems);
      document.getElementById('item-detail-close').addEventListener('click', () => {
        openItem = null;
        document.getElementById('item-detail-card').style.display = 'none';
      });
      document.getElementById('watch-item-btn').addEventListener('click', async () => {
        if (!openItem) return;
        const maxRaw = document.getElementById('watch-max').value.trim();
        const body = {
          kind: 'item',
          itemType: openItem.type,
          defId: openItem.def,
          currency: document.getElementById('watch-cur').value,
          maxCost: maxRaw === '' ? null : Number(maxRaw),
          label: openItem.name
        };
        try { await App.postJson('/api/watches', body); App.toast(`Watching ${openItem.name}`, 'ok'); }
        catch { App.toast('Could not add watch', 'danger'); }
      });
    },
    refresh() {
      loadDataQuality();
      loadItems();
      if (openItem) openDetail(openItem.type, openItem.def, openItem.name);
    }
  });
})();
