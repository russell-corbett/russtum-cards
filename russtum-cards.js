// Russtum Cards bundle — NAS Card + UPS Card + Media Server Card + Minecraft Card
/**
 * NAS Card for Home Assistant
 *
 * Configuration:
 *   type: custom:nas-card
 *   title: My NAS
 *   total_drives: 8                        # Total bay count (visual slots)
 *   live_states: [active, on]              # Drive states that count as "live"
 *   drive_entity_prefix: sensor.nas_drive_ # Auto-detect drives by prefix
 *   drive_entity_suffix: _status           # Optional suffix filter
 *   drives:                                # Explicit drive list (merged with prefix discovery)
 *     - entity: sensor.nas_drive_1_status
 *       name: Bay 1
 *
 *   # Optional extras:
 *   temperature_entity: sensor.nas_cpu_temp  # System temperature (°C)
 *   temperature_warn: 60                     # Warning threshold °C (default 60)
 *   temperature_high: 75                     # Critical threshold °C (default 75)
 *
 *   uptime_entity: sensor.nas_uptime         # Uptime in seconds, or formatted string
 *
 *   network_interfaces:                      # Explicit network link list
 *     - entity: sensor.nas_eth0_link
 *       name: eth0
 *   network_entity_prefix: sensor.nas_      # Auto-detect network links by prefix
 *   network_entity_suffix: _link
 *   network_live_states: [on, connected, up]  # States that count as "live" (default: on, connected, up)
 */

function formatUptime(val) {
  if (val == null) return '—';
  const n = Number(val);
  if (!isNaN(n)) {
    // Numeric seconds
    const days  = Math.floor(n / 86400);
    const hours = Math.floor((n % 86400) / 3600);
    const mins  = Math.floor((n % 3600) / 60);
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
  // ISO datetime string (e.g. 2026-02-17T01:45:33+00:00) — compute elapsed
  const date = new Date(val);
  if (!isNaN(date.getTime())) {
    const elapsed = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    const days  = Math.floor(elapsed / 86400);
    const hours = Math.floor((elapsed % 86400) / 3600);
    const mins  = Math.floor((elapsed % 3600) / 60);
    if (days > 0)  return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }
  return String(val);
}

class NasCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass) {
      const watched = [
        ...this._getDriveEntities().map(d => d.entity).filter(Boolean),
        ...this._getNetworkEntities().map(n => n.entity).filter(Boolean),
        this._config.status_entity,
        this._config.temperature_entity,
        this._config.uptime_entity,
      ].filter(Boolean);
      const changed = watched.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  // ── Drive helpers ────────────────────────────────────────────────────────

  _getDriveEntities() {
    return (this._config.drives || []).map(d => ({
      entity: d.entity,
      name: d.name || this._nameFromEntity(d.entity),
    }));
  }

  _isLive(stateValue) {
    const liveStates = this._config.live_states || ['active', 'on'];
    return liveStates.includes(stateValue);
  }

  _driveStatusClass(stateValue) {
    if (stateValue === 'empty') return 'empty';
    if (stateValue === 'unavailable' || stateValue === 'unknown') return 'unavailable';
    return this._isLive(stateValue) ? 'live' : 'dead';
  }

  // ── Network helpers ──────────────────────────────────────────────────────

  _getNetworkEntities() {
    return (this._config.network_interfaces || []).map(n => ({
      entity: n.entity,
      name: n.name || this._nameFromEntity(n.entity),
    }));
  }

  _isLinkLive(stateValue) {
    const liveStates = this._config.network_live_states || ['on', 'connected', 'up'];
    return liveStates.includes(stateValue);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  _nameFromEntity(entityId) {
    if (!entityId) return '';
    return entityId.split('.').pop().replace(/_/g, ' ').trim() || entityId;
  }

  _stateVal(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId]?.state ?? null;
  }

  get config() { return this._config; }

  // ── Render ───────────────────────────────────────────────────────────────

  _render() {
    if (!this._config) return;

    const config = this._config;
    const hass = this._hass;

    // Drives
    const drives = hass ? this._getDriveEntities() : [];
    const totalDrives = config.total_drives || drives.length;
    let liveDrives = 0;
    const driveSlots = drives.map(drive => {
      const stateValue = hass?.states[drive.entity]?.state ?? 'unavailable';
      const live = this._isLive(stateValue);
      if (live) liveDrives++;
      return { ...drive, stateValue, live };
    });
    while (driveSlots.length < totalDrives) {
      driveSlots.push({ entity: null, name: `Bay ${driveSlots.length + 1}`, stateValue: 'empty', live: false });
    }
    const healthPct = totalDrives > 0 ? Math.round((liveDrives / totalDrives) * 100) : 0;

    // NAS icon color — from status_entity if configured, else from drive health
    let nasIconColor;
    if (config.status_entity) {
      const statusVal = this._stateVal(config.status_entity);
      const okStates   = config.status_ok_states   || ['online', 'running', 'active', 'ok', 'on', 'healthy'];
      const warnStates = config.status_warn_states  || ['degraded', 'warning', 'degrading'];
      if (!statusVal || statusVal === 'unavailable' || statusVal === 'unknown') {
        nasIconColor = 'var(--disabled-text-color, #9e9e9e)';
      } else if (okStates.includes(statusVal.toLowerCase())) {
        nasIconColor = 'var(--success-color, #4caf50)';
      } else if (warnStates.includes(statusVal.toLowerCase())) {
        nasIconColor = 'var(--warning-color, #ff9800)';
      } else {
        nasIconColor = 'var(--error-color, #f44336)';
      }
    } else {
      nasIconColor = healthPct >= 100
        ? 'var(--success-color, #4caf50)'
        : healthPct >= 80
          ? 'var(--primary-color)'
          : healthPct >= 50
            ? 'var(--warning-color, #ff9800)'
            : 'var(--error-color, #f44336)';
    }

    // Temperature
    const tempWarn = config.temperature_warn ?? 60;
    const tempHigh = config.temperature_high ?? 75;
    const rawTemp = this._stateVal(config.temperature_entity);
    const tempVal = rawTemp != null && rawTemp !== 'unavailable' ? parseFloat(rawTemp) : null;
    const tempUnit = config.temperature_entity && hass?.states[config.temperature_entity]?.attributes?.unit_of_measurement || '°C';
    const tempColor = tempVal == null
      ? 'var(--secondary-text-color)'
      : tempVal >= tempHigh
        ? 'var(--error-color, #f44336)'
        : tempVal >= tempWarn
          ? 'var(--warning-color, #ff9800)'
          : 'var(--success-color, #4caf50)';
    const tempIcon = tempVal != null && tempVal >= tempWarn ? 'mdi:thermometer-alert' : 'mdi:thermometer';

    // Uptime
    const rawUptime = this._stateVal(config.uptime_entity);

    // Network
    const netInterfaces = hass ? this._getNetworkEntities() : [];
    const netStats = netInterfaces.map(iface => {
      const stateValue = hass?.states[iface.entity]?.state ?? 'unavailable';
      const live = stateValue !== 'unavailable' && stateValue !== 'unknown' && this._isLinkLive(stateValue);
      return { ...iface, stateValue, live };
    });

    const title = config.title || 'NAS';
    const showStats = config.temperature_entity || config.uptime_entity;
    const showNetwork = netInterfaces.length > 0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        ha-card { padding: 16px 16px 12px; }

        /* ── Header ── */
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .header ha-icon {
          --mdc-icon-size: 36px;
          color: var(--primary-color);
          flex-shrink: 0;
        }
        .header-info { flex: 1; min-width: 0; }
        .title {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .summary {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }

        /* ── Drive grid ── */
        .drives-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
          gap: 6px;
        }
        .drive {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 4px 6px;
          border-radius: 8px;
          background: var(--secondary-background-color);
        }
        .drive ha-icon { --mdc-icon-size: 28px; }
        .drive.live ha-icon        { color: var(--success-color, #4caf50); }
        .drive.dead ha-icon        { color: var(--error-color, #f44336); }
        .drive.unavailable ha-icon { color: var(--warning-color, #ff9800); }
        .drive.empty ha-icon       { color: var(--disabled-text-color, #9e9e9e); opacity: 0.4; }
        .drive-name {
          font-size: 0.65em;
          color: var(--secondary-text-color);
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
          text-transform: capitalize;
        }
        .drive.live .drive-name { color: var(--success-color, #4caf50); }
        .drive.dead .drive-name { color: var(--error-color, #f44336); }

        /* ── Health bar ── */
        .progress-wrap {
          margin-top: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .progress-bar {
          flex: 1;
          height: 6px;
          background: var(--secondary-background-color);
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 3px;
          background: var(--success-color, #4caf50);
          transition: width 0.5s ease, background 0.3s;
        }
        .progress-fill.warn  { background: var(--warning-color, #ff9800); }
        .progress-fill.error { background: var(--error-color, #f44336); }
        .progress-label {
          font-size: 0.75em;
          font-weight: 600;
          color: var(--secondary-text-color);
          min-width: 32px;
          text-align: right;
        }

        /* ── Stats row (temp + uptime) ── */
        .stats-row {
          display: flex;
          gap: 16px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .stat {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
        }
        .stat ha-icon { --mdc-icon-size: 18px; }
        .stat-body {}
        .stat-label {
          font-size: 0.68em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .stat-value {
          font-size: 0.88em;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        /* ── Network pills (header right) ── */
        .header-network {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          justify-content: flex-end;
          align-items: flex-start;
          flex-shrink: 0;
          max-width: 45%;
        }
        .net-link {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 20px;
          background: var(--secondary-background-color);
          font-size: 0.72em;
          font-weight: 500;
          white-space: nowrap;
        }
        .net-link ha-icon { --mdc-icon-size: 13px; }
        .net-link.live {
          color: var(--success-color, #4caf50);
          background: rgba(76, 175, 80, 0.1);
        }
        .net-link.dead {
          color: var(--error-color, #f44336);
          background: rgba(244, 67, 54, 0.08);
        }
        .net-link.unavailable {
          color: var(--disabled-text-color, #9e9e9e);
        }
      </style>

      <ha-card>
        <div class="header">
          <ha-icon icon="mdi:nas" style="color:${nasIconColor}"></ha-icon>
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="summary">${liveDrives} / ${totalDrives} drives live</div>
          </div>
          ${showNetwork ? `
          <div class="header-network">
            ${netStats.map(iface => {
              const cls = iface.stateValue === 'unavailable' ? 'unavailable' : iface.live ? 'live' : 'dead';
              const icon = iface.live ? 'mdi:lan-connect' : 'mdi:lan-disconnect';
              return `<div class="net-link ${cls}" title="${iface.name}: ${iface.stateValue}">
                  <ha-icon icon="${icon}"></ha-icon>${iface.name}
                </div>`;
            }).join('')}
          </div>` : ''}
        </div>

        <div class="drives-grid">
          ${driveSlots.map(drive => {
            const cls = this._driveStatusClass(drive.stateValue);
            const icon = drive.stateValue === 'empty' ? 'mdi:harddisk-plus' : 'mdi:harddisk';
            const tooltip = drive.entity ? `${drive.name}: ${drive.stateValue}` : `${drive.name} (empty)`;
            return `
              <div class="drive ${cls}" title="${tooltip}">
                <ha-icon icon="${icon}"></ha-icon>
                <span class="drive-name">${drive.name}</span>
              </div>`;
          }).join('')}
        </div>

        ${totalDrives > 0 ? `
        <div class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill ${healthPct < 50 ? 'error' : healthPct < 80 ? 'warn' : ''}"
                 style="width:${healthPct}%"></div>
          </div>
          <span class="progress-label">${healthPct}%</span>
        </div>` : ''}

        ${showStats ? `
        <div class="stats-row">
          ${config.temperature_entity ? `
          <div class="stat">
            <ha-icon icon="${tempIcon}" style="color:${tempColor}"></ha-icon>
            <div class="stat-body">
              <div class="stat-label">Temperature</div>
              <div class="stat-value" style="color:${tempColor}">
                ${tempVal != null ? tempVal + tempUnit : '—'}
              </div>
            </div>
          </div>` : ''}
          ${config.uptime_entity ? `
          <div class="stat">
            <ha-icon icon="mdi:clock-outline" style="color:var(--secondary-text-color)"></ha-icon>
            <div class="stat-body">
              <div class="stat-label">Uptime</div>
              <div class="stat-value">${formatUptime(rawUptime)}</div>
            </div>
          </div>` : ''}
        </div>` : ''}


      </ha-card>
    `;
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement('nas-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'My NAS',
      total_drives: 8,
      live_states: ['active', 'on'],
      drives: [],
    };
  }
}

customElements.define('nas-card', NasCard);

// ── NAS Card Editor ───────────────────────────────────────────────────────────

class NasCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }

  set hass(hass) {
    this._hass = hass;
  }

  _fire(config) {
    this._config = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _structuralChange(config) {
    this._fire(config);
    this._render();
  }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _bindEntityPicker(id, key) {
    this.shadowRoot.getElementById(id)?.addEventListener('value-changed', ev => {
      const val = ev.detail.value;
      const config = { ...this._config };
      if (val) config[key] = val; else delete config[key];
      this._fire(config);
    });
  }

  _render() {
    const c = this._config;
    const drives = c.drives || [];
    const netIfaces = c.network_interfaces || [];
    const liveStates = (c.live_states || ['active', 'on']).join(', ');
    const netLiveStates = (c.network_live_states || ['on', 'connected', 'up']).join(', ');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 0 0 16px; }

        .section-title {
          font-size: 0.78em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }

        .row { display: flex; gap: 8px; margin-bottom: 8px; }

        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }

        .list-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          margin-bottom: 6px;
          background: var(--secondary-background-color);
          border-radius: 8px;
        }
        .list-item ha-textfield { flex: 1; margin-bottom: 0; }

        .remove-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--secondary-text-color);
          padding: 4px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          line-height: 0;
        }
        .remove-btn:hover { color: var(--error-color, #f44336); background: rgba(244,67,54,0.08); }

        .add-btn {
          width: 100%;
          background: none;
          border: 1px dashed var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
          border-radius: 8px;
          padding: 8px;
          cursor: pointer;
          font-size: 0.85em;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 4px;
          margin-bottom: 8px;
        }

        p.hint {
          font-size: 0.78em;
          color: var(--secondary-text-color);
          margin: 0 0 10px;
          line-height: 1.4;
        }
      </style>

      <!-- Basic -->
      <div class="section-title">Basic</div>
      <div class="row">
        <ha-textfield id="f-title" label="Title" value="${c.title || ''}"></ha-textfield>
        <ha-textfield id="f-total" label="Total Drives" type="number" min="1" value="${c.total_drives || ''}"></ha-textfield>
      </div>
      <ha-textfield id="f-live-states" label="Live States (comma-separated)" value="${liveStates}"></ha-textfield>
      <ha-textfield id="f-status-entity" label="NAS Status Entity (for icon color)" value="${c.status_entity || ''}"></ha-textfield>
      <ha-textfield id="f-status-ok"   label="Status OK States (comma-separated)"      value="${(c.status_ok_states   || ['online','running','active','ok','on','healthy']).join(', ')}"></ha-textfield>
      <ha-textfield id="f-status-warn" label="Status Warning States (comma-separated)" value="${(c.status_warn_states  || ['degraded','warning','degrading']).join(', ')}"></ha-textfield>

      <!-- Drives -->
      <div class="section-title">Drives</div>
      <div id="drives-list">
        ${drives.map((d, i) => `
          <div class="list-item">
            <ha-textfield data-idx="${i}" data-list="drive-entity" label="Entity ID" value="${d.entity || ''}"></ha-textfield>
            <ha-textfield data-idx="${i}" data-list="drive-name" label="Name" value="${d.name || ''}"></ha-textfield>
            <button class="remove-btn" data-idx="${i}" data-list="drive-remove" title="Remove">
              <ha-icon icon="mdi:close" style="--mdc-icon-size:18px"></ha-icon>
            </button>
          </div>`).join('')}
      </div>
      <button class="add-btn" id="add-drive"><ha-icon icon="mdi:plus" style="--mdc-icon-size:16px"></ha-icon> Add Drive</button>

      <!-- Temperature & Uptime -->
      <div class="section-title">Temperature &amp; Uptime</div>
      <ha-textfield id="f-temp-entity" label="Temperature Entity" value="${c.temperature_entity || ''}"></ha-textfield>
      <div class="row">
        <ha-textfield id="f-temp-warn" label="Warn (°C)" type="number" value="${c.temperature_warn ?? 60}"></ha-textfield>
        <ha-textfield id="f-temp-high" label="High (°C)" type="number" value="${c.temperature_high ?? 75}"></ha-textfield>
      </div>
      <ha-textfield id="f-uptime-entity" label="Uptime Entity" value="${c.uptime_entity || ''}"></ha-textfield>

      <!-- Network -->
      <div class="section-title">Network</div>
      <ha-textfield id="f-net-live" label="Link-Up States (comma-separated)" value="${netLiveStates}"></ha-textfield>
      <div class="section-title">Interfaces</div>
      <div id="net-list">
        ${netIfaces.map((n, i) => `
          <div class="list-item">
            <ha-textfield data-idx="${i}" data-list="net-entity" label="Entity ID" value="${n.entity || ''}"></ha-textfield>
            <ha-textfield data-idx="${i}" data-list="net-name" label="Name" value="${n.name || ''}"></ha-textfield>
            <button class="remove-btn" data-idx="${i}" data-list="net-remove" title="Remove">
              <ha-icon icon="mdi:close" style="--mdc-icon-size:18px"></ha-icon>
            </button>
          </div>`).join('')}
      </div>
      <button class="add-btn" id="add-net"><ha-icon icon="mdi:plus" style="--mdc-icon-size:16px"></ha-icon> Add Interface</button>
    `;

    const sr = this.shadowRoot;
    if (this._hass) sr.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = this._hass; });

    // Simple text / number fields
    this._bindText('f-title', 'title');
    this._bindText('f-total', 'total_drives', 'number');
    this._bindText('f-live-states', 'live_states', 'array');
    this._bindText('f-status-ok',   'status_ok_states',  'array');
    this._bindText('f-status-warn', 'status_warn_states', 'array');
    this._bindText('f-temp-warn', 'temperature_warn', 'number');
    this._bindText('f-temp-high', 'temperature_high', 'number');
    this._bindText('f-net-live', 'network_live_states', 'array');

    // Entity text fields
    this._bindText('f-status-entity', 'status_entity');
    this._bindText('f-temp-entity', 'temperature_entity');
    this._bindText('f-uptime-entity', 'uptime_entity');

    // Drives list
    sr.querySelectorAll('[data-list="drive-entity"]').forEach(field => {
      const handleDriveEntity = (ev) => {
        const val = this._readVal(ev, field);
        const i = Number(field.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], entity: val };
        this._fire({ ...this._config, drives });
      };
      field.addEventListener('value-changed', handleDriveEntity);
      field.addEventListener('input', handleDriveEntity);
    });
    sr.querySelectorAll('[data-list="drive-name"]').forEach(field => {
      const handleDriveName = (ev) => {
        const val = this._readVal(ev, field);
        const i = Number(field.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], name: val };
        this._fire({ ...this._config, drives });
      };
      field.addEventListener('value-changed', handleDriveName);
      field.addEventListener('input', handleDriveName);
    });
    sr.querySelectorAll('[data-list="drive-remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const drives = [...(this._config.drives || [])];
        drives.splice(Number(btn.dataset.idx), 1);
        const config = { ...this._config };
        if (drives.length) config.drives = drives; else delete config.drives;
        this._structuralChange(config);
      });
    });
    sr.getElementById('add-drive')?.addEventListener('click', () => {
      this._structuralChange({ ...this._config, drives: [...(this._config.drives || []), { entity: '', name: '' }] });
    });

    // Network interfaces list
    sr.querySelectorAll('[data-list="net-entity"]').forEach(field => {
      const handleNetEntity = (ev) => {
        const val = this._readVal(ev, field);
        const i = Number(field.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], entity: val };
        this._fire({ ...this._config, network_interfaces: ifaces });
      };
      field.addEventListener('value-changed', handleNetEntity);
      field.addEventListener('input', handleNetEntity);
    });
    sr.querySelectorAll('[data-list="net-name"]').forEach(field => {
      const handleNetName = (ev) => {
        const val = this._readVal(ev, field);
        const i = Number(field.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], name: val };
        this._fire({ ...this._config, network_interfaces: ifaces });
      };
      field.addEventListener('value-changed', handleNetName);
      field.addEventListener('input', handleNetName);
    });
    sr.querySelectorAll('[data-list="net-remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces.splice(Number(btn.dataset.idx), 1);
        const config = { ...this._config };
        if (ifaces.length) config.network_interfaces = ifaces; else delete config.network_interfaces;
        this._structuralChange(config);
      });
    });
    sr.getElementById('add-net')?.addEventListener('click', () => {
      this._structuralChange({ ...this._config, network_interfaces: [...(this._config.network_interfaces || []), { entity: '', name: '' }] });
    });
  }
}

customElements.define('nas-card-editor', NasCardEditor);
/**
 * UPS Card for Home Assistant (NUT / Network UPS Tools)
 *
 * Configuration:
 *   type: custom:ups-card
 *   title: Server UPS                     # Card title
 *   status_entity: sensor.ups_status_data # NUT status entity (e.g. "OL", "OB", "OL CHRG")
 *   battery_entity: sensor.ups_battery_charge  # Battery % (0-100)
 *   runtime_entity: sensor.ups_battery_runtime # Runtime remaining in seconds
 *   load_entity: sensor.ups_load          # Load % (0-100)
 *   battery_low_threshold: 20             # Optional: % below which battery shows as warning (default 20)
 *   load_warn_threshold: 80               # Optional: % above which load shows as warning (default 80)
 */

const NUT_STATUS = {
  OL:      { label: 'Online',            icon: 'mdi:power-plug',          color: 'var(--success-color, #4caf50)' },
  OB:      { label: 'On Battery',        icon: 'mdi:battery-arrow-down',  color: 'var(--warning-color, #ff9800)' },
  LB:      { label: 'Low Battery',       icon: 'mdi:battery-alert',       color: 'var(--error-color, #f44336)' },
  HB:      { label: 'High Battery',      icon: 'mdi:battery-arrow-up',    color: 'var(--success-color, #4caf50)' },
  RB:      { label: 'Replace Battery',   icon: 'mdi:battery-remove',      color: 'var(--error-color, #f44336)' },
  CHRG:    { label: 'Charging',          icon: 'mdi:battery-charging',    color: 'var(--info-color, #2196f3)' },
  DISCHRG: { label: 'Discharging',       icon: 'mdi:battery-minus',       color: 'var(--warning-color, #ff9800)' },
  BYPASS:  { label: 'Bypass',            icon: 'mdi:electric-switch',     color: 'var(--warning-color, #ff9800)' },
  CAL:     { label: 'Calibrating',       icon: 'mdi:battery-sync',        color: 'var(--info-color, #2196f3)' },
  OFF:     { label: 'Offline',           icon: 'mdi:power-plug-off',      color: 'var(--disabled-text-color, #9e9e9e)' },
  OVER:    { label: 'Overloaded',        icon: 'mdi:alert-circle',        color: 'var(--error-color, #f44336)' },
  TRIM:    { label: 'Trimming Voltage',  icon: 'mdi:sine-wave',           color: 'var(--warning-color, #ff9800)' },
  BOOST:   { label: 'Boosting Voltage',  icon: 'mdi:trending-up',         color: 'var(--warning-color, #ff9800)' },
  FSD:     { label: 'Forced Shutdown',   icon: 'mdi:power-off',           color: 'var(--error-color, #f44336)' },
};

// Priority order for picking the "primary" status when multiple codes present
const STATUS_PRIORITY = ['FSD', 'OVER', 'LB', 'RB', 'OB', 'BYPASS', 'TRIM', 'BOOST', 'DISCHRG', 'CHRG', 'CAL', 'OFF', 'HB', 'OL'];

function parsePrimaryStatus(rawStatus) {
  if (!rawStatus || rawStatus === 'unavailable' || rawStatus === 'unknown') {
    return { label: 'Unavailable', icon: 'mdi:help-circle', color: 'var(--disabled-text-color, #9e9e9e)', codes: [] };
  }
  const codes = rawStatus.toUpperCase().split(/\s+/);
  const primary = STATUS_PRIORITY.find(c => codes.includes(c)) || codes[0];
  const info = NUT_STATUS[primary] || { label: primary, icon: 'mdi:information', color: 'var(--secondary-text-color)' };
  return { ...info, codes };
}

function batteryIcon(pct, isCharging) {
  const level = Math.round(pct / 10) * 10;
  const clampedLevel = Math.min(100, Math.max(0, level));
  if (isCharging) {
    if (clampedLevel >= 100) return 'mdi:battery-charging-100';
    if (clampedLevel >= 90)  return 'mdi:battery-charging-90';
    if (clampedLevel >= 80)  return 'mdi:battery-charging-80';
    if (clampedLevel >= 70)  return 'mdi:battery-charging-70';
    if (clampedLevel >= 60)  return 'mdi:battery-charging-60';
    if (clampedLevel >= 50)  return 'mdi:battery-charging-50';
    if (clampedLevel >= 40)  return 'mdi:battery-charging-40';
    if (clampedLevel >= 30)  return 'mdi:battery-charging-30';
    if (clampedLevel >= 20)  return 'mdi:battery-charging-20';
    if (clampedLevel >= 10)  return 'mdi:battery-charging-10';
    return 'mdi:battery-charging-outline';
  }
  if (clampedLevel >= 100) return 'mdi:battery';
  if (clampedLevel >= 90)  return 'mdi:battery-90';
  if (clampedLevel >= 80)  return 'mdi:battery-80';
  if (clampedLevel >= 70)  return 'mdi:battery-70';
  if (clampedLevel >= 60)  return 'mdi:battery-60';
  if (clampedLevel >= 50)  return 'mdi:battery-50';
  if (clampedLevel >= 40)  return 'mdi:battery-40';
  if (clampedLevel >= 30)  return 'mdi:battery-30';
  if (clampedLevel >= 20)  return 'mdi:battery-20';
  if (clampedLevel >= 10)  return 'mdi:battery-10';
  return 'mdi:battery-outline';
}

function formatRuntime(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  const s = Math.round(Number(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

class UpsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass) {
      const entities = [
        this._config.status_entity,
        this._config.battery_entity,
        this._config.runtime_entity,
        this._config.load_entity,
      ].filter(Boolean);
      const changed = entities.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  _stateVal(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId]?.state ?? null;
  }

  _render() {
    if (!this._config) return;

    const config = this._config;
    const title = config.title || 'UPS';
    const batteryLowThreshold = config.battery_low_threshold ?? 20;
    const loadWarnThreshold = config.load_warn_threshold ?? 80;

    const rawStatus  = this._stateVal(config.status_entity);
    const rawBattery = this._stateVal(config.battery_entity);
    const rawRuntime = this._stateVal(config.runtime_entity);
    const rawLoad    = this._stateVal(config.load_entity);

    const status   = parsePrimaryStatus(rawStatus);
    const isCharging = status.codes.includes('CHRG');
    const isOnBattery = status.codes.includes('OB') || status.codes.includes('DISCHRG');

    const batteryPct = rawBattery != null && rawBattery !== 'unavailable' ? parseFloat(rawBattery) : null;
    const loadPct    = rawLoad    != null && rawLoad    !== 'unavailable' ? parseFloat(rawLoad)    : null;
    const runtimeSec = rawRuntime != null && rawRuntime !== 'unavailable' ? parseFloat(rawRuntime) : null;

    const batteryLow  = batteryPct != null && batteryPct <= batteryLowThreshold;
    const loadWarn    = loadPct    != null && loadPct    >= loadWarnThreshold;

    const batIcon  = batteryPct != null
      ? batteryIcon(batteryPct, isCharging)
      : 'mdi:battery-unknown';

    const batBarColor = batteryLow
      ? 'var(--error-color, #f44336)'
      : isCharging
        ? 'var(--info-color, #2196f3)'
        : 'var(--success-color, #4caf50)';

    const loadBarColor = loadWarn
      ? 'var(--error-color, #f44336)'
      : loadPct != null && loadPct >= loadWarnThreshold * 0.75
        ? 'var(--warning-color, #ff9800)'
        : 'var(--primary-color, #03a9f4)';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        ha-card { padding: 16px 16px 14px; }

        /* ── Header ── */
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .header-icon {
          --mdc-icon-size: 36px;
          color: ${status.color};
          flex-shrink: 0;
        }
        .header-info { flex: 1; min-width: 0; }
        .title {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-top: 3px;
          font-size: 0.8em;
          font-weight: 500;
          color: ${status.color};
        }
        .status-badge ha-icon { --mdc-icon-size: 14px; }

        /* ── Header runtime (top-right) ── */
        .header-runtime {
          text-align: right;
          flex-shrink: 0;
        }
        .runtime-label {
          font-size: 0.68em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .runtime-val {
          font-size: 1.1em;
          font-weight: 700;
          color: ${isOnBattery ? 'var(--warning-color, #ff9800)' : 'var(--primary-text-color)'};
        }

        /* ── Metric rows ── */
        .metrics { display: flex; flex-direction: column; gap: 10px; }

        .metric {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .metric-icon {
          --mdc-icon-size: 20px;
          flex-shrink: 0;
        }
        .metric-body { flex: 1; min-width: 0; }
        .metric-label {
          font-size: 0.72em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 3px;
        }
        .metric-bar-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .metric-bar {
          flex: 1;
          height: 5px;
          background: var(--secondary-background-color);
          border-radius: 3px;
          overflow: hidden;
        }
        .metric-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease, background 0.3s;
        }
        .metric-value {
          font-size: 0.82em;
          font-weight: 600;
          color: var(--primary-text-color);
          min-width: 38px;
          text-align: right;
          white-space: nowrap;
        }
        .metric-value.warn { color: var(--warning-color, #ff9800); }
        .metric-value.error { color: var(--error-color, #f44336); }

        .metric-icon.battery { color: ${batteryLow ? 'var(--error-color, #f44336)' : isCharging ? 'var(--info-color, #2196f3)' : 'var(--success-color, #4caf50)'}; }
        .metric-icon.load    { color: ${loadWarn   ? 'var(--error-color, #f44336)' : 'var(--primary-color, #03a9f4)'}; }
      </style>

      <ha-card>
        <div class="header">
          <ha-icon class="header-icon" icon="mdi:battery-heart-variant"></ha-icon>
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="status-badge">
              <ha-icon icon="${status.icon}"></ha-icon>
              ${status.label}
            </div>
          </div>
          ${config.runtime_entity ? `
          <div class="header-runtime">
            <div class="runtime-label">Runtime</div>
            <div class="runtime-val">${formatRuntime(runtimeSec)}</div>
          </div>` : ''}
        </div>

        <div class="metrics">

          ${config.battery_entity ? `
          <div class="metric">
            <ha-icon class="metric-icon battery" icon="${batIcon}"></ha-icon>
            <div class="metric-body">
              <div class="metric-label">Battery</div>
              <div class="metric-bar-wrap">
                <div class="metric-bar">
                  <div class="metric-bar-fill"
                       style="width:${batteryPct ?? 0}%; background:${batBarColor};"></div>
                </div>
                <span class="metric-value ${batteryLow ? 'error' : ''}">
                  ${batteryPct != null ? batteryPct + '%' : '—'}
                </span>
              </div>
            </div>
          </div>` : ''}

          ${config.load_entity ? `
          <div class="metric">
            <ha-icon class="metric-icon load" icon="mdi:gauge"></ha-icon>
            <div class="metric-body">
              <div class="metric-label">Load</div>
              <div class="metric-bar-wrap">
                <div class="metric-bar">
                  <div class="metric-bar-fill"
                       style="width:${loadPct ?? 0}%; background:${loadBarColor};"></div>
                </div>
                <span class="metric-value ${loadWarn ? 'error' : ''}">
                  ${loadPct != null ? loadPct + '%' : '—'}
                </span>
              </div>
            </div>
          </div>` : ''}

        </div>
      </ha-card>
    `;
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement('ups-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Server UPS',
      status_entity: 'sensor.ups_status_data',
      battery_entity: 'sensor.ups_battery_charge',
      runtime_entity: 'sensor.ups_battery_runtime',
      load_entity: 'sensor.ups_load',
    };
  }
}

customElements.define('ups-card', UpsCard);

// ── UPS Card Editor ───────────────────────────────────────────────────────────

class UpsCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }

  set hass(hass) {
    this._hass = hass;
  }

  _fire(config) {
    this._config = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 0 0 16px; }

        .section-title {
          font-size: 0.78em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }

        .row { display: flex; gap: 8px; margin-bottom: 8px; }
        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }
      </style>

      <!-- Basic -->
      <div class="section-title">Basic</div>
      <ha-textfield id="f-title" label="Title" value="${c.title || ''}"></ha-textfield>

      <!-- Entities -->
      <div class="section-title">Entities</div>
      <ha-textfield id="f-status"   label="Status Entity (NUT status_data)"    value="${c.status_entity || ''}"></ha-textfield>
      <ha-textfield id="f-battery"  label="Battery Entity (%)"                 value="${c.battery_entity || ''}"></ha-textfield>
      <ha-textfield id="f-runtime"  label="Runtime Entity (seconds remaining)" value="${c.runtime_entity || ''}"></ha-textfield>
      <ha-textfield id="f-load"     label="Load Entity (%)"                    value="${c.load_entity || ''}"></ha-textfield>

      <!-- Thresholds -->
      <div class="section-title">Thresholds</div>
      <div class="row">
        <ha-textfield id="f-bat-low"   label="Battery Low (%)"  type="number" min="0" max="100" value="${c.battery_low_threshold ?? 20}"></ha-textfield>
        <ha-textfield id="f-load-warn" label="Load Warning (%)" type="number" min="0" max="100" value="${c.load_warn_threshold ?? 80}"></ha-textfield>
      </div>
    `;

    this._bindText('f-title',     'title');
    this._bindText('f-status',    'status_entity');
    this._bindText('f-battery',   'battery_entity');
    this._bindText('f-runtime',   'runtime_entity');
    this._bindText('f-load',      'load_entity');
    this._bindText('f-bat-low',   'battery_low_threshold', 'number');
    this._bindText('f-load-warn', 'load_warn_threshold', 'number');
  }
}

customElements.define('ups-card-editor', UpsCardEditor);
// Convert a value+unit to bytes for comparison
function toBytes(n, unit) {
  const u = (unit || 'GB').trim();
  const map = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
  return n * (map[u] || 1e9);
}

/**
 * Media Server Card for Home Assistant
 *
 * Configuration:
 *   type: custom:media-server-card
 *   title: Media Server
 *
 *   # Radarr
 *   radarr_movies_entity: sensor.radarr_movie_count
 *   radarr_queue_entity: sensor.radarr_queue_count
 *
 *   # Sonarr
 *   sonarr_series_entity: sensor.sonarr_series_count
 *   sonarr_queue_entity: sensor.sonarr_queue_count
 *
 *   # Disk Space (use free+total for bar, or just percent)
 *   disk_free_entity: sensor.nas_disk_free
 *   disk_total_entity: sensor.nas_disk_total
 *   disk_used_pct_entity: sensor.nas_disk_usage_percent  # 0-100 (alternative)
 *
 *   # Jellyfin
 *   jellyfin_clients_entity: sensor.jellyfin_active_clients
 *
 *   # qBittorrent
 *   qbit_download_speed_entity: sensor.qbittorrent_download_speed
 *   qbit_upload_speed_entity: sensor.qbittorrent_upload_speed
 *   qbit_download_total_entity: sensor.qbittorrent_all_time_download
 *   qbit_upload_total_entity: sensor.qbittorrent_all_time_upload
 */

function formatMediaBytes(val, unit) {
  if (val == null || isNaN(val)) return '—';
  const n = Number(val);
  const u = (unit || '').trim();

  // Speed units — auto-scale
  if (u === 'B/s')   { if (n >= 1e9) return `${(n/1e9).toFixed(1)} GB/s`; if (n >= 1e6) return `${(n/1e6).toFixed(1)} MB/s`; if (n >= 1e3) return `${(n/1e3).toFixed(1)} KB/s`; return `${n.toFixed(0)} B/s`; }
  if (u === 'KB/s')  { if (n >= 1e6) return `${(n/1e6).toFixed(1)} GB/s`; if (n >= 1e3) return `${(n/1e3).toFixed(1)} MB/s`; return `${n.toFixed(1)} KB/s`; }
  if (u === 'MB/s')  { if (n >= 1000) return `${(n/1000).toFixed(1)} GB/s`; return `${n.toFixed(2)} MB/s`; }
  if (u === 'Mbit/s'){ if (n >= 1000) return `${(n/1000).toFixed(1)} Gbit/s`; return `${n.toFixed(1)} Mbit/s`; }

  // Storage units
  if (u === 'B')   { if (n >= 1e12) return `${(n/1e12).toFixed(1)} TB`; if (n >= 1e9) return `${(n/1e9).toFixed(1)} GB`; if (n >= 1e6) return `${(n/1e6).toFixed(1)} MB`; return `${n.toFixed(0)} B`; }
  if (u === 'KB')  { if (n >= 1e9) return `${(n/1e9).toFixed(1)} TB`; if (n >= 1e6) return `${(n/1e6).toFixed(1)} GB`; if (n >= 1e3) return `${(n/1e3).toFixed(1)} MB`; return `${n.toFixed(1)} KB`; }
  if (u === 'MB')  { if (n >= 1e6) return `${(n/1e6).toFixed(1)} TB`; if (n >= 1e3) return `${(n/1e3).toFixed(1)} GB`; return `${n.toFixed(0)} MB`; }
  if (u === 'GB')  { if (n >= 1000) return `${(n/1000).toFixed(1)} TB`; return `${n.toFixed(1)} GB`; }
  if (u === 'TB')  return `${n.toFixed(2)} TB`;
  if (u === 'GiB') { if (n >= 1024) return `${(n/1024).toFixed(1)} TiB`; return `${n.toFixed(1)} GiB`; }
  if (u === 'TiB') return `${n.toFixed(2)} TiB`;

  // Fallback
  return `${n} ${u}`.trim();
}

class MediaServerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass) {
      const entities = [
        this._config.radarr_movies_entity,
        this._config.radarr_queue_entity,
        this._config.sonarr_series_entity,
        this._config.sonarr_queue_entity,
        this._config.disk_free_entity,
        this._config.disk_total_entity,
        this._config.disk_used_pct_entity,
        this._config.jellyfin_clients_entity,
        this._config.qbit_download_speed_entity,
        this._config.qbit_upload_speed_entity,
        this._config.qbit_download_total_entity,
        this._config.qbit_upload_total_entity,
      ].filter(Boolean);
      const changed = entities.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  _val(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return null;
    return s.state;
  }

  _numVal(entityId) {
    const v = this._val(entityId);
    if (v == null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  _unit(entityId) {
    if (!entityId || !this._hass) return '';
    return this._hass.states[entityId]?.attributes?.unit_of_measurement || '';
  }

  _fmt(entityId) {
    const n = this._numVal(entityId);
    if (n == null) return '—';
    return formatMediaBytes(n, this._unit(entityId));
  }

  _render() {
    if (!this._config) return;
    const config = this._config;
    const title = config.title || 'Media Server';

    // Radarr
    const radarrMovies = this._numVal(config.radarr_movies_entity);
    const radarrQueue  = this._numVal(config.radarr_queue_entity);
    const showRadarr   = config.radarr_movies_entity || config.radarr_queue_entity;

    // Sonarr
    const sonarrSeries = this._numVal(config.sonarr_series_entity);
    const sonarrQueue  = this._numVal(config.sonarr_queue_entity);
    const showSonarr   = config.sonarr_series_entity || config.sonarr_queue_entity;

    // Disk
    const diskFree    = this._numVal(config.disk_free_entity);
    const diskUsedPct = this._numVal(config.disk_used_pct_entity);

    // Static total takes priority over entity
    const staticTotal     = config.disk_total != null ? Number(config.disk_total) : null;
    const staticTotalUnit = config.disk_total_unit || 'TB';
    const diskTotalEntity = this._numVal(config.disk_total_entity);

    // Resolve total as bytes for bar calculation
    const totalBytes = staticTotal != null
      ? toBytes(staticTotal, staticTotalUnit)
      : (diskTotalEntity != null ? toBytes(diskTotalEntity, this._unit(config.disk_total_entity)) : null);

    const freeBytes = diskFree != null
      ? toBytes(diskFree, this._unit(config.disk_free_entity))
      : null;

    const showDisk = config.disk_free_entity || config.disk_total_entity || config.disk_used_pct_entity || staticTotal != null;

    let barUsedPct = diskUsedPct;
    if (barUsedPct == null && freeBytes != null && totalBytes != null && totalBytes > 0) {
      barUsedPct = ((totalBytes - freeBytes) / totalBytes) * 100;
    }
    const diskBarColor = barUsedPct == null ? 'var(--primary-color, #03a9f4)'
      : barUsedPct >= 90 ? 'var(--error-color, #f44336)'
      : barUsedPct >= 75 ? 'var(--warning-color, #ff9800)'
      : 'var(--primary-color, #03a9f4)';
    const diskFreeStr  = diskFree != null ? this._fmt(config.disk_free_entity) : null;
    // Format the total — prefer static config, then entity
    const diskTotalStr = staticTotal != null
      ? formatMediaBytes(staticTotal, staticTotalUnit)
      : (diskTotalEntity != null ? this._fmt(config.disk_total_entity) : null);

    // Jellyfin
    const jellyClients = this._numVal(config.jellyfin_clients_entity);
    const showJellyfin = !!config.jellyfin_clients_entity;
    const jellyActive  = jellyClients != null && jellyClients > 0;

    // qBittorrent
    const dlSpeed = this._fmt(config.qbit_download_speed_entity);
    const ulSpeed = this._fmt(config.qbit_upload_speed_entity);
    const dlTotal = this._fmt(config.qbit_download_total_entity);
    const ulTotal = this._fmt(config.qbit_upload_total_entity);
    const showQbit = config.qbit_download_speed_entity || config.qbit_upload_speed_entity
                  || config.qbit_download_total_entity  || config.qbit_upload_total_entity;

    const showApps = showRadarr || showSonarr;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px 16px 14px; }

        /* ── Header ── */
        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .header-icon {
          --mdc-icon-size: 34px;
          color: var(--primary-color);
          flex-shrink: 0;
        }
        .header-info { flex: 1; min-width: 0; }
        .title {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .clients-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px;
          border-radius: 20px;
          font-size: 0.8em;
          font-weight: 500;
          flex-shrink: 0;
          background: ${jellyActive ? 'rgba(33,150,243,0.12)' : 'var(--secondary-background-color)'};
          color: ${jellyActive ? 'var(--info-color, #2196f3)' : 'var(--secondary-text-color)'};
        }
        .clients-badge ha-icon { --mdc-icon-size: 14px; }

        /* ── Divider ── */
        .divider {
          border: none;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin: 12px 0;
        }

        /* ── Apps row (Radarr + Sonarr) ── */
        .apps-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .app-block {
          background: var(--secondary-background-color);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .app-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          font-size: 0.72em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }
        .app-header ha-icon { --mdc-icon-size: 15px; }
        .app-block.radarr .app-header { color: var(--warning-color, #ff9800); }
        .app-block.sonarr .app-header { color: var(--info-color, #2196f3); }
        .app-stat {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          font-size: 0.8em;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .app-stat:last-child { margin-bottom: 0; }
        .app-stat-val {
          font-size: 1.1em;
          font-weight: 700;
          color: var(--primary-text-color);
        }
        .app-stat.has-queue .app-stat-val {
          color: var(--warning-color, #ff9800);
        }
        .app-stat.no-queue .app-stat-val {
          color: var(--success-color, #4caf50);
        }

        /* ── Disk ── */
        .disk-header {
          display: flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
        }
        .disk-header ha-icon {
          --mdc-icon-size: 16px;
          color: ${diskBarColor};
        }
        .disk-label {
          font-size: 0.72em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--secondary-text-color);
          flex: 1;
        }
        .disk-free-text {
          font-size: 0.82em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .disk-bar {
          height: 6px;
          background: var(--secondary-background-color);
          border-radius: 3px;
          overflow: hidden;
        }
        .disk-bar-fill {
          height: 100%;
          border-radius: 3px;
          background: ${diskBarColor};
          transition: width 0.5s ease, background 0.3s;
        }

        /* ── Transfer (qBit) ── */
        .transfer-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .transfer-block {
          background: var(--secondary-background-color);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .transfer-header {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.72em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 6px;
        }
        .transfer-header ha-icon { --mdc-icon-size: 14px; }
        .transfer-header.dl { color: var(--success-color, #4caf50); }
        .transfer-header.ul { color: var(--warning-color, #ff9800); }
        .transfer-speed {
          font-size: 1.05em;
          font-weight: 700;
          color: var(--primary-text-color);
          margin-bottom: 3px;
        }
        .transfer-total {
          font-size: 0.73em;
          color: var(--secondary-text-color);
        }
      </style>

      <ha-card>
        <!-- Header -->
        <div class="header">
          <ha-icon class="header-icon" icon="mdi:server-network"></ha-icon>
          <div class="header-info">
            <div class="title">${title}</div>
          </div>
          ${showJellyfin ? `
          <div class="clients-badge">
            <ha-icon icon="mdi:television-play"></ha-icon>
            ${jellyClients != null ? jellyClients : '—'} client${jellyClients !== 1 ? 's' : ''}
          </div>` : ''}
        </div>

        <!-- Radarr + Sonarr -->
        ${showApps ? `
        <div class="apps-row">
          ${showRadarr ? `
          <div class="app-block radarr">
            <div class="app-header">
              <ha-icon icon="mdi:movie-open-outline"></ha-icon>Radarr
            </div>
            ${config.radarr_movies_entity ? `
            <div class="app-stat">
              <span>Movies</span>
              <span class="app-stat-val">${radarrMovies ?? '—'}</span>
            </div>` : ''}
            ${config.radarr_queue_entity ? `
            <div class="app-stat ${radarrQueue ? 'has-queue' : 'no-queue'}">
              <span>Queue</span>
              <span class="app-stat-val">${radarrQueue ?? '—'}</span>
            </div>` : ''}
          </div>` : ''}

          ${showSonarr ? `
          <div class="app-block sonarr">
            <div class="app-header">
              <ha-icon icon="mdi:television-box"></ha-icon>Sonarr
            </div>
            ${config.sonarr_series_entity ? `
            <div class="app-stat">
              <span>Series</span>
              <span class="app-stat-val">${sonarrSeries ?? '—'}</span>
            </div>` : ''}
            ${config.sonarr_queue_entity ? `
            <div class="app-stat ${sonarrQueue ? 'has-queue' : 'no-queue'}">
              <span>Queue</span>
              <span class="app-stat-val">${sonarrQueue ?? '—'}</span>
            </div>` : ''}
          </div>` : ''}
        </div>` : ''}

        <!-- Disk Space -->
        ${showDisk ? `
        ${showApps ? '<hr class="divider">' : ''}
        <div class="disk-header">
          <ha-icon icon="mdi:harddisk"></ha-icon>
          <span class="disk-label">Storage</span>
          <span class="disk-free-text">
            ${diskFreeStr ? diskFreeStr + ' free' : ''}${diskTotalStr ? ' / ' + diskTotalStr : ''}
            ${!diskFreeStr && !diskTotalStr && barUsedPct != null ? `${(100 - barUsedPct).toFixed(0)}% free` : ''}
          </span>
        </div>
        <div class="disk-bar">
          <div class="disk-bar-fill" style="width:${Math.min(100, barUsedPct ?? 0).toFixed(1)}%"></div>
        </div>` : ''}

        <!-- qBittorrent -->
        ${showQbit ? `
        <hr class="divider">
        <div class="transfer-grid">
          <div class="transfer-block">
            <div class="transfer-header dl">
              <ha-icon icon="mdi:arrow-down-circle-outline"></ha-icon>Download
            </div>
            <div class="transfer-speed">${config.qbit_download_speed_entity ? dlSpeed : '—'}</div>
            ${config.qbit_download_total_entity ? `<div class="transfer-total">Total: ${dlTotal}</div>` : ''}
          </div>
          <div class="transfer-block">
            <div class="transfer-header ul">
              <ha-icon icon="mdi:arrow-up-circle-outline"></ha-icon>Upload
            </div>
            <div class="transfer-speed">${config.qbit_upload_speed_entity ? ulSpeed : '—'}</div>
            ${config.qbit_upload_total_entity ? `<div class="transfer-total">Total: ${ulTotal}</div>` : ''}
          </div>
        </div>` : ''}

      </ha-card>
    `;
  }

  getCardSize() {
    return 4;
  }

  static getConfigElement() {
    return document.createElement('media-server-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Media Server',
    };
  }
}

customElements.define('media-server-card', MediaServerCard);

// ── Media Server Card Editor ──────────────────────────────────────────────────

class MediaServerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }

  set hass(hass) {
    this._hass = hass;
  }

  _fire(config) {
    this._config = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bind(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;
    const f = key => c[key] || '';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 0 0 16px; }
        .section-title {
          font-size: 0.78em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }
        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }
        .row { display: flex; gap: 8px; margin-bottom: 0; }
        .row ha-textfield { margin-bottom: 8px; }
      </style>

      <div class="section-title">Basic</div>
      <ha-textfield id="f-title" label="Title" value="${f('title')}"></ha-textfield>

      <div class="section-title">Radarr</div>
      <ha-textfield id="f-radarr-movies" label="Movies Entity"      value="${f('radarr_movies_entity')}"></ha-textfield>
      <ha-textfield id="f-radarr-queue"  label="Queue Count Entity" value="${f('radarr_queue_entity')}"></ha-textfield>

      <div class="section-title">Sonarr</div>
      <ha-textfield id="f-sonarr-series" label="Series Entity"      value="${f('sonarr_series_entity')}"></ha-textfield>
      <ha-textfield id="f-sonarr-queue"  label="Queue Count Entity" value="${f('sonarr_queue_entity')}"></ha-textfield>

      <div class="section-title">Storage</div>
      <ha-textfield id="f-disk-free"  label="Free Space Entity"                    value="${f('disk_free_entity')}"></ha-textfield>
      <div class="row">
        <ha-textfield id="f-disk-total-val"  label="Total Disk Size (number)" type="number" min="0" style="flex:2;" value="${c.disk_total != null ? c.disk_total : ''}"></ha-textfield>
        <ha-textfield id="f-disk-total-unit" label="Unit"                                          style="flex:1;" value="${f('disk_total_unit') || 'TB'}"></ha-textfield>
      </div>
      <ha-textfield id="f-disk-pct"   label="Used % Entity (alternative to above)" value="${f('disk_used_pct_entity')}"></ha-textfield>

      <div class="section-title">Jellyfin</div>
      <ha-textfield id="f-jelly" label="Active Clients Entity" value="${f('jellyfin_clients_entity')}"></ha-textfield>

      <div class="section-title">qBittorrent</div>
      <div class="row">
        <ha-textfield id="f-dl-speed" label="Download Speed Entity" value="${f('qbit_download_speed_entity')}"></ha-textfield>
        <ha-textfield id="f-ul-speed" label="Upload Speed Entity"   value="${f('qbit_upload_speed_entity')}"></ha-textfield>
      </div>
      <div class="row">
        <ha-textfield id="f-dl-total" label="Download Total Entity" value="${f('qbit_download_total_entity')}"></ha-textfield>
        <ha-textfield id="f-ul-total" label="Upload Total Entity"   value="${f('qbit_upload_total_entity')}"></ha-textfield>
      </div>
    `;

    this._bind('f-title',         'title');
    this._bind('f-radarr-movies', 'radarr_movies_entity');
    this._bind('f-radarr-queue',  'radarr_queue_entity');
    this._bind('f-sonarr-series', 'sonarr_series_entity');
    this._bind('f-sonarr-queue',  'sonarr_queue_entity');
    this._bind('f-disk-free',      'disk_free_entity');
    this._bind('f-disk-total-val', 'disk_total', 'number');
    this._bind('f-disk-total-unit','disk_total_unit');
    this._bind('f-disk-pct',       'disk_used_pct_entity');
    this._bind('f-jelly',         'jellyfin_clients_entity');
    this._bind('f-dl-speed',      'qbit_download_speed_entity');
    this._bind('f-ul-speed',      'qbit_upload_speed_entity');
    this._bind('f-dl-total',      'qbit_download_total_entity');
    this._bind('f-ul-total',      'qbit_upload_total_entity');
  }
}

customElements.define('media-server-card-editor', MediaServerCardEditor);

// ── Minecraft Card ────────────────────────────────────────────────────────────

function isOnline(state, onlineStates) {
  if (!state || state === 'unavailable' || state === 'unknown') return null;
  return onlineStates.map(s => s.toLowerCase()).includes(state.toLowerCase());
}

function parsePlayerList(raw) {
  if (!raw || raw === 'unavailable' || raw === 'unknown') return [];
  let list = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed.filter(Boolean);
    else list = raw.split(',').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    list = raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // MC usernames have no spaces — entries with spaces are empty-state messages
  return list.filter(name => name && !name.includes(' '));
}

function latencyColor(ms) {
  if (ms == null) return 'var(--secondary-text-color)';
  if (ms <= 30)  return 'var(--success-color, #4caf50)';
  if (ms <= 80)  return 'var(--primary-color, #03a9f4)';
  if (ms <= 150) return 'var(--warning-color, #ff9800)';
  return 'var(--error-color, #f44336)';
}

function latencyIcon(ms) {
  if (ms == null) return 'mdi:signal-off';
  if (ms <= 30)  return 'mdi:signal-cellular-3';
  if (ms <= 80)  return 'mdi:signal-cellular-2';
  if (ms <= 150) return 'mdi:signal-cellular-1';
  return 'mdi:signal-cellular-outline';
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 45%, 38%)`;
}

class MinecraftCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass) {
      const entities = [
        this._config.status_entity,
        this._config.players_entity,
        this._config.max_players_entity,
        this._config.latency_entity,
        this._config.version_entity,
        this._config.motd_entity,
        this._config.player_list_entity,
      ].filter(Boolean);
      const changed = entities.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  _stateVal(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId]?.state ?? null;
  }

  _render() {
    if (!this._config) return;

    const config = this._config;
    const title = config.title || 'Minecraft Server';
    const icon  = config.icon  || 'mdi:minecraft';
    const onlineStates = config.online_states || ['on', 'true', 'online', 'connected'];

    const rawStatus     = this._stateVal(config.status_entity);
    const rawPlayers    = this._stateVal(config.players_entity);
    const rawMaxPlayers = this._stateVal(config.max_players_entity);
    const rawLatency    = this._stateVal(config.latency_entity);
    const rawVersion    = this._stateVal(config.version_entity);
    const rawMotd       = this._stateVal(config.motd_entity);
    const rawPlayerList = this._stateVal(config.player_list_entity);

    const online = isOnline(rawStatus, onlineStates);
    const players    = rawPlayers    != null && rawPlayers    !== 'unavailable' ? parseInt(rawPlayers, 10) : null;
    const maxPlayers = rawMaxPlayers != null && rawMaxPlayers !== 'unavailable' ? parseInt(rawMaxPlayers, 10) : null;
    const latencyMs  = rawLatency    != null && rawLatency    !== 'unavailable' ? parseFloat(parseFloat(rawLatency).toFixed(2)) : null;
    const playerList = parsePlayerList(rawPlayerList);

    let statusLabel, statusColor, statusDot;
    if (online === null) {
      statusLabel = 'Unknown';
      statusColor = 'var(--disabled-text-color, #9e9e9e)';
      statusDot   = 'grey';
    } else if (online) {
      statusLabel = 'Online';
      statusColor = 'var(--success-color, #4caf50)';
      statusDot   = '#4caf50';
    } else {
      statusLabel = 'Offline';
      statusColor = 'var(--error-color, #f44336)';
      statusDot   = '#f44336';
    }

    const latColor = latencyColor(latencyMs);
    const latIconStr = latencyIcon(latencyMs);

    const playerCountStr = players != null
      ? (maxPlayers != null ? `${players} / ${maxPlayers}` : `${players}`)
      : '—';

    const hasPlayers = online === true && playerList.length > 0;
    const showPlayerSection = online === true && config.player_list_entity;
    const hasInfo = config.players_entity || config.version_entity;
    const motd = rawMotd && rawMotd !== 'unavailable' && rawMotd !== 'unknown' ? rawMotd : null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        .banner {
          background: var(--secondary-background-color);
          padding: 14px 16px 12px;
          border-bottom: 2px solid ${online === true ? 'var(--success-color, #4caf50)' : online === false ? 'var(--error-color, #f44336)' : 'var(--divider-color)'};
        }
        .header-row { display: flex; align-items: center; gap: 12px; }
        .mc-icon-wrap {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: ${online === true ? 'rgba(76,175,80,0.12)' : online === false ? 'rgba(244,67,54,0.10)' : 'rgba(158,158,158,0.10)'};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1.5px solid ${statusColor};
        }
        .mc-icon-wrap ha-icon { --mdc-icon-size: 24px; color: ${statusColor}; }
        .header-text { flex: 1; min-width: 0; }
        .server-name {
          font-size: 1.05em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }
        .meta-row { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; }
        .status-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 0.75em; font-weight: 600; color: ${statusColor}; }
        .status-dot {
          width: 7px; height: 7px; border-radius: 50%; background: ${statusDot};
          ${online === true ? 'animation: pulse 2s infinite;' : ''}
          flex-shrink: 0;
        }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(76,175,80,0.55); }
          70%  { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }
        .motd-inline { font-size: 0.73em; color: var(--secondary-text-color); font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
        .latency-badge { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .latency-icon { --mdc-icon-size: 18px; color: ${latColor}; }
        .latency-val { font-size: 0.78em; font-weight: 700; color: ${latColor}; white-space: nowrap; }

        .info-strip { display: flex; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }
        .info-item { flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
        .info-item + .info-item { border-left: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }
        .info-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); flex-shrink: 0; }
        .info-body { min-width: 0; }
        .info-label { font-size: 0.62em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.06em; }
        .info-value { font-size: 0.95em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .info-value.active { color: var(--success-color, #4caf50); }

        .players-section { padding: 10px 14px 13px; }
        .players-header { font-size: 0.62em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 7px; }
        .player-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .player-chip {
          display: flex; align-items: center; gap: 6px;
          background: var(--secondary-background-color);
          border-radius: 18px; padding: 4px 10px 4px 4px;
          font-size: 0.8em; font-weight: 500; color: var(--primary-text-color);
        }
        .player-avatar {
          width: 22px; height: 22px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.7em; font-weight: 700; color: #fff; flex-shrink: 0;
        }
        .empty-players { font-size: 0.8em; color: var(--disabled-text-color, #9e9e9e); font-style: italic; }
      </style>

      <ha-card>
        <div class="banner">
          <div class="header-row">
            <div class="mc-icon-wrap"><ha-icon icon="${icon}"></ha-icon></div>
            <div class="header-text">
              <div class="server-name">${title}</div>
              <div class="meta-row">
                <div class="status-pill"><div class="status-dot"></div>${statusLabel}</div>
                ${motd ? `<span class="motd-inline">${motd}</span>` : ''}
              </div>
            </div>
            ${config.latency_entity ? `
            <div class="latency-badge">
              <ha-icon class="latency-icon" icon="${latIconStr}"></ha-icon>
              <span class="latency-val">${latencyMs != null ? latencyMs + ' ms' : '—'}</span>
            </div>` : ''}
          </div>
        </div>

        ${hasInfo ? `
        <div class="info-strip">
          ${config.players_entity ? `
          <div class="info-item">
            <ha-icon class="info-icon" icon="mdi:account-group"></ha-icon>
            <div class="info-body">
              <div class="info-label">Players</div>
              <div class="info-value ${players != null && players > 0 ? 'active' : ''}">${playerCountStr}</div>
            </div>
          </div>` : ''}
          ${config.version_entity ? `
          <div class="info-item">
            <ha-icon class="info-icon" icon="mdi:tag-outline"></ha-icon>
            <div class="info-body">
              <div class="info-label">Version</div>
              <div class="info-value" style="font-size:0.82em;">${rawVersion && rawVersion !== 'unavailable' ? rawVersion : '—'}</div>
            </div>
          </div>` : ''}
        </div>` : ''}

        ${showPlayerSection ? `
        <div class="players-section">
          <div class="players-header">Online Now</div>
          ${hasPlayers ? `
          <div class="player-list">
            ${playerList.map(name => `
            <div class="player-chip">
              <div class="player-avatar" style="background:${avatarColor(name)};">${name.charAt(0).toUpperCase()}</div>
              ${name}
            </div>`).join('')}
          </div>` : `
          <div class="empty-players">No players currently online</div>`}
        </div>` : ''}
      </ha-card>
    `;
  }

  getCardSize() { return 3; }

  static getConfigElement() {
    return document.createElement('minecraft-card-editor');
  }

  static getStubConfig() {
    return {
      title: "Russell's Minecraft Server",
      status_entity: 'binary_sensor.minecraft_server_status',
      players_entity: 'sensor.minecraft_server_players_online',
      max_players_entity: 'sensor.minecraft_server_players_max',
      latency_entity: 'sensor.minecraft_server_latency',
      version_entity: 'sensor.minecraft_server_edition',
    };
  }
}

customElements.define('minecraft-card', MinecraftCard);

class MinecraftCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }

  set hass(hass) { this._hass = hass; }

  _fire(config) {
    this._config = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bind(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 0 0 16px; }
        .section-title {
          font-size: 0.78em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }
        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }
      </style>

      <div class="section-title">Basic</div>
      <ha-textfield id="f-title" label="Title"          value="${c.title || ''}"></ha-textfield>
      <ha-textfield id="f-icon"  label="Icon (mdi:...)" value="${c.icon || ''}"></ha-textfield>

      <div class="section-title">Server Entities</div>
      <ha-textfield id="f-status"  label="Status Entity (binary_sensor or text)"  value="${c.status_entity || ''}"></ha-textfield>
      <ha-textfield id="f-players" label="Players Online Entity"                   value="${c.players_entity || ''}"></ha-textfield>
      <ha-textfield id="f-max"     label="Max Players Entity (optional)"           value="${c.max_players_entity || ''}"></ha-textfield>
      <ha-textfield id="f-latency" label="Latency Entity (ms, optional)"           value="${c.latency_entity || ''}"></ha-textfield>
      <ha-textfield id="f-version" label="Version Entity (optional)"               value="${c.version_entity || ''}"></ha-textfield>
      <ha-textfield id="f-motd"    label="MOTD Entity (optional)"                  value="${c.motd_entity || ''}"></ha-textfield>
      <ha-textfield id="f-plist"   label="Player List Entity (JSON array or CSV)"  value="${c.player_list_entity || ''}"></ha-textfield>
    `;

    this._bind('f-title',   'title');
    this._bind('f-icon',    'icon');
    this._bind('f-status',  'status_entity');
    this._bind('f-players', 'players_entity');
    this._bind('f-max',     'max_players_entity');
    this._bind('f-latency', 'latency_entity');
    this._bind('f-version', 'version_entity');
    this._bind('f-motd',    'motd_entity');
    this._bind('f-plist',   'player_list_entity');
  }
}

customElements.define('minecraft-card-editor', MinecraftCardEditor);

// ── Docker Card ────────────────────────────────────────────────────────────────

function dockerFormatBytes(val, unit) {
  if (val == null) return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  const u = (unit || '').trim();
  if (u === '%') return `${n.toFixed(1)}%`;
  // Convert to bytes first
  const toB = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
  const bytes = n * (toB[u] || 1);
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes.toFixed(0)} B`;
}

function dockerFormatCpu(val) {
  if (val == null) return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  return `${n.toFixed(1)}%`;
}

function dockerCpuColor(pct, warn) {
  const w = warn ?? 70;
  if (pct == null) return 'var(--primary-text-color)';
  if (pct > w)        return 'var(--error-color, #f44336)';
  if (pct > w * 0.6)  return 'var(--warning-color, #ff9800)';
  return 'var(--primary-text-color)';
}

class DockerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass) {
      const containers = this._config.containers || [];
      const watched = [
        this._config.host_entity,
        this._config.containers_running_entity,
        this._config.containers_total_entity,
        this._config.images_entity,
        ...containers.map(c => c.status_entity).filter(Boolean),
        ...containers.map(c => c.cpu_entity).filter(Boolean),
        ...containers.map(c => c.ram_entity).filter(Boolean),
        ...containers.map(c => c.disk_entity).filter(Boolean),
      ].filter(Boolean);
      const changed = watched.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  _stateVal(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return null;
    return s.state;
  }

  _numVal(entityId) {
    const v = this._stateVal(entityId);
    if (v == null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  _unit(entityId) {
    if (!entityId || !this._hass) return '';
    return this._hass.states[entityId]?.attributes?.unit_of_measurement || '';
  }

  _isRunning(stateVal) {
    const runningStates = this._config.running_states || ['running'];
    if (!stateVal) return false;
    return runningStates.map(s => s.toLowerCase()).includes(stateVal.toLowerCase());
  }

  _hostStatus() {
    const hostEntity = this._config.host_entity;
    if (!hostEntity || !this._hass) return null;
    const s = this._hass.states[hostEntity];
    if (!s) return null;
    const state = s.state;
    if (state === 'unavailable' || state === 'unknown') return null;
    const onStates = ['on', 'online', 'true', 'running', 'active', 'ok', 'healthy'];
    return onStates.includes(state.toLowerCase());
  }

  _render() {
    if (!this._config) return;

    const config = this._config;
    const title = config.title || 'Docker';
    const icon  = config.icon  || 'mdi:docker';
    const cpuWarn = config.cpu_warn ?? 70;

    const hostOnline = this._hostStatus();
    const borderColor = hostOnline === true
      ? 'var(--success-color, #4caf50)'
      : hostOnline === false
        ? 'var(--error-color, #f44336)'
        : 'var(--divider-color, rgba(0,0,0,0.12))';

    const iconBg = hostOnline === true
      ? 'rgba(76,175,80,0.12)'
      : hostOnline === false
        ? 'rgba(244,67,54,0.10)'
        : 'rgba(158,158,158,0.10)';
    const iconBorderColor = hostOnline === true
      ? 'var(--success-color, #4caf50)'
      : hostOnline === false
        ? 'var(--error-color, #f44336)'
        : 'var(--disabled-text-color, #9e9e9e)';
    const iconColor = iconBorderColor;

    const statusLabel = hostOnline === true ? 'Online' : hostOnline === false ? 'Offline' : 'Unknown';
    const statusColor = hostOnline === true
      ? 'var(--success-color, #4caf50)'
      : hostOnline === false
        ? 'var(--error-color, #f44336)'
        : 'var(--disabled-text-color, #9e9e9e)';
    const statusDot   = hostOnline === true ? '#4caf50' : hostOnline === false ? '#f44336' : '#9e9e9e';

    const containersRunning = this._numVal(config.containers_running_entity);
    const containersTotal   = this._numVal(config.containers_total_entity);
    const imagesTotal       = this._numVal(config.images_entity);

    let hostMetaParts = [];
    if (containersRunning != null || containersTotal != null) {
      const run   = containersRunning != null ? containersRunning : '?';
      const total = containersTotal   != null ? containersTotal   : '?';
      hostMetaParts.push(`${run} / ${total} containers`);
    }
    if (imagesTotal != null) {
      hostMetaParts.push(`${imagesTotal} images`);
    }
    const hostMeta = hostMetaParts.join('  ·  ');

    const containers = config.containers || [];

    const containerRows = containers.map(ct => {
      const rawStatus = this._stateVal(ct.status_entity);
      const running = rawStatus != null ? this._isRunning(rawStatus) : null;

      const dotColor    = running === true ? '#4caf50' : '#9e9e9e';
      const badgeText   = running === true ? 'Running' : running === false ? 'Stopped' : 'Unknown';
      const badgeBg     = running === true ? 'rgba(76,175,80,0.15)' : 'var(--secondary-background-color)';
      const badgeColor  = running === true ? 'var(--success-color, #4caf50)' : 'var(--secondary-text-color)';
      const pulseAnim   = running === true ? 'animation: pulse 2s infinite;' : '';

      const cpuNum  = this._numVal(ct.cpu_entity);
      const cpuUnit = this._unit(ct.cpu_entity);
      const cpuStr  = cpuUnit === '%' ? (cpuNum != null ? `${cpuNum.toFixed(1)}%` : null) : dockerFormatCpu(cpuNum);
      const cpuColor = dockerCpuColor(cpuNum, cpuWarn);

      const ramNum  = this._numVal(ct.ram_entity);
      const ramUnit = this._unit(ct.ram_entity);
      const ramStr  = dockerFormatBytes(ramNum, ramUnit);

      const diskNum  = this._numVal(ct.disk_entity);
      const diskUnit = this._unit(ct.disk_entity);
      const diskStr  = dockerFormatBytes(diskNum, diskUnit);

      const hasMetrics = ct.cpu_entity || ct.ram_entity || ct.disk_entity;

      return `
        <div class="container-row">
          <div class="row-header">
            <div class="row-left">
              <div class="status-dot-wrap">
                <div class="ct-dot" style="background:${dotColor};${pulseAnim}"></div>
              </div>
              ${ct.icon ? `<ha-icon class="ct-icon" icon="${ct.icon}"></ha-icon>` : ''}
              <span class="ct-name">${ct.name || ''}</span>
            </div>
            <div class="ct-badge" style="background:${badgeBg};color:${badgeColor};">${badgeText}</div>
          </div>
          ${hasMetrics ? `
          <div class="metrics-grid">
            ${ct.cpu_entity ? `
            <div class="metric-cell">
              <span class="metric-label">CPU</span>
              <span class="metric-value" style="color:${cpuColor};">${cpuStr ?? '—'}</span>
            </div>` : ''}
            ${ct.ram_entity ? `
            <div class="metric-cell">
              <span class="metric-label">RAM</span>
              <span class="metric-value">${ramStr ?? '—'}</span>
            </div>` : ''}
            ${ct.disk_entity ? `
            <div class="metric-cell">
              <span class="metric-label">DISK</span>
              <span class="metric-value">${diskStr ?? '—'}</span>
            </div>` : ''}
          </div>` : ''}
        </div>`;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        ha-card { overflow: hidden; padding: 0; }

        /* ── Banner ── */
        .banner {
          background: var(--secondary-background-color);
          padding: 14px 16px 12px;
          border-bottom: 2px solid ${borderColor};
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .icon-box {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: ${iconBg};
          border: 1.5px solid ${iconBorderColor};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .icon-box ha-icon {
          --mdc-icon-size: 24px;
          color: ${iconColor};
        }
        .header-text { flex: 1; min-width: 0; }
        .server-name {
          font-size: 1.05em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }
        .meta-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 3px;
          flex-wrap: wrap;
        }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 0.75em;
          font-weight: 600;
          color: ${statusColor};
        }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${statusDot};
          ${hostOnline === true ? 'animation: pulse 2s infinite;' : ''}
          flex-shrink: 0;
        }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(76,175,80,0.55); }
          70%  { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }

        .host-meta {
          margin-top: 6px;
          font-size: 0.78em;
          color: var(--secondary-text-color);
        }

        /* ── Container list ── */
        .container-row {
          padding: 10px 16px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .container-row:last-child { border-bottom: none; }

        .row-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .row-left {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .status-dot-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 12px;
          flex-shrink: 0;
        }
        .ct-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ct-icon {
          --mdc-icon-size: 18px;
          color: var(--secondary-text-color);
          flex-shrink: 0;
        }
        .ct-name {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ct-badge {
          font-size: 0.72em;
          font-weight: 600;
          padding: 2px 9px;
          border-radius: 12px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        /* ── Metrics grid ── */
        .metrics-grid {
          display: flex;
          gap: 16px;
          margin-top: 5px;
          padding-left: 27px;
          flex-wrap: wrap;
        }
        .metric-cell {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }
        .metric-label {
          font-size: 0.65em;
          font-weight: 700;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .metric-value {
          font-size: 0.8em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
      </style>

      <ha-card>
        <div class="banner">
          <div class="header-row">
            <div class="icon-box">
              <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="header-text">
              <div class="server-name">${title}</div>
              <div class="meta-row">
                <div class="status-pill">
                  <div class="status-dot"></div>
                  ${statusLabel}
                </div>
              </div>
            </div>
          </div>
          ${hostMeta ? `<div class="host-meta">${hostMeta}</div>` : ''}
        </div>

        ${containerRows}
      </ha-card>
    `;
  }

  getCardSize() {
    const containers = this._config?.containers || [];
    return 2 + containers.length;
  }

  static getConfigElement() {
    return document.createElement('docker-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'My Server',
      icon: 'mdi:docker',
      containers_running_entity: 'sensor.docker_containers_running',
      containers_total_entity: 'sensor.docker_containers_total',
      images_entity: 'sensor.docker_images_total',
      running_states: ['running'],
      cpu_warn: 70,
      containers: [
        {
          name: 'Plex',
          icon: 'mdi:plex',
          status_entity: 'sensor.docker_plex_status',
          cpu_entity: 'sensor.docker_plex_cpu',
          ram_entity: 'sensor.docker_plex_memory',
        },
      ],
    };
  }
}

customElements.define('docker-card', DockerCard);

// ── Docker Card Editor ─────────────────────────────────────────────────────────

class DockerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }

  set hass(hass) {
    this._hass = hass;
  }

  _fire(config) {
    this._config = { ...config };
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _structuralChange(config) {
    this._fire(config);
    this._render();
  }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;
    const containers = c.containers || [];
    const runningStates = (c.running_states || ['running']).join(', ');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 0 0 16px; }

        .section-title {
          font-size: 0.78em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          padding: 16px 0 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }

        .row { display: flex; gap: 8px; margin-bottom: 8px; }

        ha-textfield { display: block; width: 100%; margin-bottom: 8px; }

        .list-item {
          padding: 10px;
          margin-bottom: 8px;
          background: var(--secondary-background-color);
          border-radius: 8px;
        }
        .list-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .list-item-title {
          font-size: 0.8em;
          font-weight: 600;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .list-item ha-textfield { margin-bottom: 6px; }
        .list-item ha-textfield:last-of-type { margin-bottom: 0; }

        .remove-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--secondary-text-color);
          padding: 4px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          line-height: 0;
        }
        .remove-btn:hover { color: var(--error-color, #f44336); background: rgba(244,67,54,0.08); }

        .add-btn {
          width: 100%;
          background: none;
          border: 1px dashed var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
          border-radius: 8px;
          padding: 8px;
          cursor: pointer;
          font-size: 0.85em;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 4px;
          margin-bottom: 8px;
        }
      </style>

      <!-- Host -->
      <div class="section-title">Host</div>
      <div class="row">
        <ha-textfield id="f-title" label="Title" value="${c.title || ''}"></ha-textfield>
        <ha-textfield id="f-icon"  label="Icon (mdi:...)" value="${c.icon || 'mdi:docker'}"></ha-textfield>
      </div>
      <ha-textfield id="f-host-entity"       label="Host Status Entity (optional)"        value="${c.host_entity || ''}"></ha-textfield>
      <ha-textfield id="f-containers-running" label="Containers Running Entity"            value="${c.containers_running_entity || ''}"></ha-textfield>
      <ha-textfield id="f-containers-total"   label="Containers Total Entity"              value="${c.containers_total_entity || ''}"></ha-textfield>
      <ha-textfield id="f-images"             label="Images Total Entity"                  value="${c.images_entity || ''}"></ha-textfield>

      <!-- Settings -->
      <div class="section-title">Settings</div>
      <ha-textfield id="f-running-states" label="Running States (comma-separated)" value="${runningStates}"></ha-textfield>
      <ha-textfield id="f-cpu-warn"       label="CPU Warn Threshold (%)"  type="number" min="0" max="100" value="${c.cpu_warn ?? 70}"></ha-textfield>

      <!-- Containers -->
      <div class="section-title">Containers</div>
      <div id="containers-list">
        ${containers.map((ct, i) => `
          <div class="list-item">
            <div class="list-item-header">
              <span class="list-item-title">Container ${i + 1}${ct.name ? ' — ' + ct.name : ''}</span>
              <button class="remove-btn" data-idx="${i}" data-action="remove-container" title="Remove">
                <ha-icon icon="mdi:close" style="--mdc-icon-size:18px"></ha-icon>
              </button>
            </div>
            <div class="row">
              <ha-textfield data-idx="${i}" data-field="name"   label="Name"          value="${ct.name || ''}"></ha-textfield>
              <ha-textfield data-idx="${i}" data-field="icon"   label="Icon (mdi:...)" value="${ct.icon || ''}"></ha-textfield>
            </div>
            <ha-textfield data-idx="${i}" data-field="status_entity" label="Status Entity"  value="${ct.status_entity || ''}"></ha-textfield>
            <ha-textfield data-idx="${i}" data-field="cpu_entity"    label="CPU Entity"     value="${ct.cpu_entity || ''}"></ha-textfield>
            <ha-textfield data-idx="${i}" data-field="ram_entity"    label="RAM Entity"     value="${ct.ram_entity || ''}"></ha-textfield>
            <ha-textfield data-idx="${i}" data-field="disk_entity"   label="Disk Entity"    value="${ct.disk_entity || ''}"></ha-textfield>
          </div>`).join('')}
      </div>
      <button class="add-btn" id="add-container">
        <ha-icon icon="mdi:plus" style="--mdc-icon-size:16px"></ha-icon> Add Container
      </button>
    `;

    // Simple fields
    this._bindText('f-title',              'title');
    this._bindText('f-icon',               'icon');
    this._bindText('f-host-entity',        'host_entity');
    this._bindText('f-containers-running', 'containers_running_entity');
    this._bindText('f-containers-total',   'containers_total_entity');
    this._bindText('f-images',             'images_entity');
    this._bindText('f-running-states',     'running_states', 'array');
    this._bindText('f-cpu-warn',           'cpu_warn', 'number');

    // Container field listeners
    const sr = this.shadowRoot;
    sr.querySelectorAll('[data-field]').forEach(field => {
      const handleField = (ev) => {
        const val = this._readVal(ev, field);
        const i   = Number(field.dataset.idx);
        const key = field.dataset.field;
        const cts = [...(this._config.containers || [])];
        cts[i] = { ...cts[i], [key]: val };
        this._fire({ ...this._config, containers: cts });
      };
      field.addEventListener('value-changed', handleField);
      field.addEventListener('input', handleField);
    });

    // Remove container
    sr.querySelectorAll('[data-action="remove-container"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cts = [...(this._config.containers || [])];
        cts.splice(Number(btn.dataset.idx), 1);
        const config = { ...this._config };
        if (cts.length) config.containers = cts; else delete config.containers;
        this._structuralChange(config);
      });
    });

    // Add container
    sr.getElementById('add-container')?.addEventListener('click', () => {
      const cts = [...(this._config.containers || []), { name: '', status_entity: '' }];
      this._structuralChange({ ...this._config, containers: cts });
    });
  }
}

customElements.define('docker-card-editor', DockerCardEditor);

// ── Device Monitor Card ───────────────────────────────────────────────────────

function dmFormatRelative(val) {
  if (!val || val === 'unavailable' || val === 'unknown') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const diff = Date.now() - d.getTime();
  const mins   = Math.floor(diff / 60000);
  const hours  = Math.floor(mins  / 60);
  const days   = Math.floor(hours / 24);
  const months = Math.floor(days  / 30.5);
  const years  = Math.floor(days  / 365);
  if (mins  <  2)  return 'Just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  === 1) return 'Yesterday';
  if (days  <  7)  return `${days} days ago`;
  if (days  < 14)  return 'Last week';
  if (days  < 30)  return `${Math.floor(days / 7)} weeks ago`;
  if (months <  2) return 'Last month';
  if (months < 12) return `${months} months ago`;
  if (years  <  2) return 'Last year';
  return `${years} years ago`;
}

function dmFormatHours(val) {
  if (val == null || val === 'unavailable' || val === 'unknown') return null;
  const n = parseFloat(val);
  if (isNaN(n)) return null;
  return new Intl.NumberFormat().format(Math.round(n));
}

function dmUsageClass(pct, warn) {
  if (pct == null || isNaN(pct)) return '';
  if (pct > warn)        return 'v-err';
  if (pct > warn * 0.75) return 'v-warn';
  return 'v-ok';
}

function dmHealthClass(pct) {
  if (pct == null || isNaN(pct)) return '';
  if (pct >= 90) return 'v-good';
  if (pct >= 70) return 'v-warn';
  return 'v-err';
}

class DeviceMonitorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass   = null;
    this._prevStates = '';
  }

  setConfig(config) { this._config = config; this._render(); }

  set hass(hass) {
    this._hass = hass;
    const watched = this._watchedEntities();
    const sig = watched.map(id => `${id}:${hass.states[id]?.state ?? ''}`).join('|');
    if (sig === this._prevStates) return;
    this._prevStates = sig;
    this._render();
  }

  _watchedEntities() {
    const ids = [];
    for (const dev of (this._config?.devices || [])) {
      if (dev.cpu_entity)       ids.push(dev.cpu_entity);
      if (dev.ram_entity)       ids.push(dev.ram_entity);
      if (dev.last_seen_entity) ids.push(dev.last_seen_entity);
      for (const disk of (dev.disks || [])) {
        if (disk.status_entity)  ids.push(disk.status_entity);
        if (disk.uptime_entity)  ids.push(disk.uptime_entity);
        if (disk.cycles_entity)  ids.push(disk.cycles_entity);
        if (disk.health_entity)  ids.push(disk.health_entity);
      }
    }
    return ids;
  }

  _stateVal(id) {
    if (!id || !this._hass) return null;
    return this._hass.states[id]?.state ?? null;
  }

  _render() {
    if (!this._config) return;
    const config   = this._config;
    const devices  = config.devices || [];
    const okStates = (config.ok_states || ['ok','good','healthy','normal','OK','on','true']).map(s => s.toLowerCase());
    const cpuWarn  = config.cpu_warn ?? 75;
    const ramWarn  = config.ram_warn ?? 90;

    const groupsHtml = devices.map(dev => {
      const rawCpu = this._stateVal(dev.cpu_entity);
      const cpu    = rawCpu != null && rawCpu !== 'unavailable' ? parseFloat(rawCpu) : null;
      const rawRam = this._stateVal(dev.ram_entity);
      const ram    = rawRam != null && rawRam !== 'unavailable' ? parseFloat(rawRam) : null;
      const lastSeen = dmFormatRelative(this._stateVal(dev.last_seen_entity));
      const cpuClass = dmUsageClass(cpu, cpuWarn);
      const ramClass = dmUsageClass(ram, ramWarn);

      const disksHtml = (dev.disks || []).map(disk => {
        const rawSt  = this._stateVal(disk.status_entity);
        const stVal  = rawSt && rawSt !== 'unavailable' && rawSt !== 'unknown' ? rawSt : null;
        const isOk   = stVal != null && okStates.includes(stVal.toLowerCase());
        const uptime = dmFormatHours(this._stateVal(disk.uptime_entity));
        const rawCyc = this._stateVal(disk.cycles_entity);
        const cycles = rawCyc != null && rawCyc !== 'unavailable' ? Math.round(parseFloat(rawCyc)) : null;
        const rawH   = this._stateVal(disk.health_entity);
        const health = rawH  != null && rawH  !== 'unavailable' ? parseFloat(rawH) : null;
        const hClass = dmHealthClass(health);
        return `
        <div class="disk-row">
          <ha-icon class="disk-icon" icon="${disk.icon || 'mdi:harddisk'}"></ha-icon>
          <span class="disk-name">${disk.name || 'Disk'}</span>
          <div class="disk-stats">
            ${uptime  != null ? `<span class="ds"><ha-icon icon="mdi:timer-outline"></ha-icon><span>${uptime} h</span></span>` : ''}
            ${cycles  != null ? `<span class="ds"><ha-icon icon="mdi:rotate-right"></ha-icon><span>${cycles}</span></span>` : ''}
            ${health  != null ? `<span class="ds"><ha-icon icon="mdi:chart-line"></ha-icon><span class="${hClass}">${health % 1 === 0 ? health : health.toFixed(2)}%</span></span>` : ''}
            ${stVal   != null ? `<span class="ds ${isOk ? 'v-good' : 'v-warn'}"><ha-icon icon="${isOk ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'}"></ha-icon><span>${isOk ? 'OK' : stVal}</span></span>` : ''}
          </div>
        </div>`;
      }).join('');

      return `
      <div class="device-group">
        <div class="device-row">
          <ha-icon class="dev-icon" icon="${dev.icon || 'mdi:server'}"></ha-icon>
          <span class="dev-name">${dev.name || 'Device'}</span>
          <div class="dev-stats">
            ${cpu      != null ? `<span class="dvs"><ha-icon icon="mdi:cpu-64-bit"></ha-icon><span class="${cpuClass}">${cpu.toFixed(1)}%</span></span>` : ''}
            ${ram      != null ? `<span class="dvs"><ha-icon icon="mdi:memory"></ha-icon><span class="${ramClass}">${ram.toFixed(2)}%</span></span>` : ''}
            ${lastSeen         ? `<span class="dvs"><ha-icon icon="mdi:clock-outline"></ha-icon><span>${lastSeen}</span></span>` : ''}
          </div>
        </div>
        ${disksHtml}
      </div>`;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}ha-card{overflow:hidden;padding:0}
        .card-header{padding:14px 16px 10px;font-size:.88em;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color,rgba(0,0,0,.12))}
        .device-group{padding:10px 0 8px}.device-group+.device-group{border-top:1px solid var(--divider-color,rgba(0,0,0,.12))}
        .device-row{display:flex;align-items:center;padding:2px 14px 6px;gap:8px}
        .dev-icon{--mdc-icon-size:20px;color:var(--primary-text-color);flex-shrink:0}
        .dev-name{font-size:.95em;font-weight:600;color:var(--primary-text-color);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dev-stats{display:flex;align-items:center;gap:12px;flex-shrink:0}
        .dvs{display:inline-flex;align-items:center;gap:3px;font-size:.8em;color:var(--secondary-text-color);white-space:nowrap}
        .dvs ha-icon{--mdc-icon-size:14px}
        .disk-row{display:flex;align-items:center;padding:3px 14px 3px 40px;gap:8px}
        .disk-icon{--mdc-icon-size:15px;color:var(--disabled-text-color,#9e9e9e);flex-shrink:0}
        .disk-name{font-size:.78em;color:var(--secondary-text-color);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .disk-stats{display:flex;align-items:center;gap:12px;flex-shrink:0}
        .ds{display:inline-flex;align-items:center;gap:3px;font-size:.75em;color:var(--secondary-text-color);white-space:nowrap}
        .ds ha-icon{--mdc-icon-size:13px}
        .v-ok{color:var(--primary-text-color)}.v-good{color:var(--success-color,#4caf50)}.v-warn{color:var(--warning-color,#ff9800)}.v-err{color:var(--error-color,#f44336)}
        .empty{padding:24px 16px;font-size:.88em;color:var(--secondary-text-color);font-style:italic;text-align:center}
      </style>
      <ha-card>
        ${config.title ? `<div class="card-header">${config.title}</div>` : ''}
        ${devices.length ? groupsHtml : '<div class="empty">No devices configured</div>'}
      </ha-card>
    `;
  }

  getCardSize() {
    const devs = this._config?.devices || [];
    return 1 + devs.reduce((acc, d) => acc + 1 + (d.disks?.length || 0), 0);
  }

  static getConfigElement() { return document.createElement('device-monitor-card-editor'); }
  static getStubConfig() {
    return { title: 'Device Monitor', devices: [{ name: 'My Server', icon: 'mdi:server', cpu_entity: 'sensor.cpu_percent', ram_entity: 'sensor.memory_percent', disks: [{ name: 'Boot Drive', status_entity: 'sensor.boot_smart_status', uptime_entity: 'sensor.boot_hours_on', cycles_entity: 'sensor.boot_start_stop', health_entity: 'sensor.boot_health_percent' }] }] };
  }
}

customElements.define('device-monitor-card', DeviceMonitorCard);

class DeviceMonitorCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {}; this._hass = null; this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config = JSON.parse(incoming);
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    });
  }

  set hass(hass) { this._hass = hass; }

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return String(ev.detail.value);
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _fire(config) {
    this._config = JSON.parse(JSON.stringify(config));
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _structuralChange(config) { this._fire(config); this._render(); }

  _tf(label, field, di, dsk, val) {
    const attrs = dsk != null ? `data-field="${field}" data-dev="${di}" data-disk="${dsk}"` : di != null ? `data-field="${field}" data-dev="${di}"` : `data-field="${field}"`;
    return `<ha-textfield ${attrs} label="${label}" value="${(val||'').toString().replace(/"/g,'&quot;')}"></ha-textfield>`;
  }

  _diskHtml(disk, di, devIdx) {
    return `<div class="disk-editor"><div class="disk-editor-header"><span class="disk-editor-label">Disk ${di+1}${disk.name?': '+disk.name:''}</span><button class="remove-btn" data-action="remove-disk" data-dev="${devIdx}" data-disk="${di}">Remove</button></div>
    <div class="row2">${this._tf('Name','disk-name',devIdx,di,disk.name)}${this._tf('Icon (mdi:...)','disk-icon',devIdx,di,disk.icon)}</div>
    ${this._tf('Status Entity','disk-status',devIdx,di,disk.status_entity)}
    ${this._tf('Uptime Entity (hours)','disk-uptime',devIdx,di,disk.uptime_entity)}
    <div class="row2">${this._tf('Cycles Entity','disk-cycles',devIdx,di,disk.cycles_entity)}${this._tf('Health Entity (%)','disk-health',devIdx,di,disk.health_entity)}</div></div>`;
  }

  _deviceHtml(dev, di) {
    return `<div class="device-editor"><div class="device-editor-header"><span class="device-editor-label">Device ${di+1}${dev.name?': '+dev.name:''}</span><button class="remove-btn danger" data-action="remove-device" data-dev="${di}">Remove Device</button></div>
    <div class="row2">${this._tf('Device Name','dev-name',di,null,dev.name)}${this._tf('Icon (mdi:...)','dev-icon',di,null,dev.icon)}</div>
    ${this._tf('CPU Entity (%)','dev-cpu',di,null,dev.cpu_entity)}
    ${this._tf('RAM Entity (%)','dev-ram',di,null,dev.ram_entity)}
    ${this._tf('Last Seen Entity','dev-last-seen',di,null,dev.last_seen_entity)}
    <div class="disks-heading">Disks</div>
    ${(dev.disks||[]).map((d,idx)=>this._diskHtml(d,idx,di)).join('')}
    <button class="add-btn" data-action="add-disk" data-dev="${di}">+ Add Disk</button></div>`;
  }

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;padding-bottom:16px}
        ha-textfield{display:block;width:100%;margin-bottom:8px;box-sizing:border-box}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row2 ha-textfield{margin-bottom:0}
        .section-title{font-size:.78em;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.07em;padding:16px 0 8px;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.12));margin-bottom:12px}
        .device-editor{border:1px solid var(--divider-color,rgba(0,0,0,.18));border-radius:8px;padding:12px;margin-bottom:12px;background:var(--secondary-background-color,rgba(0,0,0,.04))}
        .device-editor-header,.disk-editor-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .device-editor-label{font-size:.85em;font-weight:600;color:var(--primary-text-color)}
        .disks-heading{font-size:.72em;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--secondary-text-color);margin:14px 0 8px}
        .disk-editor{border:1px solid var(--divider-color,rgba(0,0,0,.12));border-radius:6px;padding:10px;margin-bottom:8px}
        .disk-editor-header{margin-bottom:8px}.disk-editor-label{font-size:.8em;font-weight:500;color:var(--secondary-text-color)}
        button{border:none;border-radius:6px;padding:5px 12px;font-size:.78em;font-weight:600;cursor:pointer;background:var(--primary-color,#03a9f4);color:#fff;letter-spacing:.03em}
        .remove-btn{background:transparent;color:var(--secondary-text-color);border:1px solid var(--divider-color,rgba(0,0,0,.2));padding:3px 8px;font-size:.72em}
        .remove-btn.danger{color:var(--error-color,#f44336);border-color:var(--error-color,#f44336)}
        .add-btn{background:transparent;color:var(--primary-color,#03a9f4);border:1px dashed var(--primary-color,#03a9f4);width:100%;padding:6px;margin-top:4px}
        .add-device-btn{background:transparent;color:var(--primary-color,#03a9f4);border:1px dashed var(--primary-color,#03a9f4);width:100%;padding:8px;font-size:.82em;font-weight:600;cursor:pointer;border-radius:8px;letter-spacing:.03em}
      </style>
      <div class="section-title">Basic</div>
      ${this._tf('Card Title','card-title',null,null,c.title)}
      <div class="section-title">Devices</div>
      ${(c.devices||[]).map((d,i)=>this._deviceHtml(d,i)).join('')}
      <button class="add-device-btn" data-action="add-device">+ Add Device</button>
    `;
    this._bindAll();
  }

  _bindAll() {
    const sr = this.shadowRoot;
    const devMap  = {'dev-name':'name','dev-icon':'icon','dev-cpu':'cpu_entity','dev-ram':'ram_entity','dev-last-seen':'last_seen_entity'};
    const diskMap = {'disk-name':'name','disk-icon':'icon','disk-status':'status_entity','disk-uptime':'uptime_entity','disk-cycles':'cycles_entity','disk-health':'health_entity'};

    const cardTitleEl = sr.querySelector('[data-field="card-title"]');
    if (cardTitleEl) {
      const h = (ev) => {
        const val = this._readVal(ev, cardTitleEl).trim();
        const config = { ...this._config };
        if (val) config.title = val; else delete config.title;
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      cardTitleEl.addEventListener('value-changed', h);
      cardTitleEl.addEventListener('input', h);
    }

    sr.querySelectorAll('[data-field^="dev-"]').forEach(el => {
      const devIdx = Number(el.dataset.dev);
      const key = devMap[el.dataset.field];
      if (!key) return;
      const h = (ev) => {
        const val = this._readVal(ev, el).trim();
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        if (val) devices[devIdx][key] = val; else delete devices[devIdx][key];
        const config = { ...this._config, devices };
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      el.addEventListener('value-changed', h);
      el.addEventListener('input', h);
    });

    sr.querySelectorAll('[data-field^="disk-"]').forEach(el => {
      const devIdx  = Number(el.dataset.dev);
      const diskIdx = Number(el.dataset.disk);
      const key = diskMap[el.dataset.field];
      if (!key) return;
      const h = (ev) => {
        const val = this._readVal(ev, el).trim();
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        const disks = devices[devIdx].disks || [];
        if (val) disks[diskIdx][key] = val; else delete disks[diskIdx][key];
        devices[devIdx].disks = disks;
        const config = { ...this._config, devices };
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      el.addEventListener('value-changed', h);
      el.addEventListener('input', h);
    });

    sr.querySelector('[data-action="add-device"]')?.addEventListener('click', () => {
      const devices = JSON.parse(JSON.stringify(this._config.devices || []));
      devices.push({ name: 'New Device', icon: 'mdi:server', disks: [] });
      this._structuralChange({ ...this._config, devices });
    });

    sr.querySelectorAll('[data-action="remove-device"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        devices.splice(Number(btn.dataset.dev), 1);
        const config = { ...this._config };
        if (devices.length) config.devices = devices; else delete config.devices;
        this._structuralChange(config);
      });
    });

    sr.querySelectorAll('[data-action="add-disk"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const devIdx = Number(btn.dataset.dev);
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        (devices[devIdx].disks = devices[devIdx].disks || []).push({ name: 'New Disk', icon: 'mdi:harddisk' });
        this._structuralChange({ ...this._config, devices });
      });
    });

    sr.querySelectorAll('[data-action="remove-disk"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        devices[Number(btn.dataset.dev)].disks.splice(Number(btn.dataset.disk), 1);
        this._structuralChange({ ...this._config, devices });
      });
    });
  }
}

customElements.define('device-monitor-card-editor', DeviceMonitorCardEditor);

// ── Sonarr Upcoming Card ──────────────────────────────────────────────────────

class SonarrUpcomingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config      = null;
    this._hass        = null;
    this._episodes    = null;
    this._loading     = false;
    this._error       = null;
    this._refreshTimer = null;
    this._hasFetched  = false;
  }

  connectedCallback() {
    if (this._hass && this._config && !this._hasFetched) this._fetchUpcoming();
  }

  disconnectedCallback() { this._clearTimer(); }

  _clearTimer() {
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  }

  _startTimer() {
    this._clearTimer();
    const mins = this._config?.refresh_minutes ?? 30;
    this._refreshTimer = setInterval(() => this._fetchUpcoming(), mins * 60000);
  }

  setConfig(config) {
    this._config = config;
    if (!config.config_entry_id) { this._episodes = null; this._error = null; }
    this._render();
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;
    if (firstSet && this._config?.config_entry_id) { this._fetchUpcoming(); this._startTimer(); }
  }

  async _fetchUpcoming() {
    if (!this._hass || !this._config?.config_entry_id) return;
    this._loading = true;
    this._render();
    try {
      const days  = this._config.days ?? 7;
      const now   = new Date();
      const start = now.toISOString().split('T')[0];
      const end   = new Date(now.getTime() + days * 86400000).toISOString().split('T')[0];
      const result = await this._hass.connection.sendMessagePromise({
        type: 'call_service', domain: 'sonarr', service: 'get_upcoming',
        service_data: { start_date: start, end_date: end },
        target: { config_entry_id: this._config.config_entry_id },
        return_response: true,
      });
      this._episodes   = result?.response?.episodes ?? {};
      this._error      = null;
      this._hasFetched = true;
    } catch (err) {
      this._error = err?.message || 'Service call failed';
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _groupByDate(episodes) {
    const groups = {};
    for (const ep of Object.values(episodes)) {
      const key = (ep.air_date || '').split(' ')[0] || 'unknown';
      (groups[key] = groups[key] || []).push(ep);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, eps]) => ({ date, episodes: eps.sort((a, b) => (a.air_date_utc||'').localeCompare(b.air_date_utc||'')) }));
  }

  _dateLabel(dateStr) {
    if (!dateStr || dateStr === 'unknown') return 'Unknown Date';
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const tom   = new Date(today); tom.setDate(today.getDate() + 1);
    const same  = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return 'Today';
    if (same(d, tom))   return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  _networkStyle(network) {
    const map = {
      'hulu':'background:#1ce78320;color:#1ce783;border-color:#1ce78350','disney+':'background:#113ccf20;color:#6b8cff;border-color:#113ccf50',
      'apple tv':'background:#44444420;color:#aaa;border-color:#44444450','apple tv+':'background:#44444420;color:#aaa;border-color:#44444450',
      'netflix':'background:#e5091420;color:#e50914;border-color:#e5091450','max':'background:#002be720;color:#6688ff;border-color:#002be750',
      'amazon':'background:#00a8e020;color:#00a8e0;border-color:#00a8e050','prime video':'background:#00a8e020;color:#00a8e0;border-color:#00a8e050',
      'paramount+':'background:#0064ff20;color:#0064ff;border-color:#0064ff50','peacock':'background:#f5a62320;color:#f5a623;border-color:#f5a62350',
      'hbo':'background:#6e0bce20;color:#b06eff;border-color:#6e0bce50','fx':'background:#ff000020;color:#ff6666;border-color:#ff000050',
    };
    return map[(network||'').toLowerCase()] || '';
  }

  _episodeHtml(ep) {
    const showPoster   = this._config?.show_poster   !== false;
    const showOverview = this._config?.show_overview  === true;
    const poster = ep.images?.poster;
    const isReady = ep.has_file;
    const finaleMap = { season:'Season Finale', series:'Series Finale', mid_season:'Mid-Season Finale' };
    const finale = finaleMap[ep.finale_type] ?? null;
    const netStyle = this._networkStyle(ep.network);
    return `
    <div class="ep-row">
      ${showPoster ? `<div class="poster-col">${poster ? `<img class="poster" src="${poster}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">` : `<div class="poster no-img"></div>`}</div>` : ''}
      <div class="ep-body">
        <div class="series-name">${ep.series_title || 'Unknown Series'}</div>
        <div class="ep-line">
          <span class="ep-id">${ep.episode_identifier||''}</span>
          ${ep.title ? `<span class="sep">·</span><span class="ep-title">${ep.title}</span>` : ''}
          ${ep.runtime ? `<span class="runtime">${ep.runtime}m</span>` : ''}
        </div>
        <div class="badges">
          ${ep.network ? `<span class="badge network"${netStyle?` style="${netStyle}"`:''}>${ep.network}</span>` : ''}
          ${finale     ? `<span class="badge finale">${finale}</span>` : ''}
          ${isReady    ? `<span class="badge ready">✓ Ready</span>` : `<span class="badge upcoming">Upcoming</span>`}
        </div>
        ${showOverview && ep.overview ? `<div class="overview">${ep.overview}</div>` : ''}
      </div>
    </div>`;
  }

  _render() {
    if (!this._config) return;
    const title  = this._config.title || 'Upcoming Episodes';
    const groups = this._episodes ? this._groupByDate(this._episodes) : [];
    let bodyHtml;
    if (!this._config.config_entry_id) {
      bodyHtml = `<div class="info-msg">Configure <code>config_entry_id</code> in card YAML.</div>`;
    } else if (this._loading && !this._hasFetched) {
      bodyHtml = `<div class="info-msg loading"><span class="spin">↻</span> Loading…</div>`;
    } else if (this._error) {
      bodyHtml = `<div class="info-msg error">⚠ ${this._error}</div>`;
    } else if (!groups.length) {
      bodyHtml = `<div class="info-msg">No upcoming episodes in the next ${this._config.days??7} days.</div>`;
    } else {
      bodyHtml = groups.map(({ date, episodes }) => {
        const label = this._dateLabel(date);
        return `<div class="date-group"><div class="date-hdr${label==='Today'?' today':''}">${label}</div>${episodes.map(ep=>this._episodeHtml(ep)).join('')}</div>`;
      }).join('');
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}ha-card{overflow:hidden;padding:0}
        .card-hdr{display:flex;align-items:center;padding:13px 16px 11px;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.12))}
        .card-title{flex:1;font-size:1em;font-weight:600;color:var(--primary-text-color)}
        .refresh-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);cursor:pointer;padding:4px;border-radius:4px;${this._loading?'animation:spin 1s linear infinite;':''}transition:color .2s}
        .refresh-icon:hover{color:var(--primary-color)}
        @keyframes spin{to{transform:rotate(360deg)}}
        .date-hdr{padding:8px 14px 6px;font-size:.7em;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--secondary-text-color);background:var(--secondary-background-color,rgba(0,0,0,.03));border-bottom:1px solid var(--divider-color,rgba(0,0,0,.08))}
        .date-hdr.today{color:var(--primary-color,#03a9f4)}
        .ep-row{display:flex;align-items:flex-start;padding:10px 14px;gap:12px;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.06))}
        .date-group .ep-row:last-child{border-bottom:none}
        .date-group+.date-group{border-top:1px solid var(--divider-color,rgba(0,0,0,.12))}
        .poster-col{flex-shrink:0;width:42px}
        .poster{width:42px;height:63px;border-radius:5px;object-fit:cover;display:block;background:var(--secondary-background-color)}
        .poster.no-img{background:var(--secondary-background-color);border-radius:5px;height:63px}
        .ep-body{flex:1;min-width:0}
        .series-name{font-size:.9em;font-weight:600;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
        .ep-line{display:flex;align-items:baseline;gap:4px;font-size:.78em;color:var(--secondary-text-color);margin-bottom:5px;overflow:hidden}
        .ep-id{font-family:monospace;font-weight:700;flex-shrink:0}
        .sep{opacity:.4;flex-shrink:0}
        .ep-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .runtime{flex-shrink:0;color:var(--disabled-text-color,#9e9e9e);padding-left:4px}
        .badges{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
        .badge{font-size:.63em;font-weight:700;padding:2px 7px;border-radius:10px;border:1px solid transparent;letter-spacing:.02em;white-space:nowrap}
        .badge.network{background:var(--secondary-background-color);color:var(--secondary-text-color);border-color:var(--divider-color,rgba(0,0,0,.15))}
        .badge.finale{background:rgba(156,39,176,.12);color:#b06eff;border-color:rgba(156,39,176,.35)}
        .badge.ready{background:rgba(76,175,80,.12);color:var(--success-color,#4caf50);border-color:rgba(76,175,80,.3)}
        .badge.upcoming{background:rgba(158,158,158,.08);color:var(--disabled-text-color,#9e9e9e);border-color:rgba(158,158,158,.2)}
        .overview{font-size:.75em;color:var(--secondary-text-color);margin-top:5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .info-msg{padding:22px 16px;font-size:.85em;color:var(--secondary-text-color);text-align:center}
        .info-msg.error{color:var(--error-color,#f44336)}
        .info-msg code{font-size:.9em;background:var(--secondary-background-color);padding:1px 5px;border-radius:3px}
        .spin{display:inline-block;animation:spin 1s linear infinite}
      </style>
      <ha-card>
        <div class="card-hdr">
          <div class="card-title">${title}</div>
          <ha-icon class="refresh-icon" id="refresh" icon="mdi:refresh"></ha-icon>
        </div>
        ${bodyHtml}
      </ha-card>
    `;
    this.shadowRoot.getElementById('refresh')?.addEventListener('click', () => this._fetchUpcoming());
  }

  getCardSize() {
    if (!this._episodes) return 3;
    const groups = this._groupByDate(this._episodes);
    return 1 + groups.reduce((acc, g) => acc + 1 + g.episodes.length, 0);
  }

  static getConfigElement() { return document.createElement('sonarr-upcoming-card-editor'); }
  static getStubConfig() { return { title: 'Upcoming Episodes', config_entry_id: '', days: 7 }; }
}

customElements.define('sonarr-upcoming-card', SonarrUpcomingCard);

class SonarrUpcomingCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {}; this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming; this._config = { ...config };
    this._render();
    Promise.resolve().then(() => {
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
    });
  }

  set hass(_) {}

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return String(ev.detail.value);
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _fire(config) {
    this._config = { ...config }; this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    const commit = (raw) => {
      raw = (raw ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') { if (raw === '') delete config[key]; else config[key] = Number(raw); }
      else { if (raw) config[key] = raw; else delete config[key]; }
      if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
    };
    el.addEventListener('value-changed', (ev) => commit(this._readVal(ev, el)));
    el.addEventListener('input',         (ev) => commit(this._readVal(ev, el)));
  }

  _render() {
    const c = this._config;
    const f = (k) => (c[k] ?? '').toString().replace(/"/g, '&quot;');
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;padding-bottom:16px}
        ha-textfield{display:block;width:100%;margin-bottom:8px}
        .section{font-size:.78em;font-weight:600;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.07em;padding:16px 0 8px;border-bottom:1px solid var(--divider-color,rgba(0,0,0,.12));margin-bottom:12px}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row2 ha-textfield{margin-bottom:0}
        .hint{font-size:.75em;color:var(--secondary-text-color);margin:-4px 0 10px;line-height:1.4}
      </style>
      <div class="section">Basic</div>
      <ha-textfield id="f-title" label="Card Title" value="${f('title')}"></ha-textfield>
      <div class="section">Sonarr Connection</div>
      <ha-textfield id="f-entry" label="Config Entry ID" value="${f('config_entry_id')}"></ha-textfield>
      <div class="hint">Found in Settings → Devices &amp; Services → Sonarr → ⋮ → Copy entry ID</div>
      <div class="section">Options</div>
      <div class="row2">
        <ha-textfield id="f-days"    label="Days ahead"        type="number" min="1" max="90"   value="${c.days??7}"></ha-textfield>
        <ha-textfield id="f-refresh" label="Refresh (minutes)" type="number" min="5" max="1440" value="${c.refresh_minutes??30}"></ha-textfield>
      </div>
    `;
    this._bindText('f-title',   'title');
    this._bindText('f-entry',   'config_entry_id');
    this._bindText('f-days',    'days',            'number');
    this._bindText('f-refresh', 'refresh_minutes', 'number');
  }
}

customElements.define('sonarr-upcoming-card-editor', SonarrUpcomingCardEditor);

console.info('%c RUSSTUM-CARDS %c NAS · UPS · Media · Minecraft · Docker · Device Monitor · Sonarr Upcoming ', 'color:#fff;background:#1976d2;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px', 'color:#1976d2;background:rgba(25,118,210,0.1);font-weight:600;padding:2px 6px;border-radius:0 3px 3px 0');
