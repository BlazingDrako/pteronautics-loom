// A Loom project as a folder of files, ready for git:
//
//   requirements.sysml  functional.sysml  logical.sysml  physical.sysml   the model, as SysML v2 text
//   .loom/project.json   name, description, format version
//   .loom/ids.json       stable element ids by qualified name (so diagrams survive edits)
//   .loom/layout.json    where things sit on each diagram
//
// Every file is written in a stable order with one entry per line, so diffs and merges are small.
import { createModel, ModelError } from '../model/model.js';
import { restore } from '../model/serialize.js';
import { LAYERS, isDiagram, isRel } from '../model/metamodel.js';
import { newId } from '../model/ids.js';
import { printModel, LAYER_FILES } from '../text/printer.js';
import { parseLayer, buildSnapshot } from '../text/build.js';
import { TextError } from '../text/lexer.js';
import { keysOf } from '../text/names.js';
import { VERSION } from '../version.js';
import { parseConfig, configText } from '../validate/engine.js';

/** The validation settings as saved in project.json (an object), from the root's text. @param {string} text */
const validationOut = (text) => { if (!text) return undefined; try { return JSON.parse(text); } catch { return undefined; } };
/** And back: the same text the app writes, whatever the key order in the file. @param {unknown} v */
const validationIn = (v) => (v && typeof v === 'object' ? configText(parseConfig(v)) : '');

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {Record<string, string>} Files  path → text */

export const FOLDER_FORMAT = 'pteronautics-loom-folder';
export const FOLDER_VERSION = 1;
export const PROJECT_FILE = '.loom/project.json';
export const IDS_FILE = '.loom/ids.json';
export const LAYOUT_FILE = '.loom/layout.json';

/** A problem in one file of a folder. */
export class FileError extends Error {
  /** @param {string} file @param {string} message @param {number} [line] @param {number} [col] */
  constructor(file, message, line, col) { super(line ? `${file}, line ${line}: ${message}` : `${file}: ${message}`); this.file = file; this.line = line; this.col = col; }
}

/** JSON with sorted keys, one entry per line, small flat objects on one line. @param {any} v @param {string} [pad] @returns {string} */
export function stableJson(v, pad = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableJson(x, pad)).join(', ')}]`;
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  const flat = keys.every((k) => v[k] === null || typeof v[k] !== 'object');
  // small flat objects (rectangles) keep their own order (x, y, w, h) on one line
  if (flat && keys.length <= 6) return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(v[k])}`).join(', ')} }`;
  keys.sort();
  const inner = pad + '  ';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stableJson(v[k], inner)}`).join(',\n')}\n${pad}}`;
}

/**
 * The files for a project.
 * @param {Model} m @param {{ name: string, description?: string }} meta @returns {Files}
 */
export function projectFiles(m, meta) {
  /** @type {Files} */
  const files = {};
  for (const f of printModel(m)) files[f.path] = f.text;
  const keys = keysOf(m);
  /** @type {Record<string, string>} */
  const ids = {};
  for (const [id, key] of keys) ids[key] = id;
  /** @type {Record<string, any>} */
  const layouts = {};
  // each diagram's boxes by key, and its hand-shaped lines (if any) under "~lines"
  for (const e of m.all()) if (isDiagram(e.kind) && e.layout && (Object.keys(e.layout.nodes).length || e.layout.lines)) layouts[e.id] = e.layout.lines ? { ...e.layout.nodes, '~lines': e.layout.lines } : e.layout.nodes;
  files[PROJECT_FILE] = stableJson({
    format: FOLDER_FORMAT, version: FOLDER_VERSION, savedBy: `Pteronautics Loom ${VERSION}`,
    name: meta.name, description: meta.description || '', root: m.root().id,
    layers: Object.fromEntries(m.layers().map((l) => [/** @type {string} */ (l.layer), LAYER_FILES[/** @type {string} */ (l.layer)]])),
    ...(m.root().props.validation ? { validation: validationOut(m.root().props.validation) } : {}),
  }) + '\n';
  files[IDS_FILE] = stableJson(ids) + '\n';
  files[LAYOUT_FILE] = stableJson(layouts) + '\n';
  return files;
}

/** @param {Files} files @param {string} path */
function readJson(files, path) {
  if (!(path in files)) return null;
  try { return JSON.parse(files[path]); } catch { throw new FileError(path, 'This is not valid JSON'); }
}

/**
 * Build a model from a project folder's files. Throws FileError naming the file and line.
 * @param {Files} files @returns {{ model: Model, name: string, description: string }}
 */
export function modelFromFiles(files) {
  const proj = readJson(files, PROJECT_FILE) || {};
  if (proj.format && proj.format !== FOLDER_FORMAT) throw new FileError(PROJECT_FILE, 'This is not a Loom project folder');
  if (typeof proj.version === 'number' && proj.version > FOLDER_VERSION) throw new FileError(PROJECT_FILE, 'This project was saved by a newer version of Loom');
  const idsRaw = readJson(files, IDS_FILE) || {};
  const layouts = readJson(files, LAYOUT_FILE) || {};
  /** @type {Map<string, string>} */
  const ids = new Map(Object.entries(idsRaw).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)));

  // which file is which layer: what project.json says, else the usual file names
  // the layer files project.json names, or every .sysml file at the top when it names none
  const listed = proj.layers && typeof proj.layers === 'object' ? Object.values(proj.layers).filter((f) => typeof f === 'string' && f in files) : [];
  const sysml = (listed.length ? /** @type {string[]} */ (listed) : Object.keys(files).filter((p) => p.endsWith('.sysml') && !p.includes('/'))).sort();
  if (!sysml.length) throw new FileError('(folder)', 'There are no .sysml files here');
  /** @type {{ layer: string, path: string, node: import('../text/parser.js').Node }[]} */
  const parsed = [];
  for (const path of sysml) {
    let node;
    try { node = parseLayer(files[path]); } catch (e) { if (e instanceof TextError) throw new FileError(path, e.message, e.line, e.col); throw e; }
    const lm = node.meta.find((x) => x.key === 'layer');
    const byName = Object.entries(proj.layers || LAYER_FILES).find(([, f]) => f === path)?.[0];
    const layer = typeof lm?.value === 'string' ? lm.value : byName;
    if (!layer || !['r', 'f', 'l', 'p'].includes(layer)) throw new FileError(path, 'Loom cannot tell which RFLP layer this file is. Add @Loom { layer = "r"; } (or f, l, p) inside its package', node.line, node.col);
    if (parsed.some((x) => x.layer === layer)) throw new FileError(path, `Two files are the ${LAYERS.find((l) => l.id === layer)?.name} layer`);
    parsed.push({ layer, path, node });
  }

  // the skeleton: root and the four layer packages, with their saved ids
  const name = typeof proj.name === 'string' && proj.name.trim() ? proj.name.trim().slice(0, 200) : 'Imported project';
  const rootId = typeof proj.root === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(proj.root) ? proj.root : newId();
  const skel = createModel({ empty: true });
  const layerEls = LAYERS.map((l) => {
    const p = parsed.find((x) => x.layer === l.id);
    const lname = p?.node.name || l.name;
    const hinted = ids.get(`package:${lname}`);
    return { id: hinted && hinted !== rootId ? hinted : newId(), kind: 'package', name: lname, owner: rootId, layer: l.id, props: { idPrefix: '', validation: '', doc: '' } };
  });
  skel.loadRaw([{ id: rootId, kind: 'package', name, owner: null, props: { idPrefix: '', validation: validationIn(proj.validation), doc: '' } }, .../** @type {any[]} */ (layerEls)]);

  const inputs = parsed.map((p) => ({ layerId: /** @type {string} */ (layerEls.find((l) => l.layer === p.layer)?.id), node: p.node, path: p.path }));
  let snap;
  try {
    snap = buildSnapshot(skel, inputs, { hint: (k) => ids.get(k), layouts: layouts && typeof layouts === 'object' ? layouts : {} });
  } catch (e) {
    if (e instanceof TextError) throw new FileError(/** @type {any} */ (e).file || inputs[0].path, e.message, e.line, e.col);
    throw e;
  }
  let model;
  try { model = restore(snap); } catch (e) { throw new FileError('(folder)', e instanceof Error ? e.message : String(e)); }
  return { model, name, description: typeof proj.description === 'string' ? proj.description.slice(0, 2000) : '' };
}

/**
 * Folder files as an update to a live model (loading changes made outside Loom, such as a
 * git pull). Elements are matched to the live model by name, so ids and diagrams carry over.
 * @param {Model} m @param {Files} files @returns {import('../model/serialize.js').Snapshot}
 */
export function snapshotFromFiles(m, files) {
  const proj = readJson(files, PROJECT_FILE) || {};
  const ids = new Map(Object.entries(readJson(files, IDS_FILE) || {}));
  const layouts = readJson(files, LAYOUT_FILE) || {};
  const listed = proj.layers && typeof proj.layers === 'object' ? Object.values(proj.layers).filter((f) => typeof f === 'string' && f in files) : [];
  const sysml = (listed.length ? /** @type {string[]} */ (listed) : Object.keys(files).filter((p) => p.endsWith('.sysml') && !p.includes('/'))).sort();
  const inputs = [];
  for (const path of sysml) {
    let node;
    try { node = parseLayer(files[path]); } catch (e) { if (e instanceof TextError) throw new FileError(path, e.message, e.line, e.col); throw e; }
    const lm = node.meta.find((x) => x.key === 'layer');
    const layer = typeof lm?.value === 'string' ? lm.value : Object.entries(proj.layers || LAYER_FILES).find(([, f]) => f === path)?.[0];
    const live = m.layers().find((l) => l.layer === layer);
    if (!live) throw new FileError(path, 'Loom cannot tell which RFLP layer this file is. Add @Loom { layer = "r"; } (or f, l, p) inside its package', node.line, node.col);
    inputs.push({ layerId: live.id, node, path });
  }
  try {
    const snap = buildSnapshot(m, inputs, { hint: (k) => /** @type {string | undefined} */ (ids.get(k)), layouts, preferLayouts: true });
    if (typeof proj.name === 'string' && proj.name.trim()) snap.elements[0].name = proj.name.trim().slice(0, 200);
    snap.elements[0].props = { ...snap.elements[0].props, validation: validationIn(proj.validation) };
    return snap;
  } catch (e) {
    if (e instanceof TextError) throw new FileError(/** @type {any} */ (e).file || sysml[0], e.message, e.line, e.col);
    throw e;
  }
}

/** Only the files with these paths. @param {Files} files @param {string[]} paths @returns {Files} */
export const pick = (files, paths) => Object.fromEntries(paths.filter((p) => p in files).map((p) => [p, files[p]]));

/** A short fingerprint of a set of files, to notice changes made outside Loom. @param {Files} files */
export function signature(files) {
  let h = 2166136261;
  for (const path of Object.keys(files).sort()) {
    const s = path + '\u0000' + files[path] + '\u0001';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The files a folder project owns (others in the folder are left alone). @param {string} path */
export const ownsFile = (path) => path.endsWith('.sysml') || path.startsWith('.loom/');

export { isRel, ModelError };
