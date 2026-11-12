/**
 * Family Card for Home Assistant
 *
 * Everyone at a glance: where each person is and for how long, an ETA when
 * they're heading home, their phone battery, and which car they're in.
 *   • Zone and "since" come from the person entity.
 *   • Phone battery, distance and travel time are found automatically from
 *     iCloud3 (sensor.<device>_battery, _travel_time_min, _dir_of_travel…) or
 *     the Companion app (sensor.<device>_battery_level).
 *   • A car counts as "with" someone when its tracker is within
 *     `car_radius` metres of them while they're away from home.
 *
 * Configuration:
 *   type: custom:family-card
 *   title: Family                       # Optional
 *   people:                             # Optional: default = every person
 *     - entity: person.russell_corbett
 *       navigate: /lovelace/russell-s-dash   # Tap: open this dashboard
 *       hold_action:                    # Optional, HA action format
 *         action: perform-action
 *         perform_action: input_boolean.toggle
 *         target: { entity_id: input_boolean.show_universal_wish_list }
 *       battery_entity: sensor.russell_iphone_battery   # Optional override
 *   cars:                               # Optional: car trackers
 *     - entity: device_tracker.kona_ev_location
 *       name: Kona
 *   car_radius: 150                     # Metres (default 150)
 *   hide_when_all_home: false           # Hide the whole card while everyone is home
 *   battery_low: 20                     # % shown in red (default 20)
 */

const fmEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function fmDist(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmSince(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (isNaN(min)) return '';
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 && h < 10 ? ` ${min % 60}m` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

class FamilyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const sr = this.shadowRoot;
    sr.addEventListener('pointerdown', (ev) => this._down(ev));
    sr.addEventListener('pointerup', (ev) => this._up(ev));
    sr.addEventListener('pointercancel', () => clearTimeout(this._hold?.t));
    sr.addEventListener('pointerleave', () => clearTimeout(this._hold?.t), true);
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.p')) ev.preventDefault(); });
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = { car_radius: 150, battery_low: 20, ...config,
      people: fmList(config.people).map((p) => (typeof p === 'string' ? { entity: p } : p)).filter((p) => p?.entity),
      cars: fmList(config.cars).map((c) => (typeof c === 'string' ? { entity: c } : c)).filter((c) => c?.entity) };
    this._resolvedFor = null;
    this._lastHtml = null;
    this._render();
  }

  connectedCallback() {
    this._clock = setInterval(() => { this._lastHtml = null; this._render(); }, 60000);   // "since" ages
  }

  disconnectedCallback() { clearInterval(this._clock); }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  // Work out each person's phone sensors once per registry change.
  _resolve() {
    const h = this._hass, c = this._config;
    this._resolvedFor = h.entities;
    const people = c.people.length ? c.people : Object.keys(h.states).filter((id) => id.startsWith('person.')).sort().map((entity) => ({ entity }));
    const has = (id) => (id && h.states[id] ? id : null);
    this._people = people.map((p) => {
      const s = h.states[p.entity];
      const trackers = [s?.attributes?.source, ...fmList(s?.attributes?.device_trackers)].filter(Boolean);
      const bases = [...new Set(trackers.map((t) => t.split('.')[1]).flatMap((b) => [b, b.replace(/_app$/, '')]))];
      const find = (...suffixes) => {
        for (const b of bases) for (const sfx of suffixes) { const id = has(`sensor.${b}_${sfx}`); if (id) return id; }
        return null;
      };
      return { ...p,
        battery: has(p.battery_entity) || find('battery', 'battery_level'),
        charging: find('battery_status', 'battery_state'),
        travel: has(p.travel_time_entity) || find('travel_time_min'),
        direction: find('dir_of_travel'),
        distance: find('home_distance') };
    });
    this._watched = [...this._people.flatMap((p) => [p.entity, p.battery, p.charging, p.travel, p.direction, p.distance]),
      ...this._config.cars.map((x) => x.entity)].filter(Boolean);
  }

  _zone(state) {
    if (state === 'home') return { name: 'Home', icon: 'mdi:home', kind: 'home' };
    if (state === 'not_home') return { name: 'Away', icon: 'mdi:map-marker-outline', kind: 'away' };
    if (state === 'unknown' || state === 'unavailable') return { name: 'Unknown', icon: 'mdi:help-circle-outline', kind: 'na' };
    const z = Object.values(this._hass.states).find((s) => s.entity_id.startsWith('zone.') && (s.attributes.friendly_name === state));
    return { name: state, icon: z?.attributes?.icon || 'mdi:map-marker', kind: 'zone' };
  }

  _person(p) {
    const h = this._hass, c = this._config;
    const s = h.states[p.entity];
    if (!s) return `<div class="p na"><div class="av"><ha-icon icon="mdi:account-question"></ha-icon></div><div class="pb"><div class="pn">${fmEsc(p.entity)}</div><div class="ps">Not found</div></div></div>`;
    const a = s.attributes;
    const name = p.name || a.friendly_name || p.entity;
    const zone = this._zone(s.state);
    const since = fmSince(s.last_changed);

    // Heading home: iCloud3 says "towards" and has a travel time.
    const dir = String(h.states[p.direction]?.state || '');
    const tt = parseFloat(h.states[p.travel]?.state);
    const homeward = zone.kind !== 'home' && /toward/i.test(dir) && tt > 0;
    const km = parseFloat(h.states[p.distance]?.state);
    let status = zone.kind === 'home' ? `Home · ${since}` : zone.kind === 'zone' ? `At ${zone.name} · ${since}`
      : zone.kind === 'away' ? `Away${!isNaN(km) && km > 0.2 ? ` · ${km >= 10 ? Math.round(km) : km.toFixed(1)} km` : ''}` : 'Location unknown';
    if (homeward) status = `Home in ${Math.round(tt)} min`;

    // Car: a tracker close to this person while they're out.
    let car = null;
    if (zone.kind !== 'home' && a.latitude != null) {
      for (const x of c.cars) {
        const cs = h.states[x.entity];
        if (cs?.attributes?.latitude == null) continue;
        if (fmDist(a.latitude, a.longitude, cs.attributes.latitude, cs.attributes.longitude) <= Number(c.car_radius)) {
          car = x.name || String(cs.attributes.friendly_name || x.entity).replace(/\s*location$/i, '');
          break;
        }
      }
    }

    const bs = h.states[p.battery];
    const bat = bs && !isNaN(parseFloat(bs.state)) ? Math.round(parseFloat(bs.state)) : null;
    // iCloud3 says "Charging" / "NotCharging" / "Full"; the Companion app "Charging" / "Not Charging" / "Full".
    // Compare whole words so "NotCharging" isn't read as charging. "Full" means it's still on the charger.
    const rawChg = h.states[p.charging]?.state ?? bs?.attributes?.battery_status ?? '';
    const chgState = String(rawChg).toLowerCase().replace(/[^a-z]/g, '');
    const chg = chgState === 'charging' || chgState === 'full';
    const batIcon = chg ? 'mdi:battery-charging' : bat == null ? '' : bat >= 90 ? 'mdi:battery' : `mdi:battery-${Math.max(10, Math.round(bat / 10) * 10)}`;
    const low = bat != null && bat <= Number(c.battery_low) && !chg;

    return `
      <div class="p ${zone.kind} ${homeward ? 'homeward' : ''}" data-i="${this._people.indexOf(p)}" title="${fmEsc(`${name}: ${status}`)}">
        <div class="av">
          ${a.entity_picture ? `<img src="${fmEsc(a.entity_picture)}" alt="">` : `<ha-icon icon="mdi:account"></ha-icon>`}
          <span class="zb"><ha-icon icon="${fmEsc(homeward ? 'mdi:home-import-outline' : zone.icon)}"></ha-icon></span>
        </div>
        <div class="pb">
          <div class="pn">${fmEsc(name)}</div>
          <div class="ps">${fmEsc(status)}</div>
          ${car || bat != null ? `<div class="chips">
            ${car ? `<span class="chip car"><ha-icon icon="mdi:car"></ha-icon>${fmEsc(car)}</span>` : ''}
            ${bat != null ? `<span class="chip bat ${low ? 'low' : ''} ${chg ? 'chg' : ''}" title="${chg ? (chgState === 'full' ? 'Full, on charger' : 'Charging') : 'Not charging'}"><ha-icon icon="${batIcon}"></ha-icon>${bat}%</span>` : ''}
          </div>` : ''}
        </div>
      </div>`;
  }

  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = ''; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;
    const homeN = this._people.filter((p) => this._hass.states[p.entity]?.state === 'home').length;
    const allHome = this._people.length && homeN === this._people.length;
    if (c.hide_when_all_home && allHome) {
      this.style.display = 'none';
      this._lastHtml = null;
      return;
    }
    this.style.display = '';
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; }
        .head { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 10px; }
        .title { flex: 1; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .count { font-size: .8em; color: var(--secondary-text-color); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 8px; }
        .p { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 14px; cursor: pointer; min-width: 0;
             background: var(--secondary-background-color, rgba(127,127,127,.08)); user-select: none; -webkit-user-select: none; }
        .p:hover { filter: brightness(1.08); }
        .av { position: relative; width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;
              background: rgba(127,127,127,.2); color: var(--secondary-text-color); box-shadow: 0 0 0 2px var(--ring, rgba(127,127,127,.4)); }
        .av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .home .av { --ring: var(--success-color, #4caf50); }
        .zone .av { --ring: var(--info-color, #2196f3); }
        .homeward .av { --ring: var(--warning-color, #ff9800); }
        .away .av img, .na .av img { filter: grayscale(.6); opacity: .8; }
        .zb { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 12px; color: #fff; background: var(--ring, #757575); border: 2px solid var(--card-background-color, #1c1c1c); box-sizing: border-box; }
        .away .zb, .na .zb { background: #757575; }
        .homeward .zb { background: var(--warning-color, #ff9800); }
        .pb { flex: 1; min-width: 0; }
        .pn { font-size: .92em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ps { font-size: .76em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .homeward .ps { color: var(--warning-color, #ff9800); font-weight: 600; }
        .chips { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
        .chip { display: inline-flex; align-items: center; gap: 2px; font-size: .7em; padding: 1px 6px 1px 3px; border-radius: 8px; --mdc-icon-size: 13px;
                background: rgba(127,127,127,.14); color: var(--secondary-text-color); white-space: nowrap; }
        .chip.car { background: rgba(3,169,244,.14); color: var(--primary-color, #03a9f4); }
        .chip.low { background: rgba(244,67,54,.16); color: var(--error-color, #f44336); font-weight: 600; }
        .chip.chg { background: rgba(76,175,80,.16); color: var(--success-color, #4caf50); font-weight: 600; }
        .na { opacity: .6; }
      </style>
      <ha-card>
        ${c.title ? `<div class="head"><div class="title">${fmEsc(c.title)}</div><div class="count">${allHome ? 'Everyone home' : `${homeN} of ${this._people.length} home`}</div></div>` : ''}
        <div class="grid">${this._people.map((p) => this._person(p)).join('')}</div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // ── Tap / hold ───────────────────────────────────────────────────────────
  _down(ev) {
    const el = ev.target.closest('.p[data-i]');
    if (!el || ev.button > 0) return;
    const p = this._people[Number(el.dataset.i)];
    this._hold = { p, fired: false, t: setTimeout(() => { this._hold.fired = true; this._act(p, p.hold_action || { action: 'more-info' }); }, 550) };
  }

  _up(ev) {
    const h = this._hold;
    this._hold = null;
    if (!h) return;
    clearTimeout(h.t);
    if (h.fired || !ev.target.closest('.p[data-i]')) return;
    const p = h.p;
    this._act(p, p.tap_action || (p.navigate ? { action: 'navigate', navigation_path: p.navigate } : { action: 'more-info' }));
  }

  _act(p, a) {
    const h = this._hass;
    switch (a?.action) {
      case 'navigate':
        history.pushState(null, '', a.navigation_path);
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
        break;
      case 'url': window.open(a.url_path, '_blank', 'noopener'); break;
      case 'toggle': h.callService('homeassistant', 'toggle', { entity_id: a.entity || p.entity }); break;
      case 'perform-action':
      case 'call-service': {
        const [d, s] = String(a.perform_action || a.service || '').split('.');
        if (d && s) h.callService(d, s, a.data || a.service_data || {}, a.target);
        break;
      }
      case 'none': break;
      default:
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: a?.entity || p.entity }, bubbles: true, composed: true }));
    }
  }

  getCardSize() { return 1 + Math.ceil((this._people?.length || 4) / 2) * 1.5; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('family-card-editor');
  }

  static getStubConfig() { return { title: 'Family' }; }
}

customElements.define('family-card', FamilyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'family-card',
  name: 'Family Card',
  description: "Everyone's zone and how long, ETA home, phone battery and which car they're in.",
  preview: false,
});

class FamilyCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:account-group', schema: [
        f.text('title', 'Title', 'Shows "3 of 4 home" beside it'),
        f.grid(
          f.number('car_radius', 'Car counts as "with" them within', { min: 20, unit: 'm', helper: 'Default: 150' }),
          f.number('battery_low', 'Phone battery low at', { min: 1, max: 99, unit: '%', helper: 'Default: 20' }),
        ),
        f.toggle('hide_when_all_home', 'Hide the card while everyone is home'),
      ] },
      { title: 'People', icon: 'mdi:account-multiple', open: false, list: {
        key: 'people',
        schema: [f.entity('entity', 'Person', 'Leave the list empty to show everyone', 'person'),
          f.grid(f.text('name', 'Name'), f.text('navigate', 'Tap opens', 'e.g. /lovelace/russell-s-dash')),
          f.entity('battery_entity', 'Phone battery', 'Default: found from the phone tracker', 'sensor')],
        label: (p, i) => p.name || p.entity || `Person ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add person',
      } },
      { title: 'Cars', icon: 'mdi:car-multiple', open: false, list: {
        key: 'cars',
        schema: [f.grid(f.entity('entity', 'Car tracker', '', 'device_tracker'), f.text('name', 'Name'))],
        label: (x, i) => x.name || x.entity || `Car ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add car',
      } },
    ];
  }
}

customElements.define('family-card-editor', FamilyCardEditor);
