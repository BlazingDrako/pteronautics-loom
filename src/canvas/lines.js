// Lines shaped by hand, the same on every kind of diagram: the bends a user dragged into a
// line (kept with the diagram's layout, by the line's edge id), joined square to the line's
// ends wherever its boxes are, and moving one segment of a line sideways.

/** @typedef {{ x: number, y: number }} Pt */

/** Drop repeated points, and points in the middle of a straight run. @param {Pt[]} pts */
export function simplify(pts) {
  /** @type {Pt[]} */
  const out = [];
  for (const p of pts) {
    const a = out[out.length - 1], b = out[out.length - 2];
    if (a && a.x === p.x && a.y === p.y) continue;
    if (a && b && ((b.x === a.x && a.x === p.x) || (b.y === a.y && a.y === p.y))) out[out.length - 1] = p; else out.push(p);
  }
  return out;
}

/**
 * The points a line is drawn through: its automatic route, or the route's ends joined square
 * to the bends placed by hand. Each end leaves its box the way the automatic route did.
 * @param {Pt[]} route @param {import('../model/model.js').Line | undefined} line
 */
export function shapeRoute(route, line) {
  if (!line?.pts?.length || route.length < 2) return route;
  const S = route[0], E = route[route.length - 1];
  const mid = line.pts.map(([x, y]) => ({ x, y }));
  const first = mid[0], last = mid[mid.length - 1];
  const vS = route[0].x === route[1].x, vE = route[route.length - 1].x === route[route.length - 2].x;
  /** @type {Pt[]} */
  const out = [S];
  if (first.x !== S.x && first.y !== S.y) out.push(vS ? { x: S.x, y: first.y } : { x: first.x, y: S.y });
  out.push(...mid);
  if (last.x !== E.x && last.y !== E.y) out.push(vE ? { x: E.x, y: last.y } : { x: last.x, y: E.y });
  out.push(E);
  return simplify(out);
}

/** The segment of a line nearest a point. @param {Pt[]} pts @param {Pt} p */
export function nearestSegment(pts, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Move one segment of a line: a square segment moves sideways (the line's ends stay on their
 * boxes, with a short stub where needed); a slanted one bends at the pointer.
 * @param {Pt[]} base @param {number} i @param {Pt} start @param {Pt} at @param {number} [step] snap step
 */
export function moveSegment(base, i, start, at, step = 5) {
  const a = base[i], b = base[i + 1], last = base.length - 2;
  const snap = (/** @type {number} */ v) => Math.round(v / step) * step;
  if (a.y === b.y || a.x === b.x) {
    const horiz = a.y === b.y;
    const v = snap(horiz ? a.y + (at.y - start.y) : a.x + (at.x - start.x));
    const put = (/** @type {Pt} */ p) => (horiz ? { x: p.x, y: v } : { x: v, y: p.y });
    const out = base.slice(0, i + 1).map((p) => ({ ...p }));
    if (i === 0) out.push(put(a)); else out[i] = put(a);
    out.push(put(b));
    if (i === last) out.push({ ...b });
    out.push(...base.slice(i + 2).map((p) => ({ ...p })));
    return simplify(out);
  }
  return [...base.slice(0, i + 1), { x: snap(at.x), y: snap(at.y) }, ...base.slice(i + 1)];
}

/**
 * A line's shape to keep: the bends between its ends, and its label's offset.
 * @param {import('../model/model.js').Line | undefined} cur @param {{ pts?: Pt[], label?: Pt }} next
 */
export function lineToKeep(cur, next) {
  /** @type {import('../model/model.js').Line} */
  const l = { ...(cur || {}) };
  if (next.pts) { const mid = next.pts.slice(1, -1); if (mid.length) l.pts = mid.map((p) => [Math.round(p.x), Math.round(p.y)]); else delete l.pts; }
  if (next.label) { l.lx = Math.round(next.label.x); l.ly = Math.round(next.label.y); }
  return l;
}
