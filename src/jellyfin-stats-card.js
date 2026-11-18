/**
 * Jellyfin Stats Card for Home Assistant
 *
 * Library and watch stats from the JellyHA integration:
 *   • KPI tiles: library size (movies / series / episodes), storage, active sessions
 *   • Watched-percentage rings for movies, series and episodes
 *   • Latest movie and episode added, with posters
 *   • "Added this month" from the recorder's long-term statistics of the
 *     library count (falls back to recent history)
 *   • Optional per-person watch time (see `watch_time` below)
 *
 * Every sensor is found automatically by JellyHA's names (with or without an
 * area prefix such as "server_room_"); override any of them under `entities`.
 *
 * Configuration:
 *   type: custom:jellyfin-stats-card
 *   title: Jellyfin                       # Optional
 *   added_this_month: true                # Default true
 *   entities:                             # All optional
 *     library: sensor.jellyha_library
 *     storage: sensor.jellyha_library_movies_storage_size
 *     active_sessions: sensor.jellyha_active_sessions
 *     movies_watched_pct: sensor.jellyha_library_movies_watched_percentage
 *     series_watched_pct: sensor.jellyha_library_series_watched_percentage
 *     episodes_watched_pct: sensor.jellyha_library_episodes_watched_percentage
 *     watched_movies / unwatched_movies / watched_episodes / unwatched_episodes: …
 *     latest_movie: sensor.jellyha_latest_movie
 *     latest_episode: sensor.jellyha_latest_episode
 *   # …or the same as flat keys, e.g. library_entity: sensor.jellyha_library (what the editor writes)
 *   watch_time:                           # Optional extension point: one sensor per person
 *     - entity: sensor.alex_jellyfin_watch_time   # hours (or minutes; the unit is read)
 *       name: Alex
 *
 * JellyHA doesn't report watch time per person. If you get it elsewhere (for
 * example a REST sensor over the Playback Reporting plugin's API), list those
 * sensors under watch_time and the card draws a bar per person.
 */

const jsEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const JS_NA = ['unavailable', 'unknown', ''];

// Role → JellyHA object-id suffix used to find each sensor.
const JS_ROLES = {
  library: 'jellyha_library',
  storage: 'jellyha_library_movies_storage_size',
  active_sessions: 'jellyha_active_sessions',
  movies_watched_pct: 'jellyha_library_movies_watched_percentage',
  series_watched_pct: 'jellyha_library_series_watched_percentage',
  episodes_watched_pct: 'jellyha_library_episodes_watched_percentage',
  watched_movies: 'jellyha_watched_movies',
  unwatched_movies: 'jellyha_unwatched_movies',
  watched_episodes: 'jellyha_watched_episodes',
  unwatched_episodes: 'jellyha_unwatched_episodes',
  latest_movie: 'jellyha_latest_movie',
  latest_episode: 'jellyha_latest_episode',
};

function jsNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function jsFmt(n) { return n == null ? '–' : Math.round(n).toLocaleString(); }

function jsBytes(st) {
  if (!st || JS_NA.includes(st.state)) return null;
  const a = st.attributes;
  const unit = String(a.unit_of_measurement || '').toUpperCase();
  let gb = jsNum(st.state);
  if (gb == null) return null;
  if (unit === 'TB' || unit === 'TIB') gb *= 1000;
  else if (unit === 'MB' || unit === 'MIB') gb /= 1000;
  return gb >= 1000 ? `${(gb / 1000).toFixed(gb >= 10000 ? 0 : 1)} TB` : `${Math.round(gb)} GB`;
}

function jsAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

class JellyfinStatsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._month = null;          // { key, start, value, at }
    this._monthBusy = false;
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    this._config = { added_this_month: true, ...config, entities: { ...(config.entities || {}) },
      watch_time: (Array.isArray(config.watch_time) ? config.watch_time : []).map((w) => (typeof w === 'string' ? { entity: w } : w)).filter((w) => w?.entity) };
    this._resolvedFor = null;
    this._lastHtml = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    this._resolve();
    this._maybeMonth();
    if (old && this._watched().every((id) => old.states[id] === hass.states[id])) return;
    this._render();
  }

  // Find each role's sensor: configured, else sensor.<suffix>, else sensor.<anything>_<suffix>.
  _resolve() {
    const h = this._hass;
    if (this._resolvedFor === h.states && this._ids) return;
    const ids = Object.keys(h.states).filter((id) => id.startsWith('sensor.') && id.includes('jellyha'));
    this._ids = {};
    for (const [role, suffix] of Object.entries(JS_ROLES)) {
      this._ids[role] = this._config.entities[role] || this._config[`${role}_entity`]
        || (h.states[`sensor.${suffix}`] ? `sensor.${suffix}` : ids.find((id) => id.endsWith(`_${suffix}`)));
    }
    this._resolvedFor = h.states;
  }

  _watched() { return [...Object.values(this._ids || {}), ...this._config.watch_time.map((w) => w.entity)].filter(Boolean); }

  _st(role) { const id = this._ids?.[role]; return id ? this._hass.states[id] : undefined; }

  // ── Added this month ─────────────────────────────────────────────────────
  async _maybeMonth() {
    const id = this._ids?.library;
    if (!this._config.added_this_month || !id || this._monthBusy || typeof this._hass.callWS !== 'function') return;
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const key = `${id}|${start.toISOString()}`;
    if (this._month?.key === key && Date.now() - this._month.at < 60 * 60 * 1000) return;
    this._monthBusy = true;
    let value = null;
    try {
      // Long-term statistics keep the count beyond the recorder's purge window.
      const stats = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(),
        statistic_ids: [id], period: 'day', types: ['mean', 'min'] });
      const first = stats?.[id]?.find((r) => jsNum(r.min ?? r.mean) != null);
      if (first) value = jsNum(first.min ?? first.mean);
    } catch (e) { /* statistics not available: try history */ }
    if (value == null) {
      try {
        const hist = await this._hass.callWS({ type: 'history/history_during_period', start_time: start.toISOString(),
          entity_ids: [id], minimal_response: true, no_attributes: true, include_start_time_state: true });
        const first = hist?.[id]?.find((r) => jsNum(r.s) != null);
        if (first) value = jsNum(first.s);
      } catch (e) { console.warn('jellyfin-stats-card: no history for', id, e); }
    }
    this._month = { key, at: Date.now(), value, start };
    this._monthBusy = false;
    this._lastHtml = null;
    this._render();
  }

  // ── Pieces ───────────────────────────────────────────────────────────────
  _tile(role, icon, label, value, sub, extra = '') {
    const id = this._ids?.[role];
    const st = id ? this._hass.states[id] : null;
    const na = !st || JS_NA.includes(st.state);
    return `<button class="kpi ${na ? 'na' : ''} ${extra}" data-act="more" data-e="${jsEsc(id || '')}" ${id ? '' : 'disabled'}
        aria-label="${jsEsc(`${label}: ${na ? 'unavailable' : value}${sub ? `, ${sub}` : ''}`)}">
        <ha-icon icon="${icon}"></ha-icon>
        <span class="kv">${jsEsc(na ? '–' : value)}</span>
        <span class="kl">${jsEsc(label)}</span>
        ${sub && !na ? `<span class="ks">${jsEsc(sub)}</span>` : ''}
      </button>`;
  }

  _ring(role, label, fallback) {
    const st = this._st(role);
    let pct = st && !JS_NA.includes(st.state) ? jsNum(st.state) : null;
    let watched = jsNum(st?.attributes?.watched), total = jsNum(st?.attributes?.total);
    if (pct == null && fallback) {
      const w = jsNum(this._st(fallback[0])?.state), u = jsNum(this._st(fallback[1])?.state);
      if (w != null && u != null && w + u > 0) { watched = w; total = w + u; pct = (w / total) * 100; }
    }
    const r = 30, C = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, pct ?? 0));
    const id = this._ids?.[role] || (fallback && this._ids?.[fallback[0]]) || '';
    return `<button class="ring ${pct == null ? 'na' : ''}" data-act="more" data-e="${jsEsc(id)}" ${id ? '' : 'disabled'}
        aria-label="${jsEsc(`${label} watched: ${pct == null ? 'unavailable' : `${Math.round(p)}%`}`)}">
        <svg viewBox="0 0 72 72" aria-hidden="true">
          <circle cx="36" cy="36" r="${r}" class="track"/>
          <circle cx="36" cy="36" r="${r}" class="val" stroke-dasharray="${((p / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 36 36)"/>
          <text x="36" y="40" text-anchor="middle">${pct == null ? '–' : `${Math.round(p)}%`}</text>
        </svg>
        <span class="rl">${jsEsc(label)}</span>
        ${watched != null && total != null ? `<span class="rs">${jsFmt(watched)} of ${jsFmt(total)}</span>` : ''}
      </button>`;
  }

  _latest(role, kind) {
    const st = this._st(role);
    if (!st) return '';
    const a = st.attributes || {};
    const na = JS_NA.includes(st.state);
    const poster = window.RusstumShared.resolveImageUrl(this._hass, a.series_poster_url || a.poster_url);
    const title = kind === 'episode' ? (a.series_name || st.state) : (a.title || a.name || st.state);
    const sub = kind === 'episode'
      ? [a.season != null && a.episode != null ? `S${a.season}E${String(a.episode).padStart(2, '0')}` : '', a.episode_name].filter(Boolean).join(' · ')
      : [a.year, a.official_rating, a.runtime_minutes ? `${a.runtime_minutes} min` : ''].filter(Boolean).join(' · ');
    const added = a.date_added ? `Added ${jsAgo(a.date_added)}` : '';
    return `<button class="latest ${na ? 'na' : ''}" data-act="more" data-e="${jsEsc(st.entity_id)}" aria-label="${jsEsc(`Latest ${kind}: ${title}. ${sub}. ${added}`)}">
        ${poster && !na ? `<img src="${jsEsc(poster)}" alt="" loading="lazy">` : `<div class="ph"><ha-icon icon="${kind === 'episode' ? 'mdi:television-classic' : 'mdi:movie-open'}"></ha-icon></div>`}
        <div class="lm">
          <span class="lk">Latest ${kind}</span>
          <span class="lt">${jsEsc(na ? 'Unavailable' : title)}</span>
          ${sub && !na ? `<span class="ls">${jsEsc(sub)}</span>` : ''}
          ${added && !na ? `<span class="ls">${jsEsc(added)}</span>` : ''}
        </div>
      </button>`;
  }

  _watchTime() {
    const h = this._hass;
    const rows = this._config.watch_time.map((w) => {
      const st = h.states[w.entity];
      let v = st && !JS_NA.includes(st.state) ? jsNum(st.state) : null;
      const unit = String(st?.attributes?.unit_of_measurement || 'h').toLowerCase();
      if (v != null && (unit === 'min' || unit === 'minutes')) v /= 60;
      if (v != null && (unit === 's' || unit === 'seconds')) v /= 3600;
      return { w, st, v, name: w.name || st?.attributes?.friendly_name || w.entity };
    });
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((r) => r.v || 0));
    return `<div class="block"><div class="bh">Watch time</div>
        ${rows.map((r) => `<button class="wt ${r.v == null ? 'na' : ''}" data-act="more" data-e="${jsEsc(r.w.entity)}" aria-label="${jsEsc(`${r.name}: ${r.v == null ? 'unavailable' : `${r.v.toFixed(1)} hours`}`)}">
            <span class="wn">${jsEsc(r.name)}</span>
            <span class="wb"><i style="width:${r.v == null ? 0 : ((r.v / max) * 100).toFixed(1)}%"></i></span>
            <span class="wv">${r.v == null ? '–' : `${r.v.toFixed(r.v < 10 ? 1 : 0)} h`}</span>
          </button>`).join('')}
      </div>`;
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    this._resolve();
    const lib = this._st('library'), sessions = this._st('active_sessions');
    const la = lib?.attributes || {};
    const libSub = [la.movies != null ? `${jsFmt(la.movies)} movies` : '', la.series != null ? `${jsFmt(la.series)} series` : '',
      la.episodes != null ? `${jsFmt(la.episodes)} episodes` : ''].filter(Boolean).join(' · ');
    const sess = Array.isArray(sessions?.attributes?.sessions) ? sessions.attributes.sessions : [];
    const who = [...new Set(sess.map((s) => s?.user_name || s?.user || s?.UserName).filter(Boolean))].join(', ');
    const storage = this._st('storage');
    const storageSub = storage?.attributes?.library_name ? `${storage.attributes.library_name} library` : '';

    let month = '';
    if (c.added_this_month && this._month && this._month.value != null && lib && jsNum(lib.state) != null) {
      const n = jsNum(lib.state) - this._month.value;
      const name = new Date().toLocaleDateString(undefined, { month: 'long' });
      month = `<div class="month"><ha-icon icon="mdi:calendar-plus"></ha-icon><span><b>${n > 0 ? `+${jsFmt(n)}` : jsFmt(Math.max(0, n))}</b> ${n === 1 ? 'title' : 'titles'} added in ${jsEsc(name)}</span></div>`;
    }

    const latest = this._latest('latest_movie', 'movie') + this._latest('latest_episode', 'episode');
    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 16px; overflow: hidden; }
        h2 { margin: 0 0 12px; font-size: 1.15em; font-weight: 500; color: var(--primary-text-color); }
        button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
        button:disabled { cursor: default; }
        .na { opacity: .5; }
        .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
        .kpi { display: grid; justify-items: start; gap: 2px; padding: 12px; border: 0; border-radius: 16px; text-align: left; cursor: pointer;
          background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--primary-text-color); min-width: 0; }
        .kpi ha-icon { --mdc-icon-size: 20px; color: var(--primary-color); margin-bottom: 4px; }
        .kpi .kv { font-size: 1.5em; font-weight: 600; line-height: 1.1; }
        .kpi .kl { font-size: .8em; color: var(--secondary-text-color); font-weight: 500; }
        .kpi .ks { font-size: .72em; color: var(--secondary-text-color); line-height: 1.3; }
        .kpi.live .kv { color: var(--success-color, #4caf50); }
        .month { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: .9em; color: var(--secondary-text-color); }
        .month ha-icon { --mdc-icon-size: 18px; color: var(--primary-color); }
        .month b { color: var(--primary-text-color); }
        .block { margin-top: 16px; }
        .bh { font-size: .8em; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color); margin-bottom: 8px; }
        .rings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .ring { display: grid; justify-items: center; gap: 2px; padding: 4px 0; border: 0; background: none; cursor: pointer; min-width: 0; }
        .ring svg { width: min(84px, 100%); height: auto; }
        .ring .track { fill: none; stroke: var(--divider-color, rgba(127,127,127,.2)); stroke-width: 7; }
        .ring .val { fill: none; stroke: var(--primary-color); stroke-width: 7; stroke-linecap: round; transition: stroke-dasharray .6s ease; }
        .ring text { font-size: 15px; font-weight: 600; fill: var(--primary-text-color); }
        .ring .rl { font-size: .85em; font-weight: 500; color: var(--primary-text-color); }
        .ring .rs { font-size: .72em; color: var(--secondary-text-color); }
        .latests { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
        .latest { display: flex; gap: 12px; align-items: center; padding: 8px; border: 0; border-radius: 16px; text-align: left; cursor: pointer;
          background: var(--secondary-background-color, rgba(127,127,127,.1)); color: var(--primary-text-color); min-width: 0; }
        .latest img, .latest .ph { width: 52px; height: 78px; flex: none; border-radius: 10px; object-fit: cover; background: rgba(127,127,127,.15); }
        .latest .ph { display: grid; place-items: center; color: var(--secondary-text-color); }
        .lm { display: grid; gap: 1px; min-width: 0; }
        .lk { font-size: .72em; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--primary-color); }
        .lt { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ls { font-size: .8em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wt { display: grid; grid-template-columns: minmax(60px, auto) 1fr auto; align-items: center; gap: 10px; width: 100%; padding: 6px 0;
          border: 0; background: none; cursor: pointer; text-align: left; }
        .wn { font-size: .9em; font-weight: 500; }
        .wb { height: 8px; border-radius: 4px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .wb i { display: block; height: 100%; border-radius: 4px; background: var(--primary-color); }
        .wv { font-size: .85em; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .empty { color: var(--secondary-text-color); padding: 8px 0; }
        @media (prefers-reduced-motion: reduce) { .ring .val { transition: none; } }
      </style>
      <ha-card>
        ${c.title ? `<h2>${jsEsc(c.title)}</h2>` : ''}
        ${!this._ids?.library && !this._ids?.movies_watched_pct ? '<div class="empty">No JellyHA sensors found. Set them under <code>entities</code>.</div>' : ''}
        <div class="kpis">
          ${this._tile('library', 'mdi:filmstrip-box-multiple', 'Titles', jsFmt(jsNum(lib?.state)), libSub)}
          ${this._tile('storage', 'mdi:harddisk', 'Storage', jsBytes(storage) || '–', storageSub)}
          ${this._tile('active_sessions', 'mdi:play-network', 'Watching now', jsFmt(jsNum(sessions?.state)), who, jsNum(sessions?.state) > 0 ? 'live' : '')}
        </div>
        ${month}
        <div class="block"><div class="bh">Watched</div><div class="rings">
          ${this._ring('movies_watched_pct', 'Movies', ['watched_movies', 'unwatched_movies'])}
          ${this._ring('series_watched_pct', 'Series')}
          ${this._ring('episodes_watched_pct', 'Episodes', ['watched_episodes', 'unwatched_episodes'])}
        </div></div>
        ${latest ? `<div class="block"><div class="bh">Latest added</div><div class="latests">${latest}</div></div>` : ''}
        ${this._watchTime()}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act="more"]');
    if (el?.dataset.e && this._hass) window.RusstumShared.act(this, this._hass, { action: 'more-info' }, el.dataset.e);
  }

  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('jellyfin-stats-card-editor');
  }

  static getStubConfig() { return { title: 'Jellyfin' }; }
}

customElements.define('jellyfin-stats-card', JellyfinStatsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'jellyfin-stats-card',
  name: 'Jellyfin Stats Card',
  description: 'JellyHA library stats: size, storage, sessions, watched rings, latest added and titles added this month.',
  preview: true,
});

class JellyfinStatsCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    // Flat <role>_entity keys: the editor kit's forms work on top-level fields.
    const s = (role, label) => ({ name: `${role}_entity`, label, selector: { entity: { domain: 'sensor' } } });
    return [
      { title: 'General', icon: 'mdi:chart-donut', schema: [
        f.grid(f.text('title', 'Title', 'Optional'), f.toggle('added_this_month', 'Show titles added this month', 'Default: on')),
      ] },
      { title: 'Sensors (found automatically)', icon: 'mdi:tune', schema: [
        f.grid(s('library', 'Library'), s('storage', 'Storage')),
        f.grid(s('active_sessions', 'Active sessions'), s('movies_watched_pct', 'Movies watched %')),
        f.grid(s('series_watched_pct', 'Series watched %'), s('episodes_watched_pct', 'Episodes watched %')),
        f.grid(s('latest_movie', 'Latest movie'), s('latest_episode', 'Latest episode')),
      ] },
      { title: 'Watch time per person', icon: 'mdi:account-clock', list: {
        key: 'watch_time', label: (w, i) => w.name || w.entity || `Person ${i + 1}`, newItem: () => ({}), addLabel: 'Add person',
        schema: [f.grid(f.entity('entity', 'Watch-time sensor', 'Hours, minutes or seconds', 'sensor'), f.text('name', 'Name'))],
      } },
    ];
  }
}

customElements.define('jellyfin-stats-card-editor', JellyfinStatsCardEditor);
