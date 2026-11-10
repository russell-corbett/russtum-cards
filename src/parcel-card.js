/**
 * Parcel Card for Home Assistant (Parcel app integration)
 *
 * Every package on its way, each with a carrier badge, a four-step progress
 * track (ordered → in transit → out for delivery → delivered), the latest
 * scan, and the expected delivery day. Tap a package to see its full history.
 *
 * Configuration:
 *   type: custom:parcel-card
 *   entity: sensor.parcel_raw_shipment_data   # sensor with a "deliveries" attribute
 *   title: Packages
 *   show_delivered: false     # Also list delivered packages
 *   max_items: 10
 *   hide_when_empty: false
 */

// Parcel API status codes
const PA_STATUS = {
  0: { label: 'Delivered',        step: 3, tone: 'ok',    icon: 'mdi:package-variant-closed-check' },
  1: { label: 'No recent updates', step: 1, tone: 'muted', icon: 'mdi:package-variant-closed' },
  2: { label: 'In transit',       step: 1, tone: 'info',  icon: 'mdi:truck-fast-outline' },
  3: { label: 'Ready for pickup', step: 2, tone: 'warn',  icon: 'mdi:store-marker-outline' },
  4: { label: 'Out for delivery', step: 2, tone: 'info',  icon: 'mdi:truck-delivery-outline' },
  5: { label: 'Not found',        step: 0, tone: 'error', icon: 'mdi:package-variant-remove' },
  6: { label: 'Delivery attempt failed', step: 2, tone: 'error', icon: 'mdi:home-alert-outline' },
  7: { label: 'Exception',        step: 1, tone: 'error', icon: 'mdi:alert-circle-outline' },
  8: { label: 'Label created',    step: 0, tone: 'muted', icon: 'mdi:label-outline' },
};
const PA_STEPS = ['Ordered', 'In transit', 'Out for delivery', 'Delivered'];
const PA_CARRIERS = {
  ups: 'UPS', fedex: 'FedEx', usps: 'USPS', dhl: 'DHL', cp: 'Canada Post', pur: 'Purolator', purolator: 'Purolator',
  amzl: 'Amazon', amzlca: 'Amazon', amzluk: 'Amazon', canpar: 'Canpar', icl: 'Intelcom', intelcom: 'Intelcom',
  dicom: 'Dicom', gls: 'GLS', ontrac: 'OnTrac', lasership: 'LaserShip', apple: 'Apple', uniuni: 'UniUni', pholder: 'Manual',
};

const paEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function paDay(d) {
  if (!d || isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return that.toLocaleDateString(undefined, { weekday: 'long' });
  return that.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function paParseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

class ParcelCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._open = new Set();
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
  }

  setConfig(config) {
    if (!config?.entity) throw new Error('Set "entity" to the Parcel sensor that has a deliveries attribute');
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (old && old.states[this._config.entity] === hass.states[this._config.entity]) return;
    this._render();
  }

  _deliveries() {
    const st = this._hass?.states[this._config.entity];
    const list = st?.attributes?.[this._config.attribute || 'deliveries'];
    return Array.isArray(list) ? list : [];
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    let list = this._deliveries();
    if (!cfg.show_delivered) list = list.filter((d) => Number(d.status_code) !== 0);
    // Out for delivery first, then by expected date.
    const order = { 4: 0, 6: 1, 3: 2, 7: 3, 2: 4, 8: 5, 1: 6, 5: 7, 0: 8 };
    list = [...list].sort((a, b) => (order[a.status_code] ?? 9) - (order[b.status_code] ?? 9)
      || (paParseDate(a.timestamp_expected ?? a.date_expected) || Infinity) - (paParseDate(b.timestamp_expected ?? b.date_expected) || Infinity));
    list = list.slice(0, cfg.max_items ?? 10);

    const empty = !list.length;
    this.style.display = empty && cfg.hide_when_empty ? 'none' : '';
    const outToday = list.filter((d) => Number(d.status_code) === 4).length;

    const rows = list.map((d) => {
      const code = Number(d.status_code);
      const s = PA_STATUS[code] || { label: 'Unknown', step: 1, tone: 'muted', icon: 'mdi:package-variant' };
      const id = d.tracking_number || d.description;
      const open = this._open.has(id);
      const carrier = PA_CARRIERS[(d.carrier_code || '').toLowerCase()] || (d.carrier_code || '').toUpperCase();
      const events = Array.isArray(d.events) ? d.events : [];
      const latest = events[0];
      const exp = paParseDate(d.timestamp_expected ?? d.date_expected);
      const expEnd = paParseDate(d.timestamp_expected_end ?? d.date_expected_end);
      const expText = code === 0 ? '' : exp ? `Arrives ${paDay(exp)}${expEnd && paDay(expEnd) !== paDay(exp) ? `–${paDay(expEnd)}` : ''}` : '';
      const latestDate = latest && paParseDate(latest.date);

      return `
        <div class="pkg ${s.tone}" data-act="toggle" data-id="${paEsc(id)}">
          <div class="top">
            <div class="pi"><ha-icon icon="${s.icon}"></ha-icon></div>
            <div class="pb">
              <div class="pn">${paEsc(d.description || d.tracking_number || 'Package')}</div>
              <div class="pm"><span class="carrier">${paEsc(carrier)}</span><span class="pill">${s.label}</span>${expText ? `<span class="exp">${paEsc(expText)}</span>` : ''}</div>
            </div>
            <ha-icon class="chev ${open ? 'up' : ''}" icon="mdi:chevron-down"></ha-icon>
          </div>
          <div class="track">
            ${PA_STEPS.map((label, i) => `<div class="step ${i <= s.step ? 'done' : ''} ${i === s.step ? 'cur' : ''}" title="${label}"></div>`).join('')}
          </div>
          ${latest ? `<div class="last"><ha-icon icon="mdi:map-marker-outline"></ha-icon>
            <span>${paEsc(latest.event)}${latest.location ? ` · ${paEsc(latest.location)}` : ''}</span>
            <span class="when">${latestDate ? paEsc(paDay(latestDate)) : paEsc(latest.date || '')}</span></div>` : ''}
          ${open ? `
            <div class="more">
              ${d.tracking_number ? `<div class="tn"><span>${paEsc(d.tracking_number)}</span>
                <button data-act="copy" data-v="${paEsc(d.tracking_number)}" title="Copy tracking number"><ha-icon icon="mdi:content-copy"></ha-icon></button></div>` : ''}
              ${d.extra_information ? `<div class="extra">${paEsc(d.extra_information)}</div>` : ''}
              <div class="events">${events.slice(0, 8).map((e) => `
                <div class="ev"><div class="dot"></div><div><div>${paEsc(e.event)}</div>
                <div class="evm">${paEsc([e.location, e.date].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<div class="evm">No tracking events yet</div>'}
              </div>
            </div>` : ''}
        </div>`;
    }).join('');

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: ${empty ? '12px 16px' : '14px'}; }
        .head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; }
        .title { flex: 1; font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); }
        .badge { font-size: .75em; font-weight: 600; padding: 2px 9px; border-radius: 10px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
        .badge.hot { background: rgba(3,169,244,.16); color: var(--primary-color,#03a9f4); }
        .empty { display: flex; align-items: center; gap: 10px; color: var(--secondary-text-color); font-size: .9em; --mdc-icon-size: 20px; }
        .list { display: flex; flex-direction: column; gap: 8px; }

        .pkg { border-radius: 12px; padding: 10px 12px; cursor: pointer; background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .top { display: flex; align-items: center; gap: 10px; }
        .pi { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 22px;
              background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .info .pi { background: rgba(3,169,244,.16); color: var(--primary-color,#03a9f4); }
        .ok .pi   { background: rgba(76,175,80,.16); color: var(--success-color,#4caf50); }
        .warn .pi { background: rgba(255,152,0,.16); color: var(--warning-color,#ff9800); }
        .error .pi{ background: rgba(244,67,54,.16); color: var(--error-color,#f44336); }
        .pb { flex: 1; min-width: 0; }
        .pn { font-size: .95em; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pm { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 2px; font-size: .75em; color: var(--secondary-text-color); }
        .carrier { font-weight: 700; letter-spacing: .02em; }
        .pill { font-weight: 600; }
        .info .pill { color: var(--primary-color,#03a9f4); } .ok .pill { color: var(--success-color,#4caf50); }
        .warn .pill { color: var(--warning-color,#ff9800); } .error .pill { color: var(--error-color,#f44336); }
        .exp::before { content: '·'; margin-right: 6px; }
        .chev { color: var(--secondary-text-color); transition: transform .2s; --mdc-icon-size: 20px; }
        .chev.up { transform: rotate(180deg); }

        .track { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 10px 0 6px; }
        .step { height: 4px; border-radius: 2px; background: rgba(127,127,127,.25); }
        .step.done { background: var(--primary-color,#03a9f4); }
        .ok .step.done { background: var(--success-color,#4caf50); }
        .error .step.cur { background: var(--error-color,#f44336); }
        .info .step.cur { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: .4; } }

        .last { display: flex; align-items: center; gap: 5px; font-size: .78em; color: var(--secondary-text-color); --mdc-icon-size: 14px; }
        .last span:first-of-type { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .when { flex-shrink: 0; }

        .more { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--divider-color, rgba(127,127,127,.2)); cursor: default; }
        .tn { display: flex; align-items: center; gap: 6px; font-family: monospace; font-size: .85em; color: var(--primary-text-color); }
        .tn button { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 50%; color: var(--secondary-text-color); line-height: 0; --mdc-icon-size: 16px; }
        .tn button:hover { background: rgba(127,127,127,.2); }
        .extra { font-size: .78em; color: var(--secondary-text-color); margin-top: 4px; }
        .events { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; font-size: .8em; color: var(--primary-text-color); }
        .ev { display: flex; gap: 10px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; background: rgba(127,127,127,.5); }
        .ev:first-child .dot { background: var(--primary-color,#03a9f4); }
        .evm { color: var(--secondary-text-color); font-size: .92em; }
      </style>
      <ha-card>
        ${empty
          ? `<div class="empty"><ha-icon icon="mdi:package-variant-closed"></ha-icon>${paEsc(cfg.empty_text || 'No packages on the way')}</div>`
          : `<div class="head"><div class="title">${paEsc(cfg.title || 'Packages')}</div>
               ${outToday ? `<span class="badge hot">${outToday} out for delivery</span>` : `<span class="badge">${list.length}</span>`}</div>
             <div class="list">${rows}</div>`}
      </ha-card>`;
    if (html === this._lastHtml) return;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
  }

  _onClick(ev) {
    const copy = ev.target.closest('[data-act="copy"]');
    if (copy) {
      ev.stopPropagation();
      navigator.clipboard?.writeText(copy.dataset.v).catch(() => {});
      copy.querySelector('ha-icon')?.setAttribute('icon', 'mdi:check');
      return;
    }
    if (ev.target.closest('.more')) return;
    const row = ev.target.closest('[data-act="toggle"]');
    if (!row) return;
    const id = row.dataset.id;
    if (this._open.has(id)) this._open.delete(id); else this._open.add(id);
    this._render();
  }

  getCardSize() { return 3; }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('parcel-card-editor');
  }

  static getStubConfig(hass) {
    const id = Object.keys(hass?.states || {}).find((e) => Array.isArray(hass.states[e].attributes?.deliveries));
    return { entity: id || 'sensor.parcel_raw_shipment_data', title: 'Packages' };
  }
}

customElements.define('parcel-card', ParcelCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'parcel-card',
  name: 'Parcel Card',
  description: 'Packages on the way, with delivery progress and tracking history.',
  preview: false,
});

class ParcelCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'General', icon: 'mdi:package-variant', schema: [
        f.entity('entity', 'Parcel sensor', 'The sensor with a "deliveries" attribute', 'sensor'),
        f.text('title', 'Title'),
        f.grid(f.number('max_items', 'Show at most', { min: 1, max: 50, helper: 'Default: 10' }), f.text('empty_text', 'Text when empty')),
        f.grid(f.toggle('show_delivered', 'Include delivered'), f.toggle('hide_when_empty', 'Hide card when empty')),
      ] },
    ];
  }
}

customElements.define('parcel-card-editor', ParcelCardEditor);
