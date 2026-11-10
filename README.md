# Russtum Cards

Custom Lovelace cards for Home Assistant.

## Installation

Install via [HACS](https://hacs.xyz) by adding this repository as a custom frontend repository, then add the resource:

```yaml
url: /hacsfiles/russtum-cards/russtum-cards.js
type: module
```

---

## nas-card

Displays NAS drive bays with live/dead status, a drive health bar, temperature, uptime, and network link status.

### Minimal config

```yaml
type: custom:nas-card
title: My NAS
total_drives: 8
drives:
  - entity: sensor.nas_drive_1_status
  - entity: sensor.nas_drive_2_status
```

### Full config

```yaml
type: custom:nas-card
title: My NAS

# Total number of drive bays to display (empty slots fill remaining space)
total_drives: 8

# States that count as a live/healthy drive (default: active, on)
live_states:
  - active
  - on

# NAS status entity — drives the NAS icon color
# If omitted, icon color is based on drive health percentage instead
status_entity: sensor.nas_status
status_ok_states:           # default: online, running, active, ok, on, healthy
  - online
  - running
status_warn_states:         # default: degraded, warning, degrading
  - degraded
  - warning

# Drive list — each entry needs at least an entity
drives:
  - entity: sensor.nas_drive_1_status
    name: Bay 1              # optional, defaults to entity name
  - entity: sensor.nas_drive_2_status
    name: Bay 2
  - entity: sensor.nas_drive_3_status
    name: Bay 3
  - entity: sensor.nas_drive_4_status
    name: Bay 4

# Temperature sensor
temperature_entity: sensor.nas_cpu_temp
temperature_warn: 60        # °C — turns orange (default: 60)
temperature_high: 75        # °C — turns red (default: 75)

# Uptime — accepts seconds (numeric) or an ISO datetime string
uptime_entity: sensor.nas_uptime

# Network interfaces — displayed as pills in the card header
network_live_states:        # states that count as link-up (default: on, connected, up)
  - on
  - connected
  - up
network_interfaces:
  - entity: sensor.nas_eth0_link
    name: eth0
  - entity: sensor.nas_eth1_link
    name: eth1
```

### Drive icon states

| State | Colour | Meaning |
|---|---|---|
| Live (`live_states`) | Green | Drive active |
| Any other state | Red | Drive dead / failed |
| `unavailable` / `unknown` | Orange | State unknown |
| `empty` (no entity) | Grey | Empty bay |

---

## ups-card

Displays UPS status, battery level, runtime remaining, and load for NUT-integrated devices.

### Minimal config

```yaml
type: custom:ups-card
title: Server UPS
status_entity: sensor.ups_status_data
battery_entity: sensor.ups_battery_charge
```

### Full config

```yaml
type: custom:ups-card
title: Server UPS

# NUT status entity (e.g. "OL", "OL CHRG", "OB LB")
status_entity: sensor.ups_status_data

# Battery charge percentage (0–100)
battery_entity: sensor.ups_battery_charge

# Runtime remaining in seconds — shown in header top-right
runtime_entity: sensor.ups_battery_runtime

# Load percentage (0–100)
load_entity: sensor.ups_load

# Thresholds (optional)
battery_low_threshold: 20   # % — battery bar turns red below this (default: 20)
load_warn_threshold: 80     # % — load bar turns red above this (default: 80)
```

### NUT status codes

Compound status strings like `"OL CHRG"` are parsed automatically — the most critical code takes priority.

| Code | Label | Colour |
|---|---|---|
| `OL` | Online | Green |
| `OB` | On Battery | Orange |
| `LB` | Low Battery | Red |
| `RB` | Replace Battery | Red |
| `CHRG` | Charging | Blue |
| `DISCHRG` | Discharging | Orange |
| `BYPASS` | Bypass | Orange |
| `CAL` | Calibrating | Blue |
| `OFF` | Offline | Grey |
| `OVER` | Overloaded | Red |
| `TRIM` | Trimming Voltage | Orange |
| `BOOST` | Boosting Voltage | Orange |
| `FSD` | Forced Shutdown | Red |

---

## media-server-card

Displays Radarr/Sonarr queue and library counts, disk space, Jellyfin active clients, and qBittorrent transfer speeds/totals.

### Minimal config

```yaml
type: custom:media-server-card
title: Media Server
radarr_movies_entity: sensor.radarr_movie_count
sonarr_series_entity: sensor.sonarr_series_count
```

### Full config

```yaml
type: custom:media-server-card
title: Media Server

# Radarr
radarr_movies_entity: sensor.radarr_movie_count   # total movies in library
radarr_queue_entity: sensor.radarr_queue_count     # items currently downloading

# Sonarr
sonarr_series_entity: sensor.sonarr_series_count  # total series in library
sonarr_queue_entity: sensor.sonarr_queue_count     # items currently downloading

# Disk space
# Set the total as a static value (preferred)
disk_free_entity: sensor.nas_disk_free
disk_total: 10.9          # static number — no entity needed
disk_total_unit: TB       # B / KB / MB / GB / TB / GiB / TiB (default: TB)
# Option B — provide a used-% entity instead (0–100)
disk_used_pct_entity: sensor.nas_disk_usage_percent

# Jellyfin — active client count shown as a badge in the header
jellyfin_clients_entity: sensor.jellyfin_active_clients

# qBittorrent
qbit_download_speed_entity: sensor.qbittorrent_download_speed
qbit_upload_speed_entity: sensor.qbittorrent_upload_speed
qbit_download_total_entity: sensor.qbittorrent_all_time_download
qbit_upload_total_entity: sensor.qbittorrent_all_time_upload
```

All sections are optional — omit any entity and that section is hidden. Speed and storage values are auto-scaled (B → KB → MB → GB → TB) based on the entity's `unit_of_measurement` attribute.

### Queue colour

| Queue value | Colour |
|---|---|
| 0 | Green |
| > 0 | Orange |

---

## minecraft-card

Displays Minecraft server status, player count, latency, version, MOTD, and an online player list.

Works with the [Minecraft Server integration](https://www.home-assistant.io/integrations/minecraft_server/) or any custom integration that exposes server data as sensors.

### Minimal config

```yaml
type: custom:minecraft-card
title: Russell's Minecraft Server
status_entity: binary_sensor.minecraft_server_status
players_entity: sensor.minecraft_server_players_online
```

### Full config

```yaml
type: custom:minecraft-card
title: Russell's Minecraft Server

# Icon shown in the header (default: mdi:minecraft)
icon: mdi:minecraft

# Server online/offline — binary_sensor (on/off) or a text sensor
status_entity: binary_sensor.minecraft_server_status

# States that count as online for text sensors (default: on, true, online, connected)
online_states:
  - on
  - connected

# Current player count
players_entity: sensor.minecraft_server_players_online

# Maximum player slots (optional — shows "2 / 20" format when set)
max_players_entity: sensor.minecraft_server_players_max

# Latency in ms — shown as a signal icon top-right (optional)
latency_entity: sensor.minecraft_server_latency

# Server version string e.g. "Paper 1.21.11" (optional)
version_entity: sensor.minecraft_server_edition

# Message of the Day — shown as a subtitle below the server name (optional)
motd_entity: sensor.minecraft_server_motd

# Player list — JSON array ["Steve","Alex"] or comma-separated string (optional)
# Shows player chips with colour-coded avatars when online
player_list_entity: sensor.minecraft_server_players_list
```

### Features

- **Pulsing green dot** when online, red when offline
- **Latency signal icon** with colour coding: green ≤30ms, blue ≤80ms, orange ≤150ms, red >150ms
- **Player chips** with deterministic avatar colours based on username — only shown when server is online and list is non-empty
- **Accent bar** at the bottom of the header changes colour with server state (green/red/grey)

---

## Printer Card

A picture of a colour laser all-in-one with live toner levels in its front window, the printer status on its screen, and warnings drawn on the part that needs attention (door, paper tray, output slot). Page counts and part life sit below.

Built for the [Brother integration](https://www.home-assistant.io/integrations/brother/), but works with any printer whose entity IDs end the same way (or set each entity by hand).

```yaml
type: custom:printer-card
device_id: <pick the printer in the visual editor>
# or, without a device:
entity_prefix: mfc_l3780cdw   # finds sensor.mfc_l3780cdw_black_toner, etc.

# Optional
title: Office Printer         # defaults to the device name
toner_low: 15                 # toner % that counts as low (default 15)
part_low: 20                  # drum / belt / fuser % that counts as low (default 20)
hide_pages: false
hide_parts: false
black_toner_entity: sensor.x  # override any entity: <key>_entity
```

### Features

- **Toner window** — C/M/Y/K levels fill from the bottom; a low cartridge pulses red
- **Screen** shows the printer status and message (Idle · Sleep, Printing, Error…), coloured by state, with a paper sheet feeding out while printing
- **Problem overlays** — door open, paper jam and no paper are drawn on the printer itself
- **Page tiles** — B/W, colour, duplex and total pages
- **Part life** — all four drums in one row, belt unit, fuser and paper feed kit
- **Alert chips** in the header, or "No issues" when everything is fine

---

## Active Media Card

Shows only the media players that are doing something, with artwork, a live progress bar and play/skip/volume controls. When nothing plays it shrinks to one line, or hides.

```yaml
type: custom:active-media-card
title: Now Playing
hide_when_empty: false
players:
  - entity: media_player.family_room_apple_tv
    name: Family Room
  - entity: media_player.russells_bedroom
    name: Sonos Beam
    hide_paused: true
    hide_when_active: [media_player.xboxone, media_player.russell_bedroom_tv]
```

---

## Security Overview Card

Alarm state, locks, doors and windows, motion and leaks in one card. Sensors are grouped by device class; motion tiles glow when active and fade over two hours. A **Batteries** tab finds each sensor's battery from its device. `compact: true` shows only what needs attention, for the Home page.

```yaml
type: custom:security-card
alarm_entity: alarm_control_panel.alarmo
locks: [lock.touchscreen_deadbolt_z_wave_plus]
sensors:
  - entity: binary_sensor.konnected_front_door_zone_1
    name: Front Door
  - entity: binary_sensor.kitchen_motion
    name: Kitchen
compact: false
recent_minutes: 5
```

---

## Parcel Card

Packages from the Parcel integration with a carrier badge, a four-step progress track, the latest scan and the expected delivery day. Tap a package for its history and to copy the tracking number.

```yaml
type: custom:parcel-card
entity: sensor.parcel_raw_shipment_data
show_delivered: false
hide_when_empty: true
```

---

## Flight Card

Tracked Flightradar24 flights: origin and destination with flags, the plane drawn at its real position along the route, and altitude, speed and arrival time (flagged when running late).

```yaml
type: custom:flight-card
entity: sensor.flightradar24_additional_tracked
units: both                  # both | metric | imperial
clear_entity: button.flightradar24_clear_additional_tracked
hide_when_empty: true
```

---

## EV Charger Card

The home charger and the car together: an animated charger → car link while energy flows, the car's battery with its charge limit, when it will be full, and power / today / this month / current-limit tiles (with +/-).

```yaml
type: custom:ev-charger-card
title: Corbett Home EV Charger
charger_entity: switch.corbett_ev
status_entity: sensor.garage_corbett_ev_status
power_entity: sensor.corbett_ev_power_minute_average
energy_today_entity: sensor.corbett_ev_energy_today
energy_month_entity: sensor.corbett_ev_energy_this_month
current_limit_entity: number.garage_corbett_ev_current_limit
vehicle_name: Kona EV
battery_entity: sensor.kona_ev_ev_battery_level
range_entity: sensor.kona_ev_ev_range
charge_limit_entity: number.kona_ev_ac_charging_limit
charging_entity: binary_sensor.kona_ev_ev_battery_charge
plug_entity: binary_sensor.kona_ev_ev_battery_plug
completion_entity: sensor.kona_charge_completed_time
duration_entity: sensor.kona_ev_estimated_charge_duration
```

---

## Battery Card

Every device tracked by [Battery Notes](https://github.com/andrew-codechimp/HA-Battery-Notes), found automatically: level, battery type and quantity, and how long since it was replaced, lowest first. A shopping list names the batteries to buy for the low ones, and **Replaced** (tap twice) marks a swap.

```yaml
type: custom:battery-card
sort: level          # level | replaced | name
only_low: false
exclude: [Kitchen Pico]
```

---

## Komodo Card

Every server Komodo manages, found automatically: a status light, active alerts (disk, memory, CPU…), CPU / memory / disk ring gauges with free space, and load. Servers with problems sort first.

```yaml
type: custom:komodo-card
warn: 80
critical: 90
exclude: [Homepage]      # optional
```

---

## Service Status Card

A status page. Every Uptime Kuma monitor is included automatically; add UptimeRobot, Ping or any other up/down sensor under `extra`. Each row has a status light, response time, a 24-hour history bar from Home Assistant's recorder, uptime (hover for 30-day and 1-year) and certificate expiry warnings.

```yaml
type: custom:service-status-card
title: Services
groups:
  - name: Self-hosted
    monitors: [Home Assistant, My Website, Jellyfin, Jellyseerr]
  - name: Internet
    monitors: [Google, Amazon, Cloudflare, Microsoft, Oracle, Bell]
extra:
  - entity: binary_sensor.minecraftmap_russellcorbett_ca
    name: Minecraft Map
    group: Self-hosted
```

---

## Home Assistant Health Card

A checklist for Home Assistant itself: backups (age, size, next run, failures), pending updates (core, add-ons, HACS, blueprints), Spook repairs, Watchman's missing entities with where they're referenced, and CPU / memory / disk / uptime. Everything is detected automatically.

```yaml
type: custom:ha-health-card
backup_max_age: 26     # hours
```

---

## Development

Edit the cards in `src/` and push to `master`. The **Build bundle** GitHub Action rebuilds `russtum-cards.js` from `src/` and commits it for you, so don't edit the bundle by hand. Run `git pull` before your next push to pick up that commit.

To build locally instead (for testing before you push):

```bash
./build.sh
```
