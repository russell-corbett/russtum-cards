/**
 * Flight Card for Home Assistant (Flightradar24 integration)
 *
 * Each tracked flight as a boarding-pass style row: origin and destination
 * with flags, a route line with the plane at its real position along the
 * trip, and altitude, speed and arrival time below.
 *
 * Configuration:
 *   type: custom:flight-card
 *   entity: sensor.flightradar24_additional_tracked   # any FR24 sensor with a "flights" attribute
 *   title: Tracked Flights
 *   units: both              # both | metric | imperial
 *   hide_photo: false        # Hide the aircraft photo FR24 provides
 *   clear_entity: button.flightradar24_clear_additional_tracked   # Optional "clear" button in the header
 *   hide_when_empty: false
 */

const flEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Country code → flag emoji (no network request needed)
const flFlag = (cc) => (cc && /^[a-z]{2}$/i.test(cc)) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
const flTs = (v) => (v == null || v === '' ? null : new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v));
const flClock = (d) => (d && !isNaN(d) ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—');
const flNum = (n) => new Intl.NumberFormat().format(Math.round(n));

class FlightCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config?.entity) throw new Error('Set "entity" to a Flightradar24 sensor with a flights attribute');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (old && old.states[this._config.entity] === hass.states[this._config.entity]) return;
    this._render();
  }

  // The plane's position along the route moves with time, not only with state changes.
  connectedCallback() { this._clock = setInterval(() => { if (!document.hidden) this._render(); }, 60000); }
  disconnectedCallback() { clearInterval(this._clock); }

  _speed(kts) {
    if (kts == null) return '—';
    const u = this._config.units || 'both';
    const kmh = `${flNum(kts * 1.852)} km/h`, k = `${flNum(kts)} kts`;
    return u === 'metric' ? kmh : u === 'imperial' ? k : `${k} <small>${kmh}</small>`;
  }

  _alt(ft) {
    if (ft == null) return '—';
    const u = this._config.units || 'both';
    const m = `${flNum(ft * 0.3048)} m`, f = `${flNum(ft)} ft`;
    return u === 'metric' ? m : u === 'imperial' ? f : `${f} <small>${m}</small>`;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const st = this._hass?.states[cfg.entity];
    const flights = Array.isArray(st?.attributes?.flights) ? st.attributes.flights : [];
    const empty = !flights.length;
    this.style.display = empty && cfg.hide_when_empty ? 'none' : '';

    const rows = flights.map((fl) => {
      const live = (fl.tracked_type || 'live') === 'live';
      if (!live) {
        return `
          <div class="fl pending">
            <div class="fh"><ha-icon icon="mdi:airplane-clock"></ha-icon>
              <span class="fno">${flEsc(fl.flight_number || fl.callsign || 'Flight')}</span>
              <span class="fsub">${flEsc(fl.callsign || '')}</span>
              <span class="tag">${flEsc(String(fl.tracked_type).replace(/_/g, ' '))}</span></div>
          </div>`;
      }
      const dep = flTs(fl.time_real_departure ?? fl.time_estimated_departure ?? fl.time_scheduled_departure);
      const arr = flTs(fl.time_estimated_arrival ?? fl.time_scheduled_arrival);
      const late = fl.time_estimated_arrival && fl.time_scheduled_arrival && fl.time_estimated_arrival - fl.time_scheduled_arrival > 15 * 60;
      let pct = null;
      if (dep && arr && arr > dep) pct = Math.max(0, Math.min(1, (Date.now() - dep) / (arr - dep)));
      const airborne = (fl.altitude ?? 0) > 0 && !fl.on_ground;
      const status = !airborne ? (pct != null && pct > 0.9 ? 'Landed' : 'On the ground') : late ? 'Running late' : 'In flight';
      const mins = arr ? Math.round((arr - Date.now()) / 60000) : null;
      const left = mins != null && mins > 0 ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`) : '';
      const photo = !cfg.hide_photo && (fl.aircraft_photo_small || fl.aircraft_photo_medium);
      const o = { code: fl.airport_origin_code_iata, city: fl.airport_origin_city, cc: fl.airport_origin_country_code };
      const d = { code: fl.airport_destination_code_iata, city: fl.airport_destination_city, cc: fl.airport_destination_country_code };

      return `
        <div class="fl">
          <div class="fh">
            ${photo ? `<img class="ph" src="${flEsc(photo)}" alt="" loading="lazy">` : '<ha-icon icon="mdi:airplane"></ha-icon>'}
            <div class="fhb">
              <div><span class="fno">${flEsc(fl.flight_number || fl.callsign)}</span>
                   <span class="fsub">${flEsc(fl.airline_short || fl.airline || '')}</span></div>
              <div class="fsub">${flEsc([fl.aircraft_model, fl.aircraft_registration].filter(Boolean).join(' · '))}</div>
            </div>
            <span class="tag ${late ? 'late' : airborne ? 'air' : ''}">${status}</span>
          </div>
          <div class="route">
            <div class="ap">
              <div class="code">${flEsc(o.code || '—')}</div>
              <div class="city">${flFlag(o.cc)} ${flEsc(o.city || '')}</div>
              <div class="time">${flClock(dep)}</div>
            </div>
            <div class="line">
              <div class="rail"><div class="done" style="width:${(pct ?? 0) * 100}%"></div></div>
              ${pct != null ? `<ha-icon class="plane" icon="mdi:airplane" style="left:${pct * 100}%"></ha-icon>` : ''}
              ${left ? `<div class="left">${left}</div>` : ''}
            </div>
            <div class="ap r">
              <div class="code">${flEsc(d.code || '—')}</div>
              <div class="city">${flFlag(d.cc)} ${flEsc(d.city || '')}</div>
              <div class="time ${late ? 'late' : ''}">${flClock(arr)}</div>
            </div>
          </div>
          <div class="stats">
            <div><ha-icon icon="mdi:arrow-expand-up"></ha-icon><span>${this._alt(fl.altitude)}</span></div>
            <div><ha-icon icon="mdi:speedometer"></ha-icon><span>${this._speed(fl.ground_speed)}</span></div>
            ${fl.heading != null ? `<div><ha-icon icon="mdi:compass-outline" style="transform:rotate(${fl.heading}deg)"></ha-icon><span>${Math.round(fl.heading)}°</span></div>` : ''}
          </div>
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: ${empty ? '12px 16px' : '14px'}; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; }
        .title { flex: 1; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .count { font-size: .75em; font-weight: 600; padding: 2px 9px; border-radius: 10px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .clear { background: none; border: none; cursor: pointer; padding: 5px; border-radius: 50%; line-height: 0; color: var(--secondary-text-color); --mdc-icon-size: 18px; }
        .clear:hover { background: rgba(127,127,127,.2); }
        .empty { display: flex; align-items: center; gap: 10px; color: var(--secondary-text-color); font-size: .9em; --mdc-icon-size: 20px; }
        .list { display: flex; flex-direction: column; gap: 10px; }

        .fl { border-radius: 14px; padding: 12px; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .fh { display: flex; align-items: center; gap: 10px; --mdc-icon-size: 22px; color: var(--secondary-text-color); }
        .ph { width: 56px; height: 36px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
        .fhb { flex: 1; min-width: 0; }
        .fno { font-weight: 700; color: var(--primary-text-color); margin-right: 6px; }
        .fsub { font-size: .8em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tag { font-size: .72em; font-weight: 600; padding: 3px 9px; border-radius: 10px; white-space: nowrap; text-transform: capitalize;
               background: rgba(127,127,127,.18); color: var(--secondary-text-color); }
        .tag.air  { background: rgba(3,169,244,.16); color: var(--primary-color,#03a9f4); }
        .tag.late { background: rgba(255,152,0,.16); color: var(--warning-color,#ff9800); }
        .pending .fh { gap: 8px; }

        .route { display: flex; align-items: center; gap: 10px; margin: 14px 0 10px; }
        .ap { min-width: 64px; max-width: 30%; }
        .ap.r { text-align: right; }
        .code { font-size: 1.5em; font-weight: 700; letter-spacing: .02em; color: var(--primary-text-color); line-height: 1.1; }
        .city { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .time { font-size: .82em; font-weight: 600; color: var(--primary-text-color); margin-top: 2px; }
        .time.late { color: var(--warning-color,#ff9800); }
        .line { position: relative; flex: 1; height: 40px; }
        .rail { position: absolute; left: 0; right: 0; top: 50%; height: 2px; transform: translateY(-50%);
                background: repeating-linear-gradient(90deg, rgba(127,127,127,.5) 0 6px, transparent 6px 11px); }
        .done { height: 100%; background: var(--primary-color,#03a9f4); }
        .plane { position: absolute; top: 50%; transform: translate(-50%, -50%) rotate(90deg); color: var(--primary-color,#03a9f4);
                 --mdc-icon-size: 22px; filter: drop-shadow(0 0 4px rgba(3,169,244,.5)); }
        .left { position: absolute; left: 0; right: 0; bottom: -4px; text-align: center; font-size: .7em; color: var(--secondary-text-color); }

        .stats { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .8em; color: var(--primary-text-color); }
        .stats div { display: flex; align-items: center; gap: 5px; --mdc-icon-size: 15px; }
        .stats ha-icon { color: var(--secondary-text-color); }
        .stats small { color: var(--secondary-text-color); margin-left: 2px; }
      </style>
      <ha-card>
        ${empty
          ? `<div class="empty"><ha-icon icon="mdi:airplane-off"></ha-icon>${flEsc(cfg.empty_text || 'No flights tracked')}</div>`
          : `<div class="head"><div class="title">${flEsc(cfg.title || 'Flights')}</div><span class="count">${flights.length}</span>
               ${cfg.clear_entity ? `<button class="clear" data-act="clear" title="Clear tracked flights"><ha-icon icon="mdi:close"></ha-icon></button>` : ''}</div>
             <div class="list">${rows}</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    if (!ev.target.closest('[data-act="clear"]') || !this._hass) return;
    const id = this._config.clear_entity;
    const domain = id.split('.')[0];
    this._hass.callService(domain, domain === 'button' ? 'press' : 'turn_on', { entity_id: id });
  }

  getCardSize() { return 3; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('flight-card-editor');
  }

  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((e) => e.includes('flightradar24') && Array.isArray(hass.states[e].attributes?.flights));
    return { entity: id || 'sensor.flightradar24_additional_tracked', title: 'Tracked Flights' };
  }
}

customElements.define('flight-card', FlightCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'flight-card',
  name: 'Flight Card',
  description: 'Tracked Flightradar24 flights with route progress, altitude and speed.',
  preview: false,
});

class FlightCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:airplane', schema: [
        f.entity('entity', 'Flightradar24 sensor', 'Any FR24 sensor with a "flights" attribute', 'sensor'),
        f.text('title', 'Title'),
        f.grid(
          f.select('units', 'Units', [{ value: 'both', label: 'Both' }, { value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Aviation (ft, kts)' }], 'Default: both'),
          f.text('empty_text', 'Text when empty'),
        ),
        f.entity('clear_entity', 'Clear button', 'Adds an × to the header that presses this button', 'button'),
        f.grid(f.toggle('hide_photo', 'Hide aircraft photo'), f.toggle('hide_when_empty', 'Hide card when empty')),
      ] },
    ];
  }
}

customElements.define('flight-card-editor', FlightCardEditor);
