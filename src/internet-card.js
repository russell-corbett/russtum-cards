/**
 * Internet Card for Home Assistant
 *
 * Your connection on one card: download, upload and ping from the Speedtest
 * integration, each with a sparkline of the last day, an online/offline dot,
 * your external IP (tap to copy), which server was tested and when, and a
 * button to run a new test.
 *
 * Speedtest.net sensors (speedtestdotnet) and sensor.external_ip are found
 * automatically.
 *
 * Configuration:
 *   type: custom:internet-card
 *   title: Internet                          # Optional
 *   download: sensor.speedtest_download      # Optional overrides
 *   upload: sensor.speedtest_upload
 *   ping: sensor.speedtest_ping
 *   ip: sensor.external_ip
 *   connectivity: binary_sensor.bell_modem_ping   # Optional: shows Online / Offline
 *   plan_download: 1000                      # Optional: your plan's speeds in Mbit/s. Results under
 *   plan_upload: 50                          #   half of plan turn amber, under a quarter red.
 *   high_ping: 100                           # ms before ping turns amber (red at twice this)
 *   hours: 24                                # Sparkline history (default 24)
 *   hide_test_button: false
 */

const NC_KEYS = ['download', 'upload', 'ping'];
const ncEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ncNum = (st) => { const n = parseFloat(st?.state); return Number.isFinite(n) ? n : null; };
const ncAgo = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60 ? `${m % 60}m ` : ''}ago` : `${Math.floor(h / 24)}d ago`;
};

class InternetCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._history = {};
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    this._config = { hours: 24, high_ping: 100, ...config };
    this._lastHtml = null;
    this._resolvedFor = null;
  }

  connectedCallback() {
    // Keep "tested 20 min ago" current.
    this._tick = setInterval(() => { this._lastHtml = null; this._render(); }, 60000);
  }

  disconnectedCallback() { clearInterval(this._tick); }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    const ids = this._ids;
    if (old && this._resolvedFor === hass.entities && !ids.some((id) => hass.states[id] !== old.states[id])) return;
    // A new test result (or the first load) refreshes the sparklines.
    const stamp = NC_KEYS.map((k) => hass.states[this._e[k]]?.last_updated).join('|');
    if (stamp !== this._histStamp) { this._histStamp = stamp; this._loadHistory(); }
    if (this._testing && stamp !== this._testing) this._testing = null;
    this._render();
  }

  _resolve() {
    const h = this._hass, c = this._config, reg = h.entities || {};
    this._resolvedFor = h.entities;
    const ids = Object.keys(h.states);
    const speed = ids.filter((id) => reg[id]?.platform === 'speedtestdotnet');
    const pick = (k) => c[k] || speed.find((id) => reg[id]?.translation_key === k || id.endsWith(`_${k}`)) || (h.states[`sensor.speedtest_${k}`] ? `sensor.speedtest_${k}` : null);
    this._e = {
      download: pick('download'), upload: pick('upload'), ping: pick('ping'),
      ip: c.ip || (h.states['sensor.external_ip'] ? 'sensor.external_ip' : ids.find((id) => reg[id]?.platform === 'dnsip' && id.startsWith('sensor.')) || null),
      connectivity: c.connectivity || null,
    };
    this._ids = Object.values(this._e).filter(Boolean);
  }

  async _loadHistory() {
    const ids = NC_KEYS.map((k) => this._e[k]).filter(Boolean);
    if (!ids.length || !this._hass?.callWS) return;
    const start = new Date(Date.now() - Number(this._config.hours || 24) * 3600000);
    try {
      const res = await this._hass.callWS({ type: 'history/history_during_period', start_time: start.toISOString(), entity_ids: ids,
        minimal_response: true, no_attributes: true, significant_changes_only: false });
      for (const id of ids) {
        this._history[id] = (res?.[id] || []).map((p) => ({ t: (p.lu ?? p.lc ?? 0) * 1000, v: parseFloat(p.s) })).filter((p) => Number.isFinite(p.v));
      }
      this._lastHtml = null;
      this._render();
    } catch (e) { /* the sparklines are a nice-to-have */ }
  }

  // Small area chart of the last N hours, scaled to its own min/max.
  _spark(id) {
    const pts = this._history[id] || [];
    if (pts.length < 2) return '<div class="spark empty"></div>';
    const W = 100, H = 28, pad = 2;
    const t0 = Date.now() - Number(this._config.hours || 24) * 3600000, t1 = Date.now();
    const vs = pts.map((p) => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const x = (t) => ((Math.max(t0, t) - t0) / (t1 - t0)) * W;
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
    // Step to "now" so the line reaches the right edge.
    const all = [...pts, { t: t1, v: pts[pts.length - 1].v }];
    const line = all.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${line} L${W},${H} L${x(all[0].t).toFixed(1)},${H} Z" class="area"/>
        <path d="${line}" class="line" vector-effect="non-scaling-stroke"/>
        <line x1="0" x2="${W}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" class="avg" vector-effect="non-scaling-stroke"/>
        <circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="1.6" class="dot"/>
      </svg>`;
  }

  _stats(id, digits) {
    const vs = (this._history[id] || []).map((p) => p.v);
    if (vs.length < 2) return '';
    const f = (v) => v.toFixed(digits);
    return `Low ${f(Math.min(...vs))} · Avg ${f(vs.reduce((a, b) => a + b, 0) / vs.length)} · High ${f(Math.max(...vs))}`;
  }

  _tile(key, offline) {
    const id = this._e[key];
    if (!id) return '';
    const st = this._hass.states[id];
    const v = ncNum(st);
    const c = this._config;
    const unit = st?.attributes?.unit_of_measurement || (key === 'ping' ? 'ms' : 'Mbit/s');
    let lvl = '';
    if (v != null && key === 'ping') lvl = v >= c.high_ping * 2 ? 'crit' : v >= c.high_ping ? 'warn' : '';
    else if (v != null && c[`plan_${key}`]) { const r = v / Number(c[`plan_${key}`]); lvl = r < 0.25 ? 'crit' : r < 0.5 ? 'warn' : ''; }
    const digits = key === 'ping' ? 0 : v != null && v >= 100 ? 0 : 1;
    const label = { download: 'Download', upload: 'Upload', ping: 'Ping' }[key];
    const icon = { download: 'mdi:arrow-down-bold', upload: 'mdi:arrow-up-bold', ping: 'mdi:timer-outline' }[key];
    const plan = c[`plan_${key}`] && v != null ? `<span class="plan" title="Of your plan's ${Number(c[`plan_${key}`])} ${ncEsc(unit)}">${Math.round((v / Number(c[`plan_${key}`])) * 100)}%</span>` : '';
    return `<div class="tile ${key} ${lvl} ${offline ? 'dim' : ''}" data-act="more" data-e="${ncEsc(id)}" title="${ncEsc(this._stats(id, key === 'ping' ? 0 : 1))}">
        <div class="tl"><ha-icon icon="${icon}"></ha-icon>${label}${plan}</div>
        <div class="tv">${v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}<small>${ncEsc(unit)}</small></div>
        ${this._spark(id)}
      </div>`;
  }

  _render() {
    if (!this._config || !this._hass || !this._e) return;
    const h = this._hass, c = this._config, e = this._e;
    const conn = e.connectivity ? h.states[e.connectivity] : null;
    const offline = conn ? conn.state === 'off' : false;
    const dl = h.states[e.download];
    const ipSt = e.ip ? h.states[e.ip] : null;
    const ip = ipSt && !['unknown', 'unavailable', ''].includes(ipSt.state) ? ipSt.state : null;
    const server = dl?.attributes?.server_name;
    const tested = dl?.last_updated;
    const testing = !!this._testing;

    const html = `
      <style>
        :host { display: block; --nc-down: var(--info-color, #039be5); --nc-up: #ab47bc; --nc-ping: #26a69a; }
        ha-card { padding: 12px 12px 10px; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; }
        .title { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .status { display: inline-flex; align-items: center; gap: 5px; font-size: .78em; font-weight: 600; padding: 2px 8px; border-radius: 10px;
                  background: rgba(76,175,80,.14); color: var(--success-color, #4caf50); }
        .status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
        .status.off { background: rgba(244,67,54,.16); color: var(--error-color, #f44336); }
        .status.off::before { animation: nc-blink 1s steps(2) infinite; }
        @keyframes nc-blink { 50% { opacity: .2; } }
        .when { margin-left: auto; font-size: .78em; color: var(--secondary-text-color); white-space: nowrap; }
        .run { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
               background: rgba(127,127,127,.12); color: var(--secondary-text-color); --mdc-icon-size: 18px; }
        .run:hover { background: rgba(127,127,127,.24); color: var(--primary-text-color); }
        .run.spin ha-icon { animation: nc-spin 1s linear infinite; }
        @keyframes nc-spin { to { transform: rotate(360deg); } }
        .tiles { display: grid; grid-template-columns: 1.35fr 1fr 1fr; gap: 6px; }
        .tile { min-width: 0; padding: 8px 10px 6px; border-radius: 12px; cursor: pointer; display: flex; flex-direction: column;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); color: var(--nc-c); }
        .tile:hover { filter: brightness(1.08); }
        .tile.download { --nc-c: var(--nc-down); } .tile.upload { --nc-c: var(--nc-up); } .tile.ping { --nc-c: var(--nc-ping); }
        .tile.warn { --nc-c: var(--warning-color, #ff9800); } .tile.crit { --nc-c: var(--error-color, #f44336); }
        .tile.dim { opacity: .45; }
        .tl { display: flex; align-items: center; gap: 3px; font-size: .74em; font-weight: 600; color: var(--secondary-text-color); --mdc-icon-size: 14px; white-space: nowrap; overflow: hidden; }
        .tl ha-icon { color: var(--nc-c); }
        .plan { margin-left: auto; padding-left: 4px; font-weight: 600; color: var(--nc-c); }
        .tv { font-size: 1.5em; font-weight: 700; line-height: 1.25; color: var(--primary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tile.download .tv { font-size: 1.85em; }
        .tile.warn .tv, .tile.crit .tv { color: var(--nc-c); }
        .tv small { font-size: .45em; font-weight: 500; color: var(--secondary-text-color); margin-left: 3px; }
        .spark { display: block; width: 100%; height: 28px; margin-top: 4px; }
        .spark .area { fill: var(--nc-c); opacity: .14; }
        .spark .line { fill: none; stroke: var(--nc-c); stroke-width: 1.6; stroke-linejoin: round; }
        .spark .avg { stroke: var(--secondary-text-color); stroke-width: 1; stroke-dasharray: 2 3; opacity: .45; }
        .spark .dot { fill: var(--nc-c); }
        .foot { display: flex; align-items: center; gap: 8px; margin: 8px 2px 0; font-size: .78em; color: var(--secondary-text-color); min-width: 0; }
        .ip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 6px; border-radius: 10px; cursor: pointer; white-space: nowrap;
              background: rgba(127,127,127,.12); color: var(--primary-text-color); font-variant-numeric: tabular-nums; --mdc-icon-size: 14px; }
        .ip:hover { background: rgba(127,127,127,.22); }
        .ip ha-icon { color: var(--secondary-text-color); }
        .ip.copied { color: var(--success-color, #4caf50); }
        .srv { margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media (max-width: 420px) { .tiles { grid-template-columns: 1fr 1fr; } .tile.download { grid-column: 1 / -1; } }
      </style>
      <ha-card>
        <div class="head">
          <span class="title">${ncEsc(c.title ?? 'Internet')}</span>
          ${conn ? `<span class="status ${offline ? 'off' : ''}">${offline ? 'Offline' : 'Online'}</span>` : ''}
          <span class="when">${testing ? 'Testing…' : tested ? `Tested ${ncAgo(tested)}` : ''}</span>
          ${c.hide_test_button || !e.download ? '' : `<button class="run ${testing ? 'spin' : ''}" data-act="test" title="Run a speed test"><ha-icon icon="mdi:refresh"></ha-icon></button>`}
        </div>
        <div class="tiles">${NC_KEYS.map((k) => this._tile(k, offline)).join('')}</div>
        ${ip || server ? `<div class="foot">
          ${ip ? `<span class="ip ${this._copied ? 'copied' : ''}" data-act="copy" title="Copy IP address"><ha-icon icon="${this._copied ? 'mdi:check' : 'mdi:ip-network-outline'}"></ha-icon>${this._copied ? 'Copied' : ncEsc(ip)}</span>` : ''}
          ${server ? `<span class="srv" title="Speedtest server">${ncEsc(server)}</span>` : ''}
        </div>` : ''}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'more') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    } else if (act === 'copy') {
      const ip = this._hass.states[this._e.ip]?.state;
      navigator.clipboard?.writeText(ip).catch(() => {});
      this._copied = true;
      this._render();
      setTimeout(() => { this._copied = false; this._lastHtml = null; this._render(); }, 1500);
    } else if (act === 'test' && !this._testing) {
      // Speedtest has no "run" action any more; updating its entity runs a new test.
      this._testing = NC_KEYS.map((k) => this._hass.states[this._e[k]]?.last_updated).join('|');
      this._hass.callService('homeassistant', 'update_entity', { entity_id: NC_KEYS.map((k) => this._e[k]).filter(Boolean) });
      this._render();
      setTimeout(() => { if (this._testing) { this._testing = null; this._lastHtml = null; this._render(); } }, 90000);
    }
  }

  getCardSize() { return 3; }

  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('internet-card-editor');
  }

  static getStubConfig() { return {}; }
}

customElements.define('internet-card', InternetCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'internet-card',
  name: 'Internet Card',
  description: 'Download, upload and ping with sparklines, online status, external IP and a run-test button. Finds Speedtest.net automatically.',
  preview: false,
});

class InternetCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Card', icon: 'mdi:web', schema: [
        f.grid(f.text('title', 'Title', 'Default: Internet'), f.entity('connectivity', 'Online sensor', 'e.g. a ping to your modem', 'binary_sensor')),
        f.grid(
          f.number('plan_download', "Plan's download", { min: 1, unit: 'Mbit/s', helper: 'Under half turns amber' }),
          f.number('plan_upload', "Plan's upload", { min: 1, unit: 'Mbit/s' }),
        ),
        f.grid(f.number('high_ping', 'High ping', { min: 10, unit: 'ms', helper: 'Default: 100' }), f.number('hours', 'History', { min: 1, max: 168, unit: 'h', helper: 'Default: 24' })),
        f.toggle('hide_test_button', 'Hide the run-test button'),
      ] },
      { title: 'Entities', icon: 'mdi:format-list-checks', open: false, schema: [
        f.grid(f.entity('download', 'Download', 'Default: Speedtest', 'sensor'), f.entity('upload', 'Upload', '', 'sensor')),
        f.grid(f.entity('ping', 'Ping', '', 'sensor'), f.entity('ip', 'External IP', 'Default: sensor.external_ip', 'sensor')),
      ] },
    ];
  }
}

customElements.define('internet-card-editor', InternetCardEditor);
