/**
 * Russtum Cards — shared visual-editor toolkit.
 *
 * Every card editor is built from HA's own <ha-form>, the same element HA's
 * built-in card editors use. That gives real entity pickers (search +
 * autocomplete), icon pickers, number boxes and integration dropdowns, and
 * it keeps working when HA changes its internal text-field elements.
 *
 * A card's editor is a subclass that only describes its sections:
 *
 *   class MyCardEditor extends RusstumEditor {
 *     _sections() {
 *       return [
 *         { title: 'General', icon: 'mdi:cog', schema: [ ...ha-form schema ] },
 *         { title: 'Drives',  icon: 'mdi:harddisk', schema: [...],
 *           list: {
 *             key: 'drives',                       // config array
 *             schema: [...],                       // ha-form schema per item
 *             label: (item, i) => item.name || `Drive ${i + 1}`,
 *             newItem: () => ({}),
 *             addLabel: 'Add drive',
 *             collapsible: false,                  // true = each item folds
 *             nested: { ...another list spec },    // e.g. disks inside devices
 *           } },
 *       ];
 *     }
 *   }
 *
 * Schema items may also carry `label` and `helper` strings.
 * Must be loaded before any card file (build.sh puts it first).
 */
(() => {
  if (window.RusstumEditor) return;

  // ── Make sure <ha-form> is defined ─────────────────────────────────────────
  // HA lazy-loads its form elements. Opening a built-in card's editor once
  // forces them to load; the entity card's editor uses ha-form.
  let formReady = null;
  function ensureHaForm() {
    if (customElements.get('ha-form')) return Promise.resolve();
    if (!formReady) {
      formReady = (async () => {
        try {
          const helpers = await window.loadCardHelpers?.();
          const card = await helpers?.createCardElement({ type: 'entity', entity: 'sun.sun' });
          await card?.constructor?.getConfigElement?.();
        } catch (e) {
          console.warn('russtum-cards: could not preload ha-form', e);
        }
        // Never block the editor forever if HA changes how it loads forms.
        await Promise.race([
          customElements.whenDefined('ha-form'),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      })();
    }
    return formReady;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
  const isEmpty = (v) => v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0);

  // Drop empty values so cleared fields disappear from the YAML.
  function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) if (!isEmpty(v)) out[k] = v;
    return out;
  }

  function getIn(obj, path) {
    return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setIn(obj, path, value) {
    const root = clone(obj) || {};
    let o = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (o[k] == null) o[k] = typeof path[i + 1] === 'number' ? [] : {};
      o = o[k];
    }
    const last = path[path.length - 1];
    if (isEmpty(value)) {
      if (Array.isArray(o)) o[last] = value; else delete o[last];
    } else {
      o[last] = value;
    }
    return root;
  }

  // Field names a schema edits (grids nest their fields one level down).
  function fieldNames(schema, out = []) {
    for (const s of schema || []) {
      if (s.schema) fieldNames(s.schema, out);
      else if (s.name) out.push(s.name);
    }
    return out;
  }

  // Take only this form's own fields from the value ha-form hands back,
  // so a form can never overwrite data that other forms or lists changed.
  function pick(value, schema) {
    const out = {};
    for (const n of fieldNames(schema)) out[n] = value?.[n];
    return out;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const STYLE = `
    :host { display: block; }
    .section {
      border: 1px solid var(--divider-color, rgba(0,0,0,.12));
      border-radius: 12px;
      margin-bottom: 12px;
      background: var(--card-background-color, transparent);
      overflow: hidden;
    }
    .section > summary, .item > summary {
      list-style: none;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .section > summary::-webkit-details-marker,
    .item > summary::-webkit-details-marker { display: none; }
    .section > summary { padding: 14px 16px; font-weight: 500; font-size: 1em; color: var(--primary-text-color); }
    .section > summary .s-icon { color: var(--secondary-text-color); --mdc-icon-size: 22px; }
    .section > summary .s-title { flex: 1; }
    .badge {
      font-size: .75em; font-weight: 600; min-width: 20px; text-align: center;
      padding: 2px 7px; border-radius: 10px;
      background: var(--secondary-background-color, rgba(0,0,0,.06));
      color: var(--secondary-text-color);
    }
    .chev { color: var(--secondary-text-color); transition: transform .2s; --mdc-icon-size: 20px; }
    details[open] > summary .chev { transform: rotate(180deg); }
    .body { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }

    .list { display: flex; flex-direction: column; gap: 8px; }
    .item {
      border: 1px solid var(--divider-color, rgba(0,0,0,.12));
      border-radius: 10px;
      background: var(--secondary-background-color, rgba(0,0,0,.03));
    }
    .item > summary, .item > .head { padding: 6px 6px 6px 12px; display: flex; align-items: center; gap: 8px; }
    .item .i-label {
      flex: 1; min-width: 0; font-size: .9em; font-weight: 500; color: var(--primary-text-color);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .item .i-label.placeholder { color: var(--secondary-text-color); font-style: italic; font-weight: 400; }
    .item .i-body { padding: 4px 12px 12px; display: flex; flex-direction: column; gap: 12px; }
    .item .item { background: var(--card-background-color, transparent); }
    .sub-title {
      font-size: .78em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
      color: var(--secondary-text-color); margin-top: 4px;
    }

    .icon-btn {
      background: none; border: none; cursor: pointer; padding: 6px; border-radius: 50%;
      color: var(--secondary-text-color); display: inline-flex; line-height: 0;
      --mdc-icon-size: 20px;
    }
    .icon-btn:hover { background: rgba(127,127,127,.15); color: var(--primary-text-color); }
    .icon-btn.danger:hover { color: var(--error-color, #f44336); background: rgba(244,67,54,.1); }
    .icon-btn[disabled] { opacity: .3; pointer-events: none; }

    .add-btn {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; padding: 10px; border-radius: 10px; cursor: pointer;
      background: none; border: 1px dashed var(--primary-color, #03a9f4);
      color: var(--primary-color, #03a9f4); font: inherit; font-size: .9em; font-weight: 500;
      --mdc-icon-size: 18px;
    }
    .add-btn:hover { background: rgba(3,169,244,.08); }
    .empty { font-size: .85em; color: var(--secondary-text-color); font-style: italic; padding: 4px 2px; }
    .loading { padding: 16px; color: var(--secondary-text-color); font-size: .9em; }
  `;

  class RusstumEditor extends HTMLElement {
    static ensureHaForm() { return ensureHaForm(); }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config = {};
      this._configStr = '';
      this._hass = null;
      this._forms = [];
      this._open = {};       // remembered open/closed state of sections & items
    }

    /** Subclasses return their section list. */
    _sections() { return []; }

    setConfig(config) {
      const incoming = JSON.stringify(config);
      if (incoming === this._configStr) return;  // our own change echoed back
      this._configStr = incoming;
      this._config = clone(config) || {};
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      for (const f of this._forms) f.hass = hass;
    }

    _fire(config) {
      this._config = config;
      this._configStr = JSON.stringify(config);
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config }, bubbles: true, composed: true,
      }));
    }

    _form(schema, data, onChange) {
      const form = document.createElement('ha-form');
      form.computeLabel = (s) => s.label ?? s.name;
      form.computeHelper = (s) => s.helper;
      form.hass = this._hass;
      form.data = data;
      form.schema = schema;
      form.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        form.data = ev.detail.value;   // ha-form expects the parent to feed the new data back
        onChange(pick(ev.detail.value, schema));
      });
      this._forms.push(form);
      return form;
    }

    async _render() {
      const token = (this._renderToken = (this._renderToken || 0) + 1);
      if (!customElements.get('ha-form')) {
        this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="loading">Loading editor…</div>`;
        await ensureHaForm();
        if (token !== this._renderToken) return;  // a newer render superseded this one
      }

      this._forms = [];
      const root = document.createElement('div');
      for (const section of this._sections(this._config)) root.appendChild(this._section(section));

      this.shadowRoot.innerHTML = `<style>${STYLE}</style>`;
      this.shadowRoot.appendChild(root);
    }

    _details(cls, key, defaultOpen) {
      const d = document.createElement('details');
      d.className = cls;
      d.open = this._open[key] ?? defaultOpen;
      d.addEventListener('toggle', () => { this._open[key] = d.open; });
      return d;
    }

    _section(section) {
      const key = 's:' + section.title;
      const d = this._details('section', key, section.open ?? true);
      const count = section.list ? (getIn(this._config, [section.list.key]) || []).length : null;
      d.innerHTML = `
        <summary>
          <ha-icon class="s-icon" icon="${esc(section.icon || 'mdi:cog')}"></ha-icon>
          <span class="s-title">${esc(section.title)}</span>
          ${count != null ? `<span class="badge">${count}</span>` : ''}
          <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
        </summary>`;
      const body = document.createElement('div');
      body.className = 'body';

      if (section.schema?.length) {
        body.appendChild(this._form(section.schema, this._config, (value) => {
          const next = clean({ ...this._config, ...value });
          if (JSON.stringify(next) !== this._configStr) this._fire(next);
        }));
      }
      if (section.list) body.appendChild(this._list(section.list, [section.list.key]));

      d.appendChild(body);
      return d;
    }

    _list(spec, path) {
      const wrap = document.createElement('div');
      wrap.className = 'list';
      const items = getIn(this._config, path) || [];

      if (!items.length && spec.emptyText) {
        wrap.insertAdjacentHTML('beforeend', `<div class="empty">${esc(spec.emptyText)}</div>`);
      }

      items.forEach((item, i) => wrap.appendChild(this._item(spec, path, item, i, items.length)));

      const add = document.createElement('button');
      add.className = 'add-btn';
      add.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>${esc(spec.addLabel || 'Add')}`;
      add.addEventListener('click', () => {
        const list = [...(getIn(this._config, path) || []), spec.newItem ? spec.newItem() : {}];
        this._open['i:' + [...path, list.length - 1].join('.')] = true;  // open the new item
        this._structural(setIn(this._config, path, list));
      });
      wrap.appendChild(add);
      return wrap;
    }

    _item(spec, path, item, i, total) {
      const itemPath = [...path, i];
      const labelText = () => {
        const cur = getIn(this._config, itemPath) || {};
        return spec.label ? spec.label(cur, i) : `Item ${i + 1}`;
      };

      const collapsible = !!(spec.collapsible || spec.nested);
      const el = collapsible
        ? this._details('item', 'i:' + itemPath.join('.'), false)
        : Object.assign(document.createElement('div'), { className: 'item' });

      const head = document.createElement(collapsible ? 'summary' : 'div');
      if (!collapsible) head.className = 'head';
      head.innerHTML = `
        <span class="i-label"></span>
        <button class="icon-btn" data-a="up"   title="Move up"   ${i === 0 ? 'disabled' : ''}><ha-icon icon="mdi:arrow-up"></ha-icon></button>
        <button class="icon-btn" data-a="down" title="Move down" ${i === total - 1 ? 'disabled' : ''}><ha-icon icon="mdi:arrow-down"></ha-icon></button>
        <button class="icon-btn danger" data-a="remove" title="Remove"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
        ${collapsible ? '<ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>' : ''}`;
      const labelEl = head.querySelector('.i-label');
      const setLabel = () => {
        const t = labelText();
        labelEl.textContent = t || 'Not set';
        labelEl.classList.toggle('placeholder', !t);
      };
      setLabel();

      head.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', (ev) => {
        ev.preventDefault();   // don't toggle the <details>
        ev.stopPropagation();
        const list = [...(getIn(this._config, path) || [])];
        const a = btn.dataset.a;
        if (a === 'remove') list.splice(i, 1);
        if (a === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        if (a === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
        this._structural(setIn(this._config, path, list));
      }));
      el.appendChild(head);

      const body = document.createElement('div');
      body.className = 'i-body';
      body.appendChild(this._form(spec.schema, item, (value) => {
        const cur = getIn(this._config, itemPath) || {};
        const nextItem = clean({ ...cur, ...value });
        const next = setIn(this._config, itemPath, nextItem);
        if (JSON.stringify(next) !== this._configStr) {
          this._fire(next);
          setLabel();
        }
      }));

      if (spec.nested) {
        body.insertAdjacentHTML('beforeend', `<div class="sub-title">${esc(spec.nested.title || spec.nested.key)}</div>`);
        body.appendChild(this._list(spec.nested, [...itemPath, spec.nested.key]));
      }
      el.appendChild(body);
      return el;
    }

    // Add / remove / reorder: save, then rebuild the editor.
    _structural(config) {
      // Remove now-empty arrays so they don't linger in YAML.
      const cleaned = clean(config);
      this._fire(cleaned);
      this._render();
    }
  }

  // Schema builders so card editors read as a list of fields.
  RusstumEditor.f = {
    text:   (name, label, helper) => ({ name, label, helper, selector: { text: {} } }),
    entity: (name, label, helper, domain) => ({ name, label, helper, selector: { entity: domain ? { domain } : {} } }),
    // Several entities in one picker (stored as an array of entity IDs).
    entities: (name, label, helper, domain) => ({ name, label, helper, selector: { entity: { multiple: true, ...(domain ? { domain } : {}) } } }),
    icon:   (name, label = 'Icon', helper) => ({ name, label, helper, selector: { icon: {} } }),
    number: (name, label, { min, max, step, unit, helper } = {}) => ({
      name, label, helper,
      selector: { number: { mode: 'box', min, max, step, unit_of_measurement: unit } },
    }),
    // A list of state strings: pick from suggestions or type your own.
    states: (name, label, options, helper) => ({
      name, label, helper,
      selector: { select: { multiple: true, custom_value: true, options } },
    }),
    select: (name, label, options, helper) => ({
      name, label, helper,
      selector: { select: { mode: 'dropdown', custom_value: true, options } },
    }),
    // Dropdown of this integration's configured instances; stores the entry_id.
    configEntry: (name, label, integration, helper) => ({
      name, label, helper, selector: { config_entry: { integration } },
    }),
    // Device picker, optionally limited to one integration's devices.
    device: (name, label, integration, helper) => ({
      name, label, helper,
      selector: { device: integration ? { filter: [{ integration }] } : {} },
    }),
    toggle: (name, label, helper) => ({ name, label, helper, selector: { boolean: {} } }),
    grid: (...schema) => ({ type: 'grid', name: '', schema }),
  };

  window.RusstumEditor = RusstumEditor;
})();
