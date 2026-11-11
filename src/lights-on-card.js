/**
 * Lights On Card for Home Assistant
 *
 * Just the lights that are on right now, as a grid of tiles: tap to turn one
 * off, drag sideways to dim, hold for details. The header counts them and has
 * an "All off" button. The card hides itself when everything is off.
 *
 * By default it shows your Light Groups (one per room, e.g. "Family Room
 * Lights" → "Family Room"), found automatically. Switch to every light, or
 * list them by hand.
 *
 * Configuration:
 *   type: custom:lights-on-card
 *   title: Lights on                   # Optional (default "Lights on")
 *   source: groups                     # groups (Light Groups, default) | all (every light)
 *   entities: [light.kitchen_lights]   # Optional: exactly these lights instead
 *   exclude: [light.outdoor_lights]    # Optional; also accepts wildcards like light.*screen*
 *   strip: ' Lights'                   # Text removed from names (default: " Lights" / " Light")
 *   columns: 2                         # Tiles per row (default 2)
 *   sort: name                         # name | brightness | recent (default name)
 *   show_empty: false                  # Show "All lights are off" instead of hiding (default false)
 */

const loEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const loList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const loWild = (pat) => new RegExp(`^${String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

class LightsOnCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._drag = null;
    const sr = this.shadowRoot;
    sr.addEventListener('click', (ev) => this._onClick(ev));
    sr.addEventListener('pointerdown', (ev) => this._onDown(ev));
    sr.addEventListener('pointermove', (ev) => this._onMove(ev));
    sr.addEventListener('pointerup', () => this._onUp());
    sr.addEventListener('pointercancel', () => this._endDrag(false));
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.lt')) ev.preventDefault(); });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = { source: 'groups', columns: 2, sort: 'name', ...config,
      entities: loList(config.entities).map((e) => (typeof e === 'string' ? e : e?.entity)).filter(Boolean),
      exclude: loList(config.exclude).map(loWild) };
    this._resolvedFor = null;
    this._lastHtml = null;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config || this._drag?.active) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._ids.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  _resolve() {
    const h = this._hass, c = this._config, reg = h.entities || {};
    this._resolvedFor = h.entities;
    let ids = c.entities.length ? c.entities
      : Object.keys(h.states).filter((id) => id.startsWith('light.') && !reg[id]?.hidden && !reg[id]?.entity_category
        && (c.source === 'all' || reg[id]?.platform === 'group' || Array.isArray(h.states[id].attributes?.entity_id)));
    ids = ids.filter((id) => !c.exclude.some((re) => re.test(id)));
    this._ids = ids;
  }

  _name(id) {
    const s = this._hass.states[id];
    const full = String(s?.attributes?.friendly_name || id);
    const strip = this._config.strip;
    const n = strip != null ? full.split(strip).join('') : full.replace(/\s+lights?$/i, '');
    return n.trim() || full;
  }

  _tile(id) {
    const s = this._hass.states[id];
    const a = s.attributes;
    const pct = Math.round(((a.brightness ?? 255) / 255) * 100);
    const color = a.rgb_color ? `rgb(${a.rgb_color.join(',')})` : 'var(--state-light-active-color, #ffb300)';
    const dimmable = (a.supported_color_modes || []).some((m) => m !== 'onoff') || a.brightness != null;
    const members = Array.isArray(a.entity_id) ? a.entity_id : [];
    const onCount = members.filter((m) => this._hass.states[m]?.state === 'on').length;
    const sub = [dimmable ? `${pct}%` : 'On', members.length > 1 ? `${onCount} of ${members.length}` : ''].filter(Boolean).join(' · ');
    return `
      <div class="lt" data-e="${loEsc(id)}" data-dim="${dimmable ? 1 : 0}" style="--lc:${color}" title="${loEsc(this._name(id))}">
        <div class="fill" style="width:${dimmable ? pct : 100}%"></div>
        <div class="ti"><ha-icon icon="${loEsc(a.icon || 'mdi:lightbulb-on')}"></ha-icon></div>
        <div class="tb"><div class="tn">${loEsc(this._name(id))}</div><div class="ts">${sub}</div></div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = ''; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;
    const on = this._ids.filter((id) => this._hass.states[id]?.state === 'on');
    const bri = (id) => this._hass.states[id].attributes.brightness ?? 255;
    on.sort(c.sort === 'brightness' ? (a, b) => bri(b) - bri(a)
      : c.sort === 'recent' ? (a, b) => String(this._hass.states[b].last_changed).localeCompare(String(this._hass.states[a].last_changed))
        : (a, b) => this._name(a).localeCompare(this._name(b)));
    this._on = on;

    if (!on.length && !c.show_empty) {
      if (this._lastHtml !== '') { this._lastHtml = ''; this.shadowRoot.innerHTML = '<style>:host{display:none}</style>'; }
      this.style.display = 'none';
      return;
    }
    this.style.display = '';

    const cols = Math.max(1, Number(c.columns) || 2);
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; }
        .hi { color: var(--state-light-active-color, #ffb300); --mdc-icon-size: 20px; display: flex; }
        .title { flex: 1; min-width: 0; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .title small { font-weight: 500; color: var(--secondary-text-color); font-size: .85em; margin-left: 4px; }
        .alloff { display: inline-flex; align-items: center; gap: 4px; border: none; cursor: pointer; border-radius: 14px; padding: 5px 12px;
                  font: inherit; font-size: .8em; font-weight: 600; background: rgba(127,127,127,.15); color: var(--primary-text-color); --mdc-icon-size: 16px; }
        .alloff:hover { background: rgba(127,127,127,.25); }
        .grid { display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: 8px; }
        .lt { position: relative; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border-radius: 14px; overflow: hidden;
              background: var(--secondary-background-color, rgba(127,127,127,.08)); box-sizing: border-box; min-width: 0;
              cursor: pointer; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--lc); opacity: .18; transition: width .25s ease; pointer-events: none; }
        .lt.dragging .fill { transition: none; opacity: .3; }
        .lt.off .fill { width: 0 !important; }
        .lt.off .ti { background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .ti { position: relative; width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 20px; background: color-mix(in srgb, var(--lc) 22%, transparent); color: var(--lc); }
        .tb { position: relative; flex: 1; min-width: 0; }
        .tn { font-size: .88em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ts { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; }
        .empty { color: var(--secondary-text-color); font-size: .9em; padding: 2px; }
      </style>
      <ha-card>
        <div class="head">
          <span class="hi"><ha-icon icon="${on.length ? 'mdi:lightbulb-group' : 'mdi:lightbulb-group-off-outline'}"></ha-icon></span>
          <div class="title">${loEsc(c.title || 'Lights on')}${on.length ? `<small>${on.length}</small>` : ''}</div>
          ${on.length > 1 ? '<button class="alloff" data-act="alloff"><ha-icon icon="mdi:power"></ha-icon>All off</button>' : ''}
        </div>
        ${on.length ? `<div class="grid">${on.map((id) => this._tile(id)).join('')}</div>` : '<div class="empty">All lights are off.</div>'}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // ── Interaction: tap = off, drag sideways = dim, hold = details ──────────
  _more(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _onClick(ev) {
    if (ev.target.closest('[data-act="alloff"]') && this._hass) {
      this._hass.callService('light', 'turn_off', { entity_id: this._on });
    }
  }

  _onDown(ev) {
    const tile = ev.target.closest('.lt[data-e]');
    if (!tile || ev.button > 0) return;
    this._drag = { tile, id: tile.dataset.e, x0: ev.clientX, y0: ev.clientY, rect: tile.getBoundingClientRect(), active: false, pct: null, dim: tile.dataset.dim === '1' };
    this._drag.hold = setTimeout(() => { if (this._drag && !this._drag.active) { this._more(this._drag.id); this._drag.held = true; } }, 550);
  }

  _onMove(ev) {
    const d = this._drag;
    if (!d) return;
    const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this._endDrag(false); return; }
      if (!d.dim || Math.abs(dx) < 8) return;
      d.active = true;
      clearTimeout(d.hold);
      d.tile.classList.add('dragging');
      try { d.tile.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    d.pct = Math.max(1, Math.min(100, Math.round(((ev.clientX - d.rect.left) / d.rect.width) * 100)));
    d.tile.querySelector('.fill').style.width = `${d.pct}%`;
    d.tile.querySelector('.ts').textContent = `${d.pct}%`;
  }

  _onUp() {
    const d = this._drag;
    if (!d) return;
    if (d.active && d.pct != null) {
      this._hass.callService('light', 'turn_on', { entity_id: d.id, brightness_pct: d.pct });
    } else if (!d.held) {
      // Fade the tile while HA turns it off; it disappears on the next update.
      d.tile.classList.add('off');
      this._hass.callService('light', 'turn_off', { entity_id: d.id });
    }
    this._endDrag(d.active);
  }

  _endDrag(wasActive) {
    if (!this._drag) return;
    clearTimeout(this._drag.hold);
    this._drag.tile.classList.remove('dragging');
    this._drag = null;
    if (wasActive) { this._lastHtml = null; this._render(); }
  }

  getCardSize() { return 1 + Math.ceil((this._on?.length || 2) / (Number(this._config?.columns) || 2)); }

  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('lights-on-card-editor');
  }

  static getStubConfig() { return {}; }
}

customElements.define('lights-on-card', LightsOnCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'lights-on-card',
  name: 'Lights On Card',
  description: 'Only the lights that are on: tap off, drag to dim, all-off button. Hides when everything is off.',
  preview: false,
});

class LightsOnCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:lightbulb-group', schema: [
        f.text('title', 'Title', 'Default: "Lights on"'),
        f.grid(
          f.select('source', 'Show', [{ value: 'groups', label: 'Light groups (rooms)' }, { value: 'all', label: 'Every light' }], 'Default: light groups'),
          f.select('sort', 'Sort by', [{ value: 'name', label: 'Name' }, { value: 'brightness', label: 'Brightness' }, { value: 'recent', label: 'Most recently on' }], 'Default: name'),
        ),
        f.grid(
          f.number('columns', 'Tiles per row', { min: 1, max: 6, helper: 'Default: 2' }),
          f.text('strip', 'Remove from names', 'Default: " Lights"'),
        ),
        f.toggle('show_empty', 'Show the card when everything is off'),
        f.entities('entities', 'Only these lights', 'Leave empty to find them automatically', 'light'),
        f.states('exclude', 'Never show', [], 'Entity IDs; * works as a wildcard'),
      ] },
    ];
  }
}

customElements.define('lights-on-card-editor', LightsOnCardEditor);
