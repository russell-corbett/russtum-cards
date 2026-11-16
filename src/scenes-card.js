/**
 * Scenes Card for Home Assistant
 *
 * One row of round, coloured buttons with a label under each. Tapping one
 * activates the scene (or runs the script, or toggles anything else) and the
 * button pulses to confirm. Up to about eight fit across; more scroll
 * sideways on narrow phones instead of wrapping.
 *
 * Configuration:
 *   type: custom:scenes-card
 *   title: Movie room                # Optional
 *   scenes:
 *     - entity: scene.movie_room_bright
 *       name: Warm                   # Optional (default: the entity's name)
 *       icon: mdi:heat-wave          # Optional (default: the entity's icon, else mdi:palette)
 *       color: red                   # blue, red, yellow, green, purple, pink, teal, orange,
 *                                    # white, black, grey, or a hex colour like "#ff8800"
 *     - entity: script.movie_night
 *       tap_action: { action: more-info }   # Optional: any HA tap_action
 *
 * Default tap: scene.turn_on for scenes, script.turn_on for scripts, toggle for anything else.
 */

const scEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const scItem = (v) => (typeof v === 'string' ? { entity: v } : v && typeof v === 'object' ? v : null);

class ScenesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._warned = new Set();
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.scenes)) throw new Error('Add a list of scenes, e.g. scenes: [scene.movie_time]');
    this._config = { ...config, scenes: config.scenes.map(scItem).filter((s) => s && s.entity) };
    this._lastHtml = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    const ids = this._config.scenes.map((s) => s.entity);
    if (old && ids.every((id) => old.states[id] === hass.states[id])) return;
    this._render();
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const { color } = window.RusstumShared;
    const items = c.scenes.map((s, i) => {
      const st = h.states[s.entity];
      if (!st && !this._warned.has(s.entity)) { this._warned.add(s.entity); console.warn(`scenes-card: ${s.entity} not found`); }
      const na = !st || st.state === 'unavailable';
      const name = s.name || st?.attributes?.friendly_name || s.entity;
      const icon = s.icon || st?.attributes?.icon || 'mdi:palette';
      const col = color(s.color);
      return `<button class="sc ${col.special || ''} ${na ? 'na' : ''}" data-i="${i}" style="--c:${col.rgb}"
          aria-label="${scEsc(name)}${na ? ' (unavailable)' : ''}" ${na ? 'aria-disabled="true"' : ''} title="${scEsc(name)}">
          <span class="ic"><ha-icon icon="${scEsc(icon)}"></ha-icon></span>
          <span class="lbl">${scEsc(name)}</span>
        </button>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 12px 8px; overflow: hidden; }
        .title { margin: 0 8px 8px; font-size: 1.1em; font-weight: 500; color: var(--primary-text-color); }
        .row { display: flex; gap: 4px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 4px;
          scrollbar-width: none; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; }
        .row::-webkit-scrollbar { display: none; }
        .sc { flex: 1 0 60px; min-width: 60px; scroll-snap-align: start; display: flex; flex-direction: column;
          align-items: center; gap: 6px; padding: 4px 2px; border: 0; background: none; font: inherit;
          color: var(--primary-text-color); cursor: pointer; border-radius: 12px; -webkit-tap-highlight-color: transparent; }
        .ic { position: relative; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center;
          background: rgba(var(--c), .2); color: rgb(var(--c)); transition: transform .12s ease, background .2s; }
        .ic ha-icon { --mdc-icon-size: 24px; }
        .sc:hover .ic { background: rgba(var(--c), .3); }
        .sc:active .ic { transform: scale(.9); }
        .sc.white .ic { background: rgba(var(--c), .92); color: #4a4a4a; box-shadow: inset 0 0 0 1px var(--divider-color, rgba(0,0,0,.15)); }
        .sc.black .ic { background: rgba(var(--c), .85); color: #f2f2f2; box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255,255,255,.2)); }
        .ic::after { content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
          box-shadow: 0 0 0 0 rgba(var(--c), .55); }
        .sc.black .ic::after { box-shadow: 0 0 0 0 rgba(var(--rgb-primary-text-color, 128, 128, 128), .5); }
        .sc.fired .ic::after { animation: sc-pulse .7s ease-out; }
        .sc.fired .ic { animation: sc-pop .35s ease-out; }
        @keyframes sc-pulse { from { box-shadow: 0 0 0 0 rgba(var(--c), .55); } to { box-shadow: 0 0 0 14px rgba(var(--c), 0); } }
        @keyframes sc-pop { 50% { transform: scale(1.08); } }
        .lbl { max-width: 100%; font-size: .78em; font-weight: 500; line-height: 1.2; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; }
        .sc.na { opacity: .4; cursor: default; }
        .sc:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) { .sc.fired .ic, .sc.fired .ic::after { animation: none; } }
        .empty { padding: 8px; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        ${c.title ? `<h2 class="title">${scEsc(c.title)}</h2>` : ''}
        ${items ? `<div class="row" role="group" aria-label="${scEsc(c.title || 'Scenes')}">${items}</div>`
          : '<div class="empty">No scenes configured</div>'}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('.sc[data-i]');
    if (!el || !this._hass || el.classList.contains('na')) return;
    const s = this._config.scenes[Number(el.dataset.i)];
    if (!s) return;
    if (s.tap_action) {
      window.RusstumShared.act(this, this._hass, s.tap_action, s.entity);
    } else {
      const domain = s.entity.split('.')[0];
      if (domain === 'scene' || domain === 'script') this._hass.callService(domain, 'turn_on', { entity_id: s.entity });
      else this._hass.callService('homeassistant', 'toggle', { entity_id: s.entity });
    }
    // Scenes have no on/off state, so confirm the tap with a short pulse.
    el.classList.remove('fired');
    void el.offsetWidth;   // restart the animation on repeat taps
    el.classList.add('fired');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('fired'), 800);
  }

  getCardSize() { return this._config?.title ? 3 : 2; }

  getGridOptions() { return { columns: 12, min_columns: 4, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('scenes-card-editor');
  }

  static getStubConfig(hass) {
    const palette = ['blue', 'red', 'yellow', 'green', 'purple', 'pink'];
    const found = Object.keys(hass?.states || {}).filter((id) => id.startsWith('scene.')).slice(0, 5);
    return { scenes: found.map((entity, i) => ({ entity, color: palette[i % palette.length] })) };
  }
}

customElements.define('scenes-card', ScenesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'scenes-card',
  name: 'Scenes Card',
  description: 'A row of round, coloured scene buttons with labels. Tap to activate, with a short pulse to confirm.',
  preview: true,
});

class ScenesCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:palette', schema: [f.text('title', 'Title', 'Optional')] },
      { title: 'Scenes', icon: 'mdi:palette-swatch', list: {
        key: 'scenes',
        collapsible: true,
        label: (s, i) => s.name || s.entity || `Scene ${i + 1}`,
        newItem: () => ({ color: 'blue' }),
        addLabel: 'Add scene',
        schema: [
          { name: 'entity', label: 'Scene, script or entity', selector: { entity: {} } },
          f.grid(f.text('name', 'Name', 'Default: the entity\'s name'), f.icon('icon')),
          f.select('color', 'Colour', window.RusstumShared.COLOR_OPTIONS, 'Or a hex colour, e.g. #ff8800'),
          { name: 'tap_action', label: 'Tap action (default: activate)', selector: { ui_action: {} } },
        ],
      } },
    ];
  }
}

customElements.define('scenes-card-editor', ScenesCardEditor);
