// A sample model's view, alone on a page, for others to show in a frame (the Pteronautics site).
//
//   embed.html?sample=cubesat&view=v:home            the Systems V
//   embed.html?sample=cubesat&view=Energy budget     a diagram, by name
//   &theme=dark|light   &notation=sysml|v2|guided
//
// It is read-only (pan, zoom and select; nothing is saved), follows the theme the page in
// front sends it ({ theme: 'dark' } by postMessage), and builds the model fresh each time.
import { createModel } from './model/model.js';
import { sampleById, SAMPLES } from './model/samples.js';
import { createDiagramView } from './canvas/view.js';
import { createIbdView } from './canvas/ibdview.js';
import { createSequenceView } from './canvas/sdview.js';
import { createVHomeView } from './views/vhome.js';
import { applyTheme } from './ui/dom.js';

const q = new URLSearchParams(location.search);
/** @param {string | null} t */
const theme = (t) => { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; applyTheme(); };
theme(q.get('theme'));
addEventListener('message', (ev) => { if (ev.origin === location.origin && ev.data && typeof ev.data.theme === 'string') theme(ev.data.theme); });

const model = createModel();
(sampleById(q.get('sample') || '') || SAMPLES[0]).build(model);
const want = q.get('view') || 'v:home';
const notation = /** @type {any} */ (['sysml', 'v2', 'guided'].includes(q.get('notation') || '') ? q.get('notation') : 'sysml');
const diagram = want === 'v:home' ? null : model.all().find((e) => e.name === want && e.layout) || null;
/** @type {string | null} */
let selected = null;
/** @type {any} */
let view = null;
const ctx = {
  model, diagramId: diagram ? diagram.id : 'v:home', notation: () => notation,
  selected: () => selected, select: (/** @type {string | null} */ id) => { selected = id; view?.syncSelection?.(id); },
  edit: () => false, newProps: () => undefined,
  create() {}, openTrace() {}, openTable() {}, openMatrix() {},
};
view = !diagram ? createVHomeView(/** @type {any} */ (ctx))
  : diagram.kind === 'ibd' ? createIbdView(/** @type {any} */ (ctx))
    : diagram.kind === 'sd' ? createSequenceView(/** @type {any} */ (ctx))
      : createDiagramView(/** @type {any} */ (ctx));
const host = /** @type {HTMLElement} */ (document.getElementById('embed'));
host.append(view.el);
view.invalidate?.();
// a diagram fits the frame once the frame has its size (and again when it changes)
if (diagram && view.fit) {
  const refit = () => requestAnimationFrame(() => requestAnimationFrame(() => view.fit()));
  refit(); addEventListener('resize', refit);
}
// the Systems V is laid out for a wide window: scale it to the frame's width and let it scroll
if (!diagram) {
  host.classList.add('scroll');
  const fit = () => {
    view.el.style.zoom = '1';
    const sc = /** @type {HTMLElement} */ (view.el.querySelector('.vscroll') || view.el);
    const k = Math.min(1, sc.clientWidth / Math.max(1, sc.scrollWidth));
    view.el.style.zoom = String(Math.round(k * 1000) / 1000);
  };
  const later = () => requestAnimationFrame(() => requestAnimationFrame(fit));
  later(); addEventListener('resize', later);
  setTimeout(fit, 400);
}
