(() => {
  let openSeller = null;

  function renderSellers(rows) {
    document.getElementById('sellers-count').textContent = `${rows.length} shown`;
    const tbody = document.querySelector('#sellers-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">No matching sellers</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr class="clickable" data-name="${r.owner_name.replace(/"/g, '&quot;')}">
        <td>${r.owner_name}</td>
        <td class="num">${App.num(r.items)}</td>
        <td class="num">${App.num(r.observations)}</td>
        <td class="muted">${App.ago(r.last_seen)}</td>
      </tr>`).join('');
    tbody.querySelectorAll('tr.clickable').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(tr.dataset.name));
    });
  }

  async function loadSellers() {
    const q = document.getElementById('seller-search').value.trim();
    try {
      renderSellers(await App.getJson(`/api/sellers?limit=200&q=${encodeURIComponent(q)}`));
    } catch {}
  }

  function renderDetail(d) {
    document.getElementById('seller-detail-title').textContent = `${d.seller} (${d.inventory.length} items)`;
    const tbody = document.querySelector('#seller-detail-table tbody');
    if (!d.inventory.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No inventory recorded</td></tr>';
      return;
    }
    tbody.innerHTML = d.inventory.map((r) => `
      <tr>
        <td>${r.name}</td>
        <td>${App.swatch(r.color)}</td>
        <td class="num">${App.num(r.cost)}</td>
        <td>${r.currency}</td>
        <td class="muted">${App.ago(r.lastSeen)}</td>
      </tr>`).join('');
  }

  async function openDetail(name) {
    openSeller = name;
    document.getElementById('seller-detail-card').style.display = '';
    try {
      renderDetail(await App.getJson(`/api/seller?name=${encodeURIComponent(name)}`));
    } catch {}
  }

  App.register('sellers', {
    init() {
      document.getElementById('seller-search').addEventListener('input', loadSellers);
      document.getElementById('seller-detail-close').addEventListener('click', () => {
        openSeller = null;
        document.getElementById('seller-detail-card').style.display = 'none';
      });
      document.getElementById('watch-seller-btn').addEventListener('click', async () => {
        if (!openSeller) return;
        try { await App.postJson('/api/watches', { kind: 'seller', ownerName: openSeller, label: openSeller }); App.toast(`Watching ${openSeller}`, 'ok'); }
        catch { App.toast('Could not add watch', 'danger'); }
      });
    },
    refresh() {
      loadSellers();
      if (openSeller) openDetail(openSeller);
    }
  });
})();
