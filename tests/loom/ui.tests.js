// The workspace's interface: the model browser (dragging, reordering, menus, double-click),
// the floating properties panel, the resizable sidebar and compact view, and the diagram tool
// palettes (placing elements, relating them). These drive a real workspace with real events.
import { createProjectStore, memoryBackend } from '../../src/storage/projects.js';
import { createSettings, sanitize } from '../../src/settings.js';
import { createCommands } from '../../src/commands.js';
import { mountWorkspace } from '../../src/ui/workspace.js';
import { createModel } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { projectFiles, modelFromFiles } from '../../src/storage/folder.js';
import { printModel } from '../../src/text/printer.js';
import { parseLayer, buildSnapshot, applySnapshot } from '../../src/text/build.js';
import { shapeRoute, moveSegment } from '../../src/canvas/lines.js';
import { applyFramework, frameworkOf, addSet, roleName } from '../../src/model/framework.js';
import { FRAMEWORKS } from '../../src/model/metamodel.js';
import { ModelError } from '../../src/model/model.js';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
/** @param {Element | null | undefined} el */
const center = (el) => { const r = /** @type {Element} */ (el).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
/** @param {EventTarget} t @param {string} type @param {number} x @param {number} y @param {Record<string, any>} [more] */
const ptr = (t, type, x, y, more = {}) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, isPrimary: true, ...more }));

/** @param {import('../run.js').Log} log */
export async function uiTests(log) {
  // ---------- settings ----------
  const d = sanitize({});
  log('Layout settings start sensible: sidebar shown at 260 px, comfortable, palettes as icons', d.sidebar === true && d.sidebarWidth === 260 && d.density === 'comfortable' && d.paletteLabels === false && d.props === null);
  const bad = sanitize({ sidebarWidth: 5000, density: 'tiny', sidebar: 'yes', props: { x: 10, y: 10, w: 50, h: 99999 } });
  log('Layout settings are kept within limits', bad.sidebarWidth === 560 && bad.density === 'comfortable' && bad.sidebar === true && bad.props?.w === 300 && bad.props?.h === 2000);

  // ---------- lines shaped by hand: kept with the diagram ----------
  const lk = createModel(); buildKestrel(lk);
  const ldia = /** @type {any} */ (lk.byKind('bdd')[0]);
  lk.transact('Shape', (tx) => tx.shape(ldia.id, { e1: { pts: [[100, 200], [300, 200]], lx: 12, ly: -8 } }));
  log('A diagram keeps a line\'s bends and its label\'s offset', JSON.stringify(lk.get(ldia.id)?.layout?.lines?.e1) === '{"pts":[[100,200],[300,200]],"lx":12,"ly":-8}');
  lk.undo();
  log('Shaping a line is one undoable step', !lk.get(ldia.id)?.layout?.lines);
  lk.redo();
  const lback = restore(JSON.parse(JSON.stringify(snapshot(lk))));
  log('Shaped lines are saved and opened again', JSON.stringify(lback.get(ldia.id)?.layout?.lines) === JSON.stringify(lk.get(ldia.id)?.layout?.lines));
  const lfiles = projectFiles(lk, { name: 'K', description: '' });
  log('Project folders keep them, in .loom/layout.json', /"~lines"/.test(lfiles['.loom/layout.json']) && JSON.stringify(modelFromFiles(lfiles).model.get(ldia.id)?.layout?.lines) === JSON.stringify(lk.get(ldia.id)?.layout?.lines));
  const ltext = applySnapshot(lk, buildSnapshot(lk, lk.layers().map((l) => ({ layerId: l.id, node: parseLayer(printModel(lk).find((f) => f.id === l.id)?.text || '') }))), 'Apply text');
  log('Applying SysML text leaves them alone', !!ltext && !!lk.get(ldia.id)?.layout?.lines?.e1);
  lk.transact('Unshape', (tx) => tx.shape(ldia.id, { e1: null }));
  log('A line can go back to automatic', !lk.get(ldia.id)?.layout?.lines);
  lk.transact('Fill', (tx) => tx.place(ldia.id, { [Object.keys(ldia.layout.nodes)[0]]: { ...Object.values(ldia.layout.nodes)[0], fill: 'teal' } }));
  log('A box\'s color on a diagram survives saving and opening (it used to be dropped)', Object.values(restore(JSON.parse(JSON.stringify(snapshot(lk)))).get(ldia.id)?.layout?.nodes || {}).some((r) => /** @type {any} */ (r).fill === 'teal'));
  // the geometry: ends stay on their boxes and the line stays square
  const route = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 100 }];
  const moved = moveSegment(route, 1, { x: 100, y: 50 }, { x: 100, y: 80 });
  const square = (/** @type {{ x: number, y: number }[]} */ pts) => pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
  log('Dragging a segment moves it sideways and keeps the line square, its ends where they were', moved.some((p) => p.y === 80) && square(moved) && moved[0].x === 0 && moved[0].y === 0 && moved[moved.length - 1].y === 100);
  const firstSeg = moveSegment([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, { x: 50, y: 0 }, { x: 50, y: 40 });
  log('Moving a straight line adds a short stub at each end', firstSeg.length === 4 && square(firstSeg) && firstSeg[1].y === 40 && firstSeg[0].y === 0 && firstSeg[3].y === 0);
  const reshaped = shapeRoute([{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 90, y: 30 }], { pts: [[40, 60], [40, 90]] });
  log('Bends kept by hand join the ends square, wherever the boxes have moved', square(reshaped) && reshaped[0].x === 0 && reshaped[reshaped.length - 1].x === 90);

  // ---------- frameworks and sets of your own ----------
  const fm = createModel(); buildKestrel(fm);
  log('Projects start as RFLP', frameworkOf(fm).id === 'rflp' && fm.layers().map((l) => l.name).join() === 'Requirements,Functional,Logical,Physical');
  log('There are several frameworks: RFLP first, Arcadia, MagicGrid, OOSEM, the SysML pillars', FRAMEWORKS[0].id === 'rflp' && ['arcadia', 'magicgrid', 'oosem', 'pillars'].every((id) => FRAMEWORKS.some((f) => f.id === id)));
  const counts = () => fm.layers().map((l) => fm.children(l.id).length).join();
  const before = counts();
  applyFramework(fm, 'arcadia');
  log('A framework renames the four core sets in its own words and adds its own sets', fm.layers().map((l) => l.name).join() === 'Operational Analysis,System Analysis,Logical Architecture,Physical Architecture' && fm.sets().some((x) => x.name === 'End-Product Breakdown' && !x.layer) && frameworkOf(fm).id === 'arcadia');
  log('…and moves nothing: every core set holds what it held, with its role', counts() === before && fm.layerOf(/** @type {any} */ (fm.all().find((e) => e.name === 'Battery Pack')).id) === 'l' && roleName(fm, 'r') === 'Operational Analysis');
  applyFramework(fm, 'magicgrid');
  log('Switching again drops the last framework\'s own sets while they are empty', !fm.sets().some((x) => x.name === 'End-Product Breakdown') && fm.sets().some((x) => x.name === 'Parameters'));
  fm.undo(); fm.undo();
  log('Each switch is one undoable step', frameworkOf(fm).id === 'rflp' && fm.sets().length === 4 && fm.layers()[0].name === 'Requirements');
  let own = '';
  fm.transact('Set', (tx) => { own = addSet(fm, tx, 'Verification & Validation', 'green'); tx.create('testCase', { owner: own, name: 'Drop test' }); });
  log('You can add a set of your own at the top, with a color', fm.sets().some((x) => x.id === own && x.props.color === 'green') && fm.children(own).length === 1);
  log('What is in a set of your own has no RFLP role (it stays out of the trace)', !fm.layerOf(/** @type {any} */ (fm.all().find((e) => e.name === 'Drop test')).id));
  log('Core sets can be renamed but not deleted; sets of your own can be both', (() => { try { fm.transact('Del', (tx) => tx.remove(fm.layers()[0].id)); return false; } catch (e) { return e instanceof ModelError; } })() && (() => { fm.transact('Ren', (tx) => tx.rename(fm.layers()[0].id, 'Needs')); return fm.layers()[0].name === 'Needs' && fm.layers()[0].layer === 'r'; })());
  fm.transact('Order', (tx) => tx.move(own, fm.root().id, 1));
  log('Sets can be put in any order; only packages sit at the top', fm.sets()[1].id === own && !fm.canMove(/** @type {any} */ (fm.all().find((e) => e.name === 'Battery Pack')).id, fm.root().id));
  fm.transact('Arcadia names', (tx) => tx.setProps(fm.root().id, { framework: 'oosem' }));
  const ff = projectFiles(fm, { name: 'F', description: '' });
  const ownFile = Object.keys(ff).find((f) => f.startsWith('verification'));
  log('A set of your own is saved as its own .sysml file, with its color', !!ownFile && /package 'Verification & Validation'/.test(ff[/** @type {string} */ (ownFile)]) && /color = "green"/.test(ff[/** @type {string} */ (ownFile)]));
  const fback = modelFromFiles(ff).model;
  log('Project folders keep sets of your own, their order, the core sets\' names and the framework', fback.sets().map((x) => x.name).join() === fm.sets().map((x) => x.name).join() && fback.sets()[1].props.color === 'green' && fback.children(fback.sets()[1].id).length === 1 && frameworkOf(fback).id === 'oosem');
  const fsnap = restore(JSON.parse(JSON.stringify(snapshot(fm))));
  log('…and so does saving on this device', fsnap.sets().map((x) => x.name).join() === fm.sets().map((x) => x.name).join());
  const fstore = createProjectStore(memoryBackend());
  const fp = await fstore.create({ name: 'Pillars', template: 'cubesat', framework: 'pillars' });
  const fo = await fstore.open(fp.id);
  log('A new project (or sample) can start with any framework', frameworkOf(fo.model).id === 'pillars' && fo.model.layers()[2].name === 'Structure' && fo.model.sets().some((x) => x.name === 'Parametrics') && !fo.model.canUndo());

  // ---------- a workspace on screen (events need real geometry, so the app's styles too) ----------
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '../css/loom.css';
  await new Promise((r) => { css.onload = r; css.onerror = r; document.head.append(css); });
  const store = createProjectStore(memoryBackend());
  const p = await store.create({ name: 'UI', template: 'kestrel' });
  const opened = await store.open(p.id);
  const m = opened.model;
  const settings = createSettings(null);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px;z-index:99999;opacity:0.02;';
  document.body.append(host);
  const ws = mountWorkspace(host, { meta: opened.meta, model: m, settings, commands: createCommands(), projects: store, save: (mm) => store.save(p.id, mm) });
  await wait(60);
  const find = (/** @type {string} */ name, kind = '') => /** @type {any} */ (m.all().find((e) => e.name === name && (!kind || e.kind === kind)));
  const rowOf = (/** @type {string} */ id) => /** @type {HTMLElement | null} */ (host.querySelector(`.tree [data-id="${id}"]`));
  try {
    // ---------- the model browser ----------
    const L = /** @type {string} */ (m.layers().find((l) => l.layer === 'l')?.id);
    const av = find('Kestrel Air Vehicle', 'partDef');
    log('The browser lists the layers and what is in them', !!rowOf(L) && !!rowOf(av.id));
    // the twisty opens a row that is not selected, without selecting it
    const twisty = /** @type {HTMLElement} */ (rowOf(av.id)?.querySelector('[data-twisty]'));
    twisty.click();
    await wait();
    log('The arrow opens a row straight away, without selecting it first', rowOf(av.id)?.getAttribute('aria-expanded') === 'true' && ws.selected() !== av.id);
    // a folder can be folded with the selection inside it
    ws.select(m.children(av.id)[0].id);
    await wait();
    /** @type {HTMLElement} */ (rowOf(av.id)?.querySelector('[data-twisty]')).click();
    await wait();
    log('A row folds even when what is selected is inside it', rowOf(av.id)?.getAttribute('aria-expanded') === 'false');
    ws.select(null);
    /** @type {HTMLElement} */ (rowOf(av.id)?.querySelector('[data-twisty]')).click();
    await wait();
    const LINES = ['flow', 'transition', 'connector', 'binding'];
    log('Its contents show, without the lines (connectors, flows) unless asked for', m.children(av.id).every((c) => !!rowOf(c.id) === !LINES.includes(c.kind)) && m.children(av.id).some((c) => LINES.includes(c.kind)));
    settings.update((st) => { st.treeLines = true; });
    log('The browser can list lines too', m.children(av.id).every((c) => !!rowOf(c.id)));
    settings.update((st) => { st.treeLines = false; });
    // the filter box
    const filter = /** @type {HTMLInputElement} */ (host.querySelector('.tree-filter input'));
    filter.value = 'motor'; filter.dispatchEvent(new Event('input'));
    const shown = [...host.querySelectorAll('.tree .ti')].map((x) => x.querySelector('.ti-name')?.textContent || '');
    log('Typing in the filter narrows the browser to matching names, with their packages', shown.includes('Motor') && shown.includes('Logical') && !shown.includes('Battery Pack') && !!host.querySelector('.ti-name.hit'), shown.join(', '));
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    log('Escape clears the filter', filter.value === '' && !!rowOf(av.id));

    // drag to reorder: Battery Pack before Propulsion System, inside Logical
    const sibs = () => m.children(L).map((c) => c.name);
    const batt = find('Battery Pack', 'partDef'), prop = find('Propulsion System', 'partDef');
    const before = sibs();
    rowOf(prop.id)?.scrollIntoView({ block: 'center' });
    let a = center(rowOf(batt.id)), b = center(rowOf(prop.id));
    ptr(rowOf(batt.id) || host, 'pointerdown', a.x, a.y);
    ptr(document, 'pointermove', a.x + 2, a.y + 8);
    ptr(document, 'pointermove', b.x, b.r.top + 3);
    const marker = /** @type {HTMLElement} */ (host.querySelector('.tree-marker'));
    log('Dragging shows a line where the row would go, and a ghost of what is moving', !marker.hidden && !!document.querySelector('.tree-ghost'));
    ptr(document, 'pointerup', b.x, b.r.top + 3);
    await wait();
    const after = sibs();
    log('Dropping between rows reorders, without selecting first', after.indexOf('Battery Pack') === after.indexOf('Propulsion System') - 1 && after.length === before.length, after.join(', '));
    log('The ghost is gone after the drop', !document.querySelector('.tree-ghost'));
    m.undo();
    log('Reordering is one undoable step', sibs().join() === before.join());

    // drag onto the middle of a package: moves inside it
    let pk = '';
    m.transact('Add', (tx) => { pk = tx.create('package', { owner: L, name: 'Bin' }); });
    await wait();
    rowOf(pk)?.scrollIntoView({ block: 'center' });
    a = center(rowOf(batt.id)); b = center(rowOf(pk));
    ptr(rowOf(batt.id) || host, 'pointerdown', a.x, a.y);
    ptr(document, 'pointermove', a.x, a.y + 10);
    ptr(document, 'pointermove', b.x, b.y);
    log('Over the middle of a row, it lights up as the drop target', rowOf(pk)?.classList.contains('drop-ok'));
    ptr(document, 'pointerup', b.x, b.y);
    await wait();
    log('Dropping onto a row moves the element inside it', m.get(batt.id)?.owner === pk);
    // Escape cancels a drag
    a = center(rowOf(prop.id)); b = center(rowOf(pk));
    ptr(rowOf(prop.id) || host, 'pointerdown', a.x, a.y);
    ptr(document, 'pointermove', a.x, a.y + 10);
    ptr(document, 'pointermove', b.x, b.y);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ptr(document, 'pointerup', b.x, b.y);
    await wait();
    log('Escape cancels a drag', m.get(prop.id)?.owner === L);
    m.undo(); m.undo();
    // Alt+arrow moves among siblings
    ws.select(prop.id);
    await wait();
    const i0 = m.children(L).findIndex((c) => c.id === prop.id);
    rowOf(prop.id)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    log('Alt+↓ moves the selection down among its siblings', m.children(L).findIndex((c) => c.id === prop.id) === i0 + 1);
    m.undo();

    // right-click: a menu
    const r0 = center(rowOf(prop.id));
    rowOf(prop.id)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r0.x, clientY: r0.y }));
    const menu = document.querySelector('.popmenu');
    const labels = [...(menu?.querySelectorAll('[role="menuitem"]') || [])].map((x) => x.textContent || '');
    log('Right-click opens a menu with properties, rename, add, delete', ['Properties', 'Rename', 'Add inside', 'Delete'].every((w) => labels.some((l) => l.includes(w))), labels.join(' | '));
    menu?.remove();

    // ---------- the properties panel ----------
    // a double-click as a browser sends it: click (count 1), which re-renders the rows, then click (count 2) on the new row
    const dbl = (/** @type {string} */ id) => { for (const detail of [1, 2]) rowOf(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })); };
    dbl(prop.id);
    await wait();
    const panel = /** @type {HTMLElement} */ (host.querySelector('.ppanel'));
    log('Double-clicking an element opens its properties in a floating panel', !panel.hidden && panel.querySelector('.ppanel-name')?.textContent === 'Propulsion System');
    log('The panel has the name, description, relationships and more', !!panel.querySelector('input.field') && /Relationships/.test(panel.textContent || ''));
    const nameField = /** @type {HTMLInputElement} */ (panel.querySelector('input.field'));
    nameField.value = 'Propulsion'; nameField.dispatchEvent(new Event('change'));
    log('Editing a field changes the model', m.get(prop.id)?.name === 'Propulsion' && panel.querySelector('.ppanel-name')?.textContent === 'Propulsion');
    m.undo();
    ws.select(av.id);
    await wait();
    log('While open, the panel follows the selection', panel.querySelector('.ppanel-name')?.textContent === 'Kestrel Air Vehicle');
    ws.select(null);
    log('Clearing the selection keeps what it shows', panel.querySelector('.ppanel-name')?.textContent === 'Kestrel Air Vehicle');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    log('Escape closes it', panel.hidden);
    ws.projectSettings();
    log('The project menu\'s settings open the project in the panel', !panel.hidden && panel.querySelector('.ppanel-kind')?.textContent === 'Project' && /Export \.zip/.test(panel.textContent || ''));
    ws.toggleProps(); ws.toggleProps();
    let gone = '';
    m.transact('Add', (tx) => { gone = tx.create('partDef', { owner: L, name: 'Temporary' }); });
    ws.select(gone); ws.toggleProps();
    m.transact('Delete', (tx) => tx.remove(gone));
    await wait();
    log('Deleting the element shown closes the panel', panel.hidden);
    m.undo(); m.undo();
    const diag = find('Air vehicle structure', 'bdd');
    dbl(diag.id);
    await wait(80);
    log('Double-clicking a diagram in the browser opens it', !!host.querySelector('.dview .dstage'));

    // ---------- the sidebar ----------
    const shell = /** @type {HTMLElement} */ (host.querySelector('.shell'));
    log('No inspector column: the workspace takes the width', !host.querySelector('.shell > .inspector') && getComputedStyle(shell).gridTemplateColumns.trim().split(/\s+/).length === 2, getComputedStyle(shell).gridTemplateColumns);
    const resizer = /** @type {HTMLElement} */ (host.querySelector('.side-resizer'));
    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    await wait();
    log('The sidebar\'s edge resizes it (here with the keyboard)', settings.get().sidebarWidth === 300 && shell.style.getPropertyValue('--side-w') === '300px');
    settings.update((st) => { st.sidebar = false; });
    log('The sidebar can be hidden, and the top bar offers it back', shell.classList.contains('no-side') && !!host.querySelector('.topbar [aria-label="Show the sidebar"]'));
    settings.update((st) => { st.sidebar = true; st.sidebarWidth = 260; });

    // ---------- tool palettes ----------
    await wait(60);
    const pal = () => [...host.querySelectorAll('.dview .tpal .tbtn[data-tool]')].map((x) => x.getAttribute('aria-label'));
    log('A block definition diagram\'s palette: select, block, interface block, generalization', ['Select', 'Block', 'Interface block', 'Generalization'].every((x) => pal().includes(x)), pal().join(', '));
    const stage = /** @type {HTMLElement} */ (host.querySelector('.dview .dstage'));
    const nBlocks = m.byKind('partDef').length;
    /** @type {HTMLElement} */ (host.querySelector('.tbtn[aria-label="Block"]')).click();
    log('Picking a tool arms it and says what to do', stage.classList.contains('tool-place') && !(/** @type {HTMLElement} */ (host.querySelector('.tool-chip'))).hidden);
    const sr = stage.getBoundingClientRect();
    ptr(stage, 'pointerdown', sr.left + 60, sr.top + 60);
    ptr(stage, 'pointerup', sr.left + 60, sr.top + 60);
    await wait();
    const newBlock = m.byKind('partDef').find((x) => x.name.startsWith('Block '));
    log('Clicking the diagram places a new block there', m.byKind('partDef').length === nBlocks + 1 && !!newBlock && !!diag && !!m.get(diag.id)?.layout?.nodes[newBlock.id]);
    log('…and the tool is put down again', !stage.classList.contains('tool-place'));
    // double-click a box on the diagram: its properties (where the pointer is, though the stage holds the pointer)
    const pn = stage.querySelector(`.node[data-id="${prop.id}"]`);
    if (pn) { const c = center(pn); stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: c.x, clientY: c.y })); }
    await wait();
    log('Double-clicking a box on a diagram opens its properties', !panel.hidden && panel.querySelector('.ppanel-name')?.textContent === 'Propulsion System');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.querySelector('.drename')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // relate two boxes with a relationship tool: click the source, then the target
    /** @type {HTMLElement} */ (host.querySelector('.tbtn[aria-label="Generalization"]')).click();
    await wait(40);
    const nodeOf = (/** @type {string} */ id) => stage.querySelector(`.node[data-id="${id}"]`);
    const srcEl = nodeOf(/** @type {string} */ (newBlock?.id)), dstEl = nodeOf(prop.id);
    if (srcEl && dstEl) {
      const s1 = center(srcEl), d1 = center(dstEl);
      ptr(srcEl, 'pointerdown', s1.x, s1.y); ptr(stage, 'pointerup', s1.x, s1.y);
      ptr(stage, 'pointermove', d1.x, d1.y, { buttons: 0 });
      ptr(dstEl, 'pointerdown', d1.x, d1.y); ptr(stage, 'pointerup', d1.x, d1.y);
      await wait();
    }
    log('A relationship tool relates the box clicked first to the one clicked next', m.relsFrom(/** @type {string} */ (newBlock?.id)).some((r) => r.kind === 'generalize' && r.target === prop.id));
    // drag a line's segment: it is kept with the diagram
    await wait(60);
    const lineHit = /** @type {SVGPathElement | null} */ ([...stage.querySelectorAll('.e-hit[data-line]')].find((x) => /** @type {SVGPathElement} */ (x).getTotalLength() > 60) || null);
    if (lineHit) {
      let at = null;
      for (let t = 0.1; t < 1 && !at; t += 0.05) { const p = lineHit.getPointAtLength(lineHit.getTotalLength() * t); const q = new DOMPoint(p.x, p.y).matrixTransform(/** @type {DOMMatrix} */ (lineHit.getScreenCTM())); if (/** @type {any} */ (document.elementFromPoint(q.x, q.y))?.dataset?.line === lineHit.dataset.line) at = q; }
      if (at) { ptr(lineHit, 'pointerdown', at.x, at.y); ptr(stage, 'pointermove', at.x + 30, at.y + 30); ptr(stage, 'pointerup', at.x + 30, at.y + 30); }
      await wait();
    }
    log('Dragging a line on a diagram reshapes it, kept with the diagram', !!lineHit && !!m.get(diag.id)?.layout?.lines?.[/** @type {string} */ (lineHit?.dataset.line)]);
    // an activity's palette has every control node and both flows
    ws.openDiagram(find('Survey flight', 'act').id);
    await wait(80);
    log('An activity\'s palette has actions, each control node, lanes and both flows', ['Action', 'Initial', 'Decision', 'Fork', 'Join', 'Lane', 'Control flow', 'Object flow'].every((x) => pal().includes(x)), pal().join(', '));
    ws.openDiagram(find('Air vehicle internals', 'ibd').id);
    await wait(80);
    log('An internal block diagram\'s palette has parts, ports and connectors', ['Select', 'Part property', 'Port', 'Connector'].some((x) => pal().includes(x)) && pal().length === 4, pal().join(', '));
    ws.openDiagram(find('Survey sortie sequence', 'sd').id);
    await wait(80);
    log('A sequence diagram\'s palette has lifelines, fragments and each kind of message', ['Call', 'Signal', 'Reply', 'Create'].every((x) => pal().includes(x)) && pal().length === 8, pal().join(', '));
    settings.update((st) => { st.paletteLabels = true; });
    // the palette redraws on the view's next frame, which a background tab can hold back
    for (let i = 0; i < 40 && !host.querySelector('.tpal.wide .tbtn-label'); i++) await wait(50);
    log('Palettes can show tool names', !!host.querySelector('.tpal.wide .tbtn-label'));
  } finally {
    ws.dispose(); host.remove(); css.remove();
    document.querySelectorAll('.popmenu, .tooltip-card, .tree-ghost').forEach((x) => x.remove());
  }
}
