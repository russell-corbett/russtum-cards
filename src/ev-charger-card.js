/**
 * EV Charger Card for Home Assistant
 *
 * The home charger and the car on one card: a charger → car link that
 * animates while energy flows, the car's battery with its charge limit,
 * when it will be full, and power / energy today / energy this month /
 * current limit tiles. Works with any charger (Emporia, Wallbox, OpenEVSE…)
 * and any car integration that exposes a battery level.
 *
 * Configuration:
 *   type: custom:ev-charger-card
 *   title: Home Charger
 *   charger_entity: switch.corbett_ev               # Enable/disable switch (tap the power button)
 *   status_entity: sensor.garage_corbett_ev_status  # Optional text status
 *   power_entity: sensor.corbett_ev_power_minute_average
 *   energy_today_entity: sensor.corbett_ev_energy_today
 *   energy_month_entity: sensor.corbett_ev_energy_this_month
 *   current_limit_entity: number.garage_corbett_ev_current_limit   # +/- buttons
 *   charging_threshold: 50                          # W above which it counts as charging (default 50)
 *
 *   vehicle_name: Kona EV
 *   battery_entity: sensor.kona_ev_ev_battery_level
 *   range_entity: sensor.kona_ev_ev_range
 *   charge_limit_entity: number.kona_ev_ac_charging_limit
 *   charging_entity: binary_sensor.kona_ev_ev_battery_charge
 *   plug_entity: binary_sensor.kona_ev_ev_battery_plug
 *   completion_entity: sensor.kona_charge_completed_time
 *   duration_entity: sensor.kona_ev_estimated_charge_duration
 *   location_entity: device_tracker.kona_ev_location   # Optional: tells home from public charging
 *   vehicle_power_entity: sensor.garage_kona_ev_ev_charging_power   # Optional: kW shown when charging away
 *
 * When the car reports charging (or plugged in) but the home charger isn't
 * delivering power — because the car is away from home or the home charger
 * says no car is connected — the card shows "Charging away" with the
 * location instead of pretending the home charger is in use.
 */

const EV_KEYS = ['charger_entity', 'status_entity', 'power_entity', 'energy_today_entity', 'energy_month_entity',
  'current_limit_entity', 'battery_entity', 'range_entity', 'charge_limit_entity', 'charging_entity', 'plug_entity',
  'completion_entity', 'duration_entity', 'location_entity', 'vehicle_power_entity'];

const evEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function evDur(min) {
  if (min == null || isNaN(min) || min <= 0) return '';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function evWhen(d) {
  if (!d || isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return diff === 0 ? `today at ${t}` : diff === 1 ? `tomorrow at ${t}` : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}

class EvChargerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._watched = EV_KEYS.map((k) => config[k]).filter(Boolean);
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  _st(key) {
    const id = this._config[key];
    const s = id && this._hass?.states[id];
    return s && s.state !== 'unavailable' && s.state !== 'unknown' ? s : null;
  }

  _num(key) {
    const v = parseFloat(this._st(key)?.state);
    return isNaN(v) ? null : v;
  }

  // Power in watts whatever unit the sensor reports.
  _watts() {
    const s = this._st('power_entity');
    const v = parseFloat(s?.state);
    if (isNaN(v)) return null;
    return s.attributes.unit_of_measurement === 'kW' ? v * 1000 : v;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const charger = this._st('charger_entity');
    const enabled = charger ? charger.state === 'on' : true;
    const statusText = this._st('status_entity')?.state || charger?.attributes?.status || '';
    const detail = charger?.attributes?.icon_detail_text || '';
    const watts = this._watts();
    const threshold = cfg.charging_threshold ?? 50;

    const carCharging = this._st('charging_entity')?.state === 'on';
    const carPlugged = this._st('plug_entity')?.state === 'on';
    const homeFlowing = watts != null && watts > threshold;
    const homeConnected = /connect|plug|charg/i.test(statusText) && !/dis|not/i.test(statusText);
    const homeEmpty = /disconnect|not ?connected/i.test(statusText) || charger?.attributes?.icon_name === 'CarNotConnected';

    // Is the car on someone else's charger? The car says it's plugged in or
    // charging, but the home charger isn't delivering and either the car is
    // away from home or the home charger says nothing is connected.
    const loc = this._st('location_entity');
    const carAway = loc ? loc.state !== 'home' : false;
    const knowsWhere = !!loc || !!statusText || !!charger?.attributes?.icon_name;
    const away = (carCharging || carPlugged) && !homeFlowing
      && (carAway || homeEmpty || (!knowsWhere && carCharging && watts != null));
    const place = away && loc && !['not_home', 'home'].includes(loc.state) ? loc.state : '';

    const charging = carCharging || homeFlowing;
    const plugged = charging || carPlugged || homeConnected;

    const soc = this._num('battery_entity');
    const limit = this._num('charge_limit_entity');
    const range = this._st('range_entity');
    const completion = this._st('completion_entity') ? new Date(this._st('completion_entity').state) : null;
    const durMin = this._num('duration_entity');

    const state = away ? (charging ? 'charging' : 'plugged') : !enabled ? 'off' : charging ? 'charging' : plugged ? 'plugged' : 'idle';
    const pill = away
      ? (charging ? 'Charging away' : 'Plugged in away')
      : { off: 'Charger off', charging: 'Charging', plugged: 'Plugged in', idle: 'Not connected' }[state];

    let note = '';
    if (charging) {
      const parts = [];
      if (completion && !isNaN(completion) && completion > Date.now()) parts.push(`Full ${evWhen(completion)}`);
      if (durMin) parts.push(`${evDur(durMin)} to go`);
      if (away) parts.unshift(place ? `At ${place}` : 'Away from home');
      note = parts.join(' · ') || 'Charging';
    } else if (plugged) {
      note = soc != null && limit != null && soc >= limit ? 'Charged to its limit' : 'Plugged in, not charging';
      if (away) note = `${place ? `At ${place}` : 'Away from home'} · ${note.charAt(0).toLowerCase()}${note.slice(1)}`;
    } else {
      note = detail || (enabled ? 'Ready — plug in to charge' : 'Charging is turned off');
    }

    const fmtW = (w) => (w != null ? (w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`) : '—');
    const kw = fmtW(watts);
    let flowW = watts;
    if (away) {
      const vp = this._st('vehicle_power_entity');
      const v = parseFloat(vp?.state);
      flowW = isNaN(v) ? null : (/^kW$/i.test(vp.attributes.unit_of_measurement || 'kW') ? v * 1000 : v);
    }
    const flowKw = fmtW(flowW);
    const energy = (key) => {
      const s = this._st(key);
      const v = parseFloat(s?.state);
      return isNaN(v) ? '—' : `${v >= 100 ? Math.round(v) : v.toFixed(1)} <small>${evEsc(s.attributes.unit_of_measurement || 'kWh')}</small>`;
    };
    const lim = this._st('current_limit_entity');
    const amps = lim ? parseFloat(lim.state) : charger?.attributes?.charging_rate;
    const socColor = soc == null ? 'var(--disabled-text-color,#9e9e9e)' : soc <= 15 ? 'var(--error-color,#f44336)'
      : soc <= 30 ? 'var(--warning-color,#ff9800)' : 'var(--success-color,#4caf50)';

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .head { display: flex; align-items: center; gap: 10px; }
        .title { flex: 1; min-width: 0; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pill { font-size: .78em; font-weight: 600; padding: 4px 10px; border-radius: 12px; white-space: nowrap; }
        .s-charging .pill { background: rgba(76,175,80,.16); color: var(--success-color,#4caf50); }
        .s-plugged .pill  { background: rgba(3,169,244,.16); color: var(--primary-color,#03a9f4); }
        .s-idle .pill, .s-off .pill { background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .pwr { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%; line-height: 0; --mdc-icon-size: 20px;
               color: var(--secondary-text-color); }
        .pwr.on { color: var(--success-color,#4caf50); }
        .pwr:hover { background: rgba(127,127,127,.18); }

        .flow { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; }
        .node { width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
                background: var(--secondary-background-color); color: var(--secondary-text-color); --mdc-icon-size: 28px; cursor: pointer; }
        .s-charging .node { background: rgba(76,175,80,.16); color: var(--success-color,#4caf50); }
        .s-plugged .node  { background: rgba(3,169,244,.14); color: var(--primary-color,#03a9f4); }
        .cable { position: relative; flex: 1; height: 6px; border-radius: 3px; overflow: hidden; }
        .s-idle .cable, .s-off .cable { background: repeating-linear-gradient(90deg, rgba(127,127,127,.35) 0 6px, transparent 6px 12px); height: 2px; }
        .s-plugged .cable  { background: rgba(3,169,244,.35); }
        .s-charging .cable { background: rgba(76,175,80,.25); }
        .s-charging .cable::after { content: ''; position: absolute; inset: 0;
          background: repeating-linear-gradient(90deg, transparent 0 14px, var(--success-color,#4caf50) 14px 22px, transparent 22px 36px);
          background-size: 36px 100%; animation: flow .9s linear infinite; }
        @keyframes flow { from { background-position: 0 0; } to { background-position: 36px 0; } }
        .kw { position: absolute; left: 50%; top: -20px; transform: translateX(-50%); font-size: .78em; font-weight: 700; color: var(--success-color,#4caf50); }
        .mid { position: relative; flex: 1; display: flex; align-items: center; }
        .where { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); max-width: 100%; font-size: .72em; color: var(--secondary-text-color);
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .away .tiles { opacity: .6; }
        .car { display: flex; align-items: center; gap: 10px; flex-shrink: 0; cursor: pointer; }
        .carname { font-size: .9em; font-weight: 600; color: var(--primary-text-color); }
        .carsub { font-size: .78em; color: var(--secondary-text-color); }

        .batt { position: relative; height: 26px; border-radius: 8px; background: var(--secondary-background-color, rgba(127,127,127,.12));
                overflow: hidden; cursor: pointer; }
        .bfill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 8px; transition: width .8s ease; }
        .s-charging .bfill::after { content: ''; position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); background-size: 40% 100%;
          background-repeat: no-repeat; animation: shine 2s ease-in-out infinite; }
        @keyframes shine { from { background-position: -40% 0; } to { background-position: 140% 0; } }
        .btxt { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-weight: 700; font-size: .9em; color: #fff;
                text-shadow: 0 1px 2px rgba(0,0,0,.5); }
        .limit { position: absolute; top: 3px; bottom: 3px; width: 2px; background: var(--primary-text-color); opacity: .55; border-radius: 1px; }
        .nt { flex: 1; min-width: 0; }
        .lim { flex-shrink: 0; font-size: .9em; }
        .note { display: flex; align-items: center; gap: 6px; margin: 8px 2px 0; font-size: .85em; color: var(--secondary-text-color); --mdc-icon-size: 16px; }
        .s-charging .note { color: var(--primary-text-color); }

        .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; margin-top: 14px; }
        .tile { border-radius: 10px; padding: 9px 6px 8px; text-align: center; background: var(--secondary-background-color, rgba(127,127,127,.08));
                cursor: pointer; min-width: 0; }
        .tv { font-size: 1.05em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; }
        .tv small { font-size: .7em; font-weight: 500; color: var(--secondary-text-color); }
        .tk { font-size: .66em; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); margin-top: 2px; }
        .amp { display: flex; align-items: center; justify-content: center; gap: 2px; }
        .amp button { background: none; border: none; cursor: pointer; padding: 2px; border-radius: 50%; line-height: 0; color: var(--secondary-text-color); --mdc-icon-size: 16px; }
        .amp button:hover { background: rgba(127,127,127,.2); color: var(--primary-text-color); }
      </style>
      <ha-card class="s-${state} ${away ? 'away' : ''}">
        <div class="head">
          <div class="title">${evEsc(cfg.title || 'EV Charger')}</div>
          <span class="pill">${pill}</span>
          ${cfg.charger_entity ? `<button class="pwr ${enabled ? 'on' : ''}" data-act="toggle" title="${enabled ? 'Turn charger off' : 'Turn charger on'}"><ha-icon icon="mdi:power"></ha-icon></button>` : ''}
        </div>

        <div class="flow">
          ${away
            ? `<div class="node" data-act="more" data-e="${evEsc(cfg.location_entity || cfg.charging_entity || '')}" title="${evEsc(place || 'Away from home')}"><ha-icon icon="mdi:ev-plug-ccs2"></ha-icon></div>`
            : `<div class="node" data-act="more" data-e="${evEsc(cfg.charger_entity || cfg.power_entity || '')}"><ha-icon icon="mdi:ev-station"></ha-icon></div>`}
          <div class="mid"><div class="cable"></div>${charging && flowW != null ? `<span class="kw">${flowKw}</span>` : ''}${away ? `<span class="where">${evEsc(place || 'Public charger')}</span>` : ''}</div>
          <div class="car" data-act="more" data-e="${evEsc(cfg.battery_entity || '')}">
            <div class="node"><ha-icon icon="${charging ? 'mdi:car-electric' : plugged ? 'mdi:car-electric-outline' : 'mdi:car-side'}"></ha-icon></div>
            ${cfg.vehicle_name || range ? `<div><div class="carname">${evEsc(cfg.vehicle_name || '')}</div>
              ${range ? `<div class="carsub">${Math.round(parseFloat(range.state))} ${evEsc(range.attributes.unit_of_measurement || 'km')} range</div>` : ''}</div>` : ''}
          </div>
        </div>

        ${soc != null ? `
          <div class="batt" data-act="more" data-e="${evEsc(cfg.battery_entity)}">
            <div class="bfill" style="width:${Math.max(3, Math.min(100, soc))}%;background:${socColor}"></div>
            ${limit != null && limit < 100 ? `<div class="limit" style="left:${limit}%" title="Charge limit ${limit}%"></div>` : ''}
            <span class="btxt">${Math.round(soc)}%</span>
          </div>` : ''}
        <div class="note"><ha-icon icon="${charging ? 'mdi:clock-outline' : plugged ? 'mdi:power-plug' : 'mdi:power-plug-off-outline'}"></ha-icon><span class="nt">${evEsc(note)}</span>${soc != null && limit != null ? `<span class="lim">Limit ${Math.round(limit)}%</span>` : ''}</div>

        <div class="tiles">
          ${cfg.power_entity ? `<div class="tile" data-act="more" data-e="${evEsc(cfg.power_entity)}"><div class="tv">${kw}</div><div class="tk">${away ? 'Home charger' : 'Power'}</div></div>` : ''}
          ${cfg.energy_today_entity ? `<div class="tile" data-act="more" data-e="${evEsc(cfg.energy_today_entity)}"><div class="tv">${energy('energy_today_entity')}</div><div class="tk">Today</div></div>` : ''}
          ${cfg.energy_month_entity ? `<div class="tile" data-act="more" data-e="${evEsc(cfg.energy_month_entity)}"><div class="tv">${energy('energy_month_entity')}</div><div class="tk">This month</div></div>` : ''}
          ${amps != null && !isNaN(amps) ? `<div class="tile">
              <div class="tv amp">${lim ? `<button data-act="amp-" title="Lower current"><ha-icon icon="mdi:minus"></ha-icon></button>` : ''}
                ${Math.round(amps)} <small>A</small>
                ${lim ? `<button data-act="amp+" title="Raise current"><ha-icon icon="mdi:plus"></ha-icon></button>` : ''}</div>
              <div class="tk">Max current</div></div>` : ''}
        </div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'more' && el.dataset.e) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    } else if (act === 'toggle') {
      this._hass.callService('homeassistant', 'toggle', { entity_id: this._config.charger_entity });
    } else if (act === 'amp+' || act === 'amp-') {
      const s = this._st('current_limit_entity');
      if (!s) return;
      const step = s.attributes.step || 1;
      const v = parseFloat(s.state) + (act === 'amp+' ? step : -step);
      const clamped = Math.max(s.attributes.min ?? 6, Math.min(s.attributes.max ?? 80, v));
      this._hass.callService(this._config.current_limit_entity.split('.')[0], 'set_value',
        { entity_id: this._config.current_limit_entity, value: clamped });
    }
  }

  getCardSize() { return 4; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('ev-charger-card-editor');
  }

  static getStubConfig() { return { title: 'EV Charger' }; }
}

customElements.define('ev-charger-card', EvChargerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ev-charger-card',
  name: 'EV Charger Card',
  description: 'Home charger and car battery with live charging flow, time to full and energy use.',
  preview: false,
});

class EvChargerCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Charger', icon: 'mdi:ev-station', schema: [
        f.text('title', 'Title'),
        f.grid(f.entity('charger_entity', 'Charger switch', 'Power button toggles it'), f.entity('status_entity', 'Status', 'Optional text status')),
        f.grid(f.entity('power_entity', 'Power'), f.entity('current_limit_entity', 'Current limit', 'A number entity — gets +/- buttons')),
        f.grid(f.entity('energy_today_entity', 'Energy today'), f.entity('energy_month_entity', 'Energy this month')),
        f.number('charging_threshold', 'Counts as charging above', { min: 0, unit: 'W', helper: 'Default: 50' }),
      ] },
      { title: 'Vehicle', icon: 'mdi:car-electric', schema: [
        f.text('vehicle_name', 'Vehicle name'),
        f.grid(f.entity('battery_entity', 'Battery level'), f.entity('range_entity', 'Range')),
        f.grid(f.entity('charge_limit_entity', 'Charge limit'), f.entity('plug_entity', 'Plugged in')),
        f.grid(f.entity('charging_entity', 'Charging'), f.entity('completion_entity', 'Charge complete time')),
        f.grid(f.entity('duration_entity', 'Time to full'), f.entity('vehicle_power_entity', "Car's charging power", 'Shown when charging away from home')),
        f.entity('location_entity', 'Location', 'device_tracker — tells home charging from public charging'),
      ] },
    ];
  }
}

customElements.define('ev-charger-card-editor', EvChargerCardEditor);
