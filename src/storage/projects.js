// Projects on this device: a list of project records plus each project's model snapshot.
// Stored in IndexedDB; falls back to memory when IndexedDB is unavailable (private windows,
// blocked site data), so Loom always works, it just can't keep projects between visits.
import { newId } from '../model/ids.js';
import { createModel } from '../model/model.js';
import { snapshot, restore, toFile, fromFile, fileNameFor } from '../model/serialize.js';
import { isRel } from '../model/metamodel.js';
import { sampleById } from '../model/samples.js';
import { applyFramework } from '../model/framework.js';
import { projectFiles, modelFromFiles, signature } from './folder.js';
import { zip, unzip, isZip, textFiles } from './zip.js';

/**
 * @typedef {{
 *   id: string, name: string, description: string,
 *   created: string, modified: string, opened: string,
 *   stats: { elements: number, relationships: number, layers: Record<string, number>, names?: Record<string, string> },
 *   folder?: { name: string, sig: string, synced: string },  // linked to a folder on disk
 * }} ProjectMeta
 * @typedef {'meta' | 'model' | 'handles'} StoreName
 * @typedef {{
 *   get(store: StoreName, key: string): Promise<any>,
 *   put(store: StoreName, key: string, value: any): Promise<void>,
 *   del(store: StoreName, key: string): Promise<void>,
 *   all(store: 'meta'): Promise<any[]>,
 *   persistent: boolean,
 * }} Backend
 */

/** @returns {Backend} */
export function memoryBackend() {
  /** @type {Record<string, Map<string, any>>} */
  const db = { meta: new Map(), model: new Map(), handles: new Map() };
  // folder handles are live objects: kept as they are, not copied
  const copy = (/** @type {StoreName} */ s, /** @type {any} */ v) => (v === undefined || s === 'handles' ? v : JSON.parse(JSON.stringify(v)));
  return {
    persistent: false,
    get: async (s, k) => copy(s, db[s].get(k)),
    put: async (s, k, v) => { db[s].set(k, copy(s, v)); },
    del: async (s, k) => { db[s].delete(k); },
    all: async (s) => [...db[s].values()].map((v) => copy(s, v)),
  };
}

/** @param {string} [name] @returns {Promise<Backend>} */
export async function indexedDbBackend(name = 'pteronautics-loom') {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      const have = req.result.objectStoreNames;
      for (const st of ['meta', 'model', 'handles']) if (!have.contains(st)) req.result.createObjectStore(st);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
  });
  /** @template T @param {StoreName} s @param {IDBTransactionMode} mode @param {(st: IDBObjectStore) => IDBRequest} fn @returns {Promise<T>} */
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
  // the core sets' names in this project's framework, for the card
  const names = Object.fromEntries(m.layers().map((l) => [/** @type {string} */ (l.layer), l.name]));
  return { elements, relationships, layers, names };
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
    /** @param {{ name: string, description?: string, template?: string, framework?: string }} o  template: 'blank' or a sample's id; framework: a FRAMEWORKS id (RFLP when left out) */
    async create(o) {
      const m = createModel();
      if (o.template && o.template !== 'blank') sampleById(o.template)?.build(m);
      // another framework than RFLP: its names for the core sets, and its own sets
      if (o.framework && o.framework !== 'rflp') { applyFramework(m, o.framework); m.clear(); }
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
      await backend.del('handles', id);
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
    /** Add a project from a model made elsewhere (an import from another tool). @param {string} name @param {string} description @param {import('../model/model.js').Model} m */
    async importModel(name, description, m) { return add(await freeName(name.trim() || 'Imported project'), description, m); },
    /** Add a project from a file's bytes: a .loom.json or a .zip of a project folder. @param {Uint8Array} bytes */
    async importBytes(bytes) {
      if (isZip(bytes)) {
        const f = modelFromFiles(textFiles(await unzip(bytes)));
        return add(await freeName(f.name), f.description, f.model);
      }
      return this.importFile(new TextDecoder().decode(bytes));
    },
    /** The project as folder files (SysML text plus .loom/). @param {string} id */
    async files(id) {
      const rec = await meta(id);
      const model = restore(await backend.get('model', id));
      return { name: rec.name, files: projectFiles(model, rec) };
    },
    /** The project as a .zip of its folder. @param {string} id @returns {Promise<{ filename: string, bytes: Uint8Array }>} */
    async exportZip(id) {
      const { name, files } = await this.files(id);
      const top = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
      const bytes = await zip(Object.fromEntries(Object.entries(files).map(([p, t]) => [`${top}/${p}`, t])));
      return { filename: `${top}.zip`, bytes };
    },
    /**
     * Add a project from a folder's files and link it to the folder.
     * @param {Record<string, string>} files @param {any} [handle] @param {string} [folderName]
     */
    async importFolder(files, handle, folderName) {
      const f = modelFromFiles(files);
      const rec = await add(await freeName(f.name), f.description, f.model);
      if (handle) await this.link(rec.id, handle, folderName || handle.name, signature(files));
      return meta(rec.id);
    },
    /** Link a project to a folder on disk. @param {string} id @param {any} handle @param {string} name @param {string} sig */
    async link(id, handle, name, sig) {
      const rec = await meta(id);
      rec.folder = { name, sig, synced: now() };
      await backend.put('handles', id, handle);
      await backend.put('meta', id, rec);
      return rec;
    },
    /** @param {string} id */
    async unlink(id) {
      const rec = await meta(id);
      delete rec.folder;
      await backend.del('handles', id);
      await backend.put('meta', id, rec);
      return rec;
    },
    /** The linked folder's handle, if any. @param {string} id */
    folderHandle: (/** @type {string} */ id) => backend.get('handles', id),
    /** Record that the folder now holds these files. @param {string} id @param {string} sig */
    async synced(id, sig) {
      const rec = await meta(id);
      if (!rec.folder) return rec;
      rec.folder = { ...rec.folder, sig, synced: now() };
      await backend.put('meta', id, rec);
      return rec;
    },
    /** Replace a project's model (loading a folder's newer version). @param {string} id @param {import('../model/model.js').Model} m */
    async replaceModel(id, m) {
      m.clear();
      await backend.put('model', id, snapshot(m));
      return this.save(id, m);
    },
  };
}

/** @typedef {ReturnType<typeof createProjectStore>} ProjectStore */
