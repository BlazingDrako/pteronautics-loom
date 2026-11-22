// One diagram as a picture to paste into slides, mail or a wiki: SVG (sharp at any size) or
// PNG at 1×, 2× or 4×, optionally inside a SysML frame (the "bdd [Package] Name" header) so
// the picture says what it is on its own. Fonts are embedded, so it looks the same anywhere.
import { diagramSvg } from './snapshot.js';
import { loadFonts } from './docs.js';
import { kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */

/** The largest PNG browsers draw reliably (a side, and the whole area). */
export const PNG_MAX_SIDE = 16000, PNG_MAX_AREA = 120e6;

/** The frame's header: the diagram kind, what it is of, and its name (SysML 1.x style). @param {Model} m @param {string} id */
export function frameHeader(m, id) {
  const d = m.get(id);
  if (!d) return '';
  const owner = d.owner ? m.get(d.owner) : null;
  // SysML 1.x names the frame's context by its kind, in lower case: [block], [package], [activity]
  const ctxKind = owner ? kindName(owner.kind, 'sysml').toLowerCase() : '';
  return `${d.kind} [${ctxKind}] ${owner ? owner.name + ' ' : ''}[${d.name}]`.replace(/\s+/g, ' ').trim();
}

/**
 * Wrap an SVG string in a SysML frame: a border with a header tab at the top left.
 * Pure string work, so it can be tested without a browser layout.
 * @param {string} svg @param {number} w @param {number} h @param {string} header
 * @returns {{ svg: string, w: number, h: number }}
 */
export function addFrame(svg, w, h, header) {
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
  if (!m) return { svg, w, h };
  const [x, y] = [Number(m[1]), Number(m[2])];
  const pad = 14, tabH = 26;
  // a rough width for the header (Space Grotesk at 12 px is about 0.58 em per character)
  const tabW = Math.min(w + pad * 2, Math.ceil(header.length * 7 + 28));
  const nx = x - pad, ny = y - pad - tabH, nw = w + pad * 2, nh = h + pad * 2 + tabH;
  const esc = header.replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const frame = `<g class="loom-frame"><rect x="${nx + 0.5}" y="${ny + 0.5}" width="${nw - 1}" height="${nh - 1}" fill="none" stroke="#4a5261" stroke-width="1"/>`
    + `<path d="M${nx + 0.5} ${ny + tabH} H${nx + tabW - 8} L${nx + tabW} ${ny + tabH - 8} V${ny + 0.5}" fill="none" stroke="#4a5261" stroke-width="1"/>`
    + `<text x="${nx + 9}" y="${ny + 17}" style="font-family:'Space Grotesk',system-ui,sans-serif;font-size:12px;font-weight:600;fill:#141820">${esc}</text></g>`;
  const out = svg
    .replace(/viewBox="[^"]*"/, `viewBox="${nx} ${ny} ${nw} ${nh}"`)
    .replace(/(<svg[^>]*?)\swidth="[\d.]+"/, `$1 width="${nw}"`)
    .replace(/(<svg[^>]*?)\sheight="[\d.]+"/, `$1 height="${nh}"`)
    .replace(/<\/svg>\s*$/, `${frame}</svg>`);
  return { svg: out, w: nw, h: nh };
}

/** Put Loom's fonts inside the SVG so it draws the same where Loom's fonts are not installed. @param {string} svg @param {{ sans?: string, mono?: string }} fonts */
export function embedFonts(svg, fonts) {
  const face = (/** @type {string} */ fam, /** @type {string | undefined} */ b64) => (b64 ? `@font-face{font-family:'${fam}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:300 700;}` : '');
  const css = face('Space Grotesk', fonts.sans) + face('JetBrains Mono', fonts.mono);
  if (!css) return svg;
  return svg.replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
}

/** The PNG scale that fits browsers' canvas limits (it can be less than asked for). @param {number} w @param {number} h @param {number} scale */
export function safeScale(w, h, scale) {
  let k = scale;
  k = Math.min(k, PNG_MAX_SIDE / Math.max(w, 1), PNG_MAX_SIDE / Math.max(h, 1));
  k = Math.min(k, Math.sqrt(PNG_MAX_AREA / Math.max(w * h, 1)));
  return Math.max(0.1, Math.floor(k * 100) / 100);
}

/**
 * A diagram as a picture.
 * @param {Model} m @param {string} id @param {import('../model/metamodel.js').Notation} notation
 * @param {{ frame?: boolean }} [o]
 * @returns {Promise<{ svg: string, w: number, h: number } | null>}
 */
export async function diagramPicture(m, id, notation, o = {}) {
  const pic = await diagramSvg(m, id, notation);
  if (!pic) return null;
  let out = pic;
  // an internal block diagram draws its own frame (its block's boundary) already
  if (o.frame && m.get(id)?.kind !== 'ibd') out = addFrame(out.svg, out.w, out.h, frameHeader(m, id));
  return { ...out, svg: embedFonts(out.svg, await loadFonts()) };
}

/** Draw an SVG picture into a PNG. @param {{ svg: string, w: number, h: number }} pic @param {number} scale @returns {Promise<{ blob: Blob, scale: number }>} */
export async function toPng(pic, scale) {
  const k = safeScale(pic.w, pic.h, scale);
  const url = URL.createObjectURL(new Blob([pic.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture could not be drawn')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(pic.w * k); c.height = Math.round(pic.h * k);
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The picture is too big to draw'))), 'image/png'));
    return { blob: /** @type {Blob} */ (blob), scale: k };
  } finally { URL.revokeObjectURL(url); }
}

/** A file name for a diagram's picture. @param {string} name @param {string} ext */
export const pictureName = (name, ext) => `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'diagram'}.${ext}`;
