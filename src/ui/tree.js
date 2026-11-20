// The model browser: the project's elements as a tree under the four RFLP layers.
// Click to select, double-click or F2 to rename, drag onto another element to move it,
// the + button to add inside, arrow keys to move around (WAI-ARIA tree pattern).
import { h, icon } from './dom.js';
import { popupMenu } from './menu.js';
import { ELEMENTS, LAYERS, kindName, childKinds, isRel, isDiagram } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/**
 * @typedef {{
 *   model: Model,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   expanded: Set<string>,
 *   create: (kind: string, owner: string) => void,
 *   rename: (id: string, name: string) => void,
 *   move: (id: string, owner: string) => boolean,
 *   remove: (id: string) => void,
 *   open: (id: string) => void,
 * }} TreeCtx
 */

/** @type {string | null} the element being dragged */
let dragging = null;

const LAYER_COLOR = Object.fromEntries(LAYERS.map((l) => [l.id, l.color]));

/** @param {TreeCtx} ctx */
export function createTree(ctx) {
  const el = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Model browser' });
  /** @type {string | null} */
  let renaming = null;

  /** Visible rows in order, for keyboard navigation. @returns {string[]} */
  const visible = () => [...el.querySelectorAll('[role="treeitem"]')].map((n) => /** @type {HTMLElement} */ (n).dataset.id || '');

  /** @param {Element} e @param {number} depth @returns {HTMLElement[]} */
  function rows(e, depth) {
    const m = ctx.model, n = ctx.notation();
    const kids = m.children(e.id);
    const open = ctx.expanded.has(e.id);
    const sel = ctx.selected() === e.id;
    const layer = m.layerOf(e.id);
    const isLayer = !!e.layer;
    const row = h('div', {
      class: 'ti' + (sel ? ' sel' : '') + (isLayer ? ' ti-layer' : ''),
      role: 'treeitem', 'aria-level': String(depth + 1), 'aria-selected': String(sel),
      'aria-expanded': kids.length ? String(open) : undefined,
      tabindex: sel || (!ctx.selected() && isLayer && e.layer === 'r') ? '0' : '-1',
      'data-id': e.id, draggable: isLayer ? undefined : 'true',
      style: { '--depth': String(depth) },
      title: isLayer ? undefined : `${e.name} · ${kindName(e.kind, n)}`,
    },
    h('span', { class: 'twisty' + (kids.length ? '' : ' none'), 'aria-hidden': 'true', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); toggle(e.id); } }, kids.length ? icon(open ? 'chevDown' : 'chevRight') : null),
    isLayer
      ? h('span', { class: 'layer-dot', style: { background: LAYER_COLOR[/** @type {string} */ (e.layer)] } })
      : h('span', { class: 'kbadge', style: { color: layer ? LAYER_COLOR[layer] : 'var(--text-2)' } }, ELEMENTS[e.kind].abbr),
    renaming === e.id ? renameInput(e) : h('span', { class: 'ti-name' }, e.name),
    isLayer && kids.length ? h('span', { class: 'ti-count mono' }, String(countDeep(e.id))) : null,
    childKinds(e.kind).length && renaming !== e.id ? h('button', { class: 'ti-add', type: 'button', tabindex: '-1', 'aria-label': `Add inside ${e.name}`, title: 'Add inside',
      onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); addMenu(/** @type {HTMLElement} */ (ev.currentTarget), e); } }, icon('plus')) : null);

    row.addEventListener('click', () => { ctx.select(e.id); });
    row.addEventListener('dblclick', (ev) => { ev.preventDefault(); if (isDiagram(e.kind)) ctx.open(e.id); else if (!isLayer) startRename(e.id); else toggle(e.id); });
    row.addEventListener('dragstart', (ev) => {
      dragging = e.id;
      ev.dataTransfer?.setData('text/plain', e.name);
      ev.dataTransfer?.setData('application/x-loom-id', e.id); // lets a diagram accept the drop
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copyMove';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { dragging = null; row.classList.remove('dragging'); el.querySelectorAll('.drop-ok,.drop-no').forEach((x) => x.classList.remove('drop-ok', 'drop-no')); });
    row.addEventListener('dragover', (ev) => {
      if (!dragging || dragging === e.id) return;
      const ok = ctx.model.canMove(dragging, e.id);
      row.classList.toggle('drop-ok', ok); row.classList.toggle('drop-no', !ok);
      if (ok) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-ok', 'drop-no'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault(); row.classList.remove('drop-ok');
      if (dragging && ctx.move(dragging, e.id)) ctx.expanded.add(e.id);
      dragging = null;
    });

    const out = [row];
    if (open) for (const k of kids) out.push(...rows(k, depth + 1));
    return out;
  }

  /** @param {string} id */
  function countDeep(id) { let n = 0; const walk = (/** @type {string} */ x) => { for (const c of ctx.model.children(x)) { n++; walk(c.id); } }; walk(id); return n; }

  /** @param {Element} e */
  function renameInput(e) {
    const input = h('input', { class: 'ti-input', type: 'text', value: e.name, 'aria-label': 'Name', maxlength: 500 });
    let done = false;
    const finish = (/** @type {boolean} */ commit) => {
      if (done) return; done = true; renaming = null;
      const v = input.value.trim();
      if (commit && v && v !== e.name) ctx.rename(e.id, v); else render();
      focusSelected();
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('dblclick', (ev) => ev.stopPropagation());
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  /** @param {HTMLElement} anchor @param {Element} owner */
  function addMenu(anchor, owner) {
    const n = ctx.notation();
    popupMenu(anchor, childKinds(owner.kind).map((k) => ({ label: kindName(k, n), hint: ELEMENTS[k].abbr, run: () => { ctx.expanded.add(owner.id); ctx.create(k, owner.id); } })), { title: `Add inside ${owner.name}` });
  }

  /** @param {string} id */
  function toggle(id) { if (ctx.expanded.has(id)) ctx.expanded.delete(id); else ctx.expanded.add(id); render(); focusSelected(); }

  /** @param {string} id */
  function startRename(id) { const e = ctx.model.get(id); if (!e || e.layer || !e.owner) return; renaming = id; ctx.select(id); render(); }

  function focusSelected() {
    const id = ctx.selected();
    const row = /** @type {HTMLElement | null} */ (id ? el.querySelector(`[data-id="${id}"]`) : el.querySelector('[tabindex="0"]'));
    row?.focus({ preventScroll: false });
    row?.scrollIntoView({ block: 'nearest' });
  }

  el.addEventListener('keydown', (ev) => {
    if (renaming || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const ids = visible(), cur = ctx.selected(), i = cur ? ids.indexOf(cur) : -1;
    const e = cur ? ctx.model.get(cur) : undefined;
    const go = (/** @type {string | undefined} */ id) => { if (id) { ctx.select(id); focusSelected(); } };
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); go(ids[Math.min(ids.length - 1, i + 1)]); break;
      case 'ArrowUp': ev.preventDefault(); go(ids[Math.max(0, i - 1)]); break;
      case 'Home': ev.preventDefault(); go(ids[0]); break;
      case 'End': ev.preventDefault(); go(ids[ids.length - 1]); break;
      case 'ArrowRight':
        ev.preventDefault();
        if (e && ctx.model.children(e.id).length) { if (!ctx.expanded.has(e.id)) toggle(e.id); else go(ctx.model.children(e.id)[0].id); }
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        if (e && ctx.expanded.has(e.id) && ctx.model.children(e.id).length) toggle(e.id);
        else if (e?.owner && ctx.model.get(e.owner)?.owner) go(e.owner); // up to the parent, but never to the hidden root
        break;
      case 'Enter': if (e && isDiagram(e.kind)) { ev.preventDefault(); ctx.open(e.id); } else if (e && !e.layer) { ev.preventDefault(); startRename(e.id); } break;
      case 'F2': if (e && !e.layer) { ev.preventDefault(); startRename(e.id); } break;
      default: return;
    }
    ev.stopPropagation(); // handled here; keep the global shortcut from running too
  });

  function render() {
    const hadFocus = el.contains(document.activeElement);
    const m = ctx.model;
    // the selected element's ancestors are always open, so a selection is never hidden
    const sel = ctx.selected();
    if (sel && m.get(sel) && !isRel(/** @type {Element} */ (m.get(sel)).kind)) for (const a of m.path(sel)) ctx.expanded.add(a.id);
    el.replaceChildren(...m.layers().flatMap((l) => rows(l, 0)));
    if (hadFocus && !renaming) focusSelected();
  }

  render();
  return { el, render, startRename, focus: focusSelected };
}
