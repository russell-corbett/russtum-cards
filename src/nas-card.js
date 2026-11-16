/**
 * NAS Card for Home Assistant
 *
 * Drive bays (with per-drive temperature, model and serial), a condition pill,
 * temperature / CPU / memory / uptime, one usage bar per volume, and network
 * links with live up / down speeds. Built for the QNAP integration but works
 * with any NAS that exposes sensors. Tap any row for its details.
 *
 * Configuration (everything except type is optional):
 *   type: custom:nas-card
 *   title: My NAS
 *   status_entity: sensor.nas_status         # Overall status
 *   status_ok_states: [good, ok, online]     # Default: online, running, active, ok, on, healthy, good, normal, ready
 *   status_warn_states: [degraded, warning]  # Shown amber; any other state is a problem (red)
 *                                            # unavailable / unknown = "Offline"
 *
 *   total_drives: 4                          # Total bays; bays beyond the drives list show "Empty"
 *   live_states: [OK]                        # Drive states that count as healthy (default: active, on, ok, good, healthy, normal)
 *   drives:                                  # Explicit drive list (merged with prefix discovery)
 *     - entity: sensor.nas_smart_status_drive_0_1   # Model / "Serial #" attributes are shown on tap
 *       temperature_entity: sensor.nas_temperature_drive_0_1
 *       name: Bay 1
 *   drive_entity_prefix: sensor.nas_drive_   # Auto-detect drives by prefix…
 *   drive_entity_suffix: _status             # …and optional suffix
 *   drive_temp_warn: 45                      # Drive °C shown amber (default 45)
 *   drive_temp_high: 55                      # Drive °C shown red (default 55)
 *
 *   temperature_entity: sensor.nas_system_temperature
 *   temperature_warn: 60                     # System °C warning (default 60)
 *   temperature_high: 75                     # System °C critical (default 75)
 *   cpu_entity: sensor.nas_cpu_usage         # %
 *   memory_entity: sensor.nas_memory_usage   # %
 *   memory_used_entity: sensor.nas_memory_used   # GiB, for a "0.32 / 0.98 GiB" line
 *   memory_size_entity: sensor.nas_memory_size
 *   uptime_entity: sensor.nas_uptime         # Seconds, a boot timestamp, or text
 *
 *   volumes:
 *     - name: Media
 *       used_pct_entity: sensor.nas_volume_used_media   # %
 *       free_entity: sensor.nas_free_space_media        # any byte unit (GiB, TiB…)
 *       size_entity: sensor.nas_volume_size_media
 *   volume_warn: 80                          # % used shown amber (default 80)
 *   volume_high: 90                          # % used shown red (default 90)
 *
 *   network_interfaces:
 *     - entity: sensor.nas_network_link_eth0
 *       name: eth0
 *       up_entity: sensor.nas_network_up_eth0     # MiB/s (any rate unit), shown ↑
 *       down_entity: sensor.nas_network_down_eth0 # shown ↓
 *   network_entity_prefix: sensor.nas_       # Auto-detect links by prefix…
 *   network_entity_suffix: _link             # …and optional suffix
 *   network_live_states: [up, on, connected] # Link-up states (default: on, connected, up)
 */

const nasEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nasLow = (v) => String(v ?? '').toLowerCase();
const nasNA = (v) => v == null || v === 'unavailable' || v === 'unknown';
const nasNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

const NAS_OK_STATES = ['online', 'running', 'active', 'ok', 'on', 'healthy', 'good', 'normal', 'ready'];
const NAS_WARN_STATES = ['degraded', 'warning', 'degrading'];
const NAS_LIVE_STATES = ['active', 'on', 'ok', 'good', 'healthy', 'normal'];
const NAS_LINK_STATES = ['on', 'connected', 'up'];

// Bytes per unit, binary and decimal.
const NAS_BYTES = {
  b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
};

function nasToBytes(value, unit, fallback = 'gib') {
  const n = nasNum(value);
  if (n == null) return null;
  const u = nasLow(unit || fallback).replace(/\/s$|ps$/, '').replace(/\s/g, '');
  return n * (NAS_BYTES[u] ?? NAS_BYTES[fallback]);
}

// Sizes in GiB, switching to TiB at 1024 GiB.
function nasSize(bytes) {
  if (bytes == null) return '—';
  const gib = bytes / NAS_BYTES.gib;
  if (gib >= 1024) return `${(gib / 1024).toFixed(gib >= 10240 ? 1 : 2)} TiB`;
  if (gib >= 100) return `${Math.round(gib)} GiB`;
  return `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB`;
}

// Rates: B/s → KiB/s → MiB/s.
function nasRate(bytesPerSec) {
  if (bytesPerSec == null) return '—';
  if (bytesPerSec >= NAS_BYTES.mib) return `${(bytesPerSec / NAS_BYTES.mib).toFixed(1)} MiB/s`;
  if (bytesPerSec >= NAS_BYTES.kib) return `${(bytesPerSec / NAS_BYTES.kib).toFixed(bytesPerSec >= 100 * NAS_BYTES.kib ? 0 : 1)} KiB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

function formatUptime(val) {
  if (val == null) return '—';
  let secs = null;
  const n = Number(val);
  if (!isNaN(n)) secs = n;
  else {
    // ISO boot timestamp (e.g. 2026-02-17T01:45:33+00:00): time since then.
    const date = new Date(val);
    if (!isNaN(date.getTime())) secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  }
  if (secs == null) return String(val);
  const days = Math.floor(secs / 86400), hours = Math.floor((secs % 86400) / 3600), mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

class NasCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._sel = null;   // index of the bay whose details are open
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._sel = null;
    this._lastHtml = null;
    this._discoveredFor = null;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (oldHass && oldHass.states === hass.states) return;
    if (oldHass && !this._watched().some((id) => hass.states[id] !== oldHass.states[id])) return;
    this._render();
  }

  connectedCallback() {
    // Uptime from a boot timestamp moves on its own.
    this._tick = setInterval(() => { if (this._config?.uptime_entity) this._render(); }, 60 * 1000);
  }

  disconnectedCallback() { clearInterval(this._tick); }

  _watched() {
    const c = this._config;
    return [
      ...this._getDriveEntities().flatMap((d) => [d.entity, d.temperature_entity]),
      ...this._getNetworkEntities().flatMap((n) => [n.entity, n.up_entity, n.down_entity]),
      ...(c.volumes || []).flatMap((v) => [v.used_pct_entity, v.free_entity, v.size_entity]),
      c.status_entity, c.temperature_entity, c.uptime_entity, c.cpu_entity, c.memory_entity, c.memory_used_entity, c.memory_size_entity,
    ].filter(Boolean);
  }

  // ── Entity lists (explicit + prefix discovery) ──────────────────────────
  _discover(prefix, suffix) {
    if (!prefix || !this._hass) return [];
    return Object.keys(this._hass.states).filter((id) => id.startsWith(prefix) && (!suffix || id.endsWith(suffix))).sort();
  }

  _merge(explicit, prefix, suffix) {
    const list = (explicit || []).filter((x) => x && x.entity).map((x) => ({ ...x }));
    const seen = new Set(list.map((x) => x.entity));
    for (const id of this._discover(prefix, suffix)) if (!seen.has(id)) list.push({ entity: id });
    return list.map((x) => ({ ...x, name: x.name || this._nameFromEntity(x.entity) }));
  }

  _getDriveEntities() {
    const c = this._config;
    return this._merge(c.drives, c.drive_entity_prefix, c.drive_entity_suffix);
  }

  _getNetworkEntities() {
    const c = this._config;
    return this._merge(c.network_interfaces, c.network_entity_prefix, c.network_entity_suffix);
  }

  _nameFromEntity(entityId) {
    if (!entityId) return '';
    return entityId.split('.').pop().replace(/_/g, ' ').trim() || entityId;
  }

  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _num(id) { const st = this._st(id); return st && !nasNA(st.state) ? nasNum(st.state) : null; }
  _bytes(id, fallback) { const st = this._st(id); return st && !nasNA(st.state) ? nasToBytes(st.state, st.attributes?.unit_of_measurement, fallback) : null; }

  _level(v, warn, high) { return v == null ? '' : v >= high ? 'high' : v >= warn ? 'warn' : 'ok'; }

  // ── Model ────────────────────────────────────────────────────────────────
  _model() {
    const c = this._config;
    const liveStates = (c.live_states || NAS_LIVE_STATES).map(nasLow);
    const dWarn = c.drive_temp_warn ?? 45, dHigh = c.drive_temp_high ?? 55;
    const tWarn = c.temperature_warn ?? 60, tHigh = c.temperature_high ?? 75;
    const vWarn = c.volume_warn ?? 80, vHigh = c.volume_high ?? 90;

    // Drives
    const drives = this._getDriveEntities().map((d) => {
      const st = this._st(d.entity);
      const state = st?.state ?? 'unavailable';
      const cls = nasNA(state) ? 'unavailable' : liveStates.includes(nasLow(state)) ? 'live' : 'dead';
      const temp = this._num(d.temperature_entity);
      const a = st?.attributes || {};
      return { ...d, st, state, cls, temp, tLevel: this._level(temp, dWarn, dHigh),
        model: a.Model || a.model || '', serial: a['Serial #'] || a.serial || a.serial_number || '' };
    });
    const total = Math.max(Number(c.total_drives) || 0, drives.length);
    const bays = [...drives];
    while (bays.length < total) bays.push({ entity: null, name: `Bay ${bays.length + 1}`, cls: 'empty', state: 'empty' });
    const liveDrives = drives.filter((d) => d.cls === 'live').length;

    // Status
    let status = null;
    if (c.status_entity) {
      const v = this._st(c.status_entity)?.state;
      const okStates = (c.status_ok_states || NAS_OK_STATES).map(nasLow);
      const warnStates = (c.status_warn_states || NAS_WARN_STATES).map(nasLow);
      status = { value: v, kind: nasNA(v) ? 'offline' : okStates.includes(nasLow(v)) ? 'ok' : warnStates.includes(nasLow(v)) ? 'warn' : 'bad' };
    }

    // System stats
    const temp = this._num(c.temperature_entity);
    const tempUnit = this._st(c.temperature_entity)?.attributes?.unit_of_measurement || '°C';
    const cpu = this._num(c.cpu_entity);
    const mem = this._num(c.memory_entity);
    const memUsed = this._bytes(c.memory_used_entity), memSize = this._bytes(c.memory_size_entity);

    // Volumes
    const volumes = (c.volumes || []).filter((v) => v && (v.used_pct_entity || v.size_entity)).map((v) => {
      const size = this._bytes(v.size_entity), free = this._bytes(v.free_entity);
      let pct = this._num(v.used_pct_entity);
      if (pct == null && size && free != null) pct = ((size - free) / size) * 100;
      const used = size != null && free != null ? size - free : size != null && pct != null ? (size * pct) / 100 : null;
      return { ...v, size, free, used, pct, level: this._level(pct, vWarn, vHigh),
        entity: v.used_pct_entity || v.size_entity || v.free_entity, na: pct == null && size == null };
    });

    // Network
    const linkStates = (c.network_live_states || NAS_LINK_STATES).map(nasLow);
    const nets = this._getNetworkEntities().map((n) => {
      const state = this._st(n.entity)?.state ?? 'unavailable';
      const cls = nasNA(state) ? 'unavailable' : linkStates.includes(nasLow(state)) ? 'live' : 'dead';
      const rate = (id) => { const st = this._st(id); return st && !nasNA(st.state) ? nasToBytes(st.state, st.attributes?.unit_of_measurement || 'MiB/s', 'mib') : null; };
      return { ...n, state, cls, up: rate(n.up_entity), down: rate(n.down_entity) };
    });

    // Worst condition: Offline > status problem > drive not OK > volume high > hot > OK
    const hotDrive = drives.find((d) => d.tLevel === 'high' || d.tLevel === 'warn');
    const sysLevel = this._level(temp, tWarn, tHigh);
    const fullVol = volumes.filter((v) => v.level === 'high').sort((a, b) => b.pct - a.pct)[0];
    const badDrives = drives.filter((d) => d.cls !== 'live');
    let pill;
    if (status?.kind === 'offline' || (!c.status_entity && drives.length && drives.every((d) => d.cls === 'unavailable'))) {
      pill = { kind: 'offline', icon: 'mdi:lan-disconnect', text: 'Offline', entity: c.status_entity };
    } else if (status && status.kind !== 'ok') {
      pill = { kind: status.kind === 'warn' ? 'warn' : 'bad', icon: 'mdi:alert-circle', text: String(status.value), entity: c.status_entity };
    } else if (badDrives.length) {
      const d = badDrives[0];
      pill = { kind: 'bad', icon: 'mdi:harddisk-remove', text: badDrives.length > 1 ? `${badDrives.length} drives need attention` : `${d.name}: ${nasNA(d.state) ? 'offline' : d.state}`, entity: d.entity };
    } else if (fullVol) {
      pill = { kind: 'bad', icon: 'mdi:database-alert', text: `${fullVol.name || 'Volume'} ${Math.round(fullVol.pct)}% full`, entity: fullVol.entity };
    } else if (sysLevel === 'high' || sysLevel === 'warn' || hotDrive) {
      // Hottest first: system critical, drive critical, system warm, drive warm.
      const hotHigh = drives.find((d) => d.tLevel === 'high');
      const useSys = sysLevel === 'high' || (!hotHigh && sysLevel === 'warn');
      const d = hotHigh || hotDrive;
      pill = useSys
        ? { kind: sysLevel === 'high' ? 'bad' : 'warn', icon: 'mdi:thermometer-alert', text: `Hot · ${Math.round(temp)}${tempUnit}`, entity: c.temperature_entity }
        : { kind: d.tLevel === 'high' ? 'bad' : 'warn', icon: 'mdi:thermometer-alert', text: `${d.name} ${Math.round(d.temp)}°`, entity: d.temperature_entity };
    } else {
      pill = { kind: 'ok', icon: 'mdi:check-circle', text: status ? String(status.value) : 'OK', entity: c.status_entity };
    }
    if (/^[a-z]/.test(pill.text)) pill.text = pill.text[0].toUpperCase() + pill.text.slice(1);

    return { drives, bays, total, liveDrives, status, temp, tempUnit, sysLevel, cpu, mem, memUsed, memSize, volumes, nets, pill };
  }

  // ── Render ───────────────────────────────────────────────────────────────
  _render() {
    if (!this._config) return;
    const c = this._config;
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:16px">${nasEsc(c.title || 'NAS')}</ha-card>`;
      return;
    }
    const m = this._model();
    const title = c.title || 'NAS';
    const iconColor = { ok: 'var(--success-color, #4caf50)', warn: 'var(--warning-color, #ff9800)', bad: 'var(--error-color, #f44336)', offline: 'var(--disabled-text-color, #9e9e9e)' }[m.pill.kind];
    const populated = m.drives.length;
    const summary = m.total ? `${m.liveDrives} / ${populated} drive${populated === 1 ? '' : 's'} OK · ${m.total} bays` : '';
    const sel = this._sel != null ? m.bays[this._sel] : null;

    const stat = (entity, icon, label, value, extra = '', level = '', bar = null) => `
      <button class="stat ${level}" data-act="more" data-e="${nasEsc(entity)}" aria-label="${nasEsc(`${label}: ${value}${extra ? `, ${extra}` : ''}`)}">
        <ha-icon icon="${icon}"></ha-icon>
        <span class="stat-body">
          <span class="stat-label">${label}</span>
          <span class="stat-value">${nasEsc(value)}</span>
          ${extra ? `<span class="stat-extra">${nasEsc(extra)}</span>` : ''}
          ${bar != null ? `<span class="mini"><i style="width:${Math.max(0, Math.min(100, bar)).toFixed(1)}%"></i></span>` : ''}
        </span>
      </button>`;

    const stats = [
      c.temperature_entity && stat(c.temperature_entity, m.sysLevel === 'ok' || !m.sysLevel ? 'mdi:thermometer' : 'mdi:thermometer-alert', 'Temperature',
        m.temp != null ? `${Math.round(m.temp)}${m.tempUnit}` : '—', '', m.sysLevel),
      c.cpu_entity && stat(c.cpu_entity, 'mdi:cpu-64-bit', 'CPU', m.cpu != null ? `${Math.round(m.cpu)}%` : '—', '', '', m.cpu),
      (c.memory_entity || c.memory_used_entity) && stat(c.memory_entity || c.memory_used_entity, 'mdi:memory', 'Memory',
        m.mem != null ? `${Math.round(m.mem)}%` : m.memUsed != null && m.memSize ? `${Math.round((m.memUsed / m.memSize) * 100)}%` : '—',
        m.memUsed != null && m.memSize != null ? `${(m.memUsed / NAS_BYTES.gib).toFixed(2)} / ${(m.memSize / NAS_BYTES.gib).toFixed(2)} GiB` : '',
        '', m.mem ?? (m.memUsed != null && m.memSize ? (m.memUsed / m.memSize) * 100 : null)),
      c.uptime_entity && stat(c.uptime_entity, 'mdi:clock-outline', 'Uptime', formatUptime(nasNA(this._st(c.uptime_entity)?.state) ? null : this._st(c.uptime_entity)?.state)),
    ].filter(Boolean).join('');

    const bays = m.bays.map((d, i) => {
      const icon = d.cls === 'empty' ? 'mdi:harddisk-plus' : d.cls === 'dead' ? 'mdi:harddisk-remove' : 'mdi:harddisk';
      const tip = d.entity ? [`${d.name}: ${d.state}`, d.model && `Model: ${d.model}`, d.serial && `Serial #: ${d.serial}`, d.temp != null && `${Math.round(d.temp)}°C`].filter(Boolean).join('\n') : `${d.name}: empty`;
      const sub = d.cls === 'empty' ? 'Empty' : d.temp != null ? `${Math.round(d.temp)}°` : nasNA(d.state) ? 'Offline' : d.state;
      return `<button class="drive ${d.cls} ${this._sel === i ? 'sel' : ''}" data-act="bay" data-i="${i}" title="${nasEsc(tip)}"
          ${d.entity ? `aria-expanded="${this._sel === i}"` : 'disabled'} aria-label="${nasEsc(tip.replace(/\n/g, ', '))}">
          <ha-icon icon="${icon}"></ha-icon>
          <span class="drive-name">${nasEsc(d.name)}</span>
          <span class="drive-sub ${d.tLevel || ''}">${nasEsc(sub)}</span>
        </button>`;
    }).join('');

    const detail = sel && sel.entity ? `
      <button class="detail" data-act="more" data-e="${nasEsc(sel.entity)}" aria-label="${nasEsc(`${sel.name} details`)}">
        <span class="dl"><b>${nasEsc(sel.name)}</b> · ${nasEsc(sel.state)}${sel.temp != null ? ` · <span class="${sel.tLevel}">${Math.round(sel.temp)}°C</span>` : ''}</span>
        ${sel.model ? `<span class="dl"><span>Model</span>${nasEsc(sel.model)}</span>` : ''}
        ${sel.serial ? `<span class="dl"><span>Serial #</span>${nasEsc(sel.serial)}</span>` : ''}
        <ha-icon icon="mdi:chevron-right"></ha-icon>
      </button>` : '';

    const volumes = m.volumes.map((v) => {
      const pct = v.pct != null ? Math.round(v.pct) : null;
      const line = v.na ? 'Unavailable'
        : `${v.used != null ? nasSize(v.used) : '—'} of ${nasSize(v.size)} (${pct != null ? `${pct}%` : '—'}${v.free != null ? ` · ${nasSize(v.free)} free` : ''})`;
      return `<button class="vol ${v.level} ${v.na ? 'na' : ''}" data-act="more" data-e="${nasEsc(v.entity)}" aria-label="${nasEsc(`${v.name || 'Volume'}: ${line}`)}">
          <span class="vol-head"><span class="vol-name">${nasEsc(v.name || 'Volume')}</span><span class="vol-line">${nasEsc(line)}</span></span>
          <span class="vol-bar"><i style="width:${pct != null ? Math.min(100, Math.max(0, v.pct)).toFixed(1) : 0}%"></i></span>
        </button>`;
    }).join('');

    const nets = m.nets.map((n) => {
      const speed = n.up_entity || n.down_entity
        ? `<span class="rate">${n.up_entity ? `<span title="Upload">↑ ${nasRate(n.up)}</span>` : ''}${n.down_entity ? `<span title="Download">↓ ${nasRate(n.down)}</span>` : ''}</span>` : '';
      const stateText = n.cls === 'unavailable' ? 'Offline' : n.state;
      return `<button class="net ${n.cls}" data-act="more" data-e="${nasEsc(n.entity)}" aria-label="${nasEsc(`${n.name}: ${stateText}${n.up != null ? `, up ${nasRate(n.up)}` : ''}${n.down != null ? `, down ${nasRate(n.down)}` : ''}`)}">
          <ha-icon icon="${n.cls === 'live' ? 'mdi:lan-connect' : 'mdi:lan-disconnect'}"></ha-icon>
          <span class="net-name">${nasEsc(n.name)}</span><span class="net-state">${nasEsc(stateText)}</span>${speed}
        </button>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; min-width: 0; }
        ha-card { padding: 16px 16px 12px; overflow: hidden; }
        button { font: inherit; color: inherit; text-align: left; background: none; border: 0; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 8px; }
        button:disabled { cursor: default; }
        .ok-c { color: var(--success-color, #4caf50); }
        .warn, .drive-sub.warn { --lvl: var(--warning-color, #ff9800); }
        .high, .drive-sub.high { --lvl: var(--error-color, #f44336); }

        /* Header */
        .header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .header > ha-icon { --mdc-icon-size: 36px; flex-shrink: 0; }
        .header-info { flex: 1; min-width: 0; }
        .title { font-size: 1.1em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .summary { font-size: .85em; color: var(--secondary-text-color); margin-top: 2px; }
        .pill { display: inline-flex; align-items: center; gap: 5px; max-width: 48%; padding: 5px 10px 5px 8px; border-radius: 999px; font-size: .78em; font-weight: 600;
          white-space: nowrap; flex-shrink: 0; }
        .pill span { overflow: hidden; text-overflow: ellipsis; }
        .pill ha-icon { --mdc-icon-size: 16px; flex: none; }
        .pill.ok { color: var(--success-color, #4caf50); background: rgba(var(--rgb-success-color, 76, 175, 80), .14); }
        .pill.warn { color: var(--warning-color, #ff9800); background: rgba(var(--rgb-warning-color, 255, 152, 0), .16); }
        .pill.bad { color: var(--error-color, #f44336); background: rgba(var(--rgb-error-color, 244, 67, 54), .14); }
        .pill.offline { color: var(--secondary-text-color); background: var(--secondary-background-color, rgba(127,127,127,.12));
          box-shadow: inset 0 0 0 1px var(--divider-color, rgba(127,127,127,.3)); }

        /* Bays */
        .drives-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
        .drive { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px 6px; border-radius: 10px;
          background: var(--secondary-background-color); min-width: 0; text-align: center; }
        .drive ha-icon { --mdc-icon-size: 28px; }
        .drive.live ha-icon { color: var(--success-color, #4caf50); }
        .drive.dead ha-icon { color: var(--error-color, #f44336); }
        .drive.unavailable ha-icon { color: var(--warning-color, #ff9800); }
        .drive.empty ha-icon { color: var(--disabled-text-color, #9e9e9e); opacity: .4; }
        .drive.sel { box-shadow: inset 0 0 0 2px var(--primary-color); }
        .drive-name { font-size: .7em; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; font-weight: 500; }
        .drive-sub { font-size: .68em; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .drive-sub.ok { color: var(--success-color, #4caf50); }
        .drive-sub.warn, .drive-sub.high { color: var(--lvl); font-weight: 600; }
        .drive.dead .drive-sub { color: var(--error-color, #f44336); font-weight: 600; }
        .drive.empty .drive-sub { opacity: .7; }
        .detail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; width: 100%; margin-top: 6px; padding: 8px 10px; border-radius: 10px;
          background: var(--secondary-background-color); font-size: .8em; color: var(--primary-text-color); box-sizing: border-box; }
        .detail ha-icon { --mdc-icon-size: 18px; margin-left: auto; color: var(--secondary-text-color); }
        .dl span:first-child:not(.warn):not(.high) { color: var(--secondary-text-color); margin-right: 4px; }
        .detail .warn, .detail .high { color: var(--lvl); font-weight: 600; }

        /* Stats */
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px 12px; margin-top: 12px; padding-top: 10px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); }
        .stat { display: flex; align-items: flex-start; gap: 6px; min-width: 0; padding: 2px 0; }
        .stat ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); margin-top: 2px; flex: none; }
        .stat.ok ha-icon { color: var(--success-color, #4caf50); }
        .stat.warn ha-icon, .stat.high ha-icon, .stat.warn .stat-value, .stat.high .stat-value { color: var(--lvl); }
        .stat-body { display: grid; min-width: 0; flex: 1; }
        .stat-label { font-size: .68em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
        .stat-value { font-size: .9em; font-weight: 600; color: var(--primary-text-color); }
        .stat-extra { font-size: .7em; color: var(--secondary-text-color); line-height: 1.25; }
        .mini { display: block; height: 3px; margin-top: 3px; border-radius: 2px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .mini i { display: block; height: 100%; background: var(--primary-color); }

        /* Volumes */
        .section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--divider-color, rgba(0,0,0,.12)); display: grid; gap: 8px; }
        .vol { display: grid; gap: 4px; width: 100%; }
        .vol-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; min-width: 0; }
        .vol-name { font-size: .85em; font-weight: 600; color: var(--primary-text-color); flex: none; }
        .vol-line { font-size: .75em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
        .vol-bar { display: block; height: 6px; border-radius: 3px; background: var(--secondary-background-color); overflow: hidden; }
        .vol-bar i { display: block; height: 100%; border-radius: 3px; background: var(--success-color, #4caf50); transition: width .5s ease; }
        .vol.warn .vol-bar i, .vol.high .vol-bar i { background: var(--lvl); }
        .vol.high .vol-line { color: var(--lvl); font-weight: 600; }
        .vol.na { opacity: .5; }

        /* Network */
        .nets { display: grid; gap: 4px; }
        .net { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 0; font-size: .82em; min-width: 0; }
        .net ha-icon { --mdc-icon-size: 16px; flex: none; }
        .net.live ha-icon { color: var(--success-color, #4caf50); }
        .net.dead ha-icon, .net.dead .net-state { color: var(--error-color, #f44336); }
        .net.unavailable { opacity: .55; }
        .net-name { font-weight: 600; color: var(--primary-text-color); }
        .net-state { color: var(--secondary-text-color); }
        .rate { margin-left: auto; display: flex; gap: 10px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
      </style>

      <ha-card>
        <div class="header">
          <ha-icon icon="mdi:nas" style="color:${iconColor}"></ha-icon>
          <div class="header-info">
            <div class="title">${nasEsc(title)}</div>
            ${summary ? `<div class="summary">${summary}</div>` : ''}
          </div>
          <button class="pill ${m.pill.kind}" data-act="more" data-e="${nasEsc(m.pill.entity || '')}" ${m.pill.entity ? '' : 'disabled'}
            title="${nasEsc(m.pill.text)}" aria-label="Condition: ${nasEsc(m.pill.text)}">
            <ha-icon icon="${m.pill.icon}"></ha-icon><span>${nasEsc(m.pill.text)}</span></button>
        </div>

        ${m.bays.length ? `<div class="drives-grid">${bays}</div>${detail}` : ''}
        ${stats ? `<div class="stats">${stats}</div>` : ''}
        ${volumes ? `<div class="section">${volumes}</div>` : ''}
        ${nets ? `<div class="section nets">${nets}</div>` : ''}
      </ha-card>
    `;
    // Skip the DOM rebuild when nothing visible changed.
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass || el.disabled) return;
    if (el.dataset.act === 'bay') {
      const i = Number(el.dataset.i);
      this._sel = this._sel === i ? null : i;
      this._render();
      return;
    }
    if (el.dataset.act === 'more' && el.dataset.e) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    }
  }

  getCardSize() {
    const c = this._config || {};
    return 3 + (c.volumes?.length || 0) / 2 + (c.network_interfaces?.length || 0) / 3 + (c.cpu_entity || c.memory_entity ? 1 : 0);
  }

  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('nas-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'My NAS',
      total_drives: 4,
      live_states: ['active', 'on', 'ok'],
      drives: [],
    };
  }
}

customElements.define('nas-card', NasCard);

// ── NAS Card Editor ───────────────────────────────────────────────────────────

class NasCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:nas', schema: [
        f.grid(f.text('title', 'Title'), f.number('total_drives', 'Total bays', { min: 1, max: 64, helper: 'Bays beyond the drive list show "Empty"' })),
        f.entity('status_entity', 'NAS status entity', 'Drives the condition pill; unavailable shows "Offline"'),
        f.grid(
          f.states('status_ok_states', 'OK states', NAS_OK_STATES, 'Default: online, running, active, ok, on, healthy, good, normal, ready'),
          f.states('status_warn_states', 'Warning states', NAS_WARN_STATES, 'Shown amber. Any other state is a problem'),
        ),
      ] },
      { title: 'Drives', icon: 'mdi:harddisk', schema: [
        f.states('live_states', 'Drive states that count as healthy', ['OK', 'active', 'on', 'good', 'healthy', 'normal'], 'Default: active, on, ok, good, healthy, normal'),
        f.grid(
          f.number('drive_temp_warn', 'Drive warm at', { unit: '°C', helper: 'Default: 45' }),
          f.number('drive_temp_high', 'Drive hot at', { unit: '°C', helper: 'Default: 55' }),
        ),
        f.grid(f.text('drive_entity_prefix', 'Find drives by prefix', 'e.g. sensor.nas_smart_status_'), f.text('drive_entity_suffix', 'Suffix', 'Optional')),
      ], list: {
        key: 'drives',
        collapsible: true,
        schema: [
          f.grid(f.entity('entity', 'Drive status entity', 'Model and "Serial #" attributes show on tap'), f.text('name', 'Name')),
          f.entity('temperature_entity', 'Drive temperature', '', 'sensor'),
        ],
        label: (d, i) => d.name || d.entity || `Bay ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add drive',
      } },
      { title: 'System', icon: 'mdi:cpu-64-bit', open: false, schema: [
        f.grid(f.entity('temperature_entity', 'System temperature', '', 'sensor'), f.entity('uptime_entity', 'Uptime', 'Seconds, a boot time, or text')),
        f.grid(
          f.number('temperature_warn', 'Warning at', { unit: '°C', helper: 'Default: 60' }),
          f.number('temperature_high', 'Critical at', { unit: '°C', helper: 'Default: 75' }),
        ),
        f.grid(f.entity('cpu_entity', 'CPU usage (%)', '', 'sensor'), f.entity('memory_entity', 'Memory usage (%)', '', 'sensor')),
        f.grid(f.entity('memory_used_entity', 'Memory used', 'For a "0.32 / 0.98 GiB" line', 'sensor'), f.entity('memory_size_entity', 'Memory size', '', 'sensor')),
      ] },
      { title: 'Volumes', icon: 'mdi:database', open: false, schema: [
        f.grid(
          f.number('volume_warn', 'Volume warning at', { unit: '%', helper: 'Default: 80' }),
          f.number('volume_high', 'Volume full at', { unit: '%', helper: 'Default: 90' }),
        ),
      ], list: {
        key: 'volumes',
        collapsible: true,
        schema: [
          f.text('name', 'Name'),
          f.entity('used_pct_entity', 'Used (%)', '', 'sensor'),
          f.grid(f.entity('free_entity', 'Free space', '', 'sensor'), f.entity('size_entity', 'Size', '', 'sensor')),
        ],
        label: (v, i) => v.name || v.used_pct_entity || `Volume ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add volume',
      } },
      { title: 'Network', icon: 'mdi:ethernet', open: false, schema: [
        f.states('network_live_states', 'Link-up states', NAS_LINK_STATES, 'Default: on, connected, up (any capitalisation)'),
        f.grid(f.text('network_entity_prefix', 'Find links by prefix', 'Optional'), f.text('network_entity_suffix', 'Suffix', 'Optional')),
      ], list: {
        key: 'network_interfaces',
        collapsible: true,
        schema: [
          f.grid(f.entity('entity', 'Link entity'), f.text('name', 'Name')),
          f.grid(f.entity('up_entity', 'Upload speed', '', 'sensor'), f.entity('down_entity', 'Download speed', '', 'sensor')),
        ],
        label: (n, i) => n.name || n.entity || `Interface ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add interface',
      } },
    ];
  }
}

customElements.define('nas-card-editor', NasCardEditor);
