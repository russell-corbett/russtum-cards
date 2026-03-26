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
    this._prevStates = '';
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Only re-render when a watched entity changes
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

    this.shadowRoot.innerHTML = `
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
  }

  getCardSize() {
    const devs = this._config?.devices || [];
    return 1 + devs.reduce((acc, d) => acc + 1 + (d.disks?.length || 0), 0);
  }

  static getConfigElement() {
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

class DeviceMonitorCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config    = {};
    this._hass      = null;
    this._configStr = '';
  }

  setConfig(config) {
    const incoming = JSON.stringify(config);
    if (this._configStr === incoming) return;
    this._configStr = incoming;
    this._config    = JSON.parse(incoming); // deep clone
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

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return String(ev.detail.value);
    const path  = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _fire(config) {
    this._config    = JSON.parse(JSON.stringify(config));
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

  // ── HTML generation helpers ──

  _tf(label, fieldKey, devIdx, diskIdx, value) {
    const data = diskIdx != null
      ? `data-field="${fieldKey}" data-dev="${devIdx}" data-disk="${diskIdx}"`
      : devIdx  != null
        ? `data-field="${fieldKey}" data-dev="${devIdx}"`
        : `data-field="${fieldKey}"`;
    const safe = (value || '').toString().replace(/"/g, '&quot;');
    return `<ha-textfield ${data} label="${label}" value="${safe}"></ha-textfield>`;
  }

  _diskEditorHtml(disk, devIdx, diskIdx) {
    return `
    <div class="disk-editor">
      <div class="disk-editor-header">
        <span class="disk-editor-label">Disk ${diskIdx + 1}${disk.name ? ': ' + disk.name : ''}</span>
        <button class="remove-btn" data-action="remove-disk" data-dev="${devIdx}" data-disk="${diskIdx}">Remove</button>
      </div>
      <div class="row2">
        ${this._tf('Name', 'disk-name', devIdx, diskIdx, disk.name)}
        ${this._tf('Icon (mdi:...)', 'disk-icon', devIdx, diskIdx, disk.icon)}
      </div>
      ${this._tf('Status Entity', 'disk-status', devIdx, diskIdx, disk.status_entity)}
      ${this._tf('Uptime Entity (hours)', 'disk-uptime', devIdx, diskIdx, disk.uptime_entity)}
      <div class="row2">
        ${this._tf('Cycles Entity', 'disk-cycles', devIdx, diskIdx, disk.cycles_entity)}
        ${this._tf('Health Entity (%)', 'disk-health', devIdx, diskIdx, disk.health_entity)}
      </div>
    </div>`;
  }

  _deviceEditorHtml(dev, devIdx) {
    const disks = dev.disks || [];
    return `
    <div class="device-editor">
      <div class="device-editor-header">
        <span class="device-editor-label">Device ${devIdx + 1}${dev.name ? ': ' + dev.name : ''}</span>
        <button class="remove-btn danger" data-action="remove-device" data-dev="${devIdx}">Remove Device</button>
      </div>

      <div class="row2">
        ${this._tf('Device Name', 'dev-name', devIdx, null, dev.name)}
        ${this._tf('Icon (mdi:...)', 'dev-icon', devIdx, null, dev.icon)}
      </div>
      ${this._tf('CPU Entity (%)', 'dev-cpu', devIdx, null, dev.cpu_entity)}
      ${this._tf('RAM Entity (%)', 'dev-ram', devIdx, null, dev.ram_entity)}
      ${this._tf('Last Seen Entity (datetime or text)', 'dev-last-seen', devIdx, null, dev.last_seen_entity)}

      <div class="disks-heading">Disks</div>
      ${disks.map((disk, di) => this._diskEditorHtml(disk, devIdx, di)).join('')}
      <button class="add-btn" data-action="add-disk" data-dev="${devIdx}">+ Add Disk</button>
    </div>`;
  }

  _render() {
    const c       = this._config;
    const devices = c.devices || [];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding-bottom: 16px; }
        ha-textfield { display: block; width: 100%; margin-bottom: 8px; box-sizing: border-box; }
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .row2 ha-textfield { margin-bottom: 0; }

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

        .device-editor {
          border: 1px solid var(--divider-color, rgba(0,0,0,0.18));
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 12px;
          background: var(--secondary-background-color, rgba(0,0,0,0.04));
        }
        .device-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .device-editor-label {
          font-size: 0.85em;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        .disks-heading {
          font-size: 0.72em;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--secondary-text-color);
          margin: 14px 0 8px;
        }
        .disk-editor {
          border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          border-radius: 6px;
          padding: 10px;
          margin-bottom: 8px;
        }
        .disk-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .disk-editor-label {
          font-size: 0.8em;
          font-weight: 500;
          color: var(--secondary-text-color);
        }

        button {
          border: none;
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 0.78em;
          font-weight: 600;
          cursor: pointer;
          background: var(--primary-color, #03a9f4);
          color: #fff;
          letter-spacing: 0.03em;
        }
        .remove-btn {
          background: transparent;
          color: var(--secondary-text-color);
          border: 1px solid var(--divider-color, rgba(0,0,0,0.2));
          padding: 3px 8px;
          font-size: 0.72em;
        }
        .remove-btn.danger { color: var(--error-color, #f44336); border-color: var(--error-color, #f44336); }
        .add-btn {
          background: transparent;
          color: var(--primary-color, #03a9f4);
          border: 1px dashed var(--primary-color, #03a9f4);
          width: 100%;
          padding: 6px;
          margin-top: 4px;
        }
        .add-device-btn {
          background: transparent;
          color: var(--primary-color, #03a9f4);
          border: 1px dashed var(--primary-color, #03a9f4);
          width: 100%;
          padding: 8px;
          font-size: 0.82em;
          font-weight: 600;
          cursor: pointer;
          border-radius: 8px;
          letter-spacing: 0.03em;
        }
      </style>

      <div class="section-title">Basic</div>
      ${this._tf('Card Title', 'card-title', null, null, c.title)}

      <div class="section-title">Devices</div>
      ${devices.map((dev, di) => this._deviceEditorHtml(dev, di)).join('')}
      <button class="add-device-btn" data-action="add-device">+ Add Device</button>
    `;

    this._bindAll();
  }

  _bindAll() {
    const sr = this.shadowRoot;

    // Generic field handler factory
    const devFieldMap = {
      'dev-name':     'name',
      'dev-icon':     'icon',
      'dev-cpu':      'cpu_entity',
      'dev-ram':      'ram_entity',
      'dev-last-seen':'last_seen_entity',
    };
    const diskFieldMap = {
      'disk-name':   'name',
      'disk-icon':   'icon',
      'disk-status': 'status_entity',
      'disk-uptime': 'uptime_entity',
      'disk-cycles': 'cycles_entity',
      'disk-health': 'health_entity',
    };

    // ── Card-level fields ──
    const cardTitleEl = sr.querySelector('[data-field="card-title"]');
    if (cardTitleEl) {
      const handle = (ev) => {
        const val = this._readVal(ev, cardTitleEl).trim();
        const config = { ...this._config };
        if (val) config.title = val; else delete config.title;
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      cardTitleEl.addEventListener('value-changed', handle);
      cardTitleEl.addEventListener('input',         handle);
    }

    // ── Device-level fields ──
    sr.querySelectorAll('[data-field^="dev-"]').forEach(el => {
      const devIdx = Number(el.dataset.dev);
      const key    = devFieldMap[el.dataset.field];
      if (key == null) return;
      const handle = (ev) => {
        const val     = this._readVal(ev, el).trim();
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        if (val) devices[devIdx][key] = val; else delete devices[devIdx][key];
        const config = { ...this._config, devices };
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      el.addEventListener('value-changed', handle);
      el.addEventListener('input',         handle);
    });

    // ── Disk-level fields ──
    sr.querySelectorAll('[data-field^="disk-"]').forEach(el => {
      const devIdx  = Number(el.dataset.dev);
      const diskIdx = Number(el.dataset.disk);
      const key     = diskFieldMap[el.dataset.field];
      if (key == null) return;
      const handle = (ev) => {
        const val     = this._readVal(ev, el).trim();
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        const disks   = devices[devIdx].disks || [];
        if (val) disks[diskIdx][key] = val; else delete disks[diskIdx][key];
        devices[devIdx].disks = disks;
        const config = { ...this._config, devices };
        if (JSON.stringify(config) !== JSON.stringify(this._config)) this._fire(config);
      };
      el.addEventListener('value-changed', handle);
      el.addEventListener('input',         handle);
    });

    // ── Add / Remove device ──
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

    // ── Add / Remove disk ──
    sr.querySelectorAll('[data-action="add-disk"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const devIdx  = Number(btn.dataset.dev);
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        const disks   = devices[devIdx].disks || [];
        disks.push({ name: 'New Disk', icon: 'mdi:harddisk' });
        devices[devIdx].disks = disks;
        this._structuralChange({ ...this._config, devices });
      });
    });

    sr.querySelectorAll('[data-action="remove-disk"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const devIdx  = Number(btn.dataset.dev);
        const diskIdx = Number(btn.dataset.disk);
        const devices = JSON.parse(JSON.stringify(this._config.devices || []));
        devices[devIdx].disks.splice(diskIdx, 1);
        this._structuralChange({ ...this._config, devices });
      });
    });
  }
}

customElements.define('device-monitor-card-editor', DeviceMonitorCardEditor);
