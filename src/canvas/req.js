// Requirement diagrams: requirements with their ID and text, the requirements they break
// down into (containment, derive), and what satisfies, refines, verifies, copies or traces to
// them. Pure functions of the model, like bdd.js; the canvas (view.js) draws them.
import { kindName, LAYERS, RELATIONSHIPS } from '../model/metamodel.js';
import { levelOf } from '../model/trace.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {import('./bdd.js').NodeContent} NodeContent */
/** @typedef {import('./bdd.js').Edge} Edge */
/** @typedef {import('./bdd.js').Compartment} Compartment */

/** Element kinds a requirement diagram can show. */
export const REQ_KINDS = ['requirement', 'testCase', 'partDef', 'interfaceDef', 'action'];
/** Relationships drawn as dashed «stereotype» arrows, and their v1 keyword. */
export const REQ_RELS = /** @type {Record<string, string>} */ ({ satisfy: 'satisfy', verify: 'verify', derive: 'deriveReqt', refine: 'refine', copy: 'copy', trace: 'trace' });

/** @param {Element | undefined} el */
export const canShowReq = (el) => !!el && REQ_KINDS.includes(el.kind);

/** @param {Element} d @param {string} key */
const flag = (d, key) => d.props[key] !== false;

/** @param {string} kind @param {Notation} n */
function stereoOf(kind, n) {
  if (n === 'guided') return kindName(kind, 'guided');
  if (n === 'v2') return `«${kindName(kind, 'v2')}»`;
  return { requirement: '«requirement»', testCase: '«testCase»', partDef: '«block»', interfaceDef: '«interfaceBlock»', action: '«activity»' }[kind] || `«${kind}»`;
}

/**
 * What a box on a requirement diagram shows.
 * @param {Model} m @param {Element} el @param {Element} diagram @param {Notation} n
 * @returns {NodeContent}
 */
export function reqNodeContent(m, el, diagram, n) {
  const guided = n === 'guided';
  /** @type {Compartment[]} */
  const compartments = [];
  if (el.kind === 'requirement') {
    const rows = [];
    if (flag(diagram, 'showId')) rows.push(guided ? `ID: ${el.props.reqId || '—'}` : `id = "${el.props.reqId || ''}"`);
    const lvl = el.props.level && el.props.level !== 'Auto' ? el.props.level : levelOf(m, el.id);
    if (guided) rows.push(`Level: ${lvl}`);
    if (rows.length) compartments.push({ title: '', rows });
    if (flag(diagram, 'showText')) {
      const t = String(el.props.text || '').trim();
      compartments.push({ title: '', rows: [guided ? (t || 'No text yet') : `text = "${t}"`], wrap: true, joined: rows.length > 0 });
    }
  } else if (el.kind === 'testCase') {
    compartments.push({ title: '', rows: [guided ? `${el.props.method} · ${el.props.result}` : `method = ${el.props.method}`, ...(guided ? [] : [`result = ${el.props.result}`])] });
  }
  const layer = m.layerOf(el.id);
  return { stereo: stereoOf(el.kind, n), name: el.name, compartments, layerColor: layer ? (LAYERS.find((l) => l.id === layer)?.color || null) : null };
}

/**
 * Lines between shown elements: containment (a requirement inside a requirement) and the
 * requirement relationships.
 * @param {Model} m @param {Set<string>} shown @returns {Edge[]}
 */
export function reqEdgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const id of shown) {
    const el = m.get(id);
    if (!el) continue;
    if (el.kind === 'requirement' && el.owner && shown.has(el.owner) && m.get(el.owner)?.kind === 'requirement') {
      out.push({ id: `${el.owner}~${id}`, kind: 'containment', from: el.owner, to: id, element: id });
    }
    for (const r of m.relsFrom(id)) {
      if (!(r.kind in REQ_RELS) || !r.target || !shown.has(r.target)) continue;
      out.push({ id: r.id, kind: 'dependency', from: id, to: r.target, label: `«${REQ_RELS[r.kind]}»`, element: r.id });
    }
  }
  return out;
}

/** Elements related to `id`: what it breaks down into below, what it comes from above. @param {Model} m @param {string} id */
export function reqRelatedOf(m, id) {
  /** @type {string[]} */
  const below = [], above = [];
  const el = m.get(id);
  if (el?.kind === 'requirement') for (const c of m.children(id)) if (c.kind === 'requirement') below.push(c.id);
  if (el?.owner && m.get(el.owner)?.kind === 'requirement') above.push(el.owner);
  for (const r of m.relsTo(id)) if (r.kind in REQ_RELS && r.source && canShowReq(m.get(r.source))) below.push(r.source);
  for (const r of m.relsFrom(id)) if (r.kind in REQ_RELS && r.target && canShowReq(m.get(r.target))) above.push(r.target);
  return { above, below };
}

/**
 * Lay a requirement diagram out top-down, one row per level:
 *   - requirements that stand alone but trace to the tree (risks, say) in a row on top,
 *     each over what it traces to;
 *   - the requirement tree: each requirement centered over the ones inside it (or derived
 *     from it), a row per level; a long list of leaf requirements wraps into rows;
 *   - the blocks and functions that satisfy or refine them, spread along one row;
 *   - the test cases at the bottom, each under what it verifies.
 * Widths and heights come from `nodes`; returns the new rectangles.
 * @param {Model} m @param {{ id: string, w: number, h: number }[]} nodes @param {{ x?: number, y?: number }} [o]
 * @returns {Record<string, import('../model/model.js').Rect>}
 */
export function layoutRequirements(m, nodes, o = {}) {
  const GAP = 34, FAM = 120, ROW = 110, WRAP = 7, x0 = o.x ?? 40, y0 = o.y ?? 40;
  const size = new Map(nodes.map((n) => [n.id, n]));
  const isReq = (/** @type {string} */ id) => m.get(id)?.kind === 'requirement';
  // model browser order
  /** @type {Map<string, number>} */
  const order = new Map();
  const walk = (/** @type {Element} */ e) => { order.set(e.id, order.size); for (const c of m.children(e.id)) walk(c); };
  walk(m.root());
  const ord = (/** @type {string} */ a, /** @type {string} */ b) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const reqs = nodes.map((n) => n.id).filter(isReq).sort(ord);

  // the tree: a requirement hangs under the requirement it sits in, else one it derives from
  /** @type {Map<string, string>} */
  const parent = new Map();
  for (const id of reqs) {
    const own = m.get(id)?.owner;
    if (own && size.has(own) && isReq(own)) { parent.set(id, own); continue; }
    const d = m.relsFrom(id).find((r) => r.kind === 'derive' && r.target && size.has(r.target) && isReq(r.target));
    if (d?.target) parent.set(id, d.target);
  }
  for (const id of reqs) { // derive loops: cut where they close
    const seen = new Set([id]);
    for (let p = parent.get(id); p; p = parent.get(p)) { if (p === id) { parent.delete(id); break; } if (seen.has(p)) break; seen.add(p); }
  }
  /** @type {Map<string, string[]>} */
  const kids = new Map(reqs.map((id) => [id, []]));
  for (const id of reqs) { const p = parent.get(id); if (p) kids.get(p)?.push(id); }
  const roots = reqs.filter((id) => !parent.has(id));
  /** @param {string} id */
  const linksTo = (id) => m.relsFrom(id).filter((r) => r.target && r.target !== id && size.has(r.target) && (r.kind in REQ_RELS)).map((r) => /** @type {string} */ (r.target));
  const inTree = (/** @type {string} */ id) => isReq(id) && (parent.has(id) || !!kids.get(id)?.length);
  const side = roots.filter((id) => !kids.get(id)?.length && linksTo(id).some(inTree));
  const trees = roots.filter((id) => !side.includes(id));

  // row heights by level
  /** @type {number[]} */
  const rowH = [];
  const measure = (/** @type {string} */ id, /** @type {number} */ dep) => {
    rowH[dep] = Math.max(rowH[dep] || 0, size.get(id)?.h || 0);
    for (const c of kids.get(id) || []) measure(c, dep + 1);
  };
  trees.forEach((id) => measure(id, 0));
  const sideH = Math.max(0, ...side.map((id) => size.get(id)?.h || 0));
  const top = side.length ? y0 + sideH + ROW : y0;
  /** @type {number[]} */
  const rowY = [];
  rowH.forEach((h, i) => { rowY[i] = i ? rowY[i - 1] + rowH[i - 1] + ROW : top; });

  /** @type {Record<string, import('../model/model.js').Rect>} */
  const out = {};
  const sz = (/** @type {string} */ id) => /** @type {{ w: number, h: number }} */ (size.get(id));
  /** Lay out a subtree with its left edge at x; returns its width. @param {string} id @param {number} x @param {number} dep @returns {number} */
  const place = (id, x, dep) => {
    const { w, h } = sz(id);
    const ch = kids.get(id) || [];
    if (!ch.length) { out[id] = { x, y: rowY[dep], w, h }; return w; }
    if (ch.length > WRAP && ch.every((c) => !kids.get(c)?.length)) {
      const colW = Math.max(...ch.map((c) => sz(c).w));
      let y = rowY[dep + 1];
      for (let i = 0; i < ch.length; i += WRAP) {
        const row = ch.slice(i, i + WRAP);
        row.forEach((c, k) => { out[c] = { x: x + k * (colW + GAP), y, w: sz(c).w, h: sz(c).h }; });
        y += Math.max(...row.map((c) => sz(c).h)) + 50;
      }
      const span = Math.max(w, Math.min(ch.length, WRAP) * (colW + GAP) - GAP);
      out[id] = { x: x + Math.round(span / 2 - w / 2), y: rowY[dep], w, h };
      return span;
    }
    let cx = x;
    for (const c of ch) cx += place(c, cx, dep + 1) + GAP;
    const span = cx - GAP - x;
    const first = out[ch[0]], last = out[ch[ch.length - 1]];
    const mid = (first.x + first.w / 2 + last.x + last.w / 2) / 2;
    out[id] = { x: Math.round(mid - w / 2), y: rowY[dep], w, h };
    if (out[id].x < x) { // a parent wider than its children: shift the subtree right
      const dx = x - out[id].x;
      const move = (/** @type {string} */ n) => { out[n].x += dx; (kids.get(n) || []).forEach(move); };
      move(id);
    }
    return Math.max(span, w);
  };
  let x = x0;
  for (const id of trees) x += place(id, x, 0) + FAM;
  const width = Math.max(0, x - FAM - x0);
  let bottom = Math.max(y0, ...Object.values(out).map((r) => r.y + r.h));

  const centerOf = (/** @type {string[]} */ ts) => {
    const cs = ts.filter((t) => out[t]).map((t) => out[t].x + out[t].w / 2).sort((a, b) => a - b);
    return cs.length ? (cs[0] + cs[cs.length - 1]) / 2 : Infinity;
  };
  /** One row, each element as near the middle of what it links to as the others allow. @param {string[]} ids @param {number} y @param {number} gap */
  const row = (ids, y, gap) => {
    const list = ids.map((id) => ({ id, c: centerOf(linksTo(id)) })).sort((a, b) => a.c - b.c || ord(a.id, b.id));
    let prev = -Infinity, end = x0;
    for (const { id, c } of list) {
      const { w, h } = sz(id);
      const nx = Number.isFinite(c) ? Math.max(Math.round(c - w / 2), prev) : Math.max(prev, end);
      out[id] = { x: nx, y, w, h };
      prev = nx + w + gap; end = prev;
    }
  };

  // standalone requirements that trace to the tree, on top
  row(side, y0, 60);
  // what satisfies or refines them: a row spread across the tree, in the order of what they link to
  const design = nodes.map((n) => n.id).filter((id) => !isReq(id) && m.get(id)?.kind !== 'testCase');
  if (design.length) {
    const y = bottom + ROW * 1.6;
    const maxW = Math.max(...design.map((id) => sz(id).w));
    const slot = width / design.length;
    if (slot >= maxW + GAP * 2) {
      design.map((id) => ({ id, c: centerOf(linksTo(id)) })).sort((a, b) => a.c - b.c || ord(a.id, b.id))
        .forEach(({ id }, k) => { const { w, h } = sz(id); out[id] = { x: Math.round(x0 + slot * (k + 0.5) - w / 2), y, w, h }; });
    } else row(design, y, GAP * 2);
    bottom = y + Math.max(...design.map((id) => sz(id).h));
  }
  // test cases at the bottom, under what they verify
  const tests = nodes.map((n) => n.id).filter((id) => m.get(id)?.kind === 'testCase');
  row(tests, bottom + ROW * 1.6, 40);
  return out;
}

/** Relationships a drag from box `a` to box `b` can make, most specific first. @param {Model} m @param {string} a @param {string} b */
export const reqLinkKinds = (m, a, b) => ['satisfy', 'verify', 'derive', 'refine', 'copy', 'trace'].filter((k) => m.canLink(k, a, b));

/** The requirement diagram as a diagram kind for the canvas. */
export const reqKind = {
  kind: 'req',
  canShow: canShowReq,
  nodeContent: reqNodeContent,
  edgesFor: reqEdgesFor,
  related: reqRelatedOf,
  linkKinds: reqLinkKinds,
  /** @param {Model} m @param {Element} _d @param {{ id: string, w: number, h: number }[]} nodes */
  tidy: (m, _d, nodes) => layoutRequirements(m, nodes),
  add: [
    { kind: 'requirement', label: 'Requirement', title: 'Add a new requirement to the model and this diagram' },
    { kind: 'testCase', label: 'Test case', title: 'Add a new test case' },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('r'),
  flags: /** @type {[string, string][]} */ ([['showId', 'Requirement IDs'], ['showText', 'Requirement text'], ['showTags', 'Stereotypes and tagged values'], ['showRoles', 'Relationship names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Drag requirements, test cases and blocks here from the model browser, or add a requirement with the button above.',
  noun: 'elements',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A requirement diagram shows requirements, test cases, blocks and functions. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};

export { RELATIONSHIPS };
