(() => {
  function criteria(w) {
    if (w.kind === 'seller') return w.owner_name;
    const cur = w.currency_type === 3 ? 'diamonds' : (w.currency_type === 0 ? 'gems' : 'any currency');
    const max = w.max_cost != null ? `≤ ${App.num(w.max_cost)}` : 'any price';
    return `${cur}, ${max}`;
  }

  function renderWatches(rows) {
    document.getElementById('watches-count').textContent = `${rows.length}`;
    const tbody = document.querySelector('#watches-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No watches yet. Open an item or seller and click ★ Watch.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((w) => `
      <tr>
        <td>${w.label || '-'}</td>
        <td><span class="pill ${w.kind === 'seller' ? 'busy' : 'on'}">${w.kind}</span></td>
        <td class="muted">${criteria(w)}</td>
        <td class="muted">${App.ago(w.created_at)}</td>
        <td><button class="btn danger watch-remove" data-id="${w.id}">Remove</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('.watch-remove').forEach((b) => b.addEventListener('click', async () => {
      try { await App.postJson('/api/watches/remove', { id: Number(b.dataset.id) }); App.toast('Watch removed', 'warn'); }
      catch { App.toast('Remove failed', 'danger'); }
      load();
    }));
  }

  function renderAlerts(data) {
    document.getElementById('alerts-count').textContent = data.count ? `${data.count} new` : '';
    const tbody = document.querySelector('#alerts-table tbody');
    if (!data.alerts.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No new alerts</td></tr>';
      return;
    }
    tbody.innerHTML = data.alerts.map((a) => `
      <tr>
        <td class="muted">${a.watchLabel || a.kind}</td>
        <td>${a.item}</td>
        <td>${App.swatch(a.color)}</td>
        <td class="num">${App.num(a.cost)}</td>
        <td>${a.currency}</td>
        <td>${a.seller}</td>
        <td class="muted">${App.ago(a.scrapedAt)}</td>
      </tr>`).join('');
  }

  async function load() {
    try {
      const [watches, alerts] = await Promise.all([
        App.getJson('/api/watches'),
        App.getJson('/api/alerts?limit=100')
      ]);
      renderWatches(watches);
      renderAlerts(alerts);
    } catch {}
  }

  App.register('watchlist', {
    init() {
      document.getElementById('btn-ack-alerts').addEventListener('click', async () => {
        try { await App.postJson('/api/alerts/ack', {}); App.toast('Alerts cleared', 'ok'); }
        catch { App.toast('Failed', 'danger'); }
        load();
      });
    },
    refresh() { load(); }
  });
})();
