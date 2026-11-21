// Activity diagrams: what a function does, step by step. Its sub-actions and control nodes
// (initial, final, decision, merge, fork, join) joined by control and object flows, in
// swimlanes. A swimlane is a block (or part); an action inside a lane is allocated to that
// block, so moving an action to another lane changes its allocation in the model.
import { kindName, LAYERS } from '../model/metamodel.js';
import { layered } from './layout.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {import('./bdd.js').NodeContent} NodeContent */
/** @typedef {import('./bdd.js').Edge} Edge */

const LANE_KINDS = ['partDef', 'part'];
/** Small shapes for control nodes. */
export const CONTROL = /** @type {Record<string, { shape: string, w: number, h: number, label: string }>} */ ({
  initial: { shape: 'circle', w: 30, h: 30, label: 'Initial' },
  final: { shape: 'bullseye', w: 30, h: 30, label: 'Final' },
  flowFinal: { shape: 'circlex', w: 30, h: 30, label: 'Flow final' },
  decision: { shape: 'diamond', w: 44, h: 44, label: 'Decision' },
  merge: { shape: 'diamond', w: 44, h: 44, label: 'Merge' },
  fork: { shape: 'bar', w: 140, h: 30, label: 'Fork' },
  join: { shape: 'bar', w: 140, h: 30, label: 'Join' },
});

/** @param {Element | undefined} el */
export const isLane = (el) => !!el && LANE_KINDS.includes(el.kind);
/** @param {Element | undefined} el */
const canShowAct = (el) => !!el && (el.kind === 'action' || el.kind === 'controlNode' || isLane(el));

/** A control node's default name ("Decision 1"); such names are not shown. @param {string} name */
const defaultName = (name) => /^(Control node|Initial|Final|Flow final|Decision|Merge|Fork|Join) ?\d*$/.test(name);

/** @param {Model} m @param {Element} el @param {Element} d @param {Notation} n @returns {NodeContent} */
export function actNodeContent(m, el, d, n) {
  const layer = m.layerOf(el.id);
  const color = layer ? LAYERS.find((l) => l.id === layer)?.color || null : null;
  if (el.kind === 'controlNode') {
    const c = CONTROL[el.props.nodeKind] || CONTROL.decision;
    return { stereo: '', name: el.name, compartments: [], layerColor: null, shape: c.shape, fixed: { w: c.w, h: c.h }, label: defaultName(el.name) ? '' : el.name };
  }
  if (isLane(el)) {
    const t = el.kind === 'part' && el.props.type ? m.get(el.props.type) : null;
    return { stereo: '', name: t ? `${el.name} : ${t.name}` : el.name, compartments: [], layerColor: color, shape: 'lane', under: true, depth: 0, linkable: false };
  }
  const calls = m.children(el.id).filter((c) => c.kind === 'action').length;
  return { stereo: calls ? (n === 'guided' ? `${calls} steps inside` : '«call behavior»') : '', name: el.name, compartments: [], layerColor: null, shape: 'round' };
}

/** @param {Model} m @param {Set<string>} shown @returns {Edge[]} */
export function actEdgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const f of m.byKind('flow')) {
    if (!shown.has(f.props.from) || !shown.has(f.props.to)) continue;
    const bits = [f.props.guard ? `[${f.props.guard}]` : '', f.props.flowKind === 'object' && f.props.item ? f.props.item : ''].filter(Boolean);
    out.push({ id: f.id, kind: 'flow', from: f.props.from, to: f.props.to, label: bits.join(' '), element: f.id });
  }
  return out;
}

/** The lanes on a diagram and their rectangles. @param {Model} m @param {Element} d */
export function lanesOf(m, d) {
  const nodes = d.layout?.nodes || {};
  return Object.entries(nodes).filter(([id]) => isLane(m.get(id))).map(([id, r]) => ({ id, r })).sort((a, b) => a.r.x - b.r.x);
}
/** The lane a rectangle's center falls in. @param {{ id: string, r: Rect }[]} lanes @param {Rect} r */
export function laneAt(lanes, r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return lanes.find((l) => cx >= l.r.x && cx <= l.r.x + l.r.w && cy >= l.r.y && cy <= l.r.y + l.r.h)?.id || null;
}

/**
 * Bring allocations in line with the lanes: each action shown in a lane is allocated to that
 * lane's block (and not to other lanes' blocks on this diagram). Call inside a transaction.
 * @param {Model} m @param {any} tx @param {Element} d @param {string[]} [ids] only these steps (default: all)
 * @returns {number} relationships changed
 */
export function syncAllocations(m, tx, d, ids) {
  if (d.props.showLanes === false) return 0;
  const cur = /** @type {Element} */ (m.get(d.id));
  const lanes = lanesOf(m, cur);
  if (!lanes.length) return 0;
  const laneIds = new Set(lanes.map((l) => l.id));
  const nodes = cur.layout?.nodes || {};
  // only steps that were placed or moved: adding or resizing a lane never changes allocations
  const moved = new Set(ids || Object.keys(nodes));
  let changed = 0;
  for (const [id, r] of Object.entries(nodes)) {
    if (!moved.has(id) || m.get(id)?.kind !== 'action') continue;
    const want = laneAt(lanes, r);
    for (const rel of m.relsFrom(id)) if (rel.kind === 'allocate' && rel.target && laneIds.has(rel.target) && rel.target !== want) { tx.remove(rel.id); changed++; }
    if (want && !m.relsFrom(id).some((rel) => rel.kind === 'allocate' && rel.target === want) && m.canLink('allocate', id, want)) { tx.link('allocate', id, want); changed++; }
  }
  return changed;
}

/** The block an action is allocated to, among some lanes. @param {Model} m @param {string} id @param {Set<string>} lanes */
const allocatedLane = (m, id, lanes) => m.relsFrom(id).find((r) => r.kind === 'allocate' && r.target && lanes.has(r.target))?.target || null;

/**
 * Lay out an activity: flows top to bottom, each action in its lane's column.
 * @param {Model} m @param {{ id: string, w: number, h: number }[]} nodes @param {{ from: string, to: string, kind: string }[]} edges
 * @param {string[]} [laneOrder] lane ids left to right
 * @returns {Record<string, Rect>}
 */
export function layoutActivity(m, nodes, edges, laneOrder) {
  const laneNodes = nodes.filter((x) => isLane(m.get(x.id)));
  const flowEdges = edges.filter((e) => e.kind === 'flow');
  // walk the flow from the initial nodes, so loops are broken at their back edge
  const unordered = nodes.filter((x) => !isLane(m.get(x.id)));
  const outs = new Map(unordered.map((x) => [x.id, flowEdges.filter((e) => e.from === x.id).map((e) => e.to)]));
  const seen = new Set(), order0 = [];
  const queue = unordered.filter((x) => m.get(x.id)?.props.nodeKind === 'initial' || !flowEdges.some((e) => e.to === x.id)).map((x) => x.id);
  while (queue.length) { const id = /** @type {string} */ (queue.shift()); if (seen.has(id)) continue; seen.add(id); order0.push(id); queue.push(...(outs.get(id) || [])); }
  for (const x of unordered) if (!seen.has(x.id)) order0.push(x.id);
  const steps = order0.map((id) => /** @type {typeof nodes[number]} */ (unordered.find((x) => x.id === id)));
  const pos = layered(steps, /** @type {any} */ (flowEdges), { gapX: 40, gapY: 56, x: 40, y: 70 });
  /** @type {Record<string, Rect>} */
  const out = {};
  if (!laneNodes.length) {
    for (const x of steps) { const p = pos.get(x.id); if (p) out[x.id] = { x: p.x, y: p.y, w: x.w, h: x.h }; }
    return out;
  }
  const order = (laneOrder || []).filter((id) => laneNodes.some((l) => l.id === id));
  for (const l of laneNodes) if (!order.includes(l.id)) order.push(l.id);
  const laneSet = new Set(order);
  // rows from the layered layout; columns from the lanes (unallocated steps go in a first column)
  const ys = [...new Set(steps.map((x) => pos.get(x.id)?.y ?? 0))].sort((a, b) => a - b);
  // an action goes in its lane; a control node goes where the step before it (or after it) is
  /** @type {Map<string, number>} */
  const colOf = new Map();
  for (const x of steps) { const l = m.get(x.id)?.kind === 'action' ? allocatedLane(m, x.id, laneSet) : null; if (l) colOf.set(x.id, order.indexOf(l) + 1); }
  for (let pass = 0; pass < 3; pass++) for (const x of steps) {
    if (colOf.has(x.id) || m.get(x.id)?.kind === 'action') continue;
    const near = [...flowEdges.filter((e) => e.to === x.id).map((e) => e.from), ...flowEdges.filter((e) => e.from === x.id).map((e) => e.to)].find((y) => colOf.has(y));
    if (near) colOf.set(x.id, /** @type {number} */ (colOf.get(near)));
  }
  const col = (/** @type {string} */ id) => colOf.get(id) ?? 0;
  const cols = Array.from({ length: order.length + 1 }, () => /** @type {typeof steps[]} */ (ys.map(() => [])));
  for (const x of steps) cols[col(x.id)][ys.indexOf(pos.get(x.id)?.y ?? 0)].push(x);
  for (const c of cols) for (const row of c) row.sort((a, b) => (pos.get(a.id)?.x ?? 0) - (pos.get(b.id)?.x ?? 0));
  const widths = cols.map((c) => Math.max(c === cols[0] && !c.some((r) => r.length) ? 0 : 240, ...c.map((row) => row.reduce((a, x) => a + x.w + 30, 30))));
  const rowH = ys.map((_, i) => Math.max(...cols.map((c) => Math.max(0, ...c[i].map((x) => x.h)))));
  const top = 70;
  const rowY = [];
  let y = top;
  for (let i = 0; i < ys.length; i++) { rowY.push(y); y += rowH[i] + 56; }
  const bottom = y;
  let x = 40;
  cols.forEach((c, ci) => {
    c.forEach((row, ri) => {
      const total = row.reduce((a, n) => a + n.w, 0) + (row.length - 1) * 30;
      let px = x + (widths[ci] - total) / 2;
      for (const n of row) { out[n.id] = { x: Math.round(px), y: Math.round(rowY[ri] + (rowH[ri] - n.h) / 2), w: n.w, h: n.h }; px += n.w + 30; }
    });
    if (ci > 0) out[order[ci - 1]] = { x, y: 20, w: widths[ci], h: bottom - 20 };
    x += widths[ci] + (ci === 0 && widths[0] ? 30 : 0);
  });
  return out;
}

/**
 * A new activity diagram: the function's sub-actions, lanes for the blocks they are allocated
 * to, an initial node and a final node, laid out. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {string} diagramId @param {Notation} [notation]
 */
export function populateAct(m, tx, diagramId, notation = 'sysml') {
  const d = /** @type {Element} */ (m.get(diagramId));
  const owner = /** @type {string} */ (d.owner);
  const steps = m.children(owner).filter((c) => c.kind === 'action' || c.kind === 'controlNode');
  const lanes = [...new Set(steps.flatMap((s) => m.relsFrom(s.id).filter((r) => r.kind === 'allocate' && r.target).map((r) => /** @type {string} */ (r.target))))];
  const ids = [...steps.map((x) => x.id), ...lanes];
  const nodes = ids.map((id) => {
    const c = actNodeContent(m, /** @type {Element} */ (m.get(id)), d, notation);
    return { id, w: c.fixed ? c.fixed.w : 170, h: c.fixed ? c.fixed.h : 50 };
  });
  const edges = actEdgesFor(m, new Set(ids)).map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
  tx.place(diagramId, layoutActivity(m, nodes, edges, lanes));
}

/** The activity diagram as a diagram kind for the canvas. */
export const actKind = {
  kind: 'act',
  canShow: canShowAct,
  nodeContent: actNodeContent,
  edgesFor: actEdgesFor,
  /** @param {Model} m @param {string} id */
  related(m, id) {
    const flows = m.byKind('flow');
    return { above: flows.filter((f) => f.props.to === id).map((f) => f.props.from), below: flows.filter((f) => f.props.from === id).map((f) => f.props.to) };
  },
  /** @param {Model} m @param {string} a @param {string} b */
  linkKinds(m, a, b) {
    const x = m.get(a), y = m.get(b);
    if (!x || !y || a === b || isLane(x) || isLane(y)) return [];
    if (x.kind === 'controlNode' && ['final', 'flowFinal'].includes(x.props.nodeKind)) return [];
    if (y.kind === 'controlNode' && y.props.nodeKind === 'initial') return [];
    return x.kind === 'action' && y.kind === 'action' ? ['control', 'object'] : ['control'];
  },
  /** @param {string} k @param {Notation} n */
  linkLabel: (k, n) => (k === 'object' ? (n === 'guided' ? 'hands an item to' : 'object flow to') : (n === 'guided' ? 'then' : 'control flow to')),
  linkHint: 'Drag to the next step to add a flow',
  /** Flows are elements of the activity, not relationships. @param {Model} m @param {any} tx @param {Element} d @param {string} k @param {string} a @param {string} b */
  makeLink(m, tx, d, k, a, b) {
    return tx.create('flow', { owner: d.owner, name: `${m.get(a)?.name} → ${m.get(b)?.name}`, props: { from: a, to: b, flowKind: k === 'object' ? 'object' : 'control' } });
  },
  add: [
    { kind: 'action', label: 'Action', title: 'Add a step (a sub-function) to this activity' },
    {
      kind: 'controlNode', label: 'Control', title: 'Add an initial, final, decision, merge, fork or join node',
      menu: () => Object.entries(CONTROL).map(([k, c]) => ({ label: c.label, hint: c.shape === 'bar' ? '▬' : c.shape === 'diamond' ? '◇' : '●', props: { nodeKind: k } })),
    },
    {
      kind: 'partDef', label: 'Lane', title: 'Add a swimlane for a block: actions in it are allocated to that block', empty: 'There are no blocks yet. Add blocks in the Logical or Physical layer first.',
      /** @param {Model} m @param {Element} d @param {Notation} n */
      menu: (m, d, n) => m.byKind('partDef').filter((b) => !d.layout?.nodes[b.id]).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40).map((b) => ({ label: b.name, hint: (m.layerOf(b.id) || '').toUpperCase(), place: b.id })),
    },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('f'),
  /** New steps go inside the activity's function. @param {Model} m @param {Element} d */
  ownerFor: (m, d) => d.owner,
  /** @param {string} kind @param {Record<string, any>} [props] */
  newSize: (kind, props) => (kind === 'controlNode' ? (({ w, h }) => ({ w, h }))(CONTROL[props?.nodeKind] || CONTROL.decision) : { w: 170, h: 50 }),
  /** @param {Element | undefined} e */
  noRename: (e) => e?.kind === 'controlNode',
  /** A lane spans the diagram's height, right of the others. @param {Model} m @param {Element} d @param {Element | undefined} e @param {(id: string) => Rect} rectOf @param {string[]} shown */
  dropSize(m, d, e, rectOf, shown) {
    if (!isLane(e)) return null;
    const rs = shown.map(rectOf);
    const lanes = shown.filter((id) => isLane(m.get(id))).map(rectOf);
    const y0 = rs.length ? Math.min(...rs.map((r) => r.y)) - 50 : 0, y1 = rs.length ? Math.max(...rs.map((r) => r.y + r.h)) + 50 : 400;
    const x = lanes.length ? Math.max(...lanes.map((r) => r.x + r.w)) : (rs.length ? Math.min(...rs.map((r) => r.x)) - 20 : 0);
    return { x, y: lanes.length ? Math.min(...lanes.map((r) => r.y)) : y0, w: 260, h: lanes.length ? Math.max(...lanes.map((r) => r.h)) : y1 - y0 };
  },
  /** Moving a lane moves what is in it. @param {Model} m @param {Element} d @param {string} id @param {(id: string) => Rect} rectOf @param {string[]} shown */
  dragsWith(m, d, id, rectOf, shown) {
    if (!isLane(m.get(id))) return [];
    const lane = [{ id, r: rectOf(id) }];
    return shown.filter((x) => !isLane(m.get(x)) && laneAt(lane, rectOf(x)) === id);
  },
  /** @param {Model} m @param {any} tx @param {Element} d @param {string[]} ids */
  afterPlace: (m, tx, d, ids) => { syncAllocations(m, tx, d, ids); },
  /** @param {Model} m @param {Element} d @param {{ id: string, w: number, h: number }[]} nodes @param {{ from: string, to: string, kind: string }[]} edges */
  tidy: (m, d, nodes, edges) => layoutActivity(m, nodes, edges, lanesOf(m, d).map((l) => l.id)),
  flags: /** @type {[string, string][]} */ ([['showLanes', 'Swimlanes (allocation)'], ['showGuards', 'Guards and items on flows'], ['snap', 'Snap to grid and guides']]),
  /** @param {Element} d */
  labelsOn: (d) => d.props.showGuards !== false,
  empty: 'Add actions and control nodes with the buttons above, then drag from one step\'s link handle to the next to add a flow. Add a lane to allocate actions to a block.',
  noun: 'steps',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `An activity diagram shows actions, control nodes and lanes (blocks). ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};
