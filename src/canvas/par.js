// Parametric diagrams: a block's equations (constraint properties) and the values they bind,
// solved live. Values are keyed by their path through parts ("propulsion/battery/capacity"
// as ids), so the same value property used through two parts shows twice. Drag from a value
// to an equation (or back) to bind it to one of the equation's parameters.
import { kindName } from '../model/metamodel.js';
import { analysisOf, showVar } from '../analysis/solver.js';
import { naturalSize } from './bdd.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {import('./bdd.js').NodeContent} NodeContent */
/** @typedef {import('./bdd.js').Edge} Edge */

/** @param {Element | undefined} el */
const canShowPar = (el) => !!el && (el.kind === 'constraint' || el.kind === 'attribute');
const lastId = (/** @type {string} */ key) => key.slice(key.lastIndexOf('/') + 1);

/** @param {Model} m @param {Element} el @param {Element} d @param {Notation} n @param {string} [key] @returns {NodeContent} */
export function parNodeContent(m, el, d, n, key = el.id) {
  const an = analysisOf(m, /** @type {string} */ (d.owner));
  if (el.kind === 'constraint') {
    const def = el.props.type ? m.get(el.props.type) : null;
    const eq = an.equations.find((x) => x.key === key);
    /** @type {import('./bdd.js').Compartment[]} */
    const comps = [];
    if (d.props.showExpr !== false) comps.push({ title: '', rows: [def?.props.expr ? `{ ${def.props.expr} }` : '{ no equation yet }'], wrap: true });
    const params = def ? m.children(def.id).filter((c) => c.kind === 'attribute') : [];
    if (params.length) comps.push({ title: n === 'guided' ? 'Uses' : 'parameters', rows: [params.map((p) => p.name + (p.props.unit ? ` [${p.props.unit}]` : '')).join(', ')], wrap: true });
    if (eq && eq.status !== 'ok') comps.push({ title: '', rows: [`⚠ ${eq.message}`], wrap: true });
    const bad = eq && ['conflict', 'violated', 'error', 'unsolved'].includes(eq.status);
    return { stereo: n === 'guided' ? 'Equation' : '«constraint»', name: def ? `${el.name} : ${def.name}` : el.name, compartments: comps, layerColor: null, shape: 'round', tone: bad ? 'constraint-bad' : 'constraint' };
  }
  const v = an.vars.get(key);
  const conflict = !!v && an.equations.some((e) => e.status === 'conflict' && [...e.params.values()].includes(v.key));
  const rows = d.props.showValues === false ? [] : [v ? `= ${showVar(v)}${v.source === 'computed' ? '   computed' : v.source === 'unknown' ? '   unknown' : ''}` : '(not part of this block)'];
  return {
    stereo: '', name: v ? v.name : el.name, compartments: rows.length ? [{ title: '', rows }] : [], layerColor: null, shape: 'box',
    tone: conflict ? 'value-bad' : v?.source === 'computed' ? 'computed' : v?.source === 'unknown' ? 'unknown' : 'given',
  };
}

/** @param {Model} m @param {Set<string>} shown @returns {Edge[]} */
export function parEdgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const b of m.byKind('binding')) {
    const val = b.props.value;
    if (!val?.port) continue;
    const vk = [...val.path, val.port].join('/');
    const ck = b.props.constraint;
    if (!shown.has(vk) || !shown.has(ck)) continue;
    out.push({ id: b.id, kind: 'assoc', from: vk, to: ck, label: m.get(b.props.param)?.name || '', element: b.id, cls: 'bind' });
  }
  return out;
}

/**
 * Lay out a parametric diagram: equations in the middle, given values on the left, computed
 * values on the right, each beside the equation it feeds.
 * @param {Model} m @param {Element} d @param {{ id: string, w: number, h: number }[]} nodes @returns {Record<string, Rect>}
 */
export function layoutPar(m, d, nodes) {
  const an = analysisOf(m, /** @type {string} */ (d.owner));
  const cons = nodes.filter((x) => m.get(lastId(x.id))?.kind === 'constraint');
  const vals = nodes.filter((x) => m.get(lastId(x.id))?.kind === 'attribute');
  const binds = m.byKind('binding');
  /** Which equation a value feeds first. @param {string} key */
  const home = (key) => cons.findIndex((c) => binds.some((b) => b.props.constraint === c.id && b.props.value?.port && [...b.props.value.path, b.props.value.port].join('/') === key));
  const left = vals.filter((x) => an.vars.get(x.id)?.source === 'given').sort((a, b) => home(a.id) - home(b.id));
  const right = vals.filter((x) => an.vars.get(x.id)?.source !== 'given').sort((a, b) => home(a.id) - home(b.id));
  const wl = Math.max(200, ...left.map((x) => x.w)), wc = Math.max(240, ...cons.map((x) => x.w)), wr = Math.max(200, ...right.map((x) => x.w));
  /** @type {Record<string, Rect>} */
  const out = {};
  const gap = 130;
  const x0 = 40, x1 = x0 + wl + gap, x2 = x1 + wc + gap;
  let y = 40;
  for (const c of cons) { out[c.id] = { x: x1, y, w: wc, h: c.h }; y += c.h + 50; }
  const column = (/** @type {typeof nodes} */ list, /** @type {number} */ x, /** @type {number} */ w) => {
    let yy = 40;
    for (const v of list) {
      const i = home(v.id);
      const want = i >= 0 ? out[cons[i].id].y : yy;
      const at = Math.max(yy, want);
      out[v.id] = { x, y: at, w, h: v.h };
      yy = at + v.h + 24;
    }
  };
  column(left, x0, wl); column(right, x2, wr);
  return out;
}

/**
 * A new parametric diagram: the block's equations and every value they bind, laid out.
 * Call inside a transaction. @param {Model} m @param {any} tx @param {string} diagramId @param {Notation} [notation]
 */
export function populatePar(m, tx, diagramId, notation = 'sysml') {
  const d = /** @type {Element} */ (m.get(diagramId));
  const block = /** @type {string} */ (d.owner);
  const cons = m.children(block).filter((c) => c.kind === 'constraint');
  const keys = new Set();
  for (const b of m.children(block)) if (b.kind === 'binding' && b.props.value?.port) keys.add([...b.props.value.path, b.props.value.port].join('/'));
  const nodes = [...cons.map((c) => c.id), ...keys].map((id) => {
    const el = /** @type {Element} */ (m.get(lastId(/** @type {string} */ (id))));
    const nat = naturalSize(parNodeContent(m, el, d, notation, /** @type {string} */ (id)));
    return { id: /** @type {string} */ (id), w: Math.max(el.kind === 'constraint' ? 240 : 200, Math.ceil(nat.w / 10) * 10), h: Math.max(56, nat.h) };
  });
  if (nodes.length) tx.place(diagramId, layoutPar(m, d, nodes));
}

/** The parametric diagram as a diagram kind for the canvas. */
export const parKind = {
  kind: 'par',
  canShow: canShowPar,
  nodeContent: parNodeContent,
  edgesFor: parEdgesFor,
  /** Every value depends on every other: redraw all boxes after any change. */
  volatile: true,
  /** @param {Model} m @param {string} id */
  related(m, id) {
    const binds = m.byKind('binding');
    return {
      above: binds.filter((b) => b.props.constraint === id && b.props.value?.port).map((b) => [...b.props.value.path, b.props.value.port].join('/')),
      below: binds.filter((b) => b.props.value?.port && [...b.props.value.path, b.props.value.port].join('/') === id).map((b) => b.props.constraint),
    };
  },
  /** Binding a value to an equation: one choice per parameter. @param {Model} m @param {string} a @param {string} b */
  linkKinds(m, a, b) {
    const x = m.get(lastId(a)), y = m.get(lastId(b));
    if (!x || !y) return [];
    const c = x.kind === 'constraint' ? x : y.kind === 'constraint' ? y : null;
    const v = x.kind === 'attribute' ? a : y.kind === 'attribute' ? b : null;
    if (!c || !v || c.props.type === undefined) return [];
    const def = c.props.type ? m.get(c.props.type) : null;
    if (!def) return [];
    const bound = new Set(m.byKind('binding').filter((bb) => bb.props.constraint === c.id).map((bb) => bb.props.param));
    const params = m.children(def.id).filter((p) => p.kind === 'attribute');
    return [...params.filter((p) => !bound.has(p.id)), ...params.filter((p) => bound.has(p.id))].map((p) => `param:${p.id}`);
  },
  /** @param {string} k @param {Notation} n @param {Model} [m] */
  linkLabel: (k, n, m) => {
    const p = m?.get(k.slice(6));
    return p ? `${n === 'guided' ? 'is' : 'binds'} ${p.name}${p.props.unit ? ` [${p.props.unit}]` : ''}` : 'binding';
  },
  linkHint: 'Drag to an equation (or a value) to bind them',
  /** @param {Model} m @param {any} tx @param {Element} d @param {string} k @param {string} a @param {string} b */
  makeLink(m, tx, d, k, a, b) {
    const ca = m.get(lastId(a))?.kind === 'constraint';
    const cKey = ca ? a : b, vKey = ca ? b : a;
    const segs = vKey.split('/');
    const param = k.slice(6);
    // a parameter is bound once: binding it again moves the binding
    for (const old of m.byKind('binding')) if (old.props.constraint === cKey && old.props.param === param) tx.remove(old.id);
    return tx.create('binding', { owner: d.owner, name: `${m.get(cKey)?.name}.${m.get(param)?.name} = ${segs.map((id) => m.get(id)?.name).join('.')}`, props: { constraint: cKey, param, value: { path: segs.slice(0, -1), port: segs[segs.length - 1] } } });
  },
  add: [
    {
      kind: 'constraint', label: 'Equation', title: 'Use a constraint block in this block',
      empty: 'There are no constraint blocks yet. Create one with New equation.',
      /** @param {Model} m */
      menu: (m) => m.byKind('constraintDef').sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40).map((def) => ({ label: def.name, hint: def.props.expr || '', props: { type: def.id } })),
    },
    {
      kind: 'attribute', label: 'Value', title: 'Show a value of this block or of one of its parts',
      empty: 'This block and its parts have no values yet.',
      /** @param {Model} m @param {Element} d */
      menu: (m, d) => [...analysisOf(m, /** @type {string} */ (d.owner)).vars.values()].filter((v) => !v.local && !d.layout?.nodes[v.key]).slice(0, 60).map((v) => ({ label: v.name, hint: showVar(v), place: v.key })),
    },
    {
      kind: 'constraint', label: 'New equation', title: 'Make a new constraint block and use it here; write its equation in the inspector',
      /** A new constraint block next to the block, used in it. @param {Model} m @param {any} tx @param {Element} d */
      create(m, tx, d) {
        const block = /** @type {Element} */ (m.get(/** @type {string} */ (d.owner)));
        const pkg = /** @type {string} */ (block.owner);
        const def = tx.create('constraintDef', { owner: m.canCreate(pkg, 'constraintDef') ? pkg : /** @type {string} */ (m.layers().find((l) => l.layer === 'l')?.id) });
        const taken = new Set(m.children(block.id).map((c) => c.name));
        let i = 1;
        while (taken.has(`eq${i}`)) i++;
        const use = tx.create('constraint', { owner: block.id, name: `eq${i}`, props: { type: def } });
        return { id: use, select: def };
      },
    },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('l'),
  /** @param {Model} m @param {Element} d */
  ownerFor: (m, d) => d.owner,
  /** @param {string} kind */
  newSize: (kind) => (kind === 'constraint' ? { w: 260, h: 110 } : { w: 220, h: 60 }),
  /** Values are named by their path: rename the value property in the inspector. @param {Element | undefined} e */
  noRename: (e) => e?.kind === 'attribute',
  /** @param {Model} m @param {Element} d @param {{ id: string, w: number, h: number }[]} nodes */
  tidy: (m, d, nodes) => layoutPar(m, d, nodes),
  flags: /** @type {[string, string][]} */ ([['showExpr', 'Equations'], ['showValues', 'Computed values'], ['showRoles', 'Parameter names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Add equations (constraint blocks) and values with the buttons above, then drag from a value\'s link handle to an equation to bind it. Values without a number are computed.',
  noun: 'equations and values',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A parametric diagram shows constraint properties and values. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
  /** A one-line verdict for the toolbar. @param {Model} m @param {Element} d */
  status(m, d) {
    const an = analysisOf(m, /** @type {string} */ (d.owner));
    const errs = an.problems.filter((p) => p.level === 'error').length, warns = an.problems.length - errs;
    const computed = [...an.vars.values()].filter((v) => v.source === 'computed').length;
    if (errs) return { tone: 'bad', text: `${errs} problem${errs > 1 ? 's' : ''}`, problems: an.problems };
    if (warns) return { tone: 'warn', text: `${warns} to look at`, problems: an.problems };
    return { tone: 'ok', text: `Solved: ${computed} value${computed === 1 ? '' : 's'} computed`, problems: [] };
  },
};
