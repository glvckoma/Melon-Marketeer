(function () {
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENT[c]);
  }

  const BADGES = { ok: 'sb-ok', warn: 'sb-warn', danger: 'sb-danger', info: 'sb-info' };
  function badgeClass(variant) {
    return BADGES[variant] || 'sb-info';
  }

  function kpiMarkup({ value, k, delta, dir } = {}) {
    const deltaNode = delta == null || delta === ''
      ? ''
      : `<div class="kpi-delta kpi-${dir || 'flat'}">${esc(delta)}</div>`;
    return `<div class="kpi">`
      + `<div class="kpi-k">${esc(k)}</div>`
      + `<div class="kpi-v">${esc(value)}</div>`
      + deltaNode
      + `</div>`;
  }

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(columns, rows) {
    const head = columns.map((c) => csvField(c.label)).join(',');
    const body = (rows || []).map((r) => columns.map((c) => csvField(r[c.key])).join(',')).join('\n');
    return body ? head + '\n' + body : head;
  }

  const Components = { esc, badgeClass, kpiMarkup, toCsv };

  function defineElements() {
    if (typeof window === 'undefined' || !window.customElements) return;
    if (!customElements.get('status-badge')) {
      customElements.define('status-badge', class extends HTMLElement {
        static get observedAttributes() { return ['variant', 'label']; }
        connectedCallback() { this.render(); }
        attributeChangedCallback() { if (this.isConnected) this.render(); }
        render() {
          const variant = this.getAttribute('variant') || 'info';
          this.innerHTML = `<span class="sb ${badgeClass(variant)}">${esc(this.getAttribute('label'))}</span>`;
        }
      });
    }
    if (!customElements.get('kpi-card')) {
      customElements.define('kpi-card', class extends HTMLElement {
        static get observedAttributes() { return ['value', 'k', 'delta', 'delta-dir']; }
        connectedCallback() { this.render(); }
        attributeChangedCallback() { if (this.isConnected) this.render(); }
        render() {
          this.innerHTML = kpiMarkup({
            value: this.getAttribute('value'),
            k: this.getAttribute('k'),
            delta: this.getAttribute('delta'),
            dir: this.getAttribute('delta-dir')
          });
        }
      });
    }
    if (!customElements.get('data-table')) {
      customElements.define('data-table', class extends HTMLElement {
        render(opts) {
          this._opts = opts || this._opts || {};
          const o = this._opts;
          const cols = o.columns || [];
          const rows = o.rows || [];
          const pageSize = o.pageSize || 0;
          const total = o.total != null ? o.total : rows.length;
          const page = o.page || 1;
          const pages = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
          const head = cols.map((c) => {
            const cls = c.num ? ' class="num"' : '';
            const active = c.sortable && o.sortKey === c.key;
            const mark = active ? (o.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
            const attr = c.sortable ? ` data-sort="${esc(c.key)}" role="button" tabindex="0"` : '';
            return `<th${cls}${attr}>${esc(c.label)}${mark}</th>`;
          }).join('');
          const body = rows.length
            ? rows.map((r) => '<tr>' + cols.map((c) => {
                const cls = c.num ? ' class="num"' : '';
                const content = c.cell ? c.cell(r) : esc(r[c.key]);
                return `<td${cls}>${content}</td>`;
              }).join('') + '</tr>').join('')
            : `<tr><td class="dt-empty" colspan="${cols.length || 1}">No rows.</td></tr>`;
          const pager = pages > 1
            ? `<div class="dt-pager"><button class="dt-prev"${page <= 1 ? ' disabled' : ''}>Prev</button>`
              + `<span class="dt-pageinfo">Page ${page} of ${pages}</span>`
              + `<button class="dt-next"${page >= pages ? ' disabled' : ''}>Next</button></div>`
            : '';
          this.innerHTML = `<div class="dt-bar"><span class="dt-count">${total} rows</span>`
            + `<button class="dt-csv" type="button">Export CSV</button></div>`
            + `<div class="dt-scroll"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
            + pager;
          this._wire();
        }
        _wire() {
          const o = this._opts;
          const csvBtn = this.querySelector('.dt-csv');
          if (csvBtn) csvBtn.onclick = () => downloadCsv((o.name || 'export') + '.csv', toCsv(o.columns || [], o.rows || []));
          if (o.onSort) this.querySelectorAll('th[data-sort]').forEach((th) => {
            th.onclick = () => o.onSort(th.getAttribute('data-sort'));
          });
          if (o.onPage) {
            const prev = this.querySelector('.dt-prev');
            const next = this.querySelector('.dt-next');
            if (prev) prev.onclick = () => o.onPage((o.page || 1) - 1);
            if (next) next.onclick = () => o.onPage((o.page || 1) + 1);
          }
        }
      });
    }
  }

  function downloadCsv(filename, csv) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (typeof window !== 'undefined') {
    defineElements();
    window.Components = Components;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Components;
  }
})();
