/**
 * Room Overview Card for Home Assistant
 *
 * Everything about one room in a single compact card:
 *   • header with the room's temperature and humidity (taken from its
 *     thermostat when no sensors are given) and an occupancy glow
 *   • light tiles: tap to toggle, drag sideways to dim, hold for details
 *   • thermostat tiles with − / + (changes are batched, then sent once)
 *   • chips for everything else (TVs, Apple TVs, printers, PCs…)
 *
 * Configuration:
 *   type: custom:room-overview-card
 *   name: Family Room                  # Optional when `area` is set
 *   icon: mdi:sofa                     # Optional when `area` has an icon
 *   area: family_room                  # Optional: name/icon from the area
 *   navigate: /lovelace/movie-room     # Optional: tapping the header opens this
 *   lights: [light.family_room_lights]
 *   climate: [climate.family_room_thermostat]   # one or more
 *   temperature_entity: sensor.family_room_current_temperature   # Optional
 *   humidity_entity: sensor.family_room_current_humidity         # Optional
 *   occupancy: [binary_sensor.family_room_motion]                # Optional
 *   entities:
 *     - entity: media_player.family_room_tv
 *       name: TV
 *       icon: mdi:television
 *     - entity: switch.family_room_christmas_tree
 *       tap: toggle                    # default: open details
 */

const RO_ON = ['on', 'playing', 'paused', 'buffering', 'open', 'unlocked', 'home', 'heat', 'cool', 'heating', 'cleaning', 'printing', 'running'];
const RO_DOMAIN_ICON = {
  media_player: 'mdi:cast', switch: 'mdi:toggle-switch-variant', light: 'mdi:lightbulb', fan: 'mdi:fan',
  binary_sensor: 'mdi:checkbox-blank-circle-outline', sensor: 'mdi:eye', cover: 'mdi:window-shutter', lock: 'mdi:lock',
  input_boolean: 'mdi:toggle-switch-variant', vacuum: 'mdi:robot-vacuum', button: 'mdi:gesture-tap-button',
};

const roEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const roList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

class RoomOverviewCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._pending = {};      // climate entity → target not yet sent
    this._drag = null;
    const sr = this.shadowRoot;
    sr.addEventListener('click', (ev) => this._onClick(ev));
    sr.addEventListener('pointerdown', (ev) => this._onDown(ev));
    sr.addEventListener('pointermove', (ev) => this._onMove(ev));
    sr.addEventListener('pointerup', (ev) => this._onUp(ev));
    sr.addEventListener('pointercancel', () => this._endDrag(false));
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.lt')) ev.preventDefault(); });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const entities = roList(config.entities).map((e) => (typeof e === 'string' ? { entity: e } : e)).filter((e) => e.entity);
    this._config = { ...config, lights: roList(config.lights || config.light), climate: roList(config.climate), occupancy: roList(config.occupancy), entities };
    const c = this._config;
    this._watched = [...c.lights, ...c.climate, ...c.occupancy, ...entities.map((e) => e.entity), c.temperature_entity, c.humidity_entity].filter(Boolean);
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config || this._drag?.active) return;
    if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    // A pending thermostat change is done once HA reports the new target.
    for (const [id, v] of Object.entries(this._pending)) {
      if (Number(hass.states[id]?.attributes?.temperature) === v && !this._pending[`${id}:timer`]) delete this._pending[id];
    }
    this._render();
  }

  _st(id) { return id ? this._hass?.states[id] : null; }

  _reading(entityKey, attr) {
    const s = this._st(this._config[entityKey]);
    if (s && !isNaN(parseFloat(s.state))) return { v: parseFloat(s.state), unit: s.attributes.unit_of_measurement || '', id: s.entity_id };
    for (const id of this._config.climate) {
      const v = this._st(id)?.attributes?.[attr];
      if (v != null && !isNaN(v)) return { v: Number(v), unit: attr === 'current_humidity' ? '%' : (this._st(id).attributes.temperature_unit || '°'), id };
    }
    return null;
  }

  // ── Tiles ──────────────────────────────────────────────────────────────────
  _lightTile(id) {
    const s = this._st(id);
    const name = this._short(s?.attributes?.friendly_name || id);
    if (!s) return `<div class="tile lt na"><ha-icon icon="mdi:lightbulb-question"></ha-icon><div class="tb"><div class="tn">${roEsc(name)}</div><div class="ts">Not found</div></div></div>`;
    const on = s.state === 'on';
    const unavailable = s.state === 'unavailable';
    const pct = on ? Math.round(((s.attributes.brightness ?? 255) / 255) * 100) : 0;
    const rgb = s.attributes.rgb_color;
    const color = on ? (rgb ? `rgb(${rgb.join(',')})` : 'var(--state-light-active-color, #ffb300)') : 'var(--secondary-text-color)';
    const dimmable = (s.attributes.supported_color_modes || []).some((m) => m !== 'onoff') || s.attributes.brightness != null;
    return `
      <div class="tile lt ${on ? 'on' : ''} ${unavailable ? 'na' : ''}" data-e="${roEsc(id)}" data-dim="${dimmable ? 1 : 0}" style="--lc:${color}">
        <div class="fill" style="width:${pct}%"></div>
        <div class="ti"><ha-icon icon="${on ? 'mdi:lightbulb-on' : unavailable ? 'mdi:lightbulb-off-outline' : 'mdi:lightbulb-outline'}"></ha-icon></div>
        <div class="tb"><div class="tn">${roEsc(name)}</div><div class="ts">${unavailable ? 'Unavailable' : on ? `${pct}%` : 'Off'}</div></div>
      </div>`;
  }

  _climateTile(id) {
    const s = this._st(id);
    // "Ensuite Thermostat" → "Ensuite"; the room's own thermostat is just "Heat".
    const name = this._config.climate.length > 1
      ? (this._short(s?.attributes?.friendly_name || id).replace(/\s*thermostat$/i, '') || 'Heat')
      : 'Heat';
    if (!s || s.state === 'unavailable') {
      return `<div class="tile ct na" data-act="more" data-e="${roEsc(id)}"><div class="ti"><ha-icon icon="mdi:thermostat-off"></ha-icon></div>
        <div class="tb"><div class="tn">${roEsc(name)}</div><div class="ts">Unavailable</div></div></div>`;
    }
    const a = s.attributes;
    const off = s.state === 'off';
    const action = a.hvac_action;
    const heating = action === 'heating', cooling = action === 'cooling';
    const target = this._pending[id] ?? (a.temperature != null ? Number(a.temperature) : null);
    const step = a.target_temp_step || 0.5;
    const status = off ? 'Off' : heating ? 'Heating' : cooling ? 'Cooling' : action === 'idle' ? 'Idle' : (s.state.charAt(0).toUpperCase() + s.state.slice(1));
    return `
      <div class="tile ct ${heating ? 'heat' : cooling ? 'cool' : ''} ${off ? 'off' : ''}">
        <div class="ti" data-act="more" data-e="${roEsc(id)}"><ha-icon icon="${heating ? 'mdi:fire' : cooling ? 'mdi:snowflake' : off ? 'mdi:thermostat-off' : 'mdi:thermostat'}"></ha-icon></div>
        <div class="tb" data-act="more" data-e="${roEsc(id)}"><div class="tn">${roEsc(name)}</div><div class="ts">${status}</div></div>
        ${!off && target != null ? `
          <div class="step">
            <button data-act="temp" data-e="${roEsc(id)}" data-d="${-step}" title="Lower">−</button>
            <span class="tv ${this._pending[id] != null ? 'pend' : ''}">${target.toFixed(step < 1 ? 1 : 0)}°</span>
            <button data-act="temp" data-e="${roEsc(id)}" data-d="${step}" title="Raise">+</button>
          </div>` : ''}
      </div>`;
  }

  _chip(e) {
    const s = this._st(e.entity);
    const domain = e.entity.split('.')[0];
    const state = s?.state ?? 'unavailable';
    const active = RO_ON.includes(state) || (domain === 'media_player' && !['off', 'standby', 'idle', 'unavailable', 'unknown'].includes(state));
    const name = e.name || this._short(s?.attributes?.friendly_name || e.entity);
    const icon = e.icon || s?.attributes?.icon || RO_DOMAIN_ICON[domain] || 'mdi:circle-outline';
    let label = state === 'unavailable' ? 'Offline' : this._hass?.formatEntityState ? this._hass.formatEntityState(s) : state;
    if (domain === 'media_player' && active && s.attributes.media_title) label = s.attributes.media_title;
    return `
      <div class="chip ${active ? 'on' : ''} ${state === 'unavailable' ? 'na' : ''}" data-act="${e.tap === 'toggle' ? 'toggle' : 'more'}" data-e="${roEsc(e.entity)}" title="${roEsc(name)}: ${roEsc(label)}">
        <ha-icon icon="${roEsc(icon)}"></ha-icon><span class="cn">${roEsc(name)}</span><span class="cs">${roEsc(label)}</span>
      </div>`;
  }

  // Drop the room name from entity names ("Family Room Lights" → "Lights").
  _short(full) {
    const room = this._name();
    let n = String(full);
    if (room && n.toLowerCase().startsWith(room.toLowerCase() + ' ')) n = n.slice(room.length + 1);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  _name() {
    const c = this._config;
    return c.name || this._hass?.areas?.[c.area]?.name || c.area || 'Room';
  }

  _render() {
    if (!this._config) return;
    const c = this._config;
    const temp = this._reading('temperature_entity', 'current_temperature');
    const hum = this._reading('humidity_entity', 'current_humidity');
    const occupied = c.occupancy.some((id) => this._st(id)?.state === 'on');
    const icon = c.icon || this._hass?.areas?.[c.area]?.icon || 'mdi:home-outline';
    const anyOn = c.lights.some((id) => this._st(id)?.state === 'on');
    const heating = c.climate.some((id) => this._st(id)?.attributes?.hvac_action === 'heating');

    const tiles = [...c.lights.map((id) => this._lightTile(id)), ...c.climate.map((id) => this._climateTile(id))];
    const chips = c.entities.map((e) => this._chip(e));

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; transition: box-shadow .4s; }
        ha-card.occ { box-shadow: 0 0 0 1.5px var(--primary-color, #03a9f4) inset, var(--ha-card-box-shadow, none); }
        .head { display: flex; align-items: center; gap: 10px; margin-bottom: ${tiles.length || chips.length ? 10 : 0}px; }
        .head[data-act] { cursor: pointer; }
        .ri { position: relative; width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 20px; background: var(--secondary-background-color, rgba(127,127,127,.12)); color: var(--secondary-text-color); }
        .ri.lit { background: rgba(255,179,0,.16); color: var(--state-light-active-color, #ffb300); }
        .occ-dot { position: absolute; right: -1px; top: -1px; width: 10px; height: 10px; border-radius: 50%; background: var(--primary-color, #03a9f4);
                   border: 2px solid var(--card-background-color, #1c1c1c); animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .45; } }
        .rn { flex: 1; min-width: 0; font-size: 1em; font-weight: 600; color: var(--primary-text-color); display: flex; align-items: center; gap: 2px;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; --mdc-icon-size: 18px; }
        .rn ha-icon { color: var(--secondary-text-color); flex-shrink: 0; }
        .readings { display: flex; gap: 10px; flex-shrink: 0; font-size: .82em; color: var(--secondary-text-color); --mdc-icon-size: 15px; }
        .readings span { display: inline-flex; align-items: center; gap: 2px; cursor: pointer; white-space: nowrap; }
        .readings b { color: var(--primary-text-color); font-weight: 600; }
        .heat-badge { color: var(--state-climate-heat-color, #ff8100); }

        .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
        .tile { container-type: inline-size; position: relative; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border-radius: 14px; overflow: hidden;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); box-sizing: border-box; min-width: 0; }
        .ti { position: relative; width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 20px; background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .tb { position: relative; flex: 1; min-width: 0; }
        .tn { font-size: .86em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ts { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; }
        .na { opacity: .5; }

        .lt { cursor: pointer; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .lt .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--lc); opacity: .16; transition: width .25s ease; pointer-events: none; }
        .lt.dragging .fill { transition: none; opacity: .28; }
        .lt.on .ti { background: color-mix(in srgb, var(--lc) 22%, transparent); color: var(--lc); }

        .ct .ti, .ct .tb { cursor: pointer; }
        .ct.heat .ti { background: rgba(255,129,0,.18); color: var(--state-climate-heat-color, #ff8100); }
        .ct.heat .ts { color: var(--state-climate-heat-color, #ff8100); font-weight: 600; }
        .ct.cool .ti { background: rgba(33,150,243,.18); color: var(--state-climate-cool-color, #2196f3); }
        .ct.off .ti { opacity: .6; }
        .step { display: flex; align-items: center; gap: 2px; flex-shrink: 0; border-radius: 10px; background: rgba(127,127,127,.12); }
        .step button { width: 28px; height: 30px; border: none; background: none; cursor: pointer; border-radius: 8px; font-size: 1.15em; line-height: 1;
                       color: var(--primary-text-color); }
        .step button:hover { background: rgba(127,127,127,.2); }
        .tv { min-width: 40px; text-align: center; font-weight: 700; font-size: .95em; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        .tv.pend { color: var(--primary-color, #03a9f4); }
        /* Narrow climate tiles: drop the round icon so the name and stepper fit. */
        @container (max-width: 200px) { .ct .ti { display: none; } .ct { gap: 6px; } .step button { width: 26px; } .tv { min-width: 36px; } }

        .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: ${tiles.length ? 8 : 0}px; }
        .chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 5px 10px 5px 7px; border-radius: 16px; cursor: pointer;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); font-size: .78em; color: var(--secondary-text-color); --mdc-icon-size: 16px; min-width: 0; }
        .chip.on { background: rgba(3,169,244,.14); color: var(--primary-color, #03a9f4); }
        .cn { font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cs { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
        .cs::before { content: '·'; margin-right: 4px; opacity: .6; }
      </style>
      <ha-card class="${occupied ? 'occ' : ''}">
        <div class="head" ${c.navigate ? `data-act="nav"` : ''}>
          <div class="ri ${anyOn ? 'lit' : ''}"><ha-icon icon="${roEsc(icon)}"></ha-icon>${occupied ? '<span class="occ-dot" title="Occupied"></span>' : ''}</div>
          <div class="rn">${roEsc(this._name())}${c.navigate ? '<ha-icon icon="mdi:chevron-right"></ha-icon>' : ''}</div>
          <div class="readings">
            ${heating ? '<span class="heat-badge" title="Heating"><ha-icon icon="mdi:fire"></ha-icon></span>' : ''}
            ${hum ? `<span data-act="more" data-e="${roEsc(hum.id)}"><ha-icon icon="mdi:water-percent"></ha-icon><b>${Math.round(hum.v)}</b>%</span>` : ''}
            ${temp ? `<span data-act="more" data-e="${roEsc(temp.id)}"><ha-icon icon="mdi:thermometer"></ha-icon><b>${temp.v.toFixed(1)}</b>${roEsc(temp.unit.replace('°C', '°').replace('°F', '°'))}</span>` : ''}
          </div>
        </div>
        ${tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // ── Interaction ────────────────────────────────────────────────────────────
  _more(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'more') this._more(el.dataset.e);
    else if (act === 'toggle') this._hass.callService('homeassistant', 'toggle', { entity_id: el.dataset.e });
    else if (act === 'nav') {
      if (ev.target.closest('.readings span')) return;
      history.pushState(null, '', this._config.navigate);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } else if (act === 'temp') {
      // Batch quick taps: update the number now, send one service call after a short pause.
      const id = el.dataset.e;
      const s = this._st(id);
      const a = s.attributes;
      const cur = this._pending[id] ?? Number(a.temperature);
      const next = Math.min(a.max_temp ?? 35, Math.max(a.min_temp ?? 5, Math.round((cur + Number(el.dataset.d)) * 10) / 10));
      this._pending[id] = next;
      clearTimeout(this._pending[`${id}:timer`]);
      this._pending[`${id}:timer`] = setTimeout(() => {
        delete this._pending[`${id}:timer`];
        this._hass.callService('climate', 'set_temperature', { entity_id: id, temperature: this._pending[id] });
        setTimeout(() => { delete this._pending[id]; this._render(); }, 8000);   // give up waiting after 8 s
      }, 900);
      this._render();
    }
  }

  // Light tiles: tap = toggle, horizontal drag = brightness, hold = details.
  _onDown(ev) {
    const tile = ev.target.closest('.lt[data-e]');
    if (!tile || ev.button > 0) return;
    const rect = tile.getBoundingClientRect();
    this._drag = { tile, id: tile.dataset.e, x0: ev.clientX, y0: ev.clientY, rect, active: false, pct: null, dim: tile.dataset.dim === '1' };
    this._drag.hold = setTimeout(() => { if (this._drag && !this._drag.active) { this._more(this._drag.id); this._drag.held = true; } }, 550);
  }

  _onMove(ev) {
    const d = this._drag;
    if (!d) return;
    const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this._endDrag(false); return; }   // scrolling
      if (!d.dim || Math.abs(dx) < 8) return;
      d.active = true;
      clearTimeout(d.hold);
      d.tile.classList.add('dragging');
      try { d.tile.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    d.pct = Math.max(1, Math.min(100, Math.round(((ev.clientX - d.rect.left) / d.rect.width) * 100)));
    d.tile.querySelector('.fill').style.width = `${d.pct}%`;
    d.tile.querySelector('.ts').textContent = `${d.pct}%`;
    d.tile.classList.add('on');
  }

  _onUp() {
    const d = this._drag;
    if (!d) return;
    if (d.active && d.pct != null) {
      this._hass.callService('light', 'turn_on', { entity_id: d.id, brightness_pct: d.pct });
    } else if (!d.held) {
      this._hass.callService('light', 'toggle', { entity_id: d.id });
    }
    this._endDrag(d.active);
  }

  _endDrag(wasActive) {
    if (!this._drag) return;
    clearTimeout(this._drag.hold);
    this._drag.tile.classList.remove('dragging');
    this._drag = null;
    if (!wasActive) return;
    this._lastHtml = null;
    this._render();
  }

  getCardSize() { return 2 + Math.ceil((this._config?.lights.length + this._config?.climate.length) / 2) + (this._config?.entities.length ? 1 : 0); }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('room-overview-card-editor');
  }

  static getStubConfig(hass) {
    const area = Object.keys(hass?.areas || {})[0];
    return area ? { area } : { name: 'Room' };
  }
}

customElements.define('room-overview-card', RoomOverviewCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'room-overview-card',
  name: 'Room Overview Card',
  description: 'One room: temperature, humidity, occupancy, dimmable lights, thermostats and devices.',
  preview: false,
});

class RoomOverviewCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Room', icon: 'mdi:sofa', schema: [
        { name: 'area', label: 'Area', helper: 'Fills in the name and icon', selector: { area: {} } },
        f.grid(f.text('name', 'Name'), f.icon('icon')),
        f.text('navigate', 'Header opens', 'Optional dashboard path, e.g. /lovelace/movie-room'),
      ] },
      { title: 'Lights & heat', icon: 'mdi:lightbulb-group', schema: [
        f.entities('lights', 'Lights', 'Tap to toggle, drag sideways to dim', 'light'),
        f.entities('climate', 'Thermostats', undefined, 'climate'),
      ] },
      { title: 'Sensors', icon: 'mdi:thermometer', open: false, schema: [
        f.grid(f.entity('temperature_entity', 'Temperature', 'Default: from the thermostat', 'sensor'), f.entity('humidity_entity', 'Humidity', 'Default: from the thermostat', 'sensor')),
        f.entities('occupancy', 'Occupancy / motion', 'Card glows while any are on', 'binary_sensor'),
      ] },
      { title: 'Other devices', icon: 'mdi:television', list: {
        key: 'entities',
        schema: [
          f.entity('entity', 'Entity'),
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.select('tap', 'Tap', [{ value: 'more', label: 'Show details' }, { value: 'toggle', label: 'Toggle' }], 'Default: show details'),
        ],
        label: (e, i) => e.name || e.entity || `Device ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add device',
      } },
    ];
  }
}

customElements.define('room-overview-card-editor', RoomOverviewCardEditor);
