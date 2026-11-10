/**
 * Battery Card for Home Assistant (Battery Notes integration)
 *
 * Finds every device Battery Notes tracks — no list to maintain — and shows
 * its level, battery type, and how long since the battery was replaced,
 * lowest first. A shopping list says which batteries to buy for the low
 * ones, and "Replaced" marks a swap (tap twice to confirm).
 *
 * Configuration:
 *   type: custom:battery-card
 *   title: Batteries
 *   sort: level               # level | replaced | name
 *   low_threshold: 20         # Override Battery Notes' own low threshold (%)
 *   only_low: false           # List only devices that need attention
 *   hide_replace: false       # Hide the "Replaced" buttons
 *   exclude:                  # Device names to skip (partial match)
 *     - Kitchen Pico
 */

const btEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function btAge(d) {
  if (!d || isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days < 1) return 'today';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  const y = Math.floor(months / 12), m = months % 12;
  return m ? `${y}y ${m}mo ago` : `${y}y ago`;
}

function btIcon(pct) {
  if (pct == null) return 'mdi:battery-unknown';
  if (pct <= 5) return 'mdi:battery-alert-variant-outline';
  const r = Math.max(10, Math.round(pct / 10) * 10);
  return r >= 100 ? 'mdi:battery' : `mdi:battery-${r}`;
}

class BatteryCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._devices = [];
    this._watched = [];
    this._resolvedFor = null;
    this._confirm = null;
    this._done = new Set();
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
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

  // Group Battery Notes' entities by device.
  _resolve() {
    const hass = this._hass;
    this._resolvedFor = hass.entities;
    const byDev = {};
    for (const e of Object.values(hass.entities || {})) {
      if (e.platform !== 'battery_notes' || !e.device_id) continue;
      const d = (byDev[e.device_id] ||= { id: e.device_id });
      const id = e.entity_id;
      if (/^sensor\..*_battery_plus(_\d+)?$/.test(id)) d.level = id;
      else if (/^sensor\..*_battery_type(_\d+)?$/.test(id)) d.type = id;
      else if (/^sensor\..*_battery_last_replaced(_\d+)?$/.test(id)) d.replaced = id;
      else if (/^button\..*_battery_replaced(_\d+)?$/.test(id)) d.button = id;
      else if (/^binary_sensor\..*_battery_plus_low(_\d+)?$/.test(id)) d.low = id;
    }
    this._devices = Object.values(byDev).filter((d) => d.level || d.type || d.replaced);
    this._watched = this._devices.flatMap((d) => [d.level, d.type, d.replaced, d.low]).filter(Boolean);
  }

  _rows() {
    const hass = this._hass;
    const cfg = this._config;
    const exclude = (cfg.exclude || []).map((x) => String(x).toLowerCase());
    return this._devices.map((d) => {
      const lvl = d.level && hass.states[d.level];
      const typ = d.type && hass.states[d.type];
      const dev = hass.devices?.[d.id];
      const name = dev?.name_by_user || dev?.name || lvl?.attributes?.device_name || (d.type || d.level || '').split('.')[1]?.replace(/_battery.*$/, '').replace(/_/g, ' ');
      const v = parseFloat(lvl?.state);
      const pct = isNaN(v) ? null : v;
      const threshold = cfg.low_threshold ?? lvl?.attributes?.battery_low_threshold ?? 20;
      const lowFlag = d.low ? hass.states[d.low]?.state === 'on' : false;
      const low = cfg.low_threshold != null ? pct != null && pct <= threshold : lowFlag || (pct != null && pct <= threshold);
      const type = typ?.state && !['unknown', 'unavailable'].includes(typ.state) ? typ.state : lvl?.attributes?.battery_type;
      const qty = Number(lvl?.attributes?.battery_quantity ?? typ?.attributes?.battery_quantity ?? 1) || 1;
      const repState = d.replaced && hass.states[d.replaced]?.state;
      const replaced = repState && !['unknown', 'unavailable'].includes(repState) ? new Date(repState) : null;
      return { ...d, name: name || 'Unknown device', pct, low, type, qty, replaced, threshold };
    }).filter((r) => !exclude.some((x) => (r.name || '').toLowerCase().includes(x)));
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    let rows = this._hass ? this._rows() : [];
    const lowRows = rows.filter((r) => r.low);
    const sort = cfg.sort || 'level';
    rows.sort((a, b) => (b.low - a.low)
      || (sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'replaced' ? (a.replaced || 0) - (b.replaced || 0)
        : (a.pct ?? 101) - (b.pct ?? 101)));
    if (cfg.only_low) rows = lowRows;

    // What to buy: battery types needed for the low devices.
    const need = {};
    for (const r of lowRows) if (r.type) need[r.type] = (need[r.type] || 0) + r.qty;
    const shopping = Object.entries(need).map(([t, n]) => `${n}× ${t}`).join(', ');

    const color = (r) => r.pct == null ? 'var(--disabled-text-color,#9e9e9e)' : r.low ? 'var(--error-color,#f44336)'
      : r.pct <= r.threshold * 2 ? 'var(--warning-color,#ff9800)' : 'var(--success-color,#4caf50)';

    const list = rows.map((r) => {
      const confirming = this._confirm === r.button;
      const done = this._done.has(r.button);
      return `
        <div class="row ${r.low ? 'low' : ''}">
          <ha-icon class="bi" icon="${btIcon(r.pct)}" style="color:${color(r)}" data-act="more" data-e="${btEsc(r.level || r.replaced)}"></ha-icon>
          <div class="body" data-act="more" data-e="${btEsc(r.level || r.replaced)}">
            <div class="name">${btEsc(r.name)}</div>
            <div class="sub">
              ${r.type ? `<span class="type">${r.qty > 1 ? `${r.qty}× ` : ''}${btEsc(r.type)}</span>` : ''}
              ${r.replaced ? `<span>Replaced ${btAge(r.replaced)}</span>` : '<span>Never marked replaced</span>'}
            </div>
          </div>
          <div class="lvl">
            <div class="bar">${r.pct != null ? `<div class="fill" style="width:${Math.max(2, r.pct)}%;background:${color(r)}"></div>` : ''}</div>
            <span class="pct" style="${r.low ? `color:${color(r)}` : ''}">${r.pct == null ? '—' : Math.round(r.pct) + '%'}</span>
          </div>
          ${!cfg.hide_replace && r.button ? `
            <button class="rep ${confirming ? 'confirm' : ''} ${done ? 'done' : ''}" data-act="replace" data-b="${btEsc(r.button)}"
              title="${confirming ? 'Tap again to confirm' : 'Mark battery replaced'}">
              <ha-icon icon="${done ? 'mdi:check' : 'mdi:battery-sync-outline'}"></ha-icon>${confirming ? '<span>Confirm</span>' : ''}
            </button>` : ''}
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 4px; }
        .title { flex: 1; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .chip { font-size: .75em; font-weight: 600; padding: 2px 9px; border-radius: 10px; white-space: nowrap; }
        .chip.n   { background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .chip.low { background: rgba(244,67,54,.15); color: var(--error-color,#f44336); }
        .chip.ok  { background: rgba(76,175,80,.15); color: var(--success-color,#4caf50); }
        .shop { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; padding: 8px 10px; border-radius: 10px; font-size: .85em;
                background: rgba(255,152,0,.12); color: var(--primary-text-color); --mdc-icon-size: 18px; }
        .shop ha-icon { color: var(--warning-color,#ff9800); }
        .list { display: flex; flex-direction: column; margin-top: 6px; }
        .row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.15)); }
        .row:last-child { border-bottom: none; }
        .bi { --mdc-icon-size: 24px; flex-shrink: 0; cursor: pointer; }
        .body { flex: 1; min-width: 0; cursor: pointer; }
        .name { font-size: .9em; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .low .name { font-weight: 600; }
        .sub { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: .74em; color: var(--secondary-text-color); margin-top: 1px; }
        .type { font-weight: 600; font-family: monospace; font-size: 1.05em; }
        .lvl { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .bar { width: 64px; height: 6px; border-radius: 3px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .fill { height: 100%; border-radius: 3px; }
        .pct { width: 36px; text-align: right; font-size: .85em; font-weight: 600; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        .rep { display: flex; align-items: center; gap: 4px; border: none; cursor: pointer; padding: 6px; border-radius: 16px; line-height: 0;
               background: none; color: var(--secondary-text-color); font: inherit; font-size: .75em; font-weight: 600; --mdc-icon-size: 18px; flex-shrink: 0; }
        .rep:hover { background: rgba(127,127,127,.18); color: var(--primary-text-color); }
        .rep.confirm { background: var(--primary-color,#03a9f4); color: var(--text-primary-color,#fff); padding: 6px 10px 6px 8px; line-height: 1; }
        .rep.done { color: var(--success-color,#4caf50); }
        .empty { margin-top: 10px; font-size: .88em; color: var(--secondary-text-color); }
        @media (max-width: 420px) { .bar { width: 40px; } }
      </style>
      <ha-card>
        <div class="head">
          <div class="title">${btEsc(cfg.title || 'Batteries')}</div>
          ${lowRows.length ? `<span class="chip low">${lowRows.length} low</span>` : this._devices.length ? '<span class="chip ok">All good</span>' : ''}
          <span class="chip n">${this._devices.length} devices</span>
        </div>
        ${shopping ? `<div class="shop"><ha-icon icon="mdi:cart-outline"></ha-icon><span>Buy: <b>${btEsc(shopping)}</b></span></div>` : ''}
        ${rows.length ? `<div class="list">${list}</div>`
          : `<div class="empty">${this._devices.length ? 'No batteries need attention.' : 'No Battery Notes devices found — install the Battery Notes integration and add your devices.'}</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    if (el.dataset.act === 'more' && el.dataset.e) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
      return;
    }
    if (el.dataset.act !== 'replace') return;
    const b = el.dataset.b;
    // First tap asks for confirmation; a second tap within 4 s presses Battery Notes' "replaced" button.
    if (this._confirm !== b) {
      this._confirm = b;
      clearTimeout(this._confirmTimer);
      this._confirmTimer = setTimeout(() => { this._confirm = null; this._render(); }, 4000);
      this._render();
      return;
    }
    clearTimeout(this._confirmTimer);
    this._confirm = null;
    this._hass.callService('button', 'press', { entity_id: b });
    this._done.add(b);
    setTimeout(() => { this._done.delete(b); this._render(); }, 3000);
    this._render();
  }

  getCardSize() { return 5; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('battery-card-editor');
  }

  static getStubConfig() { return { title: 'Batteries' }; }
}

customElements.define('battery-card', BatteryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'battery-card',
  name: 'Battery Card',
  description: 'Every Battery Notes device with level, battery type, age and a shopping list for low ones.',
  preview: false,
});

class BatteryCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:battery-heart-variant', schema: [
        f.text('title', 'Title'),
        f.grid(
          f.select('sort', 'Sort by', [{ value: 'level', label: 'Battery level' }, { value: 'replaced', label: 'Oldest replacement' }, { value: 'name', label: 'Name' }], 'Low batteries always come first'),
          f.number('low_threshold', 'Low at', { min: 1, max: 100, unit: '%', helper: "Default: each device's Battery Notes threshold" }),
        ),
        f.grid(f.toggle('only_low', 'Only show low batteries'), f.toggle('hide_replace', 'Hide "Replaced" buttons')),
        f.states('exclude', 'Hide devices', [], 'Type part of a device name and press Enter'),
      ] },
    ];
  }
}

customElements.define('battery-card-editor', BatteryCardEditor);
