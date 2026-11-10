/**
 * Home Assistant Health Card
 *
 * One checklist for the state of Home Assistant itself: backups, updates,
 * repairs (Spook), missing entities (Watchman) and system load. Healthy items
 * collapse to a tick; problems expand to show what needs doing. Everything is
 * found automatically — set an entity only to override it.
 *
 * Configuration:
 *   type: custom:ha-health-card
 *   title: Home Assistant
 *   backup_max_age: 26            # Hours before the last backup counts as stale (default 26)
 *   hide_system: false            # Hide the CPU / memory / disk / uptime row
 *   # Optional overrides (auto-detected when left out):
 *   cpu_entity: sensor.processor_use
 *   memory_entity: sensor.memory_use_percent
 *   disk_entity: sensor.disk_use_percent
 *   uptime_entity: sensor.uptime
 *   repairs_entity: sensor.active_issues
 *   watchman_entity: sensor.watchman_missing_entities
 */

const HH_DEFAULTS = {
  cpu_entity: ['sensor.processor_use', 'sensor.system_monitor_processor_use', 'sensor.processor_use_percent'],
  memory_entity: ['sensor.memory_use_percent', 'sensor.system_monitor_memory_usage'],
  disk_entity: ['sensor.disk_use_percent', 'sensor.disk_use_percent_config', 'sensor.disk_use_percent_home', 'sensor.system_monitor_disk_usage'],
  uptime_entity: ['sensor.uptime', 'sensor.last_boot', 'sensor.system_monitor_last_boot'],
  repairs_entity: ['sensor.active_issues'],
  ignored_entity: ['sensor.ignored_issues'],
  watchman_entity: ['sensor.watchman_missing_entities'],
  watchman_actions_entity: ['sensor.watchman_missing_actions'],
  backup_last_entity: ['sensor.backup_last_successful_automatic_backup'],
  backup_attempt_entity: ['sensor.backup_last_attempted_automatic_backup'],
  backup_next_entity: ['sensor.backup_next_scheduled_automatic_backup'],
  backup_size_entity: ['sensor.backup_last_successful_automatic_backup_size'],
  backup_state_entity: ['sensor.backup_backup_manager_state'],
  core_update_entity: ['update.home_assistant_core_update'],
};

const hhEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function hhRel(d, future) {
  if (!d || isNaN(d)) return '';
  const m = Math.abs(d - Date.now()) / 60000;
  const t = m < 60 ? `${Math.round(m)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return future ? `in ${t}` : `${t} ago`;
}

class HaHealthCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._open = new Set();
    this._ids = {};
    this._updates = [];
    this._watched = [];
    this._resolvedFor = null;
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    this._config = config || {};
    this._resolvedFor = null;
    if (this._hass) this._resolve();
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    else if (old && !this._watched.some((id) => hass.states[id] !== old.states[id])) return;
    this._render();
  }

  connectedCallback() { this._clock = setInterval(() => { if (!document.hidden) this._render(); }, 60000); }
  disconnectedCallback() { clearInterval(this._clock); }

  _resolve() {
    const hass = this._hass;
    this._resolvedFor = hass.entities;
    const ids = {};
    for (const [key, candidates] of Object.entries(HH_DEFAULTS)) {
      ids[key] = this._config[key] || candidates.find((id) => hass.states[id]);
    }
    this._ids = ids;
    this._updates = Object.keys(hass.states).filter((id) => id.startsWith('update.'));
    this._watched = [...Object.values(ids).filter(Boolean), ...this._updates];
  }

  _st(key) {
    const id = this._ids[key];
    const s = id && this._hass?.states[id];
    return s && !['unavailable', 'unknown'].includes(s.state) ? s : null;
  }

  _num(key) {
    const v = parseFloat(this._st(key)?.state);
    return isNaN(v) ? null : v;
  }

  // One checklist row. `items` (HTML) shows when the row is expanded.
  _item(key, tone, icon, label, value, items, link) {
    const open = items && this._open.has(key);
    return `
      <div class="item t-${tone} ${items ? 'exp' : ''}">
        <div class="ih" ${items ? `data-act="toggle" data-k="${key}"` : link ? `data-act="nav" data-p="${hhEsc(link)}"` : ''}>
          <div class="ic"><ha-icon icon="${tone === 'ok' ? 'mdi:check-circle' : tone === 'warn' ? 'mdi:alert-circle' : tone === 'crit' ? 'mdi:close-circle' : icon}"></ha-icon></div>
          <div class="il"><div class="in">${label}</div><div class="iv">${value}</div></div>
          ${items ? `<ha-icon class="chev ${open ? 'up' : ''}" icon="mdi:chevron-down"></ha-icon>` : link ? '<ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>' : ''}
        </div>
        ${open ? `<div class="ib">${items}</div>` : ''}
      </div>`;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const hass = this._hass;
    const rows = [];
    const issues = [];

    // ── Backups ──────────────────────────────────────────────────────────────
    const last = this._st('backup_last_entity');
    if (last || this._st('backup_attempt_entity')) {
      const lastD = last ? new Date(last.state) : null;
      const attempt = this._st('backup_attempt_entity') ? new Date(this._st('backup_attempt_entity').state) : null;
      const next = this._st('backup_next_entity') ? new Date(this._st('backup_next_entity').state) : null;
      const size = this._num('backup_size_entity');
      const running = (this._st('backup_state_entity')?.state || 'idle') !== 'idle';
      const failed = attempt && (!lastD || attempt - lastD > 3600000);
      const ageH = lastD ? (Date.now() - lastD) / 3600000 : Infinity;
      const stale = ageH > (cfg.backup_max_age ?? 26);
      const tone = failed ? 'crit' : stale ? 'warn' : 'ok';
      if (failed) issues.push('backup failed'); else if (stale) issues.push('backup is old');
      const bits = [
        running ? 'Backing up now…' : failed ? `Last attempt failed ${hhRel(attempt)}` : lastD ? `Last backup ${hhRel(lastD)}` : 'No backup yet',
        size != null ? `${size >= 1024 ? (size / 1024).toFixed(1) + ' GB' : Math.round(size) + ' MB'}` : '',
        next && next > Date.now() ? `next ${hhRel(next, true)}` : '',
      ].filter(Boolean).join(' · ');
      rows.push(this._item('backup', running ? 'run' : tone, 'mdi:backup-restore', 'Backups', hhEsc(bits), null, '/config/backup'));
    }

    // ── Updates ──────────────────────────────────────────────────────────────
    const pending = this._updates.map((id) => hass?.states[id]).filter((s) => s && s.state === 'on');
    if (this._updates.length) {
      const coreId = this._ids.core_update_entity;
      pending.sort((a, b) => (b.entity_id === coreId) - (a.entity_id === coreId));
      if (pending.length) issues.push(`${pending.length} update${pending.length > 1 ? 's' : ''}`);
      const list = pending.map((s) => `
        <div class="li" data-act="more" data-e="${hhEsc(s.entity_id)}">
          <ha-icon icon="mdi:package-up"></ha-icon>
          <span class="ln">${hhEsc(s.attributes.title || s.attributes.friendly_name || s.entity_id)}</span>
          <span class="lv">${hhEsc(s.attributes.installed_version || '?')} → <b>${hhEsc(s.attributes.latest_version || '?')}</b></span>
        </div>`).join('');
      rows.push(this._item('updates', pending.length ? 'warn' : 'ok', 'mdi:update', 'Updates',
        pending.length ? `${pending.length} available` : `All ${this._updates.length} up to date`,
        pending.length ? `${list}<div class="link" data-act="nav" data-p="/config/updates">Open updates</div>` : null));
    }

    // ── Repairs (Spook) ──────────────────────────────────────────────────────
    const rep = this._num('repairs_entity');
    if (rep != null) {
      const ign = this._num('ignored_entity');
      if (rep > 0) issues.push(`${rep} repair${rep > 1 ? 's' : ''}`);
      rows.push(this._item('repairs', rep > 0 ? 'warn' : 'ok', 'mdi:wrench', 'Repairs',
        `${rep > 0 ? `${rep} open` : 'Nothing to fix'}${ign ? ` · ${ign} ignored` : ''}`, null, '/config/repairs'));
    }

    // ── Watchman ─────────────────────────────────────────────────────────────
    const wm = this._st('watchman_entity');
    if (wm) {
      const n = parseFloat(wm.state) || 0;
      const acts = this._num('watchman_actions_entity') || 0;
      const missing = Array.isArray(wm.attributes.entities) ? wm.attributes.entities : [];
      if (n + acts > 0) issues.push(`${n + acts} missing`);
      const list = missing.slice(0, 15).map((e) => {
        const where = String(e.occurrences || '').split('\n')[0].replace(/^\.storage\//, '').replace(/:\d+$/, '');
        return `<div class="li" ${hass?.states[e.id] ? `data-act="more" data-e="${hhEsc(e.id)}"` : ''}>
          <ha-icon icon="${e.state === 'missing' ? 'mdi:help-circle-outline' : 'mdi:lan-disconnect'}"></ha-icon>
          <span class="ln">${hhEsc(e.friendly_name || e.id)}<small>${hhEsc(e.id)}</small></span>
          <span class="lv"><span class="tag">${hhEsc(e.state)}</span>${where ? `<small>${hhEsc(where)}</small>` : ''}</span>
        </div>`;
      }).join('');
      const more = missing.length > 15 ? `<div class="muted">…and ${missing.length - 15} more</div>` : '';
      rows.push(this._item('watchman', n + acts > 0 ? 'warn' : 'ok', 'mdi:binoculars', 'Missing entities',
        n + acts > 0 ? `${n} entit${n === 1 ? 'y' : 'ies'}${acts ? ` · ${acts} action${acts > 1 ? 's' : ''}` : ''}` : 'None referenced',
        n + acts > 0 ? `${list}${more}<div class="link" data-act="rescan">Rescan now</div>` : null));
    }

    // ── System ───────────────────────────────────────────────────────────────
    const sys = [];
    if (!cfg.hide_system) {
      for (const [key, label] of [['cpu_entity', 'CPU'], ['memory_entity', 'Memory'], ['disk_entity', 'Disk']]) {
        const v = this._num(key);
        if (v == null) continue;
        const tone = v >= 90 ? 'crit' : v >= 75 ? 'warn' : 'ok';
        if (key === 'disk_entity' && v >= 90) issues.push('disk almost full');
        sys.push(`<div class="sy" data-act="more" data-e="${hhEsc(this._ids[key])}">
          <div class="sv s-${tone}">${Math.round(v)}<small>%</small></div><div class="sl">${label}</div>
          <div class="sb"><div style="width:${Math.min(100, v)}%"></div></div></div>`);
      }
      const up = this._st('uptime_entity');
      if (up) {
        const d = new Date(up.state);
        const txt = isNaN(d) ? up.state : hhRel(d).replace(' ago', '');
        sys.push(`<div class="sy" data-act="more" data-e="${hhEsc(this._ids.uptime_entity)}"><div class="sv">${hhEsc(txt)}</div><div class="sl">Uptime</div></div>`);
      }
    }

    const core = this._st('core_update_entity');
    const version = core?.attributes?.installed_version;
    const tone = rows.some((r) => r.includes('t-crit')) ? 'crit' : issues.length ? 'warn' : 'ok';
    const headline = issues.length ? issues.join(' · ').replace(/^\w/, (c) => c.toUpperCase()) : 'Everything healthy';

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .logo { width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
                --mdc-icon-size: 26px; background: rgba(3,169,244,.14); color: var(--primary-color,#03a9f4); }
        .h-warn .logo { background: rgba(255,152,0,.15); color: var(--warning-color,#ff9800); }
        .h-crit .logo { background: rgba(244,67,54,.15); color: var(--error-color,#f44336); }
        .hb { flex: 1; min-width: 0; }
        .ht { font-size: .75em; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .hl { font-size: 1.02em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .sys { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 8px; margin-bottom: 10px; }
        .sy { border-radius: 10px; padding: 8px 6px 7px; text-align: center; cursor: pointer; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .sv { font-size: 1.05em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; }
        .sv small { font-size: .65em; font-weight: 500; color: var(--secondary-text-color); }
        .sv.s-warn { color: var(--warning-color,#ff9800); } .sv.s-crit { color: var(--error-color,#f44336); }
        .sl { font-size: .66em; text-transform: uppercase; letter-spacing: .05em; color: var(--secondary-text-color); }
        .sb { height: 3px; border-radius: 2px; background: rgba(127,127,127,.2); margin: 5px 4px 0; overflow: hidden; }
        .sb div { height: 100%; background: var(--primary-color,#03a9f4); }

        .list { display: flex; flex-direction: column; gap: 6px; }
        .item { border-radius: 12px; background: var(--secondary-background-color, rgba(127,127,127,.08)); overflow: hidden; }
        .ih { display: flex; align-items: center; gap: 10px; padding: 9px 10px; }
        .ih[data-act] { cursor: pointer; }
        .ic { --mdc-icon-size: 22px; line-height: 0; color: var(--secondary-text-color); }
        .t-ok .ic { color: var(--success-color,#4caf50); } .t-warn .ic { color: var(--warning-color,#ff9800); }
        .t-crit .ic { color: var(--error-color,#f44336); } .t-run .ic { color: var(--primary-color,#03a9f4); animation: spin 2s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .il { flex: 1; min-width: 0; }
        .in { font-size: .9em; font-weight: 600; color: var(--primary-text-color); }
        .iv { font-size: .78em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .t-warn .iv, .t-crit .iv { color: var(--primary-text-color); }
        .chev { color: var(--secondary-text-color); --mdc-icon-size: 20px; transition: transform .2s; }
        .chev.up { transform: rotate(180deg); }
        .ib { padding: 0 10px 10px; display: flex; flex-direction: column; gap: 2px; }
        .li { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-top: 1px solid var(--divider-color, rgba(127,127,127,.15));
              font-size: .8em; color: var(--primary-text-color); --mdc-icon-size: 16px; }
        .li[data-act] { cursor: pointer; }
        .li ha-icon { color: var(--secondary-text-color); flex-shrink: 0; }
        .ln { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ln small, .lv small { display: block; font-size: .85em; color: var(--secondary-text-color); font-family: monospace; overflow: hidden; text-overflow: ellipsis; }
        .lv { text-align: right; flex-shrink: 0; max-width: 45%; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lv b { color: var(--primary-color,#03a9f4); }
        .tag { font-size: .85em; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: rgba(255,152,0,.15); color: var(--warning-color,#ff9800); }
        .link { margin-top: 6px; padding: 7px; text-align: center; border-radius: 8px; cursor: pointer; font-size: .8em; font-weight: 600;
                color: var(--primary-color,#03a9f4); background: rgba(3,169,244,.08); }
        .link:hover { background: rgba(3,169,244,.16); }
        .muted { font-size: .75em; color: var(--secondary-text-color); padding: 4px; }
      </style>
      <ha-card>
        <div class="head h-${tone}">
          <div class="logo"><ha-icon icon="mdi:home-assistant"></ha-icon></div>
          <div class="hb"><div class="ht">${hhEsc(cfg.title || 'Home Assistant')}${version ? ` · ${hhEsc(version)}` : ''}</div>
            <div class="hl" title="${hhEsc(headline)}">${hhEsc(headline)}</div></div>
        </div>
        ${sys.length ? `<div class="sys">${sys.join('')}</div>` : ''}
        <div class="list">${rows.join('')}</div>
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'toggle') {
      const k = el.dataset.k;
      if (this._open.has(k)) this._open.delete(k); else this._open.add(k);
      this._render();
    } else if (act === 'more') {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    } else if (act === 'nav') {
      history.pushState(null, '', el.dataset.p);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
    } else if (act === 'rescan') {
      this._hass.callService('watchman', 'report', { parse_config: true, create_file: false });
      el.textContent = 'Scanning…';
    }
  }

  getCardSize() { return 5; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('ha-health-card-editor');
  }

  static getStubConfig() { return { title: 'Home Assistant' }; }
}

customElements.define('ha-health-card', HaHealthCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'ha-health-card',
  name: 'Home Assistant Health Card',
  description: 'Backups, updates, repairs, missing entities and system load as one checklist.',
  preview: false,
});

class HaHealthCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:home-assistant', schema: [
        f.text('title', 'Title'),
        f.grid(
          f.number('backup_max_age', 'Backup is stale after', { min: 1, unit: 'h', helper: 'Default: 26' }),
          f.toggle('hide_system', 'Hide CPU / memory / disk row'),
        ),
      ] },
      { title: 'Entity overrides', icon: 'mdi:swap-horizontal', open: false, schema: [
        f.grid(f.entity('cpu_entity', 'CPU %', 'Auto-detected', 'sensor'), f.entity('memory_entity', 'Memory %', undefined, 'sensor')),
        f.grid(f.entity('disk_entity', 'Disk %', undefined, 'sensor'), f.entity('uptime_entity', 'Uptime / last boot', undefined, 'sensor')),
        f.grid(f.entity('repairs_entity', 'Repairs count', 'Spook', 'sensor'), f.entity('watchman_entity', 'Missing entities', 'Watchman', 'sensor')),
        f.entity('backup_last_entity', 'Last successful backup', undefined, 'sensor'),
      ] },
    ];
  }
}

customElements.define('ha-health-card-editor', HaHealthCardEditor);
