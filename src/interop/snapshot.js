// A diagram as a standalone SVG, for documents. The diagram is drawn by the same canvas as in
// the app, offscreen and in the light theme, then copied with every style written inline, so
// the picture looks the same anywhere (a browser, a PDF, a Word document) without Loom's CSS.
import { createDiagramView } from '../canvas/view.js';
import { createIbdView } from '../canvas/ibdview.js';
import { createSequenceView } from '../canvas/sdview.js';

/** @typedef {import('../model/model.js').Model} Model */

/** The light theme's tokens (css/loom.css), set on the offscreen host so a dark app still draws light pictures. */
const LIGHT = {
  '--bg': '#f2f4f7', '--bg-elev': '#ffffff', '--bg-sunk': '#eceef3', '--stage': '#ffffff', '--border': '#e0e4ea', '--border-strong': '#c9cfd9',
  '--text': '#141820', '--text-2': '#4a5261', '--text-3': '#5f6878', '--accent': '#1677b3', '--on-accent': '#ffffff', '--accent-soft': 'rgba(22, 119, 179, 0.11)',
  '--hl': '#d9483b', '--hl-soft': 'rgba(217, 72, 59, 0.11)', '--good': '#1a7f37', '--warn': '#b26a00', '--bad': '#cf222e', '--lam': '#12a594', '--turb': '#8b5cf6',
  '--sep': '#c2255c', '--upper': '#1677b3', '--lower': '#d9483b', '--wake': '#6b7280', '--glow': 'rgba(22, 119, 179, 0.10)',
  '--layer-r': '#d9483b', '--layer-f': '#12a594', '--layer-l': '#8b5cf6', '--layer-p': '#1677b3', 'color-scheme': 'light',
};
/** Style properties a picture needs. */
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'display'];
/** Shapes that only catch the mouse. */
const HIT = '.hit, .e-hit, .c-hit, .sd-hit, .sd-life-hit, .handle, .link-handle, .pbadge, .rubber, .lasso, .coll';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/**
 * Draw a diagram as an SVG string, or null when the kind has no picture (tables, matrices).
 * @param {Model} m @param {string} id @param {import('../model/metamodel.js').Notation} notation
 * @returns {Promise<{ svg: string, w: number, h: number } | null>}
 */
export async function diagramSvg(m, id, notation) {
  const d = m.get(id);
  if (!d || d.kind === 'table' || d.kind === 'matrix' || d.kind === 'gtable') return null;
  const nodes = Object.values(d.layout?.nodes || {});
  if (d.kind !== 'sd' && !nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of nodes) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  const pad = 80;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', overflow: 'hidden', pointerEvents: 'none', display: 'flex', flexDirection: 'column' });
  for (const [k, v] of Object.entries(LIGHT)) host.style.setProperty(k, v);
  host.style.width = `${Math.min(9000, Math.max(600, (x1 - x0) + pad * 2 + 400 || 1200))}px`;
  host.style.height = `${Math.min(9000, Math.max(500, (y1 - y0) + pad * 2 + 900 || 900))}px`;
  const ctx = { model: m, diagramId: id, notation: () => notation, selected: () => null, select() {}, edit: () => false, offscreen: true, newProps: () => undefined };
  const v = /** @type {any} */ (d.kind === 'ibd' ? createIbdView(ctx) : d.kind === 'sd' ? createSequenceView(ctx) : createDiagramView(/** @type {any} */ (ctx)));
  host.append(v.el);
  document.body.append(host);
  try {
    await frame();
    if (v.setCamera && Number.isFinite(x0)) v.setCamera({ x: x0 - pad, y: y0 - pad, k: 1 }); else v.render?.();
    await frame(); await frame();
    if (v.setCamera && Number.isFinite(x0)) v.setCamera({ x: x0 - pad, y: y0 - pad, k: 1 }); else v.render?.();
    const svg = /** @type {SVGSVGElement | null} */ (v.el.querySelector('svg.dsvg, svg.sdsvg'));
    if (!svg) return null;
    const cam = /** @type {SVGGElement | null} */ (svg.querySelector(':scope > g.cam'));
    const clone = /** @type {SVGSVGElement} */ (inline(svg));
    let box;
    if (cam) {
      // content bounds in diagram coordinates, from what is drawn (boxes grow to fit their text)
      const pick = /** @type {SVGGraphicsElement[]} */ ([...cam.querySelectorAll('g.node, g.part, g.frame, g.port, path.edge, path.conn, text, polygon')]);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const el of pick) {
        let b; try { b = el.getBBox(); } catch { continue; }
        if (!b.width && !b.height) continue;
        // a node group's box is in its own coordinates: add its translation
        const t = el.transform?.baseVal?.consolidate?.()?.matrix;
        const ox = t ? t.e : 0, oy = t ? t.f : 0;
        bx0 = Math.min(bx0, b.x + ox); by0 = Math.min(by0, b.y + oy); bx1 = Math.max(bx1, b.x + ox + b.width); by1 = Math.max(by1, b.y + oy + b.height);
      }
      if (!Number.isFinite(bx0)) return null;
      box = { x: bx0 - 16, y: by0 - 16, w: bx1 - bx0 + 32, h: by1 - by0 + 32 };
      const cg = clone.querySelector(':scope > g.cam');
      cg?.removeAttribute('transform');
    } else {
      const vb = (svg.getAttribute('viewBox') || '0 0 800 600').split(/\s+/).map(Number);
      box = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    }
    clone.setAttribute('viewBox', `${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}`);
    clone.setAttribute('width', String(round(box.w)));
    clone.setAttribute('height', String(round(box.h)));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('role', 'img');
    clone.setAttribute('aria-label', `${d.name}`);
    clone.removeAttribute('class');
    clone.removeAttribute('aria-hidden');
    clone.setAttribute('style', 'background:#ffffff');
    return { svg: new XMLSerializer().serializeToString(clone), w: round(box.w), h: round(box.h) };
  } finally {
    v.dispose?.();
    host.remove();
  }
}

const round = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/** Copy an SVG with its computed styles written inline, leaving out what only catches the mouse. @param {SVGElement} src */
function inline(src) {
  const out = /** @type {SVGElement} */ (src.cloneNode(true));
  const a = [src, ...src.querySelectorAll('*')], b = [out, ...out.querySelectorAll('*')];
  /** @type {Element[]} */
  const drop = [];
  a.forEach((el, i) => {
    const c = b[i];
    if (!(el instanceof SVGElement)) return;
    if (el.matches(HIT)) { drop.push(c); return; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') { drop.push(c); return; }
    const parts = [];
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v || p === 'display') continue;
      parts.push(`${p}:${v}`);
    }
    c.setAttribute('style', parts.join(';'));
    c.removeAttribute('class');
    for (const at of [...c.attributes]) if (at.name.startsWith('data-')) c.removeAttribute(at.name);
  });
  for (const x of drop) x.remove();
  return out;
}
