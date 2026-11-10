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
  // Accept NUT codes ("OL CHRG") and the friendly text some sensors report ("On Battery Battery Discharging").
  const text = rawStatus.toLowerCase();
  const words = [
    [/on ?line/, 'OL'], [/on battery/, 'OB'], [/low battery/, 'LB'], [/replace battery/, 'RB'], [/discharg/, 'DISCHRG'],
    [/(?<!dis)charging/, 'CHRG'], [/bypass/, 'BYPASS'], [/calibrat/, 'CAL'], [/overload/, 'OVER'], [/off ?line/, 'OFF'],
    [/forced shutdown/, 'FSD'], [/trim/, 'TRIM'], [/boost/, 'BOOST'],
  ].filter(([re]) => re.test(text)).map(([, c]) => c);
  const codes = words.length ? words : rawStatus.toUpperCase().split(/\s+/);
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
    // hass is set on every state change anywhere in HA, so build this list once.
    this._watched = [
      config.status_entity,
      config.battery_entity,
      config.runtime_entity,
      config.load_entity,
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

    const metric = (icon, label, pct, color, warn) => `
      <div class="m" title="${label}: ${pct != null ? pct + '%' : 'unknown'}">
        <ha-icon icon="${icon}" style="color:${color}"></ha-icon>
        <div class="bar"><div class="fill" style="width:${pct ?? 0}%;background:${color}"></div></div>
        <span class="v ${warn ? 'error' : ''}">${pct != null ? Math.round(pct) + '%' : '—'}</span>
      </div>`;

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 14px; }
        .row { display: flex; align-items: center; gap: 10px; }
        .hi { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
              --mdc-icon-size: 22px; color: ${status.color}; background: color-mix(in srgb, ${status.color} 16%, transparent); }
        .info { flex: 1; min-width: 0; }
        .title { font-size: .95em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .status { font-size: .78em; font-weight: 500; color: ${status.color}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rt { text-align: right; flex-shrink: 0; line-height: 1.15; }
        .rt b { display: block; font-size: 1.05em; color: ${isOnBattery ? 'var(--warning-color, #ff9800)' : 'var(--primary-text-color)'}; }
        .rt span { font-size: .68em; text-transform: uppercase; letter-spacing: .04em; color: var(--secondary-text-color); }
        .metrics { display: flex; gap: 14px; margin-top: 10px; }
        .m { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; --mdc-icon-size: 18px; }
        .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--divider-color, rgba(127,127,127,.2)); overflow: hidden; }
        .fill { height: 100%; border-radius: 3px; transition: width .6s ease; }
        .v { font-size: .82em; font-weight: 600; color: var(--primary-text-color); min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
        .v.error { color: var(--error-color, #f44336); }
      </style>
      <ha-card>
        <div class="row">
          <div class="hi"><ha-icon icon="${status.icon}"></ha-icon></div>
          <div class="info">
            <div class="title">${title}</div>
            <div class="status">${status.label}</div>
          </div>
          ${config.runtime_entity ? `<div class="rt"><b>${formatRuntime(runtimeSec)}</b><span>runtime</span></div>` : ''}
        </div>
        ${config.battery_entity || config.load_entity ? `
        <div class="metrics">
          ${config.battery_entity ? metric(batIcon, 'Battery', batteryPct, batBarColor, batteryLow) : ''}
          ${config.load_entity ? metric('mdi:gauge', 'Load', loadPct, loadBarColor, loadWarn) : ''}
        </div>` : ''}
      </ha-card>
    `;
    // Skip the DOM rebuild (CSS re-parse, ha-icon re-creation) when nothing visible changed.
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() {
    return 2;
  }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
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

class UpsCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:power-plug-battery', schema: [f.text('title', 'Title')] },
      { title: 'Entities', icon: 'mdi:format-list-bulleted', schema: [
        f.entity('status_entity', 'Status', 'NUT status data, e.g. OL / OB / LB'),
        f.grid(
          f.entity('battery_entity', 'Battery charge (%)'),
          f.entity('load_entity', 'Load (%)'),
        ),
        f.entity('runtime_entity', 'Runtime remaining', 'In seconds'),
      ] },
      { title: 'Thresholds', icon: 'mdi:tune-vertical', open: false, schema: [
        f.grid(
          f.number('battery_low_threshold', 'Battery low below', { min: 0, max: 100, unit: '%', helper: 'Default: 20' }),
          f.number('load_warn_threshold', 'Load warning above', { min: 0, max: 100, unit: '%', helper: 'Default: 80' }),
        ),
      ] },
    ];
  }
}

customElements.define('ups-card-editor', UpsCardEditor);
