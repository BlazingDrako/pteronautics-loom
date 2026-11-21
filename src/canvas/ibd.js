// Internal block diagrams: what is on one (nested parts, ports, connectors), an automatic
// nested layout, and connector routing from port to port. Pure functions of the model.
import { kindName } from '../model/metamodel.js';
import { FRAME, parseKey, partKey, portKey, ownerKey } from '../model/paths.js';
import { simplify } from './route.js';
import { FONTS, textWidth } from './measure.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {'t' | 'b' | 'l' | 'r'} Side */
/**
 * @typedef {{ key: string, path: string[], part: Element, type: Element | null, rect: Rect, depth: number, collapsed: boolean, hasInside: boolean }} PartBox
 * @typedef {{ key: string, owner: string, port: Element, type: Element | null, rect: Rect, side: Side, onFrame: boolean }} PortBox
 * @typedef {{ id: string, el: Element, a: string, b: string, item: string, flow: string, prefix: string[] }} Conn
 * @typedef {{ block: Element, frame: Rect, parts: PartBox[], ports: PortBox[], conns: Conn[], byKey: Map<string, PartBox | PortBox> }} Scene
 */

export const PORT = 14;
export const PART = { header: 40, pad: 28, gap: 72, minW: 170, leafH: 64 };
export const FRAME_PAD = { top: 56, side: 56 };

/** @param {Rect} r @param {Pt} p */
const inside = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Which side of a box a point on (or near) its border is on. @param {Rect} r @param {Pt} p @returns {Side} */
export function sideOf(r, p) {
  // judged by direction from the center, scaled to the box, so points outside the box (a port
  // being dragged) pick the side they are beyond, and points on the border pick their own side
  const dx = (p.x - (r.x + r.w / 2)) / Math.max(1, r.w / 2), dy = (p.y - (r.y + r.h / 2)) / Math.max(1, r.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'l' : 'r';
  return dy < 0 ? 't' : 'b';
}

/** The nearest point on a box's border. @param {Rect} r @param {Pt} p */
export function snapToBorder(r, p) {
  const s = sideOf(r, p);
  const cx = Math.min(r.x + r.w - 10, Math.max(r.x + 10, p.x)), cy = Math.min(r.y + r.h - 10, Math.max(r.y + 10, p.y));
  if (s === 'l') return { x: r.x, y: cy, side: s };
  if (s === 'r') return { x: r.x + r.w, y: cy, side: s };
  if (s === 't') return { x: cx, y: r.y, side: s };
  return { x: cx, y: r.y + r.h, side: s };
}

/**
 * Everything on an internal block diagram, resolved against the model. Entries whose parts
 * or ports no longer exist (or no longer fit together) are skipped, never drawn wrong.
 * @param {Model} m @param {Element} diagram
 * @returns {Scene | null}
 */
export function ibdScene(m, diagram) {
  const block = diagram.owner ? m.get(diagram.owner) : null;
  const L = diagram.layout?.nodes || {};
  if (!block || !L[FRAME]) return null;
  /** @type {Map<string, PartBox | PortBox>} */
  const byKey = new Map();
  /** @type {PartBox[]} */
  const parts = [];
  /** The block a path leads to (null when broken). @param {string[]} path */
  const resolve = (path) => {
    let owner = /** @type {Element | null} */ (block);
    /** @type {Element | null} */
    let last = null;
    for (const pid of path) {
      const p = m.get(pid);
      if (!owner || !p || p.kind !== 'part' || p.owner !== owner.id) return null;
      last = p;
      owner = p.props.type ? m.get(p.props.type) || null : null;
    }
    return { part: last, type: owner };
  };
  const keys = Object.keys(L).filter((k) => k !== FRAME && !k.includes('#')).sort((a, b) => a.split('/').length - b.split('/').length);
  /** @type {Set<string>} */
  const hidden = new Set();
  for (const key of keys) {
    const path = key.split('/');
    const parent = path.slice(0, -1).join('/');
    if (parent && (hidden.has(parent) || !byKey.has(parent) || L[parent]?.c)) { hidden.add(key); continue; }
    const r = resolve(path);
    if (!r || !r.part) continue;
    const box = { key, path, part: r.part, type: r.type, rect: L[key], depth: path.length, collapsed: !!L[key].c, hasInside: !!r.type && m.children(r.type.id).some((c) => c.kind === 'part') };
    parts.push(box); byKey.set(key, box);
  }
  /** @type {PortBox[]} */
  const ports = [];
  for (const key of Object.keys(L)) {
    if (!key.includes('#')) continue;
    const k = parseKey(key);
    const oKey = ownerKey(key);
    const ownerBox = oKey === FRAME ? null : /** @type {PartBox | undefined} */ (byKey.get(oKey));
    if (oKey !== FRAME && !ownerBox) continue;
    const ownerType = oKey === FRAME ? block : ownerBox?.type;
    const port = k.port ? m.get(k.port) : null;
    if (!port || port.kind !== 'port' || !ownerType || port.owner !== ownerType.id) continue;
    const ownerRect = oKey === FRAME ? L[FRAME] : /** @type {PartBox} */ (ownerBox).rect;
    const r = L[key];
    const pb = { key, owner: oKey, port, type: port.props.type ? m.get(port.props.type) || null : null, rect: r, side: sideOf(ownerRect, { x: r.x + r.w / 2, y: r.y + r.h / 2 }), onFrame: oKey === FRAME };
    ports.push(pb); byKey.set(key, pb);
  }
  // connectors: those owned by the diagram's block, and those owned by the types of shown parts
  /** @type {Conn[]} */
  const conns = [];
  const owners = /** @type {[Element, string[]][]} */ ([[block, []], ...parts.filter((p) => p.type && !p.collapsed).map((p) => /** @type {[Element, string[]]} */ ([p.type, p.path]))]);
  for (const [owner, prefix] of owners) {
    for (const c of m.children(owner.id)) {
      if (c.kind !== 'connector') continue;
      const endKey = (/** @type {import('../model/metamodel.js').End | null} */ end) => {
        if (!end) return null;
        const path = [...prefix, ...end.path];
        if (end.port) { const pk = path.length ? portKey(path, end.port) : `#${end.port}`; if (byKey.has(pk)) return pk; }
        const k = partKey(path);
        return path.length && byKey.has(k) ? k : null;
      };
      const a = endKey(c.props.end1), b = endKey(c.props.end2);
      if (a && b && a !== b) conns.push({ id: `${c.id}@${prefix.join('/')}`, el: c, a, b, item: c.props.item || '', flow: c.props.flow || 'None', prefix });
    }
  }
  return { block, frame: L[FRAME], parts, ports, conns, byKey };
}

/** "battery : Battery Pack" in the chosen wording. @param {Element} part @param {Element | null} type @param {Notation} n @param {boolean} showType */
export function partLabel(part, type, n, showType) {
  if (!showType || !type) return part.name;
  return n === 'guided' ? `${part.name} (${type.name})` : `${part.name} : ${type.name}`;
}

/** "pwrOut : DC Power 48 V", with ~ for conjugated. @param {Element} port @param {Element | null} type @param {boolean} showType */
export function portLabel(port, type, showType) {
  const t = showType && type ? ` : ${port.props.conjugated ? '~' : ''}${type.name}` : (port.props.conjugated ? ' ~' : '');
  return `${port.name}${t}`;
}

/**
 * A complete nested layout for a block's internal structure, as a layout patch: the frame,
 * every part (nested up to `depth` levels) and every port.
 * @param {Model} m @param {string} blockId @param {{ depth?: number, notation?: Notation, x?: number, y?: number }} [o]
 * @returns {Record<string, Rect>}
 */
export function packIbd(m, blockId, o = {}) {
  const maxDepth = o.depth ?? 3;
  /** @type {Record<string, Rect>} */
  const out = {};
  /** @typedef {{ key: string, path: string[], part: Element | null, type: Element | null, w: number, h: number, kids: Node[] }} Node */
  /** @param {Element | null} type @param {string[]} path @param {number} depth @returns {Node[]} */
  const kidsOf = (type, path, depth) => {
    if (!type || depth >= maxDepth) return [];
    return m.children(type.id).filter((c) => c.kind === 'part').map((p) => node(p, [...path, p.id], depth + 1));
  };
  /** Port label room needed on each side. @param {Element | null} type */
  const portRoom = (type) => {
    if (!type) return 0;
    const ps = m.children(type.id).filter((c) => c.kind === 'port');
    return ps.length ? Math.max(...ps.map((p) => textWidth(portLabel(p, p.props.type ? m.get(p.props.type) || null : null, true), FONTS.label))) : 0;
  };
  /** @param {Element} part @param {string[]} path @param {number} depth @returns {Node} */
  function node(part, path, depth) {
    const type = part.props.type ? m.get(part.props.type) || null : null;
    const kids = kidsOf(type, path, depth);
    const nPorts = type ? m.children(type.id).filter((c) => c.kind === 'port') : [];
    const sideCount = Math.max(nPorts.filter((p) => p.props.direction === 'in').length, nPorts.filter((p) => p.props.direction === 'out').length);
    const labelW = textWidth(partLabel(part, type, o.notation || 'sysml', true), FONTS.name) + 40;
    if (!kids.length) {
      const w = Math.ceil(Math.max(PART.minW, labelW) / 10) * 10;
      return { key: partKey(path), path, part, type, w, h: Math.max(PART.leafH, 36 + sideCount * 36), kids };
    }
    const g = grid(kids, type);
    return { key: partKey(path), path, part, type, w: Math.max(labelW, g.w + PART.pad * 2), h: Math.max(36 + sideCount * 36, g.h + PART.header + PART.pad), kids };
  }
  /**
   * Columns of children. When the block connects its parts, they flow left to right along
   * the connectors (senders before receivers); otherwise a compact grid.
   * @param {Node[]} kids @param {Element | null} block the block the children belong to
   */
  function grid(kids, block) {
    const ids = new Map(kids.map((k) => [/** @type {Element} */ (k.part).id, k]));
    /** @type {[string, string][]} */
    const links = [];
    if (block) for (const c of m.children(block.id)) {
      if (c.kind !== 'connector') continue;
      const a = c.props.end1?.path[0], b = c.props.end2?.path[0];
      if (a && b && a !== b && ids.has(a) && ids.has(b)) links.push([a, b]);
    }
    /** @type {Node[][]} */
    let cols = [];
    if (links.length) {
      // rank = longest chain of senders before it (cycles are cut by a depth limit)
      /** @type {Map<string, number>} */
      const rank = new Map();
      /** @param {string} id @param {number} depth @returns {number} */
      const rankOf = (id, depth) => {
        if (rank.has(id)) return /** @type {number} */ (rank.get(id));
        if (depth > kids.length) return 0;
        const ins = links.filter(([, b]) => b === id).map(([a]) => a);
        const r = ins.length ? Math.max(...ins.map((a) => rankOf(a, depth + 1))) + 1 : 0;
        rank.set(id, r);
        return r;
      };
      for (const k of kids) cols[rankOf(/** @type {Element} */ (k.part).id, 0)] ||= [];
      for (const k of kids) cols[/** @type {number} */ (rank.get(/** @type {Element} */ (k.part).id))].push(k);
      cols = cols.filter((c) => c && c.length);
    } else {
      const per = Math.min(3, Math.ceil(Math.sqrt(kids.length)));
      kids.forEach((k, i) => (cols[i % per] ||= []).push(k));
    }
    const gapX = PART.gap + Math.max(0, ...kids.map((k) => Math.min(170, portRoom(k.type))));
    const colW = cols.map((c) => Math.max(...c.map((k) => k.w)));
    const colH = cols.map((c) => c.reduce((a, k) => a + k.h, 0) + PART.gap * (c.length - 1));
    return { cols, colW, w: colW.reduce((a, x) => a + x, 0) + gapX * (cols.length - 1), h: Math.max(...colH), gapX, colH };
  }
  /** @param {Node[]} kids @param {Element | null} block @param {number} x0 @param {number} y0 */
  function place(kids, block, x0, y0) {
    const g = grid(kids, block);
    let x = x0;
    g.cols.forEach((col, ci) => {
      let y = y0 + (g.h - g.colH[ci]) / 2; // center short columns
      for (const k of col) {
        out[k.key] = { x: Math.round(x), y: Math.round(y), w: k.w, h: k.h };
        if (k.kids.length) place(k.kids, k.type, x + PART.pad, y + PART.header);
        portsFor(k.type, k.path, out[k.key]);
        y += k.h + PART.gap;
      }
      x += g.colW[ci] + g.gapX;
    });
  }
  /** @param {Element | null} type @param {string[]} path @param {Rect} r @param {boolean} [frame] */
  function portsFor(type, path, r, frame = false) {
    if (!type) return;
    const ps = m.children(type.id).filter((c) => c.kind === 'port');
    /** @type {Record<Side, Element[]>} */
    const sides = { l: [], r: [], b: [], t: [] };
    for (const p of ps) sides[p.props.direction === 'in' ? 'l' : p.props.direction === 'out' ? 'r' : 'b'].push(p);
    for (const [s, list] of /** @type {[Side, Element[]][]} */ (Object.entries(sides))) {
      list.forEach((p, i) => {
        const t = (i + 1) / (list.length + 1);
        const top = frame ? FRAME_PAD.top : 30;
        const cx = s === 'l' ? r.x : s === 'r' ? r.x + r.w : r.x + 24 + (r.w - 48) * t;
        const cy = s === 'b' ? r.y + r.h : s === 't' ? r.y : r.y + top + (r.h - top - 10) * t;
        out[path.length ? portKey(path, p.id) : `#${p.id}`] = { x: Math.round(cx - PORT / 2), y: Math.round(cy - PORT / 2), w: PORT, h: PORT };
      });
    }
  }
  const block = m.get(blockId);
  if (!block) return out;
  const top = kidsOf(block, [], 0);
  const g = top.length ? grid(top, block) : { w: 320, h: 160 };
  const x0 = o.x ?? 0, y0 = o.y ?? 0;
  const framePortRoom = Math.min(160, portRoom(block));
  out[FRAME] = { x: x0, y: y0, w: Math.max(420, g.w + FRAME_PAD.side * 2 + framePortRoom), h: Math.max(260, g.h + FRAME_PAD.top + FRAME_PAD.side) };
  if (top.length) place(top, block, x0 + FRAME_PAD.side + framePortRoom / 2, y0 + FRAME_PAD.top + 8);
  portsFor(block, [], out[FRAME], true);
  return out;
}

/**
 * Route every connector with right angles: out of each port square to its side, then the
 * fewest crossings of other parts, then the fewest bends, then the shortest.
 * @param {Scene} scene @param {Map<string, Rect>} [rectOverride] rects while dragging
 * @returns {Map<string, Pt[]>}
 */
export function routeConnectors(scene, rectOverride) {
  /** @param {string} key */
  const rectOf = (key) => rectOverride?.get(key) || /** @type {any} */ (key === FRAME ? { rect: scene.frame } : scene.byKey.get(key))?.rect;
  /** @type {Map<string, Pt[]>} */
  const out = new Map();
  /** Where a connector leaves an end, and which way. @param {string} key @param {string} otherKey */
  const endpoint = (key, otherKey) => {
    const r = rectOf(key);
    const b = scene.byKey.get(key);
    if (b && 'port' in b) {
      const owner = rectOf(b.owner);
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const s = sideOf(owner, c);
      // out of the box for part ports; inward for the block's own ports and for a part's port
      // that delegates to something inside that part
      const sign = b.onFrame || isInside(otherKey, b.owner) ? -1 : 1;
      const n = s === 'l' ? { x: -sign, y: 0 } : s === 'r' ? { x: sign, y: 0 } : s === 't' ? { x: 0, y: -sign } : { x: 0, y: sign };
      const edge = { x: c.x + n.x * PORT / 2, y: c.y + n.y * PORT / 2 };
      return { p: edge, n };
    }
    // a part with no port: leave from the side facing the other end
    const o = rectOf(otherKey);
    const oc = o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : { x: r.x, y: r.y };
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const dx = oc.x - c.x, dy = oc.y - c.y;
    if (Math.abs(dx) * r.h > Math.abs(dy) * r.w) return { p: { x: dx > 0 ? r.x + r.w : r.x, y: c.y }, n: { x: Math.sign(dx), y: 0 } };
    return { p: { x: c.x, y: dy > 0 ? r.y + r.h : r.y }, n: { x: 0, y: Math.sign(dy) || 1 } };
  };
  /** Keys of an end and every part around it (lines may run inside those). @param {string} key */
  const around = (key) => {
    const s = new Set();
    const path = parseKey(key).path;
    for (let i = 1; i <= path.length; i++) s.add(partKey(path.slice(0, i)));
    return s;
  };
  const boxes = scene.parts.map((p) => /** @type {[string, Rect]} */ ([p.key, rectOverride?.get(p.key) || p.rect]));
  for (const c of scene.conns) {
    const A = endpoint(c.a, c.b), B = endpoint(c.b, c.a);
    if (!A.p || !B.p) continue;
    const STUB = 18;
    const s = { x: A.p.x + A.n.x * STUB, y: A.p.y + A.n.y * STUB }, t = { x: B.p.x + B.n.x * STUB, y: B.p.y + B.n.y * STUB };
    const mx = Math.round((s.x + t.x) / 2), my = Math.round((s.y + t.y) / 2);
    /** @type {Pt[][]} */
    const middles = [
      [s, { x: s.x, y: t.y }, t], [s, { x: t.x, y: s.y }, t],
      [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t], [s, { x: s.x, y: my }, { x: t.x, y: my }, t],
    ];
    for (const off of [-48, 48, -96, 96]) {
      middles.push([s, { x: mx + off, y: s.y }, { x: mx + off, y: t.y }, t]);
      middles.push([s, { x: s.x, y: my + off }, { x: t.x, y: my + off }, t]);
    }
    const free = new Set([...around(c.a), ...around(c.b)]);
    // the box a part-end leaves from is not an obstacle for its own stub, but is for the rest
    let best = /** @type {Pt[]} */ ([]), bestScore = Infinity;
    for (const mid of middles) {
      const pts = simplify([A.p, ...mid, B.p]);
      let cross = 0;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        for (const [key, r] of boxes) if (!free.has(key) && hitsBox(p, q, r)) cross++;
        // never run back through an end's own part
        for (const [ek, other] of [[c.a, c.b], [c.b, c.a]]) { const pk = parseKey(ek).path; if (pk.length && !isInside(other, partKey(pk)) && hitsBox(p, q, rectOf(partKey(pk)), 2)) cross++; }
      }
      // backtracking into the stub direction counts as a crossing too
      const len = pts.slice(1).reduce((a, p, i) => a + Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y), 0);
      const score = cross * 100000 + (pts.length - 2) * 40 + len;
      if (score < bestScore) { bestScore = score; best = pts; }
    }
    out.set(c.id, best);
  }
  return out;
}

/** Is the element at layout key `key` nested inside the part at `partK`? @param {string} key @param {string} partK */
function isInside(key, partK) {
  if (partK === FRAME) return true;
  const path = parseKey(key).path.join('/');
  return path.startsWith(partK + '/');
}

/** @param {Pt} p @param {Pt} q @param {Rect} r @param {number} [pad] */
function hitsBox(p, q, r, pad = 4) {
  if (!r) return false;
  const x0 = r.x + pad, x1 = r.x + r.w - pad, y0 = r.y + pad, y1 = r.y + r.h - pad;
  if (p.y === q.y) { const lo = Math.min(p.x, q.x), hi = Math.max(p.x, q.x); return p.y > y0 && p.y < y1 && hi > x0 && lo < x1; }
  const lo = Math.min(p.y, q.y), hi = Math.max(p.y, q.y);
  return p.x > x0 && p.x < x1 && hi > y0 && lo < y1;
}

/** The deepest shown part containing a point (excluding some keys), or the frame. @param {Scene} scene @param {Pt} p @param {Set<string>} [exclude] */
export function containerAt(scene, p, exclude = new Set()) {
  let best = FRAME, depth = 0;
  for (const b of scene.parts) {
    if (exclude.has(b.key) || [...exclude].some((x) => b.key.startsWith(x + '/'))) continue;
    if (b.depth > depth && inside(b.rect, p) && !b.collapsed) { best = b.key; depth = b.depth; }
  }
  return best;
}

export { kindName };
