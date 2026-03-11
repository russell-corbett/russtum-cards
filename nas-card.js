/**
 * NAS Card for Home Assistant
 *
 * Configuration:
 *   type: custom:nas-card
 *   title: My NAS                         # Card title
 *   total_drives: 8                       # Total bay count (visual slots)
 *   live_states:                          # States that count as "live"
 *     - active
 *     - on
 *   drive_entity_prefix: sensor.nas_drive_ # Auto-detect drives by prefix
 *   drive_entity_suffix: _status           # Optional suffix filter
 *   drives:                               # Explicit drive list (manual overrides)
 *     - entity: sensor.nas_drive_1_status
 *       name: Bay 1
 *     - entity: sensor.nas_drive_2_status
 *       name: Bay 2
 *
 * Hybrid mode: if both `drives` and `drive_entity_prefix` are set, explicit
 * entries take priority and the prefix fills in any remaining discovered entities.
 */
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

    // Skip re-render if no relevant entity state changed
    if (oldHass) {
      const entities = this._getDriveEntities().map(d => d.entity).filter(Boolean);
      const changed = entities.some(id => hass.states[id] !== oldHass.states[id]);
      if (!changed) return;
    }

    this._render();
  }

  _getDriveEntities() {
    const { config, _hass: hass } = this;
    const explicitDrives = (config.drives || []).map(d => ({
      entity: d.entity,
      name: d.name || this._nameFromEntity(d.entity, config),
    }));

    if (!config.drive_entity_prefix || !hass) return explicitDrives;

    const prefix = config.drive_entity_prefix;
    const suffix = config.drive_entity_suffix || '';
    const explicitIds = new Set(explicitDrives.map(d => d.entity));

    const discovered = Object.keys(hass.states)
      .filter(id => id.startsWith(prefix) && (suffix === '' || id.endsWith(suffix)))
      .filter(id => !explicitIds.has(id))
      .sort()
      .map(id => ({
        entity: id,
        name: this._nameFromEntity(id, config),
      }));

    return [...explicitDrives, ...discovered];
  }

  _nameFromEntity(entityId, config) {
    let name = entityId;
    if (config.drive_entity_prefix) name = name.replace(config.drive_entity_prefix, '');
    if (config.drive_entity_suffix) name = name.replace(new RegExp(`${config.drive_entity_suffix}$`), '');
    return name.replace(/_/g, ' ').trim() || entityId;
  }

  get config() {
    return this._config;
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

  _render() {
    if (!this._config) return;

    const config = this._config;
    const hass = this._hass;
    const drives = hass ? this._getDriveEntities() : [];
    const totalDrives = config.total_drives || drives.length;

    let liveDrives = 0;
    const driveSlots = drives.map(drive => {
      const stateObj = hass?.states[drive.entity];
      const stateValue = stateObj?.state ?? 'unavailable';
      const live = this._isLive(stateValue);
      if (live) liveDrives++;
      return { ...drive, stateValue, live };
    });

    // Pad with empty slots up to totalDrives
    while (driveSlots.length < totalDrives) {
      const bay = driveSlots.length + 1;
      driveSlots.push({ entity: null, name: `Bay ${bay}`, stateValue: 'empty', live: false });
    }

    const title = config.title || 'NAS';
    const healthPct = totalDrives > 0 ? Math.round((liveDrives / totalDrives) * 100) : 0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        ha-card {
          padding: 16px 16px 12px;
        }

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
          transition: background 0.2s;
        }

        .drive ha-icon { --mdc-icon-size: 28px; }

        .drive.live ha-icon   { color: var(--success-color, #4caf50); }
        .drive.dead ha-icon   { color: var(--error-color, #f44336); }
        .drive.unavailable ha-icon { color: var(--warning-color, #ff9800); }
        .drive.empty ha-icon  { color: var(--disabled-text-color, #9e9e9e); opacity: 0.4; }

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

        .drive.live .drive-name   { color: var(--success-color, #4caf50); }
        .drive.dead .drive-name   { color: var(--error-color, #f44336); }

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
      </style>

      <ha-card>
        <div class="header">
          <ha-icon icon="mdi:nas"></ha-icon>
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="summary">${liveDrives} / ${totalDrives} drives live</div>
          </div>
        </div>

        <div class="drives-grid">
          ${driveSlots.map(drive => {
            const cls = this._driveStatusClass(drive.stateValue);
            const icon = drive.stateValue === 'empty' ? 'mdi:harddisk-plus' : 'mdi:harddisk';
            const tooltip = drive.entity
              ? `${drive.name}: ${drive.stateValue}`
              : `${drive.name} (empty)`;
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
                 style="width: ${healthPct}%"></div>
          </div>
          <span class="progress-label">${healthPct}%</span>
        </div>` : ''}
      </ha-card>
    `;
  }

  getCardSize() {
    return 3;
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
