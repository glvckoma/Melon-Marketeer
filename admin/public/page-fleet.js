(() => {
  function renderFleet(data) {
    document.getElementById('fleet-live-count').textContent = `${data.online}/${data.total} online`;
    const live = data.accounts.filter((a) => a.status === 'online' || a.status === 'connecting');
    const grid = document.getElementById('fleet-grid');
    if (!live.length) {
      grid.innerHTML = '<div class="empty">No bots online. Log accounts in from the Scraping page.</div>';
      return;
    }
    grid.innerHTML = live.map((a) => {
      const busy = a.activity && a.activity.startsWith('scraping');
      const pill = a.status === 'connecting' ? 'busy' : (busy ? 'busy' : 'on');
      const label = a.status === 'connecting' ? 'connecting' : (busy ? 'scraping' : 'online');
      return `
        <div class="bot-card">
          <div class="bot-head">
            <span class="bot-name">${a.username}</span>
            <span class="pill ${pill}">${label}</span>
          </div>
          <div class="bot-row"><span class="muted">room</span><span>${a.room || '-'}</span></div>
          <div class="bot-row"><span class="muted">activity</span><span>${a.activity || 'idle'}</span></div>
          <div class="bot-row"><span class="muted">updated</span><span>${a.activityAt ? App.ago(a.activityAt) : '-'}</span></div>
        </div>`;
    }).join('');
  }

  function inputNames() {
    return document.getElementById('scrape-input').value.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  App.register('fleet', {
    liveMs: 15000,
    init() {
      document.getElementById('btn-enqueue').addEventListener('click', async () => {
        const usernames = inputNames();
        if (!usernames.length) return App.toast('Enter at least one username', 'warn');
        try {
          const r = await App.postJson('/api/usernames/enqueue', { usernames });
          App.toast(`Enqueued ${r.added} new username(s)`, 'ok');
        } catch { App.toast('Enqueue failed', 'danger'); }
      });
      document.getElementById('btn-scrape').addEventListener('click', async () => {
        try {
          const r = await App.postJson('/api/scrape', { usernames: inputNames() });
          if (r.error) App.toast(r.error, 'danger');
          else App.toast(`Scrape started (${App.num(r.total || 0)} targets)`, 'ok');
        } catch { App.toast('Scrape failed', 'danger'); }
        this.refresh();
      });
      document.getElementById('btn-scrape-stop').addEventListener('click', async () => {
        try { await App.postJson('/api/scrape/stop', {}); App.toast('Scrape stopping', 'warn'); }
        catch { App.toast('Stop failed', 'danger'); }
        this.refresh();
      });
    },
    async refresh() {
      try {
        const [accts, job] = await Promise.all([App.getJson('/api/accounts'), App.getJson('/api/scrape')]);
        renderFleet(accts);
        document.getElementById('scrape-job').innerHTML = App.jobCard(job);
      } catch {}
    }
  });
})();
