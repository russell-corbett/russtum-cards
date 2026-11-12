/**
 * Floor Lights Card for Home Assistant
 *
 * One floor's lights, room by room. Each room has a light tile (tap to
 * toggle, drag sideways to dim, hold for details), up to four scene buttons,
 * and optional extra switches like a Christmas tree plug. The scene that was
 * last turned on is highlighted while the room's light is on. The header
 * counts what's on and turns the whole floor off.
 *
 * Rooms with nothing but a light sit two to a row; rooms with scenes or
 * switches get the full width.
 *
 * Configuration:
 *   type: custom:floor-lights-card
 *   title: Main Floor
 *   icon: mdi:home-floor-1
 *   rooms:
 *     - name: Family Room                       # Optional: default = the light's name
 *       light: light.family_room_lights          # Light, light group or switch
 *       scenes:                                  # Up to 4
 *         - scene.family_room_bright
 *         - entity: scene.family_room_christmas
 *           name: Christmas
 *           icon: mdi:pine-tree
 *       switches:                                # Optional extra toggles
 *         - switch.family_room_christmas_tree
 *     - light: light.kitchen_lights
 *   hide_all_off: false                          # Hide the floor "All off" button
 */

const FL_SCENE_ICONS = [
  [/\boff\b/i, 'mdi:lightbulb-off-outline'], [/bright|energi[sz]e|day/i, 'mdi:brightness-7'], [/dim/i, 'mdi:brightness-5'],
  [/night/i, 'mdi:weather-night'], [/relax|rest|chill/i, 'mdi:sofa-single'], [/read|study/i, 'mdi:book-open-variant'],
  [/concentrat|focus|work/i, 'mdi:head-lightbulb'], [/christmas|xmas/i, 'mdi:pine-tree'], [/hallow|spell|witch|trick|pandemonium/i, 'mdi:halloween'],
  [/movie|cinema|film|tv/i, 'mdi:movie-open'], [/bar|cocktail/i, 'mdi:glass-cocktail'], [/sync/i, 'mdi:television-ambient-light'],
  [/candle|fire/i, 'mdi:candle'], [/sunset|tropical|savanna/i, 'mdi:weather-sunset'], [/natural/i, 'mdi:white-balance-sunny'],
];
const flEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const flList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const flEnt = (v) => (typeof v === 'string' ? { entity: v } : v || {});

class FloorLightsCard extends HTMLElement {
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
    if (!config || !Array.isArray(config.rooms)) throw new Error('Add at least one room under "rooms"');
    const rooms = config.rooms.map((r) => ({
      ...r,
      scenes: flList(r.scenes).map(flEnt).filter((s) => s.entity).slice(0, 4),
      switches: flList(r.switches).map(flEnt).filter((s) => s.entity),
    })).filter((r) => r.light || r.scenes.length || r.switches.length);
    this._config = { ...config, rooms };
    this._watched = rooms.flatMap((r) => [r.light, ...r.scenes.map((s) => s.entity), ...r.switches.map((s) => s.entity)]).filter(Boolean);
    this._lastHtml = null;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config || this._drag?.active) return;
    if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  _roomName(r) {
    if (r.name) return r.name;
    const s = this._hass.states[r.light];
    return String(s?.attributes?.friendly_name || r.light || 'Room').replace(/\s+lights?$/i, '');
  }

  // "Family Room Bright" → "Bright" in the Family Room.
  _sceneName(sc, room, lightId) {
    if (sc.name) return sc.name;
    let n = String(this._hass.states[sc.entity]?.attributes?.friendly_name || sc.entity.split('.')[1].replace(/_/g, ' '));
    // Drop leading words from the room's and its light's names, plus "light(s)": "Outdoor Lights Bright" → "Bright".
    const source = `${room} ${this._hass.states[lightId]?.attributes?.friendly_name || ''} lights light`;
    const words = new Set(source.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).flatMap((w) => [w, w.replace(/'s$/, '')]));
    const parts = n.split(/\s+/);
    let i = 0;
    while (i < parts.length - 1 && words.has(parts[i].toLowerCase().replace(/[^a-z0-9']/g, ''))) i++;
    n = parts.slice(i).join(' ');
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  _lightTile(r, name) {
    const s = this._hass.states[r.light];
    if (!s) return `<div class="lt na"><div class="ti"><ha-icon icon="mdi:lightbulb-question"></ha-icon></div><div class="tb"><div class="tn">${flEsc(name)}</div><div class="ts">Not found</div></div></div>`;
    const a = s.attributes;
    const on = s.state === 'on';
    const isLight = r.light.startsWith('light.');
    const dimmable = isLight && ((a.supported_color_modes || []).some((m) => m !== 'onoff') || a.brightness != null);
    const pct = on ? (dimmable ? Math.round(((a.brightness ?? 255) / 255) * 100) : 100) : 0;
    const color = on ? (a.rgb_color ? `rgb(${a.rgb_color.join(',')})` : 'var(--state-light-active-color, #ffb300)') : 'var(--secondary-text-color)';
    const members = Array.isArray(a.entity_id) ? a.entity_id : [];
    const onN = members.filter((m) => this._hass.states[m]?.state === 'on').length;
    const sub = s.state === 'unavailable' ? 'Unavailable' : !on ? 'Off'
      : [dimmable ? `${pct}%` : 'On', members.length > 1 && onN < members.length ? `${onN} of ${members.length}` : ''].filter(Boolean).join(' · ');
    const icon = r.icon || (on ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline');
    return `
      <div class="lt ${on ? 'on' : ''} ${s.state === 'unavailable' ? 'na' : ''}" data-e="${flEsc(r.light)}" data-dim="${dimmable ? 1 : 0}" style="--lc:${color}">
        <div class="fill" style="width:${pct}%"></div>
        <div class="ti"><ha-icon icon="${flEsc(icon)}"></ha-icon></div>
        <div class="tb"><div class="tn">${flEsc(name)}</div><div class="ts">${sub}</div></div>
      </div>`;
  }

  // The room's most recently activated scene, if it ran since the light last came on.
  _activeScene(r) {
    const light = this._hass.states[r.light];
    if (light && light.state !== 'on') return null;
    let best = null, bestT = 0;
    for (const sc of r.scenes) {
      const t = Date.parse(this._hass.states[sc.entity]?.state);
      if (!isNaN(t) && t > bestT) { best = sc.entity; bestT = t; }
    }
    if (!best) return null;
    if (light && Date.parse(light.last_changed) > bestT + 5000) return null;   // turned on some other way since
    return best;
  }

  _room(r) {
    const name = this._roomName(r);
    const active = this._activeScene(r);
    const wide = r.scenes.length || r.switches.length;
    const scenes = r.scenes.map((sc) => {
      const st = this._hass.states[sc.entity];
      const label = this._sceneName(sc, name, r.light);
      const icon = sc.icon || st?.attributes?.icon || FL_SCENE_ICONS.find(([re]) => re.test(label))?.[1] || 'mdi:palette';
      return `<button class="sc ${active === sc.entity ? 'act' : ''} ${st ? '' : 'na'}" data-act="scene" data-e="${flEsc(sc.entity)}" title="${flEsc(label)}">
        <ha-icon icon="${flEsc(icon)}"></ha-icon><span>${flEsc(label)}</span></button>`;
    }).join('');
    const switches = r.switches.map((sw) => {
      const st = this._hass.states[sw.entity];
      const on = st?.state === 'on';
      const label = sw.name || String(st?.attributes?.friendly_name || sw.entity).replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '');
      return `<button class="sw ${on ? 'on' : ''}" data-act="toggle" data-e="${flEsc(sw.entity)}" title="${flEsc(label)}">
        <ha-icon icon="${flEsc(sw.icon || st?.attributes?.icon || (on ? 'mdi:power-plug' : 'mdi:power-plug-off-outline'))}"></ha-icon><span>${flEsc(label)}</span></button>`;
    }).join('');
    return `
      <div class="room ${wide ? 'wide' : ''}">
        ${r.light ? this._lightTile(r, name) : `<div class="rn">${flEsc(name)}</div>`}
        ${scenes ? `<div class="scenes n${r.scenes.length}">${scenes}</div>` : ''}
        ${switches ? `<div class="sws">${switches}</div>` : ''}
      </div>`;
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = ''; return; }
    const c = this._config;
    const onIds = [...c.rooms.map((r) => r.light), ...c.rooms.flatMap((r) => r.switches.map((s) => s.entity))]
      .filter((id) => id && this._hass.states[id]?.state === 'on');
    this._onIds = onIds;
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; --mdc-icon-size: 20px; }
        .head > ha-icon { color: var(--secondary-text-color); }
        .title { flex: 1; min-width: 0; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .title small { font-weight: 500; color: var(--secondary-text-color); font-size: .8em; margin-left: 6px; }
        .alloff { display: inline-flex; align-items: center; gap: 4px; border: none; cursor: pointer; border-radius: 14px; padding: 5px 12px;
                  font: inherit; font-size: .8em; font-weight: 600; background: rgba(127,127,127,.15); color: var(--primary-text-color); --mdc-icon-size: 16px; }
        .alloff:hover { background: rgba(127,127,127,.25); }
        .rooms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .room { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .room.wide { grid-column: 1 / -1; padding: 6px; margin: 0 -2px; border-radius: 16px; background: rgba(127,127,127,.05); }
        .rn { font-size: .88em; font-weight: 600; color: var(--primary-text-color); padding: 4px 6px 0; }

        .lt { position: relative; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border-radius: 14px; overflow: hidden;
              background: var(--secondary-background-color, rgba(127,127,127,.08)); box-sizing: border-box; min-width: 0;
              cursor: pointer; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--lc); opacity: .18; transition: width .25s ease; pointer-events: none; }
        .lt.dragging .fill { transition: none; opacity: .3; }
        .ti { position: relative; width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 20px; background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .lt.on .ti { background: color-mix(in srgb, var(--lc) 22%, transparent); color: var(--lc); }
        .tb { position: relative; flex: 1; min-width: 0; }
        .tn { font-size: .88em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ts { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; }
        .na { opacity: .5; }

        .scenes { display: grid; gap: 6px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .scenes.n1 { grid-template-columns: minmax(0, 1fr); }
        .scenes.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .scenes.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .sc, .sw { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 34px; padding: 0 8px; border: none; cursor: pointer;
                   border-radius: 10px; font: inherit; font-size: .78em; font-weight: 600; --mdc-icon-size: 16px;
                   background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--primary-text-color); }
        .sc span, .sw span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sc ha-icon { color: var(--secondary-text-color); flex-shrink: 0; }
        .sc:hover, .sw:hover { filter: brightness(1.15); }
        .sc:active { transform: scale(.97); }
        .sc.act { background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent); color: var(--primary-color, #03a9f4); }
        .sc.act ha-icon { color: var(--primary-color, #03a9f4); }
        .sc.flash { background: color-mix(in srgb, var(--primary-color, #03a9f4) 35%, transparent); }
        .sws { display: flex; flex-wrap: wrap; gap: 6px; }
        .sw { flex: 1 1 140px; justify-content: flex-start; }
        .sw ha-icon { color: var(--secondary-text-color); }
        .sw.on { background: rgba(255,179,0,.16); }
        .sw.on ha-icon { color: var(--state-switch-active-color, var(--state-light-active-color, #ffb300)); }
        @container (max-width: 340px) { .sc span { display: none; } }
        ha-card { container-type: inline-size; }
        @media (max-width: 420px) { .scenes:not(.n1):not(.n2) .sc span { font-size: .92em; } }
      </style>
      <ha-card>
        ${c.title || !c.hide_all_off ? `<div class="head">
          ${c.icon ? `<ha-icon icon="${flEsc(c.icon)}"></ha-icon>` : ''}
          <div class="title">${flEsc(c.title || '')}${onIds.length ? `<small>${onIds.length} on</small>` : ''}</div>
          ${!c.hide_all_off && onIds.length ? '<button class="alloff" data-act="alloff"><ha-icon icon="mdi:power"></ha-icon>All off</button>' : ''}
        </div>` : ''}
        <div class="rooms">${c.rooms.map((r) => this._room(r)).join('')}</div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // ── Interaction ──────────────────────────────────────────────────────────
  _more(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const id = el.dataset.e;
    if (el.dataset.act === 'scene') {
      this._hass.callService('scene', 'turn_on', { entity_id: id });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 400);
    } else if (el.dataset.act === 'toggle') {
      this._hass.callService('homeassistant', 'toggle', { entity_id: id });
    } else if (el.dataset.act === 'alloff') {
      this._hass.callService('homeassistant', 'turn_off', { entity_id: this._onIds });
    }
  }

  // Light tile: tap = toggle, drag sideways = dim, hold = details.
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
      d.tile.classList.add('dragging', 'on');
      try { d.tile.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    d.pct = Math.max(1, Math.min(100, Math.round(((ev.clientX - d.rect.left) / d.rect.width) * 100)));
    d.tile.querySelector('.fill').style.width = `${d.pct}%`;
    d.tile.querySelector('.ts').textContent = `${d.pct}%`;
  }

  _onUp() {
    const d = this._drag;
    if (!d) return;
    if (d.active && d.pct != null) this._hass.callService('light', 'turn_on', { entity_id: d.id, brightness_pct: d.pct });
    else if (!d.held) this._hass.callService('homeassistant', 'toggle', { entity_id: d.id });
    this._endDrag(d.active);
  }

  _endDrag(wasActive) {
    if (!this._drag) return;
    clearTimeout(this._drag.hold);
    this._drag.tile.classList.remove('dragging');
    this._drag = null;
    if (wasActive) { this._lastHtml = null; this._render(); }
  }

  getCardSize() {
    const rooms = this._config?.rooms || [];
    return 1 + rooms.reduce((n, r) => n + (r.scenes.length || r.switches.length ? 2 : 0.5), 0);
  }

  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('floor-lights-card-editor');
  }

  static getStubConfig(hass) {
    const light = Object.keys(hass?.states || {}).find((id) => id.startsWith('light.'));
    return { title: 'Lights', rooms: [light ? { light } : {}] };
  }
}

customElements.define('floor-lights-card', FloorLightsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'floor-lights-card',
  name: 'Floor Lights Card',
  description: "A floor's lights room by room: dimmable tiles, up to four scenes per room, extra switches and an all-off button.",
  preview: false,
});

class FloorLightsCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Floor', icon: 'mdi:home-floor-1', schema: [
        f.grid(f.text('title', 'Title'), f.icon('icon')),
        f.toggle('hide_all_off', 'Hide the "All off" button'),
      ] },
      { title: 'Rooms', icon: 'mdi:floor-plan', list: {
        key: 'rooms',
        schema: [
          f.grid(f.text('name', 'Room name', 'Default: the light\'s name'), f.entity('light', 'Light', 'A light, light group or switch')),
          f.entities('switches', 'Extra switches', 'e.g. a Christmas tree plug', 'switch'),
        ],
        label: (r, i) => r.name || r.light || `Room ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add room',
        collapsible: true,
        nested: {
          key: 'scenes',
          schema: [f.entity('entity', 'Scene', '', 'scene'), f.grid(f.text('name', 'Label'), f.icon('icon'))],
          label: (s, i) => s.name || s.entity || `Scene ${i + 1}`,
          newItem: () => ({}),
          addLabel: 'Add scene (up to 4)',
        },
      } },
    ];
  }
}

customElements.define('floor-lights-card-editor', FloorLightsCardEditor);
