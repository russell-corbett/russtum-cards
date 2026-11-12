/**
 * Climate Overview Card for Home Assistant
 *
 * Every thermostat in the house (or one floor) on one compact card: each
 * room's temperature against its setpoint, colour-coded when it's well over
 * or under, a flame while it's heating, and rooms grouped by floor.
 * Thermostats are found automatically and grouped using HA's floors and areas.
 *
 * Configuration:
 *   type: custom:climate-overview-card
 *   title: Climate                  # Optional (defaults to the floor's name)
 *   integration: mysa               # Optional: only thermostats from this integration
 *   floor: main_floor               # Optional: just this floor (HA floor id)
 *   exclude: [climate.garage_thermostat]
 *   entities:                       # Optional: pick thermostats by hand instead
 *     - entity: climate.family_room_thermostat
 *       name: Family Room
 *   tolerance: 1.5                  # °C (or °F) off target before a room turns red/blue
 *   ignore_below: 12                # Setpoints under this are frost protection — never flagged hot (default 12)
 *   columns: 3                      # Optional: tiles per row (default: as many as fit)
 *   hide_off: false                 # Hide thermostats that are off
 *   hide_summary: false             # Hide the heating count / furthest-off room line
 *
 *   # Plain temperature sensors (motion, leak, multi-sensors) as a row under each floor.
 *   # Found automatically: sensor-only devices in an area on that floor. Thermostats,
 *   # cars, printers, NAS and weather sensors are left out.
 *   sensors:                        # Optional: pick them by hand instead
 *     - entity: sensor.server_room_motion_temperature
 *       name: Server Room
 *   exclude_sensors: [sensor.garage_motion_temperature]
 *   hide_sensors: false             # No sensor row at all
 */

const CO_ORDER = { upstairs: 0, main_floor: 1, basement: 2 };
const coEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const coList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// A room sensor device only has passive entities (no thermostat, light, camera, car…)…
const CO_PASSIVE = new Set(['sensor', 'binary_sensor', 'event', 'button', 'update', 'number', 'select']);
// …and senses the room: a motion/leak/door-type sensor or a humidity reading. This keeps out a NAS's system temperature.
const CO_ROOM_BINARY = new Set(['motion', 'occupancy', 'presence', 'moisture', 'door', 'window', 'opening', 'garage_door', 'vibration', 'smoke', 'gas', 'carbon_monoxide', 'cold', 'heat']);

class ClimateOverviewCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
    this._pending = {};
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = {
      tolerance: 1.5, ...config,
      exclude: coList(config.exclude),
      entities: coList(config.entities).map((e) => (typeof e === 'string' ? { entity: e } : e)).filter((e) => e?.entity),
      sensors: coList(config.sensors).map((e) => (typeof e === 'string' ? { entity: e } : e)).filter((e) => e?.entity),
      exclude_sensors: coList(config.exclude_sensors),
    };
    this._resolvedFor = null;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._ids.some((id) => hass.states[id] !== old.states[id])) return;
    for (const [id, v] of Object.entries(this._pending)) {
      if (!id.endsWith(':t') && Number(hass.states[id]?.attributes?.temperature) === v && !this._pending[`${id}:t`]) delete this._pending[id];
    }
    this._render();
  }

  // Work out which thermostats to show and which floor each belongs to.
  _resolve() {
    const h = this._hass, c = this._config;
    this._resolvedFor = h.entities;
    const reg = h.entities || {};
    let ids;
    if (c.entities.length) ids = c.entities.map((e) => e.entity);
    else {
      ids = Object.keys(h.states).filter((id) => id.startsWith('climate.')
        && (!c.integration || reg[id]?.platform === c.integration)
        && h.states[id].attributes.current_temperature != null
        && !reg[id]?.hidden && !reg[id]?.entity_category);
    }
    ids = ids.filter((id) => !c.exclude.includes(id));

    const floors = h.floors || {};
    const areaOf = (id) => reg[id]?.area_id || h.devices?.[reg[id]?.device_id]?.area_id || null;
    this._rooms = ids.map((id) => {
      const area = areaOf(id);
      const floorId = area ? h.areas?.[area]?.floor_id || null : null;
      return { id, area, floorId };
    }).filter((r) => !c.floor || r.floorId === c.floor);
    this._sensors = c.hide_sensors ? [] : this._findSensors(areaOf)
      .filter((x) => !c.floor || x.floorId === c.floor);
    this._ids = [...this._rooms.map((r) => r.id), ...this._sensors.flatMap((x) => [x.id, x.hum]).filter(Boolean)];

    // Floors in building order: HA floor level (top first), then a sensible default.
    const levelOf = (f) => (floors[f]?.level != null ? -floors[f].level : CO_ORDER[f] ?? 50);
    this._floorOrder = [...new Set([...this._rooms.map((r) => r.floorId), ...this._sensors.map((x) => x.floorId)])]
      .sort((a, b) => (a == null) - (b == null) || levelOf(a) - levelOf(b));
  }

  // Temperature sensors that aren't thermostats: by hand, or every sensor-only device on a floor.
  _findSensors(areaOf) {
    const h = this._hass, c = this._config, reg = h.entities || {};
    const byDevice = {};
    for (const [id, e] of Object.entries(reg)) if (e.device_id) (byDevice[e.device_id] ||= []).push(id);
    const dc = (id) => h.states[id]?.attributes?.device_class;
    const humOf = (id) => (byDevice[reg[id]?.device_id] || []).find((x) => x.startsWith('sensor.') && dc(x) === 'humidity' && !reg[x]?.hidden) || null;
    const floorOf = (id) => { const a = areaOf(id); return a ? h.areas?.[a]?.floor_id || null : null; };

    let picked;
    if (c.sensors.length) picked = c.sensors.map((e) => ({ id: e.entity, name: e.name }));
    else {
      picked = Object.keys(reg).filter((id) => {
        if (!id.startsWith('sensor.') || dc(id) !== 'temperature') return false;
        const e = reg[id];
        if (e.hidden || e.entity_category || !e.device_id || !floorOf(id)) return false;
        const sib = byDevice[e.device_id] || [];
        return sib.every((x) => CO_PASSIVE.has(x.split('.')[0]))
          && sib.some((x) => (x.startsWith('binary_sensor.') && CO_ROOM_BINARY.has(dc(x))) || (x.startsWith('sensor.') && dc(x) === 'humidity'));
      }).map((id) => ({ id }));
    }
    return picked.filter((x) => !c.exclude_sensors.includes(x.id) && h.states[x.id])
      .map((x) => ({ ...x, floorId: floorOf(x.id), hum: humOf(x.id) }));
  }

  _sensorName(x) {
    if (x.name) return x.name;
    const floors = this._hass.floors || {};
    let n = String(this._hass.states[x.id]?.attributes?.friendly_name || x.id)
      .replace(/\s*(motion|leak|water|contact|door|window|multipurpose|multi|climate|environment|temp)?\s*(sensor)?\s*temperature$/i, '').trim();
    // "Basement Bathroom" under Basement → "Bathroom"
    const fn = floors[x.floorId]?.name || String(x.floorId || '').replace(/_/g, ' ');
    if (fn && n.toLowerCase().startsWith(fn.toLowerCase() + ' ')) n = n.slice(fn.length + 1);
    return n || x.id;
  }

  _sensorRow(list) {
    if (!list.length) return '';
    const chips = list.map((x) => ({ ...x, n: this._sensorName(x) })).sort((a, b) => a.n.localeCompare(b.n)).map((x) => {
      const st = this._hass.states[x.id];
      const v = parseFloat(st?.state);
      const ok = Number.isFinite(v);
      const hum = x.hum ? parseFloat(this._hass.states[x.hum]?.state) : NaN;
      return `<span class="sen ${ok ? '' : 'na'}" data-act="more" data-e="${coEsc(x.id)}" title="${coEsc(x.n)}">
        <span class="sn">${coEsc(x.n)}</span><b>${ok ? v.toFixed(1) : '—'}°</b>${Number.isFinite(hum) ? `<span class="sh">${Math.round(hum)}%</span>` : ''}</span>`;
    }).join('');
    return `<div class="sens"><ha-icon icon="mdi:thermometer"></ha-icon>${chips}</div>`;
  }

  _name(id) {
    const custom = this._config.entities.find((e) => e.entity === id)?.name;
    if (custom) return custom;
    const s = this._hass.states[id];
    return String(s?.attributes?.friendly_name || id).replace(/\s*(thermostat|climate|heater|heating)$/i, '').trim() || id;
  }

  _room(r) {
    const s = this._hass.states[r.id];
    const tol = Number(this._config.tolerance) || 1.5;
    if (!s || s.state === 'unavailable') {
      return { ...r, name: this._name(r.id), html: `<div class="room na" data-act="more" data-e="${coEsc(r.id)}">
        <div class="rn">${coEsc(this._name(r.id))}</div><div class="rt">—</div><div class="rs">Offline</div></div>` };
    }
    const a = s.attributes;
    const off = s.state === 'off';
    const cur = a.current_temperature != null ? Number(a.current_temperature) : null;
    const target = this._pending[r.id] ?? (a.temperature != null ? Number(a.temperature) : null);
    const heating = a.hvac_action === 'heating', cooling = a.hvac_action === 'cooling';
    const delta = !off && cur != null && target != null ? Math.round((cur - target) * 10) / 10 : null;
    // A low setpoint is frost protection (a garage at 5°): being warmer than that isn't a problem.
    const frost = target != null && target < (Number(this._config.ignore_below ?? 12));
    const band = delta == null ? '' : delta >= tol && !frost ? 'hot' : delta <= -tol ? 'cold' : 'ok';
    const step = a.target_temp_step || 0.5;
    const unit = (a.temperature_unit || this._hass.config?.unit_system?.temperature || '°').replace(/[CF]$/, '');
    const hum = a.current_humidity != null ? Math.round(a.current_humidity) : null;
    const fmt = (v) => (v == null ? '—' : v.toFixed(1));
    const html = `
      <div class="room ${band} ${off ? 'off' : ''} ${heating ? 'heating' : ''} ${cooling ? 'cooling' : ''}" data-act="more" data-e="${coEsc(r.id)}"
           title="${coEsc(this._name(r.id))}${delta != null ? ` · ${delta > 0 ? '+' : ''}${delta}° from target` : ''}">
        <div class="rh">
          <span class="rn">${coEsc(this._name(r.id))}</span>
          ${heating ? '<ha-icon class="flame" icon="mdi:fire"></ha-icon>' : cooling ? '<ha-icon class="flake" icon="mdi:snowflake"></ha-icon>' : ''}
        </div>
        <div class="rt">${fmt(cur)}<small>${unit}</small></div>
        <div class="rs">
          ${off ? `<span>Off</span>${hum != null ? `<span class="hum">${hum}%</span>` : ''}`
            : `<span class="set">
                 <button data-act="temp" data-e="${coEsc(r.id)}" data-d="${-step}" title="Lower">−</button>
                 <b class="${this._pending[r.id] != null ? 'pend' : ''}">${target != null ? target.toFixed(step < 1 ? 1 : 0) : '—'}°</b>
                 <button data-act="temp" data-e="${coEsc(r.id)}" data-d="${step}" title="Raise">+</button>
               </span>
               ${delta != null && band !== 'ok' ? `<span class="delta">${delta > 0 ? '+' : ''}${delta.toFixed(1)}°</span>` : ''}`}
        </div>
      </div>`;
    return { ...r, name: this._name(r.id), html, cur, delta: band === 'ok' ? 0 : delta, heating, off };
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = '<ha-card></ha-card>'; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;
    const rooms = this._rooms.map((r) => this._room(r)).filter((r) => !c.hide_off || !r.off);
    const floors = this._hass.floors || {};
    const floorName = (f) => floors[f]?.name || (f ? f.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Other');
    const groups = this._floorOrder.map((f) => ({ f, rooms: rooms.filter((r) => r.floorId === f), sens: this._sensors.filter((x) => x.floorId === f) }))
      .filter((g) => g.rooms.length || g.sens.length);
    const single = groups.length <= 1;
    const title = c.title ?? (c.floor ? floorName(c.floor) : 'Climate');

    // Summary: how many are heating, plus the room furthest from its target.
    const on = rooms.filter((r) => !r.off && r.cur != null);
    const heatingN = rooms.filter((r) => r.heating).length;
    const avg = on.length ? on.reduce((t, r) => t + r.cur, 0) / on.length : null;
    const worst = rooms.filter((r) => r.delta != null && Math.abs(r.delta) >= (Number(c.tolerance) || 1.5))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const summary = [
      heatingN ? `<span class="heat"><ha-icon icon="mdi:fire"></ha-icon>${heatingN} heating</span>` : '<span>None heating</span>',
      avg != null ? `<span>Avg ${avg.toFixed(1)}°</span>` : '',
      worst ? `<span class="${worst.delta > 0 ? 'hotc' : 'coldc'}" data-act="more" data-e="${coEsc(worst.id)}">${coEsc(worst.name)} ${worst.delta > 0 ? '+' : ''}${worst.delta.toFixed(1)}°</span>` : '',
    ].filter(Boolean).join('');

    const cols = Number(c.columns) > 0 ? `repeat(${Number(c.columns)}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(118px, 1fr))';
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; }
        .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0 2px 10px; }
        .title { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); margin-right: auto; }
        .sum { display: flex; gap: 10px; flex-wrap: wrap; font-size: .8em; color: var(--secondary-text-color); --mdc-icon-size: 14px; }
        .sum span { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
        .sum .heat { color: var(--state-climate-heat-color, #ff8100); font-weight: 600; }
        .sum .hotc { color: var(--error-color, #f44336); font-weight: 600; cursor: pointer; }
        .sum .coldc { color: var(--info-color, #2196f3); font-weight: 600; cursor: pointer; }
        .floor { font-size: .72em; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); margin: 12px 2px 6px; }
        .floor:first-of-type { margin-top: 0; }
        .grid { display: grid; grid-template-columns: ${cols}; gap: 6px; }
        .room { position: relative; padding: 8px 10px 7px; border-radius: 12px; cursor: pointer; min-width: 0; box-sizing: border-box;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); border: 1px solid transparent; }
        .room:hover { border-color: rgba(127,127,127,.25); }
        .rh { display: flex; align-items: center; gap: 4px; --mdc-icon-size: 14px; }
        .rn { flex: 1; min-width: 0; font-size: .78em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .flame { color: var(--state-climate-heat-color, #ff8100); animation: flick 1.6s ease-in-out infinite; }
        .flake { color: var(--state-climate-cool-color, #2196f3); }
        @keyframes flick { 50% { opacity: .55; } }
        .rt { font-size: 1.45em; font-weight: 700; line-height: 1.2; color: var(--primary-text-color); font-variant-numeric: tabular-nums; margin: 2px 0 1px; }
        .rt small { font-size: .5em; font-weight: 500; color: var(--secondary-text-color); margin-left: 1px; }
        .rs { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: .74em; color: var(--secondary-text-color); min-height: 22px; }
        .set { display: inline-flex; align-items: center; border-radius: 8px; background: rgba(127,127,127,.12); }
        .set button { width: 20px; height: 22px; border: none; background: none; cursor: pointer; color: var(--secondary-text-color); font-size: 1.15em; line-height: 1; padding: 0; border-radius: 6px; }
        .set button:hover { color: var(--primary-text-color); background: rgba(127,127,127,.2); }
        .set b { min-width: 30px; text-align: center; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        .set b.pend { color: var(--primary-color, #03a9f4); }
        .delta { font-weight: 700; }

        .room.heating { background: linear-gradient(0deg, rgba(255,129,0,.10), rgba(255,129,0,.10)), var(--secondary-background-color, rgba(127,127,127,.08)); }
        .room.hot { border-color: rgba(244,67,54,.45); background: linear-gradient(0deg, rgba(244,67,54,.12), rgba(244,67,54,.12)), var(--secondary-background-color, rgba(127,127,127,.08)); }
        .room.hot .rt, .room.hot .delta { color: var(--error-color, #f44336); }
        .room.cold { border-color: rgba(33,150,243,.45); background: linear-gradient(0deg, rgba(33,150,243,.12), rgba(33,150,243,.12)), var(--secondary-background-color, rgba(127,127,127,.08)); }
        .room.cold .rt, .room.cold .delta { color: var(--info-color, #2196f3); }
        .room.off .rt { color: var(--secondary-text-color); font-weight: 600; }
        .room.na { opacity: .5; }
        .empty { padding: 12px 2px; color: var(--secondary-text-color); font-size: .9em; }
        .sens { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 6px; font-size: .74em; color: var(--secondary-text-color); --mdc-icon-size: 14px; }
        .grid + .sens { margin-top: 6px; }
        .sens > ha-icon { opacity: .7; margin-right: -2px; }
        .sen { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 8px; border-radius: 10px; cursor: pointer; white-space: nowrap;
               background: rgba(127,127,127,.10); }
        .sen:hover { background: rgba(127,127,127,.2); }
        .sen b { color: var(--primary-text-color); font-weight: 600; font-variant-numeric: tabular-nums; }
        .sen .sh { opacity: .8; }
        .sen.na { opacity: .5; }
      </style>
      <ha-card>
        ${title || (!c.hide_summary && rooms.length) ? `<div class="head">${title ? `<div class="title">${coEsc(title)}</div>` : ''}${!c.hide_summary && rooms.length ? `<div class="sum">${summary}</div>` : ''}</div>` : ''}
        ${!groups.length ? '<div class="empty">No thermostats found.</div>' : ''}
        ${groups.map((g) => `${single ? '' : `<div class="floor">${coEsc(floorName(g.f))}</div>`}${g.rooms.length ? `<div class="grid">${g.rooms.map((r) => r.html).join('')}</div>` : ''}${this._sensorRow(g.sens)}`).join('')}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    ev.stopPropagation();
    const id = el.dataset.e;
    if (el.dataset.act === 'more') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
    } else if (el.dataset.act === 'temp') {
      // Batch quick taps into one service call.
      const a = this._hass.states[id].attributes;
      const cur = this._pending[id] ?? Number(a.temperature);
      this._pending[id] = Math.min(a.max_temp ?? 35, Math.max(a.min_temp ?? 5, Math.round((cur + Number(el.dataset.d)) * 10) / 10));
      clearTimeout(this._pending[`${id}:t`]);
      this._pending[`${id}:t`] = setTimeout(() => {
        delete this._pending[`${id}:t`];
        this._hass.callService('climate', 'set_temperature', { entity_id: id, temperature: this._pending[id] });
        setTimeout(() => { delete this._pending[id]; this._lastHtml = null; this._render(); }, 8000);
      }, 900);
      this._render();
    }
  }

  getCardSize() { return 1 + Math.ceil((this._ids?.length || 6) / 3) * 2; }

  getGridOptions() { return { columns: 12, min_columns: 4 }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('climate-overview-card-editor');
  }

  static getStubConfig() { return { title: 'Climate' }; }
}

customElements.define('climate-overview-card', ClimateOverviewCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'climate-overview-card',
  name: 'Climate Overview Card',
  description: 'Every thermostat at a glance, by floor: temperature vs setpoint, heating, and rooms too hot or cold.',
  preview: false,
});

class ClimateOverviewCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:thermostat', schema: [
        f.text('title', 'Title', 'Default: the floor name, or "Climate"'),
        f.grid(
          { name: 'floor', label: 'Floor', helper: 'Default: every floor', selector: { floor: {} } },
          { name: 'integration', label: 'Integration', helper: 'Only thermostats from this integration', selector: { text: {} } },
        ),
        f.grid(
          f.number('tolerance', 'Flag rooms off target by', { min: 0.5, step: 0.5, unit: '°', helper: 'Default: 1.5' }),
          f.number('columns', 'Tiles per row', { min: 1, max: 8, helper: 'Default: as many as fit' }),
        ),
        f.number('ignore_below', 'Never flag hot when the setpoint is under', { min: 0, max: 30, unit: '°', helper: 'Frost-protection setpoints. Default: 12' }),
        f.grid(f.toggle('hide_off', 'Hide thermostats that are off'), f.toggle('hide_summary', 'Hide the summary line')),
        f.entities('exclude', 'Hide thermostats', '', 'climate'),
      ] },
      { title: 'Temperature sensors', icon: 'mdi:thermometer', open: false, schema: [
        f.toggle('hide_sensors', 'Hide the sensor row', 'By default, motion, leak and other sensor-only devices with a temperature are listed under their floor'),
        f.entities('exclude_sensors', 'Leave out these sensors', '', 'sensor'),
      ] },
      { title: 'Pick sensors by hand', icon: 'mdi:format-list-checks', open: false, list: {
        key: 'sensors',
        schema: [f.grid(f.entity('entity', 'Temperature sensor', '', 'sensor'), f.text('name', 'Name'))],
        label: (e, i) => e.name || e.entity || `Sensor ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add sensor',
      } },
      { title: 'Pick thermostats by hand', icon: 'mdi:format-list-checks', open: false, list: {
        key: 'entities',
        schema: [f.grid(f.entity('entity', 'Thermostat', '', 'climate'), f.text('name', 'Name'))],
        label: (e, i) => e.name || e.entity || `Thermostat ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add thermostat',
      } },
    ];
  }
}

customElements.define('climate-overview-card-editor', ClimateOverviewCardEditor);
