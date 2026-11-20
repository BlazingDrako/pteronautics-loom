// Projects on this device: a list of project records plus each project's model snapshot.
// Stored in IndexedDB; falls back to memory when IndexedDB is unavailable (private windows,
// blocked site data), so Loom always works, it just can't keep projects between visits.
import { newId } from '../model/ids.js';
import { createModel } from '../model/model.js';
import { snapshot, restore, toFile, fromFile, fileNameFor } from '../model/serialize.js';
import { isRel } from '../model/metamodel.js';
import { buildKestrel } from '../model/sample.js';

/**
 * @typedef {{
 *   id: string, name: string, description: string,
 *   created: string, modified: string, opened: string,
 *   stats: { elements: number, relationships: number, layers: Record<string, number> },
 * }} ProjectMeta
 * @typedef {{
 *   get(store: 'meta' | 'model', key: string): Promise<any>,
 *   put(store: 'meta' | 'model', key: string, value: any): Promise<void>,
 *   del(store: 'meta' | 'model', key: string): Promise<void>,
 *   all(store: 'meta'): Promise<any[]>,
 *   persistent: boolean,
 * }} Backend
 */

/** @returns {Backend} */
export function memoryBackend() {
  /** @type {Record<string, Map<string, any>>} */
  const db = { meta: new Map(), model: new Map() };
  const copy = (/** @type {any} */ v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    persistent: false,
    get: async (s, k) => copy(db[s].get(k)),
    put: async (s, k, v) => { db[s].set(k, copy(v)); },
    del: async (s, k) => { db[s].delete(k); },
    all: async (s) => [...db[s].values()].map(copy),
  };
}

/** @param {string} [name] @returns {Promise<Backend>} */
export async function indexedDbBackend(name = 'pteronautics-loom') {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('meta'); req.result.createObjectStore('model'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
  });
  /** @template T @param {'meta' | 'model'} s @param {IDBTransactionMode} mode @param {(st: IDBObjectStore) => IDBRequest} fn @returns {Promise<T>} */
  const op = (s, mode, fn) => new Promise((resolve, reject) => {
    const t = /** @type {IDBDatabase} */ (db).transaction(s, mode);
    const r = fn(t.objectStore(s));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was aborted'));
  });
  return {
    persistent: true,
    get: (s, k) => op(s, 'readonly', (st) => st.get(k)),
    put: async (s, k, v) => { await op(s, 'readwrite', (st) => st.put(v, k)); },
    del: async (s, k) => { await op(s, 'readwrite', (st) => st.delete(k)); },
    all: (s) => op(s, 'readonly', (st) => st.getAll()),
  };
}

/** Pick IndexedDB when it works, memory otherwise. */
export async function defaultBackend() {
  try { if (typeof indexedDB !== 'undefined') return await indexedDbBackend(); } catch { /* fall through */ }
  return memoryBackend();
}

/** Counts for the project card. @param {import('../model/model.js').Model} m */
export function statsOf(m) {
  /** @type {Record<string, number>} */
  const layers = { r: 0, f: 0, l: 0, p: 0 };
  let elements = 0, relationships = 0;
  for (const e of m.all()) {
    if (isRel(e.kind)) { relationships++; continue; }
    if (!e.owner || e.layer) continue; // root and layer packages are scaffolding
    elements++;
    const l = m.layerOf(e.id);
    if (l) layers[l]++;
  }
  return { elements, relationships, layers };
}

/** @param {Backend} backend */
export function createProjectStore(backend) {
  const now = () => new Date().toISOString();

  /** @param {string} name @param {string} description @param {import('../model/model.js').Model} m @returns {Promise<ProjectMeta>} */
  async function add(name, description, m) {
    const t = now();
    /** @type {ProjectMeta} */
    const meta = { id: newId(), name, description, created: t, modified: t, opened: t, stats: statsOf(m) };
    m.transact('Name the project', (tx) => tx.rename(m.root().id, name));
    m.clear();
    await backend.put('model', meta.id, snapshot(m));
    await backend.put('meta', meta.id, meta);
    return meta;
  }

  /** @param {string} id @returns {Promise<ProjectMeta>} */
  async function meta(id) {
    const m = await backend.get('meta', id);
    if (!m) throw new Error('This project no longer exists');
    return m;
  }

  /** A name that is not already used: "Alpha", then "Alpha (2)", "Alpha (3)"… @param {string} name */
  async function freeName(name) {
    const names = new Set((await backend.all('meta')).map((m) => m.name));
    if (!names.has(name)) return name;
    const base = name.replace(/ \(\d+\)$/, '');
    for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
  }

  return {
    persistent: backend.persistent,
    /** Most recently opened first. @returns {Promise<ProjectMeta[]>} */
    async list() {
      const all = /** @type {ProjectMeta[]} */ (await backend.all('meta'));
      return all.sort((a, b) => (b.opened || b.modified).localeCompare(a.opened || a.modified));
    },
    /** @param {{ name: string, description?: string, template?: 'blank' | 'kestrel' }} o */
    async create(o) {
      const m = createModel();
      if (o.template === 'kestrel') buildKestrel(m);
      return add(await freeName(o.name.trim() || 'Untitled project'), o.description || '', m);
    },
    /** Open a project: its record and a live model. @param {string} id */
    async open(id) {
      const rec = await meta(id);
      const snap = await backend.get('model', id);
      const model = restore(snap);
      rec.opened = now();
      await backend.put('meta', id, rec);
      return { meta: rec, model };
    },
    /** Save a project's model (autosave calls this). @param {string} id @param {import('../model/model.js').Model} m */
    async save(id, m) {
      const rec = await meta(id);
      rec.modified = now();
      rec.name = m.root().name;
      rec.stats = statsOf(m);
      await backend.put('model', id, snapshot(m));
      await backend.put('meta', id, rec);
      return rec;
    },
    /** @param {string} id @param {string} name */
    async rename(id, name) {
      const clean = name.replace(/\s+/g, ' ').trim();
      if (!clean) throw new Error('A project name cannot be empty');
      const rec = await meta(id);
      const model = restore(await backend.get('model', id));
      model.transact('Rename project', (tx) => tx.rename(model.root().id, clean));
      rec.name = clean; rec.modified = now();
      await backend.put('model', id, snapshot(model));
      await backend.put('meta', id, rec);
      return rec;
    },
    /** @param {string} id */
    async duplicate(id) {
      const rec = await meta(id);
      const model = restore(await backend.get('model', id));
      return add(await freeName(`${rec.name} copy`), rec.description, model);
    },
    /** @param {string} id */
    async remove(id) {
      await backend.del('model', id);
      await backend.del('meta', id);
    },
    /** The project as a .loom.json file. @param {string} id @returns {Promise<{ filename: string, text: string }>} */
    async exportFile(id) {
      const rec = await meta(id);
      const model = restore(await backend.get('model', id));
      return { filename: fileNameFor(rec.name), text: toFile(rec, model) };
    },
    /** Add a project from a .loom.json file's text. @param {string} text */
    async importFile(text) {
      const f = fromFile(text);
      return add(await freeName(f.name), f.description, f.model);
    },
  };
}

/** @typedef {ReturnType<typeof createProjectStore>} ProjectStore */
