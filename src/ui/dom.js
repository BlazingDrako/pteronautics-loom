// Small DOM helpers (no framework), the same shape as Pteronautics Works' src/ui/dom.js.
const SVG_NS = 'http://www.w3.org/2000/svg';

/** @typedef {Record<string, any> | null | undefined} Attrs */
/** @typedef {Node | string | number | boolean | null | undefined | Kid[]} Kid */

/** @param {Element} el @param {Attrs} attrs */
function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      const st = /** @type {HTMLElement} */ (el).style;
      for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) st.setProperty(p, String(val)); else /** @type {any} */ (st)[p] = val; }
    }
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
/** @param {Element} el @param {Kid[]} kids */
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
/**
 * Create an HTML element.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag @param {Attrs} [attrs] @param {...Kid} kids
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs, ...kids) { const el = document.createElement(tag); apply(el, attrs); append(el, kids); return el; }
/**
 * Create an SVG element.
 * @param {string} tag @param {Attrs} [attrs] @param {...Kid} kids
 * @returns {SVGElement}
 */
export function s(tag, attrs, ...kids) { const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag)); apply(el, attrs); append(el, kids); return el; }

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** Show a short message at the bottom of the window. @param {string} msg @param {boolean} [err] */
export function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), err ? 6000 : 2600);
}

// Line icons (stroke = currentColor)
/** @type {Record<string, string>} */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3 11 L12 4 L21 11"/><path d="M6 9.5 V20 H18 V9.5"/>',
  diagram: '<rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/><path d="M10 7 H17 V14"/>',
  trace: '<circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.5 7.5 L10.5 10.5 M13.5 13.5 L17.5 16.5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10 H21 M9 10 V20"/>',
  matrix: '<path d="M4 4 H20 V20 H4 Z M4 9.3 H20 M4 14.6 H20 M9.3 4 V20 M14.6 4 V20"/>',
  book: '<path d="M4 5 a2 2 0 0 1 2-2 H19 V19 H6 a2 2 0 0 0-2 2 Z"/><path d="M4 19 V5"/>',
  plug: '<path d="M9 3 V8 M15 3 V8 M6 8 H18 V11 a6 6 0 0 1-12 0 Z M12 17 V21"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4 V20"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10 H6.01 M10 10 H10.01 M14 10 H14.01 M18 10 H18.01 M7 14 H17"/>',
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M4.9 4.9 L6.3 6.3 M17.7 17.7 L19.1 19.1 M4.9 19.1 L6.3 17.7 M17.7 6.3 L19.1 4.9"/>',
  moon: '<path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  upload: '<path d="M12 16 V4 M7 9 L12 4 L17 9 M4 20 H20"/>',
  x: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  undo: '<path d="M9 14 L4 9 L9 4"/><path d="M4 9 H14 a6 6 0 0 1 0 12 H11"/>',
  redo: '<path d="M15 14 L20 9 L15 4"/><path d="M20 9 H10 a6 6 0 0 0 0 12 H13"/>',
  chevRight: '<path d="M9 6 L15 12 L9 18"/>',
  chevDown: '<path d="M6 9 L12 15 L18 9"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  vee: '<path d="M3 5 L12 19 L21 5"/><path d="M7.5 5 H3 M21 5 H16.5"/>',
  related: '<rect x="8" y="3" width="8" height="5" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><path d="M12 8 V12 M6.5 16 V12 H17.5 V16"/>',
  layout: '<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="8.5" y="16" width="7" height="5" rx="1"/><path d="M6.5 8 V12 H17.5 V8 M12 12 V16"/>',
  eye: '<path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/>',
  minus: '<path d="M5 12 H19"/>',
  download: '<path d="M12 4 V16 M7 11 L12 16 L17 11 M4 20 H20"/>',
  filter: '<path d="M4 5 H20 L14 12.5 V19 L10 17 V12.5 Z"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4 V20 M15 4 V20"/>',
  hash: '<path d="M5 9 H19 M5 15 H19 M10 4 L8 20 M16 4 L14 20"/>',
  check: '<path d="M5 12.5 L10 17 L19 7"/>',
  folder: '<path d="M3 7 a2 2 0 0 1 2-2 H9.5 L11.5 7.5 H19 a2 2 0 0 1 2 2 V17 a2 2 0 0 1-2 2 H5 a2 2 0 0 1-2-2 Z"/>',
  code: '<path d="M8.5 7 L3.5 12 L8.5 17 M15.5 7 L20.5 12 L15.5 17"/>',
  zip: '<path d="M6 3 H14 L19 8 V21 H6 Z"/><path d="M11 3 V5 M11 7 V9 M11 11 V13"/>',
    req: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8 H16 M8 12 H16 M8 16 H12"/>',
  fit: '<path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15"/>',
  command: '<path d="M9 6 a3 3 0 1 0-3 3 H18 a3 3 0 1 0-3-3 V18 a3 3 0 1 0 3-3 H6 a3 3 0 1 0 3 3 Z"/>',
};
/** @param {string} name @returns {SVGElement} */
export function icon(name) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.innerHTML = ICONS[name] || '';
  return el;
}

// The Pteronautics mark: the same drawing as Atlas and Works, colored by the theme
export const BRAND_SVG = `<svg viewBox="0 4 100 100" aria-hidden="true">
<path class="bm-fill" d="M50 10 L54 24 L53 36 C62 35 70 33 78 31 C86 36 92 44 96 54 C80 52 68 56 60 66 L56 76 L50 70 L44 76 L40 66 C32 56 20 52 4 54 C8 44 14 36 22 31 C30 33 38 35 47 36 L46 24 Z"/>
<path class="bm-line" d="M50 10 L54 24 L53 36 C62 35 70 33 78 31 C86 36 92 44 96 54 C80 52 68 56 60 66 L56 76 L50 70 L44 76 L40 66 C32 56 20 52 4 54 C8 44 14 36 22 31 C30 33 38 35 47 36 L46 24 Z"/>
<path class="bm-line" d="M50 72 L50 84"/>
<path class="bm-flame" d="M50 82 L54 89 L50 97 L46 89 Z"/></svg>`;
export function brandMark() { const el = h('span', { class: 'brand-mark' }); el.innerHTML = BRAND_SVG; return el; }
export function brand() {
  return h('a', { class: 'brand', href: '#/', 'aria-label': 'Pteronautics Loom home' }, brandMark(),
    h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Loom')));
}

// ---------- theme (same behaviour as Atlas and Works: system default, or a stored choice) ----------
const THEME_KEY = 'loom-theme';
/** @returns {'light' | 'dark'} */
export function resolvedTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme() { document.documentElement.dataset.resolvedTheme = resolvedTheme(); dispatchEvent(new Event('themechange')); }
export function initTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t) document.documentElement.dataset.theme = t; } catch { /* storage blocked */ }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}
export function toggleTheme() {
  const t = resolvedTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
  applyTheme();
}

/** True on Apple platforms, where shortcuts use ⌘ instead of Ctrl. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Format a shortcut like "Mod+K" for this platform. @param {string} combo */
export function formatKeys(combo) {
  return combo.split('+').map((k) => k === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : k === 'Shift' ? (IS_MAC ? '⇧' : 'Shift') : k === 'Alt' ? (IS_MAC ? '⌥' : 'Alt') : k).join(IS_MAC ? '' : '+');
}
