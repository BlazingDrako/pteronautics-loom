// Everyday diagram tools: align, distribute and match sizes; diagrams as pictures (frames,
// fonts, PNG limits); back and forward between views, and the breadcrumb trail.
import { arrange, ARRANGE, arrangeMenu } from '../../src/canvas/arrange.js';
import { addFrame, frameHeader, safeScale, embedFonts, pictureName, PNG_MAX_SIDE } from '../../src/interop/image.js';
import { createProjectStore, memoryBackend } from '../../src/storage/projects.js';
import { createSettings } from '../../src/settings.js';
import { createCommands } from '../../src/commands.js';
import { mountWorkspace } from '../../src/ui/workspace.js';
import { createModel } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { findMatches, applyReplace, searchRegex, keepCase } from '../../src/model/replace.js';
import { commonProps, kindWithin } from '../../src/ui/bulk.js';
import { parseQuick, parseIbdQuick } from '../../src/canvas/quickadd.js';
import { availableColumns, gtableRows, cellOf, shapeRows, gtableSheet, defaultColumns } from '../../src/model/gtable.js';
import { projectFiles, modelFromFiles } from '../../src/storage/folder.js';
import { icdRows, icdSheet, n2Chart, n2Sheet, blocksWithInterfaces, carriesOf } from '../../src/model/icd.js';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** @param {import('../run.js').Log} log */
export async function toolsTests(log) {
  // ---------- arrange: pure geometry ----------
  const B = () => new Map([
    ['a', { x: 10, y: 40, w: 100, h: 60 }],
    ['b', { x: 200, y: 10, w: 140, h: 80 }],
    ['c', { x: 500, y: 90, w: 60, h: 40 }],
  ]);
  const L = arrange('left', B());
  log('Align left moves every box to the leftmost edge, and leaves the one already there', L.b?.x === 10 && L.c?.x === 10 && !L.a);
  const R = arrange('right', B());
  log('Align right lines up the right edges', R.a.x + 100 === 560 && R.b.x + 140 === 560 && !R.c);
  const T = arrange('top', B()), Bo = arrange('bottom', B());
  log('Align top and bottom use the outermost edges', T.a.y === 10 && T.c.y === 10 && Bo.a.y + 60 === 130 && Bo.b.y + 80 === 130);
  const HC = arrange('hcenter', B());
  log('Align centers uses the box selected last as the reference', HC.a.x + 50 === 530 && HC.b.x + 70 === 530 && !HC.c);
  const VC = arrange('vcenter', B(), { ref: 'b' });
  log('…or the one asked for', VC.a.y + 30 === 50 && VC.c.y + 20 === 50 && !VC.b);
  const sp = arrange('hspace', new Map([
    ['a', { x: 0, y: 0, w: 100, h: 50 }], ['b', { x: 130, y: 0, w: 100, h: 50 }], ['c', { x: 400, y: 0, w: 100, h: 50 }],
  ]));
  log('Space evenly keeps the outermost boxes and evens the gaps', sp.b?.x === 200 && !sp.a && !sp.c, JSON.stringify(sp));
  const spOrder = arrange('vspace', new Map([
    ['top', { x: 0, y: 0, w: 50, h: 20 }], ['bottom', { x: 0, y: 300, w: 50, h: 20 }], ['mid', { x: 0, y: 40, w: 50, h: 20 }],
  ]), { grid: 10 });
  log('Spacing works in place order, not selection order, and snaps to the grid', spOrder.mid?.y === 150 && !spOrder.top && !spOrder.bottom, JSON.stringify(spOrder));
  const S = arrange('size', B());
  log('Same size matches the reference box', S.a.w === 60 && S.a.h === 40 && S.b.w === 60 && !S.c && S.a.x === 10);
  const W = arrange('width', B()), H = arrange('height', B());
  log('Same width and height change only that side', W.a.w === 60 && W.a.h === 60 && H.b.h === 40 && H.b.w === 140);
  log('Operations that need more boxes do nothing with too few', !Object.keys(arrange('hspace', new Map([...B()].slice(0, 2)))).length && !Object.keys(arrange('left', new Map([...B()].slice(0, 1)))).length);
  const menu = arrangeMenu(2, () => {});
  log('The arrange menu groups its items and disables what needs more boxes', menu.filter((x) => x === 'sep').length === 2 && menu.find((x) => x.label === 'Space evenly across')?.disabled === true && menu.find((x) => x.label === 'Align left edges')?.disabled === false && menu.length === ARRANGE.length + 2);

  // ---------- pictures ----------
  const m = createModel(); buildKestrel(m);
  const bdd = /** @type {any} */ (m.byKind('bdd')[0]);
  const head = frameHeader(m, bdd.id);
  log('A picture\'s frame names the diagram kind, what it belongs to and the diagram', head.startsWith('bdd [') && head.includes(bdd.name), head);
  const ibd = /** @type {any} */ (m.byKind('ibd')[0]);
  log('An internal block diagram\'s frame names its block', frameHeader(m, ibd.id).startsWith('ibd [block] '), frameHeader(m, ibd.id));
  const raw = '<svg viewBox="10 20 300 200" width="300" height="200" xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const fr = addFrame(raw, 300, 200, 'bdd [package] A & B [x]');
  log('The frame makes room around the picture and keeps it whole', fr.w === 328 && fr.h === 254 && /viewBox="-4 -20 328 254"/.test(fr.svg) && fr.svg.includes('width="328"') && fr.svg.includes('<rect/>'), fr.svg.slice(0, 120));
  log('The frame\'s header is escaped', fr.svg.includes('A &amp; B') && !fr.svg.includes('A & B'));
  const ef = embedFonts(raw, { sans: 'AAAA' });
  log('Fonts are embedded in the picture', ef.includes("@font-face{font-family:'Space Grotesk';src:url(data:font/woff2;base64,AAAA)") && embedFonts(raw, {}) === raw);
  log('A PNG keeps the scale asked for when it fits', safeScale(1200, 800, 4) === 4);
  const big = safeScale(9000, 3000, 4);
  log('…and scales down for very large diagrams', big < 4 && 9000 * big <= PNG_MAX_SIDE && 9000 * 3000 * big * big <= 120e6, big);
  log('Picture file names are safe', pictureName('Air vehicle: structure / v2', 'png') === 'Air-vehicle-structure-v2.png');

  // ---------- interfaces: ICD and N² ----------
  const prop = /** @type {any} */ (m.all().find((e) => e.kind === 'partDef' && e.name === 'Propulsion System'));
  const av = /** @type {any} */ (m.all().find((e) => e.kind === 'partDef' && e.name === 'Kestrel Air Vehicle'));
  const rows = icdRows(m, prop.id);
  const pw = rows.find((r) => r.item === '48 V DC');
  log('The ICD lists every connector in a block, numbered', rows.length === 3 && rows.map((r) => r.id).join() === 'IF-01,IF-02,IF-03', rows.map((r) => r.id + ' ' + r.from + '>' + r.to).join(' | '));
  log('Each row names its ends, ports, directions and interface', !!pw && pw.from === 'battery.pwrOut' && pw.to === 'esc.pwrIn' && pw.fromDir === 'out' && pw.toDir === 'in' && pw.iface === 'DC Power 48 V' && pw.flow === 'From → To', JSON.stringify(pw));
  log('An end on the block\'s own boundary is named by its port', rows.some((r) => r.from === 'throttle' && r.fromPart === '(boundary)'));
  log('What an interface carries comes from its value properties', !!pw && pw.carries === carriesOf(m, pw.ifaceId) && /voltage = 48 V/.test(pw.carries), pw?.carries);
  const shallow = icdRows(m, av.id), deep = icdRows(m, av.id, { deep: true });
  log('Going into nested parts adds their connectors, named from the top block', shallow.length === 1 && deep.length === 4 && deep.some((r) => r.from === 'propulsion.battery.pwrOut' && r.via === 'propulsion'), deep.map((r) => r.from).join(', '));
  const sh = icdSheet(m, rows);
  log('The ICD exports with a header and a row per interface', sh.length === 4 && sh[0][0] === 'Interface ID' && sh[1].length === sh[0].length);
  const n2 = n2Chart(m, prop.id);
  const iB = n2.items.findIndex((x) => x.name === 'battery'), iE = n2.items.findIndex((x) => x.name === 'esc'), iX = n2.items.findIndex((x) => x.name === 'External');
  log('The N² chart has the parts on its diagonal, and the outside world when ports are on the boundary', n2.items.length === 4 && iB >= 0 && iX === 3, n2.items.map((x) => x.name).join(', '));
  log('A cell holds what flows from its row\'s part to its column\'s', (n2.cells.get(`${iB},${iE}`) || []).length === 1 && !n2.cells.get(`${iE},${iB}`) && (n2.cells.get(`${iX},${iE}`) || []).length === 1);
  const n2deep = n2Chart(m, av.id, { deep: true });
  const iAv = n2deep.items.findIndex((x) => x.name === 'avionics'), iPr = n2deep.items.findIndex((x) => x.name === 'propulsion');
  log('Deeper connectors stay inside their part in the N² chart', (n2deep.cells.get(`${iAv},${iPr}`) || []).length === 1 && [...n2deep.cells.values()].flat().length === 1);
  const n2s = n2Sheet(n2);
  log('The N² chart exports as a square sheet with the parts on the diagonal', n2s.length === 5 && n2s[1][1] === n2s[0][1] && n2s[iB + 1][iE + 1] === '48 V DC', JSON.stringify(n2s));
  log('Blocks with interfaces are offered, the most connected first', blocksWithInterfaces(m)[0]?.el.id === prop.id && blocksWithInterfaces(m).length === 2);

  // ---------- find and replace ----------
  const rm = createModel(); buildKestrel(rm);
  const all = findMatches(rm, 'battery', 'cell');
  log('Find looks in names and text, ignoring case by default', all.matches.some((x) => x.field === 'name') && all.matches.some((x) => x.field === 'text' || x.field === 'doc'), all.matches.length);
  const cased = findMatches(rm, 'battery', 'cell', { matchCase: true });
  log('Match case narrows it', cased.matches.length < all.matches.length && cased.matches.every((x) => x.before.includes('battery')));
  const names = findMatches(rm, 'battery', 'cell', { scopes: ['name'] });
  log('Scopes limit where it looks', names.matches.length > 0 && names.matches.every((x) => x.field === 'name'));
  const whole = findMatches(rm, 'Pack', 'X', { wholeWord: true, matchCase: true, scopes: ['name'] });
  log('Whole words do not match inside longer words', whole.matches.every((x) => /\bPack\b/.test(x.before)));
  const rx = findMatches(rm, '(\\d+) V', '$1 volts', { regex: true });
  log('Patterns work, with $1 in the replacement', rx.matches.length > 0 && rx.matches.every((x) => /volts/.test(x.after) && !/\$1/.test(x.after)), rx.matches.map((x) => x.after).slice(0, 2).join(' | '));
  log('The replacement takes each match\'s case', keepCase('Battery', 'power cell') === 'Power cell' && keepCase('BATTERY', 'power cell') === 'POWER CELL' && keepCase('battery', 'UAS') === 'UAS' && keepCase('battery', 'cell') === 'cell');
  log('A bad pattern says why', !!findMatches(rm, '(', '', { regex: true }).error && typeof searchRegex('a*', { regex: true }) === 'string');
  const n0 = rm.version();
  let done = 0;
  rm.transact('Replace', (tx) => { done = applyReplace(tx, all.matches); });
  log('Replacing changes every place, in one step', done >= all.matches.length && findMatches(rm, 'battery', '').matches.length === 0 && rm.version() > n0);
  rm.undo();
  log('One undo puts every place back', findMatches(rm, 'battery', '').matches.length === all.matches.length);
  const pkgR = /** @type {any} */ (rm.all().find((e) => e.kind === 'package' && e.name === 'System requirements'));
  if (pkgR) log('Find can stay inside a package', findMatches(rm, 'the', '', { within: pkgR.id }).matches.every((x) => rm.path(x.id).some((a) => a.id === pkgR.id)));

  // ---------- bulk edit ----------
  const reqs = rm.byKind('requirement').map((r) => r.id);
  const cp = commonProps(rm, reqs);
  log('Bulk edit offers the properties every element has', ['priority', 'status', 'method', 'level', 'text'].every((k) => cp.some((p) => p.key === k)) && !cp.some((p) => p.key === 'stereo' || p.key === 'reqId') && cp[0].type === 'enum', cp.map((p) => p.key).join(','));
  const mixed = commonProps(rm, [reqs[0], /** @type {string} */ (rm.byKind('partDef')[0]?.id)]);
  log('…and only those shared by different kinds', mixed.every((p) => p.key === 'doc'), mixed.map((p) => p.key).join(','));
  const st = cp.find((p) => p.key === 'status');
  log('It counts the values they have now', !!st && [...st.values.values()].reduce((a, b) => a + b, 0) === reqs.length);
  const R0 = /** @type {string} */ (rm.layers().find((l) => l.layer === 'r')?.id);
  log('Everything of a kind inside a package, at any depth', kindWithin(rm, R0, 'requirement').length === reqs.length);

  // ---------- quick-add: reading what was typed ----------
  const bddC = [{ kind: 'partDef', label: 'Block' }, { kind: 'interfaceDef', label: 'Interface' }];
  const q1 = parseQuick('Battery Pack', { diagram: 'bdd', choices: bddC });
  log('Typing a name adds the diagram\'s main kind', q1.items.length === 1 && q1.items[0].kind === 'partDef' && q1.items[0].name === 'Battery Pack');
  const q2 = parseQuick('interface DC Power', { diagram: 'bdd', choices: bddC });
  log('A kind can be named first', q2.items[0]?.kind === 'interfaceDef' && q2.items[0]?.name === 'DC Power');
  const q3 = parseQuick('battery : Battery Pack [2]', { diagram: 'bdd', choices: bddC });
  log('name : Type [n] is a part', q3.items[0]?.kind === 'part' && q3.items[0]?.name === 'battery' && q3.items[0]?.part?.type === 'Battery Pack' && q3.items[0]?.part?.multiplicity === '2', JSON.stringify(q3));
  const q4 = parseQuick('Li-ion Pack :> Battery Pack', { diagram: 'bdd', choices: bddC });
  log(':> specializes', q4.items[0]?.kind === 'partDef' && q4.items[0]?.name === 'Li-ion Pack' && q4.items[0]?.parent === 'Battery Pack');
  const q5 = parseQuick('A; B\nC', { diagram: 'bdd', choices: bddC });
  log('Several at once, split by ; or new lines', q5.items.map((x) => x.name).join() === 'A,B,C');
  const actC = [{ kind: 'action', label: 'Action' }, { kind: 'controlNode', label: 'Fork', props: { nodeKind: 'fork' } }, { kind: 'controlNode', label: 'Decision', props: { nodeKind: 'decision' } }];
  const q6 = parseQuick('fork; Step counter', { diagram: 'act', choices: actC });
  log('A variant by its name alone, and the main kind\'s word stays part of a name', q6.items[0]?.props?.nodeKind === 'fork' && q6.items[1]?.kind === 'action' && q6.items[1]?.name === 'Step counter', JSON.stringify(q6));
  const q7 = parseQuick('Endurance: The UAS shall fly for 3 h', { diagram: 'req', choices: [{ kind: 'requirement', label: 'Requirement' }, { kind: 'testCase', label: 'Test case' }] });
  log('Name: text on a requirement diagram sets the text', q7.items[0]?.name === 'Endurance' && q7.items[0]?.props?.text === 'The UAS shall fly for 3 h');
  const i1 = parseIbdQuick('Battery Pack; esc : ESC [2]; out pwrOut : DC Power; port cmd; in throttle');
  log('On an internal block diagram: parts by type or name : Type, ports with a direction', i1.items.length === 5 && i1.items[0].part?.name === null && i1.items[0].part?.type === 'Battery Pack' && i1.items[1].part?.name === 'esc' && i1.items[1].part?.multiplicity === '2' && i1.items[2].port?.direction === 'out' && i1.items[2].port?.type === 'DC Power' && i1.items[3].port?.direction === 'inout' && i1.items[3].port?.type === null && i1.items[4].port?.direction === 'in' && i1.items[4].port?.name === 'throttle', JSON.stringify(i1));
  log('Empty text is refused', !!parseQuick('  ', { diagram: 'bdd', choices: bddC }).error);

  // ---------- generic tables ----------
  const gm = createModel(); buildKestrel(gm);
  const gL = /** @type {string} */ (gm.layers().find((l) => l.layer === 'l')?.id);
  let gt = '';
  gm.transact('New table', (tx) => { gt = tx.create('gtable', { owner: gL, name: 'Blocks', props: { rowKinds: 'partDef', columns: JSON.stringify(['name', 'kids:part', 'kids:port', 'rel:satisfy:out', 'doc']), sort: 'name:desc' } }); });
  const gtEl = /** @type {any} */ (gm.get(gt));
  const cAvail = availableColumns(gm, ['partDef'], 'sysml').map((c) => c.id);
  log('A table of blocks offers their members, relationships either way and tagged values as columns', ['kids:part', 'kids:port', 'kids:attribute', 'rel:satisfy:out', 'rel:generalize:out', 'rel:generalize:in'].every((c) => cAvail.includes(c)) && cAvail.some((c) => c.startsWith('tag:')), cAvail.join(','));
  const gRows = gtableRows(gm, gtEl);
  log('Its rows are every element of its kinds inside its package', gRows.length > 0 && gRows.every((e) => e.kind === 'partDef' && gm.path(e.id).some((a) => a.id === gL)));
  const gWhole = gtableRows(gm, { ...gtEl, props: { ...gtEl.props, scope: 'model' } });
  log('…or in the gWhole model', gWhole.length === gm.byKind('partDef').length && gWhole.length >= gRows.length);
  const gProp = /** @type {any} */ (gm.all().find((e) => e.kind === 'partDef' && e.name === 'Propulsion System'));
  const pc = cellOf(gm, gProp, 'kids:part', 'sysml');
  log('A members cell lists them with their types, and links to each', /battery : Battery Pack/.test(pc.text) && pc.ids?.length === 3, pc.text);
  const gBatt = /** @type {any} */ (gm.all().find((e) => e.kind === 'partDef' && e.name === 'Battery Pack'));
  const vc = cellOf(gm, gBatt, 'kids:attribute', 'sysml');
  log('A values cell shows each value with its unit', /capacity = 16 Ah/.test(vc.text), vc.text);
  const sc = cellOf(gm, gProp, 'rel:satisfy:out', 'sysml');
  log('A relationship cell lists what it relates to', (sc.ids?.length || 0) >= 1, sc.text);
  const sorted = shapeRows(gm, gRows, ['name'], { sort: 'name:desc' }, 'sysml');
  log('Sorting by a column, either way', sorted[0].name.localeCompare(sorted[sorted.length - 1].name) > 0);
  const filtered = shapeRows(gm, gRows, ['name', 'kids:part'], { filter: 'battery' }, 'sysml');
  log('Filtering looks in every column shown', filtered.some((e) => e.name === 'Propulsion System') && filtered.every((e) => /battery/i.test(e.name) || /battery/i.test(cellOf(gm, e, 'kids:part', 'sysml').text)));
  const gs = gtableSheet(gm, gRows, availableColumns(gm, ['partDef'], 'sysml').filter((c) => ['name', 'kids:part'].includes(c.id)), 'sysml');
  log('A table exports with a header row', gs[0].join() === 'Name,Part properties' && gs.length === gRows.length + 1, gs[0].join());
  log('Each kind starts with sensible columns', defaultColumns(['requirement']).includes('p:text') && defaultColumns(['port']).includes('p:direction') && defaultColumns(['useCase']).includes('name'));
  const back = modelFromFiles(projectFiles(gm, { name: 'X' })).model;
  const gtBack = back.byKind('gtable').find((x) => x.name === 'Blocks');
  log('A generic table is saved in the SysML text with its rows, columns and sort', !!gtBack && gtBack.props.rowKinds === 'partDef' && gtBack.props.columns === gtEl.props.columns && gtBack.props.sort === 'name:desc');

  // ---------- a workspace: arrange, back and forward, breadcrumbs ----------
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '../css/loom.css';
  await new Promise((r) => { css.onload = r; css.onerror = r; document.head.append(css); });
  const store = createProjectStore(memoryBackend());
  const p = await store.create({ name: 'Tools', template: 'kestrel' });
  const opened = await store.open(p.id);
  const wm = opened.model;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;height:900px;z-index:99999;opacity:0.02;';
  document.body.append(host);
  const ws = mountWorkspace(host, { meta: opened.meta, model: wm, settings: createSettings(null), commands: createCommands(), projects: store, save: (mm) => store.save(p.id, mm) });
  await wait(60);
  try {
    const dia = /** @type {any} */ (wm.byKind('bdd')[0]);
    ws.openDiagram(dia.id);
    await wait(80);
    const crumbText = /** @type {HTMLElement} */ (host.querySelector('.where')).textContent || '';
    log('The breadcrumbs show where the open diagram is in the model', crumbText.includes(/** @type {any} */ (wm.get(dia.owner)).name) && crumbText.includes(dia.name) && !crumbText.includes(wm.root().name + '›'), crumbText);
    const v = /** @type {any} */ (ws.activeView());
    // three boxes that are drawn (the camera fits the diagram when it opens)
    for (let i = 0; i < 40 && host.querySelectorAll('.dview .nodes > .node').length < 3; i++) await wait(50);
    const ids = [...host.querySelectorAll('.dview .nodes > .node')].slice(0, 3).map((n) => /** @type {string} */ (/** @type {HTMLElement} */ (n).dataset.id));
    // select three boxes the way a user would: click, then shift-click
    for (const [i, id] of ids.entries()) {
      const node = /** @type {SVGGElement} */ (host.querySelector(`.dview .nodes > .node[data-id="${id}"]`));
      const r = node.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 0, pointerId: 3, isPrimary: true, shiftKey: i > 0 };
      node.dispatchEvent(new PointerEvent('pointerdown', o));
      window.dispatchEvent(new PointerEvent('pointerup', o));
      node.dispatchEvent(new PointerEvent('pointerup', o));
    }
    log('Three boxes are selected', v.selection().length === 3, v.selection().join(','));
    v.arrange('top');
    const tops = ids.map((id) => wm.get(dia.id)?.layout?.nodes[id].y);
    log('Align top on a diagram lines the boxes up, as one undoable step', tops.every((y) => y === tops[0]), tops.join(','));
    wm.undo();
    log('Undo puts them back', ids.some((id) => wm.get(dia.id)?.layout?.nodes[id].y !== tops[0]));
    // quick-add, Tab and dragging out, on the same diagram
    const before = wm.byKind('partDef').length;
    const anyBlock = /** @type {string} */ (ids.find((id) => wm.get(id)?.kind === 'partDef'));
    v.syncSelection(anyBlock);
    v.quickAdd('sensor : Lidar Unit [2]');
    const lidar = wm.byKind('partDef').find((b) => b.name === 'Lidar Unit');
    const part = wm.children(anyBlock).find((c) => c.kind === 'part' && c.name === 'sensor');
    log('Typing a part adds it to the selected block, makes its type and shows it', !!lidar && !!part && part.props.type === lidar.id && part.props.multiplicity === '2' && !!wm.get(dia.id)?.layout?.nodes[lidar.id] && wm.byKind('partDef').length === before + 1);
    v.quickAdd('Solid-state Lidar :> Lidar Unit');
    const ss = wm.byKind('partDef').find((b) => b.name === 'Solid-state Lidar');
    log('…and a block that specializes one, by name', !!ss && wm.relsFrom(ss.id).some((r) => r.kind === 'generalize' && r.target === lidar?.id));
    const nb = wm.byKind('partDef').length;
    v.syncSelection(/** @type {string} */ (ss?.id));
    v.addNext();
    await wait(30);
    document.querySelector('.drename')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    log('Tab adds the next block beside the selected one', wm.byKind('partDef').length === nb + 1);
    const beforeOpts = wm.byKind('partDef').length, vBefore = wm.version(), undoBefore = wm.undoLabel();
    const opts = v.dragOutOptions(/** @type {string} */ (lidar?.id));
    log('Dragging out of a block offers a new part block and a new specialization', opts.some((o) => /as a part of Lidar Unit/.test(o.label)) && opts.some((o) => /new block that is/.test(o.label) || /new block/.test(o.label)), opts.map((o) => o.label).join(' | '));
    const nOpt = wm.byKind('partDef').length;
    log('Trying the options leaves nothing behind (no elements, no undo steps)', nOpt === beforeOpts && wm.undoLabel() === undoBefore, `${vBefore} ${wm.version()}`);
    /** @type {any} */ (opts.find((o) => /as a part of/.test(o.label))).run({ x: 2000, y: 2000 });
    await wait(30);
    document.querySelector('.drename')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    log('…and making one adds the block and the part, as one step', wm.byKind('partDef').length === nOpt + 1 && wm.children(/** @type {string} */ (lidar?.id)).some((c) => c.kind === 'part'));
    for (let i = 0; i < 4; i++) wm.undo();
    log('Undo takes them away one step at a time', !wm.byKind('partDef').some((b) => b.name === 'Lidar Unit'));
    log('Arrange is on the diagram toolbar', [...host.querySelectorAll('.dtool button')].some((b) => b.textContent === 'Arrange'));

    // back and forward
    const other = /** @type {any} */ (wm.byKind('req')[0]);
    ws.openDiagram(other.id);
    await wait(30);
    log('Opening another view makes Back available', ws.canNavigate(-1) && !ws.canNavigate(1));
    ws.navigate(-1);
    await wait(30);
    log('Back returns to the diagram before', /** @type {any} */ (ws.activeView())?.selection && host.querySelector('.where-c.here')?.textContent?.includes(dia.name) && ws.canNavigate(1), host.querySelector('.where-c.here')?.textContent);
    ws.navigate(1);
    await wait(30);
    log('Forward goes to the next one again', !!host.querySelector('.where-c.here')?.textContent?.includes(other.name));
    log('A picture can be made of a diagram, not of a table', ws.canImage());

    // the interfaces view
    const wprop = /** @type {any} */ (wm.all().find((e) => e.kind === 'partDef' && e.name === 'Propulsion System'));
    ws.openIcd(wprop.id);
    for (let i = 0; i < 60 && !host.querySelector('table.icd tbody tr'); i++) await wait(50);
    const trs = host.querySelectorAll('table.icd tbody tr');
    log('The interfaces view shows the block\'s ICD', trs.length === 3 && !!host.querySelector('.where-c.here')?.textContent?.includes('Interfaces'), trs.length);
    /** @type {HTMLElement} */ (trs[0]).click();
    await wait(30);
    log('Clicking a row selects its connector', wm.get(/** @type {string} */ (ws.selected()))?.kind === 'connector');
    /** @type {HTMLElement | undefined} */ ([...host.querySelectorAll('.icd-view .seg button')].find((b) => b.textContent === 'N² chart'))?.click();
    for (let i = 0; i < 60 && !host.querySelector('table.n2'); i++) await wait(50);
    log('The N² chart draws a square with the parts on its diagonal', host.querySelectorAll('table.n2 .n2-diag').length === 4 && host.querySelectorAll('table.n2 .n2-item').length === 3, host.querySelectorAll('table.n2 .n2-item').length);

    // quick-add, Tab and dragging out on an internal block diagram
    const pibd = /** @type {any} */ (wm.byKind('ibd').find((d) => d.name === 'Propulsion internals'));
    ws.openDiagram(pibd.id);
    for (let i = 0; i < 40 && !host.querySelector('.dview .part'); i++) await wait(50);
    const iv = /** @type {any} */ (ws.activeView());
    const pblock = /** @type {string} */ (pibd.owner);
    iv.quickAdd('cooler : Cooling Fan [2]');
    const fan = wm.byKind('partDef').find((b) => b.name === 'Cooling Fan');
    const cooler = wm.children(pblock).find((c) => c.kind === 'part' && c.name === 'cooler');
    log('Typing on an internal block diagram adds a part to its block, typed (made if new), placed', !!fan && !!cooler && cooler.props.type === fan.id && cooler.props.multiplicity === '2' && !!pibd.layout.nodes[cooler.id]);
    log('…and selects it', iv.selection()[0] === cooler?.id);
    iv.quickAdd('in powerIn : DC Power 48 V; out airflow : Airflow');
    const fanPorts = wm.children(/** @type {string} */ (fan?.id)).filter((c) => c.kind === 'port');
    const air = wm.byKind('interfaceDef').find((i) => i.name === 'Airflow');
    log('Typing ports with a part selected gives its block ports, finding or making their interfaces', fanPorts.length === 2 && fanPorts.some((x) => x.name === 'powerIn' && x.props.direction === 'in' && wm.get(x.props.type)?.name === 'DC Power 48 V') && !!air && fanPorts.some((x) => x.props.type === air.id && x.props.direction === 'out') && Object.keys(wm.get(pibd.id)?.layout?.nodes || {}).filter((k) => k.startsWith(`${cooler?.id}#`)).length === 2, fanPorts.map((x) => x.name).join());
    const battPart = /** @type {any} */ (wm.children(pblock).find((c) => c.kind === 'part' && c.name === 'battery'));
    const battPortKey = /** @type {string} */ (Object.keys(wm.get(pibd.id)?.layout?.nodes || {}).find((k) => k.startsWith(`${battPart.id}#`)));
    const nConn = wm.children(pblock).filter((c) => c.kind === 'connector').length, nBlocks = wm.byKind('partDef').length;
    const fr = wm.get(pibd.id)?.layout?.nodes['@frame'];
    iv.dragOutOfPortNow(battPortKey, { x: (fr?.x || 0) + (fr?.w || 600) - 120, y: (fr?.y || 0) + (fr?.h || 400) - 60 });
    await wait(40);
    const ren = /** @type {HTMLInputElement | null} */ (host.querySelector('.drename'));
    log('Dragging a port onto empty space makes a block and a part there, with a matching port, connected', wm.children(pblock).filter((c) => c.kind === 'connector').length === nConn + 1 && wm.byKind('partDef').length === nBlocks + 1 && !!ren);
    if (ren) { ren.value = 'Power Monitor'; ren.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    await wait(20);
    const mon = wm.byKind('partDef').find((b) => b.name === 'Power Monitor');
    const monPart = wm.children(pblock).find((c) => c.kind === 'part' && c.props.type === mon?.id);
    log('…and naming it names the new block, the part after it, and its connector', !!mon && monPart?.name === 'powerMonitor' && wm.children(pblock).some((c) => c.kind === 'connector' && c.name.includes('powerMonitor.')) && wm.children(/** @type {string} */ (mon?.id)).some((c) => c.kind === 'port' && c.props.direction === 'in'), monPart?.name);
    for (let i = 0; i < 4; i++) wm.undo();
    log('Undo takes them away', !wm.byKind('partDef').some((b) => b.name === 'Cooling Fan'));

    // a generic table in the workspace: new, rows, editing a cell
    const wL = /** @type {string} */ (wm.layers().find((l) => l.layer === 'l')?.id);
    ws.select(wL);
    ws.newDiagram('gtable');
    for (let i = 0; i < 40 && !host.querySelector('table.gtable tbody tr'); i++) await wait(50);
    const gv = /** @type {any} */ (ws.currentView());
    const gMade = wm.byKind('gtable').at(-1);
    log('A new generic table lists what its package holds most of, with columns for that kind', gMade?.props.rowKinds === 'partDef' && gv.shown().rows.length > 0 && gv.shown().cols.includes('kids:part'), gMade?.props.rowKinds);
    const firstRow = gv.shown().rows[0];
    gv.startEdit(firstRow, 'doc');
    const ta = /** @type {HTMLTextAreaElement | null} */ (host.querySelector('.gt-input'));
    if (ta) { ta.value = 'Edited in the table'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true })); }
    await wait(30);
    log('A cell can be edited in place, as one undo step', wm.get(firstRow)?.props.doc === 'Edited in the table' && wm.undoLabel() === 'Edit description');
    wm.undo();
    /** @type {HTMLElement | null} */ (host.querySelector('table.gtable th'))?.click();
    await wait(60);
    log('Clicking a header sorts by it (saved with the table)', /^name:/.test(String(wm.byKind('gtable').at(-1)?.props.sort)));

    // several rows in the model browser
    const R = /** @type {string} */ (wm.layers().find((l) => l.layer === 'r')?.id);
    ws.select(/** @type {string} */ (wm.byKind('requirement')[0]?.id));
    await wait(30);
    // three requirement rows that are on screen (others may be folded inside their parents)
    const rq = [...host.querySelectorAll('.tree .ti[data-id]')].map((r) => /** @type {string} */ (/** @type {HTMLElement} */ (r).dataset.id)).filter((id) => wm.get(id)?.kind === 'requirement').slice(0, 3);
    ws.select(rq[0]);
    await wait(30);
    for (const id of rq.slice(1)) /** @type {HTMLElement} */ (host.querySelector(`.tree [data-id="${id}"]`))?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }));
    await wait(30);
    log('⌘/Ctrl-click selects several rows in the model browser', rq.length >= 2 && ws.browserSelection().length === rq.length && host.querySelectorAll('.tree .ti.sel').length === rq.length, ws.browserSelection().length);
    const nDia = wm.byKind('req').length;
    ws.diagramFrom(ws.browserSelection());
    await wait(60);
    const made = wm.byKind('req').find((d) => d.name.endsWith(`(${rq.length})`));
    log('A new diagram can be made from them', wm.byKind('req').length === nDia + 1 && !!made && rq.every((id) => made.layout?.nodes[id]), made?.name);
    log('…in the package that holds them all', !!made && wm.path(made.id).some((a) => a.id === R));
    wm.undo();
  } finally {
    ws.dispose(); host.remove(); css.remove();
    document.querySelectorAll('.popmenu, .tooltip-card').forEach((x) => x.remove());
  }
}
