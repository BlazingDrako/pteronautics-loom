// Performance benchmarks against the budgets in PLAN.md section 6. Open tests/bench.html.
import { createModel } from '../src/model/model.js';
import { snapshot, restore } from '../src/model/serialize.js';
import { createDiagramView } from '../src/canvas/view.js';
import { edgesFor } from '../src/canvas/bdd.js';
import { routeAll } from '../src/canvas/route.js';
import { coverage } from '../src/model/trace.js';
import { createTableView } from '../src/views/table.js';
import { createMatrixView } from '../src/views/matrix.js';
import { printPackage } from '../src/text/printer.js';
import { parseLayer, buildSnapshot, applyLayerText } from '../src/text/build.js';
import { highlight } from '../src/ui/textpane.js';
import { projectFiles, modelFromFiles } from '../src/storage/folder.js';
import { layoutActivity } from '../src/canvas/act.js';
import { createSequenceView } from '../src/canvas/sdview.js';
import { analyze } from '../src/analysis/solver.js';
import { checksOf } from '../src/analysis/verify.js';
import { createActivityRun, checkActivity } from '../src/sim/activity.js';
import { validate, createValidator } from '../src/validate/engine.js';

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
  validate(opened);
  let nProblems = 0;
  const tValidate = time(() => { nProblems = validate(opened).problems.length; });
  report({ name: `Validate ${opened.count().toLocaleString()} elements on the page, every Recommended rule (${nProblems.toLocaleString()} problems)`, ms: tValidate, budget: 200, note: 'the fallback when workers are unavailable; the app checks in the worker (next rows)' });
  const wv = createValidator(opened, { worker: true, delay: 0 });
  await wv.now();
  const tSends = [], tWorker = [];
  for (let i = 0; i < 5; i++) {
    opened.transact('Rename', (/** @type {any} */ tx) => tx.rename(opened.byKind('partDef')[200 + i].id, `Edited ${i}`));
    const t0 = performance.now();
    const pending = wv.now();
    tSends.push(performance.now() - t0);
    tWorker.push((await pending).ms);
  }
  wv.dispose();
  report({ name: `After an edit: validate ${opened.count().toLocaleString()} elements in the worker (median of 5)`, ms: median(tWorker), budget: 50, note: 'off the main thread: a full pass on the worker\'s copy of the model' });
  report({ name: 'After an edit: the page\'s share of validating (sending the change to the worker)', ms: median(tSends), budget: 2 });

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

  // the very first draw, measured the same way whether or not the window is visible
  const tAll = time(() => view.setCamera({ x: -40, y: -40, k: 0.1 }));
  report({ name: `First paint: all 2,000 blocks and ${edgesFor(dm, new Set(Object.keys(/** @type {any} */ (dm.get(did)).layout.nodes))).length.toLocaleString()} lines at 10% zoom`, ms: tAll, budget: 1000, note: 'plan budget: first paint under 1 s; measures every box, routes every line and builds every shape once' });
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

  // ---------- 4. requirements and traceability at scale ----------
  const rm = createModel();
  const [RR, , RL] = rm.layers().map((l) => l.id);
  /** @type {string} */
  let tid = '', mid = '';
  const tTrace = time(() => rm.transact('Requirements', (tx) => {
    /** @type {string[]} */
    const blocks = [];
    for (let i = 0; i < 2000; i++) blocks.push(tx.create('partDef', { owner: RL, name: `Block ${i}` }));
    /** @type {string[]} */
    let prev = [];
    for (let p = 0; p < 100; p++) {
      const pkg = tx.create('package', { owner: RR, name: `Spec ${p}` });
      const test = tx.create('testCase', { owner: pkg, name: `Test ${p}`, props: { result: p % 7 ? 'Pass' : 'Fail' } });
      /** @type {string[]} */
      const here = [];
      for (let i = 0; i < 100; i++) {
        const r = tx.create('requirement', { owner: pkg, name: `Requirement ${p}.${i}`, props: { reqId: `REQ-${String(p * 100 + i).padStart(5, '0')}`, text: 'The system shall do something measurable within a stated tolerance.' } });
        here.push(r);
        if (i % 10 < 7) tx.link('satisfy', blocks[(p * 100 + i) % 2000], r);
        if (i % 3 === 0) tx.link('verify', test, r);
        if (prev.length && i % 2 === 0) tx.link('derive', r, prev[i % prev.length]);
      }
      prev = here;
    }
    tid = tx.create('table', { owner: RR, name: 'All' });
    mid = tx.create('matrix', { owner: RR, name: 'Satisfy', props: { rel: 'satisfy', rows: 'partDef', cols: 'requirement' } });
  }));
  report({ name: `Build 10,000 requirements with ${(rm.count() - rm.elementCount()).toLocaleString()} trace links`, ms: tTrace, budget: 2000 });
  /** @type {any} */
  let cov = null;
  const tCov = time(() => { cov = coverage(rm); });
  report({ name: `Coverage of 10,000 requirements (${cov.satisfied.done.toLocaleString()} satisfied)`, ms: tCov, budget: 100, note: 'recomputed when the Systems V or RFLP trace repaints' });

  const thost = document.createElement('div');
  Object.assign(thost.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '800px', display: 'flex', flexDirection: 'column', opacity: '0', pointerEvents: 'none' });
  document.body.append(thost);
  const base = { model: rm, notation: () => /** @type {const} */ ('sysml'), selected: () => null, select: () => {}, edit: (/** @type {string} */ l, /** @type {any} */ fn) => { rm.transact(l, fn); return true; } };
  const table = createTableView({ ...base, diagramId: tid });
  thost.append(table.el);
  const tTable = time(() => table.render());
  report({ name: `Requirements table: first paint of ${table.rows().length.toLocaleString()} rows`, ms: tTable, budget: 200, note: 'rows are virtualized: only the visible ones are built' });
  const sc = /** @type {HTMLElement} */ (table.el.querySelector('.tscroll'));
  /** @type {number[]} */
  const tScroll = [];
  for (let i = 0; i < 30; i++) { sc.scrollTop = i * 4000; tScroll.push(time(() => table.render())); }
  report({ name: 'Requirements table: scroll (median frame)', ms: median(tScroll), budget: 16 });
  const someReq = rm.byKind('requirement')[5000];
  /** @type {number[]} */
  const tEditT = [];
  for (let i = 0; i < 5; i++) tEditT.push(time(() => { rm.transact('Edit', (tx) => tx.setProps(someReq.id, { text: `Changed ${i}` })); table.invalidate(); table.render(); }));
  report({ name: 'Requirements table: edit a cell → repaint (median)', ms: median(tEditT), budget: 100, note: 'recomputes every requirement\'s status on the main thread' });
  table.dispose(); table.el.remove();

  const mx = createMatrixView({ ...base, diagramId: mid });
  thost.append(mx.el);
  const tMx = time(() => mx.render());
  report({ name: `Dependency matrix: first paint, ${mx.data().rows.length.toLocaleString()} × ${mx.data().cols.length.toLocaleString()}`, ms: tMx, budget: 200, note: 'cells are virtualized in both directions' });
  const ms = /** @type {HTMLElement} */ (mx.el.querySelector('.mscroll'));
  /** @type {number[]} */
  const mScroll = [];
  for (let i = 0; i < 30; i++) { ms.scrollTop = i * 1500; ms.scrollLeft = i * 6000; mScroll.push(time(() => mx.render())); }
  report({ name: 'Dependency matrix: scroll (median frame)', ms: median(mScroll), budget: 16 });
  mx.dispose(); thost.remove();

  // ---------- 5. SysML v2 text ----------
  const xm = createModel({ name: 'Text bench' });
  const XL = xm.layers()[2].id;
  xm.transact('Blocks', (tx) => {
    /** @type {string[]} */
    const defs = [];
    for (let p = 0; p < 40; p++) {
      const pkg = tx.create('package', { owner: XL, name: `Subsystem ${p}` });
      for (let b = 0; b < 50; b++) {
        const blk = tx.create('partDef', { owner: pkg, name: `Unit ${p}.${b}`, props: { doc: 'A unit of the subsystem.' } });
        tx.create('attribute', { owner: blk, name: 'mass', props: { value: '1.5', unit: 'kg' } });
        tx.create('port', { owner: blk, name: 'power', props: { direction: 'in' } });
        if (defs.length) tx.create('part', { owner: blk, name: 'sub', props: { type: defs[defs.length - 1] } });
        defs.push(blk);
      }
    }
  });
  let xtext = '';
  const tPrint = time(() => { xtext = printPackage(xm, XL).text; });
  const xlines = xtext.split('\n').length;
  report({ name: `Print ${xlines.toLocaleString()} lines of SysML v2 (${xm.elementCount().toLocaleString()} elements)`, ms: tPrint, budget: 300, note: 'plan budget: parse or print a 10,000-line file in under 300 ms' });
  /** @type {any} */
  let xnode = null;
  const tParse = time(() => { xnode = parseLayer(xtext); });
  report({ name: `Parse ${xlines.toLocaleString()} lines of SysML v2`, ms: tParse, budget: 300 });
  const tBuild = time(() => buildSnapshot(xm, [{ layerId: XL, node: xnode }]));
  report({ name: 'Build the model from that text (match ids, resolve every name)', ms: tBuild, budget: 500 });
  const edited = xtext.replace("part def 'Unit 7.7' {", "part def 'Unit 7.7 renamed' {").replace(/sub : 'Unit 7\.7'/g, "sub : 'Unit 7.7 renamed'");
  const tApply = time(() => applyLayerText(xm, XL, edited));
  report({ name: 'Apply an edit to that text (parse, build, diff, one transaction)', ms: tApply, budget: 1000, note: 'runs when you pause typing in the text pane' });
  const tHl = time(() => highlight(xtext));
  report({ name: `Syntax colors for ${xlines.toLocaleString()} lines (each keystroke in the text pane)`, ms: tHl, budget: 50 });
  /** @type {Record<string, string>} */
  let pf = {};
  const tFiles = time(() => { pf = projectFiles(xm, { name: 'Text bench' }); });
  report({ name: 'Write the project as folder files (text, ids, layouts)', ms: tFiles, budget: 500 });
  const tLoad = time(() => modelFromFiles(pf));
  report({ name: 'Open the project from its folder files', ms: tLoad, budget: 1000 });

  // ---------- 6. behavior ----------
  const bm = createModel();
  const [, BF, BL] = bm.layers().map((l) => l.id);
  /** @type {string} */
  let sdId = '';
  /** @type {{ id: string, w: number, h: number }[]} */
  const anodes = [];
  /** @type {{ from: string, to: string, kind: string }[]} */
  const aedges = [];
  bm.transact('Behavior', (tx) => {
    const fn = tx.create('action', { owner: BF, name: 'Big activity' });
    const lanes = Array.from({ length: 6 }, (_, i) => tx.create('partDef', { owner: BL, name: `Unit ${i}` }));
    let prev = tx.create('controlNode', { owner: fn, name: 'Initial', props: { nodeKind: 'initial' } });
    anodes.push({ id: prev, w: 30, h: 30 }, ...lanes.map((id) => ({ id, w: 260, h: 400 })));
    for (let i = 0; i < 400; i++) {
      const a = tx.create('action', { owner: fn, name: `Step ${i}` });
      tx.link('allocate', a, lanes[i % 6]);
      anodes.push({ id: a, w: 170, h: 50 });
      aedges.push({ from: prev, to: a, kind: 'flow' });
      prev = a;
    }
    const inter = tx.create('interaction', { owner: BF, name: 'Long scenario' });
    const lifes = Array.from({ length: 8 }, (_, i) => tx.create('lifeline', { owner: inter, name: `p${i}` }));
    for (let i = 0; i < 1000; i++) tx.create('message', { owner: inter, name: `call${i}()`, props: { from: lifes[i % 8], to: lifes[(i * 3 + 1) % 8] } });
    sdId = tx.create('sd', { owner: inter, name: 'Long sequence' });
  });
  const tAct = time(() => layoutActivity(bm, anodes, aedges, anodes.slice(1, 7).map((x) => x.id)));
  report({ name: 'Tidy an activity of 400 steps in 6 swimlanes', ms: tAct, budget: 300 });
  const shost = document.createElement('div');
  Object.assign(shost.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '800px', display: 'flex', flexDirection: 'column', opacity: '0', pointerEvents: 'none' });
  document.body.append(shost);
  const sv = createSequenceView({ model: bm, diagramId: sdId, notation: () => 'sysml', selected: () => null, select: () => {}, edit: (l, fn) => { bm.transact(l, fn); return true; } });
  shost.append(sv.el);
  const tSd = time(() => sv.render());
  report({ name: 'Draw a sequence diagram of 1,000 messages', ms: tSd, budget: 200 });
  sv.dispose(); shost.remove();

  // ---------- 7. analysis and simulation ----------
  const am = createModel();
  const AL = /** @type {string} */ (am.layers().find((l) => l.layer === 'l')?.id), AR = /** @type {string} */ (am.layers().find((l) => l.layer === 'r')?.id);
  let top = '';
  am.transact('Analysis', (tx) => {
    // a chain of 200 blocks, each with an equation: out = in * k + c, fed by the one before
    const def = tx.create('constraintDef', { owner: AL, name: 'Stage', props: { expr: 'y = x * k + c' } });
    const p = Object.fromEntries(['y', 'x', 'k', 'c'].map((n) => [n, tx.create('attribute', { owner: def, name: n, props: { unit: n === 'k' ? '' : 'W' } })]));
    top = tx.create('partDef', { owner: AL, name: 'Plant' });
    let prevPart = /** @type {string | null} */ (null);
    /** @type {string} */
    let prevOut = tx.create('attribute', { owner: top, name: 'input', props: { value: '1', unit: 'kW' } });
    for (let i = 0; i < 200; i++) {
      const blk = tx.create('partDef', { owner: AL, name: `Stage ${i}` });
      const out = tx.create('attribute', { owner: blk, name: 'out', props: { unit: 'W' } });
      tx.create('attribute', { owner: blk, name: 'gain', props: { value: '1.001' } });
      tx.create('attribute', { owner: blk, name: 'loss', props: { value: '-2', unit: 'W' } });
      const part = tx.create('part', { owner: top, name: `s${i}`, props: { type: blk } });
      const use = tx.create('constraint', { owner: top, name: `c${i}`, props: { type: def } });
      const val = (/** @type {string} */ name) => /** @type {string} */ (am.children(blk).find((c) => c.name === name)?.id);
      tx.create('binding', { owner: top, name: 'y', props: { constraint: use, param: p.y, value: { path: [part], port: out } } });
      tx.create('binding', { owner: top, name: 'x', props: { constraint: use, param: p.x, value: prevPart ? { path: [prevPart], port: prevOut } : { path: [], port: prevOut } } });
      tx.create('binding', { owner: top, name: 'k', props: { constraint: use, param: p.k, value: { path: [part], port: val('gain') } } });
      tx.create('binding', { owner: top, name: 'c', props: { constraint: use, param: p.c, value: { path: [part], port: val('loss') } } });
      prevPart = part; prevOut = out;
    }
    for (let i = 0; i < 500; i++) {
      const r = tx.create('requirement', { owner: AR, name: `Power ${i}`, props: { check: `s199.out >= ${i} [W]` } });
      tx.link('satisfy', top, r);
    }
  });
  let an = /** @type {any} */ (null);
  const tSolve = time(() => { an = analyze(am, top); });
  report({ name: `Solve 200 chained equations through 200 parts (${an.vars.size} values)`, ms: tSolve, budget: 100, note: 're-runs on every edit to the block' });
  const tChecks = time(() => checksOf(am));
  report({ name: 'Live-check 500 requirements against the solved values', ms: tChecks, budget: 100 });
  const runM = createModel();
  const RF = /** @type {string} */ (runM.layers().find((l) => l.layer === 'f')?.id);
  let actId = '';
  runM.transact('Activity', (tx) => {
    actId = tx.create('action', { owner: RF, name: 'Mission' });
    let prev = tx.create('controlNode', { owner: actId, name: 'Initial', props: { nodeKind: 'initial' } });
    for (let i = 0; i < 40; i++) {
      // a fork of three, joined, then a decision that can loop back
      const f = tx.create('controlNode', { owner: actId, name: `Fork ${i}`, props: { nodeKind: 'fork' } });
      const j = tx.create('controlNode', { owner: actId, name: `Join ${i}`, props: { nodeKind: 'join' } });
      tx.create('flow', { owner: actId, name: 'f', props: { from: prev, to: f } });
      for (let b = 0; b < 3; b++) { const a = tx.create('action', { owner: actId, name: `A${i}.${b}` }); tx.create('flow', { owner: actId, name: 'f', props: { from: f, to: a } }); tx.create('flow', { owner: actId, name: 'f', props: { from: a, to: j } }); }
      prev = j;
    }
    tx.create('flow', { owner: actId, name: 'f', props: { from: prev, to: tx.create('controlNode', { owner: actId, name: 'Final', props: { nodeKind: 'final' } }) } });
  });
  const tCheck = time(() => checkActivity(runM, actId));
  report({ name: 'Check an activity of 120 actions and 40 forks (every run explored)', ms: tCheck, budget: 500 });
  const rr = createActivityRun(runM, actId);
  const tRun = time(() => { for (let i = 0; i < 200 && rr.state === 'running' || i === 0; i++) rr.step(); });
  report({ name: `Run it to the end (${rr.stepNo} steps)`, ms: tRun, budget: 50 });
}
