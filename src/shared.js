/**
 * Russtum Cards — small runtime helpers shared by several cards.
 *
 *   RusstumShared.color('blue')      → { rgb, solid }  CSS for a named colour or hex
 *   RusstumShared.act(el, hass, action, entity)        run a tap_action
 *
 * Colours: named colours use HA's theme variables (--rgb-blue-color …) so
 * themes can restyle them, with Material fallbacks when a theme doesn't set
 * them. `rgb` is an "r, g, b" triplet for rgba(); `special` flags white and
 * black, which need an outline to stay visible on light / dark themes.
 *
 * Loaded after editor-kit.js and before any card (build.sh).
 */
(() => {
  if (window.RusstumShared) return;

  const NAMED = {
    blue: '33, 150, 243', red: '244, 67, 54', yellow: '255, 235, 59', green: '76, 175, 80',
    purple: '156, 39, 176', pink: '233, 30, 99', teal: '0, 150, 136', orange: '255, 152, 0',
    grey: '158, 158, 158', white: '255, 255, 255', black: '0, 0, 0',
    amber: '255, 193, 7', cyan: '0, 188, 212', indigo: '63, 81, 181', 'light-blue': '3, 169, 244',
    'light-green': '139, 195, 74', lime: '205, 220, 57', 'deep-orange': '255, 87, 34',
    'deep-purple': '103, 58, 183', brown: '121, 85, 72',
  };
  const ALIAS = { gray: 'grey' };

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
  }

  function color(input, fallback = 'blue') {
    const raw = String(input ?? '').trim().toLowerCase();
    const name = ALIAS[raw] || raw;
    if (NAMED[name]) {
      return {
        rgb: `var(--rgb-${name}-color, ${NAMED[name]})`,
        special: name === 'white' || name === 'black' ? name : null,
      };
    }
    if (raw.startsWith('#')) {
      const rgb = hexToRgb(raw);
      if (rgb) {
        const [r, g, b] = rgb.split(',').map(Number);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return { rgb, special: lum > 0.92 ? 'white' : lum < 0.08 ? 'black' : null };
      }
    }
    if (raw) console.warn(`russtum-cards: unknown colour "${input}", using ${fallback}`);
    return color(fallback, 'blue');
  }

  // Names for colour pickers in the visual editors.
  const COLOR_OPTIONS = ['blue', 'red', 'yellow', 'green', 'purple', 'pink', 'teal', 'orange', 'white', 'black', 'grey']
    .map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));

  // The tap_action subset HA's own cards support most often.
  function act(el, hass, a, entity) {
    a = a || {};
    switch (a.action) {
      case 'navigate':
        if (!a.navigation_path) return;
        history.pushState(null, '', a.navigation_path);
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: !!a.navigation_replace } }));
        return;
      case 'url':
        if (a.url_path) window.open(a.url_path, '_blank', 'noopener');
        return;
      case 'toggle':
        hass.callService('homeassistant', 'toggle', { entity_id: a.entity || entity });
        return;
      case 'perform-action':
      case 'call-service': {
        const [d, s] = String(a.perform_action || a.service || '').split('.');
        if (d && s) hass.callService(d, s, a.data || a.service_data || {}, a.target);
        return;
      }
      case 'more-info':
        el.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: a.entity || entity }, bubbles: true, composed: true }));
        return;
      case 'none':
      default:
    }
  }

  window.RusstumShared = { color, COLOR_OPTIONS, act };
})();
