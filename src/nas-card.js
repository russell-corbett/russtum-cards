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
    if (!config.drives && !config.drive_entity_prefix) {
      throw new Error('NAS card: must specify either `drives` or `drive_entity_prefix`');
    }
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
    const { config, _hass: hass } = this;
    const explicit = (config.drives || []).map(d => ({
      entity: d.entity,
      name: d.name || this._nameFromEntity(d.entity, config.drive_entity_prefix, config.drive_entity_suffix),
    }));

    if (!config.drive_entity_prefix || !hass) return explicit;

    const prefix = config.drive_entity_prefix;
    const suffix = config.drive_entity_suffix || '';
    const explicitIds = new Set(explicit.map(d => d.entity));

    const discovered = Object.keys(hass.states)
      .filter(id => id.startsWith(prefix) && (suffix === '' || id.endsWith(suffix)))
      .filter(id => !explicitIds.has(id))
      .sort()
      .map(id => ({ entity: id, name: this._nameFromEntity(id, prefix, suffix) }));

    return [...explicit, ...discovered];
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
    const { config, _hass: hass } = this;
    const explicit = (config.network_interfaces || []).map(n => ({
      entity: n.entity,
      name: n.name || this._nameFromEntity(n.entity, config.network_entity_prefix, config.network_entity_suffix),
    }));

    if (!config.network_entity_prefix || !hass) return explicit;

    const prefix = config.network_entity_prefix;
    const suffix = config.network_entity_suffix || '';
    const explicitIds = new Set(explicit.map(n => n.entity));

    const discovered = Object.keys(hass.states)
      .filter(id => id.startsWith(prefix) && (suffix === '' || id.endsWith(suffix)))
      .filter(id => !explicitIds.has(id))
      .sort()
      .map(id => ({ entity: id, name: this._nameFromEntity(id, prefix, suffix) }));

    return [...explicit, ...discovered];
  }

  _isLinkLive(stateValue) {
    const liveStates = this._config.network_live_states || ['on', 'connected', 'up'];
    return liveStates.includes(stateValue);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  _nameFromEntity(entityId, prefix, suffix) {
    let name = entityId;
    if (prefix) name = name.replace(prefix, '');
    if (suffix) name = name.replace(new RegExp(`${suffix}$`), '');
    return name.replace(/_/g, ' ').trim() || entityId;
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
      drive_entity_prefix: 'sensor.nas_drive_',
      drive_entity_suffix: '_status',
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
    if (this._configStr === incoming) return; // Avoid re-render loops
    this._configStr = incoming;
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = hass; });
  }

  _fire(config) {
    this._config = config;
    this._configStr = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }

  _structuralChange(config) {
    this._fire(config);
    this._render();
  }

  _bindText(id, key, type) {
    this.shadowRoot.getElementById(id)?.addEventListener('value-changed', ev => {
      const raw = (ev.detail?.value ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else if (type === 'array') {
        const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length) config[key] = arr; else delete config[key];
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      this._fire(config);
    });
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

        ha-entity-picker, ha-textfield { display: block; width: 100%; margin-bottom: 8px; }

        .list-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          margin-bottom: 6px;
          background: var(--secondary-background-color);
          border-radius: 8px;
        }
        .list-item ha-entity-picker,
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
      <ha-entity-picker id="f-status-entity" label="NAS Status Entity (for icon color)" value="${c.status_entity || ''}" allow-custom-entity></ha-entity-picker>

      <!-- Drive Detection -->
      <div class="section-title">Drive Detection</div>
      <p class="hint">Auto-detect drives by entity prefix/suffix, or list them explicitly below.</p>
      <div class="row">
        <ha-textfield id="f-prefix" label="Entity Prefix" value="${c.drive_entity_prefix || ''}" placeholder="sensor.nas_drive_"></ha-textfield>
        <ha-textfield id="f-suffix" label="Entity Suffix" value="${c.drive_entity_suffix || ''}" placeholder="_status"></ha-textfield>
      </div>

      <!-- Explicit Drives -->
      <div class="section-title">Drives (Explicit)</div>
      <div id="drives-list">
        ${drives.map((d, i) => `
          <div class="list-item">
            <ha-entity-picker data-idx="${i}" data-list="drive-entity" value="${d.entity || ''}" allow-custom-entity label="Entity"></ha-entity-picker>
            <ha-textfield data-idx="${i}" data-list="drive-name" label="Name" value="${d.name || ''}"></ha-textfield>
            <button class="remove-btn" data-idx="${i}" data-list="drive-remove" title="Remove">
              <ha-icon icon="mdi:close" style="--mdc-icon-size:18px"></ha-icon>
            </button>
          </div>`).join('')}
      </div>
      <button class="add-btn" id="add-drive"><ha-icon icon="mdi:plus" style="--mdc-icon-size:16px"></ha-icon> Add Drive</button>

      <!-- Temperature & Uptime -->
      <div class="section-title">Temperature &amp; Uptime</div>
      <ha-entity-picker id="f-temp-entity" label="Temperature Entity" value="${c.temperature_entity || ''}" allow-custom-entity></ha-entity-picker>
      <div class="row">
        <ha-textfield id="f-temp-warn" label="Warn (°C)" type="number" value="${c.temperature_warn ?? 60}"></ha-textfield>
        <ha-textfield id="f-temp-high" label="High (°C)" type="number" value="${c.temperature_high ?? 75}"></ha-textfield>
      </div>
      <ha-entity-picker id="f-uptime-entity" label="Uptime Entity" value="${c.uptime_entity || ''}" allow-custom-entity></ha-entity-picker>

      <!-- Network -->
      <div class="section-title">Network</div>
      <p class="hint">Auto-detect network interfaces by prefix/suffix, or list them explicitly below.</p>
      <div class="row">
        <ha-textfield id="f-net-prefix" label="Entity Prefix" value="${c.network_entity_prefix || ''}" placeholder="sensor.nas_"></ha-textfield>
        <ha-textfield id="f-net-suffix" label="Entity Suffix" value="${c.network_entity_suffix || ''}" placeholder="_link"></ha-textfield>
      </div>
      <ha-textfield id="f-net-live" label="Live States (comma-separated)" value="${netLiveStates}"></ha-textfield>

      <!-- Explicit Interfaces -->
      <div class="section-title">Interfaces (Explicit)</div>
      <div id="net-list">
        ${netIfaces.map((n, i) => `
          <div class="list-item">
            <ha-entity-picker data-idx="${i}" data-list="net-entity" value="${n.entity || ''}" allow-custom-entity label="Entity"></ha-entity-picker>
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
    this._bindText('f-prefix', 'drive_entity_prefix');
    this._bindText('f-suffix', 'drive_entity_suffix');
    this._bindText('f-temp-warn', 'temperature_warn', 'number');
    this._bindText('f-temp-high', 'temperature_high', 'number');
    this._bindText('f-net-prefix', 'network_entity_prefix');
    this._bindText('f-net-suffix', 'network_entity_suffix');
    this._bindText('f-net-live', 'network_live_states', 'array');

    // Entity pickers
    this._bindEntityPicker('f-status-entity', 'status_entity');
    this._bindEntityPicker('f-temp-entity', 'temperature_entity');
    this._bindEntityPicker('f-uptime-entity', 'uptime_entity');

    // Drives list
    sr.querySelectorAll('[data-list="drive-entity"]').forEach(picker => {
      picker.hass = this._hass;
      picker.addEventListener('value-changed', ev => {
        const i = Number(picker.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], entity: ev.detail.value };
        this._fire({ ...this._config, drives });
      });
    });
    sr.querySelectorAll('[data-list="drive-name"]').forEach(field => {
      field.addEventListener('value-changed', ev => {
        const i = Number(field.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], name: ev.detail.value };
        this._fire({ ...this._config, drives });
      });
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
    sr.querySelectorAll('[data-list="net-entity"]').forEach(picker => {
      picker.hass = this._hass;
      picker.addEventListener('value-changed', ev => {
        const i = Number(picker.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], entity: ev.detail.value };
        this._fire({ ...this._config, network_interfaces: ifaces });
      });
    });
    sr.querySelectorAll('[data-list="net-name"]').forEach(field => {
      field.addEventListener('value-changed', ev => {
        const i = Number(field.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], name: ev.detail.value };
        this._fire({ ...this._config, network_interfaces: ifaces });
      });
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
