// The command palette (Mod+K): type to find any command, arrows to move, Enter to run.
import { h, icon, formatKeys } from './dom.js';
import { rank } from './fuzzy.js';

/** @typedef {import('../commands.js').CommandRegistry} CommandRegistry */
/** @typedef {import('../commands.js').Command} Command */

/** @type {HTMLElement | null} */
let openEl = null;

export function isPaletteOpen() { return openEl !== null; }

/**
 * @param {CommandRegistry} commands
 * @param {() => Command[]} [extra] more items (such as model elements) shown only when the user types
 */
export function openPalette(commands, extra) {
  if (openEl) { openEl.querySelector('input')?.focus(); return; }
  const returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  const input = h('input', { type: 'text', placeholder: extra ? 'Find an element or type a command' : 'Type a command', 'aria-label': 'Command', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  let active = 0;
  /** @type {{ item: Command, hits: number[] }[]} */
  let shown = [];

  /** @param {string} text @param {number[]} hits */
  const highlight = (text, hits) => {
    if (!hits.length) return [text];
    const set = new Set(hits);
    return [...text].map((ch, i) => (set.has(i) ? h('mark', {}, ch) : ch));
  };
  const paint = () => {
    const all = commands.list();
    const q = input.value.trim();
    shown = q ? rank(q, [...all, ...(extra ? extra() : [])], (c) => c.title, (c) => c.keywords || []).slice(0, 60) : all.map((item) => ({ item, hits: [] }));
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map(({ item, hits }, i) => {
      const off = item.enabled ? !item.enabled() : false;
      const li = h('li', { class: 'palette-item' + (off ? ' disabled' : ''), role: 'option', id: `pal-${i}`, 'aria-selected': String(i === active), 'aria-disabled': off ? 'true' : undefined },
        h('span', { class: 'grp' }, item.group),
        h('span', {}, highlight(item.title, hits)),
        item.keys ? h('span', { class: 'kbd' }, formatKeys(item.keys)) : null);
      li.addEventListener('mousemove', () => { if (active !== i) { active = i; paint(); } });
      li.addEventListener('click', () => runAt(i));
      return li;
    }));
    if (!shown.length) list.append(h('li', { class: 'palette-empty' }, 'No matching command'));
    input.setAttribute('aria-activedescendant', shown.length ? `pal-${active}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  /** @param {number} i */
  const runAt = (i) => {
    const pick = shown[i]?.item;
    if (!pick || (pick.enabled && !pick.enabled())) return;
    close();
    if (commands.get(pick.id)) commands.run(pick.id); else pick.run();
  };
  const close = () => { back.remove(); openEl = null; returnFocus?.focus?.(); };

  input.addEventListener('input', () => { active = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, shown.length); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + shown.length) % Math.max(1, shown.length); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  const panel = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'palette-input' }, icon('search'), input),
    list,
    h('div', { class: 'palette-foot' }, h('span', {}, '↑↓ move'), h('span', {}, '↵ run'), h('span', {}, 'esc close')));
  const back = h('div', { class: 'palette-back' }, panel);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  openEl = back;
  paint();
  input.focus();
}
