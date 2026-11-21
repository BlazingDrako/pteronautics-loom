// The properties panel: everything about one element, editable in place, in a floating window
// over the workspace (double-click an element on a diagram or in the browser, or press
// Mod+.). With no element it shows the project: its files, exchange, display and rules.
// While open it follows the selection, so you can click through elements and edit each.
// Drag it by its title bar and resize it from its corner; it opens where you left it.
import { h, icon, formatKeys } from './dom.js';
import { createInspector } from './inspector.js';
import { kindName, ELEMENTS } from '../model/metamodel.js';

/**
 * @param {Omit<import('./inspector.js').InspectorCtx, 'selected'> & {
 *   select: (id: string | null) => void,
 *   onOpenChange?: () => void,
 * }} ctx
 */
export function createPropsPanel(ctx) {
  /** The element shown, or null for the project. @type {string | null} */
  let shown = null;
  let open = false;
  /** Where focus was before the panel opened, to give it back. @type {HTMLElement | null} */
  let returnTo = null;

  const inspector = createInspector({
    ...ctx,
    selected: () => shown,
    // links inside the panel (a relationship's other end, a child) move the panel there too
    select: (id) => { if (id) shown = id; ctx.select(id); render(); },
  });
  const title = h('div', { class: 'ppanel-title' });
  const closeBtn = h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Close properties', title: 'Close (Esc)', onclick: () => hide() }, icon('x'));
  const head = h('div', { class: 'ppanel-head' }, h('span', { class: 'ppanel-grip', 'aria-hidden': 'true' }, icon('grip')), title, closeBtn);
  const el = h('section', { class: 'ppanel', role: 'dialog', 'aria-label': 'Properties', hidden: true }, head, inspector.el);

  // ---------- place and size ----------
  const MARGIN = 12;
  function place() {
    const saved = ctx.settings.get().props;
    const w = Math.min(saved?.w || 380, innerWidth - 2 * MARGIN);
    const hgt = Math.min(saved?.h || Math.round(innerHeight * 0.72), innerHeight - 2 * MARGIN);
    const x = saved ? saved.x : innerWidth - w - 20;
    const y = saved ? saved.y : 96;
    el.style.width = `${w}px`; el.style.height = `${hgt}px`;
    moveTo(x, y);
  }
  /** @param {number} x @param {number} y */
  function moveTo(x, y) {
    const r = el.getBoundingClientRect();
    const w = r.width || parseFloat(el.style.width) || 380, hh = r.height || parseFloat(el.style.height) || 400;
    el.style.left = `${Math.round(Math.min(Math.max(MARGIN, x), innerWidth - Math.min(w, innerWidth - 2 * MARGIN) - MARGIN))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(MARGIN, y), innerHeight - Math.min(hh, innerHeight - 2 * MARGIN) - MARGIN))}px`;
  }
  const remember = () => {
    const r = el.getBoundingClientRect();
    if (!open || !r.width) return;
    const cur = ctx.settings.get().props;
    const next = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    if (!cur || cur.x !== next.x || cur.y !== next.y || cur.w !== next.w || cur.h !== next.h) ctx.settings.update((s) => { s.props = next; });
  };
  head.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || /** @type {Element} */ (ev.target).closest('button')) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    head.setPointerCapture(ev.pointerId);
    el.classList.add('moving');
    const move = (/** @type {PointerEvent} */ e) => moveTo(e.clientX - dx, e.clientY - dy);
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); el.classList.remove('moving'); remember(); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });
  head.addEventListener('dblclick', (ev) => { if (!(/** @type {Element} */ (ev.target).closest('button'))) { ctx.settings.update((s) => { s.props = null; }); place(); } });
  // resizing is the browser's own corner handle; remember the size when it settles
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let sizeTimer;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { clearTimeout(sizeTimer); sizeTimer = setTimeout(remember, 300); }) : null;
  ro?.observe(el);
  const onWinResize = () => { if (open) { const r = el.getBoundingClientRect(); moveTo(r.left, r.top); } };
  addEventListener('resize', onWinResize);

  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement)) { ev.stopPropagation(); hide(); }
  });

  function render() {
    if (!open) return;
    if (shown && !ctx.model.get(shown)) { hide(); return; } // its element was deleted
    const e = shown ? ctx.model.get(shown) : null;
    const n = ctx.settings.get().notation;
    title.replaceChildren(
      h('span', { class: 'ppanel-kind' }, e ? (e.layer ? 'RFLP layer' : kindName(e.kind, n)) : 'Project'),
      h('span', { class: 'ppanel-name', title: e ? e.name : ctx.model.root().name }, e ? e.name : ctx.model.root().name));
    el.dataset.kind = e ? e.kind : 'project';
    inspector.render();
  }

  /**
   * Open the panel on an element (or the project, with null).
   * @param {string | null} id @param {{ focusName?: boolean }} [o]
   */
  function show(id, o = {}) {
    shown = id && ctx.model.get(id) ? id : null;
    if (!open) {
      returnTo = document.activeElement instanceof HTMLElement && !el.contains(document.activeElement) ? document.activeElement : null;
      open = true; el.hidden = false; place();
      ctx.onOpenChange?.();
    }
    render();
    if (o.focusName) {
      const name = /** @type {HTMLInputElement | null} */ (inspector.el.querySelector('input.field'));
      name?.focus(); name?.select();
    } else closeBtn.focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    remember();
    open = false; el.hidden = true;
    ctx.onOpenChange?.();
    returnTo?.focus({ preventScroll: true });
    returnTo = null;
  }
  return {
    el,
    show, hide, render,
    isOpen: () => open,
    shown: () => shown,
    /** The selection changed: follow it (an empty selection keeps what is shown). @param {string | null} id */
    follow(id) { if (!open) return; if (id && ctx.model.get(id)) shown = id; render(); },
    /** Open on the selection, or close if already showing it. @param {string | null} id */
    toggle(id) { if (open && (shown === id || !id)) hide(); else show(id); },
    hint: () => `Properties (${formatKeys('Mod+.')})`,
    dispose() { ro?.disconnect(); removeEventListener('resize', onWinResize); clearTimeout(sizeTimer); },
    /** Is this element kind one the panel edits (everything but relationships)? @param {string} kind */
    edits: (kind) => kind in ELEMENTS,
  };
}
