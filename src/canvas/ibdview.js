// The internal block diagram canvas.
//
//   Drag a part to move it (everything inside comes along; containers grow to fit).
//   Drop a part inside another part to move it there in the model.
//   Drag from a port to connect: compatible ports light up, others fade, and the reason shows
//   by the cursor. Drop on a part to give it a matching port and connect to that.
//   ⌥-drag a port to slide it along its box's edge. The chevron collapses a part.
//   Drop blocks from the model browser to add parts typed by them.
import { h, s, icon, toast, formatKeys } from '../ui/dom.js';
import { popupMenu } from '../ui/menu.js';
import { ibdScene, packIbd, routeConnectors, partLabel, portLabel, snapToBorder, sideOf, containerAt, PORT, PART } from './ibd.js';
import { canConnect, orderEnds, matchingPort, effectiveDirection } from './connect.js';
import { pathData } from './route.js';
import { FONTS, ellipsize, resetMeasureCache } from './measure.js';
import { FRAME, parseKey, partKey, portKey, ownerKey } from '../model/paths.js';
import { kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('./ibd.js').Scene} Scene */
/** @typedef {{ x: number, y: number }} Pt */

const GRID = 10;
const MIN_K = 0.1, MAX_K = 3;
/** @type {Map<string, { x: number, y: number, k: number, seen?: boolean }>} */
const cameras = new Map();
/** @param {string} t */
const esc = (t) => t.replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** @param {Rect} r @param {Pt} p @param {number} [pad] */
const hit = (r, p, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
/** A name made safe for an identifier: "Battery Pack" → "batteryPack". @param {string} n */
const roleName = (n) => { const w = n.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/); return (w[0] || 'part').toLowerCase() + w.slice(1).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(''); };

/**
 * @param {{
 *   model: Model, diagramId: string,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 * }} ctx
 */
export function createIbdView(ctx) {
  const { model, diagramId } = ctx;
  const diagram = () => model.get(diagramId);
  const cam = cameras.get(diagramId) || { x: -60, y: -60, k: 1 };
  cameras.set(diagramId, cam);
  let firstFit = !cam.seen;
  cam.seen = true;

  /** Selected boxes and ports, by layout key. @type {Set<string>} */
  let sel = new Set();
  /** @type {Map<string, Rect>} */
  const override = new Map();
  /** @type {null | { from: string, to: Pt, target: string | null, verdicts: Map<string, import('./connect.js').Verdict>, hint: string }} */
  let linking = null;
  /** @type {{ x: number, y: number, w: number, h: number } | null} */
  let lasso = null;
  /** Container a dragged part would move into. @type {string | null} */
  let dropInto = null;
  let spaceDown = false;
  let lastRenderMs = 0;

  // ---------- DOM ----------
  const camG = s('g', { class: 'cam' });
  const svg = s('svg', { class: 'dsvg', 'aria-hidden': 'true' }, camG);
  const tip = h('div', { class: 'ctip', hidden: true });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const stage = h('div', { class: 'dstage ibd', tabindex: '0', role: 'application', 'aria-roledescription': 'diagram' }, svg, tip, live);
  const zoomLabel = h('span', { class: 'dzoom mono' });
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Diagram tools' },
    h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu', title: 'Add a part, typed by a block', onclick: (/** @type {Event} */ e) => partMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('plus'), 'Part'),
    h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu', title: 'Add a port to the selected part (or to this block)', onclick: (/** @type {Event} */ e) => portMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('plus'), 'Port'),
    h('span', { class: 'dtool-sep' }),
    h('button', { class: 'btn sm', type: 'button', title: 'Show parts and ports of this block that are not on the diagram yet', onclick: () => showMissing() }, icon('related'), 'Show all'),
    h('button', { class: 'btn sm', type: 'button', title: `Tidy layout (${formatKeys('Shift+L')})`, onclick: () => tidy() }, icon('layout'), 'Tidy layout'),
    h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu', onclick: (/** @type {Event} */ e) => viewMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('eye'), 'View'),
    h('span', { class: 'dtool-hint' }, 'Drag from a port to connect'),
    h('span', { style: { flex: '1' } }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => zoomBy(1 / 1.25) }, icon('minus')),
    zoomLabel,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(1.25) }, icon('plus')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fit to window', title: 'Fit (0)', onclick: () => fit() }, icon('fit')));
  const el = h('div', { class: 'dview' }, toolbar, stage);

  // ---------- scene ----------
  const layout = () => /** @type {Record<string, Rect>} */ (diagram()?.layout?.nodes || {});
  /** @type {{ key: string, scene: Scene | null, routes: Map<string, Pt[]> }} */
  let cache = { key: '', scene: null, routes: new Map() };
  function scene() {
    const d = diagram();
    if (!d) return null;
    const key = `${model.version()}|${[...override].map(([k, r]) => `${k}:${r.x},${r.y},${r.w},${r.h}`).join(';')}`;
    if (cache.key === key) return cache.scene;
    const nodes = override.size ? { ...layout(), ...Object.fromEntries(override) } : layout();
    const sc = ibdScene(model, { ...d, layout: { nodes } });
    cache = { key, scene: sc, routes: sc ? routeConnectors(sc) : new Map() };
    return sc;
  }
  /** @param {string} key */
  const rectOf = (key) => override.get(key) || layout()[key];
  const size = () => ({ w: stage.clientWidth || 800, h: stage.clientHeight || 600 });
  /** @param {number} sx @param {number} sy */
  const toWorld = (sx, sy) => ({ x: cam.x + sx / cam.k, y: cam.y + sy / cam.k });
  /** @param {MouseEvent} e */
  const eventWorld = (e) => { const b = stage.getBoundingClientRect(); return toWorld(e.clientX - b.left, e.clientY - b.top); };
  /** Keys inside a part (its descendants and their ports, and its own ports). @param {string} key */
  const subtree = (key) => Object.keys(layout()).filter((k) => key === FRAME ? k !== FRAME : k === key || k.startsWith(key + '/') || k.startsWith(key + '#'));

  // ---------- drawing ----------
  let raf = 0;
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function render() {
    const t0 = performance.now();
    const d = diagram();
    const sc = scene();
    if (!d || !sc) { camG.innerHTML = ''; return; }
    if (firstFit && stage.clientWidth) { firstFit = false; fitNow(); }
    camG.setAttribute('transform', `matrix(${cam.k} 0 0 ${cam.k} ${-cam.x * cam.k} ${-cam.y * cam.k})`);
    const grid = cam.k * 20 < 8 ? 100 : 20;
    stage.style.backgroundSize = `${grid * cam.k}px ${grid * cam.k}px`;
    stage.style.backgroundPosition = `${-cam.x * cam.k}px ${-cam.y * cam.k}px`;
    zoomLabel.textContent = `${Math.round(cam.k * 100)}%`;
    const n = ctx.notation();
    const showTypes = d.props.showTypes !== false, showNames = d.props.showPortNames !== false, showFlows = d.props.showFlows !== false;
    const selectedEl = ctx.selected();
    stage.setAttribute('aria-label', `${kindName(d.kind, n)} of ${sc.block.name}: ${sc.parts.length} parts, ${sc.ports.length} ports, ${sc.conns.length} connectors.`);
    const out = [];

    // frame
    const f = sc.frame;
    const title = n === 'guided' ? `Inside ${sc.block.name}` : n === 'v2' ? `interconnection view · ${sc.block.name}` : `ibd [Block] ${sc.block.name}`;
    const tabW = Math.min(f.w - 20, ellipsize(title, f.w - 40, FONTS.name).length * 7.4 + 30);
    out.push(`<g class="frame${sel.has(FRAME) ? ' sel' : ''}${dropInto === FRAME ? ' drop' : ''}" data-key="${FRAME}"><rect class="frame-box" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="14"/>`);
    out.push(`<path class="frame-tab" data-key="${FRAME}" d="M${f.x} ${f.y + 30} L${f.x} ${f.y + 14} Q${f.x} ${f.y} ${f.x + 14} ${f.y} L${f.x + tabW} ${f.y} L${f.x + tabW} ${f.y + 18} Q${f.x + tabW} ${f.y + 30} ${f.x + tabW - 12} ${f.y + 30} Z"/>`);
    out.push(`<text class="frame-title" x="${f.x + 14}" y="${f.y + 20}">${esc(ellipsize(title, tabW - 24, FONTS.name))}</text>`);
    if (sel.has(FRAME)) out.push(handles(FRAME, f));
    out.push('</g>');

    // parts, outer first
    for (const p of [...sc.parts].sort((a, b) => a.depth - b.depth)) {
      const r = p.rect, on = sel.has(p.key);
      const label = partLabel(p.part, p.type, n, showTypes);
      out.push(`<g class="part d${Math.min(p.depth, 4)}${on ? ' sel' : ''}${dropInto === p.key ? ' drop' : ''}${linking?.target === p.key ? ' link-target' : ''}" data-key="${esc(p.key)}">`);
      out.push(`<rect class="part-box" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10"/>`);
      const nameW = r.w - 24 - (p.hasInside ? 26 : 0);
      const [nm, ...rest] = label.split(/( : | \()/);
      const fullFits = ellipsize(label, nameW, FONTS.name) === label;
      if (fullFits && rest.length) out.push(`<text class="part-name" x="${r.x + 12}" y="${r.y + 24}"><tspan>${esc(nm)}</tspan><tspan class="part-type">${esc(rest.join(''))}</tspan></text>`);
      else out.push(`<text class="part-name" x="${r.x + 12}" y="${r.y + 24}">${esc(ellipsize(label, nameW, FONTS.name))}</text>`);
      if (p.hasInside) out.push(`<g class="coll" data-key="${esc(p.key)}"><rect x="${r.x + r.w - 30}" y="${r.y + 8}" width="22" height="22" rx="6"/><path d="${p.collapsed ? `M${r.x + r.w - 22} ${r.y + 14} l6 5 -6 5` : `M${r.x + r.w - 25} ${r.y + 16} l6 6 6 -6`}"/></g>`);
      if (p.collapsed) {
        const inside = p.type ? model.children(p.type.id).filter((c) => c.kind === 'part').length : 0;
        out.push(`<text class="part-hint" x="${r.x + 12}" y="${r.y + 44}">${esc(ellipsize(`${inside} part${inside === 1 ? '' : 's'} inside`, r.w - 24, FONTS.row))}</text>`);
      }
      if (on && sel.size === 1) out.push(handles(p.key, r));
      out.push('</g>');
    }

    // connectors
    for (const c of sc.conns) {
      const pts = cache.routes.get(c.id);
      if (!pts || pts.length < 2) continue;
      const dPath = pathData(pts);
      const on = c.el.id === selectedEl;
      out.push(`<path class="c-hit" data-el="${c.el.id}" d="${dPath}"/><path class="conn${on ? ' sel' : ''}" d="${dPath}"/>`);
      if (showFlows && c.flow !== 'None') {
        // the flow arrow and label sit on the longest segment
        let bi = 1, bl = -1;
        for (let i = 1; i < pts.length; i++) { const l = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y); if (l > bl) { bl = l; bi = i; } }
        const a = pts[bi - 1], b = pts[bi], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const u = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
        const dirs = c.flow === 'From → To' ? [1] : c.flow === 'To → From' ? [-1] : [1, -1];
        for (const dsgn of dirs) {
          const ux = u.x * dsgn, uy = u.y * dsgn, off = dirs.length > 1 ? dsgn * 7 : 0;
          const tx = mx + u.x * off, ty = my + u.y * off;
          out.push(`<polygon class="flow-arrow${on ? ' sel' : ''}" points="${tx + ux * 6},${ty + uy * 6} ${tx - ux * 5 - uy * 5},${ty - uy * 5 + ux * 5} ${tx - ux * 5 + uy * 5},${ty - uy * 5 - ux * 5}"/>`);
        }
        if (c.item) {
          const horiz = u.y === 0;
          out.push(`<text class="flow-label" x="${horiz ? mx : mx + 10}" y="${horiz ? my + 16 : my + 4}" text-anchor="${horiz ? 'middle' : 'start'}">${esc(ellipsize(c.item, 180, FONTS.label))}</text>`);
        }
      }
    }

    // ports and their names (a connected port shows just its name: its type is on the line)
    const connectedKeys = new Set(sc.conns.flatMap((c) => [c.a, c.b]));
    for (const p of sc.ports) {
      const r = p.rect, on = sel.has(p.key);
      const v = linking?.verdicts.get(p.key);
      const state = linking ? (p.key === linking.from ? ' source' : v?.ok ? ' ok' : ' no') : '';
      const dir = effectiveDirection({ key: p.key, port: p.port, onFrame: false });
      out.push(`<g class="port ${dir}${p.port.props.portKind === 'full' ? ' full' : ''}${on ? ' sel' : ''}${state}${linking?.target === p.key ? ' hover' : ''}" data-key="${esc(p.key)}">`);
      out.push(`<rect class="port-box" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="2.5"/>`);
      // a small arrow inside: out points away from the box it belongs to, in points into it
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const nrm = p.side === 'l' ? [-1, 0] : p.side === 'r' ? [1, 0] : p.side === 't' ? [0, -1] : [0, 1];
      const sgn = (p.port.props.direction === 'out' ? 1 : p.port.props.direction === 'in' ? -1 : 0) * (p.port.props.conjugated ? -1 : 1);
      if (sgn) {
        const [ux, uy] = [nrm[0] * sgn, nrm[1] * sgn];
        out.push(`<polygon class="port-arrow" points="${cx + ux * 3.5},${cy + uy * 3.5} ${cx - ux * 2.5 - uy * 3},${cy - uy * 2.5 + ux * 3} ${cx - ux * 2.5 + uy * 3},${cy - uy * 2.5 - ux * 3}"/>`);
      } else out.push(`<rect class="port-arrow" x="${cx - 2}" y="${cy - 2}" width="4" height="4"/>`);
      out.push('</g>');
      if (showNames) {
        const label = ellipsize(connectedKeys.has(p.key) && showFlows ? portLabel(p.port, null, false) : portLabel(p.port, p.type, showTypes), 170, FONTS.label);
        const inward = p.onFrame;
        const side = p.side;
        const [lx, ly, anchor] = side === 'l' ? (inward ? [r.x + r.w + 6, cy - 7, 'start'] : [r.x - 6, cy - 7, 'end'])
          : side === 'r' ? (inward ? [r.x - 6, cy - 7, 'end'] : [r.x + r.w + 6, cy - 7, 'start'])
          : side === 't' ? [cx + 9, inward ? r.y + r.h + 12 : r.y - 4, 'start'] : [cx + 9, inward ? r.y - 4 : r.y + r.h + 12, 'start'];
        out.push(`<text class="port-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(label)}</text>`);
      }
    }

    // a connection being drawn
    if (linking) {
      const from = /** @type {any} */ (sc.byKey.get(linking.from));
      if (from) {
        const a = { x: from.rect.x + from.rect.w / 2, y: from.rect.y + from.rect.h / 2 };
        const ok = linking.target && (linking.verdicts.get(linking.target)?.ok || !linking.target.includes('#'));
        out.push(`<path class="rubber${ok ? ' ok' : ''}" d="M${a.x} ${a.y} L${linking.to.x} ${linking.to.y}"/>`);
      }
    }
    if (lasso) out.push(`<rect class="lasso" x="${lasso.x}" y="${lasso.y}" width="${lasso.w}" height="${lasso.h}"/>`);
    camG.innerHTML = out.join('');
    lastRenderMs = performance.now() - t0;
  }

  /** @param {string} key @param {Rect} r */
  function handles(key, r) {
    return [[r.x + r.w, r.y + r.h / 2, 'e'], [r.x + r.w / 2, r.y + r.h, 's'], [r.x + r.w, r.y + r.h, 'se']]
      .map(([x, y, k]) => `<rect class="handle h-${k}" data-handle="${k}" data-key="${esc(key)}" x="${/** @type {number} */ (x) - 4.5}" y="${/** @type {number} */ (y) - 4.5}" width="9" height="9" rx="2"/>`).join('');
  }

  // ---------- camera ----------
  /** @param {number} k @param {Pt} [at] */
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
    const f = layout()[FRAME];
    const { w, h: hh } = size();
    if (!f) return;
    cam.k = Math.min(1.25, Math.max(MIN_K, Math.min((w - 80) / (f.w + 200), (hh - 80) / (f.h + 60))));
    cam.x = f.x + f.w / 2 - w / 2 / cam.k; cam.y = f.y + f.h / 2 - hh / 2 / cam.k;
  }
  function fit() { fitNow(); invalidate(); }

  // ---------- selection ----------
  /** The model element a key stands for. @param {string} key */
  const elementOf = (key) => { if (key === FRAME) return diagram()?.owner || null; const k = parseKey(key); return k.port || k.path[k.path.length - 1] || null; };
  /** @param {Set<string>} next */
  function setSel(next) {
    sel = next;
    const primary = sel.size ? [...sel][sel.size - 1] : null;
    ctx.select(primary ? elementOf(primary) : null);
    if (primary) live.textContent = `Selected ${model.get(/** @type {string} */ (elementOf(primary)))?.name || ''}`;
    invalidate();
  }
  /** @param {string | null} id */
  function syncSelection(id) {
    if (!id) { if (sel.size) { sel = new Set(); invalidate(); } return; }
    if ([...sel].some((k) => elementOf(k) === id)) return;
    const k = Object.keys(layout()).find((key) => elementOf(key) === id);
    sel = k ? new Set([k]) : new Set();
    invalidate();
  }

  // ---------- editing helpers ----------
  /** @param {string} label @param {Record<string, Rect | null>} patch */
  const commit = (label, patch) => ctx.edit(label, (tx) => tx.place(diagramId, patch));

  /**
   * Grow every container (and the frame) that no longer holds what is inside it.
   * @param {Record<string, Rect | null>} patch changes so far; grown containers are added
   */
  function growToFit(patch) {
    const L = { ...layout(), ...patch };
    const keys = Object.keys(L).filter((k) => L[k] && !k.includes('#'));
    // deepest first, so growth bubbles up
    keys.sort((a, b) => (b === FRAME ? -1 : b.split('/').length) - (a === FRAME ? -1 : a.split('/').length));
    for (const key of keys) {
      const r = /** @type {Rect} */ (L[key]);
      const kids = keys.filter((k) => k !== key && (key === FRAME ? !k.includes('/') && k !== FRAME : k.startsWith(key + '/') && k.split('/').length === key.split('/').length + 1));
      if (!kids.length || r.c) continue;
      const pad = key === FRAME ? 40 : 20, top = key === FRAME ? 52 : PART.header;
      let x1 = r.x + r.w, y1 = r.y + r.h, x0 = r.x, y0 = r.y;
      for (const k of kids) { const q = /** @type {Rect} */ (L[k]); x1 = Math.max(x1, q.x + q.w + pad); y1 = Math.max(y1, q.y + q.h + pad); x0 = Math.min(x0, q.x - pad); y0 = Math.min(y0, q.y - top); }
      if (x0 < r.x || y0 < r.y || x1 > r.x + r.w || y1 > r.y + r.h) {
        const nr = { ...r, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        patch[key] = nr; L[key] = nr;
        // keep its ports on its (moved) edges
        for (const pk of Object.keys(L).filter((k) => k.includes('#') && ownerKey(k) === key)) {
          const pr = /** @type {Rect} */ (L[pk]);
          const side = sideOf(r, { x: pr.x + pr.w / 2, y: pr.y + pr.h / 2 });
          const np = { ...pr };
          if (side === 'r') np.x = nr.x + nr.w - pr.w / 2; if (side === 'l') np.x = nr.x - pr.w / 2;
          if (side === 'b') np.y = nr.y + nr.h - pr.h / 2; if (side === 't') np.y = nr.y - pr.h / 2;
          patch[pk] = np; L[pk] = np;
        }
      }
    }
    return patch;
  }

  /** The block a container key stands for (the diagram's block for the frame). @param {string} key */
  function blockOf(key) {
    if (key === FRAME) return diagram()?.owner || null;
    const b = scene()?.byKey.get(key);
    return b && 'part' in b ? b.type?.id || null : null;
  }

  /** Put a part (and its ports, and its insides) at a point inside a container. @param {string} containerKey @param {string} partId @param {Pt} at */
  function placementFor(containerKey, partId, at) {
    const prefix = containerKey === FRAME ? [] : containerKey.split('/');
    const p = /** @type {any} */ (model.get(partId));
    const type = p.props.type ? model.get(p.props.type) : null;
    const w = Math.max(PART.minW, Math.ceil((partLabel(p, type || null, ctx.notation(), true).length * 7.6 + 40) / 10) * 10);
    const key = partKey([...prefix, partId]);
    const box = { x: Math.round((at.x - w / 2) / GRID) * GRID, y: Math.round((at.y - 30) / GRID) * GRID, w, h: PART.leafH };
    /** @type {Record<string, Rect>} */
    const patch = { [key]: box };
    // ports of its type, on its edges
    if (type) {
      const ports = model.children(type.id).filter((c) => c.kind === 'port');
      const bySide = { l: ports.filter((q) => q.props.direction === 'in'), r: ports.filter((q) => q.props.direction === 'out'), b: ports.filter((q) => q.props.direction !== 'in' && q.props.direction !== 'out') };
      box.h = Math.max(box.h, 40 + Math.max(bySide.l.length, bySide.r.length) * 30);
      for (const [side, list] of Object.entries(bySide)) list.forEach((q, i) => {
        const t = (i + 1) / (list.length + 1);
        const cx = side === 'l' ? box.x : side === 'r' ? box.x + box.w : box.x + 24 + (box.w - 48) * t;
        const cy = side === 'b' ? box.y + box.h : box.y + 30 + (box.h - 46) * t;
        patch[portKey([...prefix, partId], q.id)] = { x: Math.round(cx - PORT / 2), y: Math.round(cy - PORT / 2), w: PORT, h: PORT };
      });
    }
    return patch;
  }

  // ---------- toolbar actions ----------
  /** @param {HTMLElement} anchor */
  function partMenu(anchor) {
    const target = [...sel].find((k) => !k.includes('#') && blockOf(k)) || FRAME;
    const into = blockOf(target);
    if (!into) { toast('That part has no type, so it cannot contain parts. Give it a type first.', true); return; }
    const blocks = model.byKind('partDef').filter((b) => b.id !== into).sort((a, b) => a.name.localeCompare(b.name));
    popupMenu(anchor, [
      ...blocks.slice(0, 40).map((b) => ({ label: b.name, hint: 'blk', run: () => addPart(target, b.id) })),
      ...(blocks.length ? /** @type {const} */ (['sep']) : []),
      { label: 'New block…', hint: '+', run: () => addPart(target, null) },
    ], { title: `Add a part inside ${model.get(into)?.name}` });
  }
  /** @param {string} containerKey @param {string | null} typeId null: a new block */
  function addPart(containerKey, typeId) {
    const into = /** @type {string} */ (blockOf(containerKey));
    const c = containerKey === FRAME ? layout()[FRAME] : rectOf(containerKey);
    const { w, h: hh } = size();
    const view = toWorld(w / 2, hh / 2);
    const at = c && hit(c, view) ? view : { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    let partId = '';
    const ok = ctx.edit('Add part', (tx) => {
      let t = typeId;
      if (!t) { const pkg = model.get(into)?.owner || model.layers().find((l) => l.layer === 'l')?.id; t = tx.create('partDef', { owner: pkg, name: 'New Block' }); }
      const tn = model.get(/** @type {string} */ (t))?.name || 'part';
      const taken = new Set(model.children(into).map((x) => x.name));
      let name = roleName(tn); for (let i = 2; taken.has(name); i++) name = `${roleName(tn)}${i}`;
      partId = tx.create('part', { owner: into, name, props: { type: t } });
      tx.place(diagramId, growToFit(placementFor(containerKey, partId, at)));
    });
    if (ok) { setSel(new Set([partKey([...(containerKey === FRAME ? [] : containerKey.split('/')), partId])])); }
  }
  /** @param {HTMLElement} anchor */
  function portMenu(anchor) {
    const target = [...sel].find((k) => !k.includes('#')) || FRAME;
    const blk = blockOf(target);
    if (!blk) { toast('That part has no type, so it cannot have ports. Give it a type first.', true); return; }
    const ifaces = model.byKind('interfaceDef').sort((a, b) => a.name.localeCompare(b.name));
    /** @param {'in' | 'out' | 'inout'} dir @param {string | null} type */
    const add = (dir, type) => {
      const r = target === FRAME ? layout()[FRAME] : rectOf(target);
      const existing = Object.keys(layout()).filter((k) => k.includes('#') && ownerKey(k) === target).length;
      const side = dir === 'in' ? 'l' : dir === 'out' ? 'r' : 'b';
      const t = Math.min(0.9, 0.3 + existing * 0.15);
      const cx = side === 'l' ? r.x : side === 'r' ? r.x + r.w : r.x + r.w * t, cy = side === 'b' ? r.y + r.h : r.y + 30 + (r.h - 40) * t;
      let pid = '';
      if (ctx.edit('Add port', (tx) => {
        const tn = type ? model.get(type)?.name || '' : '';
        pid = tx.create('port', { owner: blk, name: `${roleName(tn || 'port')}${dir === 'in' ? 'In' : dir === 'out' ? 'Out' : ''}`, props: { type, direction: dir } });
        tx.place(diagramId, { [target === FRAME ? `#${pid}` : portKey(target.split('/'), pid)]: { x: Math.round(cx - PORT / 2), y: Math.round(cy - PORT / 2), w: PORT, h: PORT } });
      })) setSel(new Set([target === FRAME ? `#${pid}` : portKey(target.split('/'), pid)]));
    };
    popupMenu(anchor, [
      ...(['in', 'out', 'inout']).flatMap((dir) => [
        { label: `${dir === 'inout' ? 'In and out' : dir === 'in' ? 'In' : 'Out'} port, no type`, hint: dir, run: () => add(/** @type {any} */ (dir), null) },
      ]),
      ...(ifaces.length ? /** @type {const} */ (['sep']) : []),
      ...ifaces.slice(0, 20).flatMap((i) => [
        { label: `In · ${i.name}`, hint: 'in', run: () => add('in', i.id) },
        { label: `Out · ${i.name}`, hint: 'out', run: () => add('out', i.id) },
      ]),
    ], { title: `Add a port to ${model.get(blk)?.name}` });
  }
  /** Show parts and ports that exist in the model but are not on the diagram. */
  function showMissing() {
    const before = Object.keys(layout()).length;
    const packed = packIbd(model, /** @type {string} */ (diagram()?.owner), { notation: ctx.notation() });
    /** @type {Record<string, Rect>} */
    const patch = {};
    const f = layout()[FRAME];
    const dx = f.x - packed[FRAME].x, dy = f.y + f.h + 60 - packed[FRAME].y;
    for (const [k, r] of Object.entries(packed)) if (k !== FRAME && !layout()[k]) {
      const parent = ownerKey(k) === FRAME ? null : ownerKey(k);
      // inside an existing box: use the packed position relative to it; else below the frame
      patch[k] = parent && layout()[parent] && !patch[parent] ? { ...r, x: r.x - packed[parent].x + layout()[parent].x, y: r.y - packed[parent].y + layout()[parent].y } : { ...r, x: r.x + dx, y: r.y + dy };
    }
    if (!Object.keys(patch).length) { toast('Everything inside this block is already shown'); return; }
    commit('Show all', growToFit(patch));
    toast(`Added ${Object.keys(layout()).length - before} parts and ports. ${formatKeys('Shift+L')} tidies the layout.`);
  }
  /** Lay everything out again (keeps what is collapsed). */
  function tidy() {
    const d = diagram();
    if (!d?.owner) return;
    const packed = packIbd(model, d.owner, { notation: ctx.notation(), x: layout()[FRAME]?.x ?? 0, y: layout()[FRAME]?.y ?? 0 });
    /** @type {Record<string, Rect | null>} */
    const patch = {};
    for (const k of Object.keys(layout())) if (layout()[k] && packed[k]) patch[k] = layout()[k].c ? { ...packed[k], c: 1 } : packed[k];
    for (const k of Object.keys(layout())) if (!packed[k]) patch[k] = layout()[k]; // keep what packing does not know (deeper parts)
    commit('Tidy layout', growToFit(patch));
    fit();
  }
  /** @param {HTMLElement} anchor */
  function viewMenu(anchor) {
    const d = diagram();
    if (!d) return;
    const flags = /** @type {[string, string][]} */ ([['showTypes', 'Types on parts and ports'], ['showPortNames', 'Port names'], ['showFlows', 'Item flows'], ['snap', 'Snap to grid']]);
    popupMenu(anchor, flags.map(([k, label]) => ({
      label, hint: d.props[k] !== false ? 'on' : 'off',
      run: () => ctx.edit(`${d.props[k] !== false ? 'Hide' : 'Show'} ${label.toLowerCase()}`, (tx) => tx.setProps(diagramId, { [k]: d.props[k] === false })),
    })), { title: 'This diagram shows' });
  }
  /** @param {string} key */
  function toggleCollapse(key) {
    const r = layout()[key];
    if (!r) return;
    const next = /** @type {Rect} */ ({ ...r });
    if (r.c) delete next.c; else next.c = 1;
    if (r.c) commit('Expand', growToFit({ [key]: next })); else commit('Collapse', { [key]: next });
  }

  function removeFromView() {
    const keys = [...sel].filter((k) => k !== FRAME);
    if (!keys.length) return;
    /** @type {Record<string, null>} */
    const patch = {};
    for (const k of keys) for (const x of k.includes('#') ? [k] : subtree(k)) patch[x] = null;
    if (commit('Remove from the diagram', patch)) { setSel(new Set()); toast(`Removed from the diagram (still in the model). ${formatKeys('Mod+Z')} to undo.`); }
  }
  function deleteFromModel() {
    const ids = [...new Set([...sel].filter((k) => k !== FRAME).map(elementOf).filter((x) => !!x))];
    if (!ids.length) return;
    const names = ids.map((id) => model.get(/** @type {string} */ (id))?.name).join(', ');
    if (ctx.edit(`Delete ${names}`, (tx) => ids.forEach((id) => { if (model.get(/** @type {string} */ (id))) tx.remove(id); }))) { setSel(new Set()); toast(`Deleted ${names} from the model. ${formatKeys('Mod+Z')} to undo.`); }
  }

  // ---------- connecting ----------
  /** @param {string} key @param {string} [other] */
  const portEnd = (key, other) => {
    const sc = scene();
    const b = /** @type {import('./ibd.js').PortBox | undefined} */ (sc?.byKey.get(key));
    if (!b || !('port' in b)) return null;
    // a port seen from inside its own box (frame, or a part whose insides it delegates to)
    const otherPath = other ? parseKey(other).path.join('/') : '';
    const inward = b.onFrame || (!!other && otherPath.startsWith(b.owner + '/'));
    return { key, port: b.port, onFrame: inward };
  };
  /** Already joined by a connector on this diagram? @param {string} a @param {string} b */
  const connected = (a, b) => !!scene()?.conns.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  /** @param {string} from */
  function startLink(from) {
    /** @type {Map<string, import('./connect.js').Verdict>} */
    const verdicts = new Map();
    for (const p of scene()?.ports || []) {
      if (p.key === from) continue;
      const a = portEnd(from, p.key), b = portEnd(p.key, from);
      if (a && b) verdicts.set(p.key, canConnect(model, a, b, { connected }));
    }
    const r = rectOf(from);
    linking = { from, to: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, target: null, verdicts, hint: '' };
  }
  /** @param {Pt} w @param {MouseEvent} ev */
  function moveLink(w, ev) {
    if (!linking) return;
    const sc = scene();
    linking.to = w;
    const port = sc?.ports.find((p) => p.key !== linking?.from && hit(p.rect, w, 6));
    let msg = '';
    if (port) {
      linking.target = port.key;
      const v = linking.verdicts.get(port.key);
      msg = v ? (v.ok ? `✓ ${v.reason}${v.warn ? ` · ${v.warn}` : ''}` : `✕ ${v.reason}`) : '';
    } else if (sc) {
      const c = containerAt(sc, w, new Set());
      const fromOwner = ownerKey(linking.from);
      linking.target = c !== FRAME && c !== fromOwner ? c : null;
      if (linking.target) {
        const b = /** @type {import('./ibd.js').PartBox} */ (sc.byKey.get(linking.target));
        msg = b.type ? `+ Release to give ${b.part.name} a matching port and connect` : `${b.part.name} has no type, so it cannot get a port`;
      } else msg = 'Drop on a port, or on a part to add a matching port';
    }
    const b = stage.getBoundingClientRect();
    tip.hidden = !msg;
    tip.textContent = msg;
    tip.className = 'ctip' + (msg.startsWith('✕') || msg.includes('cannot') ? ' bad' : msg.startsWith('✓') || msg.startsWith('+') ? ' good' : '');
    tip.style.left = `${ev.clientX - b.left + 14}px`; tip.style.top = `${ev.clientY - b.top + 16}px`;
    invalidate();
  }
  function endLink() {
    if (!linking) return;
    const l = linking;
    linking = null; tip.hidden = true;
    const target = l.target;
    if (!target) { invalidate(); return; }
    const d = /** @type {any} */ (diagram());
    if (target.includes('#')) {
      const v = l.verdicts.get(target);
      if (!v?.ok) { toast(v?.reason || 'Those ports cannot be connected', true); invalidate(); return; }
      makeConnector(l.from, target, v.warn);
      return;
    }
    // dropped on a part: give it a matching port first
    const sc = scene();
    const b = /** @type {import('./ibd.js').PartBox | undefined} */ (sc?.byKey.get(target));
    const from = portEnd(l.from, target);
    if (!b || !b.type || !from) { toast('That part has no type, so it cannot get a port', true); invalidate(); return; }
    const spec = matchingPort(from);
    const r = b.rect;
    const pt = snapToBorder(r, l.to);
    let newKey = '';
    const taken = new Set(model.children(b.type.id).map((x) => x.name));
    let name = spec.name; for (let i = 2; taken.has(name); i++) name = `${spec.name}${i}`;
    if (!ctx.edit('Connect', (tx) => {
      const pid = tx.create('port', { owner: /** @type {any} */ (b.type).id, name, props: { type: spec.type, direction: spec.direction } });
      newKey = portKey(b.path, pid);
      tx.place(d.id, { [newKey]: { x: Math.round(pt.x - PORT / 2), y: Math.round(pt.y - PORT / 2), w: PORT, h: PORT } });
      connectIn(tx, l.from, newKey, /** @type {any} */ (b.type).id, pid);
    })) { invalidate(); return; }
    toast(`Added port ${name} to ${b.type.name} and connected it`);
  }
  /**
   * Create a connector (inside an open transaction). Connectors are owned by the diagram's
   * block, with ends given as part paths from it, so they belong to this usage.
   * @param {any} tx @param {string} aKey @param {string} bKey @param {string} [newPortOwner] @param {string} [newPortId]
   */
  function connectIn(tx, aKey, bKey, newPortOwner, newPortId) {
    const sc = /** @type {Scene} */ (scene());
    const portOf = (/** @type {string} */ key) => {
      const k = parseKey(key);
      const p = key === bKey && newPortId ? model.get(newPortId) : (/** @type {any} */ (sc.byKey.get(key)))?.port;
      return { key, port: p, onFrame: k.path.length === 0 || parseKey(key === aKey ? bKey : aKey).path.join('/').startsWith(k.path.join('/') + '/') };
    };
    void newPortOwner;
    const [A, B] = orderEnds(portOf(aKey), portOf(bKey));
    const toEnd = (/** @type {string} */ key) => { const k = parseKey(key); return { path: k.path, port: k.port }; };
    const nm = (/** @type {string} */ key) => { const k = parseKey(key); return [...k.path.map((x) => model.get(x)?.name), k.port ? model.get(k.port)?.name : null].filter(Boolean).join('.'); };
    const t = A.port?.props.type ? model.get(A.port.props.type)?.name : B.port?.props.type ? model.get(B.port.props.type)?.name : '';
    tx.create('connector', { owner: diagram()?.owner, name: `${nm(A.key)} → ${nm(B.key)}`, props: { end1: toEnd(A.key), end2: toEnd(B.key), item: t || '', flow: t ? 'From → To' : 'None' } });
  }
  /** @param {string} a @param {string} b @param {string} [warn] */
  function makeConnector(a, b, warn) {
    if (ctx.edit('Connect', (tx) => connectIn(tx, a, b))) toast(warn ? `Connected. ${warn}.` : 'Connected');
  }

  // ---------- pointer ----------
  /**
   * @type {null
   *  | { mode: 'move', start: Pt, keys: string[], orig: Map<string, Rect>, moved: boolean }
   *  | { mode: 'resize', key: string, handle: string, start: Pt, orig: Rect }
   *  | { mode: 'slide', key: string }
   *  | { mode: 'link', key: string, start: Pt, moved: boolean }
   *  | { mode: 'lasso', start: Pt, base: Set<string> }
   *  | { mode: 'pan', sx: number, sy: number, cx: number, cy: number }}
   */
  let drag = null;

  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    stage.focus({ preventScroll: true });
    const t = /** @type {Element} */ (ev.target);
    const w = eventWorld(ev);
    const keyOf = (/** @type {string} */ sel_) => /** @type {string} */ (/** @type {HTMLElement} */ (t.closest(sel_))?.dataset.key);
    if (ev.button === 1 || (ev.button === 0 && spaceDown)) { drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y }; stage.classList.add('panning'); }
    else if (ev.button !== 0) return;
    else if (t.closest('.coll')) { toggleCollapse(keyOf('.coll')); return; }
    else if (t.closest('[data-handle]')) { const key = keyOf('[data-handle]'); drag = { mode: 'resize', key, handle: /** @type {string} */ (/** @type {HTMLElement} */ (t.closest('[data-handle]')).dataset.handle), start: w, orig: { ...rectOf(key) } }; }
    else if (t.closest('.port')) {
      const key = keyOf('.port');
      if (ev.altKey) drag = { mode: 'slide', key };
      else drag = { mode: 'link', key, start: w, moved: false };
    } else if (t.closest('.c-hit')) { sel = new Set(); ctx.select(/** @type {string} */ (/** @type {SVGElement} */ (t.closest('.c-hit')).dataset.el)); invalidate(); return; }
    else if (t.closest('.part') || t.closest('.frame-tab')) {
      const key = t.closest('.part') ? keyOf('.part') : FRAME;
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { const nx = new Set(sel); if (nx.has(key)) nx.delete(key); else nx.add(key); setSel(nx); return; }
      if (!sel.has(key)) setSel(new Set([key]));
      // move the selection; a part inside another selected part moves with it anyway
      const roots = [...sel].filter((k) => !k.includes('#') && ![...sel].some((o) => o !== k && (o === FRAME || k.startsWith(o + '/'))));
      const keys = [...new Set(roots.flatMap(subtree).concat(roots))];
      drag = { mode: 'move', start: w, keys, orig: new Map(keys.map((k) => [k, { ...rectOf(k) }])), moved: false };
    } else drag = { mode: 'lasso', start: w, base: new Set(ev.shiftKey ? sel : []) };
    stage.setPointerCapture(ev.pointerId);
  });

  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const w = eventWorld(ev);
    const snap = diagram()?.props.snap !== false && !ev.altKey;
    if (drag.mode === 'pan') { cam.x = drag.cx - (ev.clientX - drag.sx) / cam.k; cam.y = drag.cy - (ev.clientY - drag.sy) / cam.k; invalidate(); }
    else if (drag.mode === 'move') {
      let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * cam.k < 3) return;
      drag.moved = true;
      if (snap) { const r0 = /** @type {Rect} */ (drag.orig.get(drag.keys[0])); dx = Math.round((r0.x + dx) / GRID) * GRID - r0.x; dy = Math.round((r0.y + dy) / GRID) * GRID - r0.y; }
      override.clear();
      for (const [k, r] of drag.orig) override.set(k, { ...r, x: r.x + dx, y: r.y + dy });
      // would a single moved part land in a different container?
      const movedParts = [...sel].filter((k) => !k.includes('#') && k !== FRAME);
      dropInto = null;
      if (movedParts.length === 1) {
        const k = movedParts[0], r = /** @type {Rect} */ (override.get(k));
        const sc = scene();
        if (sc) {
          const c = containerAt(sc, { x: r.x + r.w / 2, y: r.y + 16 }, new Set([k]));
          const parent = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : FRAME;
          if (c !== parent) dropInto = c;
        }
      }
      invalidate();
    } else if (drag.mode === 'resize') {
      const o = drag.orig;
      let nw = drag.handle.includes('e') ? o.w + w.x - drag.start.x : o.w;
      let nh = drag.handle.includes('s') ? o.h + w.y - drag.start.y : o.h;
      if (snap) { nw = Math.round((o.x + nw) / GRID) * GRID - o.x; nh = Math.round((o.y + nh) / GRID) * GRID - o.y; }
      // never smaller than what is inside
      let minW = 120, minH = 50;
      for (const k of Object.keys(layout())) if (k !== drag.key && !k.includes('#') && (drag.key === FRAME || k.startsWith(drag.key + '/'))) { const q = layout()[k]; minW = Math.max(minW, q.x + q.w + 16 - o.x); minH = Math.max(minH, q.y + q.h + 16 - o.y); }
      override.set(drag.key, { ...o, w: Math.max(minW, nw), h: Math.max(minH, nh) });
      // ports follow the edges they sit on
      for (const pk of Object.keys(layout()).filter((k) => k.includes('#') && ownerKey(k) === drag?.key)) {
        const pr = layout()[pk], side = sideOf(o, { x: pr.x + pr.w / 2, y: pr.y + pr.h / 2 });
        const nr = /** @type {Rect} */ (override.get(drag.key));
        override.set(pk, { ...pr, x: side === 'r' ? nr.x + nr.w - pr.w / 2 : pr.x, y: side === 'b' ? nr.y + nr.h - pr.h / 2 : Math.min(pr.y, nr.y + nr.h - 12) });
      }
      invalidate();
    } else if (drag.mode === 'slide') {
      const owner = ownerKey(drag.key);
      const r = owner === FRAME ? layout()[FRAME] : rectOf(owner);
      const p = snapToBorder(r, w);
      override.set(drag.key, { x: Math.round(p.x - PORT / 2), y: Math.round(p.y - PORT / 2), w: PORT, h: PORT });
      invalidate();
    } else if (drag.mode === 'link') {
      if (!drag.moved && Math.hypot(w.x - drag.start.x, w.y - drag.start.y) * cam.k < 4) return;
      if (!drag.moved) { drag.moved = true; startLink(drag.key); }
      moveLink(w, ev);
    } else if (drag.mode === 'lasso') {
      lasso = { x: Math.min(drag.start.x, w.x), y: Math.min(drag.start.y, w.y), w: Math.abs(w.x - drag.start.x), h: Math.abs(w.y - drag.start.y) };
      const nx = new Set(drag.base);
      for (const p of scene()?.parts || []) if (overlaps(p.rect, lasso)) nx.add(p.key);
      sel = nx; invalidate();
    }
  });

  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    stage.classList.remove('panning');
    if (d.mode === 'move' && d.moved) {
      const into = dropInto; dropInto = null;
      const patch = Object.fromEntries(override);
      override.clear();
      const parts = [...sel].filter((k) => !k.includes('#') && k !== FRAME);
      if (into && parts.length === 1) reparent(parts[0], into, patch);
      else commit(d.keys.length > 1 ? 'Move' : 'Move', growToFit(patch));
    } else if (d.mode === 'resize' || d.mode === 'slide') {
      const patch = Object.fromEntries(override);
      override.clear();
      if (Object.keys(patch).length) commit(d.mode === 'resize' ? 'Resize' : 'Move port', d.mode === 'resize' ? growToFit(patch) : patch);
    } else if (d.mode === 'link') {
      if (d.moved) endLink(); else setSel(new Set([d.key]));
    } else if (d.mode === 'lasso') {
      const tiny = !lasso || (lasso.w * cam.k < 3 && lasso.h * cam.k < 3);
      lasso = null;
      if (tiny) setSel(new Set()); else setSel(sel);
    }
    invalidate();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', () => { override.clear(); linking = null; tip.hidden = true; dropInto = null; drag = null; invalidate(); });

  /**
   * Move a part into another container: in the model it moves to that container's block.
   * Only when no connectors run to it (they would no longer make sense).
   * @param {string} key @param {string} into @param {Record<string, Rect>} patch
   */
  function reparent(key, into, patch) {
    const pid = /** @type {string} */ (elementOf(key));
    const target = blockOf(into);
    const p = model.get(pid);
    if (!p || !target) { toast('That part has no type, so it cannot contain parts', true); return; }
    if (model.connectorsTouching(pid).length) { toast(`${p.name} has connectors. Delete them first, then move it.`, true); commit('Move', growToFit(patch)); return; }
    if (!model.canMove(pid, target)) { toast(`${p.name} cannot go inside ${model.get(target)?.name}`, true); return; }
    const oldPrefix = key, newPrefix = into === FRAME ? pid : `${into}/${pid}`;
    /** @type {Record<string, Rect | null>} */
    const re = {};
    for (const k of subtree(key)) {
      const r = patch[k] || layout()[k];
      re[k] = null;
      re[newPrefix + k.slice(oldPrefix.length)] = r;
    }
    if (ctx.edit(`Move ${p.name} into ${model.get(target)?.name}`, (tx) => { tx.move(pid, target); tx.place(diagramId, growToFit(re)); })) {
      setSel(new Set([newPrefix]));
      toast(`Moved ${p.name} into ${model.get(target)?.name} in the model. ${formatKeys('Mod+Z')} to undo.`);
    }
  }

  stage.addEventListener('dblclick', (ev) => {
    const t = /** @type {Element} */ (ev.target);
    const k = /** @type {HTMLElement | null} */ (t.closest('.port') || t.closest('.part'));
    if (k?.dataset.key) startRename(k.dataset.key);
  });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const b = stage.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomTo(cam.k * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025)), { x: ev.clientX - b.left, y: ev.clientY - b.top });
    else { cam.x += (ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) / cam.k; cam.y += (ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) / cam.k; invalidate(); }
  }, { passive: false });

  // drop from the model browser
  stage.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('application/x-loom-id')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; stage.classList.add('drop-target'); } });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop-target'));
  stage.addEventListener('drop', (ev) => {
    stage.classList.remove('drop-target');
    const id = ev.dataTransfer?.getData('application/x-loom-id');
    if (!id) return;
    ev.preventDefault();
    const e = model.get(id);
    const w = eventWorld(ev);
    const sc = scene();
    if (!e || !sc) return;
    const container = containerAt(sc, w);
    if (e.kind === 'partDef') { if (!blockOf(container)) { toast('That part has no type, so it cannot contain parts', true); return; } addPartAt(container, id, w); return; }
    if (e.kind === 'interfaceDef') {
      const port = sc.ports.find((p) => hit(p.rect, w, 8));
      if (port && ctx.edit('Set port type', (tx) => tx.setProps(port.port.id, { type: id }))) toast(`${port.port.name} is now typed by ${e.name}`);
      else toast('Drop an interface block on a port to type it');
      return;
    }
    if (e.kind === 'part') {
      // show an existing part where it belongs
      const homes = [FRAME, ...sc.parts.map((p) => p.key)].filter((k) => blockOf(k) === e.owner);
      const home = homes.includes(container) ? container : homes[0];
      if (!home) { toast(`${e.name} is not part of anything on this diagram`, true); return; }
      const key = home === FRAME ? id : `${home}/${id}`;
      if (layout()[key]) { setSel(new Set([key])); return; }
      if (commit('Show on diagram', growToFit(placementFor(home, id, w)))) setSel(new Set([key]));
      return;
    }
    toast(`An internal block diagram shows parts and ports. Drop a block to add a part typed by it.`, true);
  });
  /** @param {string} container @param {string} typeId @param {Pt} at */
  function addPartAt(container, typeId, at) {
    const into = /** @type {string} */ (blockOf(container));
    if (typeId === into) { toast('A block cannot contain itself', true); return; }
    let partId = '';
    const tn = model.get(typeId)?.name || 'part';
    if (ctx.edit(`Add ${tn}`, (tx) => {
      const taken = new Set(model.children(into).map((x) => x.name));
      let name = roleName(tn); for (let i = 2; taken.has(name); i++) name = `${roleName(tn)}${i}`;
      partId = tx.create('part', { owner: into, name, props: { type: typeId } });
      tx.place(diagramId, growToFit(placementFor(container, partId, at)));
    })) setSel(new Set([container === FRAME ? partId : `${container}/${partId}`]));
  }

  // ---------- rename in place ----------
  /** @param {string} key */
  function startRename(key) {
    const id = elementOf(key);
    const e = id ? model.get(id) : null;
    if (!e || key === FRAME) return;
    const r = rectOf(key);
    const input = h('input', { class: 'drename', type: 'text', value: e.name, 'aria-label': 'Name', maxlength: 500 });
    Object.assign(input.style, { left: `${(r.x - cam.x) * cam.k + (key.includes('#') ? 16 : 6)}px`, top: `${(r.y + (key.includes('#') ? -6 : 8) - cam.y) * cam.k}px`, width: `${Math.max(140, (key.includes('#') ? 160 : r.w - 12) * cam.k)}px` });
    let done = false;
    const finish = (/** @type {boolean} */ ok) => { if (done) return; done = true; input.remove(); const v = input.value.trim(); if (ok && v && v !== e.name) ctx.edit('Rename', (tx) => tx.rename(e.id, v)); stage.focus(); };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    stage.append(input); input.focus(); input.select();
  }

  // ---------- keyboard ----------
  stage.addEventListener('keydown', (ev) => {
    if (ev.target !== stage) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.key === ' ') { spaceDown = true; stage.classList.add('pan-ready'); stop(); return; }
    if (ev.key === 'Escape' && linking) { linking = null; tip.hidden = true; drag = null; stop(); invalidate(); return; }
    if (ev.key.startsWith('Arrow') && sel.size) {
      const step = ev.shiftKey ? GRID : 1;
      const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0, dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
      /** @type {Record<string, Rect>} */
      const patch = {};
      for (const k of [...sel].flatMap((x) => x.includes('#') ? [x] : [x, ...subtree(x)])) { const r = layout()[k]; if (r) patch[k] = { ...r, x: r.x + dx, y: r.y + dy }; }
      commit('Nudge', growToFit(patch)); stop(); return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (sel.size) { stop(); if (mod) deleteFromModel(); else removeFromView(); return; }
      const e = ctx.selected() ? model.get(/** @type {string} */ (ctx.selected())) : null;
      if (e?.kind === 'connector') { stop(); if (ctx.edit('Delete connector', (tx) => tx.remove(e.id))) toast(`Deleted the connector. ${formatKeys('Mod+Z')} to undo.`); return; }
    }
    if (mod && ev.key.toLowerCase() === 'a') { stop(); setSel(new Set((scene()?.parts || []).map((p) => p.key))); return; }
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
  document.fonts?.ready.then(() => { resetMeasureCache(); cache.key = ''; invalidate(); });
  const unsub = model.subscribe(() => invalidate());
  invalidate();

  return {
    el, render, invalidate, fit, syncSelection, tidy,
    focus: () => stage.focus(),
    zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(1 / 1.25),
    addRelated: showMissing, removeFromView, deleteFromModel,
    selection: () => [...sel],
    stats: () => ({ lastRenderMs, parts: scene()?.parts.length || 0 }),
    /** @param {Partial<{ x: number, y: number, k: number }>} c */
    setCamera(c) { Object.assign(cam, c); render(); },
    dispose() { ro?.disconnect(); cancelAnimationFrame(raf); unsub(); },
  };
}
