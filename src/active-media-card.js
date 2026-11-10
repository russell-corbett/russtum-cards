/**
 * Active Media Card for Home Assistant
 *
 * Give it every media player in the house; it shows only the ones that are
 * actually doing something, with artwork, progress and controls. When
 * nothing is playing it collapses to a one-line "Nothing playing" (or hides).
 *
 * Configuration:
 *   type: custom:active-media-card
 *   title: Now Playing                  # Optional
 *   hide_when_empty: false              # Hide the whole card when nothing is active
 *   hide_volume: false                  # Hide the volume -/+ buttons
 *   players:
 *     - entity: media_player.family_room_apple_tv
 *       name: Family Room                # Optional (defaults to friendly name)
 *       icon: mdi:cast-variant           # Optional
 *       hide_paused: false               # Treat "paused" as inactive for this player
 *       hide_when_active:                # Hide this player while any of these are on
 *         - media_player.russell_bedroom_tv
 *         - media_player.xboxone
 */

const AM_INACTIVE = ['off', 'standby', 'idle', 'unavailable', 'unknown'];
// MediaPlayerEntityFeature bits
const AM_F = { PAUSE: 1, VOLUME_SET: 4, PREV: 16, NEXT: 32, TURN_OFF: 256, VOLUME_STEP: 1024, STOP: 4096, PLAY: 16384 };

const amEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const amTime = (sec) => {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

class ActiveMediaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._watched = [];
    this._ticker = null;
    // One delegated listener survives every re-render.
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const players = (config.players || []).map((p) => (typeof p === 'string' ? { entity: p } : p)).filter((p) => p.entity);
    this._config = { ...config, players };
    this._watched = [...new Set(players.flatMap((p) => [p.entity, ...(p.hide_when_active || [])]))];
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  connectedCallback() {
    // Move progress bars every second without rebuilding the card (keeps artwork from flickering).
    this._ticker = setInterval(() => this._tick(), 1000);
  }

  disconnectedCallback() {
    clearInterval(this._ticker);
    this._ticker = null;
  }

  _isActive(p) {
    const st = this._hass?.states[p.entity];
    if (!st || AM_INACTIVE.includes(st.state)) return false;
    if (p.hide_paused && st.state === 'paused') return false;
    const blockers = p.hide_when_active || [];
    if (blockers.some((id) => {
      const s = this._hass.states[id]?.state;
      return s && !['off', 'standby', 'unavailable', 'unknown', 'idle'].includes(s);
    })) return false;
    return true;
  }

  _position(st) {
    const a = st.attributes;
    if (a.media_duration == null || a.media_position == null) return null;
    let pos = a.media_position;
    if (st.state === 'playing' && a.media_position_updated_at) {
      pos += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
    }
    return { pos: Math.min(pos, a.media_duration), dur: a.media_duration };
  }

  _tick() {
    if (!this._hass || !this.shadowRoot) return;
    for (const el of this.shadowRoot.querySelectorAll('.item[data-playing]')) {
      const st = this._hass.states[el.dataset.e];
      const p = st && this._position(st);
      if (!p) continue;
      const fill = el.querySelector('.fill');
      const t = el.querySelector('.ptime');
      if (fill) fill.style.width = `${(p.pos / p.dur) * 100}%`;
      if (t) t.textContent = `${amTime(p.pos)} / ${amTime(p.dur)}`;
    }
  }

  _art(st) {
    const pic = st.attributes.entity_picture_local || st.attributes.entity_picture;
    if (!pic) return null;
    return this._hass.hassUrl && pic.startsWith('/') ? this._hass.hassUrl(pic) : pic;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const active = this._hass ? cfg.players.filter((p) => this._isActive(p)) : [];
    const empty = !active.length;

    this.style.display = empty && cfg.hide_when_empty ? 'none' : '';

    const items = active.map((p) => {
      const st = this._hass.states[p.entity];
      const a = st.attributes;
      const f = a.supported_features || 0;
      const playing = st.state === 'playing';
      const room = p.name || a.friendly_name || p.entity;
      const title = a.media_title || a.app_name || a.source || (st.state === 'on' ? 'On' : st.state);
      const sub = [a.media_artist || a.media_series_title, a.media_album_name].filter(Boolean).join(' · ')
        || (a.media_title && a.app_name ? a.app_name : '');
      const art = this._art(st);
      const pos = this._position(st);
      const vol = a.volume_level != null ? Math.round(a.volume_level * 100) : null;
      const canPause = f & AM_F.PAUSE || f & AM_F.PLAY;
      const canVol = !cfg.hide_volume && (f & AM_F.VOLUME_STEP || f & AM_F.VOLUME_SET);

      return `
        <div class="item ${art ? 'has-art' : ''}" data-e="${amEsc(p.entity)}" ${playing && pos ? 'data-playing' : ''}>
          ${art ? `<div class="bg" style="background-image:url('${amEsc(art)}')"></div>` : ''}
          <div class="row">
            <div class="art" data-act="more">
              ${art ? `<img src="${amEsc(art)}" alt="" loading="lazy">` : `<ha-icon icon="${amEsc(p.icon || 'mdi:cast-variant')}"></ha-icon>`}
              ${playing ? '<div class="eq"><i></i><i></i><i></i></div>' : ''}
            </div>
            <div class="meta" data-act="more">
              <div class="room"><ha-icon icon="${amEsc(p.icon || 'mdi:speaker')}"></ha-icon>${amEsc(room)}${a.app_name && a.media_title ? ` · ${amEsc(a.app_name)}` : ''}</div>
              <div class="ttl">${amEsc(title)}</div>
              ${sub ? `<div class="sub">${amEsc(sub)}</div>` : ''}
            </div>
            <div class="ctl">
              ${f & AM_F.PREV ? `<button data-act="prev" title="Previous"><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : ''}
              ${canPause ? `<button class="main" data-act="playpause" title="${playing ? 'Pause' : 'Play'}"><ha-icon icon="${playing ? 'mdi:pause' : 'mdi:play'}"></ha-icon></button>` : ''}
              ${f & AM_F.NEXT ? `<button data-act="next" title="Next"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : ''}
            </div>
          </div>
          ${pos || canVol ? `
          <div class="foot">
            ${pos ? `<div class="prog"><div class="fill" style="width:${(pos.pos / pos.dur) * 100}%"></div></div>
                     <span class="ptime">${amTime(pos.pos)} / ${amTime(pos.dur)}</span>` : '<span class="grow"></span>'}
            ${canVol ? `
              <div class="vol">
                <button data-act="vol-" title="Volume down"><ha-icon icon="mdi:volume-minus"></ha-icon></button>
                <span>${vol != null ? vol + '%' : ''}</span>
                <button data-act="vol+" title="Volume up"><ha-icon icon="mdi:volume-plus"></ha-icon></button>
              </div>` : ''}
          </div>` : ''}
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: ${empty ? '12px 16px' : '14px'}; overflow: hidden; }
        .title { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); margin: 0 2px 10px; display: flex; align-items: center; gap: 8px; }
        .count { font-size: .75em; font-weight: 600; padding: 1px 8px; border-radius: 10px;
                 background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .list { display: flex; flex-direction: column; gap: 10px; }
        .empty { display: flex; align-items: center; gap: 10px; color: var(--secondary-text-color); font-size: .9em; --mdc-icon-size: 20px; }

        .item { position: relative; border-radius: 14px; overflow: hidden; padding: 10px;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .bg { position: absolute; inset: -20px; background-size: cover; background-position: center;
              filter: blur(24px) saturate(1.4); opacity: .35; }
        .row, .foot { position: relative; display: flex; align-items: center; gap: 12px; }
        .art { position: relative; width: 56px; height: 56px; flex-shrink: 0; border-radius: 10px; overflow: hidden; cursor: pointer;
               background: rgba(127,127,127,.18); display: flex; align-items: center; justify-content: center;
               color: var(--secondary-text-color); --mdc-icon-size: 28px; }
        .art img { width: 100%; height: 100%; object-fit: cover; }
        .eq { position: absolute; right: 4px; bottom: 4px; display: flex; gap: 2px; align-items: flex-end; height: 12px;
              padding: 2px 3px; border-radius: 4px; background: rgba(0,0,0,.55); }
        .eq i { width: 3px; background: #fff; border-radius: 1px; animation: eq 1s ease-in-out infinite; }
        .eq i:nth-child(2) { animation-delay: -.4s; } .eq i:nth-child(3) { animation-delay: -.7s; }
        @keyframes eq { 0%, 100% { height: 3px; } 50% { height: 10px; } }

        .meta { flex: 1; min-width: 0; cursor: pointer; }
        .room { display: flex; align-items: center; gap: 4px; font-size: .72em; font-weight: 600; text-transform: uppercase;
                letter-spacing: .05em; color: var(--secondary-text-color); --mdc-icon-size: 13px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ttl { font-size: .98em; font-weight: 600; color: var(--primary-text-color); margin-top: 2px;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sub { font-size: .82em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        button { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%; line-height: 0;
                 color: var(--primary-text-color); --mdc-icon-size: 22px; }
        button:hover { background: rgba(127,127,127,.18); }
        .ctl { display: flex; align-items: center; flex-shrink: 0; }
        .ctl .main { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); --mdc-icon-size: 24px; margin: 0 2px; }
        .ctl .main:hover { filter: brightness(1.1); background: var(--primary-color, #03a9f4); }

        .foot { margin-top: 8px; gap: 8px; }
        .grow { flex: 1; }
        .prog { flex: 1; height: 4px; border-radius: 2px; background: rgba(127,127,127,.3); overflow: hidden; }
        .fill { height: 100%; background: var(--primary-color, #03a9f4); border-radius: 2px; transition: width 1s linear; }
        .ptime { font-size: .72em; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .vol { display: flex; align-items: center; gap: 2px; font-size: .78em; color: var(--secondary-text-color); }
        .vol button { --mdc-icon-size: 18px; padding: 4px; }
        .vol span { min-width: 32px; text-align: center; font-variant-numeric: tabular-nums; }
      </style>
      <ha-card>
        ${cfg.title && !empty ? `<div class="title">${amEsc(cfg.title)}<span class="count">${active.length}</span></div>` : ''}
        ${empty
          ? `<div class="empty"><ha-icon icon="mdi:speaker-off"></ha-icon>${amEsc(cfg.empty_text || 'Nothing playing')}</div>`
          : `<div class="list">${items}</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    const item = ev.target.closest('.item');
    if (!el || !item || !this._hass) return;
    const entity_id = item.dataset.e;
    const act = el.dataset.act;
    const call = (service, data = {}) => this._hass.callService('media_player', service, { entity_id, ...data });
    const vol = this._hass.states[entity_id]?.attributes?.volume_level;
    const f = this._hass.states[entity_id]?.attributes?.supported_features || 0;
    switch (act) {
      case 'more':
        this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: entity_id }, bubbles: true, composed: true }));
        break;
      case 'playpause': call('media_play_pause'); break;
      case 'prev': call('media_previous_track'); break;
      case 'next': call('media_next_track'); break;
      case 'vol+':
      case 'vol-':
        if (f & AM_F.VOLUME_SET && vol != null) {
          call('volume_set', { volume_level: Math.max(0, Math.min(1, Math.round((vol + (act === 'vol+' ? 0.05 : -0.05)) * 100) / 100)) });
        } else {
          call(act === 'vol+' ? 'volume_up' : 'volume_down');
        }
        break;
    }
  }

  getCardSize() { return 3; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('active-media-card-editor');
  }

  static getStubConfig(hass) {
    const players = Object.keys(hass?.states || {}).filter((id) => id.startsWith('media_player.')).slice(0, 6).map((entity) => ({ entity }));
    return { title: 'Now Playing', players };
  }
}

customElements.define('active-media-card', ActiveMediaCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'active-media-card',
  name: 'Active Media Card',
  description: 'Shows only the media players that are playing, with artwork and controls.',
  preview: false,
});

class ActiveMediaCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:play-circle-outline', schema: [
        f.text('title', 'Title'),
        f.text('empty_text', 'Text when nothing is playing', 'Default: Nothing playing'),
        f.grid(f.toggle('hide_when_empty', 'Hide card when nothing plays'), f.toggle('hide_volume', 'Hide volume buttons')),
      ] },
      { title: 'Players', icon: 'mdi:speaker-multiple', list: {
        key: 'players',
        collapsible: true,
        schema: [
          f.entity('entity', 'Media player', undefined, 'media_player'),
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.toggle('hide_paused', 'Hide while paused'),
          f.entities('hide_when_active', 'Hide while any of these are on', 'e.g. hide the soundbar when the TV or Xbox is on'),
        ],
        label: (p, i) => p.name || p.entity || `Player ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add player',
      } },
    ];
  }
}

customElements.define('active-media-card-editor', ActiveMediaCardEditor);
