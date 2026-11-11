/**
 * Travel Time Card for Home Assistant
 *
 * Drive times from Waze Travel Time (or any duration sensor) as one compact
 * list: minutes now, the route, the distance, and how today compares with the
 * usual time for this hour, worked out from the last week of recorder
 * history. Give a destination an `arrive_by` time and the card says when to
 * leave. Tap a destination to start navigation in Waze or Google Maps.
 * Waze Travel Time sensors are found automatically.
 *
 * Configuration:
 *   type: custom:travel-time-card
 *   title: Travel times                # Optional
 *   entities:                          # Optional: default = every Waze Travel Time sensor
 *     - entity: sensor.home_to_mun
 *       name: MUN
 *       icon: mdi:school
 *       arrive_by: '08:30'             # Optional: shows "Leave by 8:12"
 *   history_days: 7                    # Days of history used for "usual" (default 7, 0 turns it off)
 *   slow_pct: 15                       # % over usual that counts as slow (amber, default 15)
 *   heavy_pct: 35                      # % over usual that counts as heavy (red, default 35)
 *   navigation: waze                   # waze | google | apple | none (tap action, default waze)
 */

const TT_ICONS = [
  [/school|elementary|college|university|mun\b|campus/i, 'mdi:school'],
  [/work|office/i, 'mdi:briefcase'],
  [/gym|sport|rink|arena|field/i, 'mdi:hockey-sticks'],
  [/airport/i, 'mdi:airplane'],
  [/hospital|clinic|doctor/i, 'mdi:hospital-building'],
  [/store|shop|mall|market|grocery/i, 'mdi:cart'],
  [/home/i, 'mdi:home'],
];
const ttEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ttMedian = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

class TravelTimeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
    this._history = {};
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const list = Array.isArray(config.entities) ? config.entities : config.entities ? [config.entities] : [];
    this._config = { history_days: 7, slow_pct: 15, heavy_pct: 35, navigation: 'waze', ...config,
      entities: list.map((e) => (typeof e === 'string' ? { entity: e } : e)).filter((e) => e?.entity) };
    this._resolvedFor = null;
    this._histFetched = 0;
    this._lastHtml = null;
    this._render();
  }

  connectedCallback() {
    // "Leave by" moves with the clock even when the travel time doesn't change.
    this._clock = setInterval(() => { this._lastHtml = null; this._render(); }, 60000);
  }

  disconnectedCallback() { clearInterval(this._clock); }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    if (Number(this._config.history_days) > 0 && Date.now() - this._histFetched > 1800000) this._fetchHistory();
    if (old && !this._items.some((i) => hass.states[i.entity] !== old.states[i.entity])) return;
    this._render();
  }

  _resolve() {
    const h = this._hass, reg = h.entities || {};
    this._resolvedFor = h.entities;
    this._items = this._config.entities.length ? this._config.entities
      : Object.keys(h.states).filter((id) => id.startsWith('sensor.') && reg[id]?.platform === 'waze_travel_time').sort().map((entity) => ({ entity }));
  }

  // Last week of each sensor, for the "usual" time at this hour.
  async _fetchHistory() {
    this._histFetched = Date.now();
    const ids = this._items.map((i) => i.entity);
    if (!ids.length || !this._hass.callWS) return;
    const start = new Date(Date.now() - Number(this._config.history_days) * 86400000);
    try {
      const res = await this._hass.callWS({ type: 'history/history_during_period', start_time: start.toISOString(), entity_ids: ids,
        minimal_response: true, no_attributes: true, significant_changes_only: false });
      this._history = {};
      for (const id of ids) {
        this._history[id] = (res?.[id] || []).map((p) => ({ t: (p.lu ?? p.lc ?? 0) * 1000, v: parseFloat(p.s) })).filter((p) => !isNaN(p.v) && p.v > 0);
      }
      this._lastHtml = null;
      this._render();
    } catch (e) { /* history is a nice-to-have */ }
  }

  // Median of earlier days within ±45 min of the current time of day.
  _usual(id) {
    const pts = this._history[id];
    if (!pts?.length) return null;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const near = pts.filter((p) => {
      if (p.t >= startToday.getTime()) return false;
      const d = new Date(p.t);
      const m = d.getHours() * 60 + d.getMinutes();
      return Math.abs(m - mins) <= 45 || Math.abs(m - mins) >= 1395;
    }).map((p) => p.v);
    return near.length >= 3 ? ttMedian(near) : null;
  }

  _name(item, s) {
    if (item.name) return item.name;
    return String(s?.attributes?.friendly_name || item.entity)
      .replace(/^waze\s*/i, '').replace(/^.*?\bto\s+/i, '').replace(/\s*travel time.*$/i, '').trim();
  }

  _row(item) {
    const s = this._hass.states[item.entity];
    const name = this._name(item, s);
    const icon = item.icon || TT_ICONS.find(([re]) => re.test(name))?.[1] || 'mdi:map-marker';
    if (!s || isNaN(parseFloat(s.state))) {
      return `<div class="row na" data-act="more" data-e="${ttEsc(item.entity)}"><div class="ic"><ha-icon icon="${ttEsc(icon)}"></ha-icon></div>
        <div class="mid"><div class="n">${ttEsc(name)}</div><div class="sub">${s ? 'No route right now' : 'Sensor not found'}</div></div><div class="t">—</div></div>`;
    }
    const a = s.attributes;
    let mins = parseFloat(s.state);
    if (a.unit_of_measurement === 'h') mins *= 60;
    if (a.unit_of_measurement === 's') mins /= 60;
    const usual = this._usual(item.entity);
    const pct = usual ? ((mins - usual) / usual) * 100 : null;
    const c = this._config;
    const level = pct == null ? '' : pct >= Number(c.heavy_pct) ? 'heavy' : pct >= Number(c.slow_pct) ? 'slow' : 'clear';
    const diff = usual != null ? Math.round(mins - usual) : null;
    const traffic = level === 'heavy' ? `Heavy traffic · +${diff} min` : level === 'slow' ? `Slower than usual · +${diff} min`
      : level === 'clear' ? (diff <= -2 ? `Faster than usual · ${diff} min` : 'Usual traffic') : '';

    const dist = a.distance != null ? `${Number(a.distance) >= 10 ? Math.round(a.distance) : Number(a.distance).toFixed(1)} ${this._hass.config?.unit_system?.length || 'km'}` : '';
    const route = a.route ? `via ${String(a.route).split(';')[0].trim()}` : '';

    // Leave-by: arrival time minus the current drive, shown only until it has passed.
    let leave = '';
    const m = /^(\d{1,2}):(\d{2})/.exec(item.arrive_by || '');
    if (m) {
      const arrive = new Date(); arrive.setHours(+m[1], +m[2], 0, 0);
      const by = new Date(arrive.getTime() - Math.ceil(mins) * 60000);
      const left = Math.round((by - Date.now()) / 60000);
      if (left >= -5) {
        const t = by.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        leave = left <= 0 ? `<span class="leave now">Leave now</span>` : `<span class="leave ${left <= 10 ? 'soon' : ''}">Leave by ${t}${left <= 60 ? ` · ${left} min` : ''}</span>`;
      }
    }

    return `
      <div class="row ${level}" data-act="go" data-e="${ttEsc(item.entity)}" title="${ttEsc(`${name}: ${Math.round(mins)} min${usual ? ` (usually ${Math.round(usual)})` : ''}`)}">
        <div class="ic"><ha-icon icon="${ttEsc(icon)}"></ha-icon></div>
        <div class="mid">
          <div class="n">${ttEsc(name)}${leave}</div>
          <div class="sub">${[route, dist].filter(Boolean).map(ttEsc).join(' · ')}</div>
          ${traffic ? `<div class="tr">${traffic}</div>` : ''}
        </div>
        <div class="t">${Math.round(mins)}<small>min</small></div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = '<ha-card></ha-card>'; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; }
        .title { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); margin: 0 2px 8px; display: flex; align-items: center; gap: 6px; --mdc-icon-size: 18px; }
        .title ha-icon { color: var(--secondary-text-color); }
        .rows { display: flex; flex-direction: column; gap: 6px; }
        .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; cursor: pointer;
               background: var(--secondary-background-color, rgba(127,127,127,.08)); border-left: 3px solid transparent; }
        .row:hover { filter: brightness(1.08); }
        .ic { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 20px;
              background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .mid { flex: 1; min-width: 0; }
        .n { font-size: .92em; font-weight: 600; color: var(--primary-text-color); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sub { font-size: .76em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tr { font-size: .74em; font-weight: 600; color: var(--success-color, #4caf50); margin-top: 1px; }
        .t { font-size: 1.5em; font-weight: 700; color: var(--primary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .t small { font-size: .5em; font-weight: 500; color: var(--secondary-text-color); margin-left: 2px; }
        .leave { font-size: .78em; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: rgba(3,169,244,.15); color: var(--primary-color, #03a9f4); }
        .leave.soon { background: rgba(255,152,0,.18); color: var(--warning-color, #ff9800); }
        .leave.now { background: var(--error-color, #f44336); color: #fff; }
        .clear { border-left-color: var(--success-color, #4caf50); }
        .clear .ic { background: rgba(76,175,80,.16); color: var(--success-color, #4caf50); }
        .slow { border-left-color: var(--warning-color, #ff9800); }
        .slow .ic { background: rgba(255,152,0,.18); color: var(--warning-color, #ff9800); }
        .slow .tr, .slow .t { color: var(--warning-color, #ff9800); }
        .heavy { border-left-color: var(--error-color, #f44336); }
        .heavy .ic { background: rgba(244,67,54,.16); color: var(--error-color, #f44336); }
        .heavy .tr, .heavy .t { color: var(--error-color, #f44336); }
        .na { opacity: .55; }
        .empty { color: var(--secondary-text-color); font-size: .9em; padding: 4px 2px; }
      </style>
      <ha-card>
        ${c.title ? `<div class="title"><ha-icon icon="mdi:car-clock"></ha-icon>${ttEsc(c.title)}</div>` : ''}
        <div class="rows">
          ${this._items.length ? this._items.map((i) => this._row(i)).join('') : '<div class="empty">No Waze Travel Time sensors found.</div>'}
        </div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const id = el.dataset.e;
    const dest = String(this._hass.states[id]?.attributes?.destination || '');
    const ll = /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/.exec(dest);
    const nav = this._config.navigation;
    if (el.dataset.act === 'go' && nav !== 'none' && (ll || dest)) {
      const q = ll ? `${ll[1]},${ll[2]}` : dest;
      const url = nav === 'google' ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
        : nav === 'apple' ? `https://maps.apple.com/?daddr=${encodeURIComponent(q)}`
          : ll ? `https://waze.com/ul?ll=${encodeURIComponent(q)}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (id) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  getCardSize() { return 1 + (this._items?.length || 3) * 1.2; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('travel-time-card-editor');
  }

  static getStubConfig() { return { title: 'Travel times' }; }
}

customElements.define('travel-time-card', TravelTimeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'travel-time-card',
  name: 'Travel Time Card',
  description: 'Waze drive times with traffic vs usual, leave-by times and one-tap navigation.',
  preview: false,
});

class TravelTimeCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:car-clock', schema: [
        f.text('title', 'Title'),
        f.select('navigation', 'Tap opens', [
          { value: 'waze', label: 'Waze' }, { value: 'google', label: 'Google Maps' },
          { value: 'apple', label: 'Apple Maps' }, { value: 'none', label: 'Details only' }], 'Default: Waze'),
        f.grid(
          f.number('slow_pct', 'Slow above usual by', { min: 1, unit: '%', helper: 'Default: 15' }),
          f.number('heavy_pct', 'Heavy above usual by', { min: 1, unit: '%', helper: 'Default: 35' }),
        ),
        f.number('history_days', 'Days of history for "usual"', { min: 0, max: 30, helper: 'Default: 7 · 0 turns it off' }),
      ] },
      { title: 'Destinations', icon: 'mdi:map-marker-multiple', open: false, list: {
        key: 'entities',
        schema: [f.entity('entity', 'Travel time sensor', 'Leave the list empty to use every Waze sensor', 'sensor'),
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.text('arrive_by', 'Arrive by', 'e.g. 08:30 — shows when to leave')],
        label: (e, i) => e.name || e.entity || `Destination ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add destination',
      } },
    ];
  }
}

customElements.define('travel-time-card-editor', TravelTimeCardEditor);
