// The Loom model: an element graph with indices, edited only through transactions,
// with unlimited undo and redo.
//
// Every edit is broken into primitive operations (add, delete, set, move). Applying one
// returns its inverse, so a transaction's inverse is its inverses in reverse order.
import { ELEMENTS, RELATIONSHIPS, LAYERS, isRel, isKind, canOwnKind, canRelate, defaultProps, kindName, isDiagram, DIAGRAM_KINDS } from './metamodel.js';
import { newId } from './ids.js';
import { FRAME, isLayoutKey, keyIds, parseKey } from './paths.js';

/**
 * @typedef {{
 *   id: string, kind: string, name: string,
 *   owner: string | null,                // structural owner; null for the root and for relationships
 *   source?: string, target?: string,    // relationships only
 *   layer?: import('./metamodel.js').Layer, // the four top-level layer packages only
 *   props: Record<string, any>,
 *   layout?: { nodes: Record<string, Rect> }, // diagrams only: where each shown element sits
 * }} Element
 * @typedef {{ x: number, y: number, w: number, h: number, c?: 1 }} Rect  c: collapsed (internal block diagrams)
 * @typedef {{ t: 'add', el: Element, index: number }
 *   | { t: 'del', id: string }
 *   | { t: 'set', id: string, name?: string, props?: Record<string, any> }
 *   | { t: 'move', id: string, owner: string, index: number }
 *   | { t: 'lay', id: string, nodes: Record<string, Rect | null> }} Op
 * @typedef {{ label: string, ops: Op[] }} Entry
 * @typedef {{ label: string, cause: 'do' | 'undo' | 'redo' | 'load', ids: Set<string> }} ChangeEvent
 */

export class ModelError extends Error {}

/** Positions are whole pixels, so files stay small and diffs stay readable. @param {number} v */
const round = (v) => Math.round(v);

/** A deep copy of plain JSON data. @template T @param {T} v @returns {T} */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Create an empty model with a root package and the four RFLP layer packages.
 * @param {{ name?: string, empty?: boolean }} [opts] empty: no root (used when loading a file)
 */
export function createModel(opts = {}) {
  /** @type {Map<string, Element>} */
  const els = new Map();
  /** @type {Map<string, string[]>} children in order */
  const kids = new Map();
  /** @type {Map<string, Set<string>>} */
  const byKind = new Map();
  /** @type {Map<string, Set<string>>} relationship ids by source */
  const from = new Map();
  /** @type {Map<string, Set<string>>} relationship ids by target */
  const to = new Map();
  /** @type {Entry[]} */
  const undoStack = [];
  /** @type {Entry[]} */
  const redoStack = [];
  /** @type {Set<(e: ChangeEvent) => void>} */
  const subs = new Set();
  let rootId = '';
  let version = 0;
  /** @type {{ ops: Op[], ids: Set<string> } | null} */
  let open = null;

  // ---------- indices ----------
  /** @param {Map<string, Set<string>>} m @param {string} k @param {string} v */
  const addTo = (m, k, v) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(v); };
  /** @param {Map<string, Set<string>>} m @param {string} k @param {string} v */
  const delFrom = (m, k, v) => { const s = m.get(k); if (s) { s.delete(v); if (!s.size) m.delete(k); } };

  /** @param {string} id */
  function must(id) {
    const e = els.get(id);
    if (!e) throw new ModelError(`No element with id ${id}`);
    return e;
  }

  // ---------- primitive operations (each returns its inverse) ----------
  /** @param {Op} op @returns {Op} */
  function apply(op) {
    switch (op.t) {
      case 'add': {
        const el = clone(op.el);
        if (els.has(el.id)) throw new ModelError(`Duplicate id ${el.id}`);
        els.set(el.id, el);
        addTo(byKind, el.kind, el.id);
        if (isRel(el.kind)) { addTo(from, /** @type {string} */ (el.source), el.id); addTo(to, /** @type {string} */ (el.target), el.id); }
        else {
          kids.set(el.id, kids.get(el.id) || []);
          if (el.owner) {
            const list = kids.get(el.owner) || [];
            list.splice(Math.max(0, Math.min(op.index, list.length)), 0, el.id);
            kids.set(el.owner, list);
          }
        }
        open?.ids.add(el.id);
        return { t: 'del', id: el.id };
      }
      case 'del': {
        const el = must(op.id);
        let index = 0;
        if (isRel(el.kind)) { delFrom(from, /** @type {string} */ (el.source), el.id); delFrom(to, /** @type {string} */ (el.target), el.id); }
        else {
          if ((kids.get(el.id) || []).length) throw new ModelError('Delete the children first');
          kids.delete(el.id);
          if (el.owner) {
            const list = kids.get(el.owner) || [];
            index = list.indexOf(el.id);
            if (index >= 0) list.splice(index, 1);
          }
        }
        els.delete(el.id);
        delFrom(byKind, el.kind, el.id);
        open?.ids.add(el.id);
        return { t: 'add', el, index };
      }
      case 'set': {
        const el = must(op.id);
        /** @type {Op} */
        const inv = { t: 'set', id: el.id };
        if (op.name !== undefined) { inv.name = el.name; el.name = op.name; }
        if (op.props) {
          inv.props = {};
          for (const [k, v] of Object.entries(op.props)) { inv.props[k] = k in el.props ? clone(el.props[k]) : undefined; if (v === undefined) delete el.props[k]; else el.props[k] = clone(v); }
        }
        open?.ids.add(el.id);
        return inv;
      }
      case 'lay': {
        const d = must(op.id);
        const nodes = /** @type {NonNullable<Element['layout']>} */ (d.layout).nodes;
        /** @type {Record<string, Rect | null>} */
        const inv = {};
        for (const [k, r] of Object.entries(op.nodes)) {
          inv[k] = nodes[k] ? { ...nodes[k] } : null;
          if (r) nodes[k] = { ...r }; else delete nodes[k];
        }
        open?.ids.add(d.id);
        return { t: 'lay', id: d.id, nodes: inv };
      }
      case 'move': {
        const el = must(op.id);
        const old = /** @type {string} */ (el.owner);
        const oldList = kids.get(old) || [];
        const oldIndex = oldList.indexOf(el.id);
        if (oldIndex >= 0) oldList.splice(oldIndex, 1);
        const list = kids.get(op.owner) || [];
        list.splice(Math.max(0, Math.min(op.index, list.length)), 0, el.id);
        kids.set(op.owner, list);
        el.owner = op.owner;
        open?.ids.add(el.id); open?.ids.add(old); open?.ids.add(op.owner);
        return { t: 'move', id: el.id, owner: old, index: oldIndex };
      }
    }
  }

  /** Apply an op inside the open transaction and record its inverse. @param {Op} op */
  function run(op) {
    if (!open) throw new ModelError('Edits must happen inside model.transact()');
    open.ops.push(apply(op));
  }

  /** @param {ChangeEvent} e */
  function emit(e) { version++; subs.forEach((f) => f(e)); }

  // ---------- queries ----------
  const api = {
    /** @param {string} id */
    get: (id) => els.get(id),
    /** @param {string} id */
    has: (id) => els.has(id),
    root: () => /** @type {Element} */ (els.get(rootId)),
    /** Increases on every change; views can compare it to skip work. */
    version: () => version,
    count: () => els.size,
    /** Structural (non-relationship) element count. */
    elementCount: () => [...els.values()].filter((e) => !isRel(e.kind)).length,
    /** @returns {Element[]} */
    all: () => [...els.values()],
    /** @param {string} id @returns {Element[]} */
    children: (id) => (kids.get(id) || []).map((c) => /** @type {Element} */ (els.get(c))),
    /** @param {string} kind @returns {Element[]} */
    byKind: (kind) => [...(byKind.get(kind) || [])].map((id) => /** @type {Element} */ (els.get(id))),
    /** Relationships whose source is `id`. @param {string} id @returns {Element[]} */
    relsFrom: (id) => [...(from.get(id) || [])].map((r) => /** @type {Element} */ (els.get(r))),
    /** Relationships whose target is `id`. @param {string} id @returns {Element[]} */
    relsTo: (id) => [...(to.get(id) || [])].map((r) => /** @type {Element} */ (els.get(r))),
    /** The layer packages, in R F L P order. */
    layers: () => LAYERS.map((l) => api.children(rootId).find((c) => c.layer === l.id)).filter((x) => !!x),
    /** Owner chain from the root down to (not including) the element. @param {string} id */
    path(id) {
      /** @type {Element[]} */
      const out = [];
      let e = els.get(id);
      while (e?.owner) { e = els.get(e.owner); if (e) out.unshift(e); }
      return out;
    },
    /** The RFLP layer an element lives in, if any. @param {string} id */
    layerOf(id) {
      let e = els.get(id);
      while (e) { if (e.layer) return e.layer; e = e.owner ? els.get(e.owner) : undefined; }
      return undefined;
    },
    /** Is `a` the same as or inside `b`? @param {string} a @param {string} b */
    isWithin(a, b) {
      let e = els.get(a);
      while (e) { if (e.id === b) return true; e = e.owner ? els.get(e.owner) : undefined; }
      return false;
    },
    /** Can an element of `kind` be created inside `ownerId`? @param {string} ownerId @param {string} kind */
    canCreate(ownerId, kind) { const o = els.get(ownerId); return !!o && !isRel(o.kind) && canOwnKind(o.kind, kind); },
    /** Can `id` be moved into `ownerId`? @param {string} id @param {string} ownerId */
    canMove(id, ownerId) {
      const e = els.get(id), o = els.get(ownerId);
      if (!e || !o || isRel(e.kind) || !e.owner || e.layer) return false;
      if (api.isWithin(ownerId, id)) return false; // no cycles
      return canOwnKind(o.kind, e.kind);
    },
    /** @param {string} kind @param {string} src @param {string} tgt */
    canLink(kind, src, tgt) {
      const s = els.get(src), t = els.get(tgt);
      if (!s || !t || src === tgt || isRel(s.kind) || isRel(t.kind)) return false;
      if (!canRelate(kind, s.kind, t.kind)) return false;
      return !api.relsFrom(src).some((r) => r.kind === kind && r.target === tgt);
    },
    /** Diagrams that show element `id` (directly or inside a part path). @param {string} id @returns {Element[]} */
    diagramsShowing(id) { return DIAGRAM_KINDS.flatMap((k) => api.byKind(k)).filter((d) => d.layout && Object.keys(d.layout.nodes).some((key) => key === id || keyIds(key).includes(id))); },
    /** Connectors whose ends go through or to `id`. @param {string} id @returns {Element[]} */
    connectorsTouching(id) {
      return api.byKind('connector').filter((c) => [c.props.end1, c.props.end2].some((end) => end && (end.port === id || end.path.includes(id))));
    },
    /**
     * Check a connector end against the block that owns the connector.
     * @param {string} ownerId @param {import('./metamodel.js').End | null} end
     * @returns {string | null} what is wrong, or null when it is fine
     */
    checkEnd(ownerId, end) {
      if (!end) return 'The end is missing';
      let block = ownerId;
      for (const pid of end.path) {
        const p = els.get(pid);
        if (!p || p.kind !== 'part') return 'An end goes through something that is not a part';
        if (p.owner !== block) return `${p.name} is not inside ${els.get(block)?.name || 'that block'}`;
        block = p.props.type;
        if (!block && (end.port || pid !== end.path[end.path.length - 1])) return `${p.name} has no type, so it has no ports or parts`;
      }
      if (end.port) {
        const port = els.get(end.port);
        if (!port || port.kind !== 'port') return 'An end points at something that is not a port';
        if (port.owner !== block) return `${port.name} is not a port of ${els.get(block)?.name || 'that block'}`;
      }
      if (!end.path.length && !end.port) return 'An end must name a part or a port';
      return null;
    },
    /** Elements that refer to `id` through a ref property. @param {string} id */
    referrers(id) {
      return [...els.values()].filter((e) => Object.entries(ELEMENTS[e.kind]?.props || {}).some(([k, p]) => p.type === 'ref' && e.props[k] === id));
    },
  };

  // ---------- transactions ----------
  /**
   * Make a group of edits that undo together. `fn` receives the editing API.
   * If `fn` throws, every edit it made is rolled back and the error is re-thrown.
   * @template R
   * @param {string} label
   * @param {(tx: typeof edit) => R} fn
   * @returns {R}
   */
  function transact(label, fn) {
    if (open) return fn(edit); // nested: join the outer transaction
    open = { ops: [], ids: new Set() };
    let result;
    try { result = fn(edit); }
    catch (err) {
      const t = open; open = null;
      for (let i = t.ops.length - 1; i >= 0; i--) apply(t.ops[i]);
      throw err;
    }
    const t = open; open = null;
    if (t.ops.length) {
      undoStack.push({ label, ops: t.ops });
      if (undoStack.length > 500) undoStack.shift();
      redoStack.length = 0;
      emit({ label, cause: 'do', ids: t.ids });
    }
    return result;
  }

  /** The editing API, only usable inside transact(). */
  const edit = {
    /**
     * Create an element.
     * @param {string} kind
     * @param {{ owner: string, name?: string, props?: Record<string, any>, id?: string, index?: number }} o
     * @returns {string} the new id
     */
    create(kind, o) {
      if (!(kind in ELEMENTS)) throw new ModelError(`Unknown element kind ${kind}`);
      const owner = must(o.owner);
      if (!canOwnKind(owner.kind, kind)) throw new ModelError(`A ${kindName(owner.kind, 'sysml')} cannot contain a ${kindName(kind, 'sysml')}`);
      const id = o.id || newId();
      const name = o.name ?? nextName(kind, o.owner);
      const props = { ...defaultProps(kind), ...(o.props || {}) };
      checkRefs(kind, props, o.owner);
      /** @type {Element} */
      const el = { id, kind, name, owner: o.owner, props };
      if (isDiagram(kind)) el.layout = { nodes: {} };
      run({ t: 'add', el, index: o.index ?? Infinity });
      return id;
    },
    /** @param {string} id @param {string} name */
    rename(id, name) {
      const e = must(id);
      const clean = String(name).replace(/\s+/g, ' ').trim();
      if (!clean) throw new ModelError('A name cannot be empty');
      if (clean !== e.name) run({ t: 'set', id, name: clean });
    },
    /** Change properties (only those the kind defines). @param {string} id @param {Record<string, any>} props */
    setProps(id, props) {
      const e = must(id);
      const spec = ELEMENTS[e.kind]?.props || {};
      for (const k of Object.keys(props)) if (!(k in spec)) throw new ModelError(`${kindName(e.kind, 'sysml')} has no property "${k}"`);
      checkRefs(e.kind, props, e.owner || undefined);
      /** @type {Record<string, any>} */
      const changed = {};
      for (const [k, v] of Object.entries(props)) if (JSON.stringify(e.props[k]) !== JSON.stringify(v)) changed[k] = v;
      if (Object.keys(changed).length) run({ t: 'set', id, props: changed });
    },
    /** Move into a new owner. @param {string} id @param {string} owner @param {number} [index] */
    move(id, owner, index = Infinity) {
      const e = must(id);
      if (!api.canMove(id, owner)) throw new ModelError(`Cannot move ${e.name} there`);
      const list = kids.get(owner) || [];
      if (e.owner === owner && list[Math.min(index, list.length - 1)] === id) return;
      run({ t: 'move', id, owner, index: Number.isFinite(index) ? index : list.length });
    },
    /**
     * Delete an element, everything inside it, every relationship that touches any of
     * them, and clear references to them.
     * @param {string} id
     */
    remove(id) {
      const e = must(id);
      if (!e.owner && !isRel(e.kind)) throw new ModelError('The project root cannot be deleted');
      if (e.layer) throw new ModelError('The RFLP layer packages cannot be deleted');
      /** @type {string[]} */
      const doomed = [];
      const walk = (/** @type {string} */ x) => { for (const c of kids.get(x) || []) walk(c); doomed.push(x); };
      if (isRel(e.kind)) doomed.push(id); else walk(id);
      // connectors to anything being deleted go too, and flows, transitions and messages
      // whose ends are deleted (a required reference)
      for (const d of [...doomed]) for (const c of api.connectorsTouching(d)) if (!doomed.includes(c.id)) doomed.unshift(c.id);
      const req = new Set(doomed);
      for (const d of [...doomed]) for (const ref of api.referrers(d)) {
        if (req.has(ref.id)) continue;
        if (Object.entries(ELEMENTS[ref.kind].props).some(([k, p]) => p.type === 'ref' && p.required && ref.props[k] === d)) { req.add(ref.id); doomed.unshift(ref.id); }
      }
      const set = new Set(doomed);
      for (const d of doomed) for (const r of [...api.relsFrom(d), ...api.relsTo(d)]) if (!set.has(r.id)) { run({ t: 'del', id: r.id }); set.add(r.id); }
      for (const d of doomed) for (const ref of api.referrers(d)) {
        if (set.has(ref.id)) continue;
        /** @type {Record<string, any>} */
        const clear = {};
        for (const [k, p] of Object.entries(ELEMENTS[ref.kind].props)) if (p.type === 'ref' && ref.props[k] === d) clear[k] = null;
        run({ t: 'set', id: ref.id, props: clear });
      }
      // take doomed elements off every diagram that survives
      for (const dk of DIAGRAM_KINDS) for (const dg of api.byKind(dk)) {
        if (set.has(dg.id) || !dg.layout) continue;
        /** @type {Record<string, null>} */
        const off = {};
        for (const key of Object.keys(dg.layout.nodes)) if (key !== FRAME && keyIds(key).some((x) => set.has(x))) off[key] = null;
        if (Object.keys(off).length) run({ t: 'lay', id: dg.id, nodes: off });
      }
      for (const d of doomed) run({ t: 'del', id: d });
    },
    /**
     * Place, move, resize or remove elements on a diagram. A null rect takes the element off
     * the diagram (it stays in the model).
     * @param {string} diagramId @param {Record<string, Rect | null>} patch
     */
    place(diagramId, patch) {
      const d = must(diagramId);
      if (!isDiagram(d.kind) || !d.layout) throw new ModelError(`${d.name} is not a diagram`);
      /** @type {Record<string, Rect | null>} */
      const changes = {};
      for (const [id, r] of Object.entries(patch)) {
        if (r === null) { if (id in d.layout.nodes) changes[id] = null; continue; }
        if (!isLayoutKey(id)) throw new ModelError('That is not a valid place on a diagram');
        for (const x of keyIds(id)) {
          const e = must(x);
          if (isRel(e.kind) || isDiagram(e.kind) || !e.owner) throw new ModelError(`${e.name} cannot be shown on a diagram`);
        }
        const isPort = id.includes('#');
        const rect = /** @type {Rect} */ ({ x: round(r.x), y: round(r.y), w: Math.max(isPort ? 8 : 40, round(r.w)), h: Math.max(isPort ? 8 : 30, round(r.h)) });
        if (r.c) rect.c = 1;
        if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) throw new ModelError('A position must be a number');
        const old = d.layout.nodes[id];
        if (!old || old.x !== rect.x || old.y !== rect.y || old.w !== rect.w || old.h !== rect.h || (old.c || 0) !== (rect.c || 0)) changes[id] = rect;
      }
      if (Object.keys(changes).length) run({ t: 'lay', id: diagramId, nodes: changes });
    },
    /**
     * Create a relationship.
     * @param {string} kind @param {string} source @param {string} target @param {{ id?: string }} [o]
     * @returns {string}
     */
    link(kind, source, target, o = {}) {
      if (!(kind in RELATIONSHIPS)) throw new ModelError(`Unknown relationship ${kind}`);
      const s = must(source), t = must(target);
      if (!api.canLink(kind, source, target)) {
        const dup = api.relsFrom(source).some((r) => r.kind === kind && r.target === target);
        throw new ModelError(dup ? `${s.name} already ${RELATIONSHIPS[kind].verb.sysml} ${t.name}` : `${s.name} cannot have a ${RELATIONSHIPS[kind].names.sysml.toLowerCase()} relationship to ${t.name}`);
      }
      const id = o.id || newId();
      run({ t: 'add', el: { id, kind, name: '', owner: null, source, target, props: {} }, index: 0 });
      return id;
    },
  };

  /** @param {string} kind @param {Record<string, any>} props @param {string} [ownerId] the block owning a connector */
  function checkRefs(kind, props, ownerId) {
    const spec = ELEMENTS[kind]?.props || {};
    for (const [k, v] of Object.entries(props)) {
      const p = spec[k];
      if (p && p.type === 'end' && v !== null) {
        const bad = ownerId ? api.checkEnd(ownerId, v) : 'A connector needs an owner';
        if (bad) throw new ModelError(bad);
        continue;
      }
      if (!p || p.type !== 'ref' || v === null) continue;
      const target = els.get(v);
      if (!target || !p.kinds.includes(target.kind)) throw new ModelError(`${p.label} must be a ${p.kinds.map((x) => kindName(x, 'sysml')).join(' or ')}`);
    }
  }

  /** "Requirement 3": the next free default name among siblings. @param {string} kind @param {string} owner */
  function nextName(kind, owner) {
    const base = kindName(kind, 'sysml');
    const taken = new Set(api.children(owner).map((c) => c.name));
    for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  // ---------- undo / redo ----------
  /** @param {Entry[]} fromStack @param {Entry[]} toStack @param {'undo' | 'redo'} cause */
  function replay(fromStack, toStack, cause) {
    const entry = fromStack.pop();
    if (!entry) return false;
    open = { ops: [], ids: new Set() };
    for (let i = entry.ops.length - 1; i >= 0; i--) open.ops.push(apply(entry.ops[i]));
    const t = open; open = null;
    toStack.push({ label: entry.label, ops: t.ops });
    emit({ label: entry.label, cause, ids: t.ids });
    return true;
  }

  const history = {
    undo: () => replay(undoStack, redoStack, 'undo'),
    redo: () => replay(redoStack, undoStack, 'redo'),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.at(-1)?.label,
    redoLabel: () => redoStack.at(-1)?.label,
    clear: () => { undoStack.length = 0; redoStack.length = 0; },
  };

  /** Load elements directly, bypassing history (used by the file loader). @param {Element[]} list in owner-before-child order */
  function loadRaw(list) {
    for (const el of list) apply({ t: 'add', el, index: Infinity });
    rootId = list.find((e) => !e.owner && !isRel(e.kind))?.id || '';
    emit({ label: 'Open', cause: 'load', ids: new Set(list.map((e) => e.id)) });
  }

  if (!opts.empty) {
    rootId = newId();
    apply({ t: 'add', el: { id: rootId, kind: 'package', name: opts.name || 'Untitled project', owner: null, props: defaultProps('package') }, index: 0 });
    for (const l of LAYERS) apply({ t: 'add', el: { id: newId(), kind: 'package', name: l.name, owner: rootId, layer: l.id, props: defaultProps('package') }, index: Infinity });
  }

  return {
    ...api, transact, ...history, loadRaw,
    /** @param {(e: ChangeEvent) => void} fn @returns {() => void} */
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** Is this a known kind? */
    isKind,
  };
}

/** @typedef {ReturnType<typeof createModel>} Model */

export { RELATIONSHIPS, ELEMENTS };
