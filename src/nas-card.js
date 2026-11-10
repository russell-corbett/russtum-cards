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
    // hass is set on every state change anywhere in HA, so build this list once.
    this._watched = [
      ...this._getDriveEntities().map(d => d.entity),
      ...this._getNetworkEntities().map(n => n.entity),
      config.status_entity,
      config.temperature_entity,
      config.uptime_entity,
    ].filter(Boolean);
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;

    if (oldHass && !this._watched.some(id => hass.states[id] !== oldHass.states[id])) return;

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

    const html = `
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
    // Skip the DOM rebuild (CSS re-parse, ha-icon re-creation) when nothing visible changed.
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() {
    return 3;
  }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
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

class NasCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:nas', schema: [
        f.grid(f.text('title', 'Title'), f.number('total_drives', 'Total bays', { min: 1, max: 64, helper: 'Empty slots show as open bays' })),
        f.entity('status_entity', 'NAS status entity', 'Colours the NAS icon'),
        f.grid(
          f.states('status_ok_states', 'OK states', ['online', 'running', 'active', 'ok', 'on', 'healthy'], 'Default: online, running, active, ok, on, healthy'),
          f.states('status_warn_states', 'Warning states', ['degraded', 'warning', 'degrading'], 'Default: degraded, warning, degrading'),
        ),
      ] },
      { title: 'Drives', icon: 'mdi:harddisk', schema: [
        f.states('live_states', 'Drive states that count as live', ['active', 'on', 'online', 'healthy', 'ok'], 'Default: active, on'),
      ], list: {
        key: 'drives',
        schema: [f.grid(f.entity('entity', 'Drive entity'), f.text('name', 'Name'))],
        label: (d, i) => d.name || d.entity || `Bay ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add drive',
      } },
      { title: 'Temperature & uptime', icon: 'mdi:thermometer', open: false, schema: [
        f.entity('temperature_entity', 'Temperature entity'),
        f.grid(
          f.number('temperature_warn', 'Warning at', { unit: '°C', helper: 'Default: 60' }),
          f.number('temperature_high', 'Critical at', { unit: '°C', helper: 'Default: 75' }),
        ),
        f.entity('uptime_entity', 'Uptime entity', 'Seconds, or a formatted string'),
      ] },
      { title: 'Network', icon: 'mdi:ethernet', open: false, schema: [
        f.states('network_live_states', 'Link-up states', ['on', 'connected', 'up'], 'Default: on, connected, up'),
      ], list: {
        key: 'network_interfaces',
        schema: [f.grid(f.entity('entity', 'Link entity'), f.text('name', 'Name'))],
        label: (n, i) => n.name || n.entity || `Interface ${i + 1}`,
        newItem: () => ({}),
        addLabel: 'Add interface',
      } },
    ];
  }
}

customElements.define('nas-card-editor', NasCardEditor);
