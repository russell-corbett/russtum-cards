/**
 * Docker Card for Home Assistant
 *
 * Configuration:
 *   type: custom:docker-card
 *   title: My Server
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
