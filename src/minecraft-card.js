/**
 * Minecraft Server Card for Home Assistant
 *
 * Configuration:
 *   type: custom:minecraft-card
 *   title: Russell's Minecraft Server    # Card title (optional)
 *   status_entity: binary_sensor.mc_online          # online/off — binary or text
 *   players_entity: sensor.mc_players_online        # current player count
 *   max_players_entity: sensor.mc_max_players       # max player slots (optional)
 *   latency_entity: sensor.mc_latency               # latency in ms (optional)
 *   version_entity: sensor.mc_version               # server version string (optional)
 *   motd_entity: sensor.mc_motd                     # Message of the Day (optional)
 *   player_list_entity: sensor.mc_player_list        # JSON array or comma-sep string (optional)
 *   icon: mdi:minecraft                             # header icon (optional, default mdi:minecraft)
 *   online_states:                                  # states that count as online (default: on, true, online, connected)
 *     - on
 *     - connected
 */

function isOnline(state, onlineStates) {
  if (!state || state === 'unavailable' || state === 'unknown') return null; // unknown
  return onlineStates.map(s => s.toLowerCase()).includes(state.toLowerCase());
}

function parsePlayerList(raw) {
  if (!raw || raw === 'unavailable' || raw === 'unknown') return [];
  let list = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed.filter(Boolean);
    else list = raw.split(',').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    list = raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // MC usernames have no spaces — entries with spaces are empty-state messages
  return list.filter(name => name && !name.includes(' '));
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

// Generates a deterministic pastel color from a username for avatar backgrounds
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

  _attr(entityId, attr) {
    if (!entityId || !this._hass) return null;
    return this._hass.states[entityId]?.attributes?.[attr] ?? null;
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

    // Status derived values
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
    const latIcon  = latencyIcon(latencyMs);

    const playerCountStr = players != null
      ? (maxPlayers != null ? `${players} / ${maxPlayers}` : `${players}`)
      : '—';

    const hasPlayers = online === true && playerList.length > 0;
    const showPlayerSection = online === true && config.player_list_entity;
    const hasInfo = config.players_entity || config.version_entity;
    const motd = rawMotd && rawMotd !== 'unavailable' && rawMotd !== 'unknown' ? rawMotd : null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; padding: 0; }

        /* ── Banner ── */
        .banner {
          background: var(--secondary-background-color);
          padding: 14px 16px 12px;
          border-bottom: 2px solid ${online === true ? 'var(--success-color, #4caf50)' : online === false ? 'var(--error-color, #f44336)' : 'var(--divider-color)'};
        }
        .header-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .mc-icon-wrap {
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: ${online === true ? 'rgba(76,175,80,0.12)' : online === false ? 'rgba(244,67,54,0.10)' : 'rgba(158,158,158,0.10)'};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1.5px solid ${statusColor};
        }
        .mc-icon-wrap ha-icon { --mdc-icon-size: 24px; color: ${statusColor}; }

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
          ${online === true ? 'animation: pulse 2s infinite;' : ''}
          flex-shrink: 0;
        }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(76,175,80,0.55); }
          70%  { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }
        .motd-inline {
          font-size: 0.73em;
          color: var(--secondary-text-color);
          font-style: italic;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
        }

        /* Latency top-right */
        .latency-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .latency-icon { --mdc-icon-size: 18px; color: ${latColor}; }
        .latency-val {
          font-size: 0.78em;
          font-weight: 700;
          color: ${latColor};
          white-space: nowrap;
        }

        /* ── Info strip ── */
        .info-strip {
          display: flex;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .info-item {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
        }
        .info-item + .info-item {
          border-left: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .info-icon { --mdc-icon-size: 22px; color: var(--secondary-text-color); flex-shrink: 0; }
        .info-body { min-width: 0; }
        .info-label {
          font-size: 0.62em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .info-value {
          font-size: 0.95em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .info-value.active { color: var(--success-color, #4caf50); }

        /* ── Player section ── */
        .players-section {
          padding: 10px 14px 13px;
        }
        .players-header {
          font-size: 0.62em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 7px;
        }
        .player-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .player-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--secondary-background-color);
          border-radius: 18px;
          padding: 4px 10px 4px 4px;
          font-size: 0.8em;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .player-avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7em;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }
        .empty-players {
          font-size: 0.8em;
          color: var(--disabled-text-color, #9e9e9e);
          font-style: italic;
        }
      </style>

      <ha-card>
        <!-- Banner -->
        <div class="banner">
          <div class="header-row">
            <div class="mc-icon-wrap">
              <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="header-text">
              <div class="server-name">${title}</div>
              <div class="meta-row">
                <div class="status-pill">
                  <div class="status-dot"></div>
                  ${statusLabel}
                </div>
                ${motd ? `<span class="motd-inline">${motd}</span>` : ''}
              </div>
            </div>
            ${config.latency_entity ? `
            <div class="latency-badge">
              <ha-icon class="latency-icon" icon="${latIcon}"></ha-icon>
              <span class="latency-val">${latencyMs != null ? latencyMs + ' ms' : '—'}</span>
            </div>` : ''}
          </div>
        </div>

        <!-- Info strip -->
        ${hasInfo ? `
        <div class="info-strip">
          ${config.players_entity ? `
          <div class="info-item">
            <ha-icon class="info-icon" icon="mdi:account-group"></ha-icon>
            <div class="info-body">
              <div class="info-label">Players</div>
              <div class="info-value ${players != null && players > 0 ? 'active' : ''}">${playerCountStr}</div>
            </div>
          </div>` : ''}
          ${config.version_entity ? `
          <div class="info-item">
            <ha-icon class="info-icon" icon="mdi:tag-outline"></ha-icon>
            <div class="info-body">
              <div class="info-label">Version</div>
              <div class="info-value" style="font-size:0.82em;">${rawVersion && rawVersion !== 'unavailable' ? rawVersion : '—'}</div>
            </div>
          </div>` : ''}
        </div>` : ''}

        <!-- Player list -->
        ${showPlayerSection ? `
        <div class="players-section">
          <div class="players-header">Online Now</div>
          ${hasPlayers ? `
          <div class="player-list">
            ${playerList.map(name => `
            <div class="player-chip">
              <div class="player-avatar" style="background:${avatarColor(name)};">${name.charAt(0).toUpperCase()}</div>
              ${name}
            </div>`).join('')}
          </div>` : `
          <div class="empty-players">No players currently online</div>`}
        </div>` : ''}
      </ha-card>
    `;
  }

  getCardSize() {
    return 3;
  }

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

// ── Minecraft Card Editor ──────────────────────────────────────────────────────

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
        .row { display: flex; gap: 8px; margin-bottom: 8px; }
        .row ha-textfield { margin-bottom: 0; }
      </style>

      <div class="section-title">Basic</div>
      <ha-textfield id="f-title" label="Title"         value="${c.title || ''}"></ha-textfield>
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
