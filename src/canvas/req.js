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
  add: [
    { kind: 'requirement', label: 'Requirement', title: 'Add a new requirement to the model and this diagram' },
    { kind: 'testCase', label: 'Test case', title: 'Add a new test case' },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('r'),
  flags: /** @type {[string, string][]} */ ([['showId', 'Requirement IDs'], ['showText', 'Requirement text'], ['showRoles', 'Relationship names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Drag requirements, test cases and blocks here from the model browser, or add a requirement with the button above.',
  noun: 'elements',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A requirement diagram shows requirements, test cases, blocks and functions. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};

export { RELATIONSHIPS };
