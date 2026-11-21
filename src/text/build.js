// From text to model. Parsed layers replace the matching layers of a base model; the result
// is a complete snapshot, which can be loaded (opening a folder) or applied to the live model
// as one undoable edit (the text pane).
//
// Ids are kept wherever an element can be recognized, so diagrams keep their layouts:
//   1. same owner, kind and name;  2. same kind and name anywhere in the layer (it moved);
//   3. same owner and kind, in order (it was renamed);  4. a saved id for its qualified name
//   (when opening a folder);  otherwise a new id.
import { ELEMENTS, RELATIONSHIPS, canOwnKind, canRelate, defaultProps, isDiagram, isRel, kindName, DIAGRAM_KINDS, canHaveStereo } from '../model/metamodel.js';
import { snapshot, MODEL_FORMAT, FORMAT_VERSION } from '../model/serialize.js';
import { ModelError, stereoApplies, appliesText } from '../model/model.js';
import { newId } from '../model/ids.js';
import { TextError, parse } from './parser.js';
import { resolve, targetKinds, TYPE_KINDS, relKey } from './names.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('./parser.js').Node} Node */
/** @typedef {import('../model/serialize.js').Snapshot} Snapshot */
/**
 * @typedef {{
 *   hint?: (key: string) => string | undefined,         // a saved id for a qualified key
 *   layouts?: Record<string, Record<string, any>>,      // saved diagram layouts by diagram id
 *   preferLayouts?: boolean,                             // saved layouts win over the base model's
 * }} BuildOptions
 */

/** A problem in the text, with where it is. */
export class BuildError extends TextError {}

/**
 * Parse text for one layer. The text must be a single package (the layer itself).
 * @param {string} text @returns {Node}
 */
export function parseLayer(text) {
  const nodes = parse(text);
  if (nodes.length !== 1 || nodes[0].kind !== 'package') {
    const n = nodes[nodes.length > 1 ? 1 : 0];
    throw new TextError(nodes.length ? 'The text must be one package: the layer, with everything inside it' : 'The text is empty: it must be one package (the layer)', n?.line || 1, n?.col || 1);
  }
  return nodes[0];
}

/**
 * Build a full snapshot: `base` with each given layer replaced by its parsed text.
 * @param {Model} base
 * @param {{ layerId: string, node: Node, path?: string }[]} inputs  path: the file, named in errors
 * @param {BuildOptions} [o]
 * @returns {Snapshot}
 */
export function buildSnapshot(base, inputs, o = {}) {
  /** The file being worked on, for errors. */
  let current = '';
  try { return build(); } catch (e) { if (e instanceof TextError && !(/** @type {any} */ (e).file)) /** @type {any} */ (e).file = current; throw e; }

  function build() {
  const snap = snapshot(base);
  /** @type {Map<string, Element>} */
  const els = new Map(snap.elements.map((e) => [e.id, e]));
  /** @type {Map<string, string[]>} */
  const kids = new Map();
  for (const e of snap.elements) if (e.owner) (kids.get(e.owner) || kids.set(e.owner, []).get(e.owner))?.push(e.id);
  const rootId = base.root().id;
  /** Old elements by id, for matching. @type {Map<string, Element>} */
  const old = new Map();
  /** Old children lists (before replacement). */
  const oldKids = new Map([...kids].map(([k, v]) => [k, [...v]]));
  const replaced = new Set();
  const used = new Set(snap.elements.map((e) => e.id));

  // take out everything inside each replaced layer
  for (const { layerId } of inputs) {
    const layer = els.get(layerId);
    if (!layer || layer.owner !== rootId) throw new ModelError('Text can only replace a whole set at the top of the model');
    const drop = (/** @type {string} */ id) => { for (const c of kids.get(id) || []) { old.set(c, /** @type {Element} */ (els.get(c))); replaced.add(c); used.delete(c); drop(c); els.delete(c); kids.delete(c); } };
    drop(layerId);
    kids.set(layerId, []);
  }

  /** Nodes and the ids they became, for the reference pass. @type {{ node: Node, id: string, path: string }[]} */
  const placed = [];
  /** @type {Set<string>} */
  const matched = new Set();
  /** @param {Node} n @param {string} msg */
  const fail = (n, msg) => { throw new BuildError(msg, n.line, n.col); };

  /** The model kind a node stands for. @param {Node} n */
  function kindOf(n) {
    if (n.kind !== 'view') return n.kind;
    const k = n.meta.find((x) => x.key === 'kind');
    if (!k || typeof k.value !== 'string' || !DIAGRAM_KINDS.includes(k.value)) fail(n, `A view needs @Loom { kind = "…"; } with one of ${DIAGRAM_KINDS.join(', ')}`);
    return /** @type {string} */ (k?.value);
  }
  /** Default name for a node without one. @param {Node} n @param {string} kind */
  function nameOf(n, kind) {
    if (n.name) return n.name;
    if (kind === 'connector') return `${n.end1?.segs.join('.')} → ${n.end2?.segs.join('.')}`;
    if (kind === 'binding') return `${n.end1?.segs.join('.')} = ${n.end2?.segs.join('.')}`;
    if ((kind === 'flow' || kind === 'transition') && n.refs) return `${n.refs.from.parts.at(-1)} → ${n.refs.to.parts.at(-1)}`;
    if (kind === 'controlNode') return ({ initial: 'Initial', final: 'Final', flowFinal: 'Flow final', decision: 'Decision', merge: 'Merge', fork: 'Fork', join: 'Join' })[n.fields?.nodeKind || ''] || 'Control node';
    if (kind === 'requirement' && n.short) return n.short;
    return fail(n, `This ${kindName(kind, 'sysml').toLowerCase()} needs a name`);
  }

  /**
   * Properties from the node (everything but references, which come later).
   * @param {Node} n @param {string} kind @param {Record<string, any>} [prev] the matched element's props
   */
  function propsOf(n, kind, prev) {
    const props = defaultProps(kind);
    // keep references for now; they are re-resolved from the text in the second pass
    if (prev) for (const [k, spec] of Object.entries(ELEMENTS[kind].props)) if (spec.type === 'ref' || spec.type === 'end' || spec.type === 'stereo') props[k] = null;
    const spec = ELEMENTS[kind].props;
    for (const m of n.meta) {
      if (m.key === 'layer' || (m.key === 'kind' && isDiagram(kind))) continue;
      const key = kind === 'requirement' && m.key === 'rationale' ? 'doc' : m.key;
      const p = spec[key];
      if (!p || p.type === 'ref' || p.type === 'end' || p.type === 'stereo' || (kind === 'requirement' && key === 'text')) throw new BuildError(`A ${kindName(kind, 'sysml').toLowerCase()} has no Loom property "${m.key}"`, m.line, m.col);
      if (p.type === 'bool') { if (typeof m.value !== 'boolean') throw new BuildError(`${m.key} must be true or false`, m.line, m.col); props[key] = m.value; }
      else if (p.type === 'enum') { if (!p.options.includes(String(m.value))) throw new BuildError(`${m.key} must be one of: ${p.options.join(', ')}`, m.line, m.col); props[key] = String(m.value); }
      else { if (typeof m.value === 'boolean') throw new BuildError(`${m.key} must be text in quotes`, m.line, m.col); props[key] = String(m.value); }
    }
    if (n.doc !== undefined) props[kind === 'requirement' ? 'text' : 'doc'] = n.doc;
    if (kind === 'requirement') props.reqId = n.short || '';
    if (kind === 'part') props.multiplicity = n.mult ?? '1';
    if (kind === 'port') { props.direction = n.direction || 'inout'; if (n.type) props.conjugated = n.type.conj; }
    if (kind === 'attribute') { props.value = n.value ?? ''; props.unit = n.unit ?? ''; }
    for (const [k, v] of Object.entries(n.fields || {})) props[k] = v;
    return props;
  }

  /** The qualified key of a new element, for saved-id lookups. @param {string} ownerId @param {string} kind @param {string} name @param {number} dup */
  function keyFor(ownerId, kind, name, dup) {
    const names = [];
    for (let c = els.get(ownerId); c && c.owner; c = els.get(c.owner)) names.unshift(c.name);
    names.push(name);
    return `${kind}:${names.join('::')}${dup > 1 ? `~${dup}` : ''}`;
  }

  /** Place a sibling group under `ownerId`, matching ids, then recurse. @param {Node[]} nodes @param {string} ownerId */
  function group(nodes, ownerId) {
    const owner = /** @type {Element} */ (els.get(ownerId));
    const info = nodes.map((n) => { const kind = kindOf(n); return { n, kind, name: nameOf(n, kind), id: '' }; });
    for (const x of info) if (!canOwnKind(owner.kind, x.kind)) fail(x.n, `A ${kindName(owner.kind, 'sysml')} cannot contain a ${kindName(x.kind, 'sysml').toLowerCase()}`);
    const oldHere = (oldKids.get(ownerId) || []).filter((id) => old.has(id) && !matched.has(id)).map((id) => /** @type {Element} */ (old.get(id)));
    const take = (/** @type {typeof info[number]} */ x, /** @type {Element | undefined} */ e) => { if (e) { x.id = e.id; matched.add(e.id); } };
    // 1. same owner, kind and name
    for (const x of info) take(x, oldHere.find((e) => !matched.has(e.id) && e.kind === x.kind && e.name === x.name));
    // 2. moved here from elsewhere in the layer
    for (const x of info) if (!x.id) take(x, [...old.values()].find((e) => !matched.has(e.id) && e.kind === x.kind && e.name === x.name));
    // 3. renamed: same kind, in order, among those whose names are gone from the text
    const names = new Set(info.map((x) => `${x.kind}|${x.name}`));
    for (const x of info) if (!x.id) take(x, oldHere.find((e) => !matched.has(e.id) && e.kind === x.kind && !names.has(`${e.kind}|${e.name}`)));
    // 4. a saved id, else a new one
    /** @type {Map<string, number>} */
    const dups = new Map();
    for (const x of info) {
      const k = `${x.kind}|${x.name}`;
      const dup = (dups.get(k) || 0) + 1;
      dups.set(k, dup);
      if (x.id) continue;
      const h = o.hint?.(keyFor(ownerId, x.kind, x.name, dup));
      x.id = h && !used.has(h) ? h : newId();
    }
    for (const x of info) {
      used.add(x.id);
      const prev = old.get(x.id);
      /** @type {Element} */
      const e = { id: x.id, kind: x.kind, name: x.name, owner: ownerId, props: propsOf(x.n, x.kind, prev?.props) };
      if (isDiagram(x.kind)) {
        // a saved layout (from .loom/layout.json) holds the boxes and, under "~lines", the lines shaped by hand
        const saved = o.layouts?.[x.id];
        const fromSaved = () => { const { '~lines': lines, ...nodes } = /** @type {Record<string, any>} */ (saved); return { nodes, lines }; };
        const had = prev?.layout;
        const pick = o.preferLayouts && saved ? fromSaved() : had ? { nodes: had.nodes, lines: had.lines } : saved ? fromSaved() : { nodes: {}, lines: undefined };
        e.layout = { nodes: JSON.parse(JSON.stringify(pick.nodes || {})) };
        if (pick.lines && typeof pick.lines === 'object') e.layout.lines = JSON.parse(JSON.stringify(pick.lines));
      }
      els.set(e.id, e);
      /** @type {string[]} */ (kids.get(ownerId)).push(e.id);
      kids.set(e.id, []);
      placed.push({ node: x.n, id: e.id, path: current });
    }
    for (const x of info) group(x.n.children, x.id);
  }

  for (const { layerId, node, path } of inputs) {
    current = path || '';
    const layer = /** @type {Element} */ (els.get(layerId));
    const lm = node.meta.find((x) => x.key === 'layer');
    if (lm && lm.value !== layer.layer) throw new BuildError(`This text is the ${String(lm.value).toUpperCase()} layer, not ${String(layer.layer).toUpperCase()}`, lm.line, lm.col);
    layer.name = node.name;
    layer.props = propsOf(node, 'package');
    placed.push({ node, id: layerId, path: current });
    group(node.children, layerId);
  }

  // ---------- second pass: references ----------
  const tree = {
    rootId,
    get: (/** @type {string} */ id) => els.get(id),
    children: (/** @type {string} */ id) => (kids.get(id) || []).map((c) => /** @type {Element} */ (els.get(c))),
    all: () => [...els.values()],
  };
  /** @param {import('./parser.js').Ref} ref @param {string} ctxId @param {string[] | null} kinds */
  const find = (ref, ctxId, kinds) => {
    const r = resolve(tree, ref.parts, ctxId, kinds);
    if ('error' in r) throw new BuildError(r.error, ref.line, ref.col);
    return r.id;
  };
  /** Old relationships, to keep their ids. */
  const oldRels = new Map(snap.relationships.map((r) => [`${r.kind}|${r.source}|${r.target}`, r.id]));
  /** @type {Element[]} */
  const rels = snap.relationships.filter((r) => !replaced.has(/** @type {string} */ (r.source)) && !inputs.some((i) => i.layerId === r.source) && els.has(/** @type {string} */ (r.source)) && els.has(/** @type {string} */ (r.target)));
  const relSeen = new Set(rels.map((r) => `${r.kind}|${r.source}|${r.target}`));
  /** @type {Map<string, string>} */
  const keyCache = new Map();
  const keyOf = (/** @type {string} */ id) => {
    let k = keyCache.get(id);
    if (k) return k;
    const e = els.get(id);
    const names = [];
    for (let c = e; c && c.owner; c = els.get(c.owner)) names.unshift(c.name);
    k = `${e?.kind}:${names.join('::')}`;
    keyCache.set(id, k);
    return k;
  };
  /** @param {string} kind @param {string} s @param {string} t @param {{ line: number, col: number }} at */
  const addRel = (kind, s, t, at) => {
    const se = /** @type {Element} */ (els.get(s)), te = /** @type {Element} */ (els.get(t));
    if (s === t) throw new BuildError(`${se.name} cannot relate to itself`, at.line, at.col);
    if (!canRelate(kind, se.kind, te.kind)) {
      const from = RELATIONSHIPS[kind].sources;
      const who = from === '*' ? 'any element' : from.map((x) => kindName(x, 'sysml').toLowerCase()).join(' or ');
      throw new BuildError(`A ${kindName(se.kind, 'sysml').toLowerCase()} cannot ${kind === 'trace' ? 'have a dependency' : kind} here: ${RELATIONSHIPS[kind].names.sysml.toLowerCase()} goes from a ${who} to a ${kindName(te.kind, 'sysml').toLowerCase()}`, at.line, at.col);
    }
    const k = `${kind}|${s}|${t}`;
    if (relSeen.has(k)) throw new BuildError(`${se.name} already ${RELATIONSHIPS[kind].verb.sysml} ${te.name}`, at.line, at.col);
    relSeen.add(k);
    const h = oldRels.get(k) || o.hint?.(relKey(kind, keyOf(s), keyOf(t)));
    const id = h && !used.has(h) ? h : newId();
    used.add(id);
    rels.push({ id, kind, name: '', owner: null, source: s, target: t, props: {} });
  };
  for (const { node: n, id, path } of placed) {
    current = path;
    const e = /** @type {Element} */ (els.get(id));
    for (const [prop, r] of Object.entries(n.refs || {})) {
      const spec = /** @type {any} */ (ELEMENTS[e.kind].props[prop]);
      e.props[prop] = find(r, id, spec.kinds);
    }
    if (n.type) {
      const kinds = TYPE_KINDS[e.kind];
      if (!kinds) throw new BuildError(`A ${kindName(e.kind, 'sysml').toLowerCase()} has no type`, n.type.line, n.type.col);
      e.props.type = find(n.type, id, kinds);
    }
    for (const sp of n.spec) addRel('generalize', id, find(sp, id, targetKinds('generalize')), sp);
    for (const r of n.rels) addRel(r.kind, id, find(r.ref, id, targetKinds(r.kind)), { line: r.line, col: r.ref.col });
    if (n.applied?.length) {
      if (!canHaveStereo(e.kind)) throw new BuildError(`A ${kindName(e.kind, 'sysml').toLowerCase()} cannot have stereotypes`, n.applied[0].ref.line, n.applied[0].ref.col);
      /** @type {import('../model/metamodel.js').Applied[]} */
      const list = [];
      for (const a of n.applied) {
        const sid = find(a.ref, id, ['stereotype']);
        const st = /** @type {Element} */ (els.get(sid));
        if (!stereoApplies(st, e.kind)) throw new BuildError(`«${st.name}» cannot be applied to a ${kindName(e.kind, 'sysml').toLowerCase()}: it applies to ${appliesText(st)}`, a.ref.line, a.ref.col);
        if (list.some((x) => x.s === sid)) throw new BuildError(`«${st.name}» is applied twice`, a.ref.line, a.ref.col);
        /** @type {Record<string, string>} */
        const tags = {};
        for (const tg of a.tags) {
          const def = tree.children(sid).find((c) => c.kind === 'attribute' && c.name === tg.key);
          if (!def) throw new BuildError(`«${st.name}» has no tag named ${tg.key}`, tg.line, tg.col);
          tags[def.id] = tg.value;
        }
        list.push(Object.keys(tags).length ? { s: sid, tags } : { s: sid });
      }
      e.props.applied = list;
    }
    if (e.kind === 'connector') {
      e.props.end1 = endOf(/** @type {any} */ (n.end1), /** @type {string} */ (e.owner));
      e.props.end2 = endOf(/** @type {any} */ (n.end2), /** @type {string} */ (e.owner));
    }
  }
  // bindings last: they need constraint types and generalizations
  for (const { node: n, id } of placed) {
    const e = /** @type {Element} */ (els.get(id));
    if (e.kind !== 'binding') continue;
    const [cName, pName] = /** @type {any} */ (n.end1).segs;
    const block = /** @type {string} */ (e.owner);
    const c = supersIn(block).flatMap((b) => tree.children(b)).find((x) => x.kind === 'constraint' && x.name === cName);
    if (!c) throw new BuildError(`${els.get(block)?.name} has no constraint named ${cName}`, /** @type {any} */ (n.end1).line, /** @type {any} */ (n.end1).col);
    const def = c.props.type ? els.get(c.props.type) : null;
    const prm = def ? tree.children(def.id).find((x) => x.kind === 'attribute' && x.name === pName) : null;
    if (!prm) throw new BuildError(def ? `${def.name} has no parameter named ${pName}` : `${cName} has no constraint block, so it has no parameters`, /** @type {any} */ (n.end1).line, /** @type {any} */ (n.end1).col);
    e.props.constraint = c.id;
    e.props.param = prm.id;
    e.props.value = valueEndOf(/** @type {any} */ (n.end2), block);
  }

  /** A block and the blocks it specializes. @param {string} b */
  function supersIn(b) {
    const out = [b];
    for (let i = 0; i < out.length; i++) for (const r of rels) if (r.kind === 'generalize' && r.source === out[i] && r.target && !out.includes(r.target)) out.push(r.target);
    return out;
  }
  /** A binding's value: part names down from the block, then a value property. @param {import('./parser.js').EndPath} p @param {string} blockId */
  function valueEndOf(p, blockId) {
    /** @type {string[]} */
    const path = [];
    let block = blockId;
    for (let i = 0; i < p.segs.length; i++) {
      const name = p.segs[i], last = i === p.segs.length - 1;
      const homes = [...supersIn(block), ...(path.length ? [path[path.length - 1]] : [])];
      if (last) {
        const a = homes.flatMap((b) => tree.children(b)).find((c) => c.kind === 'attribute' && c.name === name);
        if (!a) throw new BuildError(`${els.get(block)?.name || 'That block'} has no value named ${name}`, p.line, p.col);
        return { path, port: a.id };
      }
      const part = supersIn(block).flatMap((b) => tree.children(b)).find((c) => c.kind === 'part' && c.name === name);
      if (!part) throw new BuildError(`${els.get(block)?.name || 'That block'} has no part named ${name}`, p.line, p.col);
      if (!part.props.type) throw new BuildError(`${name} has no type, so it has no values`, p.line, p.col);
      path.push(part.id);
      block = part.props.type;
    }
    throw new BuildError('A binding needs a value', p.line, p.col);
  }

  /** A connector end: part names down from the owning block, then maybe a port. @param {import('./parser.js').EndPath} p @param {string} blockId */
  function endOf(p, blockId) {
    /** @type {string[]} */
    const path = [];
    let block = blockId, port = null;
    for (let i = 0; i < p.segs.length; i++) {
      const name = p.segs[i], last = i === p.segs.length - 1;
      const kidsHere = tree.children(block);
      const part = kidsHere.find((c) => c.kind === 'part' && c.name === name);
      if (part) {
        path.push(part.id);
        if (!last) { if (!part.props.type) throw new BuildError(`${name} has no type, so it has no parts or ports`, p.line, p.col); block = part.props.type; }
        continue;
      }
      const pt = last ? kidsHere.find((c) => c.kind === 'port' && c.name === name) : undefined;
      if (pt) { port = pt.id; continue; }
      throw new BuildError(`${els.get(block)?.name || 'That block'} has no ${last ? 'part or port' : 'part'} named ${name}`, p.line, p.col);
    }
    return { path, port };
  }

  // owners before children, siblings in order
  /** @type {Element[]} */
  const elements = [];
  const walk = (/** @type {string} */ id) => { elements.push(/** @type {Element} */ (els.get(id))); for (const c of kids.get(id) || []) walk(c); };
  walk(rootId);
  return { format: MODEL_FORMAT, version: FORMAT_VERSION, elements, relationships: rels };
  }
}

/**
 * Bring a live model in line with a snapshot, as one undoable edit. Elements and relationships
 * are matched by id; only what differs is changed.
 * @param {Model} m @param {Snapshot} snap @param {string} label
 * @returns {{ created: number, removed: number, changed: number }}
 */
export function applySnapshot(m, snap, label) {
  const want = new Map(snap.elements.map((e) => [e.id, e]));
  const wantRels = new Map(snap.relationships.map((r) => [r.id, r]));
  const stats = { created: 0, removed: 0, changed: 0 };
  /** Children in order, per owner. @type {Map<string, string[]>} */
  const order = new Map();
  for (const e of snap.elements) if (e.owner) (order.get(e.owner) || order.set(e.owner, []).get(e.owner))?.push(e.id);
  const plain = (/** @type {Element} */ e) => Object.fromEntries(Object.entries(e.props).filter(([k]) => { const p = ELEMENTS[e.kind].props[k]; return p && p.type !== 'ref' && p.type !== 'end' && p.type !== 'stereo'; }));
  m.transact(label, (tx) => {
    // 1. new elements, without references (their targets may not exist yet)
    for (const e of snap.elements) {
      if (!e.owner || m.get(e.id)) continue;
      tx.create(e.kind, { owner: e.owner, name: e.name, props: plain(e), id: e.id });
      if (e.layout && Object.keys(e.layout.nodes).length) tx.place(e.id, e.layout.nodes);
      if (e.layout?.lines) tx.shape(e.id, e.layout.lines);
      stats.created++;
    }
    // 2. owners and order, top down
    for (const e of snap.elements) {
      const list = order.get(e.id);
      if (!list) continue;
      list.forEach((id, i) => {
        const cur = m.get(id);
        if (!cur) return;
        const curList = m.children(e.id).map((c) => c.id);
        if (cur.owner !== e.id || curList[i] !== id) tx.move(id, e.id, i);
      });
    }
    // 3. what is gone
    for (const r of m.all()) if (isRel(r.kind) && !wantRels.has(r.id) && m.get(r.id)) { tx.remove(r.id); stats.removed++; }
    for (const e of m.all()) if (!isRel(e.kind) && e.owner && !want.has(e.id) && m.get(e.id)) { tx.remove(e.id); stats.removed++; }
    // 4. names and properties (references now resolve)
    for (const e of snap.elements) {
      const cur = m.get(e.id);
      if (!cur) continue;
      if (cur.name !== e.name && e.name) { tx.rename(e.id, e.name); stats.changed++; }
      if (JSON.stringify(cur.props) !== JSON.stringify(e.props)) { tx.setProps(e.id, e.props); stats.changed++; }
      if (e.layout && cur.layout && !sameLayout(cur.layout.nodes, e.layout.nodes)) {
        /** @type {Record<string, any>} */
        const patch = { ...e.layout.nodes };
        for (const k of Object.keys(cur.layout.nodes)) if (!(k in patch)) patch[k] = null;
        tx.place(e.id, patch);
      }
      if (e.layout && cur.layout && JSON.stringify(cur.layout.lines || {}) !== JSON.stringify(e.layout.lines || {})) {
        /** @type {Record<string, any>} */
        const lp = { ...(e.layout.lines || {}) };
        for (const k of Object.keys(cur.layout.lines || {})) if (!(k in lp)) lp[k] = null;
        tx.shape(e.id, lp);
      }
    }
    // 5. new relationships
    for (const r of snap.relationships) if (!m.get(r.id)) { tx.link(r.kind, /** @type {string} */ (r.source), /** @type {string} */ (r.target), { id: r.id }); stats.created++; }
  });
  return stats;
}

/** Same rectangles under the same keys, whatever their order. @param {Record<string, any>} a @param {Record<string, any>} b */
function sameLayout(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { const x = a[k], y = b[k]; if (!y || x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || (x.c || 0) !== (y.c || 0)) return false; }
  return true;
}

/**
 * Replace one layer of a live model with text, as one undoable edit.
 * @param {Model} m @param {string} layerId @param {string} text
 */
export function applyLayerText(m, layerId, text) {
  const node = parseLayer(text);
  const snap = buildSnapshot(m, [{ layerId, node }]);
  const layer = m.get(layerId);
  return applySnapshot(m, snap, `Edit ${layer?.name || 'layer'} as text`);
}

export { parse, TextError };
