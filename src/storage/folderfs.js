// Real folders on disk, through the File System Access API (Chrome, Edge, Opera, Arc…).
// Other browsers use zip export and import instead. Loom only ever touches the files it owns:
// *.sysml at the top of the folder and everything in .loom/.
import { ownsFile } from './folder.js';
import { LAYER_FILES } from '../text/printer.js';

/** Can this browser open and save real folders? */
export const canUseFolders = () => typeof globalThis.showDirectoryPicker === 'function';

/** Ask the user for a folder. @returns {Promise<FileSystemDirectoryHandle | null>} null when they cancel */
export async function pickFolder() {
  try { return await /** @type {any} */ (globalThis).showDirectoryPicker({ id: 'loom-project', mode: 'readwrite' }); }
  catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return null; throw e; }
}

/**
 * Do we have read/write access? With `ask`, ask the user (only works during a click).
 * @param {any} dir @param {boolean} [ask] @returns {Promise<boolean>}
 */
export async function hasAccess(dir, ask = false) {
  const opts = { mode: 'readwrite' };
  try {
    if ((await dir.queryPermission?.(opts)) === 'granted') return true;
    if (!ask) return !dir.queryPermission; // handles without permissions (tests) are always usable
    return (await dir.requestPermission?.(opts)) === 'granted';
  } catch { return false; }
}

/**
 * Read the project files in a folder.
 * @param {any} dir a FileSystemDirectoryHandle @returns {Promise<Record<string, string>>}
 */
export async function readFolder(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && name.endsWith('.sysml')) out[name] = await (await h.getFile()).text();
    else if (h.kind === 'directory' && name === '.loom') {
      for await (const [n2, h2] of h.entries()) if (h2.kind === 'file' && n2.endsWith('.json')) out[`.loom/${n2}`] = await (await h2.getFile()).text();
    }
  }
  return out;
}

/**
 * Write project files into a folder: only files whose text changed are rewritten, and layer
 * files Loom no longer writes are removed. Other files are never touched.
 * @param {any} dir @param {Record<string, string>} files @returns {Promise<number>} files written
 */
export async function writeFolder(dir, files) {
  const existing = await readFolder(dir);
  let written = 0;
  for (const [path, text] of Object.entries(files)) {
    if (!ownsFile(path) || existing[path] === text) continue;
    const parts = path.split('/');
    let d = dir;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const fh = await d.getFileHandle(/** @type {string} */ (parts.at(-1)), { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    written++;
  }
  // a layer file Loom used to write (say, after renaming a layer file in project.json) goes;
  // any other .sysml file in the folder is the user's and stays
  for (const path of Object.keys(existing)) {
    if (path in files || !Object.values(LAYER_FILES).includes(path)) continue;
    await dir.removeEntry(path);
  }
  return written;
}

/**
 * An in-memory folder with the same API, for tests and for browsers without folders.
 * @param {Record<string, string>} [init]
 */
export function memoryFolder(init = {}, name = 'project') {
  /** @type {Map<string, string>} */
  const files = new Map(Object.entries(init));
  /** @param {string} prefix */
  const dirAt = (prefix) => ({
    kind: 'directory', name: prefix ? prefix.slice(0, -1).split('/').pop() : name,
    async *entries() {
      const seen = new Set();
      for (const p of [...files.keys()].sort()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length), i = rest.indexOf('/');
        if (i < 0) yield [rest, { kind: 'file', name: rest, getFile: async () => ({ text: async () => files.get(p) }) }];
        else if (!seen.has(rest.slice(0, i))) { seen.add(rest.slice(0, i)); yield [rest.slice(0, i), dirAt(prefix + rest.slice(0, i) + '/')]; }
      }
    },
    getDirectoryHandle: async (/** @type {string} */ n) => dirAt(prefix + n + '/'),
    getFileHandle: async (/** @type {string} */ n) => ({ createWritable: async () => { let buf = ''; return { write: async (/** @type {string} */ t) => { buf += t; }, close: async () => { files.set(prefix + n, buf); } }; } }),
    removeEntry: async (/** @type {string} */ n) => { files.delete(prefix + n); },
  });
  return Object.assign(dirAt(''), { files });
}
