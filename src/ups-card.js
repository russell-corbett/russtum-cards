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
