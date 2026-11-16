/**
 * Now Playing Card for Home Assistant
 *
 * "What's playing anywhere": every listed media player that is playing or
 * paused, stacked, with the first one as a large hero row (blurred artwork,
 * title, series / artist, room, progress and controls). Understands JellyHA
 * user players (title, image_url / backdrop_url, progress_percent, device_name)
 * as well as Apple TV, Music Assistant, Sonos, Spotify, Cast and the rest.
 *
 * Tap a row for more-info; long-press it (or Shift+Enter) to open
 * `navigation_path`.
 *
 * Configuration:
 *   type: custom:now-playing-card
 *   title: Now playing                 # Optional
 *   entities:                          # In priority order
 *     - media_player.jellyha_alex
 *     - entity: media_player.family_room_apple_tv
 *       name: Family Room              # Optional: room / device label
 *   hide_when_idle: true               # Hide the card when nothing plays (default true)
 *   max_items: 3                       # Rows shown (default 3)
 *   navigation_path: /lovelace/media   # Optional: long-press target
 */

const npEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const npItem = (v) => (typeof v === 'string' ? { entity: v } : v && typeof v === 'object' && v.entity ? v : null);
const NP_PAUSE = 1, NP_PREV = 16, NP_NEXT = 32, NP_PLAY = 16384;
const npCan = (st, bit) => (Number(st?.attributes?.supported_features) & bit) === bit;
const NP_TICKS = 1e7;   // Jellyfin ticks per second
const NP_HOLD_MS = 550;

function npTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

// Everything the card shows about one player, whatever integration it is.
function npInfo(hass, item) {
  const st = hass.states[item.entity];
  if (!st) return null;
  const a = st.attributes || {};
  const jelly = 'progress_percent' in a || 'position_ticks' in a;
  const paused = st.state === 'paused' || (jelly && a.is_paused === true);
  const active = ['playing', 'paused', 'buffering'].includes(st.state) || (jelly && !!a.title && !!a.item_id);
  if (!active) return { st, active: false };

  let title = a.media_title || a.title || a.media_series_title || a.app_name || '';
  let sub = '';
  if (a.media_series_title && a.media_title) {
    const se = a.media_season != null && a.media_episode != null ? `S${a.media_season}E${String(a.media_episode).padStart(2, '0')} · ` : '';
    title = a.media_series_title;
    sub = `${se}${a.media_title}`;
  } else if (a.media_artist) {
    sub = [a.media_artist, a.media_album_name].filter(Boolean).join(' · ');
  } else if (jelly && a.title) {
    // JellyHA titles may carry the series: "Show - S01E02 - Name" or "Show S01E02 - Name".
    const m = String(a.title).match(/^(.*?)\s*(?:-\s*)?(S\d+E\d+)\s*-\s*(.*)$/i);
    if (m) { title = m[1]; sub = `${m[2]} · ${m[3]}`; } else if (a.media_type) sub = String(a.media_type);
  } else if (a.app_name && title !== a.app_name) {
    sub = a.app_name;
  }

  const who = jelly && a.user_name ? a.user_name : '';
  const room = item.name || a.device_name || String(a.friendly_name || item.entity).replace(/^JellyHA User\s+/i, '');
  const art = a.entity_picture || a.image_url || a.entity_picture_local || '';
  const backdrop = a.backdrop_url || a.entity_picture || a.image_url || '';

  // Progress: seconds when we have them, else a bare percentage.
  let pos = null, dur = null, pct = null;
  if (a.media_duration > 0 && a.media_position != null) {
    dur = Number(a.media_duration);
    pos = Number(a.media_position);
    if (st.state === 'playing' && a.media_position_updated_at) {
      pos += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
    }
    pos = Math.min(pos, dur);
  } else if (Number(a.duration_ticks) > 0) {
    dur = a.duration_ticks / NP_TICKS;
    pos = Number(a.position_ticks || 0) / NP_TICKS;
  }
  if (dur) pct = (pos / dur) * 100;
  else if (Number.isFinite(Number(a.progress_percent)) && Number(a.progress_percent) > 0) pct = Number(a.progress_percent);

  return {
    st, active: true, paused, title: title || 'Playing', sub, who, room, art, backdrop, pos, dur, pct,
    canPause: npCan(st, NP_PAUSE) || npCan(st, NP_PLAY), canPrev: npCan(st, NP_PREV), canNext: npCan(st, NP_NEXT),
    ticking: st.state === 'playing' && !!a.media_position_updated_at && dur > 0,
  };
}

class NowPlayingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._warned = new Set();
    const sr = this.shadowRoot;
    sr.addEventListener('pointerdown', (ev) => this._down(ev));
    sr.addEventListener('pointerup', (ev) => this._up(ev));
    sr.addEventListener('pointercancel', () => this._cancelHold());
    sr.addEventListener('pointermove', (ev) => { if (this._hold && Math.hypot(ev.clientX - this._hold.x, ev.clientY - this._hold.y) > 10) this._cancelHold(); });
    sr.addEventListener('contextmenu', (ev) => { if (ev.target.closest('.row')) ev.preventDefault(); });
    sr.addEventListener('keydown', (ev) => this._key(ev));
    sr.addEventListener('click', (ev) => this._click(ev));
  }

  setConfig(config) {
    const entities = (Array.isArray(config?.entities) ? config.entities : []).map(npItem).filter(Boolean);
    this._config = { hide_when_idle: true, max_items: 3, ...config, entities };
    this._lastHtml = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (old && this._config.entities.every((e) => old.states[e.entity] === hass.states[e.entity])) return;
    this._render();
  }

  connectedCallback() { this._tick = setInterval(() => this._updateProgress(), 1000); }
  disconnectedCallback() { clearInterval(this._tick); this._cancelHold(); }

  _rows() {
    const h = this._hass;
    const rows = [];
    for (const item of this._config.entities) {
      const info = npInfo(h, item);
      if (!info) {
        if (!this._warned.has(item.entity)) { this._warned.add(item.entity); console.warn(`now-playing-card: ${item.entity} not found`); }
        continue;
      }
      if (info.active) rows.push({ item, ...info });
    }
    // Playing before paused, keeping the configured priority within each.
    return rows.sort((x, y) => Number(x.paused) - Number(y.paused)).slice(0, Math.max(1, Number(this._config.max_items) || 3));
  }

  _controls(r, i, big) {
    const btn = (act, icon, label, on = true) => (on ? `<button class="ctl ${big ? 'big' : ''}" data-act="${act}" data-i="${i}" aria-label="${label}"><ha-icon icon="${icon}"></ha-icon></button>` : '');
    return `<div class="ctls">
        ${big ? btn('prev', 'mdi:skip-previous', 'Previous', r.canPrev) : ''}
        ${btn('playpause', r.paused ? 'mdi:play' : 'mdi:pause', r.paused ? 'Play' : 'Pause', r.canPause)}
        ${big ? btn('next', 'mdi:skip-next', 'Next', r.canNext) : ''}
      </div>`;
  }

  _progress(r, i) {
    if (r.pct == null) return '';
    const times = r.dur ? `<span class="t" data-pos="${i}">${npTime(r.pos)}</span><span class="t">${npTime(r.dur)}</span>` : '';
    return `<div class="prog" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.pct)}">
        <div class="bar"><i data-bar="${i}" style="width:${r.pct.toFixed(2)}%"></i></div>${times ? `<div class="times">${times}</div>` : ''}</div>`;
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const rows = this._rows();
    this._shown = rows;
    const editing = this.editMode || this.preview;
    const hidden = !rows.length && c.hide_when_idle !== false && !editing && c.entities.length > 0;
    const label = (r) => [r.who, r.room].filter(Boolean).join(' · ');

    const body = rows.map((r, i) => {
      const where = label(r);
      const aria = `${r.title}${r.sub ? `, ${r.sub}` : ''}${where ? `, ${where}` : ''}${r.paused ? ', paused' : ''}`;
      if (i === 0) {
        return `<div class="row hero ${r.paused ? 'paused' : ''}" data-i="0" tabindex="0" role="button" aria-label="${npEsc(aria)}">
            ${r.backdrop ? `<div class="bg" style="background-image:url('${npEsc(r.backdrop)}')"></div>` : '<div class="bg none"></div>'}
            <div class="shade"></div>
            <div class="hero-in">
              ${r.art ? `<img class="art" src="${npEsc(r.art)}" alt="" loading="lazy">` : '<div class="art ph"><ha-icon icon="mdi:play-circle-outline"></ha-icon></div>'}
              <div class="meta">
                ${where ? `<div class="where"><ha-icon icon="${r.paused ? 'mdi:pause-circle' : 'mdi:play-circle'}"></ha-icon>${npEsc(where)}</div>` : ''}
                <div class="title">${npEsc(r.title)}</div>
                ${r.sub ? `<div class="sub">${npEsc(r.sub)}</div>` : ''}
              </div>
            </div>
            <div class="hero-foot">${this._progress(r, 0)}${this._controls(r, 0, true)}</div>
          </div>`;
      }
      return `<div class="row mini ${r.paused ? 'paused' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${npEsc(aria)}">
          ${r.art ? `<img class="thumb" src="${npEsc(r.art)}" alt="" loading="lazy">` : '<div class="thumb ph"><ha-icon icon="mdi:music-note"></ha-icon></div>'}
          <div class="meta">
            <div class="title">${npEsc(r.title)}</div>
            <div class="sub">${npEsc([r.sub, where].filter(Boolean).join(' · '))}</div>
            ${r.pct != null ? `<div class="bar thin"><i data-bar="${i}" style="width:${r.pct.toFixed(2)}%"></i></div>` : ''}
          </div>
          ${this._controls(r, i, false)}
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: ${hidden ? 'none' : 'block'}; min-width: 0; }
        ha-card { overflow: hidden; padding: ${c.title ? '12px' : '0'} 0 ${rows.length > 1 ? '8px' : '0'}; }
        .head { margin: 0 16px 10px; font-size: 1.1em; font-weight: 500; color: var(--primary-text-color); }
        .row { position: relative; cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; user-select: none; }
        .row:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color); }
        .hero { color: #fff; min-height: 168px; display: flex; flex-direction: column; justify-content: space-between;
          border-radius: ${c.title ? '0' : `var(--ha-card-border-radius, 20px) var(--ha-card-border-radius, 20px) ${rows.length > 1 ? '0 0' : 'var(--ha-card-border-radius, 20px) var(--ha-card-border-radius, 20px)'}`}; overflow: hidden; }
        .bg { position: absolute; inset: -24px; background: center / cover no-repeat; filter: blur(22px) saturate(1.3); transform: scale(1.1); }
        .bg.none { background: linear-gradient(135deg, rgba(var(--rgb-primary-color, 3, 169, 244), .55), rgba(var(--rgb-primary-color, 3, 169, 244), .15)); filter: none; }
        .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.65)); }
        .hero-in { position: relative; display: flex; gap: 14px; padding: 16px 16px 8px; align-items: flex-end; min-width: 0; }
        .art { width: 84px; height: 84px; flex: none; border-radius: 12px; object-fit: cover; box-shadow: 0 6px 18px rgba(0,0,0,.35); background: rgba(255,255,255,.08); }
        .art.ph { display: grid; place-items: center; --mdc-icon-size: 40px; color: rgba(255,255,255,.7); }
        .meta { min-width: 0; flex: 1; }
        .where { display: flex; align-items: center; gap: 4px; font-size: .78em; opacity: .85; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
        .where ha-icon { --mdc-icon-size: 16px; }
        .hero .title { font-size: 1.35em; font-weight: 600; line-height: 1.2; margin-top: 4px;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .hero .sub { opacity: .85; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hero-foot { position: relative; display: flex; align-items: center; gap: 12px; padding: 4px 12px 12px 16px; }
        .hero-foot .prog { flex: 1; min-width: 0; }
        .bar { height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); overflow: hidden; }
        .bar i { display: block; height: 100%; background: #fff; border-radius: 2px; transition: width 1s linear; }
        .times { display: flex; justify-content: space-between; font-size: .72em; opacity: .8; margin-top: 4px; font-variant-numeric: tabular-nums; }
        .ctls { display: flex; align-items: center; gap: 2px; flex: none; }
        .ctl { width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer;
          display: grid; place-items: center; padding: 0; }
        .ctl.big { width: 44px; height: 44px; }
        .ctl:hover { background: rgba(127,127,127,.18); }
        .ctl:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
        .hero .ctl[data-act=playpause] { background: rgba(255,255,255,.92); color: #111; }
        .mini { display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; color: var(--primary-text-color); }
        .mini:hover { background: rgba(127,127,127,.06); }
        .thumb { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; flex: none; background: var(--secondary-background-color); }
        .thumb.ph { display: grid; place-items: center; color: var(--secondary-text-color); }
        .mini .title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mini .sub { font-size: .85em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar.thin { height: 3px; margin-top: 6px; background: var(--divider-color, rgba(127,127,127,.2)); }
        .bar.thin i { background: var(--primary-color); }
        .paused .title { opacity: .8; }
        .empty { display: flex; align-items: center; gap: 10px; padding: 16px; color: var(--secondary-text-color); }
        @media (prefers-reduced-motion: reduce) { .bar i { transition: none; } }
      </style>
      <ha-card>
        ${c.title ? `<div class="head">${npEsc(c.title)}</div>` : ''}
        ${body || `<div class="empty"><ha-icon icon="mdi:television-off"></ha-icon>${c.entities.length ? 'Nothing playing' : 'Add media players under entities'}</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // Move progress bars along without rebuilding the card.
  _updateProgress() {
    if (!this._hass || !this._shown?.some((r) => r.ticking)) return;
    this._shown.forEach((r, i) => {
      if (!r.ticking) return;
      const fresh = npInfo(this._hass, r.item);
      if (!fresh?.dur) return;
      const bar = this.shadowRoot.querySelector(`[data-bar="${i}"]`);
      if (bar) bar.style.width = `${((fresh.pos / fresh.dur) * 100).toFixed(2)}%`;
      const t = this.shadowRoot.querySelector(`[data-pos="${i}"]`);
      if (t) t.textContent = npTime(fresh.pos);
    });
  }

  // ── Interaction ──────────────────────────────────────────────────────────
  _row(ev) { return ev.target.closest('.row[data-i]'); }

  _down(ev) {
    if (ev.target.closest('.ctl')) return;
    const row = this._row(ev);
    if (!row || ev.button > 0) return;
    this._hold = { row, x: ev.clientX, y: ev.clientY, fired: false, t: setTimeout(() => { this._hold.fired = true; this._navigate(); }, NP_HOLD_MS) };
  }

  _up(ev) {
    const h = this._hold;
    this._cancelHold();
    if (!h || h.fired || ev.target.closest('.ctl') || this._row(ev) !== h.row) return;
    this._moreInfo(Number(h.row.dataset.i));
  }

  _cancelHold() { if (this._hold) clearTimeout(this._hold.t); this._hold = null; }

  _key(ev) {
    const row = ev.target.closest?.('.row[data-i]');
    if (!row || ev.target !== row || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    if (ev.shiftKey) this._navigate(); else this._moreInfo(Number(row.dataset.i));
  }

  _click(ev) {
    const b = ev.target.closest('.ctl[data-act]');
    if (!b) return;
    ev.stopPropagation();
    const r = this._shown?.[Number(b.dataset.i)];
    if (!r) return;
    const svc = { playpause: 'media_play_pause', prev: 'media_previous_track', next: 'media_next_track' }[b.dataset.act];
    if (svc) this._hass.callService('media_player', svc, { entity_id: r.item.entity });
  }

  _moreInfo(i) {
    const r = this._shown?.[i];
    if (r) window.RusstumShared.act(this, this._hass, r.item.tap_action || { action: 'more-info' }, r.item.entity);
  }

  _navigate() {
    if (this._config.navigation_path) {
      window.RusstumShared.act(this, this._hass, { action: 'navigate', navigation_path: this._config.navigation_path });
    }
  }

  getCardSize() { return 2 + Math.max(0, (this._shown?.length || 1) - 1); }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('now-playing-card-editor');
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((id) => id.startsWith('media_player.'));
    const playing = ids.filter((id) => ['playing', 'paused'].includes(hass.states[id].state));
    return { entities: [...new Set([...playing, ...ids])].slice(0, 4), hide_when_idle: false };
  }
}

customElements.define('now-playing-card', NowPlayingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'now-playing-card',
  name: 'Now Playing Card',
  description: "What's playing anywhere: a blurred-artwork hero for the top player, then compact rows. JellyHA aware.",
  preview: true,
});

class NowPlayingCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:play-box-multiple', schema: [
        f.text('title', 'Title', 'Optional'),
        f.grid(f.toggle('hide_when_idle', 'Hide when nothing plays', 'Default: on'), f.number('max_items', 'Rows shown', { min: 1, max: 10, helper: 'Default: 3' })),
        f.text('navigation_path', 'Long-press opens', 'e.g. /lovelace/media'),
      ] },
      { title: 'Players', icon: 'mdi:speaker-multiple', list: {
        key: 'entities',
        label: (e, i) => (typeof e === 'string' ? e : e.name || e.entity) || `Player ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add player',
        schema: [f.grid(f.entity('entity', 'Media player', 'Earlier = higher priority', 'media_player'), f.text('name', 'Room name', 'Optional'))],
      } },
    ];
  }

  // The list editor works on objects; accept plain entity IDs from YAML.
  setConfig(config) {
    super.setConfig({ ...config, entities: (config.entities || []).map((e) => (typeof e === 'string' ? { entity: e } : e)) });
  }
}

customElements.define('now-playing-card-editor', NowPlayingCardEditor);
