/**
 * Download Queue Card for Home Assistant
 *
 * Shows currently downloading items from Sonarr and/or Radarr.
 * Calls sonarr.get_queue / radarr.get_queue (services with response, HA 2023.7+).
 *
 * type: custom:download-queue-card
 * title: Downloads                     # optional
 * sonarr_entry_id: 01KBC1J9SKNK9T21   # optional — Sonarr config entry ID
 * radarr_entry_id: 01KBC2X9SKNK9T55   # optional — Radarr config entry ID
 * refresh_minutes: 1                   # auto-refresh interval (default 1)
 * show_poster: true                    # show poster thumbnail (default true)
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function dqFormatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const b = Number(bytes);
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function dqFormatTimeLeft(tl) {
  if (!tl) return '';
  // Accepts "HH:MM:SS" — strip days prefix if present (e.g. "1.02:30:00")
  const clean = String(tl).replace(/^\d+\./, '');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hNum = parseInt(parts[0], 10);
    const mNum = parseInt(parts[1], 10);
    if (hNum > 0) return `${hNum}h ${mNum}m`;
    if (mNum > 0) return `${mNum}m`;
    return `<1m`;
  }
  return tl;
}

function dqStatusColor(status) {
  const s = (status || '').toLowerCase();
  if (s === 'downloading') return 'var(--primary-color, #03a9f4)';
  if (s === 'completed')   return 'var(--success-color, #4caf50)';
  if (s === 'failed')      return 'var(--error-color, #f44336)';
  if (s === 'warning')     return 'var(--warning-color, #ff9800)';
  if (s === 'paused')      return 'var(--disabled-text-color, #9e9e9e)';
  if (s === 'delay')       return 'var(--warning-color, #ff9800)';
  return 'var(--secondary-text-color)';
}

function dqParseProgress(item) {
  // Prefer explicit `progress` field ("20.45%" string)
  if (item.progress != null) {
    const n = parseFloat(String(item.progress).replace('%', ''));
    if (!isNaN(n)) return Math.max(0, Math.min(100, n));
  }
  // Fallback: compute from size / size_left or sizeleft
  const size     = Number(item.size ?? 0);
  const sizeLeft = Number(item.size_left ?? item.sizeleft ?? 0);
  if (size > 0) return Math.max(0, Math.min(100, ((size - sizeLeft) / size) * 100));
  return null;
}

function dqProtocol(proto) {
  // Strip "ProtocolType." prefix if present
  return (proto || '').replace(/^ProtocolType\./i, '').toLowerCase();
}

// Parse the service response into a flat array of items.
// Radarr returns { movies: { "download_title": {...}, ... } }
// Sonarr likely returns { queue: { "download_title": {...}, ... } } or { episodes: {...} }
function dqParseResponse(response) {
  if (!response) return [];
  // Try known top-level keys (object of objects)
  for (const key of ['movies', 'queue', 'episodes', 'records']) {
    if (response[key] && typeof response[key] === 'object') {
      const val = response[key];
      // Could be an array or an object keyed by download title
      return Array.isArray(val) ? val : Object.values(val);
    }
  }
  // Fallback: if response itself looks like an array
  if (Array.isArray(response)) return response;
  return [];
}

// ── Card ─────────────────────────────────────────────────────────────────────

class DownloadQueueCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config       = null;
    this._hass         = null;
    this._sonarrItems  = null;
    this._radarrItems  = null;
    this._loading      = false;
    this._error        = null;
    this._refreshTimer = null;
    this._hasFetched   = false;
  }

  connectedCallback() {
    if (this._hass && this._config && !this._hasFetched) this._fetch();
  }

  disconnectedCallback() { this._clearTimer(); }

  _clearTimer() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  }

  _startTimer() {
    this._clearTimer();
    const mins = this._config?.refresh_minutes ?? 1;
    this._refreshTimer = setInterval(() => this._fetch(), mins * 60000);
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;
    const hasSource = this._config?.sonarr_entry_id || this._config?.radarr_entry_id;
    if (firstSet && hasSource) { this._fetch(); this._startTimer(); }
  }

  async _fetch() {
    const cfg = this._config;
    if (!this._hass || (!cfg?.sonarr_entry_id && !cfg?.radarr_entry_id)) return;
    this._loading = true;
    this._render();
    const calls = [];

    if (cfg.sonarr_entry_id) {
      calls.push(
        this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'sonarr', service: 'get_queue',
          service_data: { entry_id: cfg.sonarr_entry_id, max_items: 0 },
          return_response: true,
        }).then(r => ({ source: 'sonarr', data: r?.response }))
          .catch(e => ({ source: 'sonarr', error: e?.message || 'Sonarr call failed' }))
      );
    }

    if (cfg.radarr_entry_id) {
      calls.push(
        this._hass.connection.sendMessagePromise({
          type: 'call_service', domain: 'radarr', service: 'get_queue',
          service_data: { entry_id: cfg.radarr_entry_id, max_items: 0 },
          return_response: true,
        }).then(r => ({ source: 'radarr', data: r?.response }))
          .catch(e => ({ source: 'radarr', error: e?.message || 'Radarr call failed' }))
      );
    }

    try {
      const results = await Promise.all(calls);
      const errors  = results.filter(r => r.error).map(r => `${r.source}: ${r.error}`);
      this._error = errors.length ? errors.join(' | ') : null;
      for (const res of results) {
        const items = dqParseResponse(res.data);
        if (res.source === 'sonarr') this._sonarrItems = items;
        if (res.source === 'radarr') this._radarrItems = items;
      }
      this._hasFetched = true;
    } catch (err) {
      this._error = err?.message || 'Fetch failed';
    } finally {
      this._loading = false;
      this._render();
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _itemHtml(item, type) {
    const showPoster = this._config?.show_poster !== false;
    const poster     = item.images?.poster ?? item.images?.fanart ?? null;

    // Title
    const mainTitle = item.title || 'Unknown';
    // Sonarr sub-line: episode identifier + episode title
    const subLine   = [item.episode_identifier, item.episode_title].filter(Boolean).join(' · ');

    const status   = item.status || 'unknown';
    const statusCo = dqStatusColor(status);
    const pct      = dqParseProgress(item);

    const size     = Number(item.size ?? 0);
    const sizeLeft = Number(item.size_left ?? item.sizeleft ?? 0);
    const downloaded = dqFormatBytes(size - sizeLeft);
    const total      = dqFormatBytes(size);
    const timeLeft   = dqFormatTimeLeft(item.time_left ?? item.timeleft);
    const quality    = item.quality || '';
    const protocol   = dqProtocol(item.protocol);
    const client     = item.download_client || '';
    const indexer    = item.indexer || '';

    const errMsg = item.error_message ||
      (item.status_messages || []).map(m => m.title || m.message || '').filter(Boolean).join('; ') ||
      null;

    const metaBits = [quality, protocol, client].filter(Boolean);

    return `
    <div class="q-row">
      ${showPoster ? `
      <div class="poster-col">
        ${poster
          ? `<img class="poster" src="${poster}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">`
          : `<div class="poster no-img"><ha-icon icon="mdi:${type === 'radarr' ? 'movie' : 'television'}"></ha-icon></div>`}
      </div>` : ''}
      <div class="q-body">
        <div class="q-title">${mainTitle}</div>
        ${subLine ? `<div class="q-sub">${subLine}</div>` : ''}
        <div class="q-progress-row">
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct != null ? pct.toFixed(1) : 0}%;background:${statusCo}"></div>
          </div>
          <span class="pct-label">${pct != null ? pct.toFixed(0) + '%' : ''}</span>
        </div>
        <div class="q-meta-row">
          <span class="status-pill" style="color:${statusCo}">${status}</span>
          ${timeLeft            ? `<span class="meta-sep">·</span><span class="meta-bit">⏱ ${timeLeft}</span>` : ''}
          ${downloaded && total ? `<span class="meta-sep">·</span><span class="meta-bit">${downloaded} / ${total}</span>` : ''}
          ${metaBits.length     ? `<span class="meta-sep">·</span><span class="meta-bit">${metaBits.join(' · ')}</span>` : ''}
        </div>
        ${errMsg ? `<div class="err-msg">⚠ ${errMsg}</div>` : ''}
      </div>
    </div>`;
  }

  _sectionHtml(items, type, label) {
    if (!items || !items.length) return '';
    return `
      <div class="section-hdr">
        <ha-icon icon="mdi:${type === 'radarr' ? 'movie-open' : 'television-play'}"></ha-icon>
        ${label}
        <span class="section-count">${items.length}</span>
      </div>
      ${items.map(it => this._itemHtml(it, type)).join('')}`;
  }

  _render() {
    if (!this._config) return;
    const cfg   = this._config;
    const title = cfg.title || 'Download Queue';
    const hasSource = cfg.sonarr_entry_id || cfg.radarr_entry_id;
    const hasBoth   = cfg.sonarr_entry_id && cfg.radarr_entry_id;

    let bodyHtml;
    if (!hasSource) {
      bodyHtml = `<div class="info-msg">Set <code>sonarr_entry_id</code> and/or <code>radarr_entry_id</code> in the card config.</div>`;
    } else if (this._loading && !this._hasFetched) {
      bodyHtml = `<div class="info-msg loading"><span class="spin">↻</span> Loading…</div>`;
    } else if (this._error && !this._hasFetched) {
      bodyHtml = `<div class="info-msg error">⚠ ${this._error}</div>`;
    } else {
      const sonarrItems = this._sonarrItems ?? [];
      const radarrItems = this._radarrItems ?? [];
      const total = sonarrItems.length + radarrItems.length;

      if (total === 0) {
        bodyHtml = `<div class="info-msg">Queue is empty.</div>`;
      } else {
        bodyHtml = hasBoth
          ? this._sectionHtml(sonarrItems, 'sonarr', 'Sonarr') +
            this._sectionHtml(radarrItems, 'radarr', 'Radarr')
          : (sonarrItems.length
              ? sonarrItems.map(it => this._itemHtml(it, 'sonarr')).join('')
              : radarrItems.map(it => this._itemHtml(it, 'radarr')).join(''));
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        .card-hdr {
          display: flex; align-items: center;
          padding: 13px 16px 11px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12));
        }
        .card-title { flex: 1; font-size: 1em; font-weight: 600; color: var(--primary-text-color); }
        .refresh-icon {
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
          cursor: pointer; padding: 4px; border-radius: 4px;
          ${this._loading ? 'animation: spin 1s linear infinite;' : ''}
          transition: color .2s;
        }
        .refresh-icon:hover { color: var(--primary-color); }
        @keyframes spin { to { transform: rotate(360deg); } }

        .section-hdr {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 14px 5px;
          font-size: .7em; font-weight: 700;
          text-transform: uppercase; letter-spacing: .08em;
          color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(0,0,0,.03));
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.08));
          --mdc-icon-size: 13px;
        }
        .section-count {
          margin-left: auto;
          background: var(--divider-color, rgba(0,0,0,.12));
          color: var(--secondary-text-color);
          font-size: .85em; padding: 1px 6px; border-radius: 8px;
        }

        .q-row {
          display: flex; align-items: flex-start;
          padding: 10px 14px; gap: 11px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.06));
        }
        .q-row:last-child { border-bottom: none; }

        .poster-col { flex-shrink: 0; width: 40px; }
        .poster {
          width: 40px; height: 60px;
          border-radius: 4px; object-fit: cover; display: block;
          background: var(--secondary-background-color);
        }
        .poster.no-img {
          width: 40px; height: 60px; border-radius: 4px;
          background: var(--secondary-background-color);
          display: flex; align-items: center; justify-content: center;
          --mdc-icon-size: 20px; color: var(--disabled-text-color, #9e9e9e);
        }

        .q-body { flex: 1; min-width: 0; }
        .q-title {
          font-size: .9em; font-weight: 600; color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 2px;
        }
        .q-sub {
          font-size: .75em; color: var(--secondary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 5px; font-family: monospace;
        }

        .q-progress-row {
          display: flex; align-items: center; gap: 6px; margin-bottom: 5px;
        }
        .progress-bar {
          flex: 1; height: 4px;
          background: var(--divider-color, rgba(0,0,0,.12));
          border-radius: 2px; overflow: hidden;
        }
        .progress-fill { height: 100%; border-radius: 2px; transition: width .4s; }
        .pct-label {
          font-size: .7em; color: var(--secondary-text-color);
          flex-shrink: 0; width: 30px; text-align: right;
        }

        .q-meta-row {
          display: flex; align-items: center; gap: 5px;
          font-size: .72em; flex-wrap: wrap; color: var(--secondary-text-color);
        }
        .status-pill { font-weight: 700; text-transform: capitalize; }
        .meta-sep { opacity: .35; }
        .meta-bit { color: var(--secondary-text-color); }

        .err-msg {
          font-size: .72em; color: var(--error-color, #f44336);
          margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .info-msg {
          padding: 22px 16px; font-size: .85em;
          color: var(--secondary-text-color); text-align: center;
        }
        .info-msg.error { color: var(--error-color, #f44336); }
        .info-msg code {
          font-size: .9em; background: var(--secondary-background-color);
          padding: 1px 5px; border-radius: 3px;
        }
        .spin { display: inline-block; animation: spin 1s linear infinite; }
      </style>

      <ha-card>
        <div class="card-hdr">
          <div class="card-title">${title}</div>
          <ha-icon class="refresh-icon" id="refresh" icon="mdi:refresh"></ha-icon>
        </div>
        ${bodyHtml}
      </ha-card>
    `;

    this.shadowRoot.getElementById('refresh')?.addEventListener('click', () => this._fetch());
  }

  getCardSize() {
    const n = (this._sonarrItems?.length ?? 0) + (this._radarrItems?.length ?? 0);
    return n ? 1 + n : 3;
  }

  static getConfigElement() { return document.createElement('download-queue-card-editor'); }
  static getStubConfig()    { return { title: 'Download Queue', sonarr_entry_id: '', radarr_entry_id: '' }; }
}

customElements.define('download-queue-card', DownloadQueueCard);

// ── Editor ────────────────────────────────────────────────────────────────────

class DownloadQueueCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {}; this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming; this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    });
  }

  set hass(_) {}

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return String(ev.detail.value);
    const path  = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _fire(config) {
    this._config = { ...config }; this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') { if (raw === '') delete config[key]; else config[key] = Number(raw); }
      else { if (raw) config[key] = raw; else delete config[key]; }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;
    const f = (k) => (c[k] ?? '').toString().replace(/"/g, '&quot;');
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;padding-bottom:16px}
        ha-textfield{display:block;width:100%;margin-bottom:8px}
        .section{font-size:.78em;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.07em;padding:16px 0 8px;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.12));margin-bottom:12px}
        .hint{font-size:.75em;color:var(--secondary-text-color);margin:-4px 0 10px;line-height:1.4}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row2 ha-textfield{margin-bottom:0}
      </style>
      <div class="section">Basic</div>
      <ha-textfield id="f-title"   label="Card Title"      value="${f('title')}"></ha-textfield>
      <div class="section">Sources</div>
      <ha-textfield id="f-sonarr" label="Sonarr Entry ID" value="${f('sonarr_entry_id')}"></ha-textfield>
      <ha-textfield id="f-radarr" label="Radarr Entry ID" value="${f('radarr_entry_id')}"></ha-textfield>
      <div class="hint">Leave blank to disable that source. Find entry IDs in Settings → Devices & Services.</div>
      <div class="section">Options</div>
      <div class="row2">
        <ha-textfield id="f-refresh" label="Refresh (minutes)" type="number" min="1" max="60" value="${c.refresh_minutes ?? 1}"></ha-textfield>
      </div>
    `;
    this._bindText('f-title',   'title');
    this._bindText('f-sonarr',  'sonarr_entry_id');
    this._bindText('f-radarr',  'radarr_entry_id');
    this._bindText('f-refresh', 'refresh_minutes', 'number');
  }
}

customElements.define('download-queue-card-editor', DownloadQueueCardEditor);
