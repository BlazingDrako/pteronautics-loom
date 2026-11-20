// Automatic layout for structure diagrams: a layered ("Sugiyama-style") layout.
// Wholes sit above their parts and general blocks above their specializations; each layer is
// ordered to reduce crossings; unconnected blocks are placed in tidy rows underneath.

/** @typedef {{ id: string, w: number, h: number }} LNode */
/** @typedef {{ from: string, to: string, kind: 'composition' | 'generalization' }} LEdge */
/** @typedef {{ gapX?: number, gapY?: number, x?: number, y?: number, maxRowWidth?: number }} LOpts */

/**
 * @param {LNode[]} nodes
 * @param {LEdge[]} edges
 * @param {LOpts} [opts]
 * @returns {Map<string, { x: number, y: number }>}
 */
export function layered(nodes, edges, opts = {}) {
  const gapX = opts.gapX ?? 56, gapY = opts.gapY ?? 100, ox = opts.x ?? 40, oy = opts.y ?? 40;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // parent → child: whole above part; general above specific
  /** @type {Map<string, Set<string>>} */
  const kids = new Map(nodes.map((n) => [n.id, new Set()]));
  /** @type {Map<string, Set<string>>} */
  const parents = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of edges) {
    const [p, c] = e.kind === 'composition' ? [e.from, e.to] : [e.to, e.from];
    if (p === c || !byId.has(p) || !byId.has(c)) continue;
    kids.get(p)?.add(c); parents.get(c)?.add(p);
  }
  // break cycles: drop edges that point back up a DFS
  const state = new Map();
  /** @param {string} n */
  const dfs = (n) => {
    state.set(n, 1);
    for (const c of [...(kids.get(n) || [])]) {
      if (state.get(c) === 1) { kids.get(n)?.delete(c); parents.get(c)?.delete(n); }
      else if (!state.has(c)) dfs(c);
    }
    state.set(n, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) dfs(n.id);

  const connected = nodes.filter((n) => (kids.get(n.id)?.size || 0) + (parents.get(n.id)?.size || 0) > 0);
  const loose = nodes.filter((n) => !connected.includes(n));

  // ranks: longest path from a root
  /** @type {Map<string, number>} */
  const rank = new Map();
  /** @param {string} n @returns {number} */
  const rankOf = (n) => {
    if (rank.has(n)) return /** @type {number} */ (rank.get(n));
    const ps = [...(parents.get(n) || [])];
    const r = ps.length ? Math.max(...ps.map(rankOf)) + 1 : 0;
    rank.set(n, r);
    return r;
  };
  connected.forEach((n) => rankOf(n.id));
  /** @type {string[][]} */
  const layers = [];
  for (const n of connected) (layers[rank.get(n.id) || 0] ||= []).push(n.id);

  // order within layers: barycenter sweeps, down then up
  /** @type {Map<string, number>} */
  const pos = new Map();
  const index = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  index();
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const bary = new Map(layer.map((id) => {
        const ns = [...((down ? parents : kids).get(id) || [])].filter((x) => pos.has(x));
        return [id, ns.length ? ns.reduce((a, x) => a + /** @type {number} */ (pos.get(x)), 0) / ns.length : /** @type {number} */ (pos.get(id))];
      }));
      layer.sort((a, b) => /** @type {number} */ (bary.get(a)) - /** @type {number} */ (bary.get(b)));
      layer.forEach((id, i) => pos.set(id, i));
    }
  }

  /** @type {Map<string, { x: number, y: number }>} */
  const out = new Map();
  const width = (/** @type {string[]} */ l) => l.reduce((a, id) => a + /** @type {LNode} */ (byId.get(id)).w, 0) + gapX * Math.max(0, l.length - 1);
  const maxW = Math.max(0, ...layers.map(width));
  let y = oy;
  for (const layer of layers) {
    // start centered, then pull each block toward the middle of its parents without overlapping
    let x = ox + (maxW - width(layer)) / 2;
    /** @type {number[]} */
    const xs = [];
    for (const id of layer) { xs.push(x); x += /** @type {LNode} */ (byId.get(id)).w + gapX; }
    layer.forEach((id, i) => {
      const n = /** @type {LNode} */ (byId.get(id));
      const ps = [...(parents.get(id) || [])].filter((p) => out.has(p));
      if (!ps.length) return;
      const want = ps.reduce((a, p) => { const q = /** @type {{ x: number }} */ (out.get(p)); return a + q.x + /** @type {LNode} */ (byId.get(p)).w / 2; }, 0) / ps.length - n.w / 2;
      const minX = i ? xs[i - 1] + /** @type {LNode} */ (byId.get(layer[i - 1])).w + gapX : -Infinity;
      xs[i] = Math.max(minX, want);
    });
    for (let i = 1; i < layer.length; i++) { // resolve any overlaps left over
      const prev = /** @type {LNode} */ (byId.get(layer[i - 1]));
      xs[i] = Math.max(xs[i], xs[i - 1] + prev.w + gapX);
    }
    const h = Math.max(...layer.map((id) => /** @type {LNode} */ (byId.get(id)).h));
    layer.forEach((id, i) => out.set(id, { x: Math.round(xs[i]), y: Math.round(y) }));
    y += h + gapY;
  }

  // unconnected blocks: rows underneath
  const rowW = Math.max(opts.maxRowWidth ?? 960, maxW);
  let x = ox, rowH = 0;
  for (const n of loose) {
    if (x > ox && x + n.w > ox + rowW) { x = ox; y += rowH + gapX; rowH = 0; }
    out.set(n.id, { x: Math.round(x), y: Math.round(y) });
    x += n.w + gapX; rowH = Math.max(rowH, n.h);
  }
  return out;
}
