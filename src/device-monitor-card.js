/**
 * Device Monitor Card for Home Assistant
 *
 * Shows one or more devices (hosts) each with CPU, RAM, last-seen, and
 * an expandable list of attached disks (uptime, cycles, health, status).
 *
 * type: custom:device-monitor-card
 * title: My Servers                    # optional card title
 * ok_states:                           # disk states treated as "OK" (default below)
 *   - ok
 *   - good
 * cpu_warn: 75                         # CPU % → orange (default 75)
 * ram_warn: 90                         # RAM % → orange (default 90)
 * devices:
 *   - name: Node Media
 *     icon: mdi:server
 *     cpu_entity: sensor.node_media_cpu_percent
 *     ram_entity: sensor.node_media_memory_percent
 *     last_seen_entity: sensor.node_media_last_seen   # datetime or text
 *     disks:
 *       - name: Boot Drive
 *         icon: mdi:harddisk               # optional, default mdi:harddisk
 *         status_entity: sensor.boot_smart_status
 *         uptime_entity: sensor.boot_hours_on
 *         cycles_entity: sensor.boot_start_stop
 *         health_entity: sensor.boot_health_percent
 *       - name: Storage1
 *         status_entity: sensor.storage1_smart_status
 *         uptime_entity: sensor.storage1_hours_on
 *         cycles_entity: sensor.storage1_start_stop
 *         health_entity: sensor.storage1_health_percent
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function dmFormatRelative(val) {
  if (!val || val === 'unavailable' || val === 'unknown') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return val; // return as-is if not a date
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
  if (pct > warn)         return 'v-err';
  if (pct > warn * 0.75)  return 'v-warn';
  return 'v-ok';
}

function dmHealthClass(pct) {
  if (pct == null || isNaN(pct)) return '';
  if (pct >= 90) return 'v-good';
  if (pct >= 70) return 'v-warn';
  return 'v-err';
}

// ── Card ─────────────────────────────────────────────────────────────────────

class DeviceMonitorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass   = null;
    this._watched = [];
    this._clockTimer = null;
  }

  // "Last seen 5m ago" goes stale unless the entity changes, so re-render
  // once a minute while any device has a last_seen_entity.
  connectedCallback() {
    this._startClock();
  }

  disconnectedCallback() {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  }

  _startClock() {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
    const needsClock = (this._config?.devices || []).some(d => d.last_seen_entity);
    if (!needsClock || !this.isConnected) return;
    this._clockTimer = setInterval(() => { if (!document.hidden) this._render(); }, 60000);
  }

  setConfig(config) {
    this._config = config;
    // hass is set on every state change anywhere in HA, so build this list once.
    this._watched = this._watchedEntities();
    this._startClock();
    this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config) return;
    // Only the state string is rendered, so ignore attribute-only updates.
    if (oldHass && !this._watched.some(id => hass.states[id]?.state !== oldHass.states[id]?.state)) return;
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

  _stateVal(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    return s ? s.state : null;
  }

  _render() {
    if (!this._config) return;

    const config   = this._config;
    const devices  = config.devices || [];
    const okStates = (config.ok_states || ['ok', 'good', 'healthy', 'normal', 'OK', 'on', 'true']).map(s => s.toLowerCase());
    const cpuWarn  = config.cpu_warn ?? 75;
    const ramWarn  = config.ram_warn ?? 90;

    const deviceGroupsHtml = devices.map(dev => {
      // ── Device stats ──
      const rawCpu  = this._stateVal(dev.cpu_entity);
      const cpu     = rawCpu  != null && rawCpu  !== 'unavailable' ? parseFloat(rawCpu)  : null;
      const rawRam  = this._stateVal(dev.ram_entity);
      const ram     = rawRam  != null && rawRam  !== 'unavailable' ? parseFloat(rawRam)  : null;
      const rawLast = this._stateVal(dev.last_seen_entity);
      const lastSeen = dmFormatRelative(rawLast);

      const cpuClass = dmUsageClass(cpu, cpuWarn);
      const ramClass = dmUsageClass(ram, ramWarn);

      // ── Disk rows ──
      const disksHtml = (dev.disks || []).map(disk => {
        const rawStatus = this._stateVal(disk.status_entity);
        const statusVal = rawStatus && rawStatus !== 'unavailable' && rawStatus !== 'unknown' ? rawStatus : null;
        const isOk      = statusVal != null && okStates.includes(statusVal.toLowerCase());

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
            ${statusVal != null ? `
            <span class="ds ${isOk ? 'v-good' : 'v-warn'}">
              <ha-icon icon="${isOk ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'}"></ha-icon>
              <span>${isOk ? 'OK' : statusVal}</span>
            </span>` : ''}
          </div>
        </div>`;
      }).join('');

      return `
      <div class="device-group">
        <div class="device-row">
          <ha-icon class="dev-icon" icon="${dev.icon || 'mdi:server'}"></ha-icon>
          <span class="dev-name">${dev.name || 'Device'}</span>
          <div class="dev-stats">
            ${cpu != null ? `<span class="dvs"><ha-icon icon="mdi:cpu-64-bit"></ha-icon><span class="${cpuClass}">${cpu.toFixed(1)}%</span></span>` : ''}
            ${ram != null ? `<span class="dvs"><ha-icon icon="mdi:memory"></ha-icon><span class="${ramClass}">${ram.toFixed(2)}%</span></span>` : ''}
            ${lastSeen   ? `<span class="dvs"><ha-icon icon="mdi:clock-outline"></ha-icon><span>${lastSeen}</span></span>` : ''}
          </div>
        </div>
        ${disksHtml}
      </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        .card-header {
          padding: 14px 16px 10px;
          font-size: 0.88em;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }

        /* ── Device group ── */
        .device-group { padding: 10px 0 8px; }
        .device-group + .device-group {
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }

        /* Device header row */
        .device-row {
          display: flex;
          align-items: center;
          padding: 2px 14px 6px;
          gap: 8px;
        }
        .dev-icon {
          --mdc-icon-size: 20px;
          color: var(--primary-text-color);
          flex-shrink: 0;
        }
        .dev-name {
          font-size: 0.95em;
          font-weight: 600;
          color: var(--primary-text-color);
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dev-stats {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .dvs {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 0.8em;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        .dvs ha-icon { --mdc-icon-size: 14px; }

        /* Disk rows */
        .disk-row {
          display: flex;
          align-items: center;
          padding: 3px 14px 3px 40px;
          gap: 8px;
        }
        .disk-icon {
          --mdc-icon-size: 15px;
          color: var(--disabled-text-color, #9e9e9e);
          flex-shrink: 0;
        }
        .disk-name {
          font-size: 0.78em;
          color: var(--secondary-text-color);
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .disk-stats {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .ds {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 0.75em;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        .ds ha-icon { --mdc-icon-size: 13px; }

        /* Value colours */
        .v-ok   { color: var(--primary-text-color); }
        .v-good { color: var(--success-color, #4caf50); }
        .v-warn { color: var(--warning-color, #ff9800); }
        .v-err  { color: var(--error-color, #f44336); }

        .empty {
          padding: 24px 16px;
          font-size: 0.88em;
          color: var(--secondary-text-color);
          font-style: italic;
          text-align: center;
        }
      </style>

      <ha-card>
        ${config.title ? `<div class="card-header">${config.title}</div>` : ''}
        ${devices.length ? deviceGroupsHtml : `<div class="empty">No devices configured</div>`}
      </ha-card>
    `;
    // Skip the DOM rebuild (CSS re-parse, ha-icon re-creation) when nothing visible changed.
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() {
    const devs = this._config?.devices || [];
    return 1 + devs.reduce((acc, d) => acc + 1 + (d.disks?.length || 0), 0);
  }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('device-monitor-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Device Monitor',
      devices: [
        {
          name: 'My Server',
          icon: 'mdi:server',
          cpu_entity: 'sensor.my_server_cpu_percent',
          ram_entity: 'sensor.my_server_memory_percent',
          last_seen_entity: 'sensor.my_server_last_seen',
          disks: [
            {
              name: 'Boot Drive',
              status_entity: 'sensor.boot_smart_status',
              uptime_entity: 'sensor.boot_hours_on',
              cycles_entity: 'sensor.boot_start_stop_count',
              health_entity: 'sensor.boot_health_percent',
            },
          ],
        },
      ],
    };
  }
}

customElements.define('device-monitor-card', DeviceMonitorCard);

// ── Editor ────────────────────────────────────────────────────────────────────

class DeviceMonitorCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:monitor-dashboard', schema: [
        f.text('title', 'Title'),
        f.grid(
          f.number('cpu_warn', 'CPU warning above', { min: 0, max: 100, unit: '%', helper: 'Default: 75' }),
          f.number('ram_warn', 'RAM warning above', { min: 0, max: 100, unit: '%', helper: 'Default: 90' }),
        ),
      ] },
      { title: 'Devices', icon: 'mdi:server', list: {
        key: 'devices',
        collapsible: true,
        schema: [
          f.grid(f.text('name', 'Device name'), f.icon('icon')),
          f.grid(f.entity('cpu_entity', 'CPU (%)'), f.entity('ram_entity', 'RAM (%)')),
          f.entity('last_seen_entity', 'Last seen', 'A date/time or text sensor'),
        ],
        label: (d, i) => d.name || `Device ${i + 1}`,
        newItem: () => ({ name: 'New Device', icon: 'mdi:server' }),
        addLabel: 'Add device',
        nested: {
          key: 'disks',
          title: 'Disks',
          collapsible: true,
          schema: [
            f.grid(f.text('name', 'Name'), f.icon('icon')),
            f.entity('status_entity', 'Status'),
            f.grid(f.entity('health_entity', 'Health (%)'), f.entity('uptime_entity', 'Power-on hours')),
            f.entity('cycles_entity', 'Start/stop cycles'),
          ],
          label: (d, i) => d.name || `Disk ${i + 1}`,
          newItem: () => ({ name: 'New Disk', icon: 'mdi:harddisk' }),
          addLabel: 'Add disk',
        },
      } },
    ];
  }
}

customElements.define('device-monitor-card-editor', DeviceMonitorCardEditor);
