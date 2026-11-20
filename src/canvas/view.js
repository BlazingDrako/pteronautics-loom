// The diagram canvas. A retained SVG scene: boxes are built once and only rebuilt when what
// they show changes; panning and zooming only move the camera. Only boxes in (or near) the
// window are in the DOM, and far-out zoom drops compartment text (level of detail), so large
// diagrams stay smooth.
//
// Mouse: drag a box to move it (snaps to other boxes' edges and centers, then the grid),
// drag its handles to resize, drag empty space to lasso, space or middle button to pan,
// wheel to scroll, pinch or ⌘/Ctrl+wheel to zoom, double-click to rename. Drop elements
// from the model browser to show them.
import { h, s, icon, toast, formatKeys } from '../ui/dom.js';
import { popupMenu } from '../ui/menu.js';
import { nodeContent, naturalSize, edgesFor, canShow, BOX } from './bdd.js';
import { routeAll, pathData } from './route.js';
import { layered } from './layout.js';
import { FONTS, ellipsize, resetMeasureCache } from './measure.js';
import { ELEMENTS, kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {{ x: number, y: number, k: number }} Camera */
/**
 * @typedef {{
 *   model: Model, diagramId: string,
 *   notation: () => Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 * }} ViewCtx
 */

const GRID = 10;
const LOD_ZOOM = 0.45;     // below this zoom, boxes show only their name
const CULL_MARGIN = 160;   // px around the window that is still drawn
const MIN_K = 0.08, MAX_K = 3;

/** Cameras survive switching tabs. @type {Map<string, Camera>} */
const cameras = new Map();

let fontsReady = false;
if (typeof document !== 'undefined' && document.fonts) document.fonts.ready.then(() => { fontsReady = true; resetMeasureCache(); });

/** @param {string} t */
const esc = (t) => t.replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** @param {ViewCtx} ctx */
export function createDiagramView(ctx) {
  const { model, diagramId } = ctx;
  const diagram = () => model.get(diagramId);
  /** @type {Camera} */
  const cam = cameras.get(diagramId) || { x: 0, y: 0, k: 1 };
  cameras.set(diagramId, cam);
  let firstFit = !cameras.has(diagramId + ':seen');
  cameras.set(diagramId + ':seen', cam);

  /** Selected boxes. @type {Set<string>} */
  let sel = new Set();
  /** Positions while dragging, before they are committed. @type {Map<string, Rect>} */
  const override = new Map();
  /** @type {{ x1: number, y1: number, x2: number, y2: number }[]} */
  let guides = [];
  /** @type {{ x: number, y: number, w: number, h: number } | null} */
  let lasso = null;
  let spaceDown = false;
  let lastRenderMs = 0;

  // ---------- DOM ----------
  const camG = s('g', { class: 'cam' });
  const edgesG = s('g', { class: 'edges' });
  const nodesG = s('g', { class: 'nodes' });
  const overlayG = s('g', { class: 'overlay' });
  camG.append(edgesG, nodesG, overlayG);
  const defs = s('defs');
  const svg = s('svg', { class: 'dsvg', 'aria-hidden': 'true' }, defs, camG);
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const empty = h('div', { class: 'dempty', hidden: true },
    h('b', {}, 'This diagram is empty'),
    h('p', {}, 'Drag blocks here from the model browser, or add one with the Block button.'));
  const stage = h('div', { class: 'dstage', tabindex: '0', role: 'application', 'aria-roledescription': 'diagram' }, svg, empty, live);
  const zoomLabel = h('span', { class: 'dzoom mono' });
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Diagram tools' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => addNew('partDef'), title: 'Add a new block to the model and this diagram' }, icon('plus'), 'Block'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => addNew('interfaceDef'), title: 'Add a new interface block' }, icon('plus'), 'Interface'),
    h('span', { class: 'dtool-sep' }),
    h('button', { class: 'btn sm', type: 'button', onclick: () => addRelated(), title: 'Show the types of the selected blocks\' parts and their generalizations' }, icon('related'), 'Add related'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => tidy(), title: `Tidy layout (${formatKeys('Shift+L')})` }, icon('layout'), 'Tidy layout'),
    h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu', onclick: (/** @type {Event} */ e) => viewMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('eye'), 'View'),
    h('span', { style: { flex: '1' } }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => zoomBy(1 / 1.25) }, icon('minus')),
    zoomLabel,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(1.25) }, icon('plus')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fit to window', title: 'Fit (0)', onclick: () => fit() }, icon('fit')));
  const el = h('div', { class: 'dview' }, toolbar, stage);

  // ---------- geometry ----------
  const layout = () => /** @type {Record<string, Rect>} */ (diagram()?.layout?.nodes || {});
  const shownIds = () => Object.keys(layout()).filter((id) => canShow(model.get(id)));
  // What each box shows is cached per element and recomputed only when a change touches it
  // (the element, something inside it, or a type its parts refer to).
  /** @type {Map<string, { content: import('./bdd.js').NodeContent, min: { w: number, h: number }, stamp: number }>} */
  const contentCache = new Map();
  let stamp = 0;
  /** Things that change every box at once. */
  const globalKey = () => `${ctx.notation()}|${fontsReady}|${JSON.stringify(diagram()?.props || {})}`;
  let lastGlobal = '';
  /** Geometry (box sizes, lines) needs recomputing. */
  let geomDirty = true;
  /** @param {string} id */
  function content(id) {
    const hit = contentCache.get(id);
    if (hit) return hit;
    const c = nodeContent(model, /** @type {any} */ (model.get(id)), /** @type {any} */ (diagram()), ctx.notation());
    const v = { content: c, min: naturalSize(c), stamp: ++stamp };
    contentCache.set(id, v);
    return v;
  }
  const unsubModel = model.subscribe((e) => {
    geomDirty = true;
    if (e.ids.size > 300) { contentCache.clear(); return; }
    for (const id of e.ids) {
      const el = model.get(id);
      if (!el) { contentCache.clear(); return; } // something was deleted: start over (rare)
      contentCache.delete(id);
      if (el.owner) contentCache.delete(el.owner);
      if (el.kind === 'partDef' || el.kind === 'interfaceDef') for (const r of model.referrers(id)) if (r.owner) contentCache.delete(r.owner);
    }
  });
  /** The box as drawn: stored size, never shorter than the content. @param {string} id @returns {Rect} */
  function rectOf(id) {
    const r = override.get(id) || layout()[id];
    return { x: r.x, y: r.y, w: r.w, h: Math.max(r.h, content(id).min.h) };
  }
  const size = () => ({ w: stage.clientWidth || 800, h: stage.clientHeight || 600 });
  /** @param {number} sx @param {number} sy */
  const toWorld = (sx, sy) => ({ x: cam.x + sx / cam.k, y: cam.y + sy / cam.k });
  /** @param {PointerEvent | MouseEvent | DragEvent} e */
  const eventWorld = (e) => { const b = stage.getBoundingClientRect(); return toWorld(e.clientX - b.left, e.clientY - b.top); };
  function viewRect() {
    const { w, hh } = { w: size().w, hh: size().h };
    const m = CULL_MARGIN / cam.k;
    return { x: cam.x - m, y: cam.y - m, w: w / cam.k + 2 * m, h: hh / cam.k + 2 * m };
  }
  /** @param {Rect} a @param {Rect} b */
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- rendering ----------
  /** @type {Map<string, { g: SVGElement, key: string }>} */
  const built = new Map();
  /** Routed lines, reused until the geometry changes (panning and zooming never re-route). */
  let routeCache = { key: '', routes: /** @type {import('./route.js').Route[]} */ ([]) };
  /** Every shown box as drawn, from the last geometry pass. @type {Map<string, Rect>} */
  let allRects = new Map();
  let lastEdgeSig = '';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fullTimer;
  /** Re-route everything once things settle, so ports shared with unmoved lines are spread again. */
  function scheduleFullRoute() {
    clearTimeout(fullTimer);
    fullTimer = setTimeout(() => {
      const ids = shownIds();
      routeCache = { key: String(++stamp), routes: routeAll(new Map(ids.map((id) => [id, rectOf(id)])), edgesFor(model, new Set(ids))) };
      invalidate();
    }, 250);
  }
  /** The last lines drawn, so an unchanged set is not redrawn. */
  let edgesKey = '';
  let raf = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  /** Build one box. @param {string} id @param {Rect} r @param {boolean} lod */
  function buildNode(id, r, lod) {
    const { content: c } = content(id);
    const selected = sel.has(id);
    const g = s('g', { class: 'node' + (selected ? ' sel' : ''), 'data-id': id, transform: `translate(${r.x} ${r.y})` });
    g.append(s('rect', { class: 'box', width: r.w, height: r.h, rx: 10 }));
    if (c.layerColor) g.append(s('rect', { class: 'strip', x: 12, y: 0, width: Math.max(0, r.w - 24), height: 3, rx: 1.5, style: `fill:${c.layerColor}` }));
    const inner = r.w - BOX.padX * 2;
    if (lod) {
      g.append(s('text', { class: 'n-name lod', x: r.w / 2, y: Math.min(r.h / 2 + 6, 40) }, ellipsize(c.name, inner, FONTS.name)));
    } else {
      g.append(s('text', { class: 'n-stereo', x: r.w / 2, y: 19 }, ellipsize(c.stereo, inner, FONTS.stereo)));
      g.append(s('text', { class: 'n-name', x: r.w / 2, y: 37 }, ellipsize(c.name, inner, FONTS.name)));
      let y = BOX.header;
      for (const comp of c.compartments) {
        if (y + BOX.titleH > r.h) break;
        g.append(s('line', { class: 'n-sep', x1: 0, x2: r.w, y1: y, y2: y }));
        g.append(s('text', { class: 'n-title', x: BOX.padX, y: y + 14 }, ellipsize(comp.title.toUpperCase(), inner, FONTS.title)));
        let ry = y + BOX.titleH;
        for (const row of comp.rows) {
          if (ry + BOX.rowH > r.h + 2) break;
          g.append(s('text', { class: 'n-row', x: BOX.padX, y: ry + 12 }, ellipsize(row, inner, FONTS.row)));
          ry += BOX.rowH;
        }
        y += BOX.titleH + comp.rows.length * BOX.rowH + BOX.compPad;
      }
    }
    if (selected && sel.size === 1) {
      for (const [hx, hy, kind] of /** @type {[number, number, string][]} */ ([[r.w, r.h / 2, 'e'], [r.w / 2, r.h, 's'], [r.w, r.h, 'se']])) {
        g.append(s('rect', { class: `handle h-${kind}`, 'data-handle': kind, x: hx - 4.5, y: hy - 4.5, width: 9, height: 9, rx: 2 }));
      }
    }
    return g;
  }

  function render() {
    const t0 = performance.now();
    const d = diagram();
    if (!d) return;
    const ids = shownIds();
    empty.hidden = ids.length > 0;
    if (firstFit && ids.length && stage.clientWidth) { firstFit = false; fitNow(); }
    camG.setAttribute('transform', `matrix(${cam.k} 0 0 ${cam.k} ${-cam.x * cam.k} ${-cam.y * cam.k})`);
    const grid = cam.k * GRID * 2 < 8 ? GRID * 10 : GRID * 2;
    stage.style.backgroundSize = `${grid * cam.k}px ${grid * cam.k}px`;
    stage.style.backgroundPosition = `${-cam.x * cam.k}px ${-cam.y * cam.k}px`;
    zoomLabel.textContent = `${Math.round(cam.k * 100)}%`;
    stage.setAttribute('aria-label', `${kindName(d.kind, ctx.notation())}: ${d.name}. ${ids.length} blocks. Arrow keys move the selection, Delete removes it from the diagram.`);

    const gk = globalKey();
    if (gk !== lastGlobal) { lastGlobal = gk; contentCache.clear(); geomDirty = true; }
    const vr = viewRect();
    const lod = cam.k < LOD_ZOOM;

    // geometry: every box and every line, recomputed only after a change (never for pan or zoom)
    if (geomDirty || override.size) {
      const rects = new Map(ids.map((id) => [id, rectOf(id)]));
      if (geomDirty && !override.size) {
        const edges = edgesFor(model, new Set(ids));
        const esig = edges.map((e) => `${e.id}>${e.from}>${e.to}>${e.label || ''}`).join('|');
        /** @type {string[]} */
        const changed = [];
        for (const [id, r] of rects) { const o = allRects.get(id); if (!o || o.x !== r.x || o.y !== r.y || o.w !== r.w || o.h !== r.h) changed.push(id); }
        const removed = [...allRects.keys()].some((id) => !rects.has(id));
        if (esig === lastEdgeSig && !changed.length && !removed) {
          // nothing that lines depend on changed (a rename, a property edit): keep every route
        } else if (esig === lastEdgeSig && !removed && changed.length <= 50 && routeCache.routes.length) {
          // a few boxes moved: re-route their lines now, everything else a moment later
          const moving = new Set(changed);
          const fresh = new Map(routeAll(rects, edges.filter((e) => moving.has(e.from) || moving.has(e.to))).map((rt) => [rt.edge.id, rt]));
          routeCache = { key: String(++stamp), routes: routeCache.routes.map((rt) => fresh.get(rt.edge.id) || rt) };
          scheduleFullRoute();
        } else {
          routeCache = { key: String(++stamp), routes: routeAll(rects, edges) };
        }
        lastEdgeSig = esig;
        allRects = rects;
      } else if (geomDirty || !routeCache.routes.length) {
        routeCache = { key: String(++stamp), routes: routeAll(rects, edgesFor(model, new Set(ids))) };
        allRects = rects;
      } else {
        // while dragging, re-route only the lines touching what moves
        const moving = new Set(override.keys());
        const touched = routeCache.routes.filter((rt) => moving.has(rt.edge.from) || moving.has(rt.edge.to)).map((rt) => rt.edge);
        const fresh = new Map(routeAll(rects, touched).map((rt) => [rt.edge.id, rt]));
        routeCache = { key: String(++stamp), routes: routeCache.routes.map((rt) => fresh.get(rt.edge.id) || rt) };
        allRects = rects;
      }
      geomDirty = false;
    }
    const rects = allRects;
    const visible = new Set();
    for (const [id, r] of rects) if (overlaps(r, vr)) visible.add(id);

    // boxes: reuse what has not changed
    for (const [id, b] of built) if (!visible.has(id)) { b.g.remove(); built.delete(id); }
    for (const id of visible) {
      const r = /** @type {Rect} */ (rects.get(id));
      const key = `${content(id).stamp}|${r.x},${r.y},${r.w},${r.h}|${sel.has(id) ? (sel.size === 1 ? 2 : 1) : 0}|${lod}`;
      const b = built.get(id);
      if (b && b.key === key) continue;
      const g = buildNode(id, r, lod);
      if (b) b.g.replaceWith(g); else nodesG.append(g);
      built.set(id, { g, key });
    }

    // lines: drawn when either end is in view
    const geomKey = routeCache.key;
    const routes = routeCache.routes.filter((rt) => visible.has(rt.edge.from) || visible.has(rt.edge.to));
    const selectedEl = ctx.selected();
    const showRoles = d.props.showRoles !== false && !lod;
    const eKey = `${geomKey}|${selectedEl}|${lod}|${routes.length}|${routes.length ? routes[0].edge.id + routes[routes.length - 1].edge.id : ''}`;
    const parts = [];
    if (eKey !== edgesKey) for (const rt of routes) {
      const pts = rt.points, dPath = pathData(pts);
      const on = rt.edge.element === selectedEl;
      parts.push(`<path class="e-hit" data-el="${rt.edge.element}" d="${dPath}"/>`);
      parts.push(`<path class="edge ${rt.edge.kind}${on ? ' sel' : ''}" d="${dPath}"/>`);
      if (rt.edge.kind === 'composition') {
        const p = pts[0], u = { x: Math.sign(pts[1].x - p.x), y: Math.sign(pts[1].y - p.y) }, n = { x: -u.y, y: u.x };
        const q = (/** @type {number} */ a, /** @type {number} */ b) => `${p.x + u.x * a + n.x * b},${p.y + u.y * a + n.y * b}`;
        parts.push(`<polygon class="diamond${on ? ' sel' : ''}" points="${q(0, 0)} ${q(8, 5)} ${q(16, 0)} ${q(8, -5)}"/>`);
        if (showRoles && rt.edge.label) {
          const end = pts[pts.length - 1], side = rt.toSide;
          const [lx, ly, anchor] = side === 't' ? [end.x + 6, end.y - 6, 'start'] : side === 'b' ? [end.x + 6, end.y + 15, 'start'] : side === 'l' ? [end.x - 6, end.y - 6, 'end'] : [end.x + 6, end.y - 6, 'start'];
          parts.push(`<text class="e-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(ellipsize(rt.edge.label, 160, FONTS.label))}</text>`);
        }
      } else {
        const q = pts[pts.length - 1], a = pts[pts.length - 2];
        const u = { x: Math.sign(q.x - a.x), y: Math.sign(q.y - a.y) }, n = { x: -u.y, y: u.x };
        parts.push(`<polygon class="triangle${on ? ' sel' : ''}" points="${q.x},${q.y} ${q.x - u.x * 13 + n.x * 7.5},${q.y - u.y * 13 + n.y * 7.5} ${q.x - u.x * 13 - n.x * 7.5},${q.y - u.y * 13 - n.y * 7.5}"/>`);
      }
    }
    if (eKey !== edgesKey) { edgesG.innerHTML = parts.join(''); edgesKey = eKey; }

    // guides and lasso
    const ov = [];
    for (const gl of guides) ov.push(`<line class="guide" x1="${gl.x1}" y1="${gl.y1}" x2="${gl.x2}" y2="${gl.y2}"/>`);
    if (lasso) ov.push(`<rect class="lasso" x="${lasso.x}" y="${lasso.y}" width="${lasso.w}" height="${lasso.h}"/>`);
    overlayG.innerHTML = ov.join('');
    lastRenderMs = performance.now() - t0;
  }

  // ---------- camera ----------
  /** @param {number} k @param {{ x: number, y: number }} [at] screen point that stays still */
  function zoomTo(k, at) {
    const { w, h: hh } = size();
    const p = at || { x: w / 2, y: hh / 2 };
    const before = toWorld(p.x, p.y);
    cam.k = Math.min(MAX_K, Math.max(MIN_K, k));
    cam.x = before.x - p.x / cam.k; cam.y = before.y - p.y / cam.k;
    invalidate();
  }
  /** @param {number} f */
  const zoomBy = (f) => zoomTo(cam.k * f);
  function fitNow() {
    const ids = shownIds();
    const { w, h: hh } = size();
    if (!ids.length) { cam.x = -40; cam.y = -40; cam.k = 1; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) { const r = rectOf(id); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const pad = 48;
    cam.k = Math.min(1.25, Math.max(MIN_K, Math.min((w - pad * 2) / (x1 - x0), (hh - pad * 2) / (y1 - y0))));
    cam.x = (x0 + x1) / 2 - w / 2 / cam.k; cam.y = (y0 + y1) / 2 - hh / 2 / cam.k;
  }
  function fit() { fitNow(); invalidate(); }

  // ---------- selection ----------
  /** @param {Set<string>} next @param {boolean} [tell] */
  function setSel(next, tell = true) {
    sel = next;
    invalidate();
    if (tell) {
      const primary = sel.size ? [...sel][sel.size - 1] : null;
      ctx.select(primary);
      if (primary) live.textContent = sel.size > 1 ? `${sel.size} blocks selected` : `Selected ${model.get(primary)?.name}`;
    }
  }
  /** Keep the canvas selection in step with the browser and inspector. @param {string | null} id */
  function syncSelection(id) {
    if (id && layout()[id]) { if (!(sel.size === 1 && sel.has(id)) && !sel.has(id)) { sel = new Set([id]); revealIfHidden(id); } }
    else if (sel.size && (!id || !sel.has(id))) sel = new Set();
    invalidate();
  }
  /** Pan so a box is in view. @param {string} id */
  function revealIfHidden(id) {
    const r = rectOf(id), { w, h: hh } = size();
    const sx = (r.x - cam.x) * cam.k, sy = (r.y - cam.y) * cam.k;
    if (sx < 0 || sy < 0 || sx + r.w * cam.k > w || sy + r.h * cam.k > hh) { cam.x = r.x + r.w / 2 - w / 2 / cam.k; cam.y = r.y + r.h / 2 - hh / 2 / cam.k; }
  }

  // ---------- editing ----------
  /** Commit positions. @param {string} label @param {Record<string, Rect | null>} patch */
  const commit = (label, patch) => ctx.edit(label, (tx) => tx.place(diagramId, patch));

  /** A free spot near a point, so new boxes never land on top of others. @param {number} x @param {number} y @param {number} w @param {number} hh */
  function freeSpot(x, y, w, hh) {
    const others = shownIds().map(rectOf);
    const base = { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID, w, h: hh };
    const free = (/** @type {Rect} */ r) => !others.some((o) => overlaps({ x: r.x - 20, y: r.y - 20, w: r.w + 40, h: r.h + 40 }, o));
    if (free(base)) return base;
    // search outward in rings, nearest spots first
    for (let ring = 1; ring <= 40; ring++) {
      const step = ring * 40;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const r = { ...base, x: base.x + dx * step, y: base.y + dy * step };
        if (free(r)) return r;
      }
    }
    return base;
  }

  /** @param {'partDef' | 'interfaceDef'} kind */
  function addNew(kind) {
    const d = diagram();
    if (!d) return;
    const owner = d.owner && model.canCreate(d.owner, kind) ? d.owner : model.layers().find((l) => l.layer === 'l')?.id;
    if (!owner) return;
    const { w, h: hh } = size();
    const c = toWorld(w / 2, hh / 2);
    let id = '';
    if (!ctx.edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => {
      id = tx.create(kind, { owner });
      const r = freeSpot(c.x - 90, c.y - 30, 180, 60);
      tx.place(diagramId, { [id]: r });
    })) return;
    setSel(new Set([id]));
    render();
    revealIfHidden(id); render();
    startRename(id);
  }

  /** Show related blocks: types of parts, and generalizations either way. */
  function addRelated() {
    const from = sel.size ? [...sel] : shownIds();
    if (!from.length) { toast('Select a block first, or add one'); return; }
    /** @type {Record<string, Rect>} */
    const patch = {};
    const taken = new Set(shownIds());
    for (const id of from) {
      const r = rectOf(id);
      /** @type {string[]} */
      const below = [], above = [];
      for (const k of model.children(id)) if (k.kind === 'part' && k.props.type && !taken.has(k.props.type) && canShow(model.get(k.props.type))) below.push(k.props.type);
      for (const rel of model.relsFrom(id)) if (rel.kind === 'generalize' && rel.target && !taken.has(rel.target)) above.push(rel.target);
      for (const rel of model.relsTo(id)) if (rel.kind === 'generalize' && rel.source && !taken.has(rel.source)) below.push(rel.source);
      const place = (/** @type {string[]} */ list, /** @type {number} */ y) => {
        let x = r.x + r.w / 2 - (list.length * 220) / 2;
        for (const t of list) {
          if (taken.has(t)) continue;
          const nat = naturalSize(nodeContent(model, /** @type {any} */ (model.get(t)), /** @type {any} */ (diagram()), ctx.notation()));
          const spot = freeSpot(x, y, Math.max(180, nat.w), nat.h);
          patch[t] = spot; taken.add(t);
          x = spot.x + spot.w + 40;
        }
      };
      place(below, r.y + r.h + 90); place(above, r.y - 180);
    }
    if (!Object.keys(patch).length) { toast('Everything related is already shown'); return; }
    commit('Add related', patch);
    toast(`Added ${Object.keys(patch).length} related block${Object.keys(patch).length > 1 ? 's' : ''}`);
  }

  /** Auto-layout everything. */
  function tidy() {
    const ids = shownIds();
    if (!ids.length) return;
    // boxes grow to show their full text (never shrink: a user may have made one wider on purpose)
    const nodes = ids.map((id) => { const r = rectOf(id); return { id, w: Math.max(r.w, Math.ceil(content(id).min.w / GRID) * GRID), h: r.h }; });
    const edges = edgesFor(model, new Set(ids)).map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
    const pos = layered(nodes, edges);
    /** @type {Record<string, Rect>} */
    const patch = {};
    for (const n of nodes) { const p = pos.get(n.id); if (p) patch[n.id] = { x: p.x, y: p.y, w: n.w, h: layout()[n.id].h }; }
    commit('Tidy layout', patch);
    fit();
  }

  /** @param {HTMLElement} anchor */
  function viewMenu(anchor) {
    const d = diagram();
    if (!d) return;
    const flags = /** @type {[string, string][]} */ ([['showParts', 'Parts compartment'], ['showValues', 'Values compartment'], ['showPorts', 'Ports compartment'], ['showRoles', 'Role names on lines'], ['snap', 'Snap to grid and guides']]);
    popupMenu(anchor, flags.map(([k, label]) => ({
      label, hint: d.props[k] !== false ? 'on' : 'off',
      run: () => ctx.edit(`${d.props[k] !== false ? 'Hide' : 'Show'} ${label.toLowerCase()}`, (tx) => tx.setProps(diagramId, { [k]: d.props[k] === false })),
    })), { title: 'This diagram shows' });
  }

  function removeFromView() {
    if (!sel.size) return;
    const n = sel.size;
    /** @type {Record<string, null>} */
    const patch = {};
    for (const id of sel) patch[id] = null;
    if (commit(n > 1 ? `Remove ${n} blocks from the diagram` : 'Remove from the diagram', patch)) {
      setSel(new Set());
      toast(`Removed from the diagram (still in the model). ${formatKeys('Mod+Z')} to undo.`);
    }
  }
  function deleteFromModel() {
    if (!sel.size) return;
    const ids = [...sel];
    const names = ids.map((id) => model.get(id)?.name).join(', ');
    if (ctx.edit(ids.length > 1 ? `Delete ${ids.length} blocks` : `Delete ${names}`, (tx) => ids.forEach((id) => { if (model.get(id)) tx.remove(id); }))) {
      setSel(new Set());
      toast(`Deleted ${names} from the model. ${formatKeys('Mod+Z')} to undo.`);
    }
  }

  // ---------- rename in place ----------
  /** @param {string} id */
  function startRename(id) {
    const e = model.get(id);
    if (!e) return;
    const r = rectOf(id);
    const input = h('input', { class: 'drename', type: 'text', value: e.name, 'aria-label': 'Name', maxlength: 500 });
    Object.assign(input.style, { left: `${(r.x - cam.x) * cam.k + 8}px`, top: `${(r.y + 22 - cam.y) * cam.k}px`, width: `${Math.max(120, (r.w - 16) * cam.k)}px` });
    let done = false;
    const finish = (/** @type {boolean} */ ok) => {
      if (done) return; done = true; input.remove();
      const v = input.value.trim();
      if (ok && v && v !== e.name) ctx.edit('Rename', (tx) => tx.rename(id, v));
      stage.focus();
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    stage.append(input);
    input.focus(); input.select();
  }

  // ---------- pointer ----------
  /**
   * @type {null | { mode: 'move', start: { x: number, y: number }, orig: Map<string, Rect>, moved: boolean }
   *  | { mode: 'resize', id: string, handle: string, start: { x: number, y: number }, orig: Rect }
   *  | { mode: 'lasso', start: { x: number, y: number }, additive: boolean, base: Set<string> }
   *  | { mode: 'pan', sx: number, sy: number, cx: number, cy: number }
   *  | { mode: 'click-edge', el: string }}
   */
  let drag = null;

  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    stage.focus({ preventScroll: true });
    const t = /** @type {Element} */ (ev.target);
    const w = eventWorld(ev);
    if (ev.button === 1 || (ev.button === 0 && spaceDown)) {
      drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y };
      stage.classList.add('panning');
    } else if (ev.button !== 0) return;
    else if (t.closest('[data-handle]')) {
      const id = /** @type {string} */ (/** @type {HTMLElement} */ (t.closest('.node')).dataset.id);
      drag = { mode: 'resize', id, handle: /** @type {string} */ (/** @type {HTMLElement} */ (t.closest('[data-handle]')).dataset.handle), start: w, orig: rectOf(id) };
    } else if (t.closest('.node')) {
      const id = /** @type {string} */ (/** @type {HTMLElement} */ (t.closest('.node')).dataset.id);
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
        const next = new Set(sel); if (next.has(id)) next.delete(id); else next.add(id);
        setSel(next); drag = null; return;
      }
      if (!sel.has(id)) setSel(new Set([id]));
      drag = { mode: 'move', start: w, orig: new Map([...sel].map((x) => [x, rectOf(x)])), moved: false };
    } else if (t.closest('.e-hit')) {
      drag = { mode: 'click-edge', el: /** @type {string} */ (/** @type {SVGElement} */ (t.closest('.e-hit')).dataset.el) };
    } else {
      drag = { mode: 'lasso', start: w, additive: ev.shiftKey, base: new Set(ev.shiftKey ? sel : []) };
    }
    stage.setPointerCapture(ev.pointerId);
  });

  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const w = eventWorld(ev);
    const d = diagram();
    const snap = d?.props.snap !== false && !ev.altKey;
    if (drag.mode === 'pan') {
      cam.x = drag.cx - (ev.clientX - drag.sx) / cam.k; cam.y = drag.cy - (ev.clientY - drag.sy) / cam.k; invalidate();
    } else if (drag.mode === 'move') {
      let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * cam.k < 3) return;
      drag.moved = true;
      guides = [];
      if (snap) [dx, dy] = snapMove(drag.orig, dx, dy);
      override.clear();
      for (const [id, r] of drag.orig) override.set(id, { ...r, x: r.x + dx, y: r.y + dy });
      invalidate();
    } else if (drag.mode === 'resize') {
      const o = drag.orig;
      let nw = o.w, nh = o.h;
      if (drag.handle.includes('e')) nw = Math.max(BOX.minW - 40, o.w + w.x - drag.start.x);
      if (drag.handle.includes('s')) nh = Math.max(content(drag.id).min.h, o.h + w.y - drag.start.y);
      if (snap) { nw = Math.round((o.x + nw) / GRID) * GRID - o.x; nh = Math.round((o.y + nh) / GRID) * GRID - o.y; }
      override.set(drag.id, { x: o.x, y: o.y, w: Math.max(100, nw), h: Math.max(content(drag.id).min.h, nh) });
      invalidate();
    } else if (drag.mode === 'lasso') {
      lasso = { x: Math.min(drag.start.x, w.x), y: Math.min(drag.start.y, w.y), w: Math.abs(w.x - drag.start.x), h: Math.abs(w.y - drag.start.y) };
      const hit = new Set(drag.base);
      for (const id of shownIds()) if (overlaps(rectOf(id), lasso)) hit.add(id);
      sel = hit;
      invalidate();
    }
  });

  const endDrag = (/** @type {PointerEvent} */ ev) => {
    if (!drag) return;
    geomDirty = true;
    const d = drag; drag = null;
    stage.classList.remove('panning');
    if (d.mode === 'move') {
      if (d.moved) {
        /** @type {Record<string, Rect>} */
        const patch = {};
        for (const [id, r] of override) patch[id] = { ...r, h: layout()[id]?.h ?? r.h };
        override.clear(); guides = [];
        commit(d.orig.size > 1 ? `Move ${d.orig.size} blocks` : 'Move', patch);
      } else if (!ev.shiftKey && sel.size > 1) {
        const t = /** @type {Element} */ (ev.target).closest?.('.node');
        if (t) setSel(new Set([/** @type {string} */ (/** @type {HTMLElement} */ (t).dataset.id)]));
      }
    } else if (d.mode === 'resize') {
      const r = override.get(d.id);
      override.clear();
      if (r) commit('Resize', { [d.id]: r });
    } else if (d.mode === 'lasso') {
      const tiny = !lasso || (lasso.w * cam.k < 3 && lasso.h * cam.k < 3);
      lasso = null;
      if (tiny && !d.additive) setSel(new Set()); else setSel(sel);
    } else if (d.mode === 'click-edge') {
      setSel(new Set(), false);
      ctx.select(d.el);
    }
    invalidate();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /**
   * Snap a move: line up the moving group's edges or center with another box's (showing a
   * guide), otherwise to the grid.
   * @param {Map<string, Rect>} orig @param {number} dx @param {number} dy @returns {[number, number]}
   */
  function snapMove(orig, dx, dy) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of orig.values()) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    const bx = [x0 + dx, (x0 + x1) / 2 + dx, x1 + dx], by = [y0 + dy, (y0 + y1) / 2 + dy, y1 + dy];
    const thr = 6 / cam.k;
    const vr = viewRect();
    let bestX = { d: Infinity, v: 0, line: /** @type {null | Rect} */ (null) }, bestY = { d: Infinity, v: 0, line: /** @type {null | Rect} */ (null) };
    for (const id of shownIds()) {
      if (orig.has(id)) continue;
      const r = rectOf(id);
      if (!overlaps(r, vr)) continue;
      for (const tx of [r.x, r.x + r.w / 2, r.x + r.w]) for (const m of bx) { const dd = tx - m; if (Math.abs(dd) < thr && Math.abs(dd) < Math.abs(bestX.d)) bestX = { d: dd, v: tx, line: r }; }
      for (const ty of [r.y, r.y + r.h / 2, r.y + r.h]) for (const m of by) { const dd = ty - m; if (Math.abs(dd) < thr && Math.abs(dd) < Math.abs(bestY.d)) bestY = { d: dd, v: ty, line: r }; }
    }
    if (bestX.line) { dx += bestX.d; guides.push({ x1: bestX.v, x2: bestX.v, y1: Math.min(y0 + dy, bestX.line.y) - 12, y2: Math.max(y1 + dy, bestX.line.y + bestX.line.h) + 12 }); }
    else dx = Math.round((x0 + dx) / GRID) * GRID - x0;
    if (bestY.line) { dy += bestY.d; guides.push({ y1: bestY.v, y2: bestY.v, x1: Math.min(x0 + dx, bestY.line.x) - 12, x2: Math.max(x1 + dx, bestY.line.x + bestY.line.w) + 12 }); }
    else dy = Math.round((y0 + dy) / GRID) * GRID - y0;
    return [dx, dy];
  }

  stage.addEventListener('dblclick', (ev) => {
    const n = /** @type {Element} */ (ev.target).closest('.node');
    if (n) startRename(/** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.id));
  });

  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const b = stage.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomTo(cam.k * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025)), { x: ev.clientX - b.left, y: ev.clientY - b.top });
    else { cam.x += (ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) / cam.k; cam.y += (ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) / cam.k; invalidate(); }
  }, { passive: false });

  // drop elements from the model browser
  stage.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer?.types.includes('application/x-loom-id')) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; stage.classList.add('drop-target');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop-target'));
  stage.addEventListener('drop', (ev) => {
    stage.classList.remove('drop-target');
    const id = ev.dataTransfer?.getData('application/x-loom-id');
    if (!id) return;
    ev.preventDefault();
    const e = model.get(id);
    if (!canShow(e)) { toast(`A block definition diagram shows blocks and interface blocks. ${e?.name || 'That'} is a ${kindName(e?.kind || '', ctx.notation())}.`, true); return; }
    if (layout()[id]) { setSel(new Set([id])); revealIfHidden(id); invalidate(); return; }
    const w = eventWorld(ev);
    const nat = content(id).min;
    if (commit('Show on diagram', { [id]: freeSpot(w.x - nat.w / 2, w.y - 24, Math.max(180, nat.w), nat.h) })) setSel(new Set([id]));
  });

  // ---------- keyboard ----------
  stage.addEventListener('keydown', (ev) => {
    if (ev.target !== stage) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.key === ' ') { spaceDown = true; stage.classList.add('pan-ready'); stop(); return; }
    if (ev.key.startsWith('Arrow') && sel.size) {
      const step = ev.shiftKey ? GRID : 1;
      const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0, dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
      /** @type {Record<string, Rect>} */
      const patch = {};
      for (const id of sel) { const r = layout()[id]; patch[id] = { ...r, x: r.x + dx, y: r.y + dy }; }
      commit('Nudge', patch); stop(); return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel.size) { stop(); if (mod) deleteFromModel(); else removeFromView(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && ctx.selected()) {
      // a line is selected: lines show parts and relationships, which live in the model
      stop();
      const e = model.get(/** @type {string} */ (ctx.selected()));
      if (mod && e) { if (ctx.edit(`Delete ${e.name || 'relationship'}`, (tx) => tx.remove(e.id))) toast(`Deleted from the model. ${formatKeys('Mod+Z')} to undo.`); }
      else toast(`That line is a ${kindName(e?.kind || '', ctx.notation())} in the model. ${formatKeys('Mod+Delete')} deletes it from the model.`);
      return;
    }
    if (mod && ev.key.toLowerCase() === 'a') { stop(); setSel(new Set(shownIds())); return; }
    if (ev.key === 'Escape' && sel.size) { stop(); setSel(new Set()); return; }
    if ((ev.key === 'Enter' || ev.key === 'F2') && sel.size === 1) { stop(); startRename([...sel][0]); return; }
    if (mod) return;
    if (ev.key === '0') { stop(); fit(); }
    else if (ev.key === '=' || ev.key === '+') { stop(); zoomBy(1.25); }
    else if (ev.key === '-') { stop(); zoomBy(1 / 1.25); }
    else if (ev.key === 'L' && ev.shiftKey) { stop(); tidy(); }
  });
  stage.addEventListener('keyup', (ev) => { if (ev.key === ' ') { spaceDown = false; stage.classList.remove('pan-ready'); } });
  stage.addEventListener('blur', () => { spaceDown = false; stage.classList.remove('pan-ready'); });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => invalidate()) : null;
  ro?.observe(stage);
  if (!fontsReady && typeof document !== 'undefined') document.fonts?.ready.then(() => { contentCache.clear(); geomDirty = true; built.forEach((b) => { b.key = ''; }); invalidate(); });

  invalidate();
  return {
    el, render, invalidate, fit, syncSelection,
    focus: () => stage.focus(),
    zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(1 / 1.25),
    tidy, addRelated, removeFromView, deleteFromModel,
    selection: () => [...sel],
    /** For the benchmark page. */
    stats: () => ({ lastRenderMs, built: built.size, shown: shownIds().length }),
    /** For the benchmark page: move the camera without animation. @param {Partial<Camera>} c */
    setCamera(c) { Object.assign(cam, c); render(); },
    dispose() { ro?.disconnect(); cancelAnimationFrame(raf); clearTimeout(fullTimer); unsubModel(); },
  };
}

/** @typedef {ReturnType<typeof createDiagramView>} DiagramView */

export { ELEMENTS };
