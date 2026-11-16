/**
 * Room Remote Card for Home Assistant
 *
 * A phone-first remote for a media room, made to be used in the dark: big
 * touch targets, an optional dimmed low-contrast look, and everything for the
 * room on one card.
 *
 *   • Now playing on the room's media player (poster, title, progress)
 *   • Status chips (receiver on, Blu-ray active…)
 *   • Select entities as segmented pills (projector input, aspect, lamp mode…)
 *   • Action buttons (press a button entity, run a script or scene)
 *   • A scenes strip (the scenes-card, built in)
 *   • A D-pad with OK, plus Menu / Home / Play-pause, sent with remote.send_command
 *
 * Configuration:
 *   type: custom:room-remote-card
 *   title: Movie Room                          # Optional
 *   media_player: media_player.movie_room_apple_tv
 *   remote: remote.movie_room_apple_tv         # Optional: D-pad hidden without it
 *   dark_mode_dim: true                        # Dimmed, low-contrast look (default false)
 *   status:
 *     - media_player.home_theater
 *     - entity: binary_sensor.movie_room_blu_ray_active
 *       name: Blu-ray
 *   selects:
 *     - entity: select.projector_input
 *       name: Input
 *   buttons:
 *     - entity: script.movie_room_watch
 *       name: Watch
 *       icon: mdi:play
 *     - entity: button.projector_switch_to_hdmi1
 *       name: HDMI 1
 *       tap_action: { action: perform-action, perform_action: button.press, target: { entity_id: button.projector_switch_to_hdmi1 } }   # optional override
 *   scenes:                                    # Same format as scenes-card
 *     - { entity: scene.movie_room_regular_movie, name: Movie, icon: mdi:movie, color: black }
 *   commands:                                  # Optional: override remote command names
 *     up: up
 *     down: down
 *     left: left
 *     right: right
 *     select: select
 *     menu: menu
 *     home: home
 *     play_pause: play_pause
 *
 * Default button actions: button.press, script / scene turn_on, toggle for the rest.
 */

const rrEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rrItem = (v) => (typeof v === 'string' ? { entity: v } : v && typeof v === 'object' && v.entity ? v : null);
const rrList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(rrItem).filter(Boolean);
const RR_COMMANDS = { up: 'up', down: 'down', left: 'left', right: 'right', select: 'select', menu: 'menu', home: 'home', play_pause: 'play_pause' };
const RR_NA = ['unavailable', 'unknown'];
const RR_REPEAT_MS = 180, RR_REPEAT_AFTER = 450;

function rrTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

class RoomRemoteCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._warned = new Set();
    const sr = this.shadowRoot;
    sr.addEventListener('click', (ev) => this._onClick(ev));
    // D-pad arrows repeat while held.
    sr.addEventListener('pointerdown', (ev) => this._padDown(ev));
    // Stop repeating wherever the finger lifts, even outside the card.
    this._stop = () => this._padUp();
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.pad button')) ev.preventDefault(); });
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    this._config = {
      media_player: 'media_player.movie_room_apple_tv', dark_mode_dim: false, ...config,
      status: rrList(config.status), selects: rrList(config.selects), buttons: rrList(config.buttons),
      scenes: rrList(config.scenes),
      commands: { ...RR_COMMANDS, ...(config.commands || {}) },
    };
    this._scenes = null;
    this._lastHtml = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._scenes) this._scenes.hass = hass;
    if (old && this._watched().every((id) => old.states[id] === hass.states[id])) return;
    this._render();
  }

  connectedCallback() { this._tick = setInterval(() => this._updateProgress(), 1000); }
  disconnectedCallback() { clearInterval(this._tick); this._padUp(); }

  _watched() {
    const c = this._config;
    return [c.media_player, c.remote, ...c.status.map((x) => x.entity), ...c.selects.map((x) => x.entity), ...c.buttons.map((x) => x.entity)].filter(Boolean);
  }

  _warn(id) {
    if (this._warned.has(id)) return;
    this._warned.add(id);
    console.warn(`room-remote-card: ${id} not found`);
  }

  _name(item, st, strip = []) {
    if (item.name) return item.name;
    let n = String(st?.attributes?.friendly_name || item.entity.split('.')[1].replace(/_/g, ' '));
    for (const s of strip) n = n.replace(new RegExp(`^${s}\\s*`, 'i'), '');
    return n;
  }

  // ── Now playing ──────────────────────────────────────────────────────────
  _media() {
    const st = this._hass.states[this._config.media_player];
    if (!st) { if (this._config.media_player) this._warn(this._config.media_player); return null; }
    const a = st.attributes;
    let pos = null;
    const dur = Number(a.media_duration) || 0;
    if (dur && a.media_position != null) {
      pos = Number(a.media_position);
      if (st.state === 'playing' && a.media_position_updated_at) pos += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
      pos = Math.min(pos, dur);
    }
    return { st, pos, dur, ticking: st.state === 'playing' && dur > 0 };
  }

  _nowHtml() {
    const m = this._media();
    if (!m) return `<div class="now na"><div class="poster ph"><ha-icon icon="mdi:television-off"></ha-icon></div><div class="nm"><div class="nt">Player not found</div></div></div>`;
    const { st } = m, a = st.attributes;
    const on = !['off', 'standby', ...RR_NA].includes(st.state);
    const title = on ? (a.media_series_title || a.media_title || a.app_name || (st.state === 'idle' ? 'Ready' : 'On')) : (RR_NA.includes(st.state) ? 'Unavailable' : 'Off');
    const sub = on ? [a.media_series_title ? a.media_title : a.media_artist, a.app_name && a.app_name !== title ? a.app_name : ''].filter(Boolean).join(' · ') : '';
    const art = on ? a.entity_picture : '';
    const pct = m.dur ? (m.pos / m.dur) * 100 : null;
    return `<button class="now ${on ? '' : 'off'}" data-act="more" data-e="${rrEsc(st.entity_id)}" aria-label="${rrEsc(`${title}${sub ? `, ${sub}` : ''}. Details`)}">
        ${art ? `<img class="poster" src="${rrEsc(art)}" alt="">` : `<div class="poster ph"><ha-icon icon="${on ? 'mdi:play-circle-outline' : 'mdi:power-standby'}"></ha-icon></div>`}
        <div class="nm">
          <div class="nt">${rrEsc(title)}</div>
          ${sub ? `<div class="ns">${rrEsc(sub)}</div>` : ''}
          ${pct != null ? `<div class="bar"><i data-bar style="width:${pct.toFixed(2)}%"></i></div>
            <div class="times"><span data-pos>${rrTime(m.pos)}</span><span>-${rrTime(m.dur - m.pos)}</span></div>` : ''}
        </div>
      </button>`;
  }

  _updateProgress() {
    if (!this._hass || !this._config) return;
    const m = this._media();
    if (!m?.ticking) return;
    const bar = this.shadowRoot.querySelector('[data-bar]');
    if (bar) bar.style.width = `${((m.pos / m.dur) * 100).toFixed(2)}%`;
    const t = this.shadowRoot.querySelector('[data-pos]');
    if (t) {
      t.textContent = rrTime(m.pos);
      if (t.nextElementSibling) t.nextElementSibling.textContent = `-${rrTime(m.dur - m.pos)}`;
    }
  }

  // ── Sections ─────────────────────────────────────────────────────────────
  _statusHtml() {
    const h = this._hass;
    return this._config.status.map((s, i) => {
      const st = h.states[s.entity];
      if (!st) this._warn(s.entity);
      const na = !st || RR_NA.includes(st.state);
      const on = !na && !['off', 'standby', 'idle', 'closed', 'not_home'].includes(st.state);
      const label = this._name(s, st);
      const val = na ? 'Unavailable' : st.entity_id.startsWith('media_player.') && on ? (st.attributes.source || 'On')
        : st.entity_id.startsWith('binary_sensor.') ? (on ? 'Active' : 'Off') : st.state;
      const icon = s.icon || st?.attributes?.icon || (st?.entity_id.startsWith('media_player.') ? 'mdi:audio-video' : 'mdi:circle-medium');
      return `<button class="chip ${on ? 'on' : ''} ${na ? 'na' : ''}" data-act="more" data-e="${rrEsc(s.entity)}" aria-label="${rrEsc(`${label}: ${val}`)}">
          <ha-icon icon="${rrEsc(icon)}"></ha-icon><span class="cl">${rrEsc(label)}</span><span class="cv">${rrEsc(val)}</span></button>`;
    }).join('');
  }

  _selectsHtml() {
    const h = this._hass;
    return this._config.selects.map((s, i) => {
      const st = h.states[s.entity];
      if (!st) this._warn(s.entity);
      const na = !st || RR_NA.includes(st.state);
      const label = this._name(s, st, ['Movie Room Movie Room Projector', 'Movie Room Projector', 'Projector']);
      const opts = Array.isArray(st?.attributes?.options) ? st.attributes.options : [];
      const pills = opts.length
        ? opts.map((o) => `<button class="pill ${st.state === o ? 'sel' : ''}" role="radio" aria-checked="${st.state === o}" ${na ? 'disabled' : ''}
              data-act="opt" data-i="${i}" data-o="${rrEsc(o)}">${rrEsc(o)}</button>`).join('')
        : `<span class="pill ghost">${na ? 'Unavailable' : rrEsc(st.state)}</span>`;
      return `<div class="sel-row ${na ? 'na' : ''}">
          <span class="sl">${rrEsc(label)}</span>
          <div class="seg" role="radiogroup" aria-label="${rrEsc(label)}">${pills}</div>
        </div>`;
    }).join('');
  }

  _buttonsHtml() {
    const h = this._hass;
    return this._config.buttons.map((b, i) => {
      const st = h.states[b.entity];
      if (!st) this._warn(b.entity);
      const na = !st || st.state === 'unavailable';
      const domain = b.entity.split('.')[0];
      const running = domain === 'script' && st?.state === 'on';
      const label = this._name(b, st, ['Movie Room Movie Room Projector', 'Movie Room']);
      const icon = b.icon || st?.attributes?.icon || { script: 'mdi:script-text-play', scene: 'mdi:palette', button: 'mdi:gesture-tap-button' }[domain] || 'mdi:power';
      return `<button class="act ${running ? 'running' : ''} ${na ? 'na' : ''}" data-act="button" data-i="${i}" ${na ? 'aria-disabled="true"' : ''}
          aria-label="${rrEsc(label)}${na ? ' (unavailable)' : ''}"><ha-icon icon="${rrEsc(icon)}"></ha-icon><span>${rrEsc(label)}</span></button>`;
    }).join('');
  }

  _padHtml() {
    const c = this._config;
    if (!c.remote) return '';
    const st = this._hass.states[c.remote];
    if (!st) this._warn(c.remote);
    const na = !st || st.state === 'unavailable';
    const b = (cmd, icon, label, cls = '') => `<button class="${cls}" data-act="cmd" data-cmd="${cmd}" aria-label="${label}" ${na ? 'aria-disabled="true"' : ''}><ha-icon icon="${icon}"></ha-icon></button>`;
    return `<div class="remote ${na ? 'na' : ''}">
        <div class="pad" role="group" aria-label="Direction pad">
          ${b('up', 'mdi:chevron-up', 'Up', 'u')}${b('left', 'mdi:chevron-left', 'Left', 'l')}
          ${b('select', 'mdi:circle-medium', 'OK', 'ok')}
          ${b('right', 'mdi:chevron-right', 'Right', 'r')}${b('down', 'mdi:chevron-down', 'Down', 'd')}
        </div>
        <div class="keys">
          ${b('menu', 'mdi:arrow-left', 'Menu / back', 'key')}${b('home', 'mdi:home-outline', 'Home', 'key')}${b('play_pause', 'mdi:play-pause', 'Play / pause', 'key')}
        </div>
      </div>`;
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const status = this._statusHtml(), selects = this._selectsHtml(), buttons = this._buttonsHtml(), pad = this._padHtml();
    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 16px; overflow: hidden; --rr-dim: 1; }
        ha-card.dim { --rr-dim: .62; filter: saturate(.55); }
        ha-card.dim .chip.on, ha-card.dim .pill.sel, ha-card.dim .act.running { filter: brightness(.8); }
        .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .head h2 { margin: 0; font-size: 1.15em; font-weight: 500; color: var(--primary-text-color); opacity: var(--rr-dim); }
        button { font: inherit; -webkit-tap-highlight-color: transparent; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        .na { opacity: .45; }
        .now { display: flex; gap: 14px; align-items: center; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer;
          color: var(--primary-text-color); opacity: var(--rr-dim); }
        .poster { width: 64px; height: 96px; flex: none; border-radius: 12px; object-fit: cover; background: var(--secondary-background-color, rgba(127,127,127,.15)); }
        .poster.ph { display: grid; place-items: center; color: var(--secondary-text-color); --mdc-icon-size: 32px; }
        .nm { flex: 1; min-width: 0; }
        .nt { font-size: 1.15em; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .ns { color: var(--secondary-text-color); font-size: .9em; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar { height: 4px; margin-top: 10px; border-radius: 2px; background: var(--divider-color, rgba(127,127,127,.25)); overflow: hidden; }
        .bar i { display: block; height: 100%; background: var(--primary-color); transition: width 1s linear; }
        .times { display: flex; justify-content: space-between; margin-top: 4px; font-size: .75em; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .now.off .nt { color: var(--secondary-text-color); }
        .block { margin-top: 16px; }
        .chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
        .chips::-webkit-scrollbar { display: none; }
        .chip { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 10px; border: 0; border-radius: 18px;
          background: var(--secondary-background-color, rgba(127,127,127,.12)); color: var(--secondary-text-color); cursor: pointer; font-size: .85em; opacity: var(--rr-dim); }
        .chip ha-icon { --mdc-icon-size: 18px; }
        .chip .cl { color: var(--primary-text-color); font-weight: 500; }
        .chip.on { background: rgba(var(--rgb-primary-color, 3, 169, 244), .18); }
        .chip.on ha-icon { color: var(--primary-color); }
        .chip.na { opacity: calc(var(--rr-dim) * .45); }
        .sel-row { display: grid; gap: 6px; }
        .sel-row + .sel-row { margin-top: 10px; }
        .sl { font-size: .8em; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color); opacity: var(--rr-dim); }
        .seg { display: flex; gap: 4px; padding: 4px; border-radius: 16px; background: var(--secondary-background-color, rgba(127,127,127,.12)); overflow-x: auto; scrollbar-width: none; }
        .seg::-webkit-scrollbar { display: none; }
        .pill { flex: 1 0 auto; min-height: 40px; min-width: 64px; padding: 0 14px; border: 0; border-radius: 12px; background: none; cursor: pointer;
          color: var(--primary-text-color); font-weight: 500; opacity: var(--rr-dim); white-space: nowrap; }
        .pill.sel { background: var(--card-background-color, #fff); box-shadow: 0 1px 4px rgba(0,0,0,.18); color: var(--primary-color); }
        .pill:disabled { cursor: default; }
        .pill.ghost { display: grid; place-items: center; color: var(--secondary-text-color); }
        .acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
        .act { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 72px; padding: 8px; border: 0;
          border-radius: 16px; background: var(--secondary-background-color, rgba(127,127,127,.12)); color: var(--primary-text-color); cursor: pointer; opacity: var(--rr-dim); }
        .act ha-icon { --mdc-icon-size: 26px; color: var(--primary-color); }
        .act span { font-size: .85em; font-weight: 500; text-align: center; line-height: 1.2; }
        .act:active { transform: scale(.97); }
        .act.running { background: rgba(var(--rgb-primary-color, 3, 169, 244), .2); }
        .act.na { opacity: calc(var(--rr-dim) * .45); cursor: default; }
        .remote { display: grid; justify-items: center; gap: 14px; margin-top: 20px; }
        .pad { position: relative; width: min(240px, 100%); aspect-ratio: 1; border-radius: 50%; display: grid;
          grid-template: 'a u b' 1fr 'l ok r' 1fr 'c d e' 1fr / 1fr 1fr 1fr; background: var(--secondary-background-color, rgba(127,127,127,.12)); opacity: var(--rr-dim); }
        .pad button { border: 0; background: none; color: var(--primary-text-color); cursor: pointer; display: grid; place-items: center; border-radius: 50%;
          touch-action: manipulation; }
        .pad button ha-icon { --mdc-icon-size: 36px; }
        .pad .u { grid-area: u; } .pad .l { grid-area: l; } .pad .r { grid-area: r; } .pad .d { grid-area: d; }
        .pad .ok { grid-area: ok; margin: 6px; background: var(--card-background-color, #fff); box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .pad .ok ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }
        .pad button:active { background: rgba(127,127,127,.2); }
        .pad .ok:active { transform: scale(.96); }
        .keys { display: flex; gap: 20px; }
        .key { width: 60px; height: 60px; border: 0; border-radius: 50%; background: var(--secondary-background-color, rgba(127,127,127,.12));
          color: var(--primary-text-color); cursor: pointer; display: grid; place-items: center; opacity: var(--rr-dim); touch-action: manipulation; }
        .key ha-icon { --mdc-icon-size: 26px; }
        .key:active { transform: scale(.94); }
        .remote.na .pad, .remote.na .key { opacity: calc(var(--rr-dim) * .45); }
        .scenes { margin: 16px -8px 0; opacity: var(--rr-dim); }
        @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
      </style>
      <ha-card class="${c.dark_mode_dim ? 'dim' : ''}">
        ${c.title ? `<div class="head"><h2>${rrEsc(c.title)}</h2></div>` : ''}
        ${this._nowHtml()}
        ${status ? `<div class="block chips">${status}</div>` : ''}
        ${selects ? `<div class="block">${selects}</div>` : ''}
        ${buttons ? `<div class="block acts">${buttons}</div>` : ''}
        ${c.scenes.length ? '<div class="scenes"></div>' : ''}
        ${pad}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
    this._mountScenes();
  }

  // The scenes strip is a real scenes-card without its frame.
  _mountScenes() {
    const host = this.shadowRoot.querySelector('.scenes');
    if (!host) return;
    if (!this._scenes && customElements.get('scenes-card')) {
      this._scenes = document.createElement('scenes-card');
      try {
        this._scenes.setConfig({ scenes: this._config.scenes, embedded: true });
      } catch (e) { console.warn('room-remote-card: scenes', e); this._scenes = null; return; }
    }
    if (!this._scenes) return;
    host.appendChild(this._scenes);
    this._scenes.hass = this._hass;
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  _haptic() { window.dispatchEvent(new CustomEvent('haptic', { detail: 'light' })); }

  _send(cmd) {
    const c = this._config, st = this._hass.states[c.remote];
    if (!st || st.state === 'unavailable') return;
    this._haptic();
    this._hass.callService('remote', 'send_command', { entity_id: c.remote, command: c.commands[cmd] || cmd });
  }

  _padDown(ev) {
    const b = ev.target.closest('.pad button[data-cmd]');
    if (!b || ev.button > 0 || ['select'].includes(b.dataset.cmd)) return;
    const cmd = b.dataset.cmd;
    this._padUp();
    window.addEventListener('pointerup', this._stop, { once: true });
    window.addEventListener('pointercancel', this._stop, { once: true });
    this._repeat = { fired: false, t: setTimeout(() => {
      this._repeat.fired = true;
      this._send(cmd);
      this._repeat.iv = setInterval(() => this._send(cmd), RR_REPEAT_MS);
    }, RR_REPEAT_AFTER) };
  }

  _padUp() {
    if (!this._repeat) return;
    clearTimeout(this._repeat.t);
    clearInterval(this._repeat.iv);
    this._lastRepeatFired = this._repeat.fired;
    this._repeat = null;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const c = this._config, h = this._hass;
    switch (el.dataset.act) {
      case 'more':
        window.RusstumShared.act(this, h, { action: 'more-info' }, el.dataset.e);
        break;
      case 'cmd':
        // A held arrow already repeated; don't send one more on release.
        if (this._lastRepeatFired) { this._lastRepeatFired = false; return; }
        this._send(el.dataset.cmd);
        break;
      case 'opt': {
        const s = c.selects[Number(el.dataset.i)];
        if (s && h.states[s.entity]?.state !== el.dataset.o) {
          this._haptic();
          h.callService('select', 'select_option', { entity_id: s.entity, option: el.dataset.o });
        }
        break;
      }
      case 'button': {
        const b = c.buttons[Number(el.dataset.i)];
        if (!b || el.getAttribute('aria-disabled') === 'true') return;
        this._haptic();
        if (b.tap_action) { window.RusstumShared.act(this, h, b.tap_action, b.entity); return; }
        const domain = b.entity.split('.')[0];
        if (domain === 'button' || domain === 'input_button') h.callService(domain, 'press', { entity_id: b.entity });
        else if (domain === 'script' || domain === 'scene') h.callService(domain, 'turn_on', { entity_id: b.entity });
        else h.callService('homeassistant', 'toggle', { entity_id: b.entity });
        break;
      }
      default:
    }
  }

  getCardSize() { return 4 + (this._config?.remote ? 5 : 0) + (this._config?.selects?.length || 0); }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('room-remote-card-editor');
  }

  static getStubConfig(hass) {
    const st = hass?.states || {};
    const remote = Object.keys(st).find((id) => id.startsWith('remote.'));
    const base = remote ? `media_player.${remote.split('.')[1]}` : null;
    const mp = base && st[base] ? base : Object.keys(st).find((id) => id.startsWith('media_player.'));
    return { ...(mp ? { media_player: mp } : {}), ...(remote ? { remote } : {}) };
  }
}

customElements.define('room-remote-card', RoomRemoteCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'room-remote-card',
  name: 'Room Remote Card',
  description: 'Phone-first media-room remote: now playing, status chips, select pills, action buttons, scenes and a D-pad. Dims for the dark.',
  preview: true,
});

class RoomRemoteCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    const ent = (label, helper, domain) => ({ name: 'entity', label, helper, selector: { entity: domain ? { domain } : {} } });
    return [
      { title: 'Room', icon: 'mdi:remote-tv', schema: [
        f.text('title', 'Title', 'Optional'),
        f.grid(f.entity('media_player', 'Now playing from', '', 'media_player'), f.entity('remote', 'Remote (D-pad)', 'Leave empty to hide the D-pad', 'remote')),
        f.toggle('dark_mode_dim', 'Dim for a dark room', 'Lower contrast and saturation'),
      ] },
      { title: 'Status chips', icon: 'mdi:label-multiple-outline', list: {
        key: 'status', label: (s, i) => s.name || s.entity || `Status ${i + 1}`, newItem: () => ({}), addLabel: 'Add status',
        schema: [ent('Entity'), f.grid(f.text('name', 'Label'), f.icon('icon'))],
      } },
      { title: 'Selects', icon: 'mdi:form-dropdown', list: {
        key: 'selects', label: (s, i) => s.name || s.entity || `Select ${i + 1}`, newItem: () => ({}), addLabel: 'Add select',
        schema: [f.grid(ent('Select', '', 'select'), f.text('name', 'Label'))],
      } },
      { title: 'Buttons', icon: 'mdi:gesture-tap-button', list: {
        key: 'buttons', collapsible: true, label: (b, i) => b.name || b.entity || `Button ${i + 1}`, newItem: () => ({}), addLabel: 'Add button',
        schema: [ent('Button, script, scene or switch'), f.grid(f.text('name', 'Label'), f.icon('icon')),
          { name: 'tap_action', label: 'Tap action (default: press / run / toggle)', selector: { ui_action: {} } }],
      } },
      { title: 'Scenes', icon: 'mdi:palette', list: {
        key: 'scenes', collapsible: true, label: (s, i) => s.name || s.entity || `Scene ${i + 1}`, newItem: () => ({ color: 'blue' }), addLabel: 'Add scene',
        schema: [ent('Scene or script'), f.grid(f.text('name', 'Name'), f.icon('icon')), f.select('color', 'Colour', window.RusstumShared.COLOR_OPTIONS)],
      } },
    ];
  }

  setConfig(config) {
    const obj = (v) => (Array.isArray(v) ? v.map((e) => (typeof e === 'string' ? { entity: e } : e)) : v);
    super.setConfig({ ...config, status: obj(config.status), selects: obj(config.selects), buttons: obj(config.buttons), scenes: obj(config.scenes) });
  }
}

customElements.define('room-remote-card-editor', RoomRemoteCardEditor);
