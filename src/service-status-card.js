/**
 * Service Status Card for Home Assistant
 *
 * A status page for everything you monitor. Uptime Kuma monitors are found
 * automatically; UptimeRobot, Ping or any other up/down sensor can be added.
 * Each row shows a status light, response time, a 24-hour history bar
 * (from Home Assistant's own history), uptime and certificate expiry.
 *
 * Configuration:
 *   type: custom:service-status-card
 *   title: Services
 *   hide_uptime_kuma: false      # Uptime Kuma monitors are included automatically
 *   groups:                      # Optional: split monitors into groups (name match, partial)
 *     - name: Self-hosted
 *       monitors: [Home Assistant, My Website, Jellyfin, Jellyseerr]
 *     - name: Internet
 *       monitors: [Google, Amazon, Cloudflare, Microsoft, Oracle, Bell]
 *   extra:                       # Other up/down sensors
 *     - entity: binary_sensor.minecraftmap_russellcorbett_ca
 *       name: Minecraft Map
 *       group: Self-hosted
 *   exclude: [Oracle Servers]
 *   slow_ms: 1000                # Response time shown amber above this (default 1000)
 *   cert_warn_days: 14           # Certificate expiry shown amber below this (default 14)
 */

const SS_BUCKETS = 48;           // 24 h in 30-minute slots
const SS_RANK = { down: 3, pending: 2, maintenance: 1, up: 0 };

const ssEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Normalise any monitor state to up / down / pending / maintenance / unknown.
function ssNorm(state) {
  const s = String(state ?? '').toLowerCase();
  if (['up', 'on', 'online', 'ok', 'connected', 'home'].includes(s)) return 'up';
  if (['down', 'off', 'offline', 'seems_down', 'problem', 'not_home'].includes(s)) return 'down';
  if (['pending', 'not_checked_yet', 'started'].includes(s)) return 'pending';
  if (['maintenance', 'pause', 'paused'].includes(s)) return 'maintenance';
  return 'unknown';
}

class ServiceStatusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._monitors = [];
    this._watched = [];
    this._history = {};
    this._resolvedFor = null;
    this.shadowRoot.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-e]');
      if (el) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    });
  }

  setConfig(config) {
    this._config = config || {};
    this._resolvedFor = null;
    if (this._hass) { this._resolve(); this._fetchHistory(); }
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) { this._resolve(); this._fetchHistory(); }
    else if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  connectedCallback() {
    // History bars move on their own; refresh them every 10 minutes while visible.
    this._timer = setInterval(() => { if (!document.hidden) this._fetchHistory(); }, 600000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

  _resolve() {
    const hass = this._hass;
    const cfg = this._config;
    this._resolvedFor = hass.entities;
    const monitors = [];

    if (!cfg.hide_uptime_kuma && cfg.uptime_kuma !== false) {
      const byDev = {};
      for (const e of Object.values(hass.entities || {})) {
        if (e.platform !== 'uptime_kuma' || !e.device_id || !e.entity_id.startsWith('sensor.')) continue;
        const d = (byDev[e.device_id] ||= {});
        const id = e.entity_id;
        if (id.endsWith('_status')) d.status = id;
        else if (id.endsWith('_response_time')) d.response = id;
        else if (id.endsWith('_uptime_1_day')) d.up1 = id;
        else if (id.endsWith('_uptime_30_days')) d.up30 = id;
        else if (id.endsWith('_uptime_365_days')) d.up365 = id;
        else if (id.endsWith('_certificate_expiry')) d.cert = id;
        else if (id.endsWith('_monitored_url')) d.url = id;
      }
      for (const [devId, d] of Object.entries(byDev)) {
        if (!d.status) continue;   // skips the Uptime Kuma server's own device
        const dev = hass.devices?.[devId];
        monitors.push({ ...d, name: dev?.name_by_user || dev?.name || d.status, group: null });
      }
    }
    for (const x of cfg.extra || []) {
      const ent = typeof x === 'string' ? { entity: x } : x;
      if (!ent.entity) continue;
      monitors.push({ status: ent.entity, name: ent.name || hass.states[ent.entity]?.attributes?.friendly_name || ent.entity,
        group: ent.group || null, url: null, urlText: hass.states[ent.entity]?.attributes?.target });
    }

    const exclude = (cfg.exclude || []).map((s) => String(s).toLowerCase());
    this._monitors = monitors.filter((m) => !exclude.some((x) => m.name.toLowerCase().includes(x)));
    this._watched = this._monitors.flatMap((m) => [m.status, m.response, m.up1, m.cert]).filter(Boolean);
  }

  // Ask HA's recorder for the last 24 h of each status entity, then reduce
  // it to 48 half-hour slots, each showing the worst state seen in it.
  async _fetchHistory() {
    if (!this._hass?.callWS || !this._monitors.length) return;
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    try {
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: this._monitors.map((m) => m.status),
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const slot = (end - start) / SS_BUCKETS;
      const history = {};
      for (const [id, changes] of Object.entries(res || {})) {
        const pts = changes.map((c) => ({ t: (c.lu ?? c.lc ?? 0) * 1000, s: ssNorm(c.s) })).sort((a, b) => a.t - b.t);
        const buckets = [];
        for (let i = 0; i < SS_BUCKETS; i++) {
          const b0 = start.getTime() + i * slot, b1 = b0 + slot;
          let worst = null;
          const before = pts.filter((p) => p.t <= b0).pop();
          const states = [before?.s, ...pts.filter((p) => p.t > b0 && p.t < b1).map((p) => p.s)].filter((s) => s && s !== 'unknown');
          for (const s of states) if (worst == null || SS_RANK[s] > SS_RANK[worst]) worst = s;
          buckets.push(worst || 'none');
        }
        history[id] = buckets;
      }
      this._history = history;
      this._lastHtml = null;
      this._render();
    } catch (e) {
      console.warn('service-status-card: history unavailable', e);
    }
  }

  _num(id) {
    const v = parseFloat(this._hass?.states[id]?.state);
    return isNaN(v) ? null : v;
  }

  _row(m) {
    const cfg = this._config;
    const hass = this._hass;
    const state = ssNorm(hass?.states[m.status]?.state);
    const ms = this._num(m.response);
    const up1 = this._num(m.up1), up30 = this._num(m.up30), up365 = this._num(m.up365);
    const cert = this._num(m.cert);
    const url = m.url ? hass.states[m.url]?.state : m.urlText;
    const slow = ms != null && ms > (cfg.slow_ms ?? 1000);
    const certWarn = cert != null && cert <= (cfg.cert_warn_days ?? 14);
    const hist = this._history[m.status];
    const label = { up: 'Up', down: 'Down', pending: 'Pending', maintenance: 'Paused', unknown: 'Unknown' }[state];
    const uptimeTitle = [up1 != null && `24 h: ${up1.toFixed(2)}%`, up30 != null && `30 d: ${up30.toFixed(2)}%`, up365 != null && `1 y: ${up365.toFixed(2)}%`].filter(Boolean).join('  ·  ');

    return `
      <div class="row st-${state}">
        <div class="name" data-e="${ssEsc(m.status)}" title="${ssEsc(url || '')}">
          <span class="dot"></span>
          <div class="nb"><div class="nm">${ssEsc(m.name)}</div>
            <div class="sub">${state !== 'up' ? `<b>${label}</b>` : ''}${ms != null ? `<span class="${slow ? 'slow' : ''}">${ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms'}</span>` : ''}${certWarn ? `<span class="cert">cert ${Math.round(cert)}d</span>` : ''}</div>
          </div>
        </div>
        <div class="hist" title="Last 24 hours">${hist
          ? hist.map((b) => `<i class="b-${b}"></i>`).join('')
          : `<span class="nohist">${hass?.callWS ? '' : 'No history'}</span>`}</div>
        <div class="up" title="${ssEsc(uptimeTitle)}" ${m.up1 ? `data-e="${ssEsc(m.up1)}"` : ''}>${up1 != null ? `${up1 >= 99.95 ? '100' : up1.toFixed(1)}%` : ''}</div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const hass = this._hass;
    const mons = this._monitors;

    // Assign groups: explicit monitor.group, else the first config group whose list matches the name.
    const groupsCfg = cfg.groups || [];
    const grouped = new Map(groupsCfg.map((g) => [g.name, []]));
    const other = [];
    for (const m of mons) {
      let g = m.group;
      if (!g) {
        const hit = groupsCfg.find((gc) => (gc.monitors || []).some((x) => m.name.toLowerCase().includes(String(x).toLowerCase())));
        g = hit?.name;
      }
      if (g && grouped.has(g)) grouped.get(g).push(m);
      else if (g) grouped.set(g, [m]);
      else other.push(m);
    }
    if (other.length) grouped.set(groupsCfg.length ? 'Other' : '', other);

    const states = mons.map((m) => ssNorm(hass?.states[m.status]?.state));
    const down = mons.filter((m, i) => states[i] === 'down');
    const tone = down.length ? 'crit' : states.some((s) => s === 'pending' || s === 'unknown') ? 'warn' : 'ok';
    const headline = down.length
      ? `${down.length === 1 ? down[0].name + ' is' : down.length + ' services are'} down`
      : tone === 'warn' ? 'Some checks pending' : 'All systems operational';
    const times = mons.map((m) => this._num(m.response)).filter((v) => v != null);
    // Median, so one very slow monitor doesn't distort the headline number.
    const sorted = [...times].sort((a, b) => a - b);
    const avg = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;

    const order = (list) => [...list].sort((a, b) => (ssNorm(hass?.states[b.status]?.state) === 'down') - (ssNorm(hass?.states[a.status]?.state) === 'down'));
    const body = [...grouped.entries()].filter(([, list]) => list.length).map(([name, list]) => `
      ${name ? `<div class="gt">${ssEsc(name)}<span>${list.filter((m) => ssNorm(hass?.states[m.status]?.state) === 'up').length}/${list.length}</span></div>` : ''}
      <div class="rows">${order(list).map((m) => this._row(m)).join('')}</div>`).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .head { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; margin-bottom: 10px; }
        .head.ok   { background: rgba(76,175,80,.13); }
        .head.warn { background: rgba(255,152,0,.13); }
        .head.crit { background: rgba(244,67,54,.15); }
        .head ha-icon { --mdc-icon-size: 28px; flex-shrink: 0; }
        .ok ha-icon { color: var(--success-color,#4caf50); } .warn ha-icon { color: var(--warning-color,#ff9800); } .crit ha-icon { color: var(--error-color,#f44336); }
        .hb { flex: 1; min-width: 0; }
        .ht { font-size: .75em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .hl { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .avg { text-align: right; font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; }
        .avg b { display: block; font-size: 1.3em; color: var(--primary-text-color); }

        .gt { display: flex; justify-content: space-between; font-size: .75em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
              color: var(--secondary-text-color); margin: 12px 2px 4px; }
        .rows { display: flex; flex-direction: column; }
        .row { display: grid; grid-template-columns: minmax(110px, 38%) 1fr 44px; align-items: center; gap: 10px; padding: 7px 2px;
               border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.12)); }
        .row:last-child { border-bottom: none; }
        .name { display: flex; align-items: center; gap: 9px; min-width: 0; cursor: pointer; }
        .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--success-color,#4caf50); }
        .st-down .dot { background: var(--error-color,#f44336); box-shadow: 0 0 0 3px rgba(244,67,54,.25); animation: blink 1.2s infinite; }
        .st-pending .dot, .st-unknown .dot { background: var(--warning-color,#ff9800); }
        .st-maintenance .dot { background: var(--info-color,#2196f3); }
        @keyframes blink { 50% { opacity: .35; } }
        .nb { min-width: 0; }
        .nm { font-size: .9em; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .st-down .nm { color: var(--error-color,#f44336); font-weight: 600; }
        .sub { display: flex; gap: 6px; font-size: .72em; color: var(--secondary-text-color); white-space: nowrap; }
        .sub b { color: var(--error-color,#f44336); }
        .st-maintenance .sub b, .st-pending .sub b { color: var(--warning-color,#ff9800); }
        .slow { color: var(--warning-color,#ff9800); font-weight: 600; }
        .cert { color: var(--warning-color,#ff9800); }
        .hist { display: flex; gap: 2px; height: 20px; align-items: stretch; min-width: 0; }
        .hist i { flex: 1; min-width: 1px; border-radius: 2px; background: rgba(127,127,127,.18); }
        .hist .b-up { background: var(--success-color,#4caf50); opacity: .8; }
        .hist .b-down { background: var(--error-color,#f44336); }
        .hist .b-pending { background: var(--warning-color,#ff9800); }
        .hist .b-maintenance { background: var(--info-color,#2196f3); opacity: .7; }
        .nohist { font-size: .72em; color: var(--secondary-text-color); align-self: center; }
        .up { text-align: right; font-size: .82em; font-weight: 600; color: var(--primary-text-color); font-variant-numeric: tabular-nums; cursor: pointer; }
        @media (max-width: 420px) { .row { grid-template-columns: minmax(96px, 42%) 1fr 40px; gap: 8px; } .hist { gap: 1px; } }
      </style>
      <ha-card>
        <div class="head ${tone}">
          <ha-icon icon="${tone === 'ok' ? 'mdi:check-circle' : tone === 'warn' ? 'mdi:progress-clock' : 'mdi:alert-circle'}"></ha-icon>
          <div class="hb"><div class="ht">${ssEsc(cfg.title || 'Services')}</div><div class="hl">${ssEsc(headline)}</div></div>
          ${avg != null ? `<div class="avg"><b>${avg >= 1000 ? (avg / 1000).toFixed(1) + ' s' : Math.round(avg) + ' ms'}</b>typical response</div>` : ''}
        </div>
        ${mons.length ? body : `<div class="gt">No monitors found — set up Uptime Kuma or add sensors under "extra".</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() { return 6; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('service-status-card-editor');
  }

  static getStubConfig() { return { title: 'Services' }; }
}

customElements.define('service-status-card', ServiceStatusCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'service-status-card',
  name: 'Service Status Card',
  description: 'Status page for Uptime Kuma and other monitors, with 24-hour history bars.',
  preview: false,
});

class ServiceStatusCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:list-status', schema: [
        f.text('title', 'Title'),
        f.toggle('hide_uptime_kuma', 'Skip Uptime Kuma monitors', 'Uptime Kuma monitors are included automatically'),
        f.grid(
          f.number('slow_ms', 'Slow above', { min: 50, unit: 'ms', helper: 'Default: 1000' }),
          f.number('cert_warn_days', 'Certificate warning under', { min: 1, unit: 'days', helper: 'Default: 14' }),
        ),
        f.states('exclude', 'Hide monitors', [], 'Part of a monitor name'),
      ] },
      { title: 'Groups', icon: 'mdi:format-list-group', open: false, list: {
        key: 'groups',
        schema: [f.text('name', 'Group name'), f.states('monitors', 'Monitors in this group', [], 'Part of each monitor name')],
        label: (g, i) => g.name || `Group ${i + 1}`,
        newItem: () => ({ name: '' }),
        addLabel: 'Add group',
      } },
      { title: 'Other monitors', icon: 'mdi:plus-network', open: false, list: {
        key: 'extra',
        schema: [f.entity('entity', 'Up/down sensor', 'e.g. an UptimeRobot or Ping sensor'), f.grid(f.text('name', 'Name'), f.text('group', 'Group'))],
        label: (x, i) => x.name || x.entity || `Monitor ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add monitor',
      } },
    ];
  }
}

customElements.define('service-status-card-editor', ServiceStatusCardEditor);
