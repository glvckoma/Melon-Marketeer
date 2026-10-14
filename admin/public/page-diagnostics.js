(() => {
  function renderCurrency(split) {
    document.getElementById('diag-currency').innerHTML = App.donut([
      { label: 'gems', value: split.gems || 0, color: 'var(--gem)' },
      { label: 'diamonds', value: split.diamonds || 0, color: 'var(--diamond)' }
    ]);
  }

  function sampleBlock(title, rows) {
    const body = rows.length
      ? rows.map((r) => `<tr><td>${r.item}</td><td class="num">${App.num(r.cost)}</td><td>${r.seller}</td><td class="muted">${App.ago(r.scrapedAt)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">None</td></tr>';
    return `
      <div class="sample-block">
        <h3>${title}</h3>
        <table class="sub-table">
          <thead><tr><th>Item</th><th>Cost</th><th>Seller</th><th>When</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function renderAnomalies(rows) {
    document.getElementById('anomaly-count').textContent = `${rows.length} shown`;
    const tbody = document.querySelector('#anomaly-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">No anomalies logged</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td class="muted">${App.ago(r.ts)}</td>
        <td>${r.kind || '-'}</td>
        <td>${r.owner || '-'}</td>
        <td class="muted mono">${String(r.raw || '').slice(0, 140).replace(/</g, '&lt;')}</td>
      </tr>`).join('');
  }

  function renderCoverage(cov) {
    const s = cov.summary;
    const pct = s.observed ? Math.round((s.withImages / s.observed) * 100) : 0;
    document.getElementById('cov-summary').textContent = `${App.num(s.withImages)} / ${App.num(s.observed)} observed items have images (${pct}%)`;
    document.getElementById('cov-bar').style.width = pct + '%';
    const colorPct = s.observedColors ? Math.round((s.withColorImage / s.observedColors) * 100) : 0;
    const conf = s.confidence || {};
    document.getElementById('cov-stats').innerHTML = [
      ['with images', s.withImages],
      ['awaiting sync', s.unsynced],
      ['no wiki match', s.unmatched],
      ['page has none', s.noImagesOnPage],
      ['from aj-item-worth', s.fromAjItemWorth],
      ['from animaljam', s.fromAnimaljam],
      ['colors w/ image', `${App.num(s.withColorImage)} / ${App.num(s.observedColors)} (${colorPct}%)`],
      ['low-confidence matches', conf.low || 0]
    ].map(([k, v]) => `<div class="stat-inline"><span class="val">${typeof v === 'number' ? App.num(v) : v}</span><span class="lbl">${k}</span></div>`).join('');
  }

  App.register('diagnostics', {
    async refresh() {
      try {
        const [diag, anomalies, coverage] = await Promise.all([
          App.getJson('/api/diagnostics'),
          App.getJson('/api/anomalies?limit=100'),
          App.getJson('/api/coverage?limit=1')
        ]);
        renderCurrency(diag.currencySplit);
        document.getElementById('diag-job').innerHTML = App.jobCard(diag.scrape);
        document.getElementById('diag-samples').innerHTML = sampleBlock('Gems', diag.samples.gems) + sampleBlock('Diamonds', diag.samples.diamonds);
        renderAnomalies(anomalies);
        renderCoverage(coverage);
      } catch {}
    }
  });
})();
