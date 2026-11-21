// Model snapshots as JSON, and the .loom.json project file format.
// Loading checks everything (kinds, owners, relationship ends, references), so a damaged or
// hand-edited file is refused with a clear message instead of corrupting the app.
//
// Project folders are saved as SysML v2 text (see src/storage/folder.js); this JSON form is
// the fast local snapshot (IndexedDB) and the single-file .loom.json export.
import { createModel, ModelError, stereoApplies } from './model.js';
import { ELEMENTS, RELATIONSHIPS, isRel, canOwnKind, canRelate, defaultProps, isDiagram } from './metamodel.js';
import { isId } from './ids.js';
import { isLayoutKey, keyIds, FRAME } from './paths.js';

export const MODEL_FORMAT = 'pteronautics-loom-model';
export const FILE_FORMAT = 'pteronautics-loom-project';
export const FORMAT_VERSION = 1;

/** @typedef {import('./model.js').Model} Model */
/** @typedef {import('./model.js').Element} Element */
/** @typedef {{ format: string, version: number, elements: Element[], relationships: Element[] }} Snapshot */

/**
 * Elements in tree order (owners before children, siblings in order), then relationships.
 * @param {Model} m @returns {Snapshot}
 */
export function snapshot(m) {
  /** @type {Element[]} */
  const elements = [];
  const walk = (/** @type {Element} */ e) => { elements.push(JSON.parse(JSON.stringify(e))); m.children(e.id).forEach(walk); };
  walk(m.root());
  const relationships = m.all().filter((e) => isRel(e.kind)).map((e) => JSON.parse(JSON.stringify(e)));
  return { format: MODEL_FORMAT, version: FORMAT_VERSION, elements, relationships };
}

/**
 * Build a model from a snapshot, checking it thoroughly.
 * @param {unknown} data @returns {Model}
 */
export function restore(data) {
  const d = /** @type {any} */ (data);
  if (!d || typeof d !== 'object' || d.format !== MODEL_FORMAT) throw new ModelError('This is not a Loom model');
  if (typeof d.version !== 'number' || d.version > FORMAT_VERSION) throw new ModelError('This model was saved by a newer version of Loom');
  if (!Array.isArray(d.elements) || !Array.isArray(d.relationships)) throw new ModelError('The model is missing its element list');

  /** @type {Map<string, Element>} */
  const seen = new Map();
  /** @type {Element[]} */
  const list = [];
  let roots = 0;
  for (const raw of d.elements) {
    const e = cleanElement(raw);
    if (seen.has(e.id)) throw new ModelError(`Two elements share the id ${e.id}`);
    if (e.owner === null) { roots++; if (e.kind !== 'package') throw new ModelError('The project root must be a package'); }
    else {
      const owner = seen.get(e.owner);
      if (!owner) throw new ModelError(`${e.name} is listed before its owner, or its owner is missing`);
      if (!canOwnKind(owner.kind, e.kind)) throw new ModelError(`${owner.name} cannot contain ${e.name}`);
    }
    seen.set(e.id, e); list.push(e);
  }
  if (roots !== 1) throw new ModelError('A model must have exactly one root package');
  for (const e of list) {
    for (const [k, p] of Object.entries(ELEMENTS[e.kind].props)) {
      if (p.type === 'stereo' && e.props[k]) {
        // stereotypes that are missing, or do not apply to this kind, are dropped; so are unknown tags
        const ok = /** @type {import('./metamodel.js').Applied[]} */ (e.props[k]).filter((a, i, all) => { const st = seen.get(a.s); return st && st.kind === 'stereotype' && stereoApplies(st, e.kind) && all.findIndex((b) => b.s === a.s) === i; })
          .map((a) => { if (!a.tags) return a; const tags = Object.fromEntries(Object.entries(a.tags).filter(([t]) => { const te = seen.get(t); return te && te.kind === 'attribute' && te.owner === a.s; })); return Object.keys(tags).length ? { s: a.s, tags } : { s: a.s }; });
        e.props[k] = ok.length ? ok : null;
        continue;
      }
      if (p.type !== 'ref' || e.props[k] === null) continue;
      const t = seen.get(e.props[k]);
      if (!t || !p.kinds.includes(t.kind)) e.props[k] = null; // a dangling reference is cleared, not fatal
    }
  }
  // connectors whose ends point at missing things are dropped
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.kind !== 'connector') continue;
    const ends = [e.props.end1, e.props.end2];
    if (ends.some((end) => !end || [...end.path, ...(end.port ? [end.port] : [])].some((x) => !seen.has(x)))) { list.splice(i, 1); seen.delete(e.id); }
  }
  // diagrams only show elements that exist and can be shown
  for (const e of list) {
    if (!e.layout) continue;
    for (const key of Object.keys(e.layout.nodes)) {
      if (key === FRAME) continue;
      if (keyIds(key).some((id) => { const t = seen.get(id); return !t || !t.owner || isDiagram(t.kind) || isRel(t.kind); })) delete e.layout.nodes[key];
    }
  }
  for (const raw of d.relationships) {
    const r = cleanRelationship(raw);
    const s = seen.get(/** @type {string} */ (r.source)), t = seen.get(/** @type {string} */ (r.target));
    if (seen.has(r.id)) throw new ModelError(`Two elements share the id ${r.id}`);
    if (!s || !t) continue; // relationship to a missing element: dropped
    if (!canRelate(r.kind, s.kind, t.kind)) throw new ModelError(`${s.name} cannot have a ${r.kind} relationship to ${t.name}`);
    seen.set(r.id, r); list.push(r);
  }
  const m = createModel({ empty: true });
  m.loadRaw(list);
  return m;
}

/** @param {any} raw @returns {Element} */
function cleanElement(raw) {
  if (!raw || typeof raw !== 'object') throw new ModelError('An element entry is not an object');
  if (!isId(raw.id)) throw new ModelError('An element has a missing or invalid id');
  if (!(raw.kind in ELEMENTS)) throw new ModelError(`Unknown element kind "${raw.kind}"`);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 500) : 'Unnamed';
  const owner = raw.owner === null || raw.owner === undefined ? null : String(raw.owner);
  const props = defaultProps(raw.kind);
  const spec = ELEMENTS[raw.kind].props;
  for (const [k, p] of Object.entries(spec)) {
    const v = raw.props?.[k];
    if (v === undefined) continue;
    if (p.type === 'bool') props[k] = v === true;
    else if (p.type === 'enum') props[k] = p.options.includes(v) ? v : p.default;
    else if (p.type === 'ref') props[k] = isId(v) ? v : null;
    else if (p.type === 'stereo') props[k] = cleanApplied(v);
    else if (p.type === 'end') props[k] = v && Array.isArray(v.path) && v.path.length <= 32 && v.path.every(isId) && (v.port === null || v.port === undefined || isId(v.port)) ? { path: [...v.path], port: v.port ?? null } : null;
    else props[k] = String(v).slice(0, 20000);
  }
  // same key order as elements created in the app, so saved files diff cleanly
  const layer = ['r', 'f', 'l', 'p'].includes(raw.layer) ? raw.layer : undefined;
  /** @type {Element} */
  const e = layer ? { id: raw.id, kind: raw.kind, name, owner, layer, props } : { id: raw.id, kind: raw.kind, name, owner, props };
  if (isDiagram(raw.kind)) e.layout = { nodes: cleanLayout(raw.layout?.nodes) };
  return e;
}

/** Applied stereotypes: a short list of { s: id, tags: { id: text } }. @param {any} v @returns {import('./metamodel.js').Applied[] | null} */
function cleanApplied(v) {
  if (!Array.isArray(v)) return null;
  /** @type {import('./metamodel.js').Applied[]} */
  const out = [];
  for (const a of v.slice(0, 64)) {
    if (!a || typeof a !== 'object' || !isId(a.s)) continue;
    /** @type {Record<string, string>} */
    const tags = {};
    if (a.tags && typeof a.tags === 'object') for (const [t, val] of Object.entries(a.tags).slice(0, 200)) if (isId(t) && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')) tags[t] = String(val).slice(0, 2000);
    out.push(Object.keys(tags).length ? { s: a.s, tags } : { s: a.s });
  }
  return out.length ? out : null;
}

/** Keep only well-formed rectangles. @param {any} nodes @returns {Record<string, import('./model.js').Rect>} */
function cleanLayout(nodes) {
  /** @type {Record<string, import('./model.js').Rect>} */
  const out = {};
  if (!nodes || typeof nodes !== 'object') return out;
  const num = (/** @type {any} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
  for (const [id, r] of Object.entries(nodes)) {
    if (!isLayoutKey(id) || !r || typeof r !== 'object') continue;
    const small = id.includes('#');
    const x = num(r.x, -1e6, 1e6), y = num(r.y, -1e6, 1e6), w = num(r.w, small ? 8 : 40, 8000), h = num(r.h, small ? 8 : 30, 8000);
    if (x === null || y === null || w === null || h === null) continue;
    out[id] = r.c === 1 ? { x, y, w, h, c: 1 } : { x, y, w, h };
  }
  return out;
}

/** @param {any} raw @returns {Element} */
function cleanRelationship(raw) {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new ModelError('A relationship has a missing or invalid id');
  if (!(raw.kind in RELATIONSHIPS)) throw new ModelError(`Unknown relationship kind "${raw.kind}"`);
  if (!isId(raw.source) || !isId(raw.target)) throw new ModelError('A relationship is missing an end');
  return { id: raw.id, kind: raw.kind, name: '', owner: null, source: raw.source, target: raw.target, props: {} };
}

/**
 * A complete project file (.loom.json).
 * @param {{ name: string, description?: string, created?: string }} meta @param {Model} m
 */
export function toFile(meta, m) {
  return JSON.stringify({
    format: FILE_FORMAT, version: FORMAT_VERSION,
    project: { name: meta.name, description: meta.description || '', created: meta.created || new Date().toISOString(), exported: new Date().toISOString() },
    model: snapshot(m),
  }, null, 2) + '\n';
}

/**
 * Read a project file. Throws ModelError with a readable message on anything wrong.
 * @param {string} text @returns {{ name: string, description: string, model: Model }}
 */
export function fromFile(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new ModelError('This file is not valid JSON'); }
  if (!d || d.format !== FILE_FORMAT) throw new ModelError('This is not a Loom project file (.loom.json)');
  if (typeof d.version !== 'number' || d.version > FORMAT_VERSION) throw new ModelError('This project was saved by a newer version of Loom');
  const model = restore(d.model);
  const name = typeof d.project?.name === 'string' && d.project.name.trim() ? d.project.name.trim().slice(0, 200) : model.root().name;
  return { name, description: typeof d.project?.description === 'string' ? d.project.description.slice(0, 2000) : '', model };
}

/** A safe file name for a project. @param {string} name */
export function fileNameFor(name) {
  return (name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project') + '.loom.json';
}
