/**
 * Printer Card for Home Assistant (Brother integration, or any printer
 * that exposes similar sensors).
 *
 * Draws a colour laser all-in-one with live toner levels in its front
 * window, the printer status on its touchscreen, and warnings on the part
 * that needs attention (door, paper tray, output slot). Page counts and
 * part life sit below the picture.
 *
 * Configuration:
 *   type: custom:printer-card
 *   device_id: abc123                 # Pick the printer device — entities are found automatically
 *   # …or instead of device_id:
 *   entity_prefix: mfc_l3780cdw       # finds sensor.mfc_l3780cdw_black_toner, etc.
 *
 *   title: Office Printer             # Optional (defaults to the device name)
 *   toner_low: 15                     # Toner % that counts as low (default 15)
 *   part_low: 20                      # Drum/belt/fuser % that counts as low (default 20)
 *   hide_pages: false                 # Hide the page-count tiles
 *   hide_parts: false                 # Hide the drum/belt/fuser/paper-feed bars
 *
 *   # Any entity can be set by hand if auto-detect picks the wrong one:
 *   black_toner_entity: sensor.my_black_toner
 *   (keys: status, message, health, black_toner, cyan_toner, magenta_toner,
 *    yellow_toner, bw_pages, color_pages, duplex_pages, total_pages,
 *    black_drum, cyan_drum, magenta_drum, yellow_drum, drum, belt, fuser,
 *    pf_kit, door_open, paper_jam, no_paper, low_toner, no_toner — each + "_entity")
 */

// key → [domain, entity_id suffixes to look for, in order of preference]
const PR_ENTITIES = {
  status:        ['sensor', ['printer_status', 'status']],
  message:       ['sensor', ['message']],
  health:        ['sensor', ['health']],
  black_toner:   ['sensor', ['black_toner', 'black_toner_remaining', 'black_ink', 'black_ink_remaining']],
  cyan_toner:    ['sensor', ['cyan_toner', 'cyan_toner_remaining', 'cyan_ink', 'cyan_ink_remaining']],
  magenta_toner: ['sensor', ['magenta_toner', 'magenta_toner_remaining', 'magenta_ink', 'magenta_ink_remaining']],
  yellow_toner:  ['sensor', ['yellow_toner', 'yellow_toner_remaining', 'yellow_ink', 'yellow_ink_remaining']],
  bw_pages:      ['sensor', ['b_w_pages', 'bw_pages', 'bw_counter']],
  color_pages:   ['sensor', ['color_pages', 'colour_pages', 'color_counter']],
  duplex_pages:  ['sensor', ['duplex_pages', 'duplex_unit_pages_counter']],
  total_pages:   ['sensor', ['total_pages', 'page_counter']],
  black_drum:    ['sensor', ['black_drum_life', 'black_drum_remaining_life']],
  cyan_drum:     ['sensor', ['cyan_drum_life', 'cyan_drum_remaining_life']],
  magenta_drum:  ['sensor', ['magenta_drum_life', 'magenta_drum_remaining_life']],
  yellow_drum:   ['sensor', ['yellow_drum_life', 'yellow_drum_remaining_life']],
  drum:          ['sensor', ['drum_life', 'drum_remaining_life']],
  belt:          ['sensor', ['belt_unit_life', 'belt_unit_remaining_life']],
  fuser:         ['sensor', ['fuser_life', 'fuser_remaining_life']],
  pf_kit:        ['sensor', ['pf_kit_mp_life', 'pf_kit_1_life', 'pf_kit_1_remaining_life']],
  door_open:     ['binary_sensor', ['door_open']],
  paper_jam:     ['binary_sensor', ['paper_jam']],
  no_paper:      ['binary_sensor', ['no_paper']],
  low_toner:     ['binary_sensor', ['low_toner']],
  no_toner:      ['binary_sensor', ['no_toner']],
};

const PR_TONERS = [
  { key: 'cyan_toner',    drum: 'cyan_drum',    label: 'C', name: 'Cyan',    color: '#00a6e4' },
  { key: 'magenta_toner', drum: 'magenta_drum', label: 'M', name: 'Magenta', color: '#e6007e' },
  { key: 'yellow_toner',  drum: 'yellow_drum',  label: 'Y', name: 'Yellow',  color: '#ffd200' },
  { key: 'black_toner',   drum: 'black_drum',   label: 'K', name: 'Black',   color: '#55595f', bar: '#9ea2a8' },
];

const prEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const prHuman = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const prNum = (n) => new Intl.NumberFormat().format(Math.round(n));

class PrinterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._ids = {};
    this._watched = [];
    this._resolvedFor = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._resolvedFor = null;
    if (this._hass) this._resolve();
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;
    // Entity lookup depends on the entity registry; redo it only when that changes.
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (oldHass && !this._watched.some((id) => hass.states[id] !== oldHass.states[id])) return;
    this._render();
  }

  // Work out which entity backs each key: explicit *_entity config wins,
  // then the chosen device's entities, then entity_prefix.
  _resolve() {
    const cfg = this._config;
    const hass = this._hass;
    this._resolvedFor = hass.entities;
    const deviceEntities = cfg.device_id && hass.entities
      ? Object.values(hass.entities).filter((e) => e.device_id === cfg.device_id).map((e) => e.entity_id)
      : [];
    const prefix = cfg.entity_prefix ? String(cfg.entity_prefix).replace(/_+$/, '') : null;

    const ids = {};
    for (const [key, [domain, suffixes]] of Object.entries(PR_ENTITIES)) {
      if (cfg[`${key}_entity`]) { ids[key] = cfg[`${key}_entity`]; continue; }
      let found = null;
      for (const suf of suffixes) {
        found = deviceEntities.find((id) => id.startsWith(domain + '.') && id.endsWith('_' + suf));
        if (!found && prefix && hass.states[`${domain}.${prefix}_${suf}`]) found = `${domain}.${prefix}_${suf}`;
        if (found) break;
      }
      if (found) ids[key] = found;
    }
    // "_drum_life" also matches "black_drum_life"; the single-drum key is
    // only for mono printers, so drop it when colour drums were found.
    if (!cfg.drum_entity && PR_TONERS.some((t) => ids[t.drum])) delete ids.drum;
    this._ids = ids;
    this._watched = Object.values(ids);
  }

  _state(key) {
    const id = this._ids[key];
    const s = id && this._hass?.states[id];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return null;
    return s.state;
  }

  _num(key) {
    const v = parseFloat(this._state(key));
    return isNaN(v) ? null : v;
  }

  _on(key) { return this._state(key) === 'on'; }

  _title() {
    const cfg = this._config;
    if (cfg.title) return cfg.title;
    const dev = cfg.device_id && this._hass?.devices?.[cfg.device_id];
    if (dev) return dev.name_by_user || dev.name;
    const st = this._ids.status && this._hass?.states[this._ids.status];
    return st?.attributes?.friendly_name || 'Printer';
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const tonerLow = cfg.toner_low ?? 15;
    const partLow = cfg.part_low ?? 20;
    const noEntities = this._hass && !Object.keys(this._ids).length;

    // ── Status ───────────────────────────────────────────────────────────────
    const status = this._state('status');
    const message = this._state('message');
    const health = this._state('health');
    const doorOpen = this._on('door_open');
    const paperJam = this._on('paper_jam');
    const noPaper = this._on('no_paper');
    const noToner = this._on('no_toner');
    const lowToner = this._on('low_toner');

    const s = (status || '').toLowerCase();
    const printing = /print|busy|processing|copy|scan/.test(s);
    const sleeping = s === 'sleep' || (s === 'idle' && (message || '').toLowerCase() === 'sleep');
    const healthBad = health && !/^(running|ok|ready|idle|normal)$/i.test(health);
    const error = doorOpen || paperJam || noPaper || noToner || /error|stop|offline/.test(s);

    const tone = error ? 'error' : (lowToner || healthBad) ? 'warn' : printing ? 'active' : sleeping ? 'sleep' : 'ok';
    const screenMain = status ? prHuman(status) : (this._hass ? 'Unavailable' : '—');
    const screenSub = message && message.toLowerCase() !== s ? prHuman(message) : '';

    // ── Toner window ─────────────────────────────────────────────────────────
    const toners = PR_TONERS
      .filter((t) => this._ids[t.key])
      .map((t) => ({ ...t, pct: this._num(t.key) }));
    const tonerHtml = toners.map((t) => {
      const pct = t.pct == null ? 0 : Math.max(0, Math.min(100, t.pct));
      const low = t.pct != null && t.pct <= tonerLow;
      return `
        <div class="toner ${low ? 'low' : ''}" title="${t.name} toner: ${t.pct == null ? 'unknown' : Math.round(t.pct) + '%'}">
          <div class="tube"><div class="fill" style="height:${pct}%;background:${t.color}"></div><span class="tl">${t.label}</span></div>
          <div class="tpct">${t.pct == null ? '—' : Math.round(t.pct) + '%'}</div>
        </div>`;
    }).join('');

    // ── Page counts ──────────────────────────────────────────────────────────
    const pageDefs = [
      { key: 'bw_pages', label: 'B/W', icon: 'mdi:file-document-outline' },
      { key: 'color_pages', label: 'Colour', icon: 'mdi:palette-outline' },
      { key: 'duplex_pages', label: 'Duplex', icon: 'mdi:book-open-page-variant-outline' },
      { key: 'total_pages', label: 'Total', icon: 'mdi:counter' },
    ].filter((p) => this._ids[p.key]);
    const pagesHtml = cfg.hide_pages || !pageDefs.length ? '' : `
      <div class="pages">
        ${pageDefs.map((p) => {
          const n = this._num(p.key);
          return `<div class="tile"><ha-icon icon="${p.icon}"></ha-icon>
            <div class="tv">${n == null ? '—' : prNum(n)}</div><div class="tk">${p.label}</div></div>`;
        }).join('')}
      </div>`;

    // ── Parts (drums, belt, fuser, paper feed) ───────────────────────────────
    const lifeColor = (pct) => pct == null ? 'var(--disabled-text-color, #9e9e9e)'
      : pct <= partLow / 2 ? 'var(--error-color, #f44336)'
      : pct <= partLow ? 'var(--warning-color, #ff9800)'
      : 'var(--success-color, #4caf50)';
    const bar = (pct, color) => `<div class="bar"><div class="bar-fill" style="width:${pct == null ? 0 : Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>`;
    const pvStyle = (pct) => pct != null && pct <= partLow ? `color:${lifeColor(pct)}` : '';
    const pctText = (pct) => pct == null ? '—' : `${Math.round(pct)}%`;

    const parts = [];
    const drums = PR_TONERS.filter((t) => this._ids[t.drum]).map((t) => ({ ...t, pct: this._num(t.drum) }));
    if (drums.length) {
      const known = drums.map((d) => d.pct).filter((p) => p != null);
      const min = known.length ? Math.min(...known) : null;
      parts.push(`
        <div class="part" title="${drums.map((d) => `${d.name} drum: ${pctText(d.pct)}`).join('\n')}">
          <ha-icon icon="mdi:circle-slice-8"></ha-icon><span class="pn">Drums</span>
          <div class="drums">${drums.map((d) => `
            <div class="drum"><div class="drum-fill" style="width:${d.pct ?? 0}%;background:${d.bar || d.color}"></div></div>`).join('')}
          </div>
          <span class="pv" style="${pvStyle(min)}">${pctText(min)}</span>
        </div>`);
    } else if (this._ids.drum) {
      const p = this._num('drum');
      parts.push(`<div class="part"><ha-icon icon="mdi:circle-slice-8"></ha-icon><span class="pn">Drum</span>${bar(p, lifeColor(p))}<span class="pv" style="${pvStyle(p)}">${pctText(p)}</span></div>`);
    }
    for (const [key, name, icon] of [['belt', 'Belt unit', 'mdi:sine-wave'], ['fuser', 'Fuser', 'mdi:fire'], ['pf_kit', 'Paper feed kit', 'mdi:tray-full']]) {
      if (!this._ids[key]) continue;
      const p = this._num(key);
      parts.push(`<div class="part"><ha-icon icon="${icon}"></ha-icon><span class="pn">${name}</span>${bar(p, lifeColor(p))}<span class="pv" style="${pvStyle(p)}">${pctText(p)}</span></div>`);
    }
    const partsHtml = cfg.hide_parts || !parts.length ? '' : `<div class="parts">${parts.join('')}</div>`;

    // ── Alerts ───────────────────────────────────────────────────────────────
    const lowNames = toners.filter((t) => t.pct != null && t.pct <= tonerLow).map((t) => t.name);
    const alerts = [];
    if (paperJam) alerts.push(['error', 'mdi:alert-octagon', 'Paper jam']);
    if (doorOpen) alerts.push(['error', 'mdi:door-open', 'Door open']);
    if (noPaper) alerts.push(['error', 'mdi:tray-alert', 'Out of paper']);
    if (noToner) alerts.push(['error', 'mdi:water-off', 'Out of toner']);
    if (lowToner || lowNames.length) alerts.push(['warn', 'mdi:water-alert', lowNames.length ? `Low toner: ${lowNames.join(', ')}` : 'Low toner']);
    if (healthBad) alerts.push(['warn', 'mdi:heart-pulse', `Health: ${prHuman(health)}`]);

    const healthChip = health && !healthBad
      ? `<span class="chip ok"><ha-icon icon="mdi:check-circle"></ha-icon>${alerts.length ? prHuman(health) : 'No issues'}</span>` : '';
    const alertsHtml = alerts.length
      ? alerts.map(([t, i, txt]) => `<span class="chip ${t}"><ha-icon icon="${i}"></ha-icon>${prEsc(txt)}</span>`).join('')
      : healthChip;

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; overflow: hidden; }

        .head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 6px; }
        .title { flex: 1 1 140px; min-width: 0; font-size: 1.1em; font-weight: 600; color: var(--primary-text-color);
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
        .chip { display: inline-flex; align-items: center; gap: 4px; font-size: .75em; font-weight: 600;
                padding: 3px 9px 3px 6px; border-radius: 12px; white-space: nowrap; --mdc-icon-size: 14px; }
        .chip.ok    { color: var(--success-color, #4caf50); background: rgba(76,175,80,.14); }
        .chip.warn  { color: var(--warning-color, #ff9800); background: rgba(255,152,0,.14); }
        .chip.error { color: var(--error-color, #f44336);   background: rgba(244,67,54,.14); }

        /* ── Printer illustration ── */
        .stage { position: relative; width: 100%; max-width: 440px; margin: 0 auto; aspect-ratio: 400 / 330;
                 container-type: inline-size; }
        .stage svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        .ov { position: absolute; }

        .screen { left: 56%; top: 17.6%; width: 25.5%; height: 12.1%;
                  display: flex; flex-direction: column; align-items: center; justify-content: center;
                  text-align: center; line-height: 1.1; pointer-events: none; }
        .screen .sm { font-size: 4.4cqw; font-weight: 600; color: #fff; }
        .screen .ss { font-size: 2.6cqw; color: rgba(255,255,255,.6); margin-top: .4cqw; }
        .tone-sleep  .screen .sm { color: rgba(255,255,255,.55); }
        .tone-active .screen .sm { color: #7fd0ff; }
        .tone-warn   .screen .sm { color: #ffc266; }
        .tone-error  .screen .sm { color: #ff8a80; }

        .window { left: 21.5%; top: 41.5%; width: 57%; height: 27.5%;
                  display: grid; grid-template-columns: repeat(${Math.max(toners.length, 1)}, 1fr);
                  gap: 3.5cqw; padding: 1.6cqw 4cqw 1cqw; box-sizing: border-box; }
        .toner { display: flex; flex-direction: column; align-items: center; min-height: 0; }
        .tube { position: relative; flex: 1; width: 100%; max-width: 9cqw; border-radius: 1.6cqw;
                background: rgba(255,255,255,.1); border: .4cqw solid rgba(255,255,255,.18);
                overflow: hidden; box-sizing: border-box; }
        .fill { position: absolute; left: 0; right: 0; bottom: 0; transition: height .6s ease;
                box-shadow: inset 0 .6cqw 0 rgba(255,255,255,.25); }
        .tl { position: absolute; top: .8cqw; left: 0; right: 0; text-align: center; font-size: 2.8cqw; font-weight: 700;
              color: rgba(255,255,255,.85); text-shadow: 0 0 .6cqw rgba(0,0,0,.8); }
        .tpct { font-size: 3.4cqw; font-weight: 700; color: #f2f2f2; margin-top: .9cqw; }
        .toner.low .tpct { color: #ff8a80; }
        .toner.low .tube { border-color: #ff5252; animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 50% { border-color: rgba(255,82,82,.35); } }

        .badge { transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: .8cqw;
                 padding: .8cqw 2.2cqw .8cqw 1.6cqw; border-radius: 4cqw; font-size: 3cqw; font-weight: 700;
                 white-space: nowrap; color: #fff; background: #e53935; box-shadow: 0 .6cqw 2cqw rgba(0,0,0,.45);
                 --mdc-icon-size: 3.8cqw; }

        .sheet.printing { animation: feed 2.4s ease-in-out infinite; }
        @keyframes feed { 0% { transform: translateY(-8px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(4px); opacity: 1; } }
        .led.active { animation: blink 1.2s ease-in-out infinite; }
        @keyframes blink { 50% { opacity: .25; } }

        /* ── Below the picture ── */
        .pages { display: grid; grid-template-columns: repeat(${Math.max(pageDefs.length, 1)}, 1fr); gap: 8px; margin-top: 12px; }
        .tile { background: var(--secondary-background-color, rgba(127,127,127,.08)); border-radius: 10px;
                padding: 10px 6px 8px; text-align: center; min-width: 0; }
        .tile ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
        .tv { font-size: 1.15em; font-weight: 700; color: var(--primary-text-color); margin-top: 2px;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tk { font-size: .68em; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }

        .parts { display: flex; flex-direction: column; gap: 9px; margin-top: 14px; }
        .part { display: flex; align-items: center; gap: 10px; }
        .part ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); flex-shrink: 0; }
        .pn { width: 104px; flex-shrink: 0; font-size: .85em; color: var(--primary-text-color);
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar, .drums { flex: 1; min-width: 0; }
        .bar { height: 6px; border-radius: 3px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .bar-fill { height: 100%; border-radius: 3px; transition: width .6s ease; }
        .drums { display: grid; grid-template-columns: repeat(${Math.max(drums.length, 1)}, 1fr); gap: 4px; }
        .drum { height: 6px; border-radius: 3px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .drum-fill { height: 100%; border-radius: 3px; }
        .pv { width: 40px; flex-shrink: 0; text-align: right; font-size: .85em; font-weight: 600; color: var(--primary-text-color); }

        .hint { font-size: .85em; color: var(--secondary-text-color); text-align: center; padding: 8px 0 0; }
      </style>

      <ha-card>
        <div class="head">
          <div class="title">${prEsc(this._title())}</div>
          <div class="chips">${alertsHtml}</div>
        </div>

        <div class="stage tone-${tone}">
          ${this._svg({ tone, printing, doorOpen, paperJam, noPaper, pages: this._num('total_pages') })}
          <div class="ov screen"><div class="sm">${prEsc(screenMain)}</div>${screenSub ? `<div class="ss">${prEsc(screenSub)}</div>` : ''}</div>
          ${toners.length ? `<div class="ov window">${tonerHtml}</div>` : ''}
          ${paperJam ? `<div class="ov badge" style="left:50%;top:30.5%"><ha-icon icon="mdi:alert-octagon"></ha-icon>Paper jam</div>` : ''}
          ${doorOpen ? `<div class="ov badge" style="left:50%;top:39%"><ha-icon icon="mdi:door-open"></ha-icon>Door open</div>` : ''}
          ${noPaper ? `<div class="ov badge" style="left:50%;top:83%"><ha-icon icon="mdi:tray-alert"></ha-icon>No paper</div>` : ''}
        </div>

        ${noEntities ? `<div class="hint">No printer entities found — choose the printer device in the card editor.</div>` : ''}
        ${pagesHtml}
        ${partsHtml}
      </ha-card>
    `;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  // A colour laser all-in-one: document feeder, scanner, touchscreen,
  // output slot, front cover with a toner window, and a paper cassette.
  _svg({ tone, printing, doorOpen, paperJam, noPaper, pages }) {
    const red = '#e53935';
    const ledColor = { error: red, warn: '#ffa000', active: '#29b6f6', sleep: '#43a047', ok: '#43a047' }[tone];
    const screenGlow = { error: 'rgba(229,57,53,.35)', warn: 'rgba(255,160,0,.3)', active: 'rgba(41,182,246,.3)', sleep: 'rgba(255,255,255,.04)', ok: 'rgba(255,255,255,.1)' }[tone];
    return `
      <svg viewBox="0 0 400 330" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="pr-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#f4f4f2"/><stop offset="1" stop-color="#d3d4d3"/>
          </linearGradient>
          <linearGradient id="pr-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fafaf8"/><stop offset="1" stop-color="#dcdddc"/>
          </linearGradient>
          <linearGradient id="pr-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".06" stop-color="#000" stop-opacity="0"/>
            <stop offset=".94" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/>
          </linearGradient>
          <radialGradient id="pr-glow" cx=".5" cy=".5" r=".6">
            <stop offset="0" stop-color="${screenGlow}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
          </radialGradient>
        </defs>

        <!-- floor shadow -->
        <ellipse cx="200" cy="316" rx="168" ry="9" fill="#000" opacity=".35"/>

        <!-- document feeder -->
        <path d="M104 18 H296 L318 46 H82 Z" fill="#3a3c40" stroke="#26282b" stroke-width="1"/>
        <path d="M104 18 H296 L300 23 H100 Z" fill="#fff" opacity=".08"/>
        <rect x="128" y="28" width="144" height="5" rx="2.5" fill="#17181a"/>
        <rect x="150" y="37" width="100" height="3" rx="1.5" fill="#55585d"/>

        <!-- scanner unit -->
        <rect x="56" y="46" width="288" height="46" rx="8" fill="url(#pr-top)" stroke="#a3a7ad"/>
        <rect x="56" y="46" width="288" height="46" rx="8" fill="url(#pr-side)"/>
        <circle class="led ${tone === 'active' ? 'active' : ''}" cx="74" cy="62" r="3.5" fill="${ledColor}"/>

        <!-- output slot -->
        <rect x="66" y="92" width="268" height="24" fill="#141517"/>
        <rect x="66" y="92" width="268" height="5" fill="#000" opacity=".5"/>
        ${pages > 0 || printing ? `<rect class="sheet ${printing ? 'printing' : ''}" x="84" y="101" width="122" height="7" rx="1" fill="#f4f4f2"/>` : ''}
        ${paperJam ? `<rect x="66" y="92" width="268" height="24" fill="none" stroke="${red}" stroke-width="2.5"/>` : ''}

        <!-- touchscreen panel (sits proud of the scanner) -->
        <rect x="218" y="52" width="114" height="52" rx="7" fill="#2c2e31" stroke="#8d9197"/>
        <rect x="224" y="58" width="102" height="40" rx="4" fill="#060708"/>
        <rect x="224" y="58" width="102" height="40" rx="4" fill="url(#pr-glow)"/>

        <!-- main body -->
        <rect x="46" y="116" width="308" height="192" rx="12" fill="url(#pr-body)" stroke="#9fa3a9"/>
        <rect x="46" y="116" width="308" height="192" rx="12" fill="url(#pr-side)"/>

        <!-- front cover with toner window -->
        <rect x="62" y="126" width="276" height="116" rx="8" fill="#e6e7e5"
              stroke="${doorOpen ? red : '#a6aab0'}" stroke-width="${doorOpen ? 3 : 1}" ${doorOpen ? 'stroke-dasharray="7 5"' : ''}/>
        <rect x="86" y="136" width="228" height="92" rx="7" fill="#0e0f10" stroke="#6f7379"/>
        <rect x="86" y="136" width="228" height="10" rx="5" fill="#fff" opacity=".05"/>
        <rect x="170" y="232" width="60" height="5" rx="2.5" fill="#9a9ea4"/>

        <!-- paper cassette -->
        <rect x="62" y="250" width="276" height="48" rx="6" fill="#dedfdd" stroke="${noPaper ? red : '#9fa3a9'}" stroke-width="${noPaper ? 3 : 1}"/>
        <rect x="168" y="259" width="64" height="9" rx="4.5" fill="#85898f"/>
        <rect x="294" y="262" width="30" height="24" rx="3" fill="#2a2c2f"/>
        ${noPaper
          ? `<line x1="300" y1="268" x2="318" y2="280" stroke="${red}" stroke-width="2.5"/><line x1="318" y1="268" x2="300" y2="280" stroke="${red}" stroke-width="2.5"/>`
          : `<rect x="298" y="274" width="22" height="2.5" fill="#f4f4f2"/><rect x="298" y="278" width="22" height="2.5" fill="#f4f4f2"/><rect x="298" y="282" width="22" height="2" fill="#f4f4f2"/>`}

        <!-- feet -->
        <rect x="72" y="306" width="34" height="6" rx="2" fill="#5b5f65"/>
        <rect x="294" y="306" width="34" height="6" rx="2" fill="#5b5f65"/>
      </svg>`;
  }

  getCardSize() { return 8; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('printer-card-editor');
  }

  static getStubConfig(hass) {
    // Pre-select the first Brother printer, if there is one.
    const dev = hass && Object.values(hass.devices || {}).find((d) =>
      Object.values(hass.entities || {}).some((e) => e.device_id === d.id && e.platform === 'brother'));
    return dev ? { device_id: dev.id } : { entity_prefix: '' };
  }
}

customElements.define('printer-card', PrinterCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'printer-card',
  name: 'Printer Card',
  description: 'Printer picture with live toner levels, status, page counts and part life.',
  preview: true,
});

// ── Printer Card Editor ───────────────────────────────────────────────────────

class PrinterCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    const ent = (key, label, domain) => f.entity(`${key}_entity`, label, undefined, domain);
    return [
      { title: 'Printer', icon: 'mdi:printer', schema: [
        f.device('device_id', 'Printer device', undefined, 'All of its sensors are found automatically'),
        f.text('title', 'Title', 'Defaults to the device name'),
      ] },
      { title: 'Display', icon: 'mdi:tune-vertical', open: false, schema: [
        f.grid(
          f.number('toner_low', 'Toner low at', { min: 0, max: 100, unit: '%', helper: 'Default: 15' }),
          f.number('part_low', 'Parts low at', { min: 0, max: 100, unit: '%', helper: 'Drums, belt, fuser. Default: 20' }),
        ),
        f.grid(f.toggle('hide_pages', 'Hide page counts'), f.toggle('hide_parts', 'Hide part life')),
      ] },
      { title: 'Entity overrides', icon: 'mdi:swap-horizontal', open: false, schema: [
        f.text('entity_prefix', 'Entity prefix (instead of a device)', 'e.g. mfc_l3780cdw finds sensor.mfc_l3780cdw_black_toner'),
        f.grid(ent('status', 'Status', 'sensor'), ent('message', 'Message', 'sensor')),
        ent('health', 'Health', 'sensor'),
        f.grid(ent('black_toner', 'Black toner', 'sensor'), ent('cyan_toner', 'Cyan toner', 'sensor')),
        f.grid(ent('magenta_toner', 'Magenta toner', 'sensor'), ent('yellow_toner', 'Yellow toner', 'sensor')),
        f.grid(ent('bw_pages', 'B/W pages', 'sensor'), ent('color_pages', 'Colour pages', 'sensor')),
        f.grid(ent('duplex_pages', 'Duplex pages', 'sensor'), ent('total_pages', 'Total pages', 'sensor')),
        f.grid(ent('black_drum', 'Black drum life', 'sensor'), ent('cyan_drum', 'Cyan drum life', 'sensor')),
        f.grid(ent('magenta_drum', 'Magenta drum life', 'sensor'), ent('yellow_drum', 'Yellow drum life', 'sensor')),
        f.grid(ent('belt', 'Belt unit life', 'sensor'), ent('fuser', 'Fuser life', 'sensor')),
        ent('pf_kit', 'Paper feed kit life', 'sensor'),
        f.grid(ent('door_open', 'Door open', 'binary_sensor'), ent('paper_jam', 'Paper jam', 'binary_sensor')),
        f.grid(ent('no_paper', 'No paper', 'binary_sensor'), ent('low_toner', 'Low toner', 'binary_sensor')),
        ent('no_toner', 'No toner', 'binary_sensor'),
      ] },
    ];
  }
}

customElements.define('printer-card-editor', PrinterCardEditor);
