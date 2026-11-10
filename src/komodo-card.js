/**
 * Komodo Card for Home Assistant (Komodo integration)
 *
 * Every server Komodo manages, found automatically: a status light, its
 * active alerts, CPU / memory / disk gauges, free space and load. Servers
 * with problems sort to the top.
 *
 * Configuration:
 *   type: custom:komodo-card
 *   title: Komodo
 *   warn: 80            # Gauge turns amber at this % (default 80)
 *   critical: 90        # …and red at this % (default 90)
 *   servers: [immich, media-docker]   # Optional: only these, in this order
 *   exclude: [Homepage]               # Optional: skip these
 */

const KO_METRICS = ['server_state', 'alerts', 'cpu_usage', 'memory_usage', 'disk_usage', 'memory_total',
  'memory_free', 'disk_total', 'disk_free', 'load_average_1m', 'stack_count', 'service_count'];
const KO_ALERT_NAMES = { ServerDisk: 'Disk', ServerMem: 'Memory', ServerCpu: 'CPU', ServerUnreachable: 'Unreachable',
  ServerVersionMismatch: 'Version', ContainerStateChange: 'Container', StackStateChange: 'Stack' };

const koEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const koGB = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1024).toFixed(1)} TB` : `${v >= 100 ? Math.round(v) : v.toFixed(1)} GB`);

class KomodoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._servers = [];
    this._watched = [];
    this._resolvedFor = null;
    this.shadowRoot.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-e]');
      if (el) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    });
  }

  setConfig(config) {
    this._config = config || {};
    this._resolvedFor = null;
    if (this._hass) this._resolve();
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  // Group Komodo's sensors by server (device), keyed by what each one measures.
  _resolve() {
    const hass = this._hass;
    this._resolvedFor = hass.entities;
    const byDev = {};
    for (const e of Object.values(hass.entities || {})) {
      if (e.platform !== 'komodo' || !e.device_id || !e.entity_id.startsWith('sensor.')) continue;
      const metric = KO_METRICS.find((m) => e.entity_id.endsWith('_' + m));
      if (!metric) continue;
      const d = (byDev[e.device_id] ||= { id: e.device_id, ids: {} });
      d.ids[metric] = e.entity_id;
    }
    this._servers = Object.values(byDev).map((d) => {
      const dev = hass.devices?.[d.id];
      return { ...d, name: dev?.name_by_user || dev?.name || d.id };
    });
    this._watched = this._servers.flatMap((s) => Object.values(s.ids));
  }

  _num(id) {
    const v = parseFloat(this._hass?.states[id]?.state);
    return isNaN(v) ? null : v;
  }

  _gauge(label, pct, sub, entity) {
    const warn = this._config.warn ?? 80, crit = this._config.critical ?? 90;
    const tone = pct == null ? 'na' : pct >= crit ? 'crit' : pct >= warn ? 'warn' : 'ok';
    const r = 17, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, pct ?? 0)) / 100);
    return `
      <div class="g ${tone}" data-e="${koEsc(entity || '')}" title="${label}: ${pct == null ? 'unknown' : pct.toFixed(1) + '%'}${sub ? ' · ' + sub : ''}">
        <svg viewBox="0 0 42 42"><circle class="trk" cx="21" cy="21" r="${r}"/>
          <circle class="val" cx="21" cy="21" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/></svg>
        <div class="gv">${pct == null ? '—' : Math.round(pct)}<small>%</small></div>
        <div class="gl">${label}</div>
        ${sub ? `<div class="gs">${koEsc(sub)}</div>` : ''}
      </div>`;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const hass = this._hass;
    const crit = cfg.critical ?? 90, warn = cfg.warn ?? 80;
    const only = (cfg.servers || []).map((s) => String(s).toLowerCase());
    const exclude = (cfg.exclude || []).map((s) => String(s).toLowerCase());

    let servers = this._servers
      .filter((s) => !exclude.includes(s.name.toLowerCase()))
      .filter((s) => !only.length || only.includes(s.name.toLowerCase()))
      .map((s) => {
        const st = hass?.states[s.ids.server_state]?.state;
        const alertsRaw = hass?.states[s.ids.alerts]?.state || '';
        const alerts = alertsRaw && !['unknown', 'unavailable'].includes(alertsRaw)
          ? [...new Set(alertsRaw.split(',').map((a) => a.trim()).filter(Boolean))] : [];
        const cpu = this._num(s.ids.cpu_usage), mem = this._num(s.ids.memory_usage), disk = this._num(s.ids.disk_usage);
        const worst = Math.max(cpu ?? 0, mem ?? 0, disk ?? 0);
        const status = st === 'OK' ? 'ok' : st === 'NOTOK' ? 'down' : st === 'DISABLED' ? 'disabled' : 'unknown';
        const rank = status === 'down' ? 0 : worst >= crit || alerts.length ? 1 : worst >= warn ? 2 : 3;
        return { ...s, status, alerts, cpu, mem, disk, rank };
      });
    if (only.length) servers.sort((a, b) => only.indexOf(a.name.toLowerCase()) - only.indexOf(b.name.toLowerCase()));
    else servers.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

    const down = servers.filter((s) => s.status === 'down').length;
    const alertCount = servers.reduce((n, s) => n + s.alerts.length, 0);
    const headTone = down ? 'crit' : alertCount ? 'warn' : 'ok';
    const summary = down ? `${down} server${down > 1 ? 's' : ''} down`
      : alertCount ? `${alertCount} alert${alertCount > 1 ? 's' : ''}` : 'All servers healthy';

    const cards = servers.map((s) => {
      const memFree = this._num(s.ids.memory_free), memTot = this._num(s.ids.memory_total);
      const diskFree = this._num(s.ids.disk_free), diskTot = this._num(s.ids.disk_total);
      const load = this._num(s.ids.load_average_1m);
      return `
        <div class="srv s-${s.status}">
          <div class="sh" data-e="${koEsc(s.ids.server_state || '')}">
            <span class="dot"></span>
            <span class="sn">${koEsc(s.name)}</span>
            ${s.status !== 'ok' ? `<span class="st">${s.status === 'down' ? 'Down' : s.status === 'disabled' ? 'Disabled' : 'Unknown'}</span>` : ''}
          </div>
          ${s.alerts.length ? `<div class="al">${s.alerts.map((a) => `<span><ha-icon icon="mdi:alert"></ha-icon>${koEsc(KO_ALERT_NAMES[a] || a)}</span>`).join('')}</div>` : ''}
          <div class="gs-row">
            ${this._gauge('CPU', s.cpu, load != null ? `load ${load.toFixed(2)}` : '', s.ids.cpu_usage)}
            ${this._gauge('Memory', s.mem, memFree != null ? `${koGB(memFree)} free` : '', s.ids.memory_usage)}
            ${this._gauge('Disk', s.disk, diskFree != null ? `${koGB(diskFree)} free` : '', s.ids.disk_usage)}
          </div>
          ${memTot != null || diskTot != null ? `<div class="foot">${[memTot != null ? `${koGB(memTot)} RAM` : '', diskTot != null ? `${koGB(diskTot)} disk` : ''].filter(Boolean).join(' · ')}</div>` : ''}
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .hi { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 24px; flex-shrink: 0; }
        .ok .hi   { background: rgba(76,175,80,.15); color: var(--success-color,#4caf50); }
        .warn .hi { background: rgba(255,152,0,.15); color: var(--warning-color,#ff9800); }
        .crit .hi { background: rgba(244,67,54,.15); color: var(--error-color,#f44336); }
        .ht { font-size: .78em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .hl { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
        .srv { border-radius: 14px; padding: 12px; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .sh { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: var(--success-color,#4caf50);
               box-shadow: 0 0 0 3px rgba(76,175,80,.2); }
        .s-down .dot { background: var(--error-color,#f44336); box-shadow: 0 0 0 3px rgba(244,67,54,.25); animation: blink 1.2s infinite; }
        .s-disabled .dot, .s-unknown .dot { background: var(--disabled-text-color,#9e9e9e); box-shadow: none; }
        @keyframes blink { 50% { opacity: .3; } }
        .sn { flex: 1; min-width: 0; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .st { font-size: .72em; font-weight: 700; text-transform: uppercase; color: var(--error-color,#f44336); }
        .s-disabled .st { color: var(--secondary-text-color); }
        .al { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
        .al span { display: inline-flex; align-items: center; gap: 3px; font-size: .72em; font-weight: 600; padding: 2px 8px 2px 5px;
                   border-radius: 10px; background: rgba(255,152,0,.15); color: var(--warning-color,#ff9800); --mdc-icon-size: 12px; }
        .gs-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 10px; }
        .g { position: relative; text-align: center; cursor: pointer; min-width: 0; }
        .g svg { width: 100%; max-width: 64px; display: block; margin: 0 auto; transform: rotate(-90deg); }
        .trk { fill: none; stroke: rgba(127,127,127,.22); stroke-width: 4; }
        .val { fill: none; stroke-width: 4; stroke-linecap: round; transition: stroke-dashoffset .8s ease; }
        .ok .val { stroke: var(--success-color,#4caf50); } .warn .val { stroke: var(--warning-color,#ff9800); }
        .crit .val { stroke: var(--error-color,#f44336); } .na .val { stroke: transparent; }
        .gv { position: absolute; left: 0; right: 0; top: 0; aspect-ratio: 1; max-width: 64px; margin: 0 auto;
              display: flex; align-items: center; justify-content: center; font-size: .9em; font-weight: 700; color: var(--primary-text-color); }
        .gv small { font-size: .65em; font-weight: 500; color: var(--secondary-text-color); }
        .g.crit .gv { color: var(--error-color,#f44336); }
        .gl { font-size: .7em; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary-text-color); margin-top: 2px; }
        .gs { font-size: .68em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .g.crit .gs { color: var(--error-color,#f44336); }
        .foot { margin-top: 8px; font-size: .72em; color: var(--secondary-text-color); text-align: center; }
        .empty { font-size: .88em; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="head ${headTone}">
          <div class="hi"><ha-icon icon="${headTone === 'ok' ? 'mdi:server' : 'mdi:server-network-off'}"></ha-icon></div>
          <div><div class="ht">${koEsc(cfg.title || 'Komodo')} · ${servers.length} server${servers.length === 1 ? '' : 's'}</div><div class="hl">${summary}</div></div>
        </div>
        ${servers.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No Komodo servers found — is the Komodo integration set up?</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() { return 5; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('komodo-card-editor');
  }

  static getStubConfig() { return { title: 'Komodo' }; }
}

customElements.define('komodo-card', KomodoCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'komodo-card',
  name: 'Komodo Card',
  description: 'Every Komodo server with status, alerts and CPU / memory / disk gauges.',
  preview: false,
});

class KomodoCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:server', schema: [
        f.text('title', 'Title'),
        f.grid(
          f.number('warn', 'Amber at', { min: 1, max: 100, unit: '%', helper: 'Default: 80' }),
          f.number('critical', 'Red at', { min: 1, max: 100, unit: '%', helper: 'Default: 90' }),
        ),
        f.states('servers', 'Only show these servers', [], 'Leave empty for all. Order here sets the card order'),
        f.states('exclude', 'Hide these servers', []),
      ] },
    ];
  }
}

customElements.define('komodo-card-editor', KomodoCardEditor);
