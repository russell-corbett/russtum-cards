/**
 * Media Shelf Card for Home Assistant
 *
 * Rows of posters that scroll sideways, like a streaming app's home screen.
 * Each row comes from one source:
 *
 *   jellyfin_browse  HA's media browser on a media player (JellyHA's library
 *                    browser by default). JellyHA exposes:
 *                      jellyha://recent     Recently added (episodes and movies)
 *                      jellyha://movies     All movies
 *                      jellyha://series     All series
 *                      jellyha://favorites  Favourites
 *                    It has no "continue watching" folder.
 *   calendar         calendar.get_events over the next N days, e.g. Radarr and
 *                    Sonarr → "Coming this week". Calendars carry no artwork,
 *                    so these tiles get a generated poster.
 *
 * Configuration:
 *   type: custom:media-shelf-card
 *   chips:                                   # Optional header chips (tap = more-info)
 *     - entity: sensor.overseerr_pending_requests
 *       name: Pending
 *       icon: mdi:clock-outline
 *   rows:
 *     - title: Recently added
 *       source: jellyfin_browse
 *       entity: media_player.jellyha_library_browser   # default
 *       media_content_id: jellyha://recent
 *       media_content_type: channels
 *       limit: 20                            # default 20
 *     - title: Coming this week
 *       source: calendar
 *       entities: [calendar.radarr, calendar.sonarr]
 *       days: 7                              # default 7
 *   poster_width: 112                        # px (default 112)
 *
 * Every row also takes `tap_action` (default: more-info on the row's entity).
 */

const msEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const MS_BROWSER = 'media_player.jellyha_library_browser';
const MS_TTL = { jellyfin_browse: 15 * 60 * 1000, calendar: 30 * 60 * 1000 };

// "Show S06E07 - Name" / "Show - S06E07 - Name" → { title: Show, sub: S06E07 · Name }
function msSplit(text) {
  const t = String(text || '');
  const ep = t.match(/^(.*?)\s*(?:\(\d{4}\)\s*)?-?\s*(S\d+E\d+)\s*(?:-\s*(.*))?$/i);
  if (ep && ep[1]) return { title: ep[1].replace(/\s*-\s*$/, ''), sub: [ep[2].toUpperCase(), ep[3]].filter(Boolean).join(' · ') };
  const yr = t.match(/^(.*)\s+\((\d{4})\)$/);
  if (yr) return { title: yr[1], sub: yr[2] };
  return { title: t, sub: '' };
}

function msDay(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return day.toLocaleDateString(undefined, { weekday: 'short' });
  return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A stable hue per title for generated posters.
function msHue(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; }

class MediaShelfCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._data = [];        // per row: { at, items, error, busy }
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    const rows = msList(config?.rows).filter((r) => r && typeof r === 'object');
    if (!rows.length) throw new Error('Add at least one row, e.g. rows: [{ title: Recently added, source: jellyfin_browse, media_content_id: jellyha://recent }]');
    this._config = {
      poster_width: 112, ...config,
      chips: msList(config.chips).map((c) => (typeof c === 'string' ? { entity: c } : c)).filter((c) => c?.entity),
      rows: rows.map((r) => ({ source: 'jellyfin_browse', ...r })),
    };
    this._data = this._config.rows.map(() => ({ at: 0, items: null, error: null, busy: false }));
    this._lastHtml = null;
    if (this._hass) { this._render(); this._refresh(); }
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    this._refresh();
    const ids = this._config.chips.map((c) => c.entity);
    if (old && ids.every((id) => old.states[id] === hass.states[id])) return;
    this._render();
  }

  connectedCallback() {
    // Re-check now and then; each row only refetches when its data is stale.
    this._tick = setInterval(() => this._refresh(), 60 * 1000);
  }

  disconnectedCallback() { clearInterval(this._tick); }

  _refresh() {
    if (!this._hass) return;
    this._config.rows.forEach((row, i) => {
      const d = this._data[i];
      const ttl = MS_TTL[row.source] || MS_TTL.jellyfin_browse;
      if (d.busy || (d.at && Date.now() - d.at < ttl)) return;
      d.busy = true;
      const job = row.source === 'calendar' ? this._loadCalendar(row) : this._loadBrowse(row);
      job.then((items) => { d.items = items; d.error = null; })
        .catch((e) => { d.error = e?.message || String(e); console.warn(`media-shelf-card: row "${row.title || i + 1}"`, e); })
        .finally(() => { d.busy = false; d.at = Date.now(); this._lastHtml = null; this._render(); });
    });
  }

  async _loadBrowse(row) {
    const entity = row.entity || MS_BROWSER;
    if (!this._hass.states[entity]) throw new Error(`${entity} not found`);
    const msg = { type: 'media_player/browse_media', entity_id: entity };
    if (row.media_content_id) {
      msg.media_content_id = row.media_content_id;
      msg.media_content_type = row.media_content_type || 'channels';
    }
    const res = await this._hass.callWS(msg);
    return (res?.children || []).slice(0, Number(row.limit) || 20).map((c) => {
      const { title, sub } = msSplit(c.title);
      return { title, sub, img: c.thumbnail || '', icon: c.media_class === 'movie' ? 'mdi:movie-open' : 'mdi:television-classic', id: c.media_content_id, type: c.media_content_type, entity };
    });
  }

  async _loadCalendar(row) {
    const entities = msList(row.entities || row.entity).filter((id) => this._hass.states[id]);
    if (!entities.length) throw new Error('No calendars found');
    const res = await this._hass.callWS({
      type: 'call_service', domain: 'calendar', service: 'get_events', return_response: true,
      service_data: { duration: { days: Number(row.days) || 7 } }, target: { entity_id: entities },
    });
    const out = [];
    for (const [entity, val] of Object.entries(res?.response || {})) {
      for (const ev of val?.events || []) {
        const { title, sub } = msSplit(String(ev.summary || '').replace(/\s+-\s+(S\d+E\d+)/i, ' $1'));
        const allDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start);
        const start = allDay ? new Date(`${ev.start}T00:00:00`) : new Date(ev.start);
        out.push({ title, sub: [msDay(start), sub].filter(Boolean).join(' · '), start: start.getTime(), img: '', entity,
          icon: /radarr|movie/i.test(entity) ? 'mdi:movie-open' : 'mdi:television-classic' });
      }
    }
    return out.sort((a, b) => a.start - b.start).slice(0, Number(row.limit) || 30);
  }

  _chips() {
    const h = this._hass;
    return this._config.chips.map((c, i) => {
      const st = h.states[c.entity];
      const na = !st || ['unavailable', 'unknown'].includes(st.state);
      const name = c.name || st?.attributes?.friendly_name || c.entity;
      return `<button class="chip ${na ? 'na' : ''}" data-act="chip" data-i="${i}" aria-label="${msEsc(name)}: ${msEsc(na ? 'unavailable' : st.state)}">
          <ha-icon icon="${msEsc(c.icon || st?.attributes?.icon || 'mdi:information-outline')}"></ha-icon>
          <b>${msEsc(na ? '–' : st.state)}</b><span>${msEsc(name)}</span></button>`;
    }).join('');
  }

  _tile(it, r, j) {
    const art = it.img
      ? `<img src="${msEsc(it.img)}" alt="" loading="lazy" referrerpolicy="same-origin">`
      : `<div class="gen" style="--h:${msHue(it.title)}"><ha-icon icon="${it.icon}"></ha-icon><span>${msEsc(it.title)}</span></div>`;
    return `<button class="tile" data-act="tile" data-r="${r}" data-j="${j}" aria-label="${msEsc([it.title, it.sub].filter(Boolean).join(', '))}">
        <div class="poster">${art}</div>
        <div class="tt">${msEsc(it.title)}</div>
        ${it.sub ? `<div class="ts">${msEsc(it.sub)}</div>` : ''}
      </button>`;
  }

  _render() {
    const c = this._config, h = this._hass;
    if (!c || !h) return;
    const chips = this._chips();
    const rows = c.rows.map((row, r) => {
      const d = this._data[r];
      let body;
      if (d.items?.length) body = d.items.map((it, j) => this._tile(it, r, j)).join('');
      else if (d.items && !d.error) body = `<div class="msg">${row.source === 'calendar' ? 'Nothing coming up' : 'Nothing here yet'}</div>`;
      else if (d.error) body = `<div class="msg"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>Couldn't load this row</div>`;
      else body = Array.from({ length: 6 }, () => '<div class="tile sk"><div class="poster"></div><div class="tt"></div></div>').join('');
      return `<section>
          ${row.title ? `<h3>${msEsc(row.title)}</h3>` : ''}
          <div class="shelf" role="list" aria-label="${msEsc(row.title || 'Media')}" aria-busy="${!d.items && !d.error}">${body}</div>
        </section>`;
    }).join('');

    const w = Math.max(72, Math.min(220, Number(c.poster_width) || 112));
    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 14px 0 6px; overflow: hidden; }
        .top { display: flex; align-items: center; gap: 8px; padding: 0 16px 6px; flex-wrap: wrap; }
        .top h2 { flex: 1 1 auto; margin: 0; font-size: 1.15em; font-weight: 500; color: var(--primary-text-color); }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 12px 0 8px; border: 0; border-radius: 15px;
          background: var(--secondary-background-color, rgba(127,127,127,.12)); color: var(--primary-text-color); font: inherit; font-size: .82em; cursor: pointer; }
        .chip ha-icon { --mdc-icon-size: 16px; color: var(--primary-color); }
        .chip span { color: var(--secondary-text-color); }
        .chip.na { opacity: .5; }
        section + section { margin-top: 6px; }
        h3 { margin: 6px 16px 8px; font-size: .95em; font-weight: 600; color: var(--primary-text-color); }
        .shelf { display: flex; gap: 10px; overflow-x: auto; padding: 0 16px 10px; scroll-snap-type: x mandatory; scroll-padding: 0 16px;
          scrollbar-width: none; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
        .shelf::-webkit-scrollbar { display: none; }
        .tile { flex: 0 0 ${w}px; width: ${w}px; scroll-snap-align: start; padding: 0; border: 0; background: none; font: inherit; text-align: left;
          color: var(--primary-text-color); cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .poster { width: 100%; aspect-ratio: 2 / 3; border-radius: 12px; overflow: hidden; background: var(--secondary-background-color, rgba(127,127,127,.15));
          box-shadow: 0 2px 8px rgba(0,0,0,.18); transition: transform .15s ease; }
        .tile:hover .poster { transform: translateY(-2px); }
        .tile:active .poster { transform: scale(.97); }
        .tile:focus-visible { outline: none; }
        .tile:focus-visible .poster { box-shadow: 0 0 0 2px var(--primary-color); }
        .poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .gen { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 10px; box-sizing: border-box;
          background: linear-gradient(160deg, hsl(var(--h) 55% 45%), hsl(calc(var(--h) + 40) 60% 22%)); color: #fff; }
        .gen ha-icon { --mdc-icon-size: 22px; opacity: .85; }
        .gen span { font-weight: 600; font-size: .9em; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
        .tt { margin-top: 6px; font-size: .85em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ts { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sk { pointer-events: none; }
        .sk .poster { animation: ms-pulse 1.4s ease-in-out infinite; box-shadow: none; }
        .sk .tt { height: 10px; width: 70%; border-radius: 5px; background: var(--secondary-background-color, rgba(127,127,127,.15)); }
        @keyframes ms-pulse { 50% { opacity: .5; } }
        .msg { display: flex; align-items: center; gap: 8px; padding: 18px 0; color: var(--secondary-text-color); font-size: .9em; }
        @media (prefers-reduced-motion: reduce) { .sk .poster { animation: none; } .poster { transition: none; } }
      </style>
      <ha-card>
        ${c.title || chips ? `<div class="top">${c.title ? `<h2>${msEsc(c.title)}</h2>` : ''}${chips ? `<div class="chips">${chips}</div>` : ''}</div>` : ''}
        ${rows}
      </ha-card>`;
    if (html === this._lastHtml) return;
    // Keep each shelf's scroll position across redraws.
    const scroll = [...this.shadowRoot.querySelectorAll('.shelf')].map((el) => el.scrollLeft);
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
    this.shadowRoot.querySelectorAll('.shelf').forEach((el, i) => { if (scroll[i]) el.scrollLeft = scroll[i]; });
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    if (el.dataset.act === 'chip') {
      const chip = this._config.chips[Number(el.dataset.i)];
      if (chip) window.RusstumShared.act(this, this._hass, chip.tap_action || { action: 'more-info' }, chip.entity);
      return;
    }
    const row = this._config.rows[Number(el.dataset.r)];
    const it = this._data[Number(el.dataset.r)]?.items?.[Number(el.dataset.j)];
    if (!row || !it) return;
    window.RusstumShared.act(this, this._hass, row.tap_action || { action: 'more-info' }, it.entity);
  }

  getCardSize() { return 1 + (this._config?.rows?.length || 1) * 3; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('media-shelf-card-editor');
  }

  static getStubConfig(hass) {
    const st = hass?.states || {};
    const rows = [];
    if (st[MS_BROWSER]) rows.push({ title: 'Recently added', source: 'jellyfin_browse', media_content_id: 'jellyha://recent', media_content_type: 'channels' });
    const cals = Object.keys(st).filter((id) => /^calendar\..*(radarr|sonarr)/.test(id));
    if (cals.length) rows.push({ title: 'Coming this week', source: 'calendar', entities: cals, days: 7 });
    if (!rows.length) {
      const cal = Object.keys(st).find((id) => id.startsWith('calendar.'));
      rows.push(cal ? { title: 'Coming up', source: 'calendar', entities: [cal] } : { title: 'Recently added', source: 'jellyfin_browse', media_content_id: 'jellyha://recent' });
    }
    return { rows };
  }
}

customElements.define('media-shelf-card', MediaShelfCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'media-shelf-card',
  name: 'Media Shelf Card',
  description: 'Sideways-scrolling poster rows from the Jellyfin (JellyHA) library or Radarr / Sonarr calendars, with header chips.',
  preview: true,
});

class MediaShelfCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:bookshelf', schema: [
        f.grid(f.text('title', 'Title', 'Optional'), f.number('poster_width', 'Poster width', { min: 72, max: 220, unit: 'px', helper: 'Default: 112' })),
      ] },
      { title: 'Header chips', icon: 'mdi:label-multiple-outline', list: {
        key: 'chips',
        label: (c, i) => c.name || c.entity || `Chip ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add chip',
        schema: [f.entity('entity', 'Entity'), f.grid(f.text('name', 'Label'), f.icon('icon'))],
      } },
      { title: 'Rows', icon: 'mdi:view-carousel-outline', list: {
        key: 'rows',
        collapsible: true,
        label: (r, i) => r.title || `Row ${i + 1}`,
        newItem: () => ({ source: 'jellyfin_browse', media_content_id: 'jellyha://recent', media_content_type: 'channels' }),
        addLabel: 'Add row',
        schema: [
          f.grid(f.text('title', 'Title'),
            f.select('source', 'Source', [{ value: 'jellyfin_browse', label: 'Media browser (Jellyfin)' }, { value: 'calendar', label: 'Calendars' }])),
          f.grid(f.entity('entity', 'Media player to browse', 'Default: JellyHA library browser', 'media_player'),
            f.select('media_content_id', 'Folder', [
              { value: 'jellyha://recent', label: 'Recently added' }, { value: 'jellyha://favorites', label: 'Favourites' },
              { value: 'jellyha://movies', label: 'Movies' }, { value: 'jellyha://series', label: 'Series' },
            ], 'Media browser rows only')),
          f.entities('entities', 'Calendars', 'Calendar rows only', 'calendar'),
          f.grid(f.number('days', 'Days ahead', { min: 1, max: 60, helper: 'Calendar rows. Default 7' }), f.number('limit', 'Most posters', { min: 1, max: 100, helper: 'Default 20' })),
          { name: 'tap_action', label: 'Tap action (default: more-info)', selector: { ui_action: {} } },
        ],
      } },
    ];
  }
}

customElements.define('media-shelf-card-editor', MediaShelfCardEditor);
