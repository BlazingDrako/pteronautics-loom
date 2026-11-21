// Diagram layout keys. A block definition diagram keys its boxes by element id. An internal
// block diagram shows *usages*, and the same part can appear more than once when its block is
// used in several places, so it keys boxes by the path of part ids from the diagram's block:
//
//   "@frame"                the diagram frame (the block the diagram is about)
//   "p1/p2"                 part p2 inside part p1
//   "p1/p2#port"            a port on that part
//   "#port"                 a port on the frame (the block's own port, seen from inside)

export const FRAME = '@frame';

const KEY = /^(@frame|#[A-Za-z0-9_-]{1,64}|[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,31}(#[A-Za-z0-9_-]{1,64})?)$/;

/** Is this a well-formed layout key? @param {unknown} key */
export const isLayoutKey = (key) => typeof key === 'string' && KEY.test(key);

/**
 * @param {string} key
 * @returns {{ frame: true, path: string[], port: null } | { frame: false, path: string[], port: string | null }}
 */
export function parseKey(key) {
  if (key === FRAME) return { frame: true, path: [], port: null };
  const [p, port] = key.split('#');
  return { frame: false, path: p ? p.split('/') : [], port: port ?? null };
}

/** Every element id a key mentions. @param {string} key */
export function keyIds(key) {
  const k = parseKey(key);
  return k.port ? [...k.path, k.port] : k.path;
}

/** @param {string[]} path */
export const partKey = (path) => path.join('/');
/** @param {string[]} path @param {string} port */
export const portKey = (path, port) => `${path.join('/')}#${port}`;
/** The key of the box a port sits on. @param {string} key */
export const ownerKey = (key) => { const k = parseKey(key); return k.path.length ? partKey(k.path) : FRAME; };
