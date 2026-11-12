/**
 * Kitchen Card for Home Assistant
 *
 * Tonight's dinner, the week's meal plan and the shopping list in one card.
 *   • Meals come from meal-plan calendars — Mealie's are found automatically
 *     (calendar.mealie_dinner, _lunch, _side…).
 *   • The shopping list is any to-do list: Grocy, Mealie, HA's Shopping List,
 *     Bring!… Tick items off, add new ones, clear the done ones.
 *   • Print sends the list to a receipt printer through a script or action
 *     (e.g. script.print_receipt with a `message` field).
 *
 * Configuration:
 *   type: custom:kitchen-card
 *   title: Kitchen                         # Optional
 *   meal_calendars:                        # Optional: default = every Mealie calendar
 *     - calendar.mealie_dinner
 *   tonight_calendar: calendar.mealie_dinner   # Optional: which one is "tonight" (default: the dinner one)
 *   days: 7                                # Days of plan shown (default 7, 0 hides the week)
 *   shopping_list: todo.grocy_shopping_list    # Optional: default = first Grocy / Mealie / Shopping List to-do
 *   show_completed: false                  # Keep ticked items in the list (default false)
 *   print_action: script.print_receipt     # Optional: shows a Print button
 *   print_field: message                   # Field the text goes in (default: message)
 *   print_meals: false                     # Also print the week's dinners above the list
 */

const KC_LIST_PLATFORMS = ['grocy', 'mealie', 'shopping_list', 'bring', 'todoist', 'local_todo'];
const kcEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kcDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const kcDate = (v) => {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v);
};

class KitchenCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.addEventListener('click', (ev) => this._onClick(ev));
    this.shadowRoot.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('input.add')) this._addItem(ev.target); });
    this._meals = [];
    this._items = null;
    this._printState = '';
  }

  setConfig(config) {
    if (!config) throw new Error('Invalid configuration');
    const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    this._config = { days: 7, print_field: 'message', ...config, meal_calendars: list(config.meal_calendars) };
    this._resolvedFor = null;
    this._mealsFetched = 0;
    this._unsubscribe();
    this._lastHtml = null;
    this._render();
  }

  connectedCallback() {
    this._clock = setInterval(() => { this._mealsFetched = 0; if (this._hass) this._fetchMeals(); }, 1800000);
    if (this._hass && this._listId && !this._unsub) this._subscribe();
  }

  disconnectedCallback() {
    clearInterval(this._clock);
    this._unsubscribe();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._resolvedFor !== hass.entities) this._resolve();
    const changed = !old || this._calIds.some((id) => hass.states[id] !== old.states[id]);
    if (changed || Date.now() - this._mealsFetched > 1800000) this._fetchMeals();
    if (this._listId && !this._unsub && this.isConnected) this._subscribe();
    if (old && !changed && hass.states[this._listId] === old.states[this._listId]) return;
    this._render();
  }

  _resolve() {
    const h = this._hass, c = this._config, reg = h.entities || {};
    this._resolvedFor = h.entities;
    this._calIds = c.meal_calendars.length ? c.meal_calendars
      : Object.keys(h.states).filter((id) => id.startsWith('calendar.') && reg[id]?.platform === 'mealie');
    this._tonightId = c.tonight_calendar || this._calIds.find((id) => /dinner|supper/i.test(id)) || this._calIds[0];
    // Per platform, prefer a list that looks like a shopping list (Grocy also exposes todo.grocy_tasks).
    const listId = c.shopping_list || KC_LIST_PLATFORMS.map((p) => {
      const ids = Object.keys(h.states).filter((id) => id.startsWith('todo.') && reg[id]?.platform === p);
      return ids.find((id) => /shopping|grocer/i.test(id)) || ids.find((id) => !/task|chore/i.test(id)) || ids[0];
    }).find(Boolean);
    if (listId !== this._listId) { this._unsubscribe(); this._listId = listId; this._items = null; }
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  async _fetchMeals() {
    this._mealsFetched = Date.now();
    if (!this._calIds.length) return;
    const start = kcDay(new Date());
    const end = new Date(start.getTime() + Math.max(1, Number(this._config.days) || 1) * 86400000);
    const q = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
    const results = await Promise.all(this._calIds.map(async (id) => {
      try {
        const evs = await this._hass.callApi('GET', `calendars/${id}?${q}`);
        const kind = String(this._hass.states[id]?.attributes?.friendly_name || id).replace(/^mealie\s*/i, '').replace(/^calendar\.\w*?_/, '');
        return (evs || []).map((e) => ({ cal: id, kind, title: e.summary || '', desc: e.description || '', date: kcDay(kcDate(e.start?.date || e.start?.dateTime)) }));
      } catch (e) { return []; }
    }));
    this._meals = results.flat().filter((m) => m.date && !isNaN(m.date));
    this._lastHtml = null;
    this._render();
  }

  _subscribe() {
    const id = this._listId;
    if (!id || !this._hass?.connection) return;
    this._unsub = this._hass.connection.subscribeMessage((msg) => {
      this._items = msg.items || [];
      this._lastHtml = null;
      this._render();
    }, { type: 'todo/item/subscribe', entity_id: id }).catch(async () => {
      // Older HA: no subscription — fetch once (re-fetched when the list's count changes).
      this._unsub = null;
      try { this._items = (await this._hass.callWS({ type: 'todo/item/list', entity_id: id })).items || []; } catch (e) { this._items = []; }
      this._render();
    });
  }

  _unsubscribe() {
    if (this._unsub) { Promise.resolve(this._unsub).then((u) => typeof u === 'function' && u()).catch(() => {}); }
    this._unsub = null;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  _render() {
    if (!this._config) return;
    if (!this._hass) { this.shadowRoot.innerHTML = '<ha-card></ha-card>'; return; }
    if (this._resolvedFor !== this._hass.entities) this._resolve();
    const c = this._config;
    const today = kcDay(new Date());
    const dayN = (d) => Math.round((d - today) / 86400000);
    const dayLabel = (d) => { const n = dayN(d); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' }); };

    const tonight = this._meals.filter((m) => m.cal === this._tonightId && dayN(m.date) === 0);
    const sides = this._meals.filter((m) => m.cal !== this._tonightId && dayN(m.date) === 0 && /side|dessert|drink/i.test(m.kind));

    // Week: one row per day after today, the "tonight" calendar's meal first.
    const days = Math.max(0, Number(c.days) || 0);
    const week = [];
    for (let i = 1; i < days; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const meals = this._meals.filter((m) => dayN(m.date) === i)
        .sort((a, b) => (b.cal === this._tonightId) - (a.cal === this._tonightId));
      week.push({ d, meals });
    }
    const weekHasAny = week.some((w) => w.meals.length);

    const items = (this._items || []).filter((it) => c.show_completed || it.status !== 'completed');
    const doneN = (this._items || []).filter((it) => it.status === 'completed').length;
    const open = (this._items || []).filter((it) => it.status !== 'completed');
    const listName = this._listId ? String(this._hass.states[this._listId]?.attributes?.friendly_name || 'Shopping list') : '';

    const html = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px; }
        .title { font-size: 1.05em; font-weight: 600; color: var(--primary-text-color); margin: 0 2px 10px; display: flex; align-items: center; gap: 8px; }
        .title span { flex: 1; }
        .hero { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; cursor: pointer;
                background: linear-gradient(135deg, rgba(255,152,0,.18), rgba(244,67,54,.10)); }
        .hero.none { background: var(--secondary-background-color, rgba(127,127,127,.08)); }
        .hi { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 24px;
              background: rgba(255,152,0,.22); color: #ff9800; }
        .none .hi { background: rgba(127,127,127,.15); color: var(--secondary-text-color); }
        .hk { font-size: .72em; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); }
        .hn { font-size: 1.15em; font-weight: 700; color: var(--primary-text-color); line-height: 1.25; }
        .none .hn { font-size: .95em; font-weight: 500; color: var(--secondary-text-color); }
        .hd { font-size: .8em; color: var(--secondary-text-color); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .ht { flex: 1; min-width: 0; }

        .sec { font-size: .72em; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color);
               margin: 14px 2px 6px; display: flex; align-items: center; gap: 8px; }
        .sec span { flex: 1; }
        .week { display: flex; flex-direction: column; gap: 2px; }
        .wd { display: flex; align-items: baseline; gap: 10px; padding: 5px 4px; border-radius: 8px; font-size: .88em; cursor: pointer; }
        .wd:hover { background: rgba(127,127,127,.08); }
        .wd .d { width: 72px; flex-shrink: 0; color: var(--secondary-text-color); font-weight: 500; }
        .wd .m { flex: 1; min-width: 0; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wd .m i { font-style: normal; color: var(--secondary-text-color); font-size: .9em; }
        .wd.empty .m { color: var(--secondary-text-color); opacity: .7; }

        .btn { display: inline-flex; align-items: center; gap: 4px; border: none; cursor: pointer; border-radius: 14px; padding: 4px 10px;
               font: inherit; font-size: .95em; text-transform: none; letter-spacing: 0; font-weight: 600; --mdc-icon-size: 15px;
               background: rgba(127,127,127,.14); color: var(--primary-text-color); }
        .btn:hover { background: rgba(127,127,127,.24); }
        .btn.primary { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
        .btn.ok { background: var(--success-color, #4caf50); color: #fff; }
        .btn.err { background: var(--error-color, #f44336); color: #fff; }
        .btn[disabled] { opacity: .5; cursor: default; }
        .list { display: flex; flex-direction: column; }
        .it { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 8px; cursor: pointer; font-size: .9em; color: var(--primary-text-color); }
        .it:hover { background: rgba(127,127,127,.08); }
        .box { width: 18px; height: 18px; border-radius: 5px; border: 2px solid var(--secondary-text-color); flex-shrink: 0; box-sizing: border-box;
               display: flex; align-items: center; justify-content: center; --mdc-icon-size: 14px; color: #fff; }
        .it.done { color: var(--secondary-text-color); text-decoration: line-through; }
        .it.done .box { background: var(--primary-color, #03a9f4); border-color: var(--primary-color, #03a9f4); }
        .it .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .it .q { font-size: .85em; color: var(--secondary-text-color); white-space: nowrap; }
        .addrow { display: flex; gap: 6px; margin-top: 6px; }
        input.add { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--divider-color, rgba(127,127,127,.3));
                    background: var(--card-background-color, transparent); color: var(--primary-text-color); font: inherit; font-size: .9em; outline: none; }
        input.add:focus { border-color: var(--primary-color, #03a9f4); }
        .muted { color: var(--secondary-text-color); font-size: .85em; padding: 4px; }
      </style>
      <ha-card>
        ${c.title ? `<div class="title"><span>${kcEsc(c.title)}</span></div>` : ''}

        ${this._calIds.length ? `
          <div class="hero ${tonight.length ? '' : 'none'}" data-act="more" data-e="${kcEsc(this._tonightId || '')}">
            <div class="hi"><ha-icon icon="${tonight.length ? 'mdi:silverware-fork-knife' : 'mdi:silverware-variant'}"></ha-icon></div>
            <div class="ht">
              <div class="hk">Tonight</div>
              ${tonight.length
                ? `<div class="hn">${tonight.map((m) => kcEsc(m.title)).join(' &amp; ')}</div>
                   ${sides.length ? `<div class="hd">with ${sides.map((m) => kcEsc(m.title)).join(', ')}</div>`
                     : tonight[0].desc ? `<div class="hd">${kcEsc(tonight[0].desc)}</div>` : ''}`
                : '<div class="hn">Nothing planned yet</div>'}
            </div>
          </div>
          ${days > 1 ? `
            <div class="sec"><span>This week</span></div>
            <div class="week">
              ${weekHasAny ? week.map((w) => `
                <div class="wd ${w.meals.length ? '' : 'empty'}" data-act="more" data-e="${kcEsc(w.meals[0]?.cal || this._tonightId || '')}">
                  <span class="d">${dayLabel(w.d)}</span>
                  <span class="m">${w.meals.length
                    ? w.meals.map((m, i) => (i === 0 && m.cal === this._tonightId ? kcEsc(m.title) : `<i>${kcEsc(m.kind)}:</i> ${kcEsc(m.title)}`)).join(' · ')
                    : '—'}</span>
                </div>`).join('') : '<div class="muted">Nothing planned for the rest of the week.</div>'}
            </div>` : ''}` : ''}

        ${this._listId ? `
          <div class="sec">
            <span>${kcEsc(listName)}${open.length ? ` · ${open.length}` : ''}</span>
            ${doneN ? `<button class="btn" data-act="clear" title="Remove ticked items"><ha-icon icon="mdi:broom"></ha-icon>Clear ${doneN}</button>` : ''}
            ${c.print_action ? `<button class="btn ${this._printState === 'ok' ? 'ok' : this._printState === 'err' ? 'err' : 'primary'}" data-act="print" ${open.length && this._printState !== 'busy' ? '' : 'disabled'}>
              <ha-icon icon="${this._printState === 'ok' ? 'mdi:check' : this._printState === 'err' ? 'mdi:alert' : 'mdi:printer-pos'}"></ha-icon>${this._printState === 'ok' ? 'Printed' : this._printState === 'err' ? 'Failed' : 'Print'}</button>` : ''}
          </div>
          <div class="list">
            ${this._items == null ? '<div class="muted">Loading…</div>'
              : !items.length ? '<div class="muted">The list is empty.</div>'
              : items.map((it) => `
                <div class="it ${it.status === 'completed' ? 'done' : ''}" data-act="check" data-uid="${kcEsc(it.uid)}" data-s="${it.status}">
                  <span class="box">${it.status === 'completed' ? '<ha-icon icon="mdi:check"></ha-icon>' : ''}</span>
                  <span class="n">${kcEsc(it.summary)}</span>
                  ${it.description ? `<span class="q">${kcEsc(it.description)}</span>` : ''}
                </div>`).join('')}
          </div>
          <div class="addrow"><input class="add" type="text" placeholder="Add an item" enterkeyhint="done"></div>
        ` : ''}

        ${!this._calIds.length && !this._listId ? '<div class="muted">No meal-plan calendars or shopping list found. Set <code>meal_calendars</code> or <code>shopping_list</code>.</div>' : ''}
      </ha-card>`;
    if (html === this._lastHtml) return;
    // Keep whatever's being typed in the add box across re-renders.
    const input = this.shadowRoot.querySelector('input.add');
    const typed = input?.value, focused = input && this.shadowRoot.activeElement === input;
    this._lastHtml = html;
    this.shadowRoot.innerHTML = html;
    const ni = this.shadowRoot.querySelector('input.add');
    if (ni && typed) ni.value = typed;
    if (ni && focused) ni.focus();
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  _onClick(ev) {
    const el = ev.target.closest('[data-act]');
    if (!el || !this._hass) return;
    const act = el.dataset.act;
    if (act === 'more' && el.dataset.e) {
      this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
    } else if (act === 'check') {
      const done = el.dataset.s === 'completed';
      this._hass.callService('todo', 'update_item', { item: el.dataset.uid, status: done ? 'needs_action' : 'completed' }, { entity_id: this._listId });
      // Optimistic: flip it now, the subscription confirms it.
      const it = (this._items || []).find((i) => i.uid === el.dataset.uid);
      if (it) { it.status = done ? 'needs_action' : 'completed'; this._lastHtml = null; this._render(); }
    } else if (act === 'clear') {
      this._hass.callService('todo', 'remove_completed_items', {}, { entity_id: this._listId });
    } else if (act === 'print') {
      this._print();
    }
  }

  _addItem(input) {
    const v = input.value.trim();
    if (!v || !this._listId) return;
    input.value = '';   // clear first: the list update re-renders and keeps whatever is typed
    this._hass.callService('todo', 'add_item', { item: v }, { entity_id: this._listId });
  }

  // Plain text for an ~48-column receipt.
  _printText() {
    const c = this._config;
    const W = 48;
    const now = new Date();
    const lines = ['SHOPPING LIST', now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), '-'.repeat(W)];
    if (c.print_meals) {
      const today = kcDay(now);
      const dinners = this._meals.filter((m) => m.cal === this._tonightId).sort((a, b) => a.date - b.date);
      if (dinners.length) {
        lines.push('MEALS');
        for (const m of dinners) {
          const n = Math.round((m.date - today) / 86400000);
          const d = (n === 0 ? 'Tonight' : m.date.toLocaleDateString(undefined, { weekday: 'short' })).padEnd(8);
          lines.push(`${d}${m.title}`.slice(0, W));
        }
        lines.push('-'.repeat(W));
      }
    }
    for (const it of (this._items || []).filter((i) => i.status !== 'completed')) {
      const q = it.description ? ` (${it.description})` : '';
      lines.push(`[ ] ${it.summary}${q}`.slice(0, W));
    }
    return lines.join('\n');
  }

  async _print() {
    const c = this._config;
    const [domain, service] = String(c.print_action).split('.');
    if (!domain || !service) return;
    this._printState = 'busy'; this._lastHtml = null; this._render();
    try {
      await this._hass.callService(domain, service, { [c.print_field || 'message']: this._printText() });
      this._printState = 'ok';
    } catch (e) {
      this._printState = 'err';
    }
    this._lastHtml = null; this._render();
    setTimeout(() => { this._printState = ''; this._lastHtml = null; this._render(); }, 3000);
  }

  getCardSize() { return 4 + Math.min(6, (this._items || []).length / 2); }

  static async getConfigElement() {
    await window.RusstumEditor.ensureHaForm();
    return document.createElement('kitchen-card-editor');
  }

  static getStubConfig() { return {}; }
}

customElements.define('kitchen-card', KitchenCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'kitchen-card',
  name: 'Kitchen Card',
  description: "Tonight's dinner, the week's meal plan and a printable shopping list.",
  preview: false,
});

class KitchenCardEditor extends window.RusstumEditor {
  _sections() {
    const { f } = window.RusstumEditor;
    return [
      { title: 'Meals', icon: 'mdi:silverware-fork-knife', schema: [
        f.text('title', 'Title'),
        f.entities('meal_calendars', 'Meal-plan calendars', 'Default: every Mealie calendar', 'calendar'),
        f.grid(
          f.entity('tonight_calendar', '"Tonight" calendar', 'Default: the dinner one', 'calendar'),
          f.number('days', 'Days shown', { min: 0, max: 14, helper: 'Default: 7' }),
        ),
      ] },
      { title: 'Shopping list', icon: 'mdi:cart', schema: [
        f.entity('shopping_list', 'To-do list', 'Default: Grocy, Mealie or Shopping List', 'todo'),
        f.toggle('show_completed', 'Keep ticked items in the list'),
        f.grid(
          f.entity('print_action', 'Print with', 'A script, e.g. script.print_receipt', 'script'),
          f.text('print_field', 'Text field', 'Default: message'),
        ),
        f.toggle('print_meals', "Print the week's dinners too"),
      ] },
    ];
  }
}

customElements.define('kitchen-card-editor', KitchenCardEditor);
