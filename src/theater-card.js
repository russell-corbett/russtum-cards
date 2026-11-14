/**
 * Theater Card for Home Assistant
 *
 * A home theater on one card. The top is a "screen": what's playing on the
 * active source with its artwork, progress and play controls, glowing when
 * the projector is on. Below it, one tap picks a source (turning on the
 * projector, switching the receiver's input and waking the player), then the
 * receiver's volume and sound mode, each device's power, and the room's
 * lights and scenes. The power button starts the default source, or turns
 * everything off (tap twice).
 *
 * Configuration:
 *   type: custom:theater-card
 *   title: Movie Room
 *   projector: media_player.movie_room_projector
 *   receiver: media_player.home_theater
 *   sources:
 *     - name: Apple TV
 *       icon: mdi:apple
 *       player: media_player.movie_room_apple_tv      # What plays (shown on the screen)
 *       receiver_source: Apple TV                     # Receiver input (default: matched by name)
 *       projector_source: HDMI1                       # Optional projector input
 *       scene: scene.apple_tv                         # Optional scene to run as well
 *       apps: [Netflix, Prime Video, Fibe TV, Swiftfin, Spotify]   # Optional app buttons (the player's sources)
 *       # or: apps: [{ app: Prime Video, name: Prime, icon: mdi:filmstrip, color: '#00a8e1' }]
 *     - name: Blu-ray
 *       icon: mdi:disc-player
 *       player: media_player.blu_ray_player
 *       receiver_source: 4K/UHD Blu-ray
 *   activities:                                       # Optional: big buttons that run your scenes or scripts
 *     - script.movie_night_netflix
 *     - entity: scene.4k_3d_movie
 *       name: 3D Movie
 *       icon: mdi:video-3d
 *       color: '#7e57c2'
 *   light: light.movie_room_hue                       # Optional: tap toggles, drag dims
 *   scenes: [scene.movie_room_sync, scene.4k_3d_movie] # Optional: up to 4
 *   switches: [switch.sync_box_light_sync]            # Optional toggles, e.g. Hue Sync
 *   off_scene: scene.movie_room_off                   # Optional: run when turning it all off
 *   power_switches:                                   # Optional: switched on with the room and off with "all off"
 *     - entity: switch.sync_box_power
 *       name: Sync Box
 *   device_order: [Projector, Receiver]               # Optional: tile order by name or entity id; the rest follow.
 *                                                     # Default follows the signal: players, receiver, power_switches, projector
 *   sound_modes: [MOVIE, MUSIC, STEREO, AUTO]         # Sound modes offered (default: these, if the receiver has them)
 *   volume_db: true                                   # Show volume in dB (default: on for Denon/Marantz)
 */

const TH_MODES = ['MOVIE', 'MUSIC', 'GAME', 'STEREO', 'AUTO', 'DIRECT', 'PURE DIRECT', 'DOLBY DIGITAL', 'DTS SURROUND'];
const TH_SRC_ICONS = [[/apple/i, 'mdi:apple'], [/blu|disc|dvd|uhd/i, 'mdi:disc-player'], [/bell|fibe|cable|tv/i, 'mdi:television-classic'],
  [/game|xbox|playstation|ps\d|switch/i, 'mdi:controller'], [/record|vinyl|phono/i, 'mdi:album'], [/music|heos|spotify|bluetooth/i, 'mdi:music']];
// Brand-ish colours and icons for common apps (matched by name).
const TH_APPS = [
  [/netflix/i, 'mdi:netflix', '#e50914'], [/prime|amazon/i, 'mdi:filmstrip-box', '#00a8e1'], [/fibe|bell/i, 'mdi:television-classic', '#00549a'],
  [/swiftfin|jellyfin/i, 'mdi:jellyfish', '#aa5cc3'], [/spotify/i, 'mdi:spotify', '#1db954'], [/youtube/i, 'mdi:youtube', '#ff0000'],
  [/disney/i, 'mdi:castle', '#113ccf'], [/plex/i, 'mdi:plex', '#e5a00d'], [/crave/i, 'mdi:alpha-c-box', '#1b5fa8'], [/twitch/i, 'mdi:twitch', '#9146ff'],
  [/cbc/i, 'mdi:alpha-c-circle', '#d52b1e'], [/britbox/i, 'mdi:alpha-b-box', '#0b2a4a'], [/^tv$|apple tv/i, 'mdi:apple', '#333'], [/music/i, 'mdi:music', '#fa2d48'],
  [/photos/i, 'mdi:image-multiple', '#f5a623'], [/steam/i, 'mdi:steam', '#1b2838'], [/podcast/i, 'mdi:podcast', '#9933cc'], [/settings/i, 'mdi:cog', '#6b6b6b'],
];
const thEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const thList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const thEnt = (v) => (typeof v === 'string' ? { entity: v } : v || {});
// media_player supported_features bits: some players (e.g. DLNA Blu-ray) have no power control.
const TH_ON = 128, TH_OFF = 256;
const thCan = (st, bit) => !!st && (Number(st.attributes?.supported_features) & bit) === bit;
// A player with no power control (DLNA renderers) sits at "idle" whenever it's on the network,
// even in standby, so for those only playing/paused counts as on.
const thOff = (st) => !st || ['off', 'unavailable', 'unknown', 'standby'].includes(st.state)
  || (st.state === 'idle' && !thCan(st, TH_ON) && !thCan(st, TH_OFF));
const thTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const thTitle = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bDts\b/, 'DTS');

class TheaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const sr = this.shadowRoot;
    sr.addEventListener('click', (ev) => this._onClick(ev));
    sr.addEventListener('change', (ev) => this._onChange(ev));
    sr.addEventListener('pointerdown', (ev) => this._onDown(ev));
    sr.addEventListener('pointermove', (ev) => this._onMove(ev));
    sr.addEventListener('pointerup', (ev) => this._onUp(ev));
    sr.addEventListener('pointercancel', () => { this._drag = null; this._lastHtml = null; this._render(); });
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-hold]')) ev.preventDefault(); });
  }

  setConfig(config) {
    if (!config || (!config.receiver && !config.projector && !thList(config.sources).length)) {
      throw new Error('Set at least a receiver, projector or sources');
    }
    this._config = {
      title: 'Movie Room', ...config,
      sources: thList(config.sources).map(thEnt).map((s) => ({ ...s,
        apps: thList(s.apps).map((a) => (typeof a === 'string' ? { app: a } : a)).filter((a) => a?.app) })),
      scenes: thList(config.scenes).map(thEnt).filter((s) => s.entity).slice(0, 4),
      activities: thList(config.activities).map(thEnt).filter((s) => s.entity),
      switches: thList(config.switches).map(thEnt).filter((s) => s.entity),
      power_switches: thList(config.power_switches).map(thEnt).filter((s) => s.entity),
      device_order: thList(config.device_order).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
    };
    this._lastHtml = null;
    this._dirty = true;
    if (this._hass) this.hass = this._hass;   // redraw now, e.g. while editing the card
  }

  connectedCallback() {
    // Move the progress bar along without re-rendering the whole card.
    this._tick = setInterval(() => this._updateProgress(), 1000);
  }

  disconnectedCallback() { clearInterval(this._tick); clearTimeout(this._confirmT); }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    const ids = this._watched();
    if (old && !this._dirty && ids.every((id) => hass.states[id] === old.states[id])) return;
    this._dirty = false;
    this._render();
  }

  _watched() {
    const c = this._config;
    return [c.projector, c.receiver, c.light, ...this._sources().map((s) => s.player),
      ...c.scenes.map((s) => s.entity), ...c.switches.map((s) => s.entity), ...c.activities.map((s) => s.entity), ...c.power_switches.map((s) => s.entity)].filter(Boolean);
  }

  // Sources from config, with the receiver input and icon filled in where left out.
  _sources() {
    const h = this._hass, c = this._config;
    const rx = h?.states[c.receiver];
    const list = rx?.attributes?.source_list || [];
    return c.sources.map((s) => {
      const pname = s.player ? String(h?.states[s.player]?.attributes?.friendly_name || '') : '';
      let rs = s.receiver_source;
      if (!rs && list.length) {
        const want = (s.name || pname).toLowerCase();
        rs = list.find((x) => x.toLowerCase() === want)
          || (/blu|uhd|disc/i.test(want) ? list.find((x) => /4k|uhd/i.test(x)) || list.find((x) => /blu/i.test(x)) : null)
          || list.find((x) => want.includes(x.toLowerCase()) || x.toLowerCase().includes(want));
      }
      const name = s.name || rs || pname || 'Source';
      const plist = s.player ? h?.states[s.player]?.attributes?.source_list || [] : [];
      const apps = s.apps.map((a) => {
        const want = String(a.app).toLowerCase();
        // Use the player's exact source name: "Prime" finds "Prime Video".
        const real = plist.find((x) => x.toLowerCase() === want) || plist.find((x) => x.toLowerCase().replace(/\s/g, ' ').includes(want)) || a.app;
        const brand = TH_APPS.find(([re]) => re.test(real)) || [];
        return { ...a, app: real, name: a.name || a.app, icon: a.icon || brand[1] || 'mdi:application', color: a.color || brand[2] || 'var(--primary-color)' };
      });
      return { ...s, apps, name, receiver_source: rs, icon: s.icon || TH_SRC_ICONS.find(([re]) => re.test(name))?.[1] || 'mdi:video-input-hdmi' };
    });
  }

  _activeSource(sources) {
    const h = this._hass, c = this._config;
    const rx = h.states[c.receiver];
    if (rx && !thOff(rx)) {
      const hit = sources.find((s) => s.receiver_source && s.receiver_source === rx.attributes.source);
      if (hit) return hit;
    }
    // No receiver (or an input we don't know): whatever player is busy.
    return sources.find((s) => ['playing', 'paused'].includes(h.states[s.player]?.state))
      || sources.find((s) => s.player && !thOff(h.states[s.player])) || null;
  }

  _isDb() {
    const c = this._config;
    if (c.volume_db != null) return !!c.volume_db;
    const p = this._hass.entities?.[c.receiver]?.platform;
    return p === 'denonavr' || p === 'marantz';
  }

  _volLabel(v) {
    if (v == null) return '—';
    // Denon/Marantz: 0..1 maps to −80..+18 dB.
    if (this._isDb()) { const db = Math.round((v * 98 - 80) * 2) / 2; return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`; }
    return `${Math.round(v * 100)}%`;
  }

  _screen(src) {
    const h = this._hass, c = this._config;
    const proj = h.states[c.projector];
    const projOn = proj ? !thOff(proj) : null;
    const pl = src?.player ? h.states[src.player] : null;
    const a = pl?.attributes || {};
    const playing = pl?.state === 'playing', paused = pl?.state === 'paused';
    const anyOn = this._anyOn();
    const art = (playing || paused) ? a.entity_picture : null;
    let kicker, title, sub;
    if (!anyOn) { kicker = ''; title = 'Off'; sub = 'Pick a source to start'; }
    else if (playing || paused) {
      kicker = [src?.name, a.app_name && a.app_name !== src?.name ? a.app_name : ''].filter(Boolean).join(' · ');
      title = a.media_title || a.app_name || src?.name || 'Playing';
      sub = a.media_series_title
        ? `${a.media_series_title}${a.media_season ? ` · S${a.media_season}` : ''}${a.media_episode ? `E${a.media_episode}` : ''}`
        : a.media_artist || a.media_album_name || '';
    } else {
      kicker = src?.name || '';
      title = src ? (pl ? (thOff(pl) ? `${src.name} is off` : a.app_name || 'Ready') : 'Ready') : 'On';
      sub = projOn === false ? 'Projector is off' : '';
    }
    const dur = Number(a.media_duration) || 0;
    const ctrl = src?.player && (playing || paused) ? `
      <div class="ctrl">
        <button data-act="media" data-s="media_previous_track" title="Previous"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
        <button class="pp" data-act="media" data-s="media_play_pause" title="${playing ? 'Pause' : 'Play'}"><ha-icon icon="${playing ? 'mdi:pause' : 'mdi:play'}"></ha-icon></button>
        <button data-act="media" data-s="media_next_track" title="Next"><ha-icon icon="mdi:skip-next"></ha-icon></button>
      </div>` : '';
    return `
      <div class="screen ${projOn ? 'lit' : ''} ${anyOn ? '' : 'dark'}">
        ${art ? `<div class="bg" style="background-image:url('${thEsc(art)}')"></div>` : '<div class="bg none"></div>'}
        <div class="shade"></div>
        <div class="top">
          <span class="room"><ha-icon icon="mdi:theater"></ha-icon>${thEsc(c.title)}</span>
          <button class="power ${anyOn ? 'on' : ''} ${this._confirm ? 'confirm' : ''}" data-act="power" title="${anyOn ? 'Turn everything off' : 'Turn on'}">
            <ha-icon icon="mdi:power"></ha-icon>${this._confirm ? '<span>Tap again to turn off</span>' : ''}
          </button>
        </div>
        <div class="now">
          ${art ? `<img class="art" src="${thEsc(art)}" alt="">` : ''}
          <div class="np">
            ${kicker ? `<div class="kick">${thEsc(kicker)}</div>` : ''}
            <div class="ttl">${thEsc(title)}</div>
            ${sub ? `<div class="sub">${thEsc(sub)}</div>` : ''}
          </div>
          ${ctrl}
        </div>
        ${dur > 0 ? `<div class="prog"><div class="bar"><i data-prog style="width:0%"></i></div><span data-ptime></span></div>` : ''}
      </div>`;
  }

  // Your scenes / scripts as tiles. The last one run is highlighted while the room is on.
  _activityRow() {
    const h = this._hass, c = this._config;
    if (!c.activities.length) return '';
    const when = (id) => {
      const st = h.states[id];
      if (!st) return 0;
      if (id.startsWith('scene.')) return Date.parse(st.state) || 0;
      if (st.state === 'on') return Date.now();
      return Date.parse(st.attributes?.last_triggered) || 0;
    };
    const last = this._anyOn() ? c.activities.map((a) => ({ id: a.entity, t: when(a.entity) })).filter((x) => x.t).sort((a, b) => b.t - a.t)[0]?.id : null;
    return `<div class="apps acts">${c.activities.map((a) => {
      const st = h.states[a.entity];
      const name = a.name || String(st?.attributes?.friendly_name || a.entity).replace(new RegExp(`^${c.title}\\s+`, 'i'), '');
      const brand = TH_APPS.find(([re]) => re.test(name)) || [];
      const icon = a.icon || st?.attributes?.icon || brand[1] || (a.entity.startsWith('script.') ? 'mdi:play-circle' : 'mdi:palette');
      const color = a.color || brand[2] || 'var(--primary-color, #03a9f4)';
      const running = st?.state === 'on' && a.entity.startsWith('script.');
      return `<button class="app ${last === a.entity ? 'act' : ''} ${running ? 'run' : ''}" data-act="activity" data-e="${thEsc(a.entity)}" title="${thEsc(name)}" style="--app:${thEsc(color)}">
        <span class="ai"><ha-icon icon="${thEsc(icon)}"></ha-icon></span><span class="an">${thEsc(name)}</span></button>`;
    }).join('')}</div>`;
  }

  // App buttons for the active source (or, when nothing's on, the first source that has apps).
  _appRow(sources, src) {
    const s = src?.apps?.length ? src : !this._anyOn() ? sources.find((x) => x.apps.length) : null;
    if (!s) return '';
    const si = sources.indexOf(sources.find((x) => x.name === s.name));
    const st = this._hass.states[s.player];
    const curApp = !thOff(st) ? String(st?.attributes?.app_name || st?.attributes?.source || '').toLowerCase() : '';
    return `<div class="apps">${s.apps.map((a, i) => {
      const act = curApp && curApp === a.app.toLowerCase().replace(/\u00a0/g, ' ');
      return `<button class="app ${act ? 'act' : ''}" data-act="app" data-i="${si}" data-a="${i}" title="Open ${thEsc(a.name)} on ${thEsc(s.name)}" style="--app:${thEsc(a.color)}">
        <span class="ai"><ha-icon icon="${thEsc(a.icon)}"></ha-icon></span><span class="an">${thEsc(a.name)}</span></button>`;
    }).join('')}</div>`;
  }

  _anyOn() {
    const h = this._hass, c = this._config;
    return [c.projector, c.receiver].some((id) => id && !thOff(h.states[id]));
  }

  _render() {
    if (!this._config || !this._hass) return;
    const h = this._hass, c = this._config;
    const sources = this._sources();
    const src = this._activeSource(sources);
    this._src = src;
    const rx = h.states[c.receiver];
    const rxOn = rx && !thOff(rx);
    const vol = this._drag?.vol ?? rx?.attributes?.volume_level;
    const muted = !!rx?.attributes?.is_volume_muted;

    // Sound modes: the favourites this receiver has, plus whatever it's in now.
    const modeList = rx?.attributes?.sound_mode_list || [];
    const favs = thList(c.sound_modes).length ? thList(c.sound_modes) : TH_MODES.slice(0, 5);
    const cur = rx?.attributes?.sound_mode;
    const modes = [...new Set([...favs.filter((m) => !modeList.length || modeList.includes(m)), ...(cur ? [cur] : [])])];

    // Default order follows the signal: players → receiver → in-line boxes (e.g. Hue Sync) → projector.
    const devices = [
      ...sources.filter((s) => s.player).map((s) => ({ id: s.player, name: s.name, icon: s.icon, info: (st) => st.attributes.app_name || '' })),
      c.receiver && { id: c.receiver, name: 'Receiver', icon: 'mdi:audio-video', info: (st) => st.attributes.source || '' },
      ...c.power_switches.map((x) => ({ id: x.entity, name: x.name || String(h.states[x.entity]?.attributes?.friendly_name || x.entity).replace(/\s+power$/i, ''),
        icon: x.icon || (/sync/i.test(x.entity) ? 'mdi:television-ambient-light' : 'mdi:power-plug'), info: () => '', isSwitch: true })),
      c.projector && { id: c.projector, name: 'Projector', icon: 'mdi:projector', info: (st) => st.attributes.source || st.attributes.cmode || '' },
    ].filter(Boolean).filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);
    if (c.device_order.length) {
      // Listed tiles first, in the given order; the rest keep their usual order.
      const rank = (d, i) => { const k = c.device_order.findIndex((x) => x === d.id.toLowerCase() || x === String(d.name).toLowerCase()); return k < 0 ? c.device_order.length + i : k; };
      const ranked = devices.map((d, i) => [rank(d, i), d]).sort((x, y) => x[0] - y[0]);
      devices.splice(0, devices.length, ...ranked.map((x) => x[1]));
    }
    const devHtml = devices.map((d) => {
      const st = h.states[d.id];
      const on = !thOff(st);
      const state = !st ? 'Missing' : st.state === 'unavailable' ? 'Offline' : on ? (st.state === 'playing' ? 'Playing' : st.state === 'paused' ? 'Paused' : 'On') : 'Off';
      const info = on && st ? d.info(st) : '';
      return `<button class="dev ${on ? 'on' : ''} ${st?.state === 'unavailable' ? 'na' : ''}" data-act="devpower" data-e="${thEsc(d.id)}" data-hold="${thEsc(d.id)}" title="${thEsc(d.name)}: ${d.isSwitch || thCan(st, TH_ON) || thCan(st, TH_OFF) ? 'tap for power, hold for details' : 'no power control, tap for details'}">
          <ha-icon icon="${d.icon}"></ha-icon><span class="dn">${thEsc(d.name)}</span><span class="ds">${thEsc(info || state)}</span></button>`;
    }).join('');

    const light = c.light ? h.states[c.light] : null;
    const lOn = light?.state === 'on';
    const bri = this._drag?.light ?? (lOn ? Math.round(((light.attributes.brightness ?? 255) / 255) * 100) : 0);
    const lastScene = c.scenes.map((s) => ({ id: s.entity, t: Date.parse(h.states[s.entity]?.state) || 0 })).sort((a, b) => b.t - a.t)[0];
    const sceneHtml = c.scenes.map((s) => {
      const st = h.states[s.entity];
      const name = s.name || String(st?.attributes?.friendly_name || s.entity).replace(new RegExp(`^${c.title}\\s+`, 'i'), '');
      const active = lOn && lastScene?.id === s.entity && lastScene.t > 0;
      return `<button class="chip ${active ? 'act' : ''}" data-act="scene" data-e="${thEsc(s.entity)}"><ha-icon icon="${thEsc(s.icon || st?.attributes?.icon || 'mdi:palette')}"></ha-icon>${thEsc(name)}</button>`;
    }).join('');
    const swHtml = c.switches.map((s) => {
      const st = h.states[s.entity];
      const name = s.name || String(st?.attributes?.friendly_name || s.entity).replace(/^sync box\s+/i, 'Hue ');
      return `<button class="chip sw ${st?.state === 'on' ? 'act' : ''}" data-act="toggle" data-e="${thEsc(s.entity)}"><ha-icon icon="${thEsc(s.icon || (st?.state === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off-outline'))}"></ha-icon>${thEsc(name)}</button>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; --th-accent: var(--primary-color, #03a9f4); --th-glow: 190, 220, 255; }
        ha-card { overflow: hidden; padding: 0 0 12px; }
        .screen { position: relative; min-height: 168px; display: flex; flex-direction: column; justify-content: space-between; color: #fff;
                  background: radial-gradient(120% 90% at 50% 0%, #26303d 0%, #12161c 60%, #0b0d10 100%); isolation: isolate; }
        .screen.dark { background: radial-gradient(120% 90% at 50% 0%, #1b1e23 0%, #0e1013 70%); }
        .screen.lit::after { content: ''; position: absolute; left: 6%; right: 6%; top: 0; height: 2px; border-radius: 2px; z-index: 3;
                  background: rgba(var(--th-glow), .9); box-shadow: 0 0 18px 6px rgba(var(--th-glow), .35); }
        .bg { position: absolute; inset: -20px; background-size: cover; background-position: center; filter: blur(22px) saturate(1.3); opacity: .55; z-index: -2; transform: scale(1.1); }
        .bg.none { display: none; }
        .shade { position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.05) 40%, rgba(0,0,0,.65) 100%); }
        .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 0 14px; }
        .room { display: inline-flex; align-items: center; gap: 6px; font-size: .78em; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; opacity: .85; --mdc-icon-size: 16px; }
        .power { display: inline-flex; align-items: center; gap: 6px; height: 34px; min-width: 34px; padding: 0 8px; justify-content: center; border-radius: 17px; border: none; cursor: pointer;
                 background: rgba(255,255,255,.12); color: rgba(255,255,255,.75); --mdc-icon-size: 20px; font: inherit; font-size: .78em; font-weight: 600; backdrop-filter: blur(6px); }
        .power:hover { background: rgba(255,255,255,.2); }
        .power.on { color: #fff; background: rgba(76,175,80,.55); }
        .power.confirm { background: var(--error-color, #f44336); color: #fff; padding: 0 12px 0 8px; }
        .now { display: flex; align-items: flex-end; gap: 12px; padding: 0 12px 10px 14px; min-width: 0; }
        .art { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; box-shadow: 0 4px 14px rgba(0,0,0,.5); flex: none; }
        .np { flex: 1; min-width: 0; }
        .kick { font-size: .72em; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ttl { font-size: 1.45em; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 8px rgba(0,0,0,.5); }
        .dark .ttl { opacity: .6; }
        .sub { font-size: .82em; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ctrl { display: flex; align-items: center; gap: 2px; flex: none; }
        .ctrl button { width: 36px; height: 36px; border-radius: 50%; border: none; background: none; color: #fff; cursor: pointer; display: grid; place-items: center; --mdc-icon-size: 24px; }
        .ctrl button:hover { background: rgba(255,255,255,.15); }
        .ctrl .pp { width: 44px; height: 44px; background: #fff; color: #111; --mdc-icon-size: 26px; }
        .ctrl .pp:hover { background: #e8e8e8; }
        .prog { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; font-size: .7em; opacity: .85; font-variant-numeric: tabular-nums; }
        .prog .bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,.22); overflow: hidden; }
        .prog i { display: block; height: 100%; background: #fff; border-radius: 2px; transition: width 1s linear; }

        .body { padding: 12px 12px 0; display: flex; flex-direction: column; gap: 10px; }
        .srcs { display: grid; grid-template-columns: repeat(${Math.max(1, Math.min(4, sources.length))}, minmax(0, 1fr)); gap: 6px; }
        .src { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 4px 8px; border-radius: 12px; border: 1px solid transparent; cursor: pointer; font: inherit;
               background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--primary-text-color); --mdc-icon-size: 22px; min-width: 0; }
        .src span { font-size: .78em; font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .src ha-icon { color: var(--secondary-text-color); }
        .src:hover { border-color: rgba(127,127,127,.3); }
        .src.act { border-color: var(--th-accent); background: color-mix(in srgb, var(--th-accent) 16%, var(--secondary-background-color, transparent)); }
        .src.act ha-icon { color: var(--th-accent); }

        .apps { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: -2px 0; padding: 2px 0; }
        .apps::-webkit-scrollbar { display: none; }
        .app { flex: 1 0 58px; max-width: 84px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 2px; border: none; border-radius: 12px;
               background: none; cursor: pointer; font: inherit; color: var(--secondary-text-color); }
        .app .ai { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; color: #fff; --mdc-icon-size: 24px;
                   background: var(--app); box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .12s; }
        .app:hover .ai { transform: translateY(-1px) scale(1.04); }
        .app .an { font-size: .7em; font-weight: 600; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .app.act .ai { box-shadow: 0 0 0 2px var(--card-background-color, #1c1c1c), 0 0 0 4px var(--app); }
        .app.act .an { color: var(--primary-text-color); }
        .app.run .ai { animation: th-pulse 1.2s ease-in-out infinite; }
        @keyframes th-pulse { 50% { opacity: .6; } }
        .audio { display: flex; align-items: center; gap: 8px; ${rxOn ? '' : 'opacity: .45;'} }
        .ib { width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer; display: grid; place-items: center; flex: none;
              background: rgba(127,127,127,.12); color: var(--primary-text-color); --mdc-icon-size: 18px; }
        .ib:hover { background: rgba(127,127,127,.22); }
        .ib.muted { color: var(--error-color, #f44336); }
        .vol { position: relative; flex: 1; height: 32px; border-radius: 10px; overflow: hidden; cursor: ew-resize; touch-action: pan-y; min-width: 60px;
               background: rgba(127,127,127,.14); user-select: none; -webkit-user-select: none; }
        .vol i { position: absolute; inset: 0 auto 0 0; background: color-mix(in srgb, var(--th-accent) ${muted ? '25%' : '55%'}, transparent); border-radius: 10px 0 0 10px; }
        .vol b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: .8em; font-weight: 600; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
        select.mode { height: 32px; border-radius: 10px; border: none; padding: 0 8px; font: inherit; font-size: .8em; font-weight: 600; cursor: pointer; max-width: 120px;
                      background: rgba(127,127,127,.14); color: var(--primary-text-color); }
        select.mode option { background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color); }

        .devs { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
        .dev { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; text-align: left;
               padding: 6px 10px 6px 8px; border-radius: 12px; border: none; cursor: pointer; font: inherit; min-width: 0; user-select: none; -webkit-user-select: none;
               background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--secondary-text-color); --mdc-icon-size: 20px; }
        .dev ha-icon { grid-row: 1 / 3; }
        .dev .dn { font-size: .78em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dev .ds { font-size: .7em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dev.on ha-icon { color: var(--success-color, #4caf50); }
        .dev.on .ds { color: var(--success-color, #4caf50); }
        .dev.na { opacity: .5; }

        .lights { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .lt { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 8px; border-radius: 16px; overflow: hidden; cursor: pointer;
              touch-action: pan-y; user-select: none; -webkit-user-select: none; min-width: 96px;
              background: rgba(127,127,127,.12); color: var(--secondary-text-color); font-size: .8em; font-weight: 600; --mdc-icon-size: 18px; }
        .lt i { position: absolute; inset: 0 auto 0 0; background: rgba(255,193,7,.28); z-index: 0; }
        .lt > :not(i) { position: relative; z-index: 1; }
        .lt.on { color: var(--primary-text-color); }
        .lt.on ha-icon { color: #ffc107; }
        .chip { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px 0 8px; border-radius: 16px; border: 1px solid transparent; cursor: pointer; font: inherit;
                background: rgba(127,127,127,.12); color: var(--primary-text-color); font-size: .78em; font-weight: 500; --mdc-icon-size: 16px; white-space: nowrap; }
        .chip ha-icon { color: var(--secondary-text-color); }
        .chip:hover { background: rgba(127,127,127,.22); }
        .chip.act { border-color: var(--th-accent); color: var(--th-accent); }
        .chip.act ha-icon { color: var(--th-accent); }
        .chip.sw.act { border-color: transparent; background: color-mix(in srgb, var(--th-accent) 22%, transparent); }
      </style>
      <ha-card>
        ${this._screen(src)}
        <div class="body">
          ${sources.length ? `<div class="srcs">${sources.map((s, i) => `
            <button class="src ${src === s || (src && src.name === s.name) ? 'act' : ''}" data-act="source" data-i="${i}" title="Watch ${thEsc(s.name)}">
              <ha-icon icon="${thEsc(s.icon)}"></ha-icon><span>${thEsc(s.name)}</span></button>`).join('')}</div>` : ''}
          ${this._activityRow()}
          ${this._appRow(sources, src)}
          ${rx ? `<div class="audio">
            <button class="ib ${muted ? 'muted' : ''}" data-act="mute" title="${muted ? 'Unmute' : 'Mute'}"><ha-icon icon="${muted ? 'mdi:volume-off' : 'mdi:volume-high'}"></ha-icon></button>
            <button class="ib" data-act="vol" data-d="down" title="Quieter"><ha-icon icon="mdi:minus"></ha-icon></button>
            <div class="vol" data-drag="vol" title="Drag to set the volume"><i style="width:${vol != null ? Math.round(vol * 100) : 0}%"></i><b>${muted ? 'Muted' : this._volLabel(vol)}</b></div>
            <button class="ib" data-act="vol" data-d="up" title="Louder"><ha-icon icon="mdi:plus"></ha-icon></button>
            ${modes.length ? `<select class="mode" title="Sound mode">${modes.map((m) => `<option value="${thEsc(m)}" ${m === cur ? 'selected' : ''}>${thEsc(thTitle(m))}</option>`).join('')}</select>` : ''}
          </div>` : ''}
          ${devHtml ? `<div class="devs">${devHtml}</div>` : ''}
          ${light || sceneHtml || swHtml ? `<div class="lights">
            ${light ? `<div class="lt ${lOn ? 'on' : ''}" data-drag="light" data-hold="${thEsc(c.light)}" title="Tap to toggle, drag to dim, hold for details">
              <i style="width:${bri}%"></i><ha-icon icon="${lOn ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline'}"></ha-icon><span>${lOn ? `${bri}%` : 'Lights off'}</span></div>` : ''}
            ${sceneHtml}${swHtml}
          </div>` : ''}
        </div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
    this._updateProgress();
  }

  _updateProgress() {
    const bar = this.shadowRoot.querySelector('[data-prog]');
    if (!bar || !this._hass || !this._src?.player) return;
    const st = this._hass.states[this._src.player];
    const a = st?.attributes || {};
    const dur = Number(a.media_duration) || 0;
    let pos = Number(a.media_position) || 0;
    if (st?.state === 'playing' && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
    pos = Math.min(pos, dur);
    bar.style.width = `${dur ? (pos / dur) * 100 : 0}%`;
    const t = this.shadowRoot.querySelector('[data-ptime]');
    if (t) t.textContent = `${thTime(pos)} / ${thTime(dur)} · ${thTime(dur - pos)} left`;
  }

  _call(domain, service, data) { this._hass.callService(domain, service, data); }

  // Turn on the projector and receiver, switch inputs, wake the player and run the source's scene.
  _startSource(s) {
    const h = this._hass, c = this._config;
    const wake = (id) => { const st = h.states[id]; if (id && thOff(st) && thCan(st, TH_ON)) this._call('media_player', 'turn_on', { entity_id: id }); };
    wake(c.projector);
    const swOff = c.power_switches.map((x) => x.entity).filter((id) => h.states[id]?.state === 'off');
    if (swOff.length) this._call('homeassistant', 'turn_on', { entity_id: swOff });
    if (c.projector && s.projector_source) this._call('media_player', 'select_source', { entity_id: c.projector, source: s.projector_source });
    if (c.receiver) {
      wake(c.receiver);
      if (s.receiver_source) this._call('media_player', 'select_source', { entity_id: c.receiver, source: s.receiver_source });
    }
    wake(s.player);
    if (s.scene) this._call('scene', 'turn_on', { entity_id: s.scene });
  }

  _allOff() {
    const h = this._hass, c = this._config;
    // Only devices that can be turned off: one unsupported entity would fail the whole call.
    const ids = [c.projector, c.receiver, ...this._sources().map((s) => s.player)]
      .filter((id, i, a) => id && a.indexOf(id) === i && !thOff(h.states[id]) && thCan(h.states[id], TH_OFF));
    if (ids.length) this._call('media_player', 'turn_off', { entity_id: ids });
    const swOn = c.power_switches.map((x) => x.entity).filter((id) => h.states[id]?.state === 'on');
    if (swOn.length) this._call('homeassistant', 'turn_off', { entity_id: swOn });
    if (c.off_scene) this._call('scene', 'turn_on', { entity_id: c.off_scene });
  }

  _onClick(ev) {
    if (this._suppressClick) { this._suppressClick = false; return; }
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const c = this._config, act = el.dataset.act;
    if (act === 'power') {
      if (!this._anyOn()) { const s = this._sources()[0]; if (s) this._startSource(s); else ['projector', 'receiver'].forEach((k) => c[k] && thCan(this._hass.states[c[k]], TH_ON) && this._call('media_player', 'turn_on', { entity_id: c[k] })); return; }
      if (!this._confirm) {
        this._confirm = true; this._lastHtml = null; this._render();
        clearTimeout(this._confirmT);
        this._confirmT = setTimeout(() => { this._confirm = false; this._lastHtml = null; this._render(); }, 3000);
        return;
      }
      clearTimeout(this._confirmT); this._confirm = false; this._allOff(); this._lastHtml = null; this._render();
    } else if (act === 'source') {
      const s = this._sources()[Number(el.dataset.i)];
      if (s) this._startSource(s);
    } else if (act === 'activity') {
      const id = el.dataset.e;
      const domain = id.split('.')[0];
      if (domain === 'scene') this._call('scene', 'turn_on', { entity_id: id });
      else if (domain === 'script') this._call('script', 'turn_on', { entity_id: id });
      else this._call('homeassistant', 'turn_on', { entity_id: id });
    } else if (act === 'app') {
      const s = this._sources()[Number(el.dataset.i)];
      const a = s?.apps[Number(el.dataset.a)];
      if (!s || !a || !s.player) return;
      // Get the room on this source first, then open the app on the player.
      const c2 = this._config, h2 = this._hass;
      const roomOff = [c2.projector, c2.receiver].some((id) => id && thOff(h2.states[id]));
      if (this._src?.name !== s.name || roomOff) this._startSource(s);
      this._call('media_player', 'select_source', { entity_id: s.player, source: a.app });
    } else if (act === 'media') {
      if (this._src?.player) this._call('media_player', el.dataset.s, { entity_id: this._src.player });
    } else if (act === 'mute') {
      const rx = this._hass.states[c.receiver];
      this._call('media_player', 'volume_mute', { entity_id: c.receiver, is_volume_muted: !rx?.attributes?.is_volume_muted });
    } else if (act === 'vol') {
      this._call('media_player', el.dataset.d === 'up' ? 'volume_up' : 'volume_down', { entity_id: c.receiver });
    } else if (act === 'devpower') {
      const st = this._hass.states[el.dataset.e];
      if (!el.dataset.e.startsWith('media_player.')) { this._call('homeassistant', 'toggle', { entity_id: el.dataset.e }); return; }
      const svc = thOff(st) ? 'turn_on' : 'turn_off';
      // No power control on this device (e.g. a DLNA Blu-ray player): show its details instead.
      if (!thCan(st, svc === 'turn_on' ? TH_ON : TH_OFF)) {
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
        return;
      }
      this._call('media_player', svc, { entity_id: el.dataset.e });
    } else if (act === 'scene') {
      this._call('scene', 'turn_on', { entity_id: el.dataset.e });
    } else if (act === 'toggle') {
      this._call('homeassistant', 'toggle', { entity_id: el.dataset.e });
    }
  }

  _onChange(ev) {
    if (ev.target.matches('select.mode')) this._call('media_player', 'select_sound_mode', { entity_id: this._config.receiver, sound_mode: ev.target.value });
  }

  // Volume and light: drag sideways to set, tap the light to toggle, hold either for details.
  _onDown(ev) {
    const hold = ev.target.closest('[data-hold]');
    const el = ev.target.closest('[data-drag]');
    if (hold) {
      clearTimeout(this._holdT);
      this._holdT = setTimeout(() => {
        this._holdT = null; this._drag = null; this._suppressClick = true;
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: hold.dataset.hold }, bubbles: true, composed: true }));
      }, 550);
    }
    if (!el) return;
    const r = el.getBoundingClientRect();
    this._drag = { kind: el.dataset.drag, el, x0: ev.clientX, y0: ev.clientY, r, moved: false };
  }

  _onMove(ev) {
    const d = this._drag;
    if (!d) { if (this._holdT && Math.abs(ev.movementX) + Math.abs(ev.movementY) > 6) { clearTimeout(this._holdT); this._holdT = null; } return; }
    const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this._drag = null; clearTimeout(this._holdT); return; }
      if (Math.abs(dx) < 6) return;
      d.moved = true; clearTimeout(this._holdT); this._holdT = null;
      try { d.el.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
    }
    const pct = Math.max(0, Math.min(1, (ev.clientX - d.r.left) / d.r.width));
    // Paint directly while dragging; the service call happens on release.
    const fill = d.el.querySelector('i');
    if (d.kind === 'vol') {
      d.vol = Math.round(pct * 200) / 200;
      if (fill) fill.style.width = `${d.vol * 100}%`;
      const b = d.el.querySelector('b'); if (b) b.textContent = this._volLabel(d.vol);
    } else {
      d.light = Math.max(1, Math.round(pct * 100));
      if (fill) fill.style.width = `${d.light}%`;
      const t = d.el.querySelector('span'); if (t) t.textContent = `${d.light}%`;
    }
  }

  _onUp() {
    const d = this._drag;
    const wasHold = !this._holdT && this._suppressClick;
    clearTimeout(this._holdT); this._holdT = null;
    this._drag = null;
    if (!d || wasHold) return;
    const c = this._config;
    if (d.moved) {
      this._suppressClick = true;
      setTimeout(() => { this._suppressClick = false; }, 0);
      if (d.kind === 'vol' && d.vol != null) this._call('media_player', 'volume_set', { entity_id: c.receiver, volume_level: d.vol });
      if (d.kind === 'light' && d.light != null) this._call('light', 'turn_on', { entity_id: c.light, brightness_pct: d.light });
    } else if (d.kind === 'light') {
      this._call('light', 'toggle', { entity_id: c.light });
    } else if (d.kind === 'vol') {
      // A tap on the bar jumps there.
      const pct = Math.max(0, Math.min(1, (d.x0 - d.r.left) / d.r.width));
      this._call('media_player', 'volume_set', { entity_id: c.receiver, volume_level: Math.round(pct * 200) / 200 });
    }
  }

  getCardSize() { return 6; }

  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('theater-card-editor');
  }

  static getStubConfig(hass) {
    const mp = Object.keys(hass?.states || {}).filter((id) => id.startsWith('media_player.'));
    const dc = (id) => hass.states[id].attributes.device_class;
    return { title: 'Movie Room', projector: mp.find((id) => dc(id) === 'projector'), receiver: mp.find((id) => dc(id) === 'receiver') };
  }
}

customElements.define('theater-card', TheaterCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'theater-card',
  name: 'Theater Card',
  description: 'Projector, receiver and players on one card: now playing, one-tap sources, volume and sound mode, device power and room lights.',
  preview: false,
});

class TheaterCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Room', icon: 'mdi:theater', schema: [
        f.text('title', 'Title', 'Default: Movie Room'),
        f.grid(f.entity('projector', 'Projector', '', 'media_player'), f.entity('receiver', 'Receiver / sound system', '', 'media_player')),
        f.grid(f.toggle('volume_db', 'Show volume in dB', 'Default: on for Denon / Marantz'), f.entity('off_scene', 'Scene when turning off', '', 'scene')),
        { name: 'power_switches', label: 'Power with the room', helper: 'Switches turned on with any source and off with "all off", e.g. the Hue Sync Box',
          selector: { entity: { multiple: true, filter: [{ domain: 'switch' }, { domain: 'input_boolean' }] } } },
        { name: 'device_order', label: 'Device tile order', helper: 'Tile names or entity ids, in order (e.g. Projector, Receiver, Sync Box). Unlisted tiles follow.',
          selector: { text: { multiple: true } } },
      ] },
      { title: 'Sources', icon: 'mdi:video-input-hdmi', list: {
        key: 'sources',
        schema: [
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.grid(f.entity('player', 'Player', 'Shown on the screen when it plays', 'media_player'), f.text('receiver_source', 'Receiver input', 'Default: matched by name')),
          f.grid(f.text('projector_source', 'Projector input'), f.entity('scene', 'Scene', '', 'scene')),
          { name: 'apps', label: 'App buttons', helper: "App names as the player lists them, e.g. Netflix, Prime Video", selector: { select: { multiple: true, custom_value: true, options: [] } } },
        ],
        label: (s, i) => s.name || s.player || `Source ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add source',
        collapsible: true,
      } },
      { title: 'Activities', icon: 'mdi:play-box-multiple', schema: [
        { name: 'activities', label: 'Activity buttons', helper: 'Scenes or scripts, e.g. "Netflix night" that turns everything on and opens Netflix',
          selector: { entity: { multiple: true, filter: [{ domain: 'scene' }, { domain: 'script' }] } } },
      ] },
      { title: 'Lights', icon: 'mdi:lightbulb-group', schema: [
        f.entity('light', 'Room light', 'Tap toggles, drag dims', 'light'),
        f.entities('scenes', 'Scenes (up to 4)', '', 'scene'),
        f.entities('switches', 'Switches', 'e.g. Hue Sync', 'switch'),
      ] },
    ];
  }
}

customElements.define('theater-card-editor', TheaterCardEditor);
