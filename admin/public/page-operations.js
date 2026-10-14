(() => {
  const esc = (window.Components && window.Components.esc) || ((s) => String(s == null ? '' : s));
  let relocated = false;

  function relocate() {
    if (relocated) return;
    [['scraping', 'ops-scraper'], ['fleet', 'ops-fleet'], ['diagnostics', 'ops-diagnostics']].forEach(([src, dest]) => {
      const grid = document.querySelector(`#page-${src} .grid`);
      const panel = document.getElementById(dest);
      if (grid && panel) panel.appendChild(grid);
    });
    relocated = true;
  }

  function showPanel(key) {
    document.querySelectorAll('#page-operations .ops-panel').forEach((p) => p.classList.toggle('active', p.id === `ops-${key}`));
    document.querySelectorAll('#ops-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.ops === key));
  }

  async function loadQueues() {
    try {
      const d = await App.getJson('/api/operations');
      document.getElementById('ops-priority-count').textContent = `${d.priority.length}`;
      document.querySelector('#ops-priority tbody').innerHTML = d.priority.length
        ? d.priority.map((n) => `<tr><td>${esc(n)}</td></tr>`).join('')
        : '<tr><td class="empty">Queue empty</td></tr>';
      document.getElementById('ops-stale-count').textContent = `${d.stale.length}`;
      document.querySelector('#ops-stale tbody').innerHTML = d.stale.length
        ? d.stale.map((n) => `<tr><td>${esc(n)}</td></tr>`).join('')
        : '<tr><td class="empty">None due</td></tr>';
    } catch {}
  }

  function delegate(key) {
    const p = App.pages[key];
    if (p && p.refresh) p.refresh();
  }

  App.register('operations', {
    init() {
      relocate();
      document.querySelectorAll('#ops-tabs .tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.ops)));
    },
    refresh() {
      relocate();
      delegate('scraping');
      delegate('fleet');
      delegate('diagnostics');
      loadQueues();
      App.live('ops-live', () => { delegate('scraping'); delegate('fleet'); }, 12000);
    }
  });
})();
