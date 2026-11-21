// The dependency matrix: one set of elements down the side, another across the top, and a
// mark wherever a relationship goes from the row to the column. Click a cell (or press Space)
// to add or remove that relationship. Rows and columns with nothing in them are flagged, which
// is how gaps show up: a requirement column with no mark has nothing satisfying it.
//
// The grid is virtualized in both directions, so thousands of rows and columns stay fast.
import { h, icon, toast } from '../ui/dom.js';
import { download } from '../ui/home.js';
import { ELEMENTS, RELATIONSHIPS, kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */

/** The element sets a matrix can use for rows or columns. */
export const SETS = /** @type {Record<string, { label: string, kind: string, layer?: string }>} */ ({
  requirement: { label: 'Requirements', kind: 'requirement' },
  testCase: { label: 'Test cases', kind: 'testCase' },
  action: { label: 'Functions', kind: 'action' },
  partDef: { label: 'All blocks', kind: 'partDef' },
  'partDef@l': { label: 'Logical blocks', kind: 'partDef', layer: 'l' },
  'partDef@p': { label: 'Physical blocks', kind: 'partDef', layer: 'p' },
  part: { label: 'Parts', kind: 'part' },
  interfaceDef: { label: 'Interface blocks', kind: 'interfaceDef' },
});

/** Ready-made matrices. */
export const PRESETS = [
  { id: 'satisfy', label: 'Blocks satisfy requirements', rows: 'partDef', cols: 'requirement', rel: 'satisfy' },
  { id: 'verify', label: 'Test cases verify requirements', rows: 'testCase', cols: 'requirement', rel: 'verify' },
  { id: 'derive', label: 'Requirements derived from requirements', rows: 'requirement', cols: 'requirement', rel: 'derive' },
  { id: 'refine', label: 'Functions refine requirements', rows: 'action', cols: 'requirement', rel: 'refine' },
  { id: 'alloc-fl', label: 'Functions allocated to logical blocks', rows: 'action', cols: 'partDef@l', rel: 'allocate' },
  { id: 'alloc-lp', label: 'Logical blocks allocated to physical', rows: 'partDef@l', cols: 'partDef@p', rel: 'allocate' },
];

export const CELL = 28, ROW_HEAD = 260, COL_HEAD = 168, TOTAL = 44;

/** Every element in model-browser order, so rows and columns read like the browser. @param {Model} m */
function browserOrder(m) {
  /** @type {Map<string, number>} */
  const order = new Map();
  let i = 0;
  /** @param {string} id */
  const walk = (id) => { order.set(id, i++); for (const c of m.children(id)) walk(c.id); };
  walk(m.root().id);
  return order;
}

/** Elements in a set, in browser order. @param {Model} m @param {string} set @param {Map<string, number>} [order] */
export function setMembers(m, set, order = browserOrder(m)) {
  const spec = SETS[set] || SETS.requirement;
  return m.byKind(spec.kind).filter((e) => !spec.layer || m.layerOf(e.id) === spec.layer).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** A row or column label: a requirement's ID and name, or the name. @param {Element} e */
export const labelOf = (e) => (e.kind === 'requirement' && e.props.reqId ? `${e.props.reqId}  ${e.name}` : e.kind === 'part' ? `${e.name}` : e.name);

/**
 * What a matrix shows.
 * @param {Model} m @param {{ rel: string, rows: string, cols: string, hideEmpty?: boolean }} o
 */
export function matrixData(m, o) {
  const order = browserOrder(m);
  let rows = setMembers(m, o.rows, order), cols = setMembers(m, o.cols, order);
  const rel = RELATIONSHIPS[o.rel] ? o.rel : 'satisfy';
  /** "row>col" → relationship id */
  const links = new Map();
  const rowSet = new Set(rows.map((e) => e.id)), colSet = new Set(cols.map((e) => e.id));
  /** @type {Map<string, number>} */
  const rowN = new Map(), colN = new Map();
  for (const r of m.byKind(rel)) {
    if (!r.source || !r.target || !rowSet.has(r.source) || !colSet.has(r.target)) continue;
    links.set(`${r.source}>${r.target}`, r.id);
    rowN.set(r.source, (rowN.get(r.source) || 0) + 1);
    colN.set(r.target, (colN.get(r.target) || 0) + 1);
  }
  if (o.hideEmpty) { rows = rows.filter((e) => rowN.has(e.id)); cols = cols.filter((e) => colN.has(e.id)); }
  return { rows, cols, links, rowN, colN, rel };
}

/** The matrix as CSV ("x" where related). @param {ReturnType<typeof matrixData>} d */
export function matrixCsv(d) {
  const q = (/** @type {string} */ v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['', ...d.cols.map(labelOf)].map(q).join(',')];
  for (const r of d.rows) lines.push([labelOf(r), ...d.cols.map((c) => (d.links.has(`${r.id}>${c.id}`) ? 'x' : ''))].map(q).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * @param {{
 *   model: Model, diagramId: string,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 * }} ctx
 */
export function createMatrixView(ctx) {
  const { model, diagramId } = ctx;
  const mx = () => /** @type {Element} */ (model.get(diagramId));
  /** @type {ReturnType<typeof matrixData>} */
  let data = { rows: [], cols: [], links: new Map(), rowN: new Map(), colN: new Map(), rel: 'satisfy' };
  let dirty = true, raf = 0;
  /** Hovered or keyboard-focused cell. @type {{ i: number, j: number } | null} */
  let hover = null;
  /** @type {{ i: number, j: number }} */
  let focus = { i: 0, j: 0 };

  // ---------- DOM ----------
  const n = () => ctx.notation();
  const select = (/** @type {string} */ label, /** @type {[string, string][]} */ options, /** @type {string} */ value, /** @type {(v: string) => void} */ onChange) => {
    const sel = h('select', { class: 'field sm', 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, selected: v === value ? true : undefined }, t)));
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Matrix tools' });
  const info = h('span', { class: 'tcount muted small' });
  const port = h('div', { class: 'mport' });
  const inner = h('div', { class: 'minner' }, port);
  const scroller = h('div', { class: 'mscroll', tabindex: '0', role: 'grid', 'aria-label': 'Dependency matrix' }, inner);
  const tip = h('div', { class: 'ctip', hidden: true });
  const el = h('div', { class: 'dview mview' }, toolbar, h('div', { class: 'mwrap' }, scroller, tip));

  function paintToolbar() {
    const p = mx().props;
    const preset = PRESETS.find((x) => x.rows === p.rows && x.cols === p.cols && x.rel === p.rel)?.id || '';
    const sets = /** @type {[string, string][]} */ (Object.entries(SETS).map(([k, v]) => [k, v.label]));
    const rels = /** @type {[string, string][]} */ (Object.keys(RELATIONSHIPS).map((k) => [k, RELATIONSHIPS[k].verb[n()]]));
    const set = (/** @type {Record<string, any>} */ patch, /** @type {string} */ label) => ctx.edit(label, (tx) => tx.setProps(diagramId, patch));
    toolbar.replaceChildren(
      select('Preset', [['', 'Custom'], ...PRESETS.map((x) => /** @type {[string, string]} */ ([x.id, x.label]))], preset, (v) => { const x = PRESETS.find((q) => q.id === v); if (x) set({ rows: x.rows, cols: x.cols, rel: x.rel }, `Matrix: ${x.label.toLowerCase()}`); }),
      h('span', { class: 'dtool-sep' }),
      h('span', { class: 'mlabel' }, 'Rows'), select('Rows', sets, p.rows, (v) => set({ rows: v }, 'Change matrix rows')),
      select('Relationship', rels, p.rel, (v) => set({ rel: v }, 'Change matrix relationship')),
      h('span', { class: 'mlabel' }, 'columns'), select('Columns', sets, p.cols, (v) => set({ cols: v }, 'Change matrix columns')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Swap rows and columns', title: 'Swap rows and columns (the relationship then goes the other way, so it may change)', onclick: () => swap() }, '⇄'),
      h('button', { class: 'btn sm', type: 'button', 'aria-pressed': String(!!p.hideEmpty), title: 'Hide rows and columns with no marks', onclick: () => set({ hideEmpty: !p.hideEmpty }, p.hideEmpty ? 'Show empty rows and columns' : 'Hide empty rows and columns') }, icon('filter'), 'Hide empty'),
      h('button', { class: 'btn sm', type: 'button', title: 'Download as a CSV file', onclick: () => { const name = `${mx().name.replace(/[^\w\- ]+/g, '').trim() || 'matrix'}.csv`; download(name, '﻿' + matrixCsv(data), 'text/csv'); toast(`Exported ${name}`); } }, icon('download'), 'CSV'),
      h('span', { style: { flex: '1' } }),
      info);
  }
  function swap() {
    const p = mx().props;
    // a relationship that cannot go the other way falls back to trace, which joins anything
    const rel = RELATIONSHIPS[p.rel];
    const ok = (/** @type {string[] | '*'} */ list, /** @type {string} */ set) => list === '*' || list.includes(SETS[set]?.kind);
    const next = ok(rel.sources, p.cols) && ok(rel.targets, p.rows) ? p.rel : 'trace';
    ctx.edit('Swap matrix rows and columns', (tx) => tx.setProps(diagramId, { rows: p.cols, cols: p.rows, rel: next }));
    if (next !== p.rel) toast(`${RELATIONSHIPS[p.rel].names[n()]} cannot go that way, so the matrix now shows ${RELATIONSHIPS[next].names[n()].toLowerCase()}`);
  }

  // ---------- rendering ----------
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  function render() {
    const d = mx();
    if (!d) return;
    if (dirty) {
      data = matrixData(model, { rel: d.props.rel, rows: d.props.rows, cols: d.props.cols, hideEmpty: d.props.hideEmpty });
      dirty = false;
      paintToolbar();
      focus = { i: Math.min(focus.i, Math.max(0, data.rows.length - 1)), j: Math.min(focus.j, Math.max(0, data.cols.length - 1)) };
    }
    const { rows, cols, links, rowN, colN } = data;
    const W = ROW_HEAD + cols.length * CELL + TOTAL, H = COL_HEAD + rows.length * CELL + TOTAL;
    inner.style.width = `${W}px`; inner.style.height = `${H}px`;
    const vw = scroller.clientWidth || 900, vh = scroller.clientHeight || 600;
    port.style.width = `${Math.min(vw, W)}px`; port.style.height = `${Math.min(vh, H)}px`;
    const sx = scroller.scrollLeft, sy = scroller.scrollTop;
    const j0 = Math.max(0, Math.floor(sx / CELL) - 1), j1 = Math.min(cols.length, Math.ceil((sx + vw - ROW_HEAD) / CELL) + 1);
    const i0 = Math.max(0, Math.floor(sy / CELL) - 1), i1 = Math.min(rows.length, Math.ceil((sy + vh - COL_HEAD) / CELL) + 1);
    const X = (/** @type {number} */ j) => ROW_HEAD + j * CELL - sx, Y = (/** @type {number} */ i) => COL_HEAD + i * CELL - sy;
    const relName = RELATIONSHIPS[data.rel].verb[n()];
    const withLinks = rows.filter((r) => rowN.has(r.id)).length, colsWith = cols.filter((c) => colN.has(c.id)).length;
    info.textContent = `${links.size} link${links.size === 1 ? '' : 's'} · ${colsWith} of ${cols.length} columns and ${withLinks} of ${rows.length} rows have one`;
    const sel = ctx.selected();

    const parts = [];
    // grid background for the cell area
    parts.push(h('div', { class: 'mgrid', style: { left: `${ROW_HEAD}px`, top: `${COL_HEAD}px`, width: `${Math.max(0, Math.min(cols.length * CELL - sx, vw))}px`, height: `${Math.max(0, Math.min(rows.length * CELL - sy, vh))}px`, backgroundPosition: `${-sx}px ${-sy}px` } }));
    if (hover) {
      parts.push(h('div', { class: 'mband', style: { left: `${ROW_HEAD}px`, top: `${Y(hover.i)}px`, width: `${cols.length * CELL}px`, height: `${CELL}px` } }));
      parts.push(h('div', { class: 'mband', style: { left: `${X(hover.j)}px`, top: `${COL_HEAD}px`, width: `${CELL}px`, height: `${rows.length * CELL}px` } }));
    }
    // marks
    for (let i = i0; i < i1; i++) {
      const r = rows[i];
      for (let j = j0; j < j1; j++) {
        const c = cols[j];
        if (r.id === c.id) parts.push(h('div', { class: 'mcell self', style: { left: `${X(j)}px`, top: `${Y(i)}px` } }));
        else if (links.has(`${r.id}>${c.id}`)) parts.push(h('div', { class: 'mcell on' + (links.get(`${r.id}>${c.id}`) === sel ? ' sel' : ''), style: { left: `${X(j)}px`, top: `${Y(i)}px` } }, '↗'));
      }
    }
    if (document.activeElement === scroller && rows.length && cols.length) parts.push(h('div', { class: 'mfocus', style: { left: `${X(focus.j)}px`, top: `${Y(focus.i)}px` } }));
    // row totals and column totals
    for (let i = i0; i < i1; i++) { const v = rowN.get(rows[i].id) || 0; parts.push(h('div', { class: 'mtot' + (v ? '' : ' zero'), style: { left: `${ROW_HEAD + cols.length * CELL - sx}px`, top: `${Y(i)}px` } }, String(v))); }
    for (let j = j0; j < j1; j++) { const v = colN.get(cols[j].id) || 0; parts.push(h('div', { class: 'mtot col' + (v ? '' : ' zero'), style: { left: `${X(j)}px`, top: `${COL_HEAD + rows.length * CELL - sy}px` } }, String(v))); }
    // headers on top
    const colHead = h('div', { class: 'mcolhead', style: { height: `${COL_HEAD}px` } });
    for (let j = j0; j < j1; j++) {
      const c = cols[j];
      colHead.append(h('button', { class: 'mch' + (hover?.j === j ? ' hot' : '') + (c.id === sel ? ' sel' : '') + (colN.has(c.id) ? '' : ' empty'), type: 'button', tabindex: '-1', title: `${labelOf(c)} · ${kindName(c.kind, n())}${colN.has(c.id) ? '' : ' (nothing yet)'}`, style: { left: `${X(j)}px` }, onclick: () => ctx.select(c.id) }, h('span', {}, labelOf(c))));
    }
    const rowHead = h('div', { class: 'mrowhead', style: { width: `${ROW_HEAD}px` } });
    for (let i = i0; i < i1; i++) {
      const r = rows[i];
      rowHead.append(h('button', { class: 'mrh' + (hover?.i === i ? ' hot' : '') + (r.id === sel ? ' sel' : '') + (rowN.has(r.id) ? '' : ' empty'), type: 'button', tabindex: '-1', title: `${labelOf(r)} · ${kindName(r.kind, n())}`, style: { top: `${Y(i)}px` }, onclick: () => ctx.select(r.id) },
        h('span', { class: 'kbadge' }, ELEMENTS[r.kind].abbr), h('span', { class: 'mrh-name' }, labelOf(r))));
    }
    const corner = h('div', { class: 'mcorner', style: { width: `${ROW_HEAD}px`, height: `${COL_HEAD}px` } },
      h('div', { class: 'mcorner-text' },
        h('b', {}, SETS[mx().props.rows]?.label || ''), h('span', { class: 'mono' }, ` ${relName} ↗ `), h('b', {}, SETS[mx().props.cols]?.label || '')),
      h('div', { class: 'muted small' }, 'Click a cell to add or remove'));
    const totLabelR = h('div', { class: 'mtot-label', style: { left: `${ROW_HEAD + cols.length * CELL - sx}px`, top: '0px', height: `${COL_HEAD}px` } }, h('span', {}, 'Total'));
    const empty = !rows.length || !cols.length
      ? h('div', { class: 'tempty', style: { top: `${COL_HEAD}px` } }, h('b', {}, `No ${(!rows.length ? SETS[mx().props.rows] : SETS[mx().props.cols])?.label.toLowerCase() || 'elements'}${mx().props.hideEmpty ? ' with links' : ''} yet`), h('p', {}, mx().props.hideEmpty ? 'Turn off "Hide empty" to see everything.' : 'Add some in the model browser, or pick other rows and columns.'))
      : null;
    port.replaceChildren(...parts, colHead, totLabelR, rowHead, corner, ...(empty ? [empty] : []));
  }

  // ---------- interaction ----------
  /** The cell under a mouse event. @param {MouseEvent} ev */
  function cellAt(ev) {
    const b = scroller.getBoundingClientRect();
    const x = ev.clientX - b.left, y = ev.clientY - b.top;
    if (x < ROW_HEAD || y < COL_HEAD) return null;
    const j = Math.floor((x - ROW_HEAD + scroller.scrollLeft) / CELL), i = Math.floor((y - COL_HEAD + scroller.scrollTop) / CELL);
    return i >= 0 && j >= 0 && i < data.rows.length && j < data.cols.length ? { i, j } : null;
  }
  /** @param {{ i: number, j: number }} c */
  function describe(c) {
    const r = data.rows[c.i], col = data.cols[c.j];
    const rel = RELATIONSHIPS[data.rel], v = rel.verb[n()];
    if (r.id === col.id) return { text: 'An element cannot relate to itself', ok: false };
    if (data.links.has(`${r.id}>${col.id}`)) return { text: `${r.name} ${v} ${col.name}. Click to remove.`, ok: true };
    if (model.canLink(data.rel, r.id, col.id)) return { text: `Click: ${r.name} ${v} ${col.name}`, ok: true };
    return { text: `✕ A ${kindName(r.kind, n())} cannot have ${rel.names[n()].toLowerCase()} to a ${kindName(col.kind, n())}`, ok: false };
  }
  /** @param {{ i: number, j: number }} c */
  function toggle(c) {
    const r = data.rows[c.i], col = data.cols[c.j];
    if (!r || !col) return;
    const id = data.links.get(`${r.id}>${col.id}`);
    const rel = RELATIONSHIPS[data.rel];
    if (id) { if (ctx.edit(`Remove ${rel.names.sysml.toLowerCase()}`, (tx) => tx.remove(id))) toast(`Removed: ${r.name} ${rel.verb[n()]} ${col.name}`); return; }
    if (!model.canLink(data.rel, r.id, col.id)) { toast(describe(c).text.replace(/^✕ /, ''), true); return; }
    ctx.edit(`Add ${rel.names.sysml.toLowerCase()}`, (tx) => tx.link(data.rel, r.id, col.id));
  }
  scroller.addEventListener('scroll', () => { tip.hidden = true; invalidate(); }, { passive: true });
  scroller.addEventListener('pointermove', (ev) => {
    const c = cellAt(ev);
    if (c?.i !== hover?.i || c?.j !== hover?.j) { hover = c; invalidate(); }
    if (c) {
      const d = describe(c), b = el.querySelector('.mwrap')?.getBoundingClientRect();
      tip.textContent = d.text; tip.classList.toggle('bad', !d.ok); tip.hidden = false;
      if (b) { tip.style.left = `${Math.min(ev.clientX - b.left + 14, b.width - 260)}px`; tip.style.top = `${ev.clientY - b.top + 18}px`; }
    } else tip.hidden = true;
  });
  scroller.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; invalidate(); });
  scroller.addEventListener('click', (ev) => { const c = cellAt(ev); if (c) { focus = c; toggle(c); } });
  scroller.addEventListener('focus', () => invalidate());
  scroller.addEventListener('blur', () => invalidate());
  scroller.addEventListener('keydown', (ev) => {
    if (ev.target !== scroller || !data.rows.length || !data.cols.length) return;
    const mv = /** @type {Record<string, [number, number]>} */ ({ ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] })[ev.key];
    if (mv) {
      ev.preventDefault(); ev.stopPropagation();
      focus = { i: Math.max(0, Math.min(data.rows.length - 1, focus.i + mv[0])), j: Math.max(0, Math.min(data.cols.length - 1, focus.j + mv[1])) };
      hover = focus;
      // keep the focused cell in view
      const x = focus.j * CELL, y = focus.i * CELL, vw = scroller.clientWidth - ROW_HEAD - TOTAL, vh = scroller.clientHeight - COL_HEAD - TOTAL;
      if (x < scroller.scrollLeft) scroller.scrollLeft = x; else if (x + CELL > scroller.scrollLeft + vw) scroller.scrollLeft = x + CELL - vw;
      if (y < scroller.scrollTop) scroller.scrollTop = y; else if (y + CELL > scroller.scrollTop + vh) scroller.scrollTop = y + CELL - vh;
      tip.textContent = describe(focus).text; tip.hidden = false; tip.style.left = '12px'; tip.style.top = `${COL_HEAD + 8}px`;
      invalidate();
    } else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); toggle(focus); }
  });

  const unsub = model.subscribe(() => { dirty = true; invalidate(); });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => invalidate()) : null;
  ro?.observe(scroller);
  invalidate();
  return {
    el, render, invalidate: () => { dirty = true; invalidate(); },
    syncSelection: () => invalidate(),
    focus: () => scroller.focus({ preventScroll: true }),
    data: () => data,
    dispose() { cancelAnimationFrame(raf); unsub(); ro?.disconnect(); },
  };
}
