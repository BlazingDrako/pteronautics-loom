// The model browser: the project's elements as a tree under the four RFLP layers.
//
//   click             select                 double-click   properties (a diagram opens)
//   drag              move: onto a row to put it inside, between rows to reorder; onto a
//                     diagram to show it there. Works straight away, selected or not.
//   right-click       a menu: properties, rename, add inside, open, delete
//   + on a row        add inside              arrows         move around (WAI-ARIA tree)
//   F2                rename                  Alt+↑ / Alt+↓  move among siblings
//
// Dragging uses pointer events rather than the browser's drag and drop, so it behaves the
// same in every browser, scrolls the browser at its edges and opens a folder you hover over.
import { h, icon } from './dom.js';
import { popupMenu } from './menu.js';
import { ELEMENTS, LAYERS, kindName, childKinds, isRel, isDiagram } from '../model/metamodel.js';
import { stereoIcon, stereoNames } from '../custom/stereo.js';
import { toolIcon } from '../canvas/tools.js';
import { worst } from '../validate/engine.js';

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
 *   move: (id: string, owner: string, index?: number) => boolean,
 *   remove: (id: string) => void,
 *   open: (id: string) => void,
 *   openProps?: (id: string) => void,
 *   library?: (id: string) => void,
 *   problemsFor?: (id: string) => import('../validate/engine.js').Problem[],
 *   showLines?: () => boolean,
 * }} TreeCtx
 */

const LAYER_COLOR = Object.fromEntries(LAYERS.map((l) => [l.id, l.color]));
/** The icon a diagram, table or matrix shows in the browser, so views stand apart from elements. */
const DIAGRAM_ICON = /** @type {Record<string, string>} */ ({ bdd: 'block', ibd: 'part', req: 'requirement', table: 'table', matrix: 'matrix', act: 'action', stm: 'state', sd: 'lifeline', uc: 'useCase', pkg: 'package', par: 'constraint' });
/** Elements drawn as lines on diagrams: listed in the browser only when asked for. */
export const LINE_KINDS = new Set(['flow', 'transition', 'connector', 'binding']);
/** How far the pointer moves before a press becomes a drag. */
const DRAG_START = 5;
/** How long to hover over a closed row while dragging before it opens. */
const OPEN_DELAY = 650;

/** @param {TreeCtx} ctx */
export function createTree(ctx) {
  const el = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Model browser' });
  /** The filter typed above the tree (lower case), and what it keeps: matches and their owners. */
  let filter = '';
  /** @type {Set<string> | null} */
  let keep = null;
  /** @type {Set<string>} */
  let hits = new Set();
  /** The children the browser lists (lines hidden unless asked for; filtered). @param {string} id */
  const kidsOf = (id) => ctx.model.children(id).filter((c) => (ctx.showLines?.() || !LINE_KINDS.has(c.kind)) && (!keep || keep.has(c.id)));
  const marker = h('div', { class: 'tree-marker', hidden: true, 'aria-hidden': 'true' });
  /** @type {string | null} */
  let renaming = null;
  /** The selection the tree last opened folders for. @type {string | null} */
  let revealed = null;

  /** Visible rows in order, for keyboard navigation. @returns {string[]} */
  const visible = () => [...el.querySelectorAll('[role="treeitem"]')].map((n) => /** @type {HTMLElement} */ (n).dataset.id || '');

  /** @param {Element} e @param {number} depth @returns {HTMLElement[]} */
  function rows(e, depth) {
    const m = ctx.model, n = ctx.notation();
    const kids = kidsOf(e.id);
    const open = ctx.expanded.has(e.id) || (!!keep && kids.length > 0);
    const sel = ctx.selected() === e.id;
    const layer = m.layerOf(e.id);
    const isLayer = !!e.layer;
    const stereo = stereoNames(m, e.id);
    const row = h('div', {
      class: 'ti' + (sel ? ' sel' : '') + (isLayer ? ' ti-layer' : '') + (isDiagram(e.kind) ? ' ti-diagram' : ''),
      role: 'treeitem', 'aria-level': String(depth + 1), 'aria-selected': String(sel),
      'aria-expanded': kids.length ? String(open) : undefined,
      tabindex: sel || (!ctx.selected() && isLayer && e.layer === 'r') ? '0' : '-1',
      'data-id': e.id,
      style: { '--depth': String(depth) },
      title: isLayer ? undefined : `${e.name} · ${kindName(e.kind, n)}${stereo.length ? ` «${stereo.join(', ')}»` : ''}`,
    },
    h('span', { class: 'twisty' + (kids.length ? '' : ' none'), 'aria-hidden': 'true', 'data-twisty': '' }, kids.length ? icon(open ? 'chevDown' : 'chevRight') : null),
    isLayer
      ? h('span', { class: 'layer-dot', style: { background: LAYER_COLOR[/** @type {string} */ (e.layer)] } })
      : isDiagram(e.kind)
        ? h('span', { class: 'ti-dicon', title: kindName(e.kind, n), style: { color: layer ? LAYER_COLOR[layer] : 'var(--text-2)' } }, toolIcon(DIAGRAM_ICON[e.kind] || 'block'))
        : h('span', { class: 'kbadge', style: { color: layer ? LAYER_COLOR[layer] : 'var(--text-2)' } }, ELEMENTS[e.kind].abbr),
    renaming === e.id ? renameInput(e) : h('span', { class: 'ti-name' + (hits.has(e.id) ? ' hit' : '') }, stereoIcon(m, e.id) ? h('span', { class: 'ti-icon', 'aria-hidden': 'true' }, stereoIcon(m, e.id)) : null, e.name),
    (() => {
      // the worst problem on this element
      const own = ctx.problemsFor?.(e.id) || [];
      const sev = worst(own);
      return sev ? h('span', { class: `ti-prob sev-${sev}`, title: own.map((p) => p.message).join('\n'), 'aria-label': `${own.length} problem${own.length === 1 ? '' : 's'}` }) : null;
    })(),
    isLayer && kids.length ? h('span', { class: 'ti-count mono' }, String(countDeep(e.id))) : null,
    childKinds(e.kind).length && renaming !== e.id ? h('button', { class: 'ti-add', type: 'button', tabindex: '-1', 'aria-label': `Add inside ${e.name}`, title: 'Add inside', 'data-add': '' }, icon('plus')) : null);

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
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('dblclick', (ev) => ev.stopPropagation());
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  /** The "add inside" items for an element. @param {Element} owner */
  const addItems = (owner) => childKinds(owner.kind).map((k) => ({ label: kindName(k, ctx.notation()), hint: ELEMENTS[k].abbr, run: () => { ctx.expanded.add(owner.id); ctx.create(k, owner.id); } }));

  /** @param {HTMLElement} anchor @param {Element} owner @param {{ x: number, y: number }} [at] */
  function addMenu(anchor, owner, at) {
    popupMenu(anchor, addItems(owner), { title: `Add inside ${owner.name}`, at });
  }

  /** The right-click menu. @param {HTMLElement} row @param {Element} e @param {{ x: number, y: number }} at */
  function contextMenu(row, e, at) {
    const diagram = isDiagram(e.kind);
    const canAdd = childKinds(e.kind).length > 0;
    popupMenu(row, [
      diagram ? { label: 'Open', hint: 'Enter', run: () => ctx.open(e.id) } : null,
      ctx.openProps ? { label: 'Properties', hint: 'Double-click', run: () => ctx.openProps?.(e.id) } : null,
      e.layer ? null : { label: 'Rename', hint: 'F2', run: () => startRename(e.id) },
      canAdd ? { label: 'Add inside…', run: () => addMenu(row, e, at) } : null,
      ctx.library && !e.layer ? { label: `About ${kindName(e.kind, ctx.notation()).toLowerCase()}s`, hint: '?', run: () => ctx.library?.(e.id) } : null,
      ...(ctx.model.children(e.id).length ? [/** @type {const} */ ('sep'), { label: 'Expand all inside', run: () => { expandAll(e.id, true); render(); } }, { label: 'Collapse all inside', run: () => { expandAll(e.id, false); render(); } }] : []),
      ...(e.layer ? [] : [/** @type {const} */ ('sep'), { label: 'Delete', hint: 'Del', danger: true, run: () => ctx.remove(e.id) }]),
    ].filter((x) => x !== null), { title: e.name, at });
  }

  /** @param {string} id @param {boolean} open */
  function expandAll(id, open) {
    const walk = (/** @type {string} */ x) => { const kids = ctx.model.children(x); if (kids.length) { if (open) ctx.expanded.add(x); else if (x !== id || !ctx.model.get(x)?.layer) ctx.expanded.delete(x); } kids.forEach((k) => walk(k.id)); };
    walk(id);
    if (open) ctx.expanded.add(id);
  }

  /** @param {string} id */
  function toggle(id) { if (ctx.expanded.has(id)) ctx.expanded.delete(id); else ctx.expanded.add(id); render(); focusSelected(); }

  /** @param {string} id */
  function startRename(id) { const e = ctx.model.get(id); if (!e || e.layer || !e.owner) return; renaming = id; ctx.select(id); render(); }

  function focusSelected() {
    const id = ctx.selected();
    const row = /** @type {HTMLElement | null} */ (id ? el.querySelector(`[data-id="${id}"]`) : el.querySelector('[tabindex="0"]'));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }

  /** The row element and element for an event target. @param {EventTarget | null} t */
  const rowOf = (t) => {
    const row = t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest('.ti')) : null;
    const e = row ? ctx.model.get(/** @type {string} */ (row.dataset.id)) : undefined;
    return row && e ? { row, e } : null;
  };

  // ---------- clicks (delegated, so they work on any row at once) ----------
  el.addEventListener('click', (ev) => {
    if (suppressClick) { suppressClick = false; return; }
    const hit = rowOf(ev.target);
    if (!hit) return;
    const t = /** @type {Element} */ (ev.target);
    if (t.closest('[data-twisty]')) { toggle(hit.e.id); return; }
    if (t.closest('[data-add]')) { addMenu(/** @type {HTMLElement} */ (t.closest('[data-add]')), hit.e); return; }
    ctx.select(hit.e.id);
  });
  el.addEventListener('dblclick', (ev) => {
    const hit = rowOf(ev.target);
    const t = /** @type {Element} */ (ev.target);
    if (!hit || t.closest('[data-twisty], [data-add]')) return;
    ev.preventDefault();
    if (isDiagram(hit.e.kind)) ctx.open(hit.e.id);
    else if (hit.e.layer) toggle(hit.e.id);
    else if (ctx.openProps) ctx.openProps(hit.e.id);
    else startRename(hit.e.id);
  });
  el.addEventListener('contextmenu', (ev) => {
    const hit = rowOf(ev.target);
    if (!hit) return;
    ev.preventDefault();
    ctx.select(hit.e.id);
    const row = /** @type {HTMLElement} */ (el.querySelector(`[data-id="${hit.e.id}"]`) || hit.row);
    contextMenu(row, hit.e, { x: ev.clientX, y: ev.clientY });
  });

  // ---------- dragging ----------
  /**
   * @type {null | {
   *   id: string, x: number, y: number, pointer: number, started: boolean,
   *   ghost?: HTMLElement, drop?: { kind: 'inside' | 'before' | 'after', target: string, owner: string, index: number } | { kind: 'diagram', stage: HTMLElement } | null,
   *   hover?: string, hoverTimer?: ReturnType<typeof setTimeout>, scroll?: number,
   * }}
   */
  let drag = null;
  let suppressClick = false;

  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || renaming) return;
    const t = /** @type {Element} */ (ev.target);
    if (t.closest('[data-twisty], [data-add], input')) return;
    const hit = rowOf(t);
    if (!hit || hit.e.layer) return;
    drag = { id: hit.e.id, x: ev.clientX, y: ev.clientY, pointer: ev.pointerId, started: false };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
  });

  /** @param {PointerEvent} ev */
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.pointer) return;
    if (!drag.started) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < DRAG_START) return;
      begin();
    }
    ev.preventDefault();
    const d = /** @type {NonNullable<typeof drag>} */ (drag);
    if (d.ghost) { d.ghost.style.left = `${ev.clientX + 12}px`; d.ghost.style.top = `${ev.clientY + 10}px`; }
    track(ev.clientX, ev.clientY);
  }

  function begin() {
    const d = /** @type {NonNullable<typeof drag>} */ (drag);
    const e = /** @type {Element} */ (ctx.model.get(d.id));
    d.started = true;
    const layer = ctx.model.layerOf(e.id);
    d.ghost = h('div', { class: 'tree-ghost', 'aria-hidden': 'true' },
      h('span', { class: 'kbadge', style: { color: layer ? LAYER_COLOR[layer] : 'var(--text-2)' } }, ELEMENTS[e.kind].abbr),
      h('span', { class: 'tree-ghost-name' }, e.name),
      h('span', { class: 'tree-ghost-where' }));
    document.body.append(d.ghost);
    document.body.classList.add('tree-dragging');
    el.querySelector(`[data-id="${d.id}"]`)?.classList.add('dragging');
    if (!marker.isConnected) el.append(marker);
  }

  /** What dropping at this point would do. @param {number} x @param {number} y */
  function track(x, y) {
    const d = /** @type {NonNullable<typeof drag>} */ (drag);
    const m = ctx.model;
    clearMarks();
    d.drop = null;
    const under = document.elementFromPoint(x, y);
    const where = /** @type {HTMLElement | undefined} */ (d.ghost?.querySelector('.tree-ghost-where'));
    // over a diagram: show the element there
    const stage = /** @type {HTMLElement | null} */ (under?.closest('[data-loom-drop]') || null);
    if (stage) {
      d.drop = { kind: 'diagram', stage };
      stage.classList.add('drop-target');
      if (where) where.textContent = 'Show on diagram';
      autoScroll(0);
      return;
    }
    const hit = under && el.contains(under) ? rowOf(under) : null;
    // near the browser's top or bottom edge: scroll
    const box = scroller().getBoundingClientRect();
    autoScroll(y < box.top + 36 ? -1 : y > box.bottom - 36 ? 1 : 0);
    if (!hit || hit.e.id === d.id || m.isWithin(hit.e.id, d.id)) { if (where) where.textContent = ''; return; }
    const r = hit.row.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    const canInside = m.canMove(d.id, hit.e.id);
    const owner = hit.e.owner ? m.get(hit.e.owner) : undefined;
    const canBeside = !hit.e.layer && !!owner && m.canMove(d.id, owner.id);
    /** @type {'inside' | 'before' | 'after' | null} */
    let kind = null;
    if (canBeside && (f < 0.28 || (!canInside && f < 0.5))) kind = 'before';
    else if (canBeside && (f > 0.72 || (!canInside && f >= 0.5)) && !(ctx.expanded.has(hit.e.id) && m.children(hit.e.id).length)) kind = 'after';
    else if (canInside) kind = 'inside';
    else if (canBeside) kind = f < 0.5 ? 'before' : 'after';
    // hovering inside a closed row opens it
    if (kind === 'inside' && !ctx.expanded.has(hit.e.id) && m.children(hit.e.id).length) {
      if (d.hover !== hit.e.id) {
        clearTimeout(d.hoverTimer); d.hover = hit.e.id;
        d.hoverTimer = setTimeout(() => { if (drag && drag.hover === hit.e.id) { ctx.expanded.add(hit.e.id); render(); el.querySelector(`[data-id="${drag.id}"]`)?.classList.add('dragging'); } }, OPEN_DELAY);
      }
    } else { clearTimeout(d.hoverTimer); d.hover = undefined; }
    if (!kind) { hit.row.classList.add('drop-no'); if (where) where.textContent = `cannot go in ${hit.e.name}`; return; }
    if (kind === 'inside') {
      d.drop = { kind, target: hit.e.id, owner: hit.e.id, index: Infinity };
      hit.row.classList.add('drop-ok');
      if (where) where.textContent = `into ${hit.e.name}`;
    } else {
      const sibs = m.children(/** @type {string} */ (owner?.id)).map((c) => c.id).filter((c) => c !== d.id);
      const index = sibs.indexOf(hit.e.id) + (kind === 'after' ? 1 : 0);
      d.drop = { kind, target: hit.e.id, owner: /** @type {string} */ (owner?.id), index };
      const er = el.getBoundingClientRect();
      const indent = parseFloat(getComputedStyle(hit.row).paddingLeft) || 0;
      marker.hidden = false;
      marker.style.top = `${(kind === 'before' ? r.top : r.bottom) - er.top + el.scrollTop - 1}px`;
      marker.style.left = `${r.left - er.left + indent + 18}px`;
      marker.style.width = `${Math.max(40, r.width - indent - 22)}px`;
      if (where) where.textContent = `${kind} ${hit.e.name}`;
    }
  }

  /** The element that scrolls the browser (the sidebar). */
  const scroller = () => /** @type {HTMLElement} */ (el.closest('.sidebar-scroll') || el.parentElement || el);
  /** @param {number} dir */
  function autoScroll(dir) {
    const d = drag;
    if (!d) return;
    if (!dir) { if (d.scroll) cancelAnimationFrame(d.scroll); d.scroll = 0; return; }
    if (d.scroll) return;
    const step = () => { if (!drag) return; scroller().scrollTop += dir * 9; drag.scroll = requestAnimationFrame(step); };
    d.scroll = requestAnimationFrame(step);
  }

  function clearMarks() {
    marker.hidden = true;
    el.querySelectorAll('.drop-ok, .drop-no').forEach((x) => x.classList.remove('drop-ok', 'drop-no'));
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  }

  /** @param {PointerEvent} ev */
  function onUp(ev) {
    const d = drag;
    if (!d || ev.pointerId !== d.pointer) return;
    finish();
    if (!d.started) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const drop = d.drop;
    if (!drop) return;
    if (drop.kind === 'diagram') {
      drop.stage.dispatchEvent(new CustomEvent('loom-drop', { detail: { id: d.id, clientX: ev.clientX, clientY: ev.clientY } }));
      return;
    }
    if (ctx.move(d.id, drop.owner, drop.index)) { ctx.expanded.add(drop.owner); ctx.select(d.id); }
  }
  function onCancel() { finish(); }
  /** @param {KeyboardEvent} ev */
  function onKey(ev) { if (ev.key === 'Escape' && drag?.started) { ev.preventDefault(); ev.stopPropagation(); finish(); } }
  function finish() {
    const d = drag;
    drag = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    if (!d) return;
    clearTimeout(d.hoverTimer);
    if (d.scroll) cancelAnimationFrame(d.scroll);
    d.ghost?.remove();
    document.body.classList.remove('tree-dragging');
    el.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    clearMarks();
  }

  // ---------- keyboard ----------
  el.addEventListener('keydown', (ev) => {
    if (renaming || ev.metaKey || ev.ctrlKey) return;
    const ids = visible(), cur = ctx.selected(), i = cur ? ids.indexOf(cur) : -1;
    const e = cur ? ctx.model.get(cur) : undefined;
    const go = (/** @type {string | undefined} */ id) => { if (id) { ctx.select(id); focusSelected(); } };
    if (ev.altKey) {
      // Alt+↑ / Alt+↓: move the selection among its siblings
      if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && e?.owner && !e.layer) {
        ev.preventDefault(); ev.stopPropagation();
        const sibs = ctx.model.children(e.owner).map((c) => c.id);
        const at = sibs.indexOf(e.id) + (ev.key === 'ArrowUp' ? -1 : 1);
        if (at >= 0 && at < sibs.length) { ctx.move(e.id, e.owner, at); focusSelected(); }
      }
      return;
    }
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); go(ids[Math.min(ids.length - 1, i + 1)]); break;
      case 'ArrowUp': ev.preventDefault(); go(ids[Math.max(0, i - 1)]); break;
      case 'Home': ev.preventDefault(); go(ids[0]); break;
      case 'End': ev.preventDefault(); go(ids[ids.length - 1]); break;
      case 'ArrowRight':
        ev.preventDefault();
        if (e && kidsOf(e.id).length) { if (!ctx.expanded.has(e.id)) toggle(e.id); else go(kidsOf(e.id)[0].id); }
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        if (e && ctx.expanded.has(e.id) && kidsOf(e.id).length) toggle(e.id);
        else if (e?.owner && ctx.model.get(e.owner)?.owner) go(e.owner); // up to the parent, but never to the hidden root
        break;
      case 'Enter':
        if (!e) return;
        ev.preventDefault();
        if (isDiagram(e.kind)) ctx.open(e.id);
        else if (e.layer) toggle(e.id);
        else if (ctx.openProps) ctx.openProps(e.id);
        else startRename(e.id);
        break;
      case 'F2': if (e && !e.layer) { ev.preventDefault(); startRename(e.id); } break;
      case 'ContextMenu': if (e) { ev.preventDefault(); const row = /** @type {HTMLElement} */ (el.querySelector(`[data-id="${e.id}"]`)); const r = row.getBoundingClientRect(); contextMenu(row, e, { x: r.left + 24, y: r.bottom }); } break;
      default: return;
    }
    ev.stopPropagation(); // handled here; keep the global shortcut from running too
  });

  /** Show only elements whose name contains `q` (and the packages they are in). @param {string} q */
  function setFilter(q) {
    const f = q.trim().toLowerCase();
    if (f) setFilterQuiet(f); else { filter = ''; keep = null; hits = new Set(); }
    render();
  }

  function render() {
    const hadFocus = el.contains(document.activeElement);
    const m = ctx.model;
    if (filter) { const q = filter; filter = ''; keep = null; setFilterQuiet(q); }
    // the selected element's ancestors are always open, so a selection is never hidden
    const sel = ctx.selected();
    // (only when the selection changes, so you can still fold a folder with the selection inside)
    if (sel !== revealed) { revealed = sel; if (sel && m.get(sel) && !isRel(/** @type {Element} */ (m.get(sel)).kind) && !keep) for (const a of m.path(sel)) ctx.expanded.add(a.id); }
    const layers = keep ? m.layers().filter((l) => keep?.has(l.id)) : m.layers();
    el.replaceChildren(...layers.flatMap((l) => rows(l, 0)), ...(keep && !hits.size ? [h('div', { class: 'tree-empty' }, `Nothing named “${filter}”`)] : []), marker);
    marker.hidden = true;
    if (hadFocus && !renaming) focusSelected();
  }

  /** Fold everything except the layers. */
  function collapseAll() {
    for (const id of [...ctx.expanded]) if (!ctx.model.get(id)?.layer) ctx.expanded.delete(id);
    render();
  }

  /** Recompute the filter's matches without drawing (render draws). @param {string} q */
  function setFilterQuiet(q) {
    filter = q;
    keep = new Set(); hits = new Set();
    const m = ctx.model;
    for (const e of m.all()) {
      if (isRel(e.kind) || !e.owner || e.layer || (!ctx.showLines?.() && LINE_KINDS.has(e.kind))) continue;
      if (!e.name.toLowerCase().includes(q)) continue;
      hits.add(e.id); keep.add(e.id);
      for (const a of m.path(e.id)) keep.add(a.id);
    }
  }

  render();
  return { el, render, startRename, focus: focusSelected, collapseAll, setFilter, filtering: () => !!filter };
}
