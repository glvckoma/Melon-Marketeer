(() => {
  function renderKpis(stats, scraper) {
    const cards = [
      { k: 'Observations', value: App.num(stats.observations) },
      { k: 'Items Tracked', value: App.num(stats.itemDefinitions) },
      { k: 'Sellers', value: App.num(stats.sellers) },
      { k: 'Accounts Online', value: App.num(scraper.onlineClients) }
    ];
    document.getElementById('dash-kpis').innerHTML = cards
      .map((c) => `<kpi-card k="${c.k}" value="${c.value}"></kpi-card>`)
      .join('');
  }

  function renderScraper(c) {
    document.getElementById('dash-scraper').innerHTML = `
      <div class="phase-badge ${c.running ? 'active' : ''}">${c.running ? c.phase : 'stopped'}</div>
      <div class="phase-badge">mode: ${c.mode || '-'}</div>
      ${App.stat(c.onlineClients, 'online')}
      ${App.stat(c.cycles, 'cycles')}
      ${App.stat(c.totalScraped, 'scraped')}
      ${App.stat(c.liveQueued, 'live q')}
      ${App.stat(c.fallbackQueued, 'fallback q')}`;
  }

  function renderCurrency(split) {
    document.getElementById('dash-currency').innerHTML = App.donut([
      { label: 'gems', value: split.gems || 0, color: 'var(--gem)' },
      { label: 'diamonds', value: split.diamonds || 0, color: 'var(--diamond)' }
    ]);
  }

  function renderThroughput(points) {
    document.getElementById('dash-throughput').innerHTML = App.sparkline(points.map((p) => p.n));
  }

  function renderRecent(rows) {
    const tbody = document.querySelector('#dash-recent tbody');
    tbody.innerHTML = rows.length
      ? rows.map((r) => `
        <tr>
          <td>${r.item}</td>
          <td>${App.swatch(r.color)}</td>
          <td class="num">${App.num(r.cost)}</td>
          <td>${r.currency}</td>
          <td>${r.seller}</td>
          <td class="muted">${App.ago(r.scrapedAt)}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty">Nothing scraped yet</td></tr>';
  }

  function gapBadge(label, n, variant) {
    return `<status-badge variant="${(n || 0) > 0 ? variant : 'info'}" label="${label}: ${App.num(n)}"></status-badge>`;
  }

  function renderQuality(cov) {
    const s = cov.summary;
    const imgPct = s.observed ? Math.round((s.withImages / s.observed) * 100) : 0;
    const colorPct = s.observedColors ? Math.round((s.withColorImage / s.observedColors) * 100) : 0;
    document.getElementById('dash-cov-summary').textContent = `${App.num(s.observed)} observed items`;
    document.getElementById('dash-quality').innerHTML = `
      <div class="quality-grid">
        <div class="quality-block">
          <div class="quality-head"><span>Items with image</span><span>${imgPct}%</span></div>
          <div class="progress" style="height:12px;"><span style="width:${imgPct}%"></span></div>
          <div class="muted">${App.num(s.withImages)} / ${App.num(s.observed)}</div>
        </div>
        <div class="quality-block">
          <div class="quality-head"><span>Colors with image</span><span>${colorPct}%</span></div>
          <div class="progress" style="height:12px;"><span style="width:${colorPct}%"></span></div>
          <div class="muted">${App.num(s.withColorImage)} / ${App.num(s.observedColors)}</div>
        </div>
        <div class="quality-block">
          <div class="quality-head"><span>Match gaps</span></div>
          <div class="attention-row">
            ${gapBadge('no wiki match', s.unmatched, 'warn')}
            ${gapBadge('awaiting sync', s.unsynced, 'info')}
            ${gapBadge('page has none', s.noImagesOnPage, 'info')}
          </div>
        </div>
      </div>`;
  }

  App.register('dashboard', {
    liveMs: 10000,
    async refresh() {
      try {
        const [o, tp] = await Promise.all([
          App.getJson('/api/overview'),
          App.getJson('/api/throughput?hours=24')
        ]);
        renderKpis(o.stats, o.scraper);
        renderScraper(o.scraper);
        renderCurrency(o.currencySplit);
        renderThroughput(tp);
        renderRecent(o.recent);
      } catch {}
      try {
        renderQuality(await App.load('dash-cov', () => App.getJson('/api/coverage?limit=1'), { ttlMs: 60000 }));
      } catch {}
    }
  });
})();
