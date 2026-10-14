(() => {
  const PHASES = ['collecting', 'scraping_live', 'scraping_stale', 'scraping_fallback'];
  const selected = new Set();

  const SETTINGS_FIELDS = [
    { key: 'collectDurationMs', label: 'Live collect dwell (ms)' },
    { key: 'staleThresholdMs', label: 'Seller recheck cooldown (ms)' },
    { key: 'liveBatchSize', label: 'Live batch size' },
    { key: 'fallbackBatchSize', label: 'Dead batch size' },
    { key: 'staleBatchSize', label: 'Stale batch size' },
    { key: 'idleWaitMs', label: 'Idle wait (ms)' },
    { key: 'roamInstances', label: 'Roam instances' }
  ];
  const SCRAPE_FIELDS = [
    { key: 'denDelayMin', label: 'Den delay min (ms)' },
    { key: 'denDelayMax', label: 'Den delay max (ms)' },
    { key: 'dsiDelayMin', label: 'Shop delay min (ms)' },
    { key: 'dsiDelayMax', label: 'Shop delay max (ms)' },
    { key: 'maxShopsPerDen', label: 'Max shops / den' },
    { key: 'maxPortalHops', label: 'Max portal hops (0=off)' }
  ];

  function field(group, key, label, value) {
    return `<div class="field"><label>${label}</label><input class="cfg-input" data-group="${group}" data-key="${key}" type="number" min="0" value="${value}"></div>`;
  }

  function renderSettings(config) {
    const root = SETTINGS_FIELDS.map((f) => field('root', f.key, f.label, config[f.key])).join('');
    const scrape = SCRAPE_FIELDS.map((f) => field('scrape', f.key, f.label, config.scrapeOptions[f.key])).join('');
    const toggle = `<div class="field"><label>Capture trade lists</label><input class="cfg-toggle" data-group="scrape" data-key="captureTradeLists" type="checkbox" ${config.scrapeOptions.captureTradeLists ? 'checked' : ''}></div>`;
    document.getElementById('settings').innerHTML = root + scrape + toggle;
  }

  async function loadConfig() {
    try { renderSettings(await App.getJson('/api/config')); } catch {}
  }

  async function applyConfig() {
    const patch = { scrapeOptions: {} };
    document.querySelectorAll('.cfg-input').forEach((inp) => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      if (inp.dataset.group === 'scrape') patch.scrapeOptions[inp.dataset.key] = v;
      else patch[inp.dataset.key] = v;
    });
    const toggle = document.querySelector('.cfg-toggle[data-key="captureTradeLists"]');
    if (toggle) patch.scrapeOptions.captureTradeLists = toggle.checked;
    try {
      renderSettings(await App.postJson('/api/config', patch));
      App.toast('Settings applied', 'ok');
    } catch { App.toast('Apply failed', 'danger'); }
  }

  function renderTradeLists(data) {
    const t = (data && data.totals) || { items: 0, owners: 0 };
    document.getElementById('tradelist-count').textContent = `${App.num(t.items)} items / ${App.num(t.owners)} owners`;
    const owners = (data && data.owners) || [];
    document.querySelector('#tradelist-table tbody').innerHTML = owners.length
      ? owners.map((o) => `<tr><td>${o.owner_name}</td><td class="num">${App.num(o.items)}</td><td class="num">${App.num(o.clothing)}</td><td class="num">${App.num(o.den)}</td><td class="num">${App.num(o.pet)}</td><td class="muted">${App.ago(o.last_captured)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No trade lists captured yet. Enable "Capture trade lists" above.</td></tr>';
  }

  function renderContinuous(c) {
    const phases = PHASES.map((p) => {
      const active = c.running && c.phase === p ? 'active' : '';
      return `<span class="phase-badge ${active}">${p.replace('scraping_', '')}</span>`;
    }).join('');
    document.getElementById('continuous').innerHTML = `
      <div class="phase-badge ${c.running ? 'active' : ''}">${c.running ? c.phase : 'stopped'}</div>
      <div class="phase-badge">mode: ${c.mode || '-'}</div>
      ${phases}
      ${App.stat(c.onlineClients, 'online')}
      ${App.stat(c.cycles, 'cycles')}
      ${App.stat(c.totalScraped, 'scraped')}
      ${App.stat(c.liveQueued, 'live q')}
      ${App.stat(c.staleQueued, 'stale q')}
      ${App.stat(c.fallbackQueued, 'fallback q')}`;
  }

  function statusPill(a) {
    if (a.status === 'online' && a.activity && a.activity.startsWith('scraping')) return '<span class="pill busy">scraping</span>';
    if (a.status === 'online') return '<span class="pill on">online</span>';
    if (a.status === 'connecting') return '<span class="pill busy">connecting</span>';
    if (a.status === 'failed') return '<span class="pill off">failed</span>';
    return '<span class="pill off">offline</span>';
  }

  function renderAccounts(data) {
    document.getElementById('fleet-count').textContent = `${data.online}/${data.total} online`;
    const tbody = document.querySelector('#fleet-table tbody');
    if (!data.accounts.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No accounts in accounts.txt</td></tr>';
      return;
    }
    tbody.innerHTML = data.accounts.map((a) => `
      <tr>
        <td><input type="checkbox" class="acct-check" data-user="${a.username}" ${selected.has(a.username) ? 'checked' : ''}></td>
        <td>${a.username}</td>
        <td>${statusPill(a)}${a.error ? ` <span class="muted">${a.error}</span>` : ''}</td>
        <td>${a.room || '-'}</td>
        <td>${a.activity || '-'}</td>
        <td class="muted">${a.activityAt ? App.ago(a.activityAt) : '-'}</td>
      </tr>`).join('');
    tbody.querySelectorAll('.acct-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.user);
        else selected.delete(cb.dataset.user);
      });
    });
  }

  function renderUsernames(rows) {
    document.getElementById('usernames-count').textContent = `${rows.length} shown`;
    const tbody = document.querySelector('#usernames-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No matching usernames</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${r.name}</td>
        <td class="muted">${r.source || '-'}</td>
        <td>${r.is_live ? '<span class="pill on">yes</span>' : '<span class="muted">no</span>'}</td>
        <td>${r.scraped ? '<span class="pill busy">yes</span>' : '<span class="muted">no</span>'}</td>
        <td class="muted">${r.first_seen ? App.ago(r.first_seen) : '-'}</td>
        <td class="muted">${r.last_seen ? App.ago(r.last_seen) : '-'}</td>
      </tr>`).join('');
  }

  async function loadUsernames() {
    const q = document.getElementById('user-search').value.trim();
    const filter = document.getElementById('user-filter').value;
    try {
      renderUsernames(await App.getJson(`/api/usernames?limit=100&filter=${filter}&q=${encodeURIComponent(q)}`));
    } catch {}
  }

  function renderRecent(rows) {
    const tbody = document.querySelector('#recent-table tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Nothing scraped yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${r.item}</td>
        <td>${App.swatch(r.color)}</td>
        <td class="num">${App.num(r.cost)}</td>
        <td>${r.currency}</td>
        <td>${r.seller}</td>
        <td class="muted">${App.ago(r.scrapedAt)}</td>
      </tr>`).join('');
  }

  App.register('scraping', {
    liveMs: 15000,
    init() {
      document.getElementById('btn-start').addEventListener('click', async () => {
        const mode = document.getElementById('mode-select').value;
        try { await App.postJson('/api/control', { action: 'continuous-start', mode }); App.toast(`Scraper started (${mode})`, 'ok'); }
        catch { App.toast('Start failed', 'danger'); }
        this.refresh();
      });
      document.getElementById('btn-stop').addEventListener('click', async () => {
        try { await App.postJson('/api/control', { action: 'continuous-stop' }); App.toast('Scraper stopped', 'warn'); }
        catch { App.toast('Stop failed', 'danger'); }
        this.refresh();
      });
      document.getElementById('btn-login').addEventListener('click', async () => {
        if (!selected.size) return App.toast('Select accounts first', 'warn');
        try { await App.postJson('/api/accounts/login', { usernames: [...selected] }); App.toast(`Logging in ${selected.size} account(s)`, 'ok'); }
        catch { App.toast('Login failed', 'danger'); }
        this.refresh();
      });
      document.getElementById('btn-logout').addEventListener('click', async () => {
        if (!selected.size) return App.toast('Select accounts first', 'warn');
        try { await App.postJson('/api/accounts/logout', { usernames: [...selected] }); App.toast(`Logging out ${selected.size} account(s)`, 'warn'); }
        catch { App.toast('Logout failed', 'danger'); }
        this.refresh();
      });
      document.getElementById('select-all').addEventListener('change', (e) => {
        document.querySelectorAll('.acct-check').forEach((cb) => {
          cb.checked = e.target.checked;
          if (cb.checked) selected.add(cb.dataset.user);
          else selected.delete(cb.dataset.user);
        });
      });
      document.getElementById('btn-apply-config').addEventListener('click', applyConfig);
      document.getElementById('btn-reload-config').addEventListener('click', loadConfig);
      document.getElementById('user-search').addEventListener('input', loadUsernames);
      document.getElementById('user-filter').addEventListener('change', loadUsernames);
      loadConfig();
    },
    async refresh() {
      try {
        const [cont, accts, recent, tradelists] = await Promise.all([
          App.getJson('/api/continuous'),
          App.getJson('/api/accounts'),
          App.getJson('/api/recent?limit=50'),
          App.getJson('/api/tradelists?limit=100')
        ]);
        renderContinuous(cont);
        renderAccounts(accts);
        renderRecent(recent);
        renderTradeLists(tradelists);
        loadUsernames();
      } catch {}
    }
  });
})();
