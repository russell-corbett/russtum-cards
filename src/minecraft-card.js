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
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch (_) {}
  // comma-separated fallback
  return raw.split(',').map(s => s.trim()).filter(Boolean);
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

    // Player count display
    const playerCountStr = players != null
      ? (maxPlayers != null ? `${players} / ${maxPlayers}` : `${players}`)
      : '—';

    // Player list pills (only if online and list is non-empty)
    const showPlayerList = online && playerList.length > 0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        ha-card {
          overflow: hidden;
          padding: 0;
        }

        /* ── Banner / Header ── */
        .banner {
          background: var(--secondary-background-color);
          padding: 12px 14px 0;
          border-bottom: 2px solid ${online === true ? 'var(--success-color, #4caf50)' : online === false ? 'var(--error-color, #f44336)' : 'var(--divider-color)'};
        }

        .header-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }

        .mc-icon-wrap {
          width: 38px;
          height: 38px;
          border-radius: 9px;
          background: ${online === true ? 'rgba(76,175,80,0.15)' : online === false ? 'rgba(244,67,54,0.12)' : 'rgba(158,158,158,0.12)'};
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1.5px solid ${statusColor};
        }
        .mc-icon-wrap ha-icon {
          --mdc-icon-size: 22px;
          color: ${statusColor};
        }

        .header-text { flex: 1; min-width: 0; }
        .server-name {
          font-size: 1em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status-row {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-top: 2px;
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
          0%   { box-shadow: 0 0 0 0 rgba(76,175,80,0.6); }
          70%  { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
          100% { box-shadow: 0 0 0 0 rgba(76,175,80,0); }
        }
        .status-label {
          font-size: 0.78em;
          font-weight: 500;
          color: ${statusColor};
        }

        /* Latency badge top-right */
        .latency-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          flex-shrink: 0;
          gap: 1px;
        }
        .latency-icon {
          --mdc-icon-size: 18px;
          color: ${latColor};
        }
        .latency-val {
          font-size: 0.72em;
          font-weight: 700;
          color: ${latColor};
          white-space: nowrap;
        }

        /* MOTD strip */
        .motd {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          font-style: italic;
          padding: 0 0 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Stats grid ── */
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
          gap: 1px;
          background: var(--divider-color, rgba(0,0,0,0.12));
        }

        .stat {
          background: var(--card-background-color, var(--lovelace-background));
          padding: 9px 12px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
        }
        .stat-label {
          font-size: 0.65em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .stat-value {
          font-size: 1em;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .stat-icon {
          --mdc-icon-size: 14px;
          color: var(--secondary-text-color);
          margin-bottom: 1px;
        }

        .stat-value.has-players { color: var(--success-color, #4caf50); }
        .stat-value.version { font-size: 0.85em; }

        /* ── Player list ── */
        .players-section {
          padding: 8px 14px 12px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .players-header {
          font-size: 0.65em;
          color: var(--secondary-text-color);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }
        .player-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .player-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--secondary-background-color);
          border-radius: 16px;
          padding: 3px 8px 3px 3px;
          font-size: 0.78em;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .player-avatar {
          width: 19px;
          height: 19px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.68em;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }
      </style>

      <ha-card>
        <!-- Banner / Header -->
        <div class="banner">
          <div class="header-row">
            <div class="mc-icon-wrap">
              <ha-icon icon="${icon}"></ha-icon>
            </div>

            <div class="header-text">
              <div class="server-name">${title}</div>
              <div class="status-row">
                <div class="status-dot"></div>
                <span class="status-label">${statusLabel}</span>
              </div>
            </div>

            ${config.latency_entity ? `
            <div class="latency-badge">
              <ha-icon class="latency-icon" icon="${latIcon}"></ha-icon>
              <span class="latency-val">${latencyMs != null ? latencyMs + ' ms' : '—'}</span>
            </div>` : ''}
          </div>

          ${rawMotd && rawMotd !== 'unavailable' && rawMotd !== 'unknown' ? `
          <div class="motd">${rawMotd}</div>` : ''}
        </div>

        <!-- Stats tiles -->
        <div class="stats">

          ${config.players_entity ? `
          <div class="stat">
            <ha-icon class="stat-icon" icon="mdi:account-group"></ha-icon>
            <div class="stat-label">Players</div>
            <div class="stat-value ${players != null && players > 0 ? 'online' : ''}">${playerCountStr}</div>
          </div>` : ''}

          ${config.version_entity ? `
          <div class="stat">
            <ha-icon class="stat-icon" icon="mdi:tag"></ha-icon>
            <div class="stat-label">Version</div>
            <div class="stat-value" style="font-size:0.85em;">${rawVersion && rawVersion !== 'unavailable' ? rawVersion : '—'}</div>
          </div>` : ''}

          ${!config.latency_entity ? '' : ''}

        </div>

        <!-- Player list -->
        ${showPlayerList ? `
        <div class="players-section">
          <div class="players-header">Online Now</div>
          <div class="player-list">
            ${playerList.map(name => `
            <div class="player-chip">
              <div class="player-avatar" style="background:${avatarColor(name)};">${name.charAt(0).toUpperCase()}</div>
              ${name}
            </div>`).join('')}
          </div>
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

  _bind(id, key, type) {
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
