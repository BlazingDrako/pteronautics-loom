import { createModel, ModelError } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { ELEMENTS, childKinds, isDiagram, canRelate } from '../../src/model/metamodel.js';
import { actNodeContent, actEdgesFor, actKind, syncAllocations, layoutActivity, lanesOf, laneAt } from '../../src/canvas/act.js';
import { stmNodeContent, stmEdgesFor, transitionLabel, reparentStates, layoutStates, stmKind } from '../../src/canvas/stm.js';
import { ucNodeContent, ucEdgesFor, resubject, layoutUseCases, pkgNodeContent, pkgEdgesFor } from '../../src/canvas/uc.js';
import { sdLayout } from '../../src/canvas/sdview.js';
import { naturalSize } from '../../src/canvas/bdd.js';
import { parse } from '../../src/text/parser.js';
import { printPackage } from '../../src/text/printer.js';
import { parseLayer, buildSnapshot, applyLayerText } from '../../src/text/build.js';
import { TextError } from '../../src/text/lexer.js';

/** @param {() => any} fn */
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof ModelError || e instanceof TextError; } };
/** @param {any} a @param {any} b */
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
/** @param {any} a @param {any} b */
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** @param {import('../run.js').Log} log */
export function behaviorTests(log) {
  // ---------- metamodel ----------
  log('Five new views: activity, state machine, sequence, use case, package', ['act', 'stm', 'sd', 'uc', 'pkg'].every(isDiagram));
  log('Activities live in functions, state machines in blocks, sequences in interactions', ELEMENTS.act.owners.join() === 'action' && ELEMENTS.stm.owners.join() === 'partDef' && ELEMENTS.sd.owners.join() === 'interaction');
  log('A function holds control nodes; flows are drawn, not added from menus', childKinds('action').includes('controlNode') && !childKinds('action').includes('flow'));
  log('States nest in states and regions; regions only in states', ELEMENTS.state.owners.includes('state') && ELEMENTS.state.owners.includes('region') && ELEMENTS.region.owners.join() === 'state');
  log('Use case relationships: actors take part, use cases include and extend, packages import', canRelate('participate', 'actor', 'useCase') && canRelate('include', 'useCase', 'useCase') && canRelate('extend', 'useCase', 'useCase') && canRelate('import', 'package', 'package') && !canRelate('include', 'actor', 'useCase'));
  log('Diagram plumbing (flows, transitions, messages) cannot be traced to', !canRelate('trace', 'requirement', 'flow') && !canRelate('trace', 'requirement', 'transition') && canRelate('trace', 'requirement', 'state'));

  const k = buildKestrel(createModel());
  const by = (/** @type {string} */ name) => /** @type {any} */ (k.all().find((e) => e.name === name));

  // ---------- deleting cascades to what can't stand alone ----------
  const thrust = by('Generate thrust');
  const flowsAt = (/** @type {string} */ id) => k.byKind('flow').filter((f) => f.props.from === id || f.props.to === id).length;
  const f0 = flowsAt(thrust.id);
  k.transact('Delete', (tx) => tx.remove(thrust.id));
  log('Deleting an action deletes the flows into and out of it', f0 === 2 && k.byKind('flow').every((f) => f.props.from && f.props.to));
  k.undo();
  log('…and undo brings them back', flowsAt(thrust.id) === 2);
  const survey = by('Survey');
  k.transact('Delete', (tx) => tx.remove(survey.id));
  log('Deleting a state deletes its transitions', k.byKind('transition').every((t) => t.props.from !== survey.id && t.props.to !== survey.id) && k.byKind('transition').length === 6);
  k.undo();
  const lp = k.byKind('lifeline').find((l) => l.name === 'propulsion');
  const m0 = k.byKind('message').length;
  k.transact('Delete', (tx) => tx.remove(/** @type {string} */ (lp?.id)));
  log('Deleting a lifeline deletes its messages', k.byKind('message').length === m0 - 2);
  k.undo();

  // ---------- activity diagrams ----------
  const act = /** @type {any} */ (k.byKind('act')[0]);
  const cn = (/** @type {string} */ name) => actNodeContent(k, by(name), act, 'sysml');
  log('Actions are rounded; initial, final, decision and fork have their shapes and fixed sizes', cn('Store energy').shape === 'round' && cn('Initial').shape === 'circle' && cn('Final').shape === 'bullseye' && cn('Area covered?').shape === 'diamond' && cn('Fork').shape === 'bar' && naturalSize(cn('Initial')).w === 30);
  log('Default control node names are hidden; chosen ones show', cn('Fork').label === '' && cn('Area covered?').label === 'Area covered?');
  log('Lanes are blocks, drawn behind', actNodeContent(k, by('Battery Pack'), act, 'sysml').shape === 'lane' && actNodeContent(k, by('Battery Pack'), act, 'sysml').under === true);
  const ae = actEdgesFor(k, new Set(Object.keys(act.layout.nodes)));
  log('Flows show guards and object items', ae.some((e) => e.label === '[area covered]') && ae.some((e) => e.label === 'DC power') && ae.length === 13);
  log('Flows cannot leave a final node or enter an initial one', actKind.linkKinds(k, by('Final').id, by('Merge').id).length === 0 && actKind.linkKinds(k, by('Merge').id, by('Initial').id).length === 0 && actKind.linkKinds(k, by('Store energy').id, thrust.id).join() === 'control,object');
  const lanes = lanesOf(k, act);
  log('The sample activity has lanes for the blocks its actions are allocated to', lanes.map((l) => k.get(l.id)?.name).sort().join() === 'Battery Pack,Motor,Survey Payload');
  log('Each allocated action sits in its lane', ['Store energy', 'Generate thrust', 'Capture imagery'].every((n) => { const a = by(n); const lane = laneAt(lanes, act.layout.nodes[a.id]); return lane && k.relsFrom(a.id).some((r) => r.kind === 'allocate' && r.target === lane); }));
  const pos = act.layout.nodes;
  log('The flow reads top to bottom from the initial node; the loop closes back upward', pos[by('Initial').id].y < pos[by('Store energy').id].y && pos[by('Merge').id].y < pos[thrust.id].y && pos[thrust.id].y < pos[by('Fork').id].y && pos[by('Fork').id].y < pos[by('Join').id].y);
  // drag an unallocated action into the Motor lane
  const lift = by('Generate lift');
  const motorLane = /** @type {any} */ (lanes.find((l) => k.get(l.id)?.name === 'Motor')).r;
  k.transact('Move into lane', (tx) => { tx.place(act.id, { [lift.id]: { x: motorLane.x + 20, y: motorLane.y + 60, w: 170, h: 50 } }); syncAllocations(k, tx, /** @type {any} */ (k.get(act.id)), [lift.id]); });
  log('Moving an action into a lane allocates it to that block', k.relsFrom(lift.id).some((r) => r.kind === 'allocate' && k.get(/** @type {string} */ (r.target))?.name === 'Motor'));
  k.transact('Out', (tx) => { tx.place(act.id, { [lift.id]: { x: motorLane.x - 400, y: motorLane.y + 60, w: 170, h: 50 } }); syncAllocations(k, tx, /** @type {any} */ (k.get(act.id)), [lift.id]); });
  log('…and moving it out of every lane takes the allocation away', !k.relsFrom(lift.id).some((r) => r.kind === 'allocate'));
  k.undo(); k.undo();
  const store = by('Store energy');
  const a0 = k.byKind('allocate').length;
  k.transact('Lane', (tx) => { tx.place(act.id, { [by('ESC').id]: { x: 5000, y: 0, w: 260, h: 600 } }); syncAllocations(k, tx, /** @type {any} */ (k.get(act.id)), [by('ESC').id]); });
  log('Adding or resizing a lane never changes allocations', k.byKind('allocate').length === a0 && k.relsFrom(store.id).some((r) => r.kind === 'allocate'));
  k.undo();
  const flow = k.transact('Link', (tx) => actKind.makeLink(k, tx, act, 'object', store.id, by('Capture imagery').id));
  log('Drawing a flow creates a flow element in the activity', k.get(flow)?.kind === 'flow' && k.get(flow)?.owner === act.owner && k.get(flow)?.props.flowKind === 'object');
  k.undo();
  const nodesA = Object.keys(pos).map((id) => ({ id, w: pos[id].w, h: pos[id].h }));
  const laid = layoutActivity(k, nodesA, ae.map((e) => ({ from: e.from, to: e.to, kind: e.kind })), lanes.map((l) => l.id));
  const steps = Object.keys(laid).filter((id) => k.get(id)?.kind !== 'partDef');
  log('Tidy keeps steps apart', steps.every((a, i) => steps.every((b, j) => i === j || !overlap(laid[a], laid[b]))));

  // ---------- state machines ----------
  const stm = /** @type {any} */ (k.byKind('stm')[0]);
  const flying = by('Flying');
  log('A composite state is drawn behind its inner states, and lists do / entry', stmNodeContent(k, flying, stm, 'sysml').under === true && stmNodeContent(k, flying, stm, 'sysml').compartments[0].rows[0] === 'do / hold attitude');
  const stateNamed = (/** @type {string} */ name) => /** @type {any} */ (k.byKind('state').find((e) => e.name === name));
  log('Pseudo-states have their shapes', stmNodeContent(k, stateNamed('Initial'), stm, 'sysml').shape === 'circle' && stmNodeContent(k, stateNamed('Off'), stm, 'sysml').shape === 'bullseye');
  const idleArmed = /** @type {any} */ (k.byKind('transition').find((t) => k.get(t.props.from)?.name === 'Idle'));
  log('Transitions read "trigger [guard] / effect"', transitionLabel(idleArmed) === 'armCmd [preflight ok]' && stmEdgesFor(k, new Set(Object.keys(stm.layout.nodes))).length === 9);
  const sp = stm.layout.nodes;
  log('Inner states sit inside their composite', ['Climb', 'Survey', 'Return', 'Start'].every((n) => inside(sp[by(n).id], sp[flying.id])));
  const idle = by('Idle');
  // a small box in Flying's own margin (not over any state inside it)
  const margin = { x: sp[flying.id].x + 4, y: sp[flying.id].y + sp[flying.id].h - 14, w: 12, h: 10 };
  k.transact('Nest', (tx) => { tx.place(stm.id, { [idle.id]: { ...margin, w: 40, h: 30, x: margin.x - 14, y: margin.y - 10 } }); reparentStates(k, tx, /** @type {any} */ (k.get(stm.id)), [idle.id]); });
  log('Dragging a state into another nests it in the model', k.get(idle.id)?.owner === flying.id, k.get(/** @type {string} */ (k.get(idle.id)?.owner))?.name);
  k.undo();
  k.transact('Onto', (tx) => { tx.place(stm.id, { [idle.id]: { ...sp[by('Climb').id], x: sp[by('Climb').id].x + 10 } }); reparentStates(k, tx, /** @type {any} */ (k.get(stm.id)), [idle.id]); });
  log('Dropping a state onto a simple state nests it there (making that state composite)', k.get(idle.id)?.owner === by('Climb').id);
  k.transact('Out', (tx) => { tx.place(stm.id, { [idle.id]: { x: -900, y: -900, w: 150, h: 50 } }); reparentStates(k, tx, /** @type {any} */ (k.get(stm.id)), [idle.id]); });
  log('…and dragging it out un-nests it', k.get(idle.id)?.owner === stm.owner);
  k.undo(); k.undo();
  const rg = k.transact('Region', (tx) => tx.create('region', { owner: flying.id, name: 'Main' }));
  k.transact('Into', (tx) => { tx.place(stm.id, { [idle.id]: { ...margin, w: 40, h: 30, x: margin.x - 14, y: margin.y - 10 }, [rg]: sp[flying.id] }); reparentStates(k, tx, /** @type {any} */ (k.get(stm.id)), [idle.id]); });
  log('A state dropped in a state with regions goes into a region', k.get(idle.id)?.owner === rg);
  k.undo(); k.undo();
  const lsAll = layoutStates(k, stm.owner, new Set(Object.keys(sp)), 'sysml', stm);
  const top = Object.keys(lsAll).filter((id) => k.get(id)?.owner === stm.owner);
  log('Tidy nests composites around their states and keeps siblings apart', ['Climb', 'Survey', 'Return'].every((n) => inside(lsAll[by(n).id], lsAll[flying.id])) && top.every((a, i) => top.every((b, j) => i === j || !overlap(lsAll[a], lsAll[b]))));
  log('A region goes in the selected state', stmKind.ownerFor(k, stm, 'region', [flying.id]) === flying.id && stmKind.ownerFor(k, stm, 'region', []) === null);

  // ---------- use cases and packages ----------
  const ucd = /** @type {any} */ (k.byKind('uc')[0]);
  const shownUc = new Set(Object.keys(ucd.layout.nodes));
  log('The use case diagram shows actors, use cases (included and extending too) and the subject', ['Operator', 'Image analyst', 'Fly a survey', 'Take off', 'Return home', 'Process imagery', 'Kestrel Air Vehicle'].every((n) => shownUc.has(by(n).id)));
  log('Actors are figures, use cases ellipses, the subject a boundary', ucNodeContent(k, by('Operator'), ucd, 'sysml').shape === 'actor' && ucNodeContent(k, by('Take off'), ucd, 'sysml').shape === 'ellipse' && ucNodeContent(k, by('Kestrel Air Vehicle'), ucd, 'sysml').shape === 'boundary');
  const ue = ucEdgesFor(k, shownUc);
  log('Associations are plain lines; include and extend are «stereotyped» dependencies', ue.filter((e) => e.kind === 'assoc').length === 2 && ue.some((e) => e.label === '«include»') && ue.some((e) => e.label === '«extend»'));
  const un = ucd.layout.nodes;
  log('The subject\'s use cases sit inside its boundary', ['Fly a survey', 'Take off', 'Return home'].every((n) => inside(un[by(n).id], un[by('Kestrel Air Vehicle').id])));
  const proc = by('Process imagery');
  k.transact('In', (tx) => { tx.place(ucd.id, { [proc.id]: { ...un[by('Take off').id], y: un[by('Take off').id].y + 5 } }); resubject(k, tx, /** @type {any} */ (k.get(ucd.id)), [proc.id]); });
  log('Dropping a use case in a boundary makes that block its subject', k.get(proc.id)?.owner === by('Kestrel Air Vehicle').id);
  k.transact('Out', (tx) => { tx.place(ucd.id, { [proc.id]: { x: -800, y: 0, w: 170, h: 70 } }); resubject(k, tx, /** @type {any} */ (k.get(ucd.id)), [proc.id]); });
  log('…and taking it out puts it back in the diagram\'s package', k.get(proc.id)?.owner === ucd.owner);
  k.undo(); k.undo();
  const lay = layoutUseCases(k, Object.keys(un).map((id) => ({ id, w: un[id].w, h: un[id].h })));
  log('Tidy puts actors left of everything else', k.byKind('actor').every((a) => Object.keys(lay).every((id) => k.get(id)?.kind === 'actor' || lay[a.id].x < lay[id].x)));
  const pkgd = /** @type {any} */ (k.byKind('pkg')[0]);
  const logical = k.layers()[2];
  const pc = pkgNodeContent(k, logical, pkgd, 'sysml');
  log('Packages are folders listing their members (up to 8, then "and N more")', pc.shape === 'folder' && pc.compartments[0].rows.length === 9 && /^and \d+ more$/.test(pc.compartments[0].rows[8]));
  log('Imports show as «import» dependencies', pkgEdgesFor(k, new Set(Object.keys(pkgd.layout.nodes))).filter((e) => e.label === '«import»').length === 4);

  // ---------- sequence diagrams ----------
  const sortie = by('Survey sortie');
  const L = sdLayout(k, sortie.id);
  log('Lifelines run left to right in order', L.lifelines.map((l) => l.name).join() === 'operator,avionics,propulsion,payload' && L.lifelines.every((l, i) => !i || /** @type {number} */ (L.x.get(l.id)) > /** @type {number} */ (L.x.get(L.lifelines[i - 1].id))));
  log('A lifeline shows what it represents', L.label(L.lifelines[1]) === 'avionics : Avionics Suite' && L.label(L.lifelines[0]) === 'operator : Operator');
  log('Messages run top to bottom in model order, fragments included', L.messages.map((x) => x.el.name).join() === 'uploadPlan(route),arm(),throttle(takeoff),setThrust(level),capture(),imageStored,batteryWarning,nextLeg(),landed' && L.messages.every((x, i) => !i || x.y > L.messages[i - 1].y));
  const loopF = /** @type {any} */ (L.fragments.find((f) => f.el.props.operator === 'loop'));
  log('A fragment frames exactly its messages', L.messages.filter((x) => x.y > loopF.y0 && x.y < loopF.y1).map((x) => x.el.name).join() === 'setThrust(level),capture(),imageStored');
  log('Self messages loop back to their own lifeline', L.messages.some((x) => x.el.name === 'nextLeg()' && x.from === x.to));
  log('Every operand is a place a message can be dropped', L.fragments.flatMap((f) => f.operands).every((o) => L.slots.some((s) => s.owner === o.el.id)));

  // ---------- text ----------
  const F = k.layers()[1].id, Lg = k.layers()[2].id;
  const ftext = printPackage(k, F).text, ltext = printPackage(k, Lg).text;
  log('Activities print as SysML v2 successions, flows and control nodes', ftext.includes("succession first Initial then 'Store energy';") && ftext.includes("flow from 'Store energy' to Merge {") && ftext.includes("decide 'Area covered?';") && ftext.includes('fork Fork;'));
  log('States and transitions print with accept / if / do', ltext.includes('transition first Idle accept "armCmd" if "preflight ok" then Armed;') && ltext.includes('state Flying {'));
  log('Interactions, use cases and imports print too', ltext.includes("message 'arm()' from operator to avionics;") && ltext.includes("use case 'Take off';") && ltext.includes('import Requirements::*;'));
  log('Parsing reads them back', parse("package P { transition T first A accept \"go\" if \"ok\" do \"x\" then B; import Q::*; use case U { include V; } }")[0].children.length === 2);
  log('A transition to an unknown state is an error with its line', throws(() => buildSnapshot(k, [{ layerId: Lg, node: parseLayer(ltext.replace('then Armed;', 'then Armd;')) }])));
  applyLayerText(k, Lg, ltext.replace('transition first Idle accept "armCmd"', 'transition first Idle accept "armCommand"'));
  log('Editing a transition in text changes its trigger and keeps it the same transition', k.get(idleArmed.id)?.props.trigger === 'armCommand');
  k.undo();
  log('Kestrel prints the same after all this (every edit undone cleanly)', printPackage(k, Lg).text === ltext && printPackage(k, F).text === ftext);
}
