// Names in text: how a reference like 'Battery Pack' or Logical::'Battery Pack' finds its
// element, and how the printer writes the shortest reference that finds it again.
// Also the stable keys (qualified names) used to keep element ids across saves.
import { RELATIONSHIPS, ELEMENTS, isRel, isDiagram } from '../model/metamodel.js';
import { quoteName } from './lexer.js';

/**
 * The little a resolver needs from a model (a live model or one being built).
 * @typedef {{ get(id: string): { id: string, kind: string, name: string, owner: string | null } | undefined, children(id: string): { id: string, kind: string, name: string }[], rootId: string, all(): { id: string, kind: string, name: string, owner: string | null }[] }} Tree
 */

/** @param {import('../model/model.js').Model} m @returns {Tree} */
export function treeOf(m) {
  return { get: (id) => m.get(id), children: (id) => m.children(id), rootId: m.root().id, all: () => m.all() };
}

/** Element kinds a reference may land on, or null for "anything referable". */
export const TYPE_KINDS = /** @type {Record<string, string[]>} */ ({ part: ['partDef'], port: ['interfaceDef'] });
/** @param {string} rel */
export function targetKinds(rel) {
  const t = RELATIONSHIPS[rel]?.targets;
  return t === '*' ? Object.keys(ELEMENTS).filter((k) => k !== 'comment' && !isDiagram(k)) : t || [];
}

/** Name index, built once per tree. @type {WeakMap<object, Map<string, string[]>>} */
const indexes = new WeakMap();
/** @param {Tree} t @param {string} name */
function byName(t, name) {
  let ix = indexes.get(t);
  if (!ix) {
    ix = new Map();
    for (const e of t.all()) if (!isRel(e.kind) && e.owner) (ix.get(e.name) || ix.set(e.name, []).get(e.name))?.push(e.id);
    indexes.set(t, ix);
  }
  return ix.get(name) || [];
}

/**
 * Find what a reference names.
 *   One name: the nearest enclosing scope that has it, else the one element in the model with
 *   that name (and an allowed kind).
 *   A::B::C: from the top (layers), or from an enclosing scope.
 * @param {Tree} t @param {string[]} parts @param {string} contextId @param {string[] | null} kinds
 * @returns {{ id: string } | { error: string }}
 */
export function resolve(t, parts, contextId, kinds) {
  const ok = (/** @type {string} */ id) => { const e = t.get(id); return !!e && !isRel(e.kind) && !!e.owner && (!kinds || kinds.includes(e.kind)); };
  const label = parts.map(quoteName).join('::');
  const chain = [];
  for (let c = t.get(contextId); c; c = c.owner ? t.get(c.owner) : undefined) chain.push(c.id);
  if (parts.length === 1) {
    const n = parts[0];
    for (const c of chain) {
      const hits = t.children(c).filter((x) => x.name === n && ok(x.id));
      if (hits.length === 1) return { id: hits[0].id };
      if (hits.length > 1) return { error: `${label} is ambiguous here: ${hits.length} elements have that name` };
    }
    const all = byName(t, n).filter(ok);
    if (all.length === 1) return { id: all[0] };
    if (all.length > 1) return { error: `${label} is ambiguous: ${all.length} elements have that name. Qualify it, as in Package::${label}` };
    return { error: `Nothing named ${label} can be used here` };
  }
  /** @type {Set<string>} */
  const found = new Set();
  const starts = new Set([...t.children(t.rootId).filter((x) => x.name === parts[0]).map((x) => x.id)]);
  for (const c of chain) for (const x of t.children(c)) if (x.name === parts[0]) starts.add(x.id);
  if (!starts.size) for (const id of byName(t, parts[0])) starts.add(id);
  for (const s of starts) {
    let cur = [s];
    for (let i = 1; i < parts.length && cur.length; i++) cur = cur.flatMap((id) => t.children(id).filter((x) => x.name === parts[i]).map((x) => x.id));
    for (const id of cur) if (ok(id)) found.add(id);
  }
  if (found.size === 1) return { id: [...found][0] };
  if (found.size > 1) return { error: `${label} is ambiguous: ${found.size} elements match` };
  return { error: `Nothing named ${label} can be used here` };
}

/**
 * The shortest reference text that finds `targetId` from `contextId`.
 * @param {Tree} t @param {string} targetId @param {string} contextId @param {string[] | null} kinds
 */
export function refText(t, targetId, contextId, kinds) {
  const e = t.get(targetId);
  if (!e) return "'?'";
  const path = [];
  for (let c = e; c && c.owner; c = t.get(c.owner)) path.unshift(c.name);
  for (let n = 1; n <= path.length; n++) {
    const parts = path.slice(path.length - n);
    const r = resolve(t, parts, contextId, kinds);
    if ('id' in r && r.id === targetId) return parts.map(quoteName).join('::');
  }
  return path.map(quoteName).join('::');
}

/**
 * Stable keys for every element and relationship: the path of names from the project root,
 * the kind, and a counter when siblings share a name. Used to keep ids across text round trips.
 * @param {import('../model/model.js').Model} m @returns {Map<string, string>} id → key
 */
export function keysOf(m) {
  /** @type {Map<string, string>} */
  const keys = new Map();
  /** @param {string} id @param {string} prefix */
  const walk = (id, prefix) => {
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const c of m.children(id)) {
      const base = `${prefix}${prefix ? '::' : ''}${c.name}`;
      const k = `${c.kind}|${c.name}`;
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      const key = `${base}${n > 1 ? `~${n}` : ''}`;
      keys.set(c.id, `${c.kind}:${key}`);
      walk(c.id, key);
    }
  };
  walk(m.root().id, '');
  for (const r of m.all()) if (isRel(r.kind) && r.source && r.target) keys.set(r.id, relKey(r.kind, keys.get(r.source) || r.source, keys.get(r.target) || r.target));
  return keys;
}
/** @param {string} kind @param {string} s @param {string} t */
export const relKey = (kind, s, t) => `${kind}(${s} > ${t})`;
