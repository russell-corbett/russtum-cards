/**
 * Vehicles Card for Home Assistant
 *
 * A compact garage: one row per car with a small side-view drawing tinted to
 * the car's colour, its battery and/or fuel level as bars, the total range,
 * and little status badges (charging, plugged in, unlocked, door open, tyre
 * pressure, low fuel, washer fluid, away from home).
 *
 * Works out of the box with Kia/Hyundai cars (kia_uvo / hyundai_kia_connect):
 * every car device is found automatically and its entities matched by name.
 * Any other car works by listing its entities yourself.
 *
 * Configuration:
 *   type: custom:vehicles-card
 *   title: Garage                       # Optional
 *   vehicles:                           # Optional: default = every Kia/Hyundai car
 *     - device: <device id>             # Pick the car's device (or set the entities below)
 *       name: Tucson PHEV               # Optional: default = the car's model
 *       body: suv                       # crossover | suv | large_suv | sedan | hatchback | truck | van
 *       color: '#8a1c1c'                # Paint colour for the drawing
 *       image: /local/cars/tucson.png   # Optional: your own picture instead of the drawing
 *   image_size: 120                     # Width of photos in px (default 120; drawings stay compact)
 *       # Optional overrides (normally found from the device):
 *       battery: sensor.tucson_ev_battery_level
 *       fuel: sensor.tucson_fuel_level
 *       range: sensor.tucson_total_driving_range
 *       ev_range: sensor.tucson_ev_range
 *       charging: binary_sensor.tucson_ev_battery_charge
 *       plugged: binary_sensor.tucson_ev_battery_plug
 *       charge_time: sensor.tucson_estimated_charge_duration
 *       lock: lock.tucson_door_lock
 *       tracker: device_tracker.tucson_location
 *   low: 20                             # % at which a bar turns red (amber at twice this)
 *   hide_badges: false
 */

const VC_PLATFORMS = ['kia_uvo', 'hyundai_kia_connect'];
// Role → entity id suffix, matched inside the car's device. Order matters: first match wins.
const VC_ROLES = {
  battery: [/^sensor\..*_ev_battery_level$/],
  fuel: [/^sensor\..*_fuel_level$/],
  range: [/^sensor\..*_total_driving_range$/, /^sensor\..*_fuel_driving_range$/, /^sensor\..*_ev_range$/],
  ev_range: [/^sensor\..*_ev_range$/],
  fuel_range: [/^sensor\..*_fuel_driving_range$/],
  charging: [/^binary_sensor\..*_ev_battery_charge$/],
  plugged: [/^binary_sensor\..*_ev_battery_plug$/],
  charge_time: [/^sensor\..*_estimated_charge_duration$/],
  lock: [/^lock\..*_door_lock$/],
  tracker: [/^device_tracker\..*_location$/],
  engine: [/^binary_sensor\..*_engine$/],
  fuel_low: [/^binary_sensor\..*_fuel_low_level$/],
  tyres: [/^binary_sensor\..*_tire_pressure_all$/],
  washer: [/^binary_sensor\..*_washer_fluid_warning$/],
  doors: [/^binary_sensor\..*_(front|back)_(left|right)_door$/, /^binary_sensor\..*_(trunk|hood)$/],
  updated: [/^sensor\..*_last_updated_at$/],
};
const VC_MULTI = new Set(['doors']);
// Model name → body style for the drawing.
const VC_BODIES = [
  [/santa ?fe|palisade|telluride|sorento|carnival|ev9|ioniq ?9|tahoe|suburban|explorer|highlander|pilot|4runner|model x/i, 'large_suv'],
  [/tucson|sportage|rav ?4|cr-?v|cx-?5|rogue|escape|equinox|forester|outback|model y|santa cruz/i, 'suv'],
  [/kona|niro|seltos|soul|venue|ev ?6|ioniq ?5|bolt|id\.? ?4|mach|ev3|ev5|hr-?v|cx-?30/i, 'crossover'],
  [/ioniq ?6|elantra|sonata|k5|forte|stinger|k4|civic|accord|corolla|camry|model 3|model s|mazda ?3/i, 'sedan'],
  [/ioniq(?! ?\d)|i30|rio|golf|leaf|prius|accent/i, 'hatchback'],
  [/truck|f-?150|ranger|tacoma|silverado|sierra|ram|maverick|cybertruck/i, 'truck'],
  [/van|sienna|odyssey|pacifica|staria|transit|sprinter/i, 'van'],
];

// Original side-view silhouettes, facing right, in a 120×46 box. Wheels sit at x=28 and x=94.
const VC_ARCHES = 'L104,37 A10,10 0 0 0 84,37 L38,37 A10,10 0 0 0 18,37';
const VC_SHAPES = {
  crossover: {
    body: `M9,37 L8,26 Q8,19 14,17 L27,11.5 Q30,10.5 35,10.5 L71,10.5 Q76,10.5 79.5,13 L93,21.5 L108,23.5 Q115,24.5 115,30 L115,35 Q115,37 113,37 ${VC_ARCHES} Z`,
    glass: 'M16,22 L18,18 Q19,15.5 23,14.5 L33,13 L70,13 Q74,13 77,15 L89,22 Z',
    pillars: [52, 73], win: [13, 22],
  },
  suv: {
    body: `M8,37 L7,22 Q7,14.5 13,12.5 L24,9 Q27,8 31,8 L77,8 Q81,8 84,10.5 L97,19.5 L110,21.5 Q116,22.5 116,28 L116,35 Q116,37 114,37 ${VC_ARCHES} Z`,
    glass: 'M13,20 L15,14.5 Q16,12 20,11.5 L31,10.5 L76,10.5 Q79,10.5 81.5,12.5 L92,20 Z',
    pillars: [50, 74], win: [10.5, 20],
  },
  large_suv: {
    body: `M8,37 L7,13 Q7,7 13,7 L80,7 Q84,7 86.5,9.5 L98,19 L111,21 Q116,22 116,27 L116,35 Q116,37 114,37 ${VC_ARCHES} Z`,
    glass: 'M11,19.5 L11,12 Q11,10 14,10 L79,10 Q82,10 84,12 L93,19.5 Z',
    pillars: [36, 60, 78], win: [10, 19.5],
  },
  sedan: {
    body: `M6,37 L6,29 Q6,24.5 12,23.5 L25,22 L37,13.5 Q40,11.5 45,11.5 L69,11.5 Q74,11.5 78,14.5 L91,22.5 L110,24.5 Q116,25.5 116,30.5 L116,35 Q116,37 114,37 ${VC_ARCHES} Z`,
    glass: 'M29,22.5 L39,15.5 Q41.5,14 45,14 L68,14 Q72,14 75,16 L86,22.5 Z',
    pillars: [57], win: [14, 22.5],
  },
  hatchback: {
    body: `M9,37 L8,25 Q8,19 13,17 L24,12 Q28,10.5 34,10.5 L68,10.5 Q73,10.5 77,13.5 L91,22.5 L108,24.5 Q115,25.5 115,31 L115,35 Q115,37 113,37 ${VC_ARCHES} Z`,
    glass: 'M15,21.5 L17,17.5 Q18,15 22,14 L33,13 L67,13 Q71,13 74,15.5 L86,22.5 Z',
    pillars: [51], win: [13, 22.5],
  },
  truck: {
    body: `M5,37 L5,22 L60,22 L60,9.5 Q60,7.5 63,7.5 L82,7.5 Q85,7.5 87,10 L96,20 L110,21.5 Q116,22.5 116,28 L116,35 Q116,37 114,37 ${VC_ARCHES} Z`,
    glass: 'M64,19.5 L64,11.5 Q64,10 66,10 L81,10 Q83.5,10 85,12 L91.5,19.5 Z',
    pillars: [74], win: [10, 19.5],
  },
  van: {
    body: `M7,37 L6,12 Q6,6 12,6 L84,6 Q89,6 92,9 L102,19 L111,21 Q116,22 116,27 L116,35 Q116,37 114,37 ${VC_ARCHES} Z`,
    glass: 'M10,19 L10,11 Q10,9 13,9 L83,9 Q87,9 89.5,11.5 L97,19 Z',
    pillars: [32, 56, 80], win: [9, 19],
  },
};

const vcEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vcNum = (st) => { const n = parseFloat(st?.state); return Number.isFinite(n) ? n : null; };
const vcOn = (st) => st?.state === 'on';
// "TUCSON PHEV" → "Tucson PHEV"
const vcTitle = (s) => String(s || '').toLowerCase().replace(/\b[\w']+\b/g, (w) => (/^(p?h?ev|suv|gt|n|ev\d)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));

class VehiclesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-id]');
      if (row) this._moreInfo(row.dataset.id);
    });
  }

  setConfig(config) {
    this._config = { low: 20, ...config };
    this._lastHtml = null;
    this._resolvedFor = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._resolvedFor !== hass.entities) this._resolve();
    if (this._watched && this._prevStates && this._watched.every((id) => hass.states[id] === this._prevStates[id])) return;
    this._prevStates = Object.fromEntries((this._watched || []).map((id) => [id, hass.states[id]]));
    this._render();
  }

  _resolve() {
    const h = this._hass;
    const reg = h.entities || {};
    this._resolvedFor = h.entities;
    const byDevice = {};
    for (const [id, e] of Object.entries(reg)) if (e.device_id) (byDevice[e.device_id] ||= []).push(id);

    let list = this._config.vehicles;
    if (!Array.isArray(list) || !list.length) {
      const devs = new Set();
      for (const [id, e] of Object.entries(reg)) if (VC_PLATFORMS.includes(e.platform) && e.device_id && h.states[id]) devs.add(e.device_id);
      list = [...devs].map((device) => ({ device }));
    }

    this._cars = list.map((v) => {
      const dev = v.device ? h.devices?.[v.device] : null;
      const ids = (v.device && byDevice[v.device]) || [];
      const car = { cfg: v, roles: {} };
      for (const [role, pats] of Object.entries(VC_ROLES)) {
        if (v[role]) { car.roles[role] = VC_MULTI.has(role) ? [].concat(v[role]) : v[role]; continue; }
        if (VC_MULTI.has(role)) { car.roles[role] = ids.filter((id) => pats.some((p) => p.test(id))); continue; }
        for (const p of pats) { const hit = ids.find((id) => p.test(id) && !/_car_battery_level$/.test(id)); if (hit) { car.roles[role] = hit; break; } }
      }
      const model = dev?.model || dev?.name || '';
      car.name = v.name || dev?.name_by_user || vcTitle(model) || 'Car';
      car.body = VC_SHAPES[v.body] ? v.body : (VC_BODIES.find(([re]) => re.test(model + ' ' + car.name))?.[1] || 'suv');
      return car;
    });
    this._watched = this._cars.flatMap((c) => Object.values(c.roles).flat()).filter(Boolean);
    this._prevStates = null;
  }

  _art(car, charging) {
    const c = car.cfg;
    if (c.image) return `<div class="art photo"><img src="${vcEsc(c.image)}" alt="">${charging ? '<span class="bolt"><ha-icon icon="mdi:lightning-bolt"></ha-icon></span>' : ''}</div>`;
    const s = VC_SHAPES[car.body];
    const paint = vcEsc(c.color || 'var(--vc-paint)');
    const pillars = s.pillars.map((x) => `<rect x="${x}" y="${s.win[0]}" width="2.4" height="${s.win[1] - s.win[0]}" fill="${paint}"/>`).join('');
    return `<div class="art">
      <svg viewBox="0 0 120 46" aria-hidden="true">
        <ellipse cx="61" cy="43" rx="54" ry="2.6" class="shadow"/>
        <path d="${s.body}" fill="${paint}" class="body"/>
        <path d="${s.glass}" class="glass"/>
        ${pillars}
        <rect x="111" y="25" width="4.5" height="3" rx="1.2" class="head"/>
        <rect x="6.5" y="${car.body === 'sedan' ? 26 : 24}" width="3" height="4" rx="1" class="tail"/>
        <g class="wheel"><circle cx="28" cy="37" r="8"/><circle cx="28" cy="37" r="3.6" class="hub"/></g>
        <g class="wheel"><circle cx="94" cy="37" r="8"/><circle cx="94" cy="37" r="3.6" class="hub"/></g>
      </svg>
      ${charging ? '<span class="bolt"><ha-icon icon="mdi:lightning-bolt"></ha-icon></span>' : ''}
    </div>`;
  }

  _bar(kind, pct) {
    if (pct == null) return '';
    const low = this._config.low;
    const lvl = pct <= low ? 'crit' : pct <= low * 2 ? 'warn' : 'ok';
    return `<div class="bar ${kind} ${lvl}">
      <ha-icon icon="${kind === 'ev' ? 'mdi:battery-charging-high' : 'mdi:gas-station'}"></ha-icon>
      <div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
      <span class="pct">${Math.round(pct)}%</span>
    </div>`;
  }

  _row(car) {
    const h = this._hass;
    const st = (role) => (car.roles[role] ? h.states[car.roles[role]] : undefined);
    const ev = vcNum(st('battery'));
    const fuel = vcNum(st('fuel'));
    const rangeSt = st('range');
    const range = vcNum(rangeSt);
    const evRange = vcNum(st('ev_range'));
    const charging = vcOn(st('charging'));
    const plugged = vcOn(st('plugged'));
    const lock = st('lock');
    const tracker = st('tracker');

    const badges = [];
    const meta = [];
    if (charging) {
      const mins = vcNum(st('charge_time'));
      meta.push(`<span class="good">Charging${mins ? ` · ${mins >= 60 ? `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m` : `${Math.round(mins)} min`} left` : ''}</span>`);
    } else if (plugged) meta.push('<span>Plugged in</span>');
    if (vcOn(st('engine'))) meta.push('<span class="good">Running</span>');
    if (tracker && !['home', 'unknown', 'unavailable'].includes(tracker.state)) {
      const zone = tracker.state === 'not_home' ? 'Away' : (h.states[`zone.${tracker.state}`]?.attributes.friendly_name || vcTitle(tracker.state.replace(/_/g, ' ')));
      meta.push(`<span>${vcEsc(zone)}</span>`);
    }

    if (!this._config.hide_badges) {
      if (plugged && !charging) badges.push(['mdi:power-plug', '', 'Plugged in']);
      if (lock?.state === 'unlocked') badges.push(['mdi:lock-open-variant', 'warn', 'Unlocked']);
      if ((car.roles.doors || []).some((id) => vcOn(h.states[id]))) badges.push(['mdi:car-door', 'warn', 'Door, boot or bonnet open']);
      if (vcOn(st('tyres'))) badges.push(['mdi:car-tire-alert', 'warn', 'Tyre pressure']);
      if (vcOn(st('fuel_low'))) badges.push(['mdi:gas-station-off', 'warn', 'Low fuel']);
      if (vcOn(st('washer'))) badges.push(['mdi:wiper-wash-alert', 'warn', 'Washer fluid low']);
    }

    const unit = rangeSt?.attributes.unit_of_measurement || 'km';
    const phev = ev != null && fuel != null;
    const sub = phev && evRange != null ? `${Math.round(evRange)} ${vcEsc(unit)} electric` : '';
    const clickId = car.roles.range || car.roles.battery || car.roles.fuel || car.roles.lock;

    return `<div class="car${charging ? ' charging' : ''}"${clickId ? ` data-id="${vcEsc(clickId)}"` : ''}>
      ${this._art(car, charging)}
      <div class="main">
        <div class="top">
          <span class="name">${vcEsc(car.name)}</span>
          ${badges.map(([icon, cls, title]) => `<ha-icon class="badge ${cls}" icon="${icon}" title="${title}"></ha-icon>`).join('')}
        </div>
        <div class="bars">${this._bar('ev', ev)}${this._bar('fuel', fuel)}</div>
        ${meta.length ? `<div class="meta">${meta.join('<span class="dot">·</span>')}</div>` : ''}
      </div>
      <div class="range">
        ${range != null ? `<span class="val">${Math.round(range).toLocaleString()}</span><span class="unit">${vcEsc(unit)}</span>` : '<span class="unit">—</span>'}
        ${sub ? `<span class="sub">${sub}</span>` : ''}
      </div>
    </div>`;
  }

  _render() {
    if (!this._hass || !this._cars) return;
    const c = this._config;
    const body = this._cars.length
      ? this._cars.map((car) => this._row(car)).join('')
      : '<div class="empty">No cars found. Add them under <code>vehicles</code>.</div>';
    const html = `
      <style>
        :host { --vc-paint: #9aa4ae; ${Number(c.image_size) > 0 ? `--vc-img: ${Number(c.image_size)}px;` : ''} }
        ha-card { padding: 6px 0; overflow: hidden; }
        .title { padding: 8px 16px 2px; font-size: 1.05rem; font-weight: 500; color: var(--primary-text-color); }
        .car { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; padding: 8px 16px; cursor: pointer; }
        .car + .car { border-top: 1px solid var(--divider-color, rgba(127,127,127,.15)); }
        .car:hover { background: rgba(127,127,127,.06); }
        .art { position: relative; width: 76px; height: 30px; }
        .art.photo { width: var(--vc-img, 120px); height: calc(var(--vc-img, 120px) * .6); margin: -4px 0; }
        .art svg, .art img { width: 100%; height: 100%; display: block; object-fit: contain; }
        .body { stroke: rgba(0,0,0,.35); stroke-width: .7; }
        .glass { fill: #2a3540; opacity: .92; }
        .shadow { fill: rgba(0,0,0,.28); }
        .wheel circle { fill: #1d1f22; }
        .wheel .hub { fill: #8c939a; }
        .head { fill: #fff6d5; }
        .tail { fill: #d33; }
        .bolt { position: absolute; right: -4px; top: -6px; width: 16px; height: 16px; border-radius: 50%;
          background: var(--success-color, #4caf50); color: #fff; display: grid; place-items: center;
          animation: vc-pulse 1.6s ease-in-out infinite; }
        .bolt ha-icon { --mdc-icon-size: 12px; }
        @keyframes vc-pulse { 50% { box-shadow: 0 0 0 4px rgba(76,175,80,.25); } }
        .main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .name { font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .badge { --mdc-icon-size: 16px; color: var(--secondary-text-color); flex: none; }
        .badge.warn { color: var(--warning-color, #ff9800); }
        .badge.good { color: var(--success-color, #4caf50); }
        .bars { display: flex; gap: 10px; }
        .bar { display: flex; align-items: center; gap: 4px; flex: 1 1 0; min-width: 0; max-width: 150px; }
        .bar ha-icon { --mdc-icon-size: 14px; color: var(--secondary-text-color); flex: none; }
        .track { flex: 1; height: 6px; border-radius: 3px; background: rgba(127,127,127,.22); overflow: hidden; min-width: 24px; }
        .fill { height: 100%; border-radius: 3px; transition: width .4s; }
        .bar.ev .fill { background: var(--success-color, #4caf50); }
        .bar.fuel .fill { background: var(--info-color, #039be5); }
        .bar.warn .fill { background: var(--warning-color, #ff9800); }
        .bar.crit .fill { background: var(--error-color, #f44336); }
        .charging .bar.ev .fill { background-image: linear-gradient(90deg, transparent 0 40%, rgba(255,255,255,.45) 50%, transparent 60% 100%);
          background-size: 200% 100%; animation: vc-flow 1.8s linear infinite; }
        @keyframes vc-flow { from { background-position: 100% 0; } to { background-position: -100% 0; } }
        .pct { font-size: .8rem; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; min-width: 32px; }
        .meta { font-size: .78rem; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .meta .good { color: var(--success-color, #4caf50); }
        .dot { margin: 0 4px; opacity: .6; }
        .range { text-align: right; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
        .range .val { font-size: 1.35rem; font-weight: 500; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        .range .unit { font-size: .75rem; color: var(--secondary-text-color); }
        .range .sub { font-size: .7rem; color: var(--success-color, #4caf50); margin-top: 2px; white-space: nowrap; }
        .empty { padding: 12px 16px; color: var(--secondary-text-color); }
        @media (max-width: 380px) { .car { gap: 10px; } .art { width: 60px; height: 24px; } .art.photo { width: 88px; height: 53px; } }
      </style>
      <ha-card>
        ${c.title ? `<div class="title">${vcEsc(c.title)}</div>` : ''}
        ${body}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _moreInfo(id) {
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  getCardSize() { return 1 + (this._cars?.length || 2); }

  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('vehicles-card-editor');
  }

  static getStubConfig() { return {}; }
}

customElements.define('vehicles-card', VehiclesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'vehicles-card',
  name: 'Vehicles Card',
  description: 'A compact garage: each car with a small drawing, battery and fuel bars, range and status badges. Finds Kia/Hyundai cars automatically.',
  preview: false,
});

class VehiclesCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    const bodies = [
      { value: 'crossover', label: 'Crossover' }, { value: 'suv', label: 'SUV' }, { value: 'large_suv', label: 'Large SUV' },
      { value: 'sedan', label: 'Sedan' }, { value: 'hatchback', label: 'Hatchback' }, { value: 'truck', label: 'Pickup truck' }, { value: 'van', label: 'Van' },
    ];
    return [
      { title: 'Card', icon: 'mdi:car-multiple', schema: [
        f.text('title', 'Title'),
        f.grid(f.number('low', 'Low level', { min: 5, max: 50, unit: '%', helper: 'Bars turn red at this level, amber at twice it' }), f.toggle('hide_badges', 'Hide status badges')),
      ] },
      { title: 'Cars', icon: 'mdi:car', list: {
        key: 'vehicles',
        schema: [
          f.device('device', 'Car', undefined, 'Leave empty to list every Kia/Hyundai car'),
          f.grid(f.text('name', 'Name', 'Default: the model'), f.select('body', 'Body style', bodies, 'Default: guessed from the model')),
          f.grid(f.text('color', 'Paint colour', 'e.g. #8a1c1c or silver'), f.text('image', 'Picture URL', 'Optional, replaces the drawing')),
          f.grid(f.entity('battery', 'Battery level', '', 'sensor'), f.entity('fuel', 'Fuel level', '', 'sensor')),
          f.grid(f.entity('range', 'Range', '', 'sensor'), f.entity('lock', 'Lock', '', 'lock')),
          f.grid(f.entity('charging', 'Charging', '', 'binary_sensor'), f.entity('tracker', 'Location', '', 'device_tracker')),
        ],
        label: (v, i) => v.name || `Car ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add car',
        collapsible: true,
      } },
    ];
  }
}

customElements.define('vehicles-card-editor', VehiclesCardEditor);
