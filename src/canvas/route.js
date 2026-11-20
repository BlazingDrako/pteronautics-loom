// Orthogonal routing for diagram lines.
//
// Each line leaves and enters boxes on the facing sides. Lines sharing a side are spread out
// along it in the order of where their other ends are, so they do not cross near the box.
// Lines into the same general block (generalization) meet at one point, as SysML draws them.
// Each line tries a few elbow positions and keeps the one that crosses the fewest other boxes,
// then the shortest.

/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('./bdd.js').Edge} Edge */
/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {'t' | 'b' | 'l' | 'r'} Side */
/**
 * @typedef {{
 *   edge: Edge, points: Pt[],
 *   fromSide: Side, toSide: Side,
 *   crossings: number,
 * }} Route
 */

const MARGIN = 14; // keep ports this far from box corners
const STUB = 22;   // first/last segment length when an elbow is needed near an end

/** @param {Rect} r */
const cx = (r) => r.x + r.w / 2;
/** @param {Rect} r */
const cy = (r) => r.y + r.h / 2;

/** Which sides the line uses. @param {Rect} a @param {Rect} b @returns {[Side, Side]} */
export function chooseSides(a, b) {
  // the gap between the boxes along each axis (negative when they overlap on that axis)
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  // structure diagrams read top-down, so a clear vertical gap wins even when the horizontal gap is larger
  const vertical = gapY > 24 ? true : gapX > 0 ? false : gapY > 0 ? true : Math.abs(cy(b) - cy(a)) >= Math.abs(cx(b) - cx(a));
  if (vertical) return cy(b) >= cy(a) ? ['b', 't'] : ['t', 'b'];
  return cx(b) >= cx(a) ? ['r', 'l'] : ['l', 'r'];
}

/** A point on a side at fraction t. @param {Rect} r @param {Side} s @param {number} t */
function onSide(r, s, t) {
  const along = (len) => Math.min(len - MARGIN, Math.max(MARGIN, len * t));
  if (s === 't') return { x: r.x + along(r.w), y: r.y };
  if (s === 'b') return { x: r.x + along(r.w), y: r.y + r.h };
  if (s === 'l') return { x: r.x, y: r.y + along(r.h) };
  return { x: r.x + r.w, y: r.y + along(r.h) };
}

/** Does an axis-aligned segment pass through a box? @param {Pt} p @param {Pt} q @param {Rect} r */
function hits(p, q, r) {
  const pad = 3;
  const x0 = r.x + pad, x1 = r.x + r.w - pad, y0 = r.y + pad, y1 = r.y + r.h - pad;
  if (p.y === q.y) { const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x); return p.y > y0 && p.y < y1 && hi > x0 && lo < x1; }
  const lo = Math.min(p.y, q.y), hi = Math.max(p.y, q.y);
  return p.x > x0 && p.x < x1 && hi > y0 && lo < y1;
}

/** @param {Pt[]} pts */
const length = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);

/** Remove zero-length segments and points in the middle of straight runs. @param {Pt[]} pts */
export function simplify(pts) {
  /** @type {Pt[]} */
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(out.length - 2, 1); else break;
    }
  }
  return out;
}

/**
 * Route every line.
 * @param {Map<string, Rect>} rects box for each shown element
 * @param {Edge[]} edges
 * @returns {Route[]}
 */
export function routeAll(rects, edges) {
  /** @type {{ e: Edge, a: Rect, b: Rect, sa: Side, sb: Side, p?: Pt, q?: Pt }[]} */
  const items = [];
  for (const e of edges) {
    const a = rects.get(e.from), b = rects.get(e.to);
    if (!a || !b || e.from === e.to) continue;
    const [sa, sb] = chooseSides(a, b);
    items.push({ e, a, b, sa, sb });
  }

  // spread ports along each side, ordered by where the other end is
  /** @type {Map<string, { item: typeof items[number], end: 'from' | 'to' }[]>} */
  const bySide = new Map();
  for (const it of items) {
    for (const end of /** @type {const} */ (['from', 'to'])) {
      const key = `${end === 'from' ? it.e.from : it.e.to}|${end === 'from' ? it.sa : it.sb}`;
      (bySide.get(key) || bySide.set(key, []).get(key))?.push({ item: it, end });
    }
  }
  for (const [key, list] of bySide) {
    const side = /** @type {Side} */ (key.split('|')[1]);
    const horizontal = side === 't' || side === 'b';
    const other = (/** @type {typeof list[number]} */ x) => (x.end === 'from' ? x.item.b : x.item.a);
    // generalization lines into the same block share one point (the "tree" style)
    const shared = list.filter((x) => x.end === 'to' && x.item.e.kind === 'generalization');
    const own = list.filter((x) => !(x.end === 'to' && x.item.e.kind === 'generalization'));
    const slots = own.length + (shared.length ? 1 : 0);
    const sorted = [...own, ...(shared.length ? [shared[0]] : [])].sort((x, y) => (horizontal ? cx(other(x)) - cx(other(y)) : cy(other(x)) - cy(other(y))));
    sorted.forEach((x, i) => {
      const r = x.end === 'from' ? x.item.a : x.item.b;
      const pt = onSide(r, side, (i + 1) / (slots + 1));
      const group = x === shared[0] ? shared : [x];
      for (const g of group) { if (g.end === 'from') g.item.p = pt; else g.item.q = pt; }
    });
  }

  // a uniform grid of boxes, so each segment only checks the boxes near it
  const CELL = 240;
  /** @type {Map<string, [string, Rect][]>} */
  const grid = new Map();
  for (const [id, r] of rects) {
    for (let gx = Math.floor(r.x / CELL); gx <= Math.floor((r.x + r.w) / CELL); gx++) {
      for (let gy = Math.floor(r.y / CELL); gy <= Math.floor((r.y + r.h) / CELL); gy++) {
        const k = gx + ',' + gy;
        (grid.get(k) || grid.set(k, []).get(k))?.push([id, r]);
      }
    }
  }
  /** Boxes whose grid cells a segment passes through. @param {Pt} p @param {Pt} q */
  const near = (p, q) => {
    /** @type {Set<[string, Rect]>} */
    const out = new Set();
    for (let gx = Math.floor(Math.min(p.x, q.x) / CELL); gx <= Math.floor(Math.max(p.x, q.x) / CELL); gx++) {
      for (let gy = Math.floor(Math.min(p.y, q.y) / CELL); gy <= Math.floor(Math.max(p.y, q.y) / CELL); gy++) {
        for (const b of grid.get(gx + ',' + gy) || []) out.add(b);
      }
    }
    return out;
  };
  return items.map((it) => {
    const p = /** @type {Pt} */ (it.p), q = /** @type {Pt} */ (it.q);
    const vertical = it.sa === 't' || it.sa === 'b';
    /** @type {number[]} */
    const mids = [];
    if (vertical) {
      const dir = it.sa === 'b' ? 1 : -1;
      const near = q.y - dir * STUB, far = p.y + dir * STUB, mid = Math.round((p.y + q.y) / 2);
      if (it.e.kind === 'generalization') mids.push(near, mid, far); else mids.push(mid, far, near);
    } else {
      const dir = it.sa === 'r' ? 1 : -1;
      const near = q.x - dir * STUB, far = p.x + dir * STUB, mid = Math.round((p.x + q.x) / 2);
      if (it.e.kind === 'generalization') mids.push(near, mid, far); else mids.push(mid, far, near);
    }
    /** @type {Pt[][]} */
    const candidates = mids.map((m) => simplify(vertical ? [p, { x: p.x, y: m }, { x: q.x, y: m }, q] : [p, { x: m, y: p.y }, { x: m, y: q.y }, q]));
    // the other orientation as a last resort (an L shape)
    candidates.push(simplify(vertical ? [p, { x: p.x, y: q.y }, q] : [p, { x: q.x, y: p.y }, q]));
    let best = candidates[0], bestScore = Infinity, bestCross = 0;
    for (const c of candidates) {
      /** @type {Set<string>} */
      const crossed = new Set();
      for (let i = 1; i < c.length; i++) {
        for (const [id, r] of near(c[i - 1], c[i])) if (id !== it.e.from && id !== it.e.to && !crossed.has(id) && hits(c[i - 1], c[i], r)) crossed.add(id);
      }
      const cross = crossed.size;
      const score = cross * 100000 + length(c);
      if (score < bestScore) { bestScore = score; best = c; bestCross = cross; }
    }
    return { edge: it.e, points: best, fromSide: it.sa, toSide: it.sb, crossings: bestCross };
  });
}

/** SVG path data for a route, with small rounded corners. @param {Pt[]} pts */
export function pathData(pts, radius = 6) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(radius, Math.abs(b.x - a.x + b.y - a.y) / 2, Math.abs(c.x - b.x + c.y - b.y) / 2);
    const ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y), vx = Math.sign(c.x - b.x), vy = Math.sign(c.y - b.y);
    d += ` L${b.x - ux * r} ${b.y - uy * r} Q${b.x} ${b.y} ${b.x + vx * r} ${b.y + vy * r}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x} ${last.y}`;
}

/** Unit direction of the segment ending at the last point (or starting at the first). @param {Pt[]} pts @param {'start' | 'end'} at */
export function direction(pts, at) {
  const [a, b] = at === 'end' ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[1], pts[0]];
  return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
}
