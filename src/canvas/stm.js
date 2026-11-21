// State machine diagrams: the states of a block and the transitions between them.
// Composite states hold states (and regions, which run at the same time); dragging a state
// into another nests it in the model, dragging it out un-nests it.
import { kindName, LAYERS } from '../model/metamodel.js';
import { layered } from './layout.js';
import { naturalSize, BOX } from './bdd.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {import('./bdd.js').NodeContent} NodeContent */
/** @typedef {import('./bdd.js').Edge} Edge */

/** Pseudo-states. */
export const PSEUDO = /** @type {Record<string, { shape: string, w: number, h: number, label: string }>} */ ({
  initial: { shape: 'circle', w: 26, h: 30, label: 'Initial' },
  final: { shape: 'bullseye', w: 30, h: 30, label: 'Final' },
  choice: { shape: 'diamond', w: 40, h: 40, label: 'Choice' },
  history: { shape: 'history', w: 30, h: 30, label: 'History' },
});

/** @param {Element | undefined} el */
const canShowStm = (el) => !!el && (el.kind === 'state' || el.kind === 'region');
/** States and regions inside an element. @param {Model} m @param {string} id */
const inner = (m, id) => m.children(id).filter((c) => c.kind === 'state' || c.kind === 'region');
/** How deep a state is nested below the block. @param {Model} m @param {Element} el */
const depthOf = (m, el) => { let n = 0; for (let c = el.owner ? m.get(el.owner) : undefined; c && (c.kind === 'state' || c.kind === 'region'); c = c.owner ? m.get(c.owner) : undefined) n++; return n; };

/** @param {Model} m @param {Element} el @param {Element} d @param {Notation} n @returns {NodeContent} */
export function stmNodeContent(m, el, d, n) {
  if (el.kind === 'region') return { stereo: '', name: el.name, compartments: [], layerColor: null, shape: 'region', under: true, depth: depthOf(m, el), linkable: false, tone: 'region' };
  const p = PSEUDO[el.props.stateKind];
  if (p) return { stereo: '', name: el.name, compartments: [], layerColor: null, shape: p.shape, fixed: { w: p.w, h: p.h }, label: new RegExp(`^(${p.label}|State) ?\\d*$`).test(el.name) ? '' : el.name, tone: el.props.stateKind };
  const rows = d.props.showActions === false ? [] : /** @type {const} */ (['entry', 'do', 'exit']).filter((k) => el.props[k]).map((k) => `${k} / ${el.props[k]}`);
  const composite = inner(m, el.id).length > 0;
  const layer = m.layerOf(el.id);
  return {
    stereo: n === 'guided' && composite ? 'Has states inside' : '', name: el.name,
    compartments: rows.length ? [{ title: '', rows }] : [], layerColor: layer ? LAYERS.find((l) => l.id === layer)?.color || null : null,
    shape: 'round', under: composite, depth: depthOf(m, el), tone: composite ? 'composite' : 'state',
  };
}

/** "trigger [guard] / effect" @param {Element} t */
export const transitionLabel = (t) => [t.props.trigger, t.props.guard ? `[${t.props.guard}]` : '', t.props.effect ? `/ ${t.props.effect}` : ''].filter(Boolean).join(' ');

/** @param {Model} m @param {Set<string>} shown @returns {Edge[]} */
export function stmEdgesFor(m, shown) {
  return m.byKind('transition').filter((t) => shown.has(t.props.from) && shown.has(t.props.to))
    .map((t) => ({ id: t.id, kind: /** @type {const} */ ('flow'), from: t.props.from, to: t.props.to, label: transitionLabel(t), element: t.id, cls: t.props.trigger ? 'trigger' : 'completion' }));
}

/** Is `a` inside `b` (or the same)? @param {Model} m @param {string} a @param {string} b */
const within = (m, a, b) => m.isWithin(a, b);

/**
 * After states move: nest each in the deepest state or region whose box holds its center, or
 * take it back out to the block. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {Element} d @param {string[]} ids
 */
export function reparentStates(m, tx, d, ids) {
  const nodes = /** @type {Element} */ (m.get(d.id)).layout?.nodes || {};
  const boxes = Object.entries(nodes).filter(([id]) => { const e = m.get(id); return e && (e.kind === 'region' || (e.kind === 'state' && !PSEUDO[e.props.stateKind])); });
  let moved = 0;
  for (const id of ids) {
    const e = m.get(id);
    if (!e || (e.kind !== 'state' && e.kind !== 'region')) continue;
    const r = nodes[id];
    if (!r) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let best = null, area = Infinity;
    for (const [bid, b] of boxes) {
      if (bid === id || within(m, bid, id)) continue;
      if (cx < b.x || cx > b.x + b.w || cy < b.y || cy > b.y + b.h) continue;
      const be = /** @type {Element} */ (m.get(bid));
      if (e.kind === 'region' && be.kind !== 'state') continue;
      if (b.w * b.h < area) { area = b.w * b.h; best = bid; }
    }
    const owner = best || /** @type {string} */ (d.owner);
    if (owner !== e.owner && m.canMove(id, owner)) {
      // a state cannot sit loose in a state that has regions: it goes in its first region
      const regions = best && m.get(best)?.kind === 'state' && e.kind === 'state' ? m.children(best).filter((c) => c.kind === 'region') : [];
      const target = regions.length ? regions[0].id : owner;
      if (target !== e.owner && m.canMove(id, target)) { tx.move(id, target); moved++; }
    }
  }
  return moved;
}

/**
 * Lay out states, composites around their insides, transitions top to bottom.
 * @param {Model} m @param {string} rootId the block (or a state) @param {Set<string>} show @param {Notation} n @param {Element} d
 * @returns {Record<string, Rect>}
 */
export function layoutStates(m, rootId, show, n, d) {
  /** @type {Record<string, Rect>} */
  const rel = {};
  const transitions = m.byKind('transition');
  /** The shown child of `containerId` that holds `id`. @param {string} id @param {string} containerId */
  const childOf = (id, containerId) => { let e = m.get(id); while (e && e.owner && e.owner !== containerId) e = m.get(e.owner); return e && e.owner === containerId ? e.id : null; };
  /** Lay out the inside of `id`; returns the size it needs. @param {string} id */
  function inside(id) {
    const kids = inner(m, id).filter((k) => show.has(k.id));
    const sizes = new Map(kids.map((k) => {
      if (inner(m, k.id).some((x) => show.has(x.id))) return [k.id, inside(k.id)];
      const c = stmNodeContent(m, k, d, n);
      const nat = naturalSize(c);
      return [k.id, c.fixed ? { ...c.fixed } : { w: Math.max(150, Math.ceil(nat.w / 10) * 10), h: Math.max(50, nat.h) }];
    }));
    const isRegions = kids.length > 0 && kids.every((k) => k.kind === 'region');
    /** @type {Map<string, { x: number, y: number }>} */
    let pos;
    if (isRegions) {
      // regions side by side
      pos = new Map();
      let x = 0;
      for (const k of kids) { pos.set(k.id, { x, y: 0 }); x += /** @type {any} */ (sizes.get(k.id)).w; }
    } else {
      const edges = transitions.map((t) => ({ from: childOf(t.props.from, id), to: childOf(t.props.to, id), kind: 'flow' })).filter((e) => e.from && e.to && e.from !== e.to);
      pos = layered(kids.map((k) => ({ id: k.id, ...(/** @type {{ w: number, h: number }} */ (sizes.get(k.id))) })), /** @type {any} */ (edges), { gapX: 50, gapY: 60, x: 0, y: 0 });
    }
    let w = 0, h = 0;
    for (const k of kids) { const p = /** @type {any} */ (pos.get(k.id)), s = /** @type {any} */ (sizes.get(k.id)); rel[k.id] = { x: p.x, y: p.y, w: s.w, h: s.h }; w = Math.max(w, p.x + s.w); h = Math.max(h, p.y + s.h); }
    if (isRegions) for (const k of kids) rel[k.id].h = h;
    const e = m.get(id);
    if (!e || e.kind === 'partDef') return { w, h };
    const c = stmNodeContent(m, e, d, n);
    const head = e.kind === 'region' ? 26 : BOX.header + (c.compartments[0]?.rows.length || 0) * BOX.rowH + (c.compartments.length ? 14 : 0);
    const pad = isRegions ? 0 : 20;
    for (const k of kids) { rel[k.id].x += pad; rel[k.id].y += head; }
    return { w: Math.max(e.kind === 'region' ? 160 : 200, w + pad * 2, Math.ceil(naturalSize(c).w)), h: h + head + (isRegions ? 0 : pad) };
  }
  inside(rootId);
  // relative → absolute, top down
  /** @type {Record<string, Rect>} */
  const out = {};
  /** @param {string} id @param {number} ox @param {number} oy */
  const place = (id, ox, oy) => {
    for (const k of inner(m, id)) {
      const r = rel[k.id];
      if (!r) continue;
      out[k.id] = { x: Math.round(ox + r.x), y: Math.round(oy + r.y), w: r.w, h: r.h };
      place(k.id, ox + r.x, oy + r.y);
    }
  };
  place(rootId, 40, 40);
  return out;
}

/** Every state and region inside a block. @param {Model} m @param {string} id @returns {string[]} */
const allStates = (m, id) => inner(m, id).flatMap((k) => [k.id, ...allStates(m, k.id)]);

/**
 * A new state machine diagram: every state of the block, laid out. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {string} diagramId @param {Notation} [notation]
 */
export function populateStm(m, tx, diagramId, notation = 'sysml') {
  const d = /** @type {Element} */ (m.get(diagramId));
  const ids = allStates(m, /** @type {string} */ (d.owner));
  if (ids.length) tx.place(diagramId, layoutStates(m, /** @type {string} */ (d.owner), new Set(ids), notation, d));
}

/** The state machine diagram as a diagram kind for the canvas. */
export const stmKind = {
  kind: 'stm',
  canShow: canShowStm,
  nodeContent: stmNodeContent,
  edgesFor: stmEdgesFor,
  /** @param {Model} m @param {string} id */
  related(m, id) {
    const ts = m.byKind('transition');
    return { above: ts.filter((t) => t.props.to === id).map((t) => t.props.from), below: [...ts.filter((t) => t.props.from === id).map((t) => t.props.to), ...allStates(m, id)] };
  },
  /** @param {Model} m @param {string} a @param {string} b */
  linkKinds(m, a, b) {
    const x = m.get(a), y = m.get(b);
    if (!x || !y || x.kind !== 'state' || y.kind !== 'state') return [];
    if (x.props.stateKind === 'final' || y.props.stateKind === 'initial') return [];
    return ['transition'];
  },
  /** @param {string} _k @param {Notation} n */
  linkLabel: (_k, n) => (n === 'guided' ? 'can change to' : 'transition to'),
  linkHint: 'Drag to another state to add a transition',
  /** @param {Model} m @param {any} tx @param {Element} d @param {string} _k @param {string} a @param {string} b */
  makeLink(m, tx, d, _k, a, b) {
    const src = /** @type {Element} */ (m.get(a));
    return tx.create('transition', { owner: /** @type {string} */ (src.owner), name: `${src.name} → ${m.get(b)?.name}`, props: { from: a, to: b } });
  },
  add: [
    { kind: 'state', label: 'State', title: 'Add a state (drag it into another to nest it)' },
    { kind: 'state', label: 'Pseudo-state', title: 'Add an initial, final, choice or history state', menu: () => Object.entries(PSEUDO).map(([k, p]) => ({ label: p.label, props: { stateKind: k } })) },
    { kind: 'region', label: 'Region', title: 'Add a region (parallel states) to the selected state' },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('l'),
  /** States go in the block; a region goes in the selected state. @param {Model} m @param {Element} d @param {string} kind @param {string[]} sel */
  ownerFor(m, d, kind, sel) {
    if (kind === 'region') { const s = sel.map((x) => m.get(x)).find((e) => e?.kind === 'state' && !PSEUDO[e.props.stateKind]); return s ? s.id : null; }
    return d.owner;
  },
  /** @param {string} kind @param {Record<string, any>} [props] */
  newSize: (kind, props) => { const p = PSEUDO[props?.stateKind]; return p ? { w: p.w, h: p.h } : kind === 'region' ? { w: 220, h: 160 } : { w: 170, h: 56 }; },
  /** @param {Element | undefined} e */
  noRename: (e) => !!e && e.kind === 'state' && !!PSEUDO[e.props.stateKind],
  /** Moving a state moves what is inside it. @param {Model} m @param {Element} d @param {string} id @param {(id: string) => Rect} _r @param {string[]} shown */
  dragsWith: (m, d, id, _r, shown) => shown.filter((x) => x !== id && m.isWithin(x, id)),
  /** @param {Model} m @param {any} tx @param {Element} d @param {string[]} ids */
  afterPlace: (m, tx, d, ids) => { reparentStates(m, tx, d, ids); },
  /** @param {Model} m @param {Element} d @param {{ id: string }[]} nodes */
  tidy: (m, d, nodes) => layoutStates(m, /** @type {string} */ (d.owner), new Set(nodes.map((x) => x.id)), 'sysml', d),
  flags: /** @type {[string, string][]} */ ([['showActions', 'Entry, do and exit'], ['showLabels', 'Transition labels'], ['snap', 'Snap to grid and guides']]),
  /** @param {Element} d */
  labelsOn: (d) => d.props.showLabels !== false,
  empty: 'Add states with the buttons above, then drag from a state\'s link handle to another to add a transition. Drag a state into another to nest it.',
  noun: 'states',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A state machine diagram shows states and regions. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};
