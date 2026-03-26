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

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = (el.value ?? '').trim();
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
      field.addEventListener('input', () => {
        const i = Number(field.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], entity: field.value };
        this._fire({ ...this._config, drives });
      });
    });
    sr.querySelectorAll('[data-list="drive-name"]').forEach(field => {
      field.addEventListener('input', () => {
        const i = Number(field.dataset.idx);
        const drives = [...(this._config.drives || [])];
        drives[i] = { ...drives[i], name: field.value };
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
    sr.querySelectorAll('[data-list="net-entity"]').forEach(field => {
      field.addEventListener('input', () => {
        const i = Number(field.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], entity: field.value };
        this._fire({ ...this._config, network_interfaces: ifaces });
      });
    });
    sr.querySelectorAll('[data-list="net-name"]').forEach(field => {
      field.addEventListener('input', () => {
        const i = Number(field.dataset.idx);
        const ifaces = [...(this._config.network_interfaces || [])];
        ifaces[i] = { ...ifaces[i], name: field.value };
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

  _bindText(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = (el.value ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      this._fire(config);
    });
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

  _bind(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = (el.value ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      this._fire(config);
    });
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
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch (_) {}
  return raw.split(',').map(s => s.trim()).filter(Boolean);
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

    const showPlayerList = online && playerList.length > 0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        .banner {
          background: var(--secondary-background-color);
          padding: 12px 14px 0;
          border-bottom: 2px solid ${online === true ? 'var(--success-color, #4caf50)' : online === false ? 'var(--error-color, #f44336)' : 'var(--divider-color)'};
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .mc-icon-wrap {
          width: 38px;
          height: 38px;
          border-radius: 9px;
          background: ${online === true ? 'rgba(76,175,80,0.15)' : online === false ? 'rgba(244,67,54,0.12)' : 'rgba(158,158,158,0.12)'};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1.5px solid ${statusColor};
        }
        .mc-icon-wrap ha-icon { --mdc-icon-size: 22px; color: ${statusColor}; }
        .header-text { flex: 1; min-width: 0; }
        .server-name {
          font-size: 1em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-row { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: ${statusDot};
          ${online === true ? 'animation: pulse 2s infinite;' : ''}
          flex-shrink: 0;
        }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(76,175,80,0.6); }
          70%  { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }
        .status-label { font-size: 0.78em; font-weight: 500; color: ${statusColor}; }
        .latency-badge { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; gap: 1px; }
        .latency-icon { --mdc-icon-size: 18px; color: ${latColor}; }
        .latency-val { font-size: 0.72em; font-weight: 700; color: ${latColor}; white-space: nowrap; }
        .motd {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
          padding: 0 0 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
          gap: 1px;
          background: var(--divider-color, rgba(0,0,0,0.12));
        }
        .stat {
          background: var(--card-background-color, var(--lovelace-background));
          padding: 9px 12px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
        }
        .stat-label { font-size: 0.65em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
        .stat-value { font-size: 1em; font-weight: 700; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .stat-icon { --mdc-icon-size: 14px; color: var(--secondary-text-color); margin-bottom: 1px; }
        .stat-value.has-players { color: var(--success-color, #4caf50); }
        .stat-value.version { font-size: 0.85em; }

        .players-section {
          padding: 8px 14px 12px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .players-header { font-size: 0.65em; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
        .player-list { display: flex; flex-wrap: wrap; gap: 5px; }
        .player-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--secondary-background-color);
          border-radius: 16px;
          padding: 3px 8px 3px 3px;
          font-size: 0.78em;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .player-avatar {
          width: 19px;
          height: 19px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.68em;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }
      </style>

      <ha-card>
        <div class="banner">
          <div class="header-row">
            <div class="mc-icon-wrap">
              <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="header-text">
              <div class="server-name">${title}</div>
              <div class="status-row">
                <div class="status-dot"></div>
                <span class="status-label">${statusLabel}</span>
              </div>
            </div>
            ${config.latency_entity ? `
            <div class="latency-badge">
              <ha-icon class="latency-icon" icon="${latIconStr}"></ha-icon>
              <span class="latency-val">${latencyMs != null ? latencyMs + ' ms' : '—'}</span>
            </div>` : ''}
          </div>
          ${rawMotd && rawMotd !== 'unavailable' && rawMotd !== 'unknown' ? `<div class="motd">${rawMotd}</div>` : ''}
        </div>

        <div class="stats">
          ${config.players_entity ? `
          <div class="stat">
            <ha-icon class="stat-icon" icon="mdi:account-group"></ha-icon>
            <div class="stat-label">Players</div>
            <div class="stat-value ${players != null && players > 0 ? 'has-players' : ''}">${playerCountStr}</div>
          </div>` : ''}

          ${config.version_entity ? `
          <div class="stat">
            <ha-icon class="stat-icon" icon="mdi:tag"></ha-icon>
            <div class="stat-label">Version</div>
            <div class="stat-value version">${rawVersion && rawVersion !== 'unavailable' ? rawVersion : '—'}</div>
          </div>` : ''}
        </div>

        ${showPlayerList ? `
        <div class="players-section">
          <div class="players-header">Online Now</div>
          <div class="player-list">
            ${playerList.map(name => `
            <div class="player-chip">
              <div class="player-avatar" style="background:${avatarColor(name)};">${name.charAt(0).toUpperCase()}</div>
              ${name}
            </div>`).join('')}
          </div>
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

  _bind(id, key, type) {
    const el = this.shadowRoot.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const raw = (el.value ?? '').trim();
      const config = { ...this._config };
      if (type === 'number') {
        if (raw === '') delete config[key]; else config[key] = Number(raw);
      } else {
        if (raw) config[key] = raw; else delete config[key];
      }
      this._fire(config);
    });
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

console.info('%c RUSSTUM-CARDS %c NAS + UPS + Media Server + Minecraft loaded ', 'color:#fff;background:#1976d2;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px', 'color:#1976d2;background:rgba(25,118,210,0.1);font-weight:600;padding:2px 6px;border-radius:0 3px 3px 0');
