/**
 * Docker Card for Home Assistant
 *
 * Configuration:
 *   type: custom:docker-card
 *   title: My Server
 *   device_name: Raspberry Pi                   # optional, shown across from title
 *   cpu_name: Intel i5-9500                     # optional, static text shown below
 *   ram: 32 GB                                  # optional, static text shown below (same line as cpu_name)
 *   gpu: RTX 3060                               # optional, static text shown below cpu/ram
 *   icon: mdi:docker                             # optional, default mdi:docker
 *   host_entity: binary_sensor.docker_status    # optional overall host status
 *   containers_running_entity: sensor.docker_containers_running
 *   containers_total_entity: sensor.docker_containers_total
 *   images_entity: sensor.docker_images_total
 *   running_states:                             # default: [running]
 *     - running
 *   cpu_warn: 70                                # % threshold for orange CPU (default 70)
 *   containers:
 *     - name: Plex
 *       icon: mdi:plex
 *       status_entity: sensor.docker_plex_status
 *       cpu_entity: sensor.docker_plex_cpu
 *       ram_entity: sensor.docker_plex_memory
 *       disk_entity: sensor.docker_plex_disk
 */

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
    // hass is set on every state change anywhere in HA, so build this list once.
    this._watched = [
      config.host_entity,
      config.containers_running_entity,
      config.containers_total_entity,
      config.images_entity,
      ...(config.containers || []).flatMap(c => [c.status_entity, c.cpu_entity, c.ram_entity, c.disk_entity]),
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
    const title      = config.title      || 'Docker';
    const icon       = config.icon       || 'mdi:docker';
    const deviceName = config.device_name || '';
    const cpuName    = config.cpu_name    || '';
    const ramText    = config.ram         || '';
    const gpuText    = config.gpu         || '';
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

    const html = `
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
        .title-device-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .server-name {
          font-size: 1.05em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }
        .device-name {
          font-size: 0.88em;
          font-weight: 600;
          color: var(--primary-text-color);
          white-space: nowrap;
          flex-shrink: 0;
          line-height: 1.2;
        }
        .sub-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 3px;
        }
        .meta-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .hw-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          flex-shrink: 0;
        }
        .hw-info {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.75em;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        .hw-sep { opacity: 0.5; }
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
              <div class="title-device-row">
                <div class="server-name">${title}</div>
                ${deviceName ? `<div class="device-name">${deviceName}</div>` : ''}
              </div>
              <div class="sub-row">
                <div class="meta-row">
                  <div class="status-pill">
                    <div class="status-dot"></div>
                    ${statusLabel}
                  </div>
                </div>
                ${(cpuName || ramText || gpuText) ? `
                <div class="hw-stack">
                  ${(cpuName || ramText) ? `
                  <div class="hw-info">
                    ${cpuName ? `<span>${cpuName}</span>` : ''}
                    ${cpuName && ramText ? `<span class="hw-sep">·</span>` : ''}
                    ${ramText ? `<span>${ramText}</span>` : ''}
                  </div>` : ''}
                  ${gpuText ? `
                  <div class="hw-info">
                    <span>${gpuText}</span>
                  </div>` : ''}
                </div>` : ''}
              </div>
            </div>
          </div>
          ${hostMeta ? `<div class="host-meta">${hostMeta}</div>` : ''}
        </div>

        ${containerRows}
      </ha-card>
    `;
    // Skip the DOM rebuild (CSS re-parse, ha-icon re-creation) when nothing visible changed.
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  getCardSize() {
    const containers = this._config?.containers || [];
    return 2 + containers.length;
  }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
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

class DockerCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Host', icon: 'mdi:docker', schema: [
        f.grid(f.text('title', 'Title'), f.icon('icon', 'Icon', 'Default: mdi:docker')),
        f.grid(f.text('device_name', 'Device name'), f.text('cpu_name', 'CPU')),
        f.grid(f.text('ram', 'RAM'), f.text('gpu', 'GPU')),
      ] },
      { title: 'Host entities', icon: 'mdi:format-list-bulleted', open: false, schema: [
        f.entity('host_entity', 'Host status'),
        f.grid(f.entity('containers_running_entity', 'Containers running'), f.entity('containers_total_entity', 'Containers total')),
        f.entity('images_entity', 'Images total'),
      ] },
      { title: 'Settings', icon: 'mdi:tune-vertical', open: false, schema: [
        f.states('running_states', 'Running states', ['running', 'on', 'healthy', 'up'], 'Default: running'),
        f.number('cpu_warn', 'CPU warning above', { min: 0, max: 100, unit: '%', helper: 'Default: 70' }),
      ] },
      { title: 'Containers', icon: 'mdi:package-variant-closed', list: {
        key: 'containers',
        collapsible: true,
        schema: [
          f.grid(f.text('name', 'Name'), f.icon('icon')),
          f.entity('status_entity', 'Status'),
          f.grid(f.entity('cpu_entity', 'CPU'), f.entity('ram_entity', 'RAM')),
          f.entity('disk_entity', 'Disk'),
        ],
        label: (c, i) => c.name || c.status_entity || `Container ${i + 1}`,
        newItem: () => ({ name: '', icon: 'mdi:docker' }),
        addLabel: 'Add container',
      } },
    ];
  }
}

customElements.define('docker-card-editor', DockerCardEditor);
