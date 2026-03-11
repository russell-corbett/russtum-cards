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

Displays NAS drive bays with live/dead status, a drive grid, and a health bar.

```yaml
type: custom:nas-card
title: My NAS
total_drives: 8
live_states:
  - active
  - on
drive_entity_prefix: sensor.nas_drive_
drive_entity_suffix: _status
# Optional explicit list (merged with prefix auto-discovery):
drives:
  - entity: sensor.nas_drive_1_status
    name: Bay 1
```

---

## ups-card

Displays UPS status, battery level, runtime remaining, and load for NUT-integrated devices.

```yaml
type: custom:ups-card
title: Server UPS
status_entity: sensor.ups_status_data
battery_entity: sensor.ups_battery_charge
runtime_entity: sensor.ups_battery_runtime   # value in seconds
load_entity: sensor.ups_load
battery_low_threshold: 20   # optional, default 20
load_warn_threshold: 80     # optional, default 80
```

NUT status codes supported: `OL`, `OB`, `LB`, `RB`, `CHRG`, `DISCHRG`, `BYPASS`, `CAL`, `OFF`, `OVER`, `TRIM`, `BOOST`, `FSD`.
