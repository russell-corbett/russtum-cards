/**
 * Security Overview Card for Home Assistant
 *
 * One card for the whole house: alarm state, locks, doors and windows,
 * motion (tiles glow and fade with how recently they saw something) and
 * leak sensors. A Batteries tab shows the battery of every sensor listed,
 * found automatically from each sensor's device.
 *
 * Configuration:
 *   type: custom:security-card
 *   title: Security
 *   alarm_entity: alarm_control_panel.alarmo   # Optional
 *   locks: [lock.front_door]                   # Optional
 *   sensors:                                   # Grouped by device class automatically
 *     - entity: binary_sensor.konnected_front_door_zone_1
 *       name: Front Door
 *     - entity: binary_sensor.kitchen_motion
 *       name: Kitchen
 *   compact: false        # Only show what needs attention (for the Home page)
 *   recent_minutes: 5     # Motion this recent counts as "active" in compact mode (default 5)
 *   battery_low: 20       # Battery % shown as low (default 20)
 */

const SC_GROUPS = [
  { key: 'openings', title: 'Doors & windows', icon: 'mdi:door', classes: ['door', 'window', 'garage_door', 'opening'] },
  { key: 'motion',   title: 'Motion',          icon: 'mdi:motion-sensor', classes: ['motion', 'occupancy', 'presence', 'moving'] },
  { key: 'leaks',    title: 'Leaks',           icon: 'mdi:water', classes: ['moisture'] },
  { key: 'safety',   title: 'Safety',          icon: 'mdi:smoke-detector', classes: ['smoke', 'gas', 'carbon_monoxide', 'heat', 'tamper', 'safety', 'problem'] },
  { key: 'other',    title: 'Other',           icon: 'mdi:shield-outline', classes: [] },
];

const SC_ICONS = {
  door: ['mdi:door-open', 'mdi:door-closed'],
  window: ['mdi:window-open-variant', 'mdi:window-closed-variant'],
  garage_door: ['mdi:garage-open', 'mdi:garage'],
  opening: ['mdi:square-rounded-outline', 'mdi:square-rounded'],
  motion: ['mdi:motion-sensor', 'mdi:motion-sensor-off'],
  occupancy: ['mdi:home-account', 'mdi:home-outline'],
  presence: ['mdi:home-account', 'mdi:home-outline'],
  moisture: ['mdi:water-alert', 'mdi:water-outline'],
  smoke: ['mdi:smoke-detector-alert', 'mdi:smoke-detector'],
};

const SC_ALARM = {
  disarmed:           { label: 'Disarmed',     icon: 'mdi:shield-off-outline', tone: 'muted' },
  armed_home:         { label: 'Armed home',   icon: 'mdi:shield-home',        tone: 'ok' },
  armed_away:         { label: 'Armed away',   icon: 'mdi:shield-lock',        tone: 'ok' },
  armed_night:        { label: 'Armed night',  icon: 'mdi:shield-moon',        tone: 'ok' },
  armed_vacation:     { label: 'Armed vacation', icon: 'mdi:shield-airplane',  tone: 'ok' },
  armed_custom_bypass:{ label: 'Armed',        icon: 'mdi:shield-check',       tone: 'ok' },
  arming:             { label: 'Arming…',      icon: 'mdi:shield-sync',        tone: 'warn' },
  pending:            { label: 'Pending',      icon: 'mdi:shield-alert',       tone: 'warn' },
  disarming:          { label: 'Disarming…',   icon: 'mdi:shield-sync',        tone: 'warn' },
  triggered:          { label: 'TRIGGERED',    icon: 'mdi:alarm-light',        tone: 'error' },
};

const scEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const scMins = (ts) => (Date.now() - new Date(ts).getTime()) / 60000;
const scAgo = (ts) => {
  const m = scMins(ts);
  if (isNaN(m)) return '';
  if (m < 1) return 'now';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

class SecurityCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._tab = 'activity';
    this._batteries = {};
    this._resolvedFor = null;
    this._clock = null;
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const sensors = (config.sensors || []).map((s) => (typeof s === 'string' ? { entity: s } : s)).filter((s) => s.entity);
    this._config = { ...config, sensors, locks: config.locks || [] };
    this._watchedBase = [config.alarm_entity, ...this._config.locks, ...sensors.map((s) => s.entity)].filter(Boolean);
    this._watched = this._watchedBase;
    this._resolvedFor = null;
    if (this._hass) this._resolveBatteries();
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolveBatteries();
    else if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  // "Last seen 4m ago" ages on its own, so refresh every 30 s.
  connectedCallback() { this._clock = setInterval(() => { if (!document.hidden) this._render(); }, 30000); }
  disconnectedCallback() { clearInterval(this._clock); this._clock = null; }

  // Each sensor's battery lives on the same device; find it in the registry.
  _resolveBatteries() {
    const hass = this._hass;
    this._resolvedFor = hass.entities;
    const ids = [...this._config.locks, ...this._config.sensors.map((s) => s.entity)];
    const batteries = {};
    const all = Object.values(hass.entities || {});
    for (const id of ids) {
      const dev = hass.entities?.[id]?.device_id;
      if (!dev) continue;
      const candidates = all.filter((e) => e.device_id === dev && e.entity_id.startsWith('sensor.')
        && hass.states[e.entity_id]?.attributes?.device_class === 'battery');
      const pick = candidates.find((e) => e.entity_id.endsWith('_battery_plus')) || candidates[0];
      if (pick) batteries[id] = pick.entity_id;
    }
    this._batteries = batteries;
    this._watched = [...this._watchedBase, ...Object.values(batteries)];
  }

  _group(dc) {
    return SC_GROUPS.find((g) => g.classes.includes(dc)) || SC_GROUPS[SC_GROUPS.length - 1];
  }

  _name(s) {
    return s.name || this._hass.states[s.entity]?.attributes?.friendly_name || s.entity;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const hass = this._hass;
    const recent = cfg.recent_minutes ?? 5;
    const batLow = cfg.battery_low ?? 20;

    // ── Collect states ───────────────────────────────────────────────────────
    const groups = Object.fromEntries(SC_GROUPS.map((g) => [g.key, []]));
    for (const s of cfg.sensors) {
      const st = hass?.states[s.entity];
      const dc = st?.attributes?.device_class;
      const g = this._group(dc);
      const unavailable = !st || st.state === 'unavailable' || st.state === 'unknown';
      const on = st?.state === 'on';
      const mins = st ? scMins(st.last_changed) : Infinity;
      groups[g.key].push({ ...s, name: this._name(s), st, dc, on, unavailable, mins, group: g.key });
    }
    const locks = cfg.locks.map((id) => {
      const st = hass?.states[id];
      return { entity: id, name: st?.attributes?.friendly_name || id, st, unlocked: st?.state === 'unlocked' || st?.state === 'open',
               jammed: st?.state === 'jammed', unavailable: !st || st.state === 'unavailable' };
    });

    const open = groups.openings.filter((x) => x.on);
    const motionNow = groups.motion.filter((x) => x.on || (!x.unavailable && x.mins <= recent));
    const wet = [...groups.leaks, ...groups.safety].filter((x) => x.on);
    const unlocked = locks.filter((l) => l.unlocked || l.jammed);
    const offline = [...Object.values(groups).flat(), ...locks].filter((x) => x.unavailable);

    // ── Header summary ───────────────────────────────────────────────────────
    const alarmSt = cfg.alarm_entity && hass?.states[cfg.alarm_entity]?.state;
    const alarm = alarmSt ? (SC_ALARM[alarmSt] || { label: alarmSt, icon: 'mdi:shield', tone: 'muted' }) : null;
    const issues = [];
    if (wet.length) issues.push(`${wet.map((x) => x.name).join(', ')} alert`);
    if (open.length) issues.push(`${open.length} open`);
    if (unlocked.length) issues.push(`${unlocked.length} unlocked`);
    if (motionNow.length) issues.push(`motion in ${motionNow.slice(0, 2).map((x) => x.name).join(', ')}${motionNow.length > 2 ? ` +${motionNow.length - 2}` : ''}`);
    const headTone = wet.length || alarmSt === 'triggered' ? 'error' : open.length || unlocked.length ? 'warn' : 'ok';
    const headline = issues.length ? issues.join(' · ') : 'All secure';
    const headline2 = headline.charAt(0).toUpperCase() + headline.slice(1);

    // ── Tiles ────────────────────────────────────────────────────────────────
    const tile = (x) => {
      const icons = SC_ICONS[x.dc] || ['mdi:checkbox-blank-circle', 'mdi:checkbox-blank-circle-outline'];
      let cls = '', label = '';
      if (x.unavailable) { cls = 'off'; label = 'Offline'; }
      else if (x.group === 'motion') {
        const m = x.mins;
        cls = x.on ? 'heat-4' : m <= 5 ? 'heat-3' : m <= 30 ? 'heat-2' : m <= 120 ? 'heat-1' : '';
        label = x.on ? 'Now' : scAgo(x.st.last_changed);
      } else if (x.group === 'openings') {
        cls = x.on ? 'warn' : '';
        label = x.on ? `Open · ${scAgo(x.st.last_changed)}` : 'Closed';
      } else {
        cls = x.on ? 'error' : '';
        label = x.on ? 'ALERT' : 'OK';
      }
      return `
        <div class="tile ${cls}" data-act="more" data-e="${scEsc(x.entity)}" title="${scEsc(x.name)}">
          <ha-icon icon="${x.unavailable ? 'mdi:help-circle-outline' : x.on ? icons[0] : icons[1]}"></ha-icon>
          <div class="tn">${scEsc(x.name)}</div>
          <div class="tl">${scEsc(label)}</div>
        </div>`;
    };
    const lockTile = (l) => `
      <div class="tile ${l.unavailable ? 'off' : l.jammed ? 'error' : l.unlocked ? 'warn' : 'ok'}" data-act="more" data-e="${scEsc(l.entity)}">
        <ha-icon icon="${l.jammed ? 'mdi:lock-alert' : l.unlocked ? 'mdi:lock-open-variant' : 'mdi:lock'}"></ha-icon>
        <div class="tn">${scEsc(l.name)}</div>
        <div class="tl">${l.unavailable ? 'Offline' : l.jammed ? 'Jammed' : l.unlocked ? 'Unlocked' : 'Locked'}</div>
      </div>`;

    let body = '';
    if (cfg.compact) {
      const active = [...wet, ...unlocked.map((l) => ({ ...l, lock: true })), ...open, ...motionNow,
        ...offline];
      const seen = new Set();
      const uniq = active.filter((x) => !seen.has(x.entity) && seen.add(x.entity));
      body = uniq.length ? `<div class="grid">${uniq.map((x) => (x.lock || x.entity.startsWith('lock.') ? lockTile(x) : tile(x))).join('')}</div>` : '';
    } else if (this._tab === 'batteries') {
      const rows = [...locks.map((l) => ({ entity: l.entity, name: l.name })), ...cfg.sensors.map((s) => ({ entity: s.entity, name: this._name(s) }))]
        .map((x) => {
          const bid = this._batteries[x.entity];
          const v = bid ? parseFloat(hass.states[bid]?.state) : NaN;
          return { ...x, bid, pct: isNaN(v) ? null : v };
        })
        .filter((x) => x.bid)
        .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
      body = rows.length ? `<div class="bats">${rows.map((r) => {
        const color = r.pct == null ? 'var(--disabled-text-color,#9e9e9e)' : r.pct <= batLow / 2 ? 'var(--error-color,#f44336)'
          : r.pct <= batLow ? 'var(--warning-color,#ff9800)' : 'var(--success-color,#4caf50)';
        return `<div class="bat" data-act="more" data-e="${scEsc(r.bid)}">
          <span class="bn">${scEsc(r.name)}</span>
          <div class="bar"><div class="bf" style="width:${r.pct ?? 0}%;background:${color}"></div></div>
          <span class="bv" style="${r.pct != null && r.pct <= batLow ? `color:${color}` : ''}">${r.pct == null ? '—' : Math.round(r.pct) + '%'}</span>
        </div>`;
      }).join('')}</div>` : `<div class="none">None of these sensors report a battery.</div>`;
    } else {
      const sections = [];
      if (locks.length) sections.push(['Locks', 'mdi:lock', locks.map(lockTile).join('')]);
      for (const g of SC_GROUPS) {
        const list = groups[g.key];
        if (!list.length) continue;
        if (g.key === 'motion') list.sort((a, b) => (b.on - a.on) || (a.mins - b.mins));
        if (g.key === 'openings') list.sort((a, b) => b.on - a.on);
        sections.push([g.title, g.icon, list.map(tile).join('')]);
      }
      body = sections.map(([t, i, tiles]) => `
        <div class="sec"><div class="st"><ha-icon icon="${i}"></ha-icon>${t}</div><div class="grid">${tiles}</div></div>`).join('');
    }

    const hasBatteries = Object.keys(this._batteries).length > 0;
    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .head { display: flex; align-items: center; gap: 12px; }
        .hi { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 26px; }
        .tone-ok .hi    { background: rgba(76,175,80,.15);  color: var(--success-color,#4caf50); }
        .tone-warn .hi  { background: rgba(255,152,0,.15);  color: var(--warning-color,#ff9800); }
        .tone-error .hi { background: rgba(244,67,54,.18);  color: var(--error-color,#f44336); animation: throb 1.2s infinite; }
        @keyframes throb { 50% { background: rgba(244,67,54,.4); } }
        .hb { flex: 1; min-width: 0; }
        .ht { font-size: .78em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .hl { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .alarm { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px 5px 8px; border-radius: 16px; cursor: pointer;
                 font-size: .8em; font-weight: 600; white-space: nowrap; --mdc-icon-size: 16px; flex-shrink: 0; }
        .alarm.muted { background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .alarm.ok    { background: rgba(76,175,80,.15); color: var(--success-color,#4caf50); }
        .alarm.warn  { background: rgba(255,152,0,.15); color: var(--warning-color,#ff9800); }
        .alarm.error { background: var(--error-color,#f44336); color: #fff; }

        .tabs { display: flex; gap: 4px; margin: 12px 0 2px; padding: 3px; border-radius: 10px; background: var(--secondary-background-color); }
        .tab { flex: 1; border: none; background: none; padding: 6px; border-radius: 8px; cursor: pointer; font: inherit; font-size: .85em;
               font-weight: 500; color: var(--secondary-text-color); }
        .tab.on { background: var(--card-background-color, #fff); color: var(--primary-text-color); box-shadow: 0 1px 3px rgba(0,0,0,.15); }

        .sec { margin-top: 14px; }
        .st { display: flex; align-items: center; gap: 6px; font-size: .75em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
              color: var(--secondary-text-color); margin-bottom: 8px; --mdc-icon-size: 15px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
        .head + .grid { margin-top: 12px; }
        .tile { position: relative; padding: 10px 8px 8px; border-radius: 12px; cursor: pointer; text-align: center; min-width: 0;
                background: var(--secondary-background-color, rgba(127,127,127,.08)); color: var(--secondary-text-color);
                transition: background .4s, box-shadow .4s; --mdc-icon-size: 24px; }
        .tile .tn { font-size: .8em; font-weight: 500; color: var(--primary-text-color); margin-top: 4px;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tile .tl { font-size: .72em; margin-top: 1px; }
        .tile.ok ha-icon { color: var(--success-color,#4caf50); }
        .tile.warn  { background: rgba(255,152,0,.16); color: var(--warning-color,#ff9800); }
        .tile.error { background: rgba(244,67,54,.2);  color: var(--error-color,#f44336); }
        .tile.off   { opacity: .5; }
        /* motion heat: glows when active, fades over two hours */
        .tile.heat-4 { background: rgba(3,169,244,.32); color: var(--primary-color,#03a9f4); box-shadow: 0 0 0 2px var(--primary-color,#03a9f4) inset; }
        .tile.heat-3 { background: rgba(3,169,244,.24); color: var(--primary-color,#03a9f4); }
        .tile.heat-2 { background: rgba(3,169,244,.14); color: var(--primary-color,#03a9f4); }
        .tile.heat-1 { background: rgba(3,169,244,.07); }

        .bats { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
        .bat { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .bn { width: 42%; font-size: .85em; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .bf { height: 100%; border-radius: 3px; }
        .bv { width: 38px; text-align: right; font-size: .85em; font-weight: 600; color: var(--primary-text-color); }
        .none { margin-top: 12px; font-size: .85em; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="head tone-${headTone}">
          <div class="hi"><ha-icon icon="${headTone === 'ok' ? 'mdi:shield-check' : headTone === 'warn' ? 'mdi:shield-alert' : 'mdi:shield-alert'}"></ha-icon></div>
          <div class="hb">
            <div class="ht">${scEsc(cfg.title || 'Security')}</div>
            <div class="hl" title="${scEsc(headline2)}">${scEsc(headline2)}</div>
          </div>
          ${alarm ? `<div class="alarm ${alarm.tone}" data-act="more" data-e="${scEsc(cfg.alarm_entity)}"><ha-icon icon="${alarm.icon}"></ha-icon>${scEsc(alarm.label)}</div>` : ''}
        </div>
        ${!cfg.compact && hasBatteries ? `
          <div class="tabs">
            <button class="tab ${this._tab === 'activity' ? 'on' : ''}" data-act="tab" data-t="activity">Activity</button>
            <button class="tab ${this._tab === 'batteries' ? 'on' : ''}" data-act="tab" data-t="batteries">Batteries</button>
          </div>` : ''}
        ${body}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'tab') { this._tab = el.dataset.t; this._render(); return; }
    if (el.dataset.act === 'more') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    }
  }

  getCardSize() { return this._config?.compact ? 2 : 6; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('security-card-editor');
  }

  static getStubConfig(hass) {
    const sensors = Object.entries(hass?.states || {})
      .filter(([id, s]) => id.startsWith('binary_sensor.') && ['door', 'window', 'motion', 'moisture'].includes(s.attributes.device_class))
      .slice(0, 8).map(([entity]) => ({ entity }));
    return { title: 'Security', sensors };
  }
}

customElements.define('security-card', SecurityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'security-card',
  name: 'Security Overview Card',
  description: 'Alarm, locks, doors, motion and leaks in one card, with sensor batteries.',
  preview: false,
});

class SecurityCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:shield-home', schema: [
        f.text('title', 'Title'),
        f.entity('alarm_entity', 'Alarm panel', undefined, 'alarm_control_panel'),
        f.entities('locks', 'Locks', undefined, 'lock'),
      ] },
      { title: 'Display', icon: 'mdi:tune-vertical', open: false, schema: [
        f.toggle('compact', 'Compact', 'Only show what needs attention — good for the Home page'),
        f.grid(
          f.number('recent_minutes', 'Motion counts as recent for', { min: 1, max: 120, unit: 'min', helper: 'Compact mode. Default: 5' }),
          f.number('battery_low', 'Battery low at', { min: 1, max: 100, unit: '%', helper: 'Default: 20' }),
        ),
      ] },
      { title: 'Sensors', icon: 'mdi:motion-sensor', list: {
        key: 'sensors',
        schema: [f.grid(f.entity('entity', 'Sensor', undefined, 'binary_sensor'), f.text('name', 'Name'))],
        label: (s, i) => s.name || s.entity || `Sensor ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add sensor',
      } },
    ];
  }
}

customElements.define('security-card-editor', SecurityCardEditor);
