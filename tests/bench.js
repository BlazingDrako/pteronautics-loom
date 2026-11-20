// Performance benchmarks against the budgets in PLAN.md section 6. Open tests/bench.html.
import { createModel } from '../src/model/model.js';
import { snapshot, restore } from '../src/model/serialize.js';
import { createDiagramView } from '../src/canvas/view.js';
import { edgesFor } from '../src/canvas/bdd.js';
import { routeAll } from '../src/canvas/route.js';

/** @typedef {{ name: string, ms: number, budget: number, note?: string }} Row */

/** @param {() => void} fn */
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
/** @param {number[]} xs */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** Wait a frame (or 50 ms when the tab is hidden and frames are paused). */
const frame = () => new Promise((r) => { const t = setTimeout(() => r(null), 50); requestAnimationFrame(() => { clearTimeout(t); r(null); }); });

/** @param {(row: Row) => void} report */
export async function runBench(report) {
  // ---------- 1. a 50,000-element model ----------
  const m = createModel({ name: 'Bench' });
  const L = m.layers()[2].id;
  let made = 0;
  const tCreate = time(() => m.transact('Generate', (tx) => {
    for (let p = 0; p < 500 && made < 50000; p++) {
      const pkg = tx.create('package', { owner: L, name: `Package ${p}` }); made++;
      for (let b = 0; b < 33 && made < 50000; b++) {
        const blk = tx.create('partDef', { owner: pkg, name: `Block ${p}.${b}` }); made++;
        tx.create('attribute', { owner: blk, name: 'mass', props: { value: '1', unit: 'kg' } }); made++;
        tx.create('port', { owner: blk, name: 'p' }); made++;
      }
    }
  }));
  report({ name: `Create ${m.count().toLocaleString()} elements in one transaction`, ms: tCreate, budget: 2000 });
  let snap = /** @type {any} */ (null), text = '';
  const tSave = time(() => { snap = snapshot(m); text = JSON.stringify(snap); });
  report({ name: `Save the model (${(text.length / 1e6).toFixed(1)} MB of JSON)`, ms: tSave, budget: 1000 });
  let opened = /** @type {any} */ (null);
  const tOpen = time(() => { opened = restore(JSON.parse(text)); });
  report({ name: `Open the model: parse, check and index ${opened.count().toLocaleString()} elements`, ms: tOpen, budget: 1000 });
  const tEdit = time(() => opened.transact('Rename', (/** @type {any} */ tx) => tx.rename(opened.byKind('partDef')[100].id, 'Renamed')));
  report({ name: 'One edit in the large model (transaction + change event)', ms: tEdit, budget: 16 });

  // ---------- 2. a 2,000-block diagram ----------
  const dm = createModel();
  const DL = dm.layers()[2].id;
  /** @type {string} */
  let did = '';
  dm.transact('Diagram', (tx) => {
    did = tx.create('bdd', { owner: DL, name: 'Big' });
    /** @type {string[]} */
    const ids = [];
    for (let i = 0; i < 2000; i++) ids.push(tx.create('partDef', { owner: DL, name: `Block ${i}` }));
    // a tree: each block (after the first) is a part of an earlier one
    for (let i = 1; i < 2000; i++) tx.create('part', { owner: ids[Math.floor((i - 1) / 4)], name: `p${i}`, props: { type: ids[i] } });
    /** @type {Record<string, any>} */
    const patch = {};
    ids.forEach((id, i) => { patch[id] = { x: (i % 50) * 240, y: Math.floor(i / 50) * 200, w: 200, h: 110 }; });
    tx.place(did, patch);
  });
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '1200px', height: '800px', opacity: '0', pointerEvents: 'none' });
  document.body.append(host);
  const view = createDiagramView({ model: dm, diagramId: did, notation: () => 'sysml', selected: () => null, select: () => {}, edit: () => true });
  host.append(view.el);
  await frame(); await frame();

  view.setCamera({ x: -40, y: -40, k: 0.1 });
  const tAll = view.stats().lastRenderMs;
  report({ name: `Draw all 2,000 blocks and ${edgesFor(dm, new Set(Object.keys(/** @type {any} */ (dm.get(did)).layout.nodes))).length.toLocaleString()} lines at 10% zoom (first draw)`, ms: tAll, budget: 250, note: 'one-off cost; panning after it is cheap' });
  /** @type {number[]} */
  const pansFar = [];
  for (let i = 0; i < 20; i++) { view.setCamera({ x: -40 + i * 30, y: -40 + i * 10, k: 0.1 }); pansFar.push(view.stats().lastRenderMs); }
  report({ name: 'Pan at 10% zoom, every block visible (median frame)', ms: median(pansFar), budget: 16 });

  view.setCamera({ x: 0, y: 0, k: 1 });
  /** @type {number[]} */
  const pans = [];
  for (let i = 0; i < 40; i++) { view.setCamera({ x: i * 37, y: i * 23, k: 1 }); pans.push(view.stats().lastRenderMs); }
  report({ name: `Pan at 100% zoom (median frame, ${view.stats().built} boxes drawn of 2,000)`, ms: median(pans), budget: 16 });
  /** @type {number[]} */
  const zooms = [];
  for (let i = 0; i < 20; i++) { view.setCamera({ x: 0, y: 0, k: 0.6 + (i % 5) * 0.15 }); zooms.push(view.stats().lastRenderMs); }
  report({ name: 'Zoom in and out (median frame)', ms: median(zooms), budget: 16 });
  /** @type {number[]} */
  const edits = [];
  const first = /** @type {any} */ (dm.byKind('partDef')[0]);
  for (let i = 0; i < 10; i++) {
    edits.push(time(() => { dm.transact('Rename', (tx) => tx.rename(first.id, `Root ${i}`)); view.render(); }));
  }
  report({ name: 'Edit → repaint on the 2,000-block diagram (median)', ms: median(edits), budget: 16 });
  /** @type {number[]} */
  const moves = [];
  const mover = /** @type {any} */ (dm.byKind('partDef')[60]);
  for (let i = 0; i < 10; i++) {
    moves.push(time(() => { dm.transact('Move', (tx) => tx.place(did, { [mover.id]: { x: 300 + i * 20, y: 900, w: 200, h: 110 } })); view.render(); }));
  }
  report({ name: 'Move a block on the 2,000-block diagram → repaint (median)', ms: median(moves), budget: 16 });

  // ---------- 3. moving a block with 40 lines ----------
  const rects = new Map();
  rects.set('hub', { x: 2000, y: 0, w: 220, h: 120 });
  /** @type {any[]} */
  const edges = [];
  for (let i = 0; i < 40; i++) { rects.set(`n${i}`, { x: i * 160, y: 400 + (i % 3) * 140, w: 140, h: 70 }); edges.push({ id: `e${i}`, kind: 'composition', from: 'hub', to: `n${i}`, element: `e${i}` }); }
  /** @type {number[]} */
  const routes = [];
  for (let i = 0; i < 20; i++) { rects.set('hub', { x: 1500 + i * 40, y: i * 5, w: 220, h: 120 }); routes.push(time(() => routeAll(rects, edges))); }
  report({ name: 'Re-route after moving a block with 40 connectors (median)', ms: median(routes), budget: 16 });

  view.dispose(); host.remove();
}
