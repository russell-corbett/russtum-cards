/**
 * Bin Day Card for Home Assistant
 *
 * The next pickup from Waste Collection Schedule: which bins, how soon, and a
 * "Put the bins out tonight" highlight the evening before. Upcoming pickups
 * follow as a short list. Waste Collection Schedule sensors are found
 * automatically.
 *
 * Works with either:
 *   • WCS sensors whose attributes list upcoming dates (the default
 *     `details_format: upcoming`), or
 *   • a WCS calendar entity (`calendar:`), read through HA's calendar API.
 *
 * Configuration:
 *   type: custom:bin-day-card
 *   title: Bins                       # Optional
 *   entities:                         # Optional: default = every WCS sensor
 *     - sensor.waste_collection_schedule_automated_garbage_collection
 *   calendar: calendar.waste_collection_schedule_curbit_st_john_s   # Optional instead of sensors
 *   highlight_from: 16                # Hour the day before when "put out tonight" starts (default 16)
 *   upcoming: 3                       # Later pickups listed under the next one (default 3, 0 hides)
 *   types:                            # Optional: rename / recolour bin types (matched by text)
 *     - match: garbage
 *       name: Garbage
 *       icon: mdi:trash-can
 *       color: '#78909c'
 */

// Built-in bin styles, matched against the pickup's name.
const BD_TYPES = [
  { match: /recycl|blue/i, name: 'Recycling', icon: 'mdi:recycle', color: '#2196f3' },
  { match: /yard|garden|green|leaf|compost|organic|food|bio/i, name: 'Yard waste', icon: 'mdi:leaf', color: '#4caf50' },
  { match: /glass/i, name: 'Glass', icon: 'mdi:bottle-wine', color: '#26a69a' },
  { match: /paper|cardboard/i, name: 'Paper', icon: 'mdi:package-variant', color: '#8d6e63' },
  { match: /bulk|large/i, name: 'Bulk', icon: 'mdi:sofa', color: '#ab47bc' },
  { match: /hazard|battery|electronic/i, name: 'Hazardous', icon: 'mdi:biohazard', color: '#ff7043' },
  { match: /garbage|trash|refuse|rubbish|waste|black|grey|gray/i, name: 'Garbage', icon: 'mdi:trash-can', color: '#78909c' },
];

const bdEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bdDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// 'YYYY-MM-DD' as a local date (new Date('2026-11-12') would be UTC midnight).
const bdParse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

class BinDayCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
    this._calEvents = [];
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = { highlight_from: 16, upcoming: 3, ...config,
      entities: (Array.isArray(config.entities) ? config.entities : config.entities ? [config.entities] : []).map((e) => (typeof e === 'string' ? e : e?.entity)).filter(Boolean) };
    this._resolvedFor = null;
    this._calFetched = 0;
    this._lastHtml = null;
    this._render();
  }

  connectedCallback() {
    // Re-render every 10 minutes so "tonight" / "today" roll over on their own.
    this._clock = setInterval(() => { this._lastHtml = null; this._render(); }, 600000);
  }

  disconnectedCallback() { clearInterval(this._clock); }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._ids.some((id) => hass.states[id] !== old.states[id])) return;
    if (this._config.calendar && Date.now() - this._calFetched > 3600000) this._fetchCalendar();
    this._render();
  }

  _resolve() {
    const h = this._hass, c = this._config;
    this._resolvedFor = h.entities;
    const reg = h.entities || {};
    this._ids = c.entities.length ? c.entities
      : c.calendar ? []
        : Object.keys(h.states).filter((id) => id.startsWith('sensor.') && reg[id]?.platform === 'waste_collection_schedule');
    if (c.calendar) this._ids = [...this._ids, c.calendar];
  }

  async _fetchCalendar() {
    this._calFetched = Date.now();
    const start = bdDay(new Date());
    const end = new Date(start.getTime() + 60 * 86400000);
    try {
      const evs = await this._hass.callApi('GET', `calendars/${this._config.calendar}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
      this._calEvents = (evs || []).map((e) => ({ date: bdParse(e.start?.date || e.start?.dateTime || ''), name: e.summary || 'Pickup' })).filter((e) => e.date);
    } catch (e) {
      this._calEvents = [];
    }
    this._lastHtml = null;
    this._render();
  }

  // Every upcoming pickup as { date, name }.
  _pickups() {
    const out = [];
    for (const id of this._ids || []) {
      if (id.startsWith('calendar.')) continue;
      const s = this._hass.states[id];
      if (!s) continue;
      const name = String(s.attributes.friendly_name || id).replace(/^waste collection schedule\s*/i, '');
      let found = false;
      for (const [k, v] of Object.entries(s.attributes)) {
        const d = bdParse(k);
        if (d) { out.push({ date: d, name: typeof v === 'string' ? v : name }); found = true; }
      }
      // Fallback: a sensor with only a state ("Thu, 12.11.2026", "2026-11-12", "in 2 days").
      if (!found) {
        const st = s.state;
        let d = bdParse(st);
        const eu = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(st);
        if (!d && eu) d = new Date(+eu[3], +eu[2] - 1, +eu[1]);
        const days = /^\d+$/.test(st) ? +st : null;
        if (!d && days != null) d = new Date(bdDay(new Date()).getTime() + days * 86400000);
        if (d) out.push({ date: d, name });
      }
    }
    out.push(...this._calEvents);
    const today = bdDay(new Date());
    return out.filter((p) => p.date >= today);
  }

  _style(name) {
    const custom = (this._config.types || []).find((t) => t?.match && String(name).toLowerCase().includes(String(t.match).toLowerCase()));
    const base = BD_TYPES.find((t) => t.match.test(name)) || { name, icon: 'mdi:delete-variant', color: '#78909c' };
    return { name: custom?.name || base.name, icon: custom?.icon || base.icon, color: custom?.color || base.color };
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = '<ha-card></ha-card>'; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;

    // Group pickups by day, de-duplicating bin types on the same day.
    const byDay = new Map();
    for (const p of this._pickups().sort((a, b) => a.date - b.date)) {
      const k = p.date.getTime();
      const st = this._style(p.name);
      if (!byDay.has(k)) byDay.set(k, { date: p.date, bins: [] });
      const day = byDay.get(k);
      if (!day.bins.some((b) => b.name === st.name)) day.bins.push(st);
    }
    const days = [...byDay.values()];
    const next = days[0];

    const now = new Date();
    const today = bdDay(now);
    const diff = next ? Math.round((next.date - today) / 86400000) : null;
    const tonight = diff === 1 && now.getHours() >= Number(c.highlight_from ?? 16);
    const isToday = diff === 0;
    const urgent = tonight || isToday;
    const when = (d, n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' })
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    const sub = !next ? '' : tonight ? 'Put the bins out tonight' : isToday ? 'Pickup is today'
      : diff === 1 ? 'Out tomorrow evening' : `In ${diff} days · ${next.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    const later = days.slice(1, 1 + Math.max(0, Number(c.upcoming ?? 3)));

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 14px; overflow: hidden; }
        ha-card.urgent { --acc: var(--warning-color, #ff9800);
          box-shadow: 0 0 0 1.5px var(--acc) inset, var(--ha-card-box-shadow, none);
          background: linear-gradient(color-mix(in srgb, var(--acc) 12%, transparent), color-mix(in srgb, var(--acc) 12%, transparent)),
                      var(--ha-card-background, var(--card-background-color, #1c1c1c)); }
        .main { display: flex; align-items: center; gap: 12px; cursor: pointer; }
        .bins { display: flex; flex-shrink: 0; }
        .bin { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 24px;
               border: 2px solid var(--card-background-color, #1c1c1c); }
        .bin + .bin { margin-left: -12px; }
        .urgent .bin { animation: bob 2.4s ease-in-out infinite; }
        .urgent .bin + .bin { animation-delay: .25s; }
        @keyframes bob { 50% { transform: translateY(-3px); } }
        .txt { flex: 1; min-width: 0; }
        .t { font-size: .74em; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color); }
        .w { font-size: 1.25em; font-weight: 700; color: var(--primary-text-color); line-height: 1.25; }
        .names { font-size: .85em; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: .8em; color: var(--secondary-text-color); margin-top: 1px; }
        .urgent .s { color: var(--acc); font-weight: 700; }
        .later { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
        .row { display: flex; align-items: center; gap: 8px; font-size: .82em; color: var(--secondary-text-color); }
        .row .d { width: 92px; flex-shrink: 0; color: var(--primary-text-color); font-weight: 500; white-space: nowrap; }
        .chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px 2px 5px; border-radius: 10px; font-size: .92em; --mdc-icon-size: 14px; white-space: nowrap; }
        .chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .empty { color: var(--secondary-text-color); font-size: .9em; padding: 4px 0; }
      </style>
      <ha-card class="${urgent ? 'urgent' : ''}">
        ${!next ? `<div class="empty">${c.title ? `<b>${bdEsc(c.title)}</b> · ` : ''}No pickups scheduled.</div>` : `
          <div class="main" data-act="more">
            <div class="bins">${next.bins.map((b) => `<div class="bin" style="background:${b.color}33;color:${b.color}" title="${bdEsc(b.name)}"><ha-icon icon="${bdEsc(b.icon)}"></ha-icon></div>`).join('')}</div>
            <div class="txt">
              <div class="t">${bdEsc(c.title || 'Next pickup')}</div>
              <div class="w">${when(next.date, diff)}</div>
              <div class="names">${next.bins.map((b) => bdEsc(b.name)).join(' · ')}</div>
              <div class="s">${sub}</div>
            </div>
          </div>
          ${later.length ? `<div class="later">${later.map((d) => `
            <div class="row"><span class="d">${when(d.date, Math.round((d.date - today) / 86400000))}</span>
              <span class="chips">${d.bins.map((b) => `<span class="chip" style="background:${b.color}22;color:${b.color}"><ha-icon icon="${bdEsc(b.icon)}"></ha-icon>${bdEsc(b.name)}</span>`).join('')}</span></div>`).join('')}
          </div>` : ''}`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    if (!ev.target.closest('[data-act="more"]')) return;
    const id = this._config.calendar || this._ids?.[0];
    if (id) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  getCardSize() { return 2 + Math.ceil((this._config?.upcoming ?? 3) / 2); }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('bin-day-card-editor');
  }

  static getStubConfig() { return {}; }
}

customElements.define('bin-day-card', BinDayCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'bin-day-card',
  name: 'Bin Day Card',
  description: 'Next bin pickup from Waste Collection Schedule, highlighted the night before.',
  preview: false,
});

class BinDayCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:trash-can', schema: [
        f.text('title', 'Title', 'Default: "Next pickup"'),
        f.entities('entities', 'Collection sensors', 'Default: every Waste Collection Schedule sensor', 'sensor'),
        f.entity('calendar', 'Or a calendar', 'Read pickups from a calendar instead', 'calendar'),
        f.grid(
          f.number('highlight_from', '"Put out tonight" from', { min: 0, max: 23, unit: 'h', helper: 'Hour the day before. Default: 16' }),
          f.number('upcoming', 'Later pickups shown', { min: 0, max: 10, helper: 'Default: 3' }),
        ),
      ] },
      { title: 'Bin types', icon: 'mdi:palette', open: false, list: {
        key: 'types',
        schema: [f.text('match', 'Matches', 'Text in the pickup name, e.g. "recycl"'), f.grid(f.text('name', 'Show as'), f.icon('icon')), f.text('color', 'Colour', 'e.g. #2196f3')],
        label: (t, i) => t.name || t.match || `Type ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add bin type',
      } },
    ];
  }
}

customElements.define('bin-day-card-editor', BinDayCardEditor);
