/**
 * Sonarr Upcoming Card for Home Assistant
 *
 * Calls the sonarr.get_upcoming service (services with response, HA 2023.7+)
 * and displays upcoming episodes grouped by air date, with poster art.
 *
 * type: custom:sonarr-upcoming-card
 * title: Upcoming Episodes          # optional
 * config_entry_id: abc123           # required — your Sonarr integration entry ID
 * days: 7                           # how many days ahead to fetch (default 7)
 * refresh_minutes: 30              # auto-refresh interval (default 30)
 * show_overview: false             # show episode synopsis (default false)
 * show_poster: true                # show series poster thumbnail (default true)
 */

class SonarrUpcomingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config      = null;
    this._hass        = null;
    this._episodes    = null;  // raw episodes object from service response
    this._loading     = false;
    this._error       = null;
    this._refreshTimer = null;
    this._hasFetched  = false;
  }

  connectedCallback() {
    if (this._hass && this._config && !this._hasFetched) {
      this._fetchUpcoming();
    }
  }

  disconnectedCallback() {
    this._clearTimer();
  }

  _clearTimer() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  _startTimer() {
    this._clearTimer();
    const mins = this._config?.refresh_minutes ?? 30;
    this._refreshTimer = setInterval(() => this._fetchUpcoming(), mins * 60000);
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;
    if (firstSet && this._config?.entry_id) {
      this._fetchUpcoming();
      this._startTimer();
    }
  }

  async _fetchUpcoming() {
    if (!this._hass || !this._config?.entry_id) return;

    this._loading = true;
    this._render();

    try {
      const days  = this._config.days ?? 7;
      const now   = new Date();
      const start = now.toISOString().split('T')[0];
      const end   = new Date(now.getTime() + days * 86400000).toISOString().split('T')[0];

      const msg = {
        type:           'call_service',
        domain:         'sonarr',
        service:        'get_upcoming',
        service_data:   {
          entry_id: this._config.entry_id,
          days:     this._config.days ?? 7,
        },
        return_response: true,
      };

      const result = await this._hass.connection.sendMessagePromise(msg);
      this._episodes   = result?.response?.episodes ?? {};
      this._error      = null;
      this._hasFetched = true;
    } catch (err) {
      this._error = err?.message || 'Service call failed';
      console.error('sonarr-upcoming-card:', err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  // ── Data helpers ─────────────────────────────────────────────────────────────

  _groupByDate(episodes) {
    const groups = {};
    for (const ep of Object.values(episodes)) {
      const key = (ep.air_date || '').split(' ')[0] || 'unknown';
      (groups[key] = groups[key] || []).push(ep);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, eps]) => ({
        date,
        episodes: eps.sort((a, b) =>
          (a.air_date_utc || '').localeCompare(b.air_date_utc || '')),
      }));
  }

  _dateLabel(dateStr) {
    if (!dateStr || dateStr === 'unknown') return 'Unknown Date';
    const d     = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const tom   = new Date(today); tom.setDate(today.getDate() + 1);
    const same  = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return 'Today';
    if (same(d, tom))   return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────

  _networkStyle(network) {
    const map = {
      'hulu':         'background:#1ce78320;color:#1ce783;border-color:#1ce78350',
      'disney+':      'background:#113ccf20;color:#6b8cff;border-color:#113ccf50',
      'apple tv':     'background:#44444420;color:#aaa;border-color:#44444450',
      'apple tv+':    'background:#44444420;color:#aaa;border-color:#44444450',
      'netflix':      'background:#e5091420;color:#e50914;border-color:#e5091450',
      'max':          'background:#002be720;color:#6688ff;border-color:#002be750',
      'amazon':       'background:#00a8e020;color:#00a8e0;border-color:#00a8e050',
      'prime video':  'background:#00a8e020;color:#00a8e0;border-color:#00a8e050',
      'paramount+':   'background:#0064ff20;color:#0064ff;border-color:#0064ff50',
      'peacock':      'background:#f5a62320;color:#f5a623;border-color:#f5a62350',
      'amc':          'background:#cc000020;color:#cc0000;border-color:#cc000050',
      'fox':          'background:#ffd70020;color:#e6c200;border-color:#ffd70050',
      'abc':          'background:#00529b20;color:#5599cc;border-color:#00529b50',
      'nbc':          'background:#d9000020;color:#ff6666;border-color:#d9000050',
      'cbs':          'background:#0066cc20;color:#5599ff;border-color:#0066cc50',
      'hbo':          'background:#6e0bce20;color:#b06eff;border-color:#6e0bce50',
      'showtime':     'background:#cc000020;color:#ff5555;border-color:#cc000050',
      'starz':        'background:#00000020;color:#888;border-color:#44444450',
      'fx':           'background:#ff000020;color:#ff6666;border-color:#ff000050',
      'syfy':         'background:#1a1aff20;color:#6666ff;border-color:#1a1aff50',
    };
    return map[(network || '').toLowerCase()] || '';
  }

  _episodeHtml(ep) {
    const showPoster   = this._config?.show_poster   !== false;
    const showOverview = this._config?.show_overview  === true;
    const poster       = ep.images?.poster;

    const isReady   = ep.has_file;
    const finaleMap = { season: 'Season Finale', series: 'Series Finale', mid_season: 'Mid-Season Finale' };
    const finale    = finaleMap[ep.finale_type] ?? null;
    const netStyle  = this._networkStyle(ep.network);
    const airTime   = ep.air_date_utc
      ? new Date(ep.air_date_utc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : null;

    return `
    <div class="ep-row">
      ${showPoster ? `
      <div class="poster-col">
        ${poster
          ? `<img class="poster" src="${poster}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">`
          : `<div class="poster no-img"></div>`}
      </div>` : ''}
      <div class="ep-body">
        <div class="series-name">${ep.series_title || 'Unknown Series'}</div>
        <div class="ep-line">
          <span class="ep-id">${ep.episode_identifier || ''}</span>
          ${ep.title ? `<span class="sep">·</span><span class="ep-title">${ep.title}</span>` : ''}
          ${ep.runtime ? `<span class="runtime">${ep.runtime}m</span>` : ''}
          ${airTime ? `<span class="sep">·</span><span class="airtime">${airTime}</span>` : ''}
        </div>
        <div class="badges">
          ${ep.network   ? `<span class="badge network" ${netStyle ? `style="${netStyle}"` : ''}>${ep.network}</span>` : ''}
          ${finale       ? `<span class="badge finale">${finale}</span>` : ''}
          ${isReady
            ? `<span class="badge ready">✓ Ready</span>`
            : `<span class="badge upcoming">Upcoming</span>`}
        </div>
        ${showOverview && ep.overview ? `<div class="overview">${ep.overview}</div>` : ''}
      </div>
    </div>`;
  }

  _render() {
    if (!this._config) return;

    const title  = this._config.title || 'Upcoming Episodes';
    const groups = this._episodes ? this._groupByDate(this._episodes) : [];

    let bodyHtml;
    if (!this._config.entry_id) {
      bodyHtml = `<div class="info-msg">Set <code>entry_id</code> in the card config.</div>`;
    } else if (this._loading && !this._hasFetched) {
      bodyHtml = `<div class="info-msg loading"><span class="spin">↻</span> Loading…</div>`;
    } else if (this._error) {
      bodyHtml = `<div class="info-msg error">⚠ ${this._error}</div>`;
    } else if (!groups.length) {
      bodyHtml = `<div class="info-msg">No upcoming episodes in the next ${this._config.days ?? 7} days.</div>`;
    } else {
      bodyHtml = groups.map(({ date, episodes }) => {
        const label   = this._dateLabel(date);
        const isToday = label === 'Today';
        return `
        <div class="date-group">
          <div class="date-hdr${isToday ? ' today' : ''}">${label}</div>
          ${episodes.map(ep => this._episodeHtml(ep)).join('')}
        </div>`;
      }).join('');
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        /* ── Card header ── */
        .card-hdr {
          display: flex;
          align-items: center;
          padding: 13px 16px 11px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .card-title {
          flex: 1;
          font-size: 1em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .refresh-icon {
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          ${this._loading ? 'animation: spin 1s linear infinite;' : ''}
          transition: color 0.2s;
        }
        .refresh-icon:hover { color: var(--primary-color); }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Date groups ── */
        .date-hdr {
          padding: 8px 14px 6px;
          font-size: 0.7em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(0,0,0,0.03));
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.08));
        }
        .date-hdr.today { color: var(--primary-color, #03a9f4); }

        /* ── Episode rows ── */
        .ep-row {
          display: flex;
          align-items: flex-start;
          padding: 10px 14px;
          gap: 12px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.06));
        }
        .date-group .ep-row:last-child { border-bottom: none; }
        .date-group + .date-group { border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }

        /* Poster */
        .poster-col { flex-shrink: 0; width: 42px; }
        .poster {
          width: 42px;
          height: 63px;
          border-radius: 5px;
          object-fit: cover;
          display: block;
          background: var(--secondary-background-color);
        }
        .poster.no-img {
          background: var(--secondary-background-color);
          border-radius: 5px;
        }

        /* Info */
        .ep-body { flex: 1; min-width: 0; }
        .series-name {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 3px;
        }
        .ep-line {
          display: flex;
          align-items: baseline;
          gap: 4px;
          font-size: 0.78em;
          color: var(--secondary-text-color);
          margin-bottom: 5px;
          flex-wrap: nowrap;
          overflow: hidden;
        }
        .ep-id { font-family: monospace; font-weight: 700; font-size: 1em; flex-shrink: 0; }
        .sep   { opacity: 0.4; flex-shrink: 0; }
        .ep-title {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .runtime { flex-shrink: 0; color: var(--disabled-text-color, #9e9e9e); padding-left: 4px; }
        .airtime { flex-shrink: 0; color: var(--disabled-text-color, #9e9e9e); }

        /* Badges */
        .badges { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
        .badge {
          font-size: 0.63em;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 10px;
          border: 1px solid transparent;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .badge.network {
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          border-color: var(--divider-color, rgba(0,0,0,0.15));
        }
        .badge.finale {
          background: rgba(156,39,176,0.12);
          color: #b06eff;
          border-color: rgba(156,39,176,0.35);
        }
        .badge.ready {
          background: rgba(76,175,80,0.12);
          color: var(--success-color, #4caf50);
          border-color: rgba(76,175,80,0.3);
        }
        .badge.upcoming {
          background: rgba(158,158,158,0.08);
          color: var(--disabled-text-color, #9e9e9e);
          border-color: rgba(158,158,158,0.2);
        }

        /* Overview */
        .overview {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          margin-top: 5px;
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Info/error states */
        .info-msg {
          padding: 22px 16px;
          font-size: 0.85em;
          color: var(--secondary-text-color);
          text-align: center;
        }
        .info-msg.error  { color: var(--error-color, #f44336); }
        .info-msg.loading { color: var(--secondary-text-color); }
        .info-msg code {
          font-size: 0.9em;
          background: var(--secondary-background-color);
          padding: 1px 5px;
          border-radius: 3px;
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

    this.shadowRoot.getElementById('refresh')?.addEventListener('click', () => {
      this._fetchUpcoming();
    });
  }

  getCardSize() {
    if (!this._episodes) return 3;
    const groups = this._groupByDate(this._episodes);
    return 1 + groups.reduce((acc, g) => acc + 1 + g.episodes.length, 0);
  }

  static getConfigElement() {
    return document.createElement('sonarr-upcoming-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Upcoming Episodes',
      entry_id: '',
      days: 7,
    };
  }
}

customElements.define('sonarr-upcoming-card', SonarrUpcomingCard);

// ── Editor ────────────────────────────────────────────────────────────────────

class SonarrUpcomingCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config    = {};
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config    = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config }, bubbles: true, composed: true,
      }));
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
    this._config    = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config }, bubbles: true, composed: true,
    }));
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'bool') {
        config[key] = raw === 'true';
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
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
        :host { display: block; padding-bottom: 16px; }
        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }
        .section { font-size: 0.78em; font-weight: 600; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.07em; padding: 16px 0 8px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12)); margin-bottom: 12px; }
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .row2 ha-textfield { margin-bottom: 0; }
        .hint { font-size: 0.75em; color: var(--secondary-text-color); margin: -4px 0 10px; line-height: 1.4; }
      </style>

      <div class="section">Basic</div>
      <ha-textfield id="f-title" label="Card Title" value="${f('title')}"></ha-textfield>
      <ha-textfield id="f-entry" label="Sonarr Entry ID" value="${f('entry_id')}"></ha-textfield>
      <div class="hint">From your action config: <code>entry_id: 01KBC...</code></div>

      <div class="section">Options</div>
      <div class="row2">
        <ha-textfield id="f-days"    label="Days ahead"         type="number" min="1" max="90"  value="${c.days ?? 7}"></ha-textfield>
        <ha-textfield id="f-refresh" label="Refresh (minutes)"  type="number" min="5" max="1440" value="${c.refresh_minutes ?? 30}"></ha-textfield>
      </div>
    `;

    this._bindText('f-title',   'title');
    this._bindText('f-entry',   'entry_id');
    this._bindText('f-days',    'days',            'number');
    this._bindText('f-refresh', 'refresh_minutes', 'number');
  }
}

customElements.define('sonarr-upcoming-card-editor', SonarrUpcomingCardEditor);
