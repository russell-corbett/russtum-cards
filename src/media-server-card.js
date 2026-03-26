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

// Convert a value+unit to bytes for comparison
function toBytes(n, unit) {
  const u = (unit || 'GB').trim();
  const map = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
  return n * (map[u] || 1e9);
}

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

  _readVal(ev, el) {
    if (ev.detail?.value !== undefined) return ev.detail.value;
    const path = ev.composedPath?.() ?? [];
    const inner = path.find(n => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement);
    return inner?.value ?? el.value ?? '';
  }

  _bind(id, key, type) {
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

    this._bind('f-title',          'title');
    this._bind('f-radarr-movies',  'radarr_movies_entity');
    this._bind('f-radarr-queue',   'radarr_queue_entity');
    this._bind('f-sonarr-series',  'sonarr_series_entity');
    this._bind('f-sonarr-queue',   'sonarr_queue_entity');
    this._bind('f-disk-free',      'disk_free_entity');
    this._bind('f-disk-total-val', 'disk_total', 'number');
    this._bind('f-disk-total-unit','disk_total_unit');
    this._bind('f-disk-pct',       'disk_used_pct_entity');
    this._bind('f-jelly',          'jellyfin_clients_entity');
    this._bind('f-dl-speed',       'qbit_download_speed_entity');
    this._bind('f-ul-speed',       'qbit_upload_speed_entity');
    this._bind('f-dl-total',       'qbit_download_total_entity');
    this._bind('f-ul-total',       'qbit_upload_total_entity');
  }
}

customElements.define('media-server-card-editor', MediaServerCardEditor);
