// Align, distribute and match sizes: the arrange commands every diagram editor has. Pure
// geometry over the selected boxes' rectangles, so each diagram kind (block, internal block,
// behavior) can use it and add what moves along (a composite state's insides, nested parts).

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

/**
 * The arrange operations, with the names the menus and the command palette show.
 * `min` is how many boxes the operation needs to mean anything.
 */
export const ARRANGE = /** @type {const} */ ([
  { id: 'left', label: 'Align left edges', group: 'align', min: 2 },
  { id: 'hcenter', label: 'Align centers (vertical line)', group: 'align', min: 2 },
  { id: 'right', label: 'Align right edges', group: 'align', min: 2 },
  { id: 'top', label: 'Align top edges', group: 'align', min: 2 },
  { id: 'vcenter', label: 'Align middles (horizontal line)', group: 'align', min: 2 },
  { id: 'bottom', label: 'Align bottom edges', group: 'align', min: 2 },
  { id: 'hspace', label: 'Space evenly across', group: 'distribute', min: 3 },
  { id: 'vspace', label: 'Space evenly down', group: 'distribute', min: 3 },
  { id: 'width', label: 'Make the same width', group: 'size', min: 2 },
  { id: 'height', label: 'Make the same height', group: 'size', min: 2 },
  { id: 'size', label: 'Make the same size', group: 'size', min: 2 },
]);

/** @typedef {typeof ARRANGE[number]['id']} ArrangeOp */

/**
 * Where each box goes. Aligning lines boxes up on the selection's outermost edge (left, top…)
 * or on the reference box's center; sizes match the reference box (the one selected last,
 * as in most editors). Spacing keeps the two outermost boxes still and makes the gaps
 * between the others equal. Positions snap to `grid` when given.
 * Only boxes that change are returned.
 * @param {ArrangeOp} op @param {Map<string, Box>} boxes in selection order @param {{ ref?: string, grid?: number }} [o]
 * @returns {Record<string, Box>}
 */
export function arrange(op, boxes, o = {}) {
  const list = [...boxes.entries()];
  const def = ARRANGE.find((a) => a.id === op);
  if (!def || list.length < def.min) return {};
  const ref = (o.ref && boxes.get(o.ref)) || list[list.length - 1][1];
  const snap = (/** @type {number} */ v) => (o.grid ? Math.round(v / o.grid) * o.grid : Math.round(v));
  /** @type {Record<string, Box>} */
  const out = {};
  const put = (/** @type {string} */ id, /** @type {Box} */ b, /** @type {Partial<Box>} */ next) => {
    const r = { ...b, ...next };
    if (r.x !== b.x || r.y !== b.y || r.w !== b.w || r.h !== b.h) out[id] = r;
  };
  const xs = list.map(([, b]) => b);
  const minX = Math.min(...xs.map((b) => b.x)), maxX = Math.max(...xs.map((b) => b.x + b.w));
  const minY = Math.min(...xs.map((b) => b.y)), maxY = Math.max(...xs.map((b) => b.y + b.h));
  for (const [id, b] of list) {
    if (op === 'left') put(id, b, { x: minX });
    else if (op === 'right') put(id, b, { x: maxX - b.w });
    else if (op === 'top') put(id, b, { y: minY });
    else if (op === 'bottom') put(id, b, { y: maxY - b.h });
    // centers can land between grid lines (an odd width): keep them exact, not snapped
    else if (op === 'hcenter') put(id, b, { x: Math.round(ref.x + ref.w / 2 - b.w / 2) });
    else if (op === 'vcenter') put(id, b, { y: Math.round(ref.y + ref.h / 2 - b.h / 2) });
    else if (op === 'width') put(id, b, { w: ref.w });
    else if (op === 'height') put(id, b, { h: ref.h });
    else if (op === 'size') put(id, b, { w: ref.w, h: ref.h });
  }
  if (op === 'hspace' || op === 'vspace') {
    const horiz = op === 'hspace';
    const pos = (/** @type {Box} */ b) => (horiz ? b.x : b.y), len = (/** @type {Box} */ b) => (horiz ? b.w : b.h);
    const sorted = [...list].sort((a, b) => pos(a[1]) + len(a[1]) / 2 - (pos(b[1]) + len(b[1]) / 2));
    const first = sorted[0][1], last = sorted[sorted.length - 1][1];
    const span = pos(last) + len(last) - pos(first);
    const used = sorted.reduce((s, [, b]) => s + len(b), 0);
    const gap = (span - used) / (sorted.length - 1);
    let at = pos(first);
    for (const [id, b] of sorted) {
      const p = sorted[0][1] === b || sorted[sorted.length - 1][1] === b ? pos(b) : snap(at);
      put(id, b, horiz ? { x: p } : { y: p });
      at += len(b) + gap;
    }
  }
  return out;
}

/** The arrange items for a popup menu (disabled when too few boxes are selected). @param {number} n @param {(op: ArrangeOp) => void} run */
export function arrangeMenu(n, run) {
  /** @type {any[]} */
  const items = [];
  let group = '';
  for (const a of ARRANGE) {
    if (group && a.group !== group) items.push('sep');
    group = a.group;
    items.push({ label: a.label, hint: n < a.min ? `${a.min}+` : '', disabled: n < a.min, run: () => run(a.id) });
  }
  return items;
}
