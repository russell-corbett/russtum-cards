/**
 * Welcome Card for Home Assistant
 *
 * A greeting for the time of day ("Good evening, Alex"), the current weather
 * with today's high / low, and an optional row of navigation buttons that can
 * fold away. The folded state is remembered per browser, so no helper entity
 * is needed.
 *
 * Configuration:
 *   type: custom:welcome-card
 *   name: Alex                       # Optional (default: your first name from your HA user)
 *   weather: weather.home            # Optional: condition, temperature, today's high / low
 *   show_forecast: true              # Optional: today's high / low (default true)
 *   collapsible: true                # Optional: chevron that folds the buttons away (default false)
 *   buttons:                         # Optional
 *     - icon: mdi:home
 *       name: House
 *       color: blue                  # blue, red, yellow, green, purple, pink, teal, orange,
 *                                    # white, black, grey, or a hex colour like "#ff8800"
 *       navigation_path: /lovelace/rooms
 *     - icon: mdi:shield
 *       name: Secure
 *       color: green
 *       tap_action: { action: navigate, navigation_path: /lovelace/security }   # any HA tap_action
 */

const wcEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WC_FORECAST_MS = 30 * 60 * 1000;
const WC_DAILY = 1;   // WeatherEntityFeature.FORECAST_DAILY

const WC_ICONS = {
  'clear-night': 'mdi:weather-night', cloudy: 'mdi:weather-cloudy', exceptional: 'mdi:alert-circle-outline',
  fog: 'mdi:weather-fog', hail: 'mdi:weather-hail', lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy', partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring', rainy: 'mdi:weather-rainy', snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy', sunny: 'mdi:weather-sunny', windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy-variant',
};
const WC_TEXT = {
  'clear-night': 'Clear', cloudy: 'Cloudy', exceptional: 'Exceptional', fog: 'Fog', hail: 'Hail',
  lightning: 'Lightning', 'lightning-rainy': 'Thunderstorms', partlycloudy: 'Partly cloudy',
  pouring: 'Pouring', rainy: 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', sunny: 'Sunny',
  windy: 'Windy', 'windy-variant': 'Windy and cloudy',
};

function wcGreeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

class WelcomeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._fc = null;          // { at, entity, high, low }
    this._fcBusy = false;
    this._warned = new Set();
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    const buttons = Array.isArray(config.buttons) ? config.buttons : [];
    this._config = {
      collapsible: false, show_forecast: true, ...config,
      buttons: buttons.filter((b) => b && typeof b === 'object'),
    };
    this._lastHtml = null;
    this._collapsed = this._config.collapsible ? this._loadCollapsed() : false;
    if (this._fc && this._fc.entity !== this._config.weather) this._fc = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    const w = this._config.weather;
    const changed = !old || old.user?.name !== hass.user?.name || (w && old.states[w] !== hass.states[w]);
    this._maybeForecast();
    if (changed) this._render();
  }

  connectedCallback() {
    // The greeting changes with the hour; the render guard skips no-op redraws.
    this._tick = setInterval(() => { if (this._hass) this._render(); }, 60 * 1000);
  }

  disconnectedCallback() { clearInterval(this._tick); }

  // ── Collapsed state (per browser) ────────────────────────────────────────
  _storeKey() {
    const c = this._config;
    const id = c.collapse_key || [c.weather || '', ...c.buttons.map((b) => b.name || b.icon || '')].join('|');
    return `russtum-welcome-collapsed:${id}`;
  }

  _loadCollapsed() {
    try { return localStorage.getItem(this._storeKey()) === '1'; } catch (e) { return false; }
  }

  _saveCollapsed(v) {
    try { localStorage.setItem(this._storeKey(), v ? '1' : '0'); } catch (e) { /* private mode etc. */ }
  }

  // ── Today's high / low ───────────────────────────────────────────────────
  async _maybeForecast() {
    const c = this._config, h = this._hass;
    if (!c.weather || c.show_forecast === false || this._fcBusy || typeof h.callWS !== 'function') return;
    const st = h.states[c.weather];
    if (!st || !(Number(st.attributes.supported_features) & WC_DAILY)) return;
    if (this._fc && this._fc.entity === c.weather && Date.now() - this._fc.at < WC_FORECAST_MS) return;
    this._fcBusy = true;
    const entity = c.weather;
    try {
      const res = await h.callWS({
        type: 'call_service', domain: 'weather', service: 'get_forecasts',
        service_data: { type: 'daily' }, target: { entity_id: entity }, return_response: true,
      });
      const today = res?.response?.[entity]?.forecast?.[0];
      this._fc = { at: Date.now(), entity, high: today?.temperature, low: today?.templow };
    } catch (e) {
      // Not supported here (older HA, or no permission): stay quiet, retry later.
      this._fc = { at: Date.now(), entity };
    } finally {
      this._fcBusy = false;
      this._lastHtml = null;
      this._render();
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  _warn(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`welcome-card: ${msg}`);
  }

  _weatherHtml() {
    const c = this._config, h = this._hass;
    if (!c.weather) return '';
    const st = h.states[c.weather];
    if (!st) {
      this._warn(c.weather, `${c.weather} not found`);
      return `<div class="wx na"><ha-icon icon="mdi:weather-cloudy-alert"></ha-icon><span class="cond">Weather not found</span></div>`;
    }
    if (st.state === 'unavailable' || st.state === 'unknown') {
      return `<div class="wx na"><ha-icon icon="mdi:weather-cloudy-alert"></ha-icon><span class="cond">Weather unavailable</span></div>`;
    }
    const unit = st.attributes.temperature_unit || h.config?.unit_system?.temperature || '°';
    const t = Number(st.attributes.temperature);
    const temp = Number.isFinite(t) ? `${Math.round(t)}${unit}` : '';
    let cond = WC_TEXT[st.state] || st.state;
    try { if (typeof h.formatEntityState === 'function') cond = h.formatEntityState(st) || cond; } catch (e) { /* older HA */ }
    const fc = this._fc && this._fc.entity === c.weather ? this._fc : null;
    const hi = Number(fc?.high), lo = Number(fc?.low);
    const hilo = c.show_forecast === false ? '' : [
      Number.isFinite(hi) ? `<span aria-label="High ${Math.round(hi)} degrees">↑ ${Math.round(hi)}°</span>` : '',
      Number.isFinite(lo) ? `<span aria-label="Low ${Math.round(lo)} degrees">↓ ${Math.round(lo)}°</span>` : '',
    ].join('');
    return `<button class="wx" data-act="weather" aria-label="Weather: ${wcEsc(cond)}${temp ? `, ${wcEsc(temp)}` : ''}. Show details">
        <ha-icon icon="${WC_ICONS[st.state] || 'mdi:weather-partly-cloudy'}"></ha-icon>
        ${temp ? `<span class="temp">${wcEsc(temp)}</span>` : ''}
        <span class="cond">${wcEsc(cond)}</span>
        ${hilo ? `<span class="hilo">${hilo}</span>` : ''}
      </button>`;
  }

  _buttonsHtml() {
    const { color } = window.RusstumShared;
    return this._config.buttons.map((b, i) => {
      const col = color(b.color);
      const label = b.name || '';
      return `<button class="nav ${col.special || ''}" data-act="button" data-i="${i}" style="--c:${col.rgb}" aria-label="${wcEsc(label || b.navigation_path || 'Button')}">
          <span class="ic"><ha-icon icon="${wcEsc(b.icon || 'mdi:gesture-tap')}"></ha-icon></span>
          ${label ? `<span class="lbl">${wcEsc(label)}</span>` : ''}
        </button>`;
    }).join('');
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const first = String(c.name || h.user?.name || '').trim().split(/\s+/)[0];
    const greeting = `${wcGreeting()}${first ? `, ${first}` : ''}`;
    const buttons = this._buttonsHtml();
    const collapsible = c.collapsible && !!buttons;
    const open = !collapsible || !this._collapsed;

    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 16px; overflow: hidden; }
        .top { display: flex; align-items: flex-start; gap: 8px; }
        .greet { flex: 1; min-width: 0; margin: 0; font-size: 1.6em; line-height: 1.2; font-weight: 500;
          color: var(--primary-text-color); overflow-wrap: anywhere; }
        .chev { flex: none; width: 40px; height: 40px; margin: -6px -8px 0 0; border: 0; border-radius: 50%;
          background: none; color: var(--secondary-text-color); cursor: pointer; display: grid; place-items: center; }
        .chev ha-icon { transition: transform .25s ease; }
        .chev.closed ha-icon { transform: rotate(-90deg); }
        .chev:hover { background: rgba(var(--rgb-primary-text-color, 127, 127, 127), .08); }
        .wx { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; padding: 0;
          border: 0; background: none; font: inherit; text-align: left; color: var(--secondary-text-color); cursor: pointer; }
        .wx ha-icon { --mdc-icon-size: 22px; color: var(--primary-text-color); }
        .wx .temp { font-weight: 600; color: var(--primary-text-color); }
        .wx .hilo { display: inline-flex; gap: 8px; font-size: .9em; }
        .wx.na { opacity: .5; cursor: default; }
        .fold { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .25s ease; }
        .fold.closed { grid-template-rows: 0fr; }
        .fold > div { overflow: hidden; min-height: 0; }
        .btns { display: grid; grid-template-columns: repeat(auto-fit, minmax(56px, 1fr)); gap: 8px; padding-top: 16px; }
        .nav { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; padding: 4px 0;
          border: 0; background: none; font: inherit; color: var(--primary-text-color); cursor: pointer;
          border-radius: 12px; -webkit-tap-highlight-color: transparent; }
        .nav .ic { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center;
          background: rgba(var(--c), .2); color: rgb(var(--c)); transition: transform .12s ease, background .2s; }
        .nav:hover .ic { background: rgba(var(--c), .3); }
        .nav:active .ic { transform: scale(.92); }
        .nav.white .ic { background: rgba(var(--c), .9); color: #4a4a4a; box-shadow: inset 0 0 0 1px var(--divider-color, rgba(0,0,0,.15)); }
        .nav.black .ic { background: rgba(var(--c), .85); color: #f2f2f2; box-shadow: inset 0 0 0 1px var(--divider-color, rgba(255,255,255,.2)); }
        .nav .lbl { max-width: 100%; font-size: .8em; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .fold.closed button { visibility: hidden; transition: visibility 0s .25s; }
      </style>
      <ha-card>
        <div class="top">
          <h2 class="greet">${wcEsc(greeting)}</h2>
          ${collapsible ? `<button class="chev ${open ? '' : 'closed'}" data-act="fold" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} shortcuts">
            <ha-icon icon="mdi:chevron-down"></ha-icon></button>` : ''}
        </div>
        ${this._weatherHtml()}
        ${buttons ? `<div class="fold ${open ? '' : 'closed'}"><div><div class="btns">${buttons}</div></div></div>` : ''}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'fold') {
      this._collapsed = !this._collapsed;
      this._saveCollapsed(this._collapsed);
      // Toggle classes in place so the fold animates.
      const fold = this.shadowRoot.querySelector('.fold');
      fold?.classList.toggle('closed', this._collapsed);
      el.classList.toggle('closed', this._collapsed);
      el.setAttribute('aria-expanded', String(!this._collapsed));
      el.setAttribute('aria-label', `${this._collapsed ? 'Show' : 'Hide'} shortcuts`);
      this._lastHtml = null;   // the next full render picks up the new state
      return;
    }
    if (act === 'weather') {
      window.RusstumShared.act(this, this._hass, { action: 'more-info' }, this._config.weather);
      return;
    }
    if (act === 'button') {
      const b = this._config.buttons[Number(el.dataset.i)];
      if (!b) return;
      const a = b.tap_action || (b.navigation_path ? { action: 'navigate', navigation_path: b.navigation_path } : null);
      if (a) window.RusstumShared.act(this, this._hass, a, b.entity);
    }
  }

  getCardSize() { return this._config?.buttons?.length && !this._collapsed ? 3 : 2; }

  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('welcome-card-editor');
  }

  static getStubConfig(hass) {
    const weather = Object.keys(hass?.states || {}).find((id) => id.startsWith('weather.'));
    return {
      ...(weather ? { weather } : {}),
      collapsible: true,
      buttons: [
        { icon: 'mdi:home', name: 'Home', color: 'blue', navigation_path: '/lovelace/0' },
        { icon: 'mdi:lightbulb', name: 'Lights', color: 'yellow', navigation_path: '/lovelace/0' },
        { icon: 'mdi:thermostat', name: 'Heat', color: 'red', navigation_path: '/lovelace/0' },
        { icon: 'mdi:shield', name: 'Secure', color: 'green', navigation_path: '/lovelace/0' },
      ],
    };
  }
}

customElements.define('welcome-card', WelcomeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'welcome-card',
  name: 'Welcome Card',
  description: 'Time-of-day greeting, the weather with today\'s high / low, and a foldable row of navigation buttons.',
  preview: true,
});

class WelcomeCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:hand-wave', schema: [
        f.grid(f.text('name', 'Name', 'Default: your first name'), f.entity('weather', 'Weather', '', 'weather')),
        f.grid(f.toggle('show_forecast', 'Show today\'s high / low', 'Default: on'), f.toggle('collapsible', 'Buttons can fold away', 'Remembered per browser')),
      ] },
      { title: 'Buttons', icon: 'mdi:gesture-tap-button', list: {
        key: 'buttons',
        collapsible: true,
        label: (b, i) => b.name || `Button ${i + 1}`,
        newItem: () => ({ icon: 'mdi:home', color: 'blue' }),
        addLabel: 'Add button',
        schema: [
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.grid(f.select('color', 'Colour', window.RusstumShared.COLOR_OPTIONS, 'Or a hex colour, e.g. #ff8800'),
            f.text('navigation_path', 'Opens', 'e.g. /lovelace/rooms')),
          { name: 'tap_action', label: 'Tap action (instead of Opens)', selector: { ui_action: {} } },
        ],
      } },
    ];
  }
}

customElements.define('welcome-card-editor', WelcomeCardEditor);
