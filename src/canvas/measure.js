// Text measurement for diagram shapes, so text always fits inside its box: names and rows
// that are too long are cut with an ellipsis instead of crossing the border.
// Uses a canvas 2D context when there is one; otherwise an average-width estimate (tests, workers).

/** Fonts used on diagrams; the SVG styles in css/loom.css use the same ones. */
export const FONTS = {
  name: '600 13.5px "Space Grotesk", system-ui, sans-serif',
  stereo: '400 10.5px "Space Grotesk", system-ui, sans-serif',
  title: '600 9.5px "Space Grotesk", system-ui, sans-serif',
  row: '400 11px "JetBrains Mono", ui-monospace, monospace',
  label: '400 10.5px "JetBrains Mono", ui-monospace, monospace',
};

/** @type {CanvasRenderingContext2D | null | undefined} */
let ctx;
/** @type {Map<string, number>} */
const cache = new Map();

function context() {
  if (ctx !== undefined) return ctx;
  try { ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { ctx = null; }
  return ctx;
}

/** Forget measurements (call after web fonts finish loading). */
export function resetMeasureCache() { cache.clear(); }

/** Width of `text` in `font`, in CSS pixels. @param {string} text @param {string} font */
export function textWidth(text, font) {
  const key = font + '\u0000' + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = context();
  let w;
  if (c) { c.font = font; w = c.measureText(text).width; }
  else { const size = parseFloat((font.match(/(\d+(?:\.\d+)?)px/) || [])[1] || '12'); w = text.length * size * (font.includes('Mono') ? 0.6 : 0.55); }
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
}

/**
 * The longest prefix of `text` (plus "…") that fits in `maxWidth`.
 * @param {string} text @param {number} maxWidth @param {string} font
 */
export function ellipsize(text, maxWidth, font) {
  if (textWidth(text, font) <= maxWidth) return text;
  if (maxWidth <= textWidth('…', font)) return '';
  let lo = 0, hi = text.length;
  while (lo < hi) { // binary search on length
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid).trimEnd() + '…', font) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}
