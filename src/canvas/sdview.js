// Sequence diagrams. The layout follows the model: lifelines left to right in their order,
// messages top to bottom in their order, combined fragments around the messages inside them.
// Nothing is placed by hand, so the picture is always consistent with the model.
//
//   Drag from one lifeline to another (or the same) to add a message where you let go.
//   Drag a message up or down to move it, into or out of fragments.
//   Drag a lifeline's head left or right to reorder lifelines.
//   Double-click a message or a head to rename it. Delete removes the selection.
import { h, s, icon, toast, formatKeys } from '../ui/dom.js';
import { worst } from '../validate/engine.js';
import { popupMenu } from '../ui/menu.js';
import { ellipsize, FONTS, textWidth } from './measure.js';
import { kindName } from '../model/metamodel.js';
import { createRunPanel, emptyMarks } from '../ui/runpanel.js';
import { sequenceAdapter } from '../sim/adapters.js';
import { createToolPalette } from './tools.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */

const HEAD_Y = 24, HEAD_H = 46, TOP = HEAD_Y + HEAD_H + 30, ROW = 46, FRAG_HEAD = 30, OPERAND = 26, FRAG_END = 18, MIN_COL = 170;
export const OPERATORS = ['alt', 'opt', 'loop', 'par', 'break', 'critical'];

/** @param {string} t */
const esc = (t) => t.replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The picture of an interaction: lifeline columns, one row per message, fragment boxes, and
 * the slots where a dragged message could go.
 * @param {Model} m @param {string} interactionId
 */
export function sdLayout(m, interactionId) {
  const lifelines = m.children(interactionId).filter((c) => c.kind === 'lifeline');
  const label = (/** @type {Element} */ l) => {
    const r = l.props.represents ? m.get(l.props.represents) : undefined;
    const t = r?.kind === 'part' && r.props.type ? m.get(r.props.type)?.name : r && r.kind !== 'part' ? r.name : '';
    return t && t !== l.name ? `${l.name} : ${t}` : l.name;
  };
  const widths = lifelines.map((l) => Math.min(280, Math.max(MIN_COL, textWidth(label(l), FONTS.name) + 40)));
  /** @type {Map<string, number>} */
  const x = new Map();
  let cx = 40;
  lifelines.forEach((l, i) => { x.set(l.id, cx + widths[i] / 2); cx += widths[i] + 20; });
  /** @type {{ el: Element, y: number, from: number, to: number, depth: number }[]} */
  const messages = [];
  /** @type {{ el: Element, y0: number, y1: number, depth: number, operands: { el: Element, y: number }[], cols: number[] }[]} */
  const fragments = [];
  /** @type {{ y: number, owner: string, index: number, depth: number }[]} */
  const slots = [];
  let y = TOP;
  /** Lay out a container's messages and fragments; returns the lifeline x's it touches. @param {string} owner @param {number} depth @returns {number[]} */
  function walk(owner, depth) {
    /** @type {number[]} */
    const cols = [];
    const items = m.children(owner).filter((c) => c.kind === 'message' || c.kind === 'fragment');
    items.forEach((c, i) => {
      slots.push({ y, owner, index: m.children(owner).indexOf(c), depth });
      if (c.kind === 'message') {
        const fx = x.get(c.props.from) ?? 0, tx = x.get(c.props.to) ?? 0;
        messages.push({ el: c, y: y + ROW - 14, from: fx, to: tx, depth });
        cols.push(fx, tx);
        y += ROW + (fx === tx ? 14 : 0);
      } else {
        const f = { el: c, y0: y, y1: 0, depth, operands: /** @type {{ el: Element, y: number }[]} */ ([]), cols: /** @type {number[]} */ ([]) };
        fragments.push(f);
        y += FRAG_HEAD - OPERAND;
        for (const op of m.children(c.id).filter((k) => k.kind === 'operand')) {
          f.operands.push({ el: op, y });
          y += OPERAND;
          f.cols.push(...walk(op.id, depth + 1));
          if (!m.children(op.id).some((k) => k.kind === 'message' || k.kind === 'fragment')) y += 14;
        }
        y += FRAG_END;
        f.y1 = y;
        y += 10;
        cols.push(...f.cols);
      }
      if (i === items.length - 1) slots.push({ y, owner, index: Infinity, depth });
    });
    if (!items.length) slots.push({ y, owner, index: Infinity, depth });
    return cols;
  }
  walk(interactionId, 0);
  const width = Math.max(cx + 20, 400), height = y + 40;
  for (const f of fragments) if (!f.cols.length) f.cols = lifelines.length ? [/** @type {number} */ (x.get(lifelines[0].id))] : [60];
  return { lifelines, label, x, widths, messages, fragments, slots, width, height };
}

/**
 * @param {{
 *   model: Model, diagramId: string,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 *   problemsFor?: (id: string) => import('../validate/engine.js').Problem[],
 *   showProblems?: (id: string) => void,
 * }} ctx
 */
export function createSequenceView(ctx) {
  const { model, diagramId } = ctx;
  const sd = () => /** @type {Element} */ (model.get(diagramId));
  const owner = () => /** @type {string} */ (sd()?.owner);
  let k = 1, raf = 0;
  /** @type {ReturnType<typeof sdLayout> | null} */
  let L = null;
  /** @type {null | { mode: 'message', from: string, x: number, y: number } | { mode: 'move', id: string, y: number, moved: boolean } | { mode: 'head', id: string, x: number, moved: boolean }} */
  let drag = null;
  /** Where a drag would land, for the preview. @type {{ y: number } | null} */
  let ghostSlot = null;

  const svg = s('svg', { class: 'sdsvg' });
  const stage = h('div', { class: 'sdstage', tabindex: '0', role: 'application', 'aria-roledescription': 'sequence diagram' }, svg);
  const zoomLabel = h('span', { class: 'dzoom mono' });
  const n = () => ctx.notation();
  /** The kind of message the next drag between lifelines makes (a palette tool), and whether it stays armed. */
  let nextMsg = { kind: 'sync', sticky: false, armed: false };
  const MSG_HELP = /** @type {Record<string, [string, string]>} */ ({
    sync: ['Call', 'A synchronous message: the sender waits for the answer.'],
    async: ['Signal', 'An asynchronous message: the sender carries on.'],
    reply: ['Reply', 'The answer to a call, back to the caller.'],
    create: ['Create', 'Creates the lifeline it goes to.'],
  });
  const palette = createToolPalette({
    items: () => [
      { id: 'select', label: 'Select', symbol: 'pointer', help: 'Select messages and lifelines. Drag a message up or down to move it; drag a lifeline\'s head to reorder.', group: 'select', type: 'select' },
      { id: 'lifeline', label: kindName('lifeline', ctx.notation()), symbol: 'lifeline', help: 'Add a participant: a part, an actor, or a free lifeline.', hint: 'Click to choose what it represents.', group: 'element', type: 'menu' },
      { id: 'fragment', label: kindName('fragment', ctx.notation()), symbol: 'fragment', help: 'A combined fragment (alt, opt, loop, par…) around the selected message, or an empty one.', hint: 'Click to choose its operator.', group: 'element', type: 'menu' },
      { id: 'operand', label: kindName('operand', ctx.notation()), symbol: 'operand', help: 'Another case for the selected fragment.', hint: 'Select a fragment first.', group: 'element', type: 'run' },
      ...Object.entries(MSG_HELP).map(([k, [label, help]]) => ({ id: `msg:${k}`, label, symbol: k, help, hint: 'Click, then drag from one lifeline to another. Double-click to keep it for several.', group: /** @type {const} */ ('relationship'), type: /** @type {const} */ ('link') })),
    ],
    labels: () => !!ctx.settings?.get().paletteLabels,
    setLabels: (on) => ctx.settings?.update((st) => { st.paletteLabels = on; }),
    pick(item, sticky, button) {
      if (item.id === 'lifeline') lifelineMenu(button);
      else if (item.id === 'fragment') fragmentMenu(button);
      else if (item.id === 'operand') addOperand();
      else if (item.id.startsWith('msg:')) {
        const k = item.id.slice(4);
        nextMsg = nextMsg.armed && nextMsg.kind === k && !sticky ? { kind: 'sync', sticky: false, armed: false } : { kind: k, sticky, armed: true };
        palette.setActive(nextMsg.armed ? item.id : 'select', nextMsg.sticky);
        return;
      }
      if (!nextMsg.sticky) { nextMsg = { kind: 'sync', sticky: false, armed: false }; palette.setActive('select'); }
    },
  });
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Sequence tools' },
    h('button', { class: 'btn sm run-btn', type: 'button', title: 'Play the scenario message by message, and check it for problems', onclick: () => toggleRun() }, icon('play'), 'Play'),
    h('span', { class: 'dtool-hint' }, 'Drag between lifelines to add a message; drag a message to move it'),
    h('span', { style: { flex: '1' } }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom out', onclick: () => { k = Math.max(0.4, k / 1.2); render(); } }, icon('minus')),
    zoomLabel,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom in', onclick: () => { k = Math.min(2.5, k * 1.2); render(); } }, icon('plus')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fit to window', onclick: () => fit() }, icon('fit')),
    ctx.image ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy or download as a picture', title: `Copy or download as a picture (PNG, SVG). ${formatKeys('Mod+Alt+C')} copies at once`, onclick: () => ctx.image?.() }, icon('image')) : null);
  const dbody = h('div', { class: 'dbody' }, palette.el, stage);
  const el = h('div', { class: 'dview sdview' }, toolbar, dbody);
  /** What the run panel lights up. */
  let marks = emptyMarks();
  /** @type {ReturnType<typeof createRunPanel> | null} */
  let runPanel = null;
  function toggleRun(open = !runPanel) {
    if (!open) { runPanel?.dispose(); runPanel?.el.remove(); runPanel = null; marks = emptyMarks(); invalidate(); return; }
    if (runPanel) return;
    runPanel = createRunPanel({
      adapter: () => sequenceAdapter(model, owner()),
      onMarks: (mk) => { marks = mk; invalidate(); },
      onSelect: (ids) => { if (ids[0]) ctx.select(ids[0]); },
      onClose: () => toggleRun(false),
    });
    dbody.append(runPanel.el);
  }
  /** The color of a lifeline's head: its part's layer, or the actor color. @param {Element} l */
  const tintOf = (l) => {
    const r = l.props.represents ? model.get(l.props.represents) : undefined;
    if (!r) return '';
    if (r.kind === 'actor') return 'var(--accent)';
    const layer = model.layerOf(r.kind === 'part' && r.props.type ? r.props.type : r.id);
    return layer ? `var(--layer-${layer})` : '';
  };

  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function render() {
    palette.sync(ctx.notation());
    if (!sd()) return;
    L = sdLayout(model, owner());
    const sel = ctx.selected();
    zoomLabel.textContent = `${Math.round(k * 100)}%`;
    svg.setAttribute('width', String(Math.round(L.width * k)));
    svg.setAttribute('height', String(Math.round(L.height * k)));
    svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
    const out = [];
    if (!L.lifelines.length) out.push(`<text class="sd-empty" x="40" y="60">Add a lifeline to start: the parts of ${esc(model.get(model.get(owner())?.owner || '')?.name || 'the block')}, or actors.</text>`);
    // fragments (behind)
    for (const f of L.fragments) {
      const x0 = Math.min(...f.cols) - 70 + f.depth * 8, x1 = Math.max(...f.cols) + 70 - f.depth * 8;
      const on = f.el.id === sel || f.operands.some((o) => o.el.id === sel);
      const op = /** @type {string} */ (f.el.props.operator);
      const tw = Math.max(36, textWidth(op, FONTS.name) + 22);
      const run = marks.nodes.get(f.el.id);
      out.push(`<g class="sd-frag op-${esc(op)}${run ? ' run-' + run : ''}${on ? ' sel' : ''}" data-id="${f.el.id}"><rect class="sd-frame" x="${x0}" y="${f.y0}" width="${x1 - x0}" height="${f.y1 - f.y0}" rx="4"/>`
        + `<path class="sd-tab" d="M${x0} ${f.y0 + 20} V${f.y0} H${x0 + tw} V${f.y0 + 12} L${x0 + tw - 8} ${f.y0 + 20} Z"/><text class="sd-op" x="${x0 + 8}" y="${f.y0 + 14}">${esc(op)}</text></g>`);
      f.operands.forEach((o, i) => {
        if (i > 0) out.push(`<line class="sd-sep" x1="${x0}" x2="${x1}" y1="${o.y - 4}" y2="${o.y - 4}"/>`);
        const g = o.el.props.guard ? `[${o.el.props.guard}]` : (i > 0 && op === 'alt' ? '[else]' : '');
        out.push(`<text class="sd-guard${o.el.id === sel ? ' sel' : ''}" data-id="${o.el.id}" x="${x0 + (i ? 10 : tw + 8)}" y="${o.y + 12}">${esc(ellipsize(g || (i ? '' : ' '), x1 - x0 - tw - 20, FONTS.label))}</text>`);
      });
    }
    // lifelines
    L.lifelines.forEach((l, i) => {
      const x = /** @type {number} */ (L?.x.get(l.id)), w = /** @type {number} */ (L?.widths[i]);
      const on = l.id === sel;
      out.push(`<line class="sd-life" x1="${x}" x2="${x}" y1="${HEAD_Y + HEAD_H}" y2="${(L?.height || 0) - 20}"/>`
        + `<rect class="sd-life-hit" data-life="${l.id}" x="${x - 12}" y="${HEAD_Y + HEAD_H}" width="24" height="${(L?.height || 0) - HEAD_Y - HEAD_H}"/>`
        + `<g class="sd-head${marks.nodes.get(l.id) ? ' run-' + marks.nodes.get(l.id) : ''}${on ? ' sel' : ''}" data-head="${l.id}" style="--tint:${tintOf(l) || 'var(--text-3)'}"><rect x="${x - w / 2 + 6}" y="${HEAD_Y}" width="${w - 12}" height="${HEAD_H}" rx="8"/>`
        + `<text x="${x}" y="${HEAD_Y + 28}">${esc(ellipsize(L?.label(l) || '', w - 28, FONTS.name))}</text></g>`);
    });
    // messages
    for (const msg of L.messages) {
      const kind = msg.el.props.msgKind, on = msg.el.id === sel;
      const self = msg.from === msg.to;
      const dir = msg.to >= msg.from ? 1 : -1;
      const path = self ? `M${msg.from} ${msg.y} H${msg.from + 46} V${msg.y + 16} H${msg.from + 3}` : `M${msg.from} ${msg.y} H${msg.to - dir * 2}`;
      const tip = self ? { x: msg.from + 3, y: msg.y + 16, d: -1 } : { x: msg.to - dir * 2, y: msg.y, d: dir };
      const head = kind === 'sync'
        ? `<path class="sd-ahead solid" d="M${tip.x} ${tip.y} L${tip.x - tip.d * 10} ${tip.y - 5} L${tip.x - tip.d * 10} ${tip.y + 5} Z"/>`
        : `<path class="sd-ahead" d="M${tip.x - tip.d * 10} ${tip.y - 5} L${tip.x} ${tip.y} L${tip.x - tip.d * 10} ${tip.y + 5}"/>`;
      const lx = self ? msg.from + 52 : (msg.from + msg.to) / 2;
      const maxW = self ? 220 : Math.max(60, Math.abs(msg.to - msg.from) - 16);
      const run = marks.edges.get(msg.el.id);
      out.push(`<g class="sd-msg ${kind}${run ? ' run-' + run : ''}${on ? ' sel' : ''}" data-id="${msg.el.id}"><path class="sd-hit" d="${path}"/><path class="sd-line" d="${path}"/>${head}`
        + `<text class="sd-label" x="${lx}" y="${msg.y - 7}" text-anchor="${self ? 'start' : 'middle'}">${esc(ellipsize(msg.el.name, maxW, FONTS.label))}</text></g>`);
    }
    // problem badges: on lifeline heads, and beside message names
    const badge = (/** @type {string} */ id, /** @type {number} */ bx, /** @type {number} */ by) => {
      const probs = ctx.problemsFor?.(id) || [];
      if (!probs.length) return;
      out.push(`<g class="pbadge sev-${worst(probs)}" data-badge="${esc(id)}" transform="translate(${bx} ${by})"><title>${esc(probs.map((p) => p.message).join('\n'))}</title><circle r="8.5"/><text y="3.5">${probs.length > 9 ? '9+' : probs.length}</text></g>`);
    };
    L.lifelines.forEach((l, i) => badge(l.id, /** @type {number} */ (L?.x.get(l.id)) + /** @type {number} */ (L?.widths[i]) / 2 - 9, HEAD_Y + 3));
    for (const msg of L.messages) {
      const self = msg.from === msg.to;
      const lx = self ? msg.from + 52 : (msg.from + msg.to) / 2;
      const tw = Math.min(self ? 220 : Math.max(60, Math.abs(msg.to - msg.from) - 16), textWidth(msg.el.name, FONTS.label));
      badge(msg.el.id, self ? lx + tw + 12 : lx + tw / 2 + 12, msg.y - 11);
    }
    if (drag?.mode === 'message') out.push(`<path class="link-ghost" d="M${L.x.get(drag.from)} ${drag.y} L${drag.x} ${drag.y}"/>`);
    if (ghostSlot) out.push(`<line class="sd-slot" x1="20" x2="${L.width - 20}" y1="${ghostSlot.y}" y2="${ghostSlot.y}"/>`);
    svg.innerHTML = out.join('');
  }

  // ---------- editing ----------
  /** The slot nearest a y. @param {number} y */
  const slotAt = (y) => { let best = L?.slots[0], d = Infinity; for (const sl of L?.slots || []) { const dd = Math.abs(sl.y - y) - sl.depth * 0.1; if (dd < d) { d = dd; best = sl; } } return best; };
  /** The lifeline nearest an x. @param {number} x */
  const lifeAt = (x) => { let best = null, d = 60; for (const [id, lx] of L?.x || []) { const dd = Math.abs(lx - x); if (dd < d) { d = dd; best = id; } } return best; };
  /** @param {MouseEvent} ev */
  const point = (ev) => { const b = svg.getBoundingClientRect(); return { x: (ev.clientX - b.left) / k, y: (ev.clientY - b.top) / k }; };

  /** @param {string} from @param {string} to @param {{ owner: string, index: number } | undefined} slot */
  function addMessage(from, to, slot) {
    if (!slot) return;
    let id = '';
    const count = model.byKind('message').length;
    if (ctx.edit('New message', (tx) => { id = tx.create('message', { owner: slot.owner, index: slot.index, name: `message${count + 1}()`, props: { from, to, msgKind: nextMsg.kind } }); })) {
      if (!nextMsg.sticky) { nextMsg = { kind: 'sync', sticky: false, armed: false }; palette.setActive('select'); }
      ctx.select(id); render(); startRename(id);
    }
  }
  /** @param {HTMLElement} anchor */
  function lifelineMenu(anchor) {
    const o = model.get(owner());
    const ctxBlock = o?.owner ? model.get(o.owner) : undefined;
    const parts = ctxBlock?.kind === 'partDef' ? model.children(ctxBlock.id).filter((c) => c.kind === 'part') : [];
    const taken = new Set(model.children(owner()).filter((c) => c.kind === 'lifeline').map((c) => c.props.represents));
    const add = (/** @type {string} */ name, /** @type {string | null} */ rep) => {
      let id = '';
      if (ctx.edit('New lifeline', (tx) => { id = tx.create('lifeline', { owner: owner(), name, props: { represents: rep } }); })) { ctx.select(id); if (!rep) startRename(id); }
    };
    const items = [
      ...parts.filter((p) => !taken.has(p.id)).map((p) => ({ label: p.name, hint: 'part', run: () => add(p.name, p.id) })),
      ...model.byKind('actor').filter((a) => !taken.has(a.id)).map((a) => ({ label: a.name, hint: 'actor', run: () => add(a.name.toLowerCase().replace(/\s+/g, ''), a.id) })),
      ...model.byKind('partDef').filter((b) => !taken.has(b.id)).slice(0, 25).map((b) => ({ label: b.name, hint: 'block', run: () => add(b.name.charAt(0).toLowerCase() + b.name.slice(1).replace(/\s+/g, ''), b.id) })),
    ];
    popupMenu(anchor, [...items, ...(items.length ? /** @type {const} */ (['sep']) : []), { label: 'An empty lifeline', run: () => add('participant', null) }], { title: 'Add a lifeline for' });
  }
  /** @param {HTMLElement} anchor */
  function fragmentMenu(anchor) {
    popupMenu(anchor, OPERATORS.map((op) => ({ label: op, hint: { alt: 'one of', opt: 'maybe', loop: 'repeat', par: 'parallel', break: 'stop', critical: 'atomic' }[op], run: () => wrap(op) })), { title: 'Combined fragment' });
  }
  /** Put the selected message in a new fragment, or add an empty fragment at the end. @param {string} op */
  function wrap(op) {
    const msg = model.get(ctx.selected() || '');
    let fid = '';
    ctx.edit(`New ${op} fragment`, (tx) => {
      if (msg?.kind === 'message') {
        const own = /** @type {string} */ (msg.owner);
        fid = tx.create('fragment', { owner: own, index: model.children(own).indexOf(msg), name: `${op} ${model.byKind('fragment').length + 1}`, props: { operator: op } });
        const opd = tx.create('operand', { owner: fid, name: 'Operand 1' });
        tx.move(msg.id, opd);
        if (op === 'alt') tx.create('operand', { owner: fid, name: 'Operand 2' });
      } else {
        fid = tx.create('fragment', { owner: owner(), name: `${op} ${model.byKind('fragment').length + 1}`, props: { operator: op } });
        tx.create('operand', { owner: fid, name: 'Operand 1' });
        if (op === 'alt') tx.create('operand', { owner: fid, name: 'Operand 2' });
      }
    });
    if (fid) { ctx.select(fid); toast(msg?.kind === 'message' ? `Put ${msg.name} in a new ${op} fragment. Set its guard in the inspector.` : `Added an empty ${op} fragment. Drag messages into it.`); }
  }
  function addOperand() {
    const e = model.get(ctx.selected() || '');
    const frag = e?.kind === 'fragment' ? e : e?.kind === 'operand' ? model.get(/** @type {string} */ (e.owner)) : undefined;
    if (!frag) { toast('Select a fragment first'); return; }
    let id = '';
    if (ctx.edit('New operand', (tx) => { id = tx.create('operand', { owner: frag.id, name: `Operand ${model.children(frag.id).length + 1}` }); })) ctx.select(id);
  }

  /** @param {string} id */
  function startRename(id) {
    const e = model.get(id);
    if (!e || !L) return;
    const msg = L.messages.find((x) => x.el.id === id);
    const li = L.lifelines.findIndex((x) => x.id === id);
    if (!msg && li < 0) return;
    const sb = stage.getBoundingClientRect(), vb = svg.getBoundingClientRect();
    const x = msg ? Math.min(msg.from, msg.to) : /** @type {number} */ (L.x.get(id)) - L.widths[li] / 2 + 8;
    const w = msg ? Math.max(120, Math.abs(msg.to - msg.from)) : L.widths[li] - 16;
    const y = msg ? msg.y - 26 : HEAD_Y + 10;
    const input = h('input', { class: 'drename', type: 'text', value: e.name, 'aria-label': 'Name', maxlength: 500 });
    Object.assign(input.style, { left: `${vb.left - sb.left + stage.scrollLeft + x * k}px`, top: `${vb.top - sb.top + stage.scrollTop + y * k}px`, width: `${w * k}px` });
    let done = false;
    const finish = (/** @type {boolean} */ ok) => { if (done) return; done = true; input.remove(); const v = input.value.trim(); if (ok && v && v !== e.name) ctx.edit('Rename', (tx) => tx.rename(id, v)); stage.focus(); };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    stage.append(input);
    input.focus(); input.select();
  }

  // ---------- pointer ----------
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target instanceof HTMLInputElement) return;
    stage.focus({ preventScroll: true });
    const t = /** @type {Element} */ (ev.target), p = point(ev);
    if (t.closest('[data-badge]') && ctx.showProblems) { ctx.showProblems(/** @type {string} */ (/** @type {SVGElement} */ (t.closest('[data-badge]')).dataset.badge)); return; }
    const head = t.closest('[data-head]'), life = t.closest('[data-life]'), item = t.closest('[data-id]');
    if (head) { const id = /** @type {string} */ (/** @type {SVGElement} */ (head).dataset.head); ctx.select(id); drag = { mode: 'head', id, x: p.x, moved: false }; }
    else if (item && model.get(/** @type {string} */ (/** @type {SVGElement} */ (item).dataset.id))?.kind === 'message') { const id = /** @type {string} */ (/** @type {SVGElement} */ (item).dataset.id); ctx.select(id); drag = { mode: 'move', id, y: p.y, moved: false }; }
    else if (item) { ctx.select(/** @type {string} */ (/** @type {SVGElement} */ (item).dataset.id)); return; }
    else if (life) { const from = /** @type {string} */ (/** @type {SVGElement} */ (life).dataset.life); drag = { mode: 'message', from, x: p.x, y: p.y }; }
    else { ctx.select(null); return; }
    try { stage.setPointerCapture(ev.pointerId); } catch { /* a pointer that already ended */ }
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = point(ev);
    if (drag.mode === 'message') { drag.x = p.x; ghostSlot = slotAt(drag.y) || null; render(); }
    else if (drag.mode === 'move') { if (Math.abs(p.y - drag.y) > 6) drag.moved = true; if (drag.moved) { ghostSlot = slotAt(p.y) || null; render(); } }
    else if (drag.mode === 'head') { if (Math.abs(p.x - drag.x) > 6) drag.moved = true; }
  });
  stage.addEventListener('pointerup', (ev) => {
    const d = drag; drag = null; ghostSlot = null;
    if (!d || !L) { render(); return; }
    const p = point(ev);
    if (d.mode === 'message') {
      const to = lifeAt(p.x);
      if (to) addMessage(d.from, to, slotAt(d.y)); else render();
    } else if (d.mode === 'move' && d.moved) {
      const sl = slotAt(p.y), msg = model.get(d.id);
      if (sl && msg) {
        const list = model.children(sl.owner).map((c) => c.id);
        let index = sl.index === Infinity ? list.length : sl.index;
        if (msg.owner === sl.owner && list.indexOf(d.id) < index) index--;
        if (msg.owner !== sl.owner || list.indexOf(d.id) !== index) ctx.edit('Move message', (tx) => tx.move(d.id, sl.owner, index));
      }
      render();
    } else if (d.mode === 'head' && d.moved) {
      const order = L.lifelines.map((l) => ({ id: l.id, x: l.id === d.id ? p.x : /** @type {number} */ (L?.x.get(l.id)) })).sort((a, b) => a.x - b.x).map((x) => x.id);
      const all = model.children(owner()).map((c) => c.id);
      const firstLife = all.findIndex((id) => model.get(id)?.kind === 'lifeline');
      const index = firstLife + order.indexOf(d.id);
      if (all.indexOf(d.id) !== index) ctx.edit('Reorder lifelines', (tx) => tx.move(d.id, owner(), index));
      render();
    } else render();
  });
  // double-click a message or lifeline: its properties
  stage.addEventListener('dblclick', (ev) => {
    const t = /** @type {Element} */ (document.elementFromPoint(ev.clientX, ev.clientY) || ev.target);
    const id = /** @type {SVGElement | null} */ (t.closest('[data-head]'))?.dataset.head || /** @type {SVGElement | null} */ (t.closest('[data-id]'))?.dataset.id;
    if (!id) return;
    if (ctx.openProps && model.get(id)) ctx.openProps(id); else startRename(id);
  });
  stage.addEventListener('keydown', (ev) => {
    if (ev.target !== stage) return;
    if (runPanel && !ev.metaKey && !ev.ctrlKey && runPanel.key(ev)) { ev.preventDefault(); ev.stopPropagation(); return; }
    if ((ev.key === 'Enter' || ev.key === 'F2') && ctx.selected()) { ev.preventDefault(); ev.stopPropagation(); startRename(/** @type {string} */ (ctx.selected())); }
  });

  function fit() {
    if (!L) render();
    const w = stage.clientWidth - 20, hh = stage.clientHeight - 20;
    if (L && w > 0 && hh > 0) k = Math.max(0.4, Math.min(1.25, w / L.width, hh / L.height));
    render();
  }

  const unsub = model.subscribe(() => { runPanel?.refresh(); invalidate(); });
  invalidate();
  return {
    el, render, invalidate, fit,
    syncSelection: () => invalidate(),
    focus: () => stage.focus({ preventScroll: true }),
    layout: () => L,
    toggleRun: (/** @type {boolean | undefined} */ open) => toggleRun(open),
    canRun: () => true,
    dispose() { cancelAnimationFrame(raf); unsub(); runPanel?.dispose(); palette.dispose(); },
  };
}

export { kindName };
