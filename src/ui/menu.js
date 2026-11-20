// A small popup menu anchored to a button. Arrow keys move, Enter picks, Esc closes.
import { h } from './dom.js';

/** @typedef {{ label: string, hint?: string, run: () => void, disabled?: boolean, danger?: boolean } | 'sep'} MenuItem */

/** @type {(() => void) | null} */
let closeOpen = null;

/** @param {HTMLElement} anchor @param {MenuItem[]} items @param {{ title?: string }} [o] */
export function popupMenu(anchor, items, o = {}) {
  closeOpen?.();
  const buttons = /** @type {HTMLButtonElement[]} */ ([]);
  const menu = h('div', { class: 'popmenu', role: 'menu', 'aria-label': o.title || 'Menu' },
    o.title ? h('div', { class: 'popmenu-title' }, o.title) : null,
    items.map((it) => {
      if (it === 'sep') return h('div', { class: 'popmenu-sep', role: 'separator' });
      const b = h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger-text' : '', disabled: it.disabled ? true : undefined, onclick: () => { close(); it.run(); } },
        h('span', { class: 'popmenu-label' }, it.label), it.hint ? h('span', { class: 'popmenu-hint' }, it.hint) : null);
      buttons.push(b);
      return b;
    }));
  const r = anchor.getBoundingClientRect();
  document.body.append(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - mw - 8))}px`;
  menu.style.top = `${r.bottom + 4 + mh > innerHeight - 8 ? Math.max(8, r.top - mh - 4) : r.bottom + 4}px`;

  const enabled = () => buttons.filter((b) => !b.disabled);
  menu.addEventListener('keydown', (e) => {
    const list = enabled(), i = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); anchor.focus(); }
  });
  const outside = (/** @type {MouseEvent} */ e) => { if (!menu.contains(/** @type {Node} */ (e.target)) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  function close() { menu.remove(); document.removeEventListener('mousedown', outside); if (closeOpen === close) closeOpen = null; }
  closeOpen = close;
  enabled()[0]?.focus();
  return close;
}
