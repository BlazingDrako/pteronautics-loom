import { createModel, ModelError } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { parseUnit, convert, toSI, fromSI, isUnit, sameDim, dimName, formatNumber, parseQuantity, UnitError } from '../../src/analysis/units.js';
import { parseExpr, evaluate, namesIn, isEquation, ExprError } from '../../src/analysis/expr.js';
import { analyze, analysisOf, addMissingParams, showVar } from '../../src/analysis/solver.js';
import { checkRequirement, checksOf } from '../../src/analysis/verify.js';
import { requirementStatus } from '../../src/model/trace.js';
import { createActivityRun, checkActivity, decide } from '../../src/sim/activity.js';
import { createMachineRun, checkMachine } from '../../src/sim/statemachine.js';
import { createSequenceRun, checkSequence } from '../../src/sim/sequence.js';
import { printModel } from '../../src/text/printer.js';
import { parseLayer, buildSnapshot, applyLayerText } from '../../src/text/build.js';
import { snapshot } from '../../src/model/serialize.js';
import { parNodeContent, parEdgesFor, layoutPar, parKind } from '../../src/canvas/par.js';

/** @param {number} a @param {number} b */
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
/** @param {() => any} fn @param {any} E */
const throwsA = (fn, E) => { try { fn(); return false; } catch (e) { return e instanceof E; } };

/** @param {import('../run.js').Log} log */
export function analysisTests(log) {
  // ---------- units ----------
  log('Units convert: 16 Ah is 57,600 C; 1 kWh is 3.6 MJ; 36 km/h is 10 m/s', near(toSI(16, 'Ah'), 57600) && near(toSI(1, 'kWh'), 3.6e6) && near(convert(36, 'km/h', 'm/s'), 10));
  log('Compound units with powers and superscripts', sameDim(parseUnit('m/s^2').d, parseUnit('N/kg').d) && sameDim(parseUnit('kg·m²/s²').d, parseUnit('J').d) && near(parseUnit('km2').f, 1e6) && near(parseUnit('mm²').f, 1e-6));
  log('Prefixes on SI units (mAh, kW, µs, GHz), and the ones that are not prefixes (min, h, nmi)', near(toSI(1, 'mAh'), 3.6) && near(toSI(1, 'µs'), 1e-6) && near(toSI(2, 'GHz'), 2e9) && near(toSI(1, 'min'), 60) && near(toSI(1, 'nmi'), 1852));
  log('Percent, degrees and rpm are understood', near(toSI(95, '%'), 0.95) && near(toSI(180, 'deg'), Math.PI) && near(convert(60, 'rpm', 'Hz'), 2 * Math.PI));
  log('Temperatures with an offset convert, but cannot be combined', near(convert(100, '°C', 'K'), 373.15) && near(convert(32, '°F', '°C'), 0, 1e-9) && throwsA(() => parseUnit('°C/s'), UnitError));
  log('Converting between different kinds of quantity is refused', throwsA(() => convert(1, 'Wh', 'Ah'), UnitError) && !isUnit('furlongs') && isUnit(''));
  log('Dimensions have names', dimName(parseUnit('Wh').d) === 'energy' && dimName(parseUnit('m/s').d) === 'speed' && dimName(parseUnit('W/kg').d) === 'specific power');
  log('Numbers are shown short', formatNumber(674.88) === '674.9' && formatNumber(3.21371) === '3.214' && formatNumber(0) === '0' && formatNumber(1.5e9) === '1.5e9');
  const q = parseQuantity('3.5 [h]'), q2 = parseQuantity('48 V');
  log('Quantities read from text', q?.value === 3.5 && q.unit === 'h' && q2?.unit === 'V' && parseQuantity('abc') === null && parseQuantity('3 furlongs') === null);

  // ---------- expressions ----------
  const ev = (/** @type {string} */ src, /** @type {Record<string, any>} */ vars = {}) => evaluate(parseExpr(src), (n) => vars[n]);
  log('Arithmetic with precedence and powers', near(/** @type {any} */ (ev('2 + 3 * 4 ^ 2')).v, 50) && near(/** @type {any} */ (ev('-(2 + 3) / 5')).v, -1) && near(/** @type {any} */ (ev('2^-1')).v, 0.5));
  log('Numbers with units, converted to SI', near(/** @type {any} */ (ev('3 [h]')).v, 10800) && near(/** @type {any} */ (ev('20%')).v, 0.2) && near(/** @type {any} */ (ev('1 [kWh] / 1 [h]')).v, 1000));
  log('Comparisons and logic', ev('3 [h] >= 180 [min]') === true && ev('1 [m] < 1 [ft]') === false && ev('not (1 > 2) and (true or false)') === true && ev('2 ≤ 3') === true);
  log('Functions keep track of units', near(/** @type {any} */ (ev('sqrt(16 [m^2])')).v, 4) && sameDim(/** @type {any} */ (ev('sqrt(16 [m^2])')).d, parseUnit('m').d) && near(/** @type {any} */ (ev('max(1 [km], 300 [m])')).v, 1000));
  log('Adding hours to kilograms is an error, not an answer', throwsA(() => ev('1 [h] + 1 [kg]'), ExprError) && throwsA(() => ev('2 [h] > 3'), ExprError) && ev('x > 0', { x: { v: 2, d: parseUnit('h').d } }) === true);
  log('Names can be paths and quoted', [...namesIn(parseExpr("propulsion.battery.capacity * 'cell count'"))].join() === 'propulsion.battery.capacity,cell count');
  log('Syntax errors have a position', (() => { try { parseExpr('a + * b'); return false; } catch (e) { return e instanceof ExprError && /** @type {any} */ (e).pos === 4; } })());
  log('Unknown names are reported', throwsA(() => ev('foo + 1'), ExprError) && isEquation(parseExpr('t = E / P')) && !isEquation(parseExpr('t >= 3')));

  // ---------- the solver on Kestrel ----------
  const k = buildKestrel(createModel());
  const by = (/** @type {string} */ name, kind = '') => /** @type {any} */ (k.all().find((e) => e.name === name && (!kind || e.kind === kind)));
  const av = by('Kestrel Air Vehicle', 'partDef'), batt = by('Battery Pack', 'partDef');
  const bat = analyze(k, batt.id);
  const usable = [...bat.vars.values()].find((v) => v.name === 'usableEnergy');
  log('The battery computes its usable energy: 16 Ah × 44.4 V × 95% = 674.9 Wh', usable?.source === 'computed' && near(/** @type {number} */ (usable.value), 16 * 44.4 * 0.95, 1e-9), showVar(/** @type {any} */ (usable)));
  const air = analyze(k, av.id);
  const endur = air.byName.get('endurance');
  log('The air vehicle chains it through its parts: endurance = 674.9 Wh / 210 W = 3.21 h', endur?.source === 'computed' && near(/** @type {number} */ (endur.value), 16 * 44.4 * 0.95 / 210, 1e-9) && air.byName.get('propulsion.battery.usableEnergy')?.source === 'computed', showVar(/** @type {any} */ (endur)));
  log('A solved model has no problems', !air.problems.length && !bat.problems.length, JSON.stringify(air.problems));
  log('Values are keyed by their path through parts', !!air.vars.get([by('propulsion', 'part').id, by('battery', 'part').id, by('capacity', 'attribute').id].join('/')));
  log('Analysis is cached until the model changes', analysisOf(k, av.id) === analysisOf(k, av.id));

  // solving for an input instead: give endurance, leave power empty
  const power = by('cruisePower');
  k.transact('Swap', (tx) => { tx.setProps(power.id, { value: '' }); tx.setProps(by('endurance').id, { value: '4' }); });
  const inv = analysisOf(k, av.id);
  log('Any value can be the unknown: give endurance 4 h, and power is solved (168.7 W)', near(/** @type {number} */ (inv.byName.get('cruisePower')?.value), 16 * 44.4 * 0.95 / 4, 1e-9));
  k.undo();
  // over-determined: give endurance too, so it conflicts
  k.transact('Conflict', (tx) => tx.setProps(by('endurance').id, { value: '5' }));
  const bad = analysisOf(k, av.id);
  log('A value that breaks an equation is flagged as a conflict', bad.equations.some((e) => e.status === 'conflict' && /should be 3\.214 h but is 5 h/.test(e.message)), bad.equations.map((e) => e.message).join('|'));
  k.undo();
  // unit mismatch in an equation
  const cbRange = by('Endurance', 'constraintDef');
  k.transact('Bad units', (tx) => tx.setProps(cbRange.id, { expr: 't = E * P' }));
  log('An equation whose sides measure different things is an error', analysisOf(k, av.id).equations.some((e) => e.status === 'error' && /left side is time but the right side/.test(e.message)));
  k.undo();
  // binding a charge to an energy parameter
  const bindE = k.byKind('binding').find((b) => b.owner === av.id && k.get(b.props.param)?.name === 'E');
  k.transact('Bad binding', (tx) => { tx.setProps(by('E', 'attribute').id, { unit: 'Ah' }); });
  log('Binding values of different kinds is reported', analysisOf(k, batt.id).problems.some((p) => /measure different|is charge but is bound|is energy/.test(p.message)) || analysisOf(k, av.id).problems.length > 0);
  k.undo();
  log('Bindings are kept as an end through parts to a value', !!bindE && bindE.props.value.path.length === 2 && k.get(bindE.props.value.port)?.name === 'usableEnergy');

  // simultaneous equations
  const sys = createModel();
  const L = /** @type {string} */ (sys.layers().find((l) => l.layer === 'l')?.id);
  let blk = '';
  sys.transact('Build', (tx) => {
    blk = tx.create('partDef', { owner: L, name: 'Pair' });
    const x = tx.create('attribute', { owner: blk, name: 'x', props: { unit: 'm' } });
    const y = tx.create('attribute', { owner: blk, name: 'y', props: { unit: 'm' } });
    const s = tx.create('attribute', { owner: blk, name: 'sum', props: { value: '10', unit: 'm' } });
    const d = tx.create('attribute', { owner: blk, name: 'diff', props: { value: '4', unit: 'm' } });
    const mk = (/** @type {string} */ name, /** @type {string} */ expr) => {
      const def = tx.create('constraintDef', { owner: L, name, props: { expr } });
      addMissingParams(sys, tx, def);
      for (const p of sys.children(def)) tx.setProps(p.id, { unit: 'm' });
      return def;
    };
    const d1 = mk('Sum', 'a + b = c'), d2 = mk('Diff', 'a - b = c');
    for (const [def, c] of [[d1, s], [d2, d]]) {
      const use = tx.create('constraint', { owner: blk, name: `use${sys.get(def)?.name}`, props: { type: def } });
      const p = (/** @type {string} */ n) => /** @type {string} */ (sys.children(def).find((q) => q.name === n)?.id);
      tx.create('binding', { owner: blk, name: 'b1', props: { constraint: use, param: p('a'), value: { path: [], port: x } } });
      tx.create('binding', { owner: blk, name: 'b2', props: { constraint: use, param: p('b'), value: { path: [], port: y } } });
      tx.create('binding', { owner: blk, name: 'b3', props: { constraint: use, param: p('c'), value: { path: [], port: c } } });
    }
  });
  const pair = analyze(sys, blk);
  log('Equations that share unknowns are solved together (x + y = 10, x − y = 4)', near(/** @type {number} */ (pair.byName.get('x')?.value), 7, 1e-7) && near(/** @type {number} */ (pair.byName.get('y')?.value), 3, 1e-7), JSON.stringify(pair.problems));
  log('New equations bring their parameters (from the names in them)', sys.byKind('constraintDef').every((d) => sys.children(d.id).map((c) => c.name).sort().join() === 'a,b,c'));
  sys.transact('Under', (tx) => tx.setProps(/** @type {string} */ (sys.children(blk).find((c) => c.name === 'sum')?.id), { value: '' }));
  log('Too few given values is reported, not guessed', analysisOf(sys, blk).problems.some((p) => /more given value/.test(p.message)));
  log('A binding must end at a value of the block (or of a part)', throwsA(() => sys.transact('x', (tx) => tx.create('binding', { owner: blk, name: 'bad', props: { constraint: /** @type {string} */ (sys.byKind('constraint')[0].id), param: /** @type {string} */ (sys.byKind('constraintDef')[0] && sys.children(sys.byKind('constraintDef')[0].id)[0].id), value: { path: [], port: blk } } })), ModelError));

  // ---------- live verification ----------
  const reqE = by('Endurance', 'requirement'), reqU = by('Usable energy', 'requirement');
  const c1 = checkRequirement(k, reqE);
  log('Endurance ≥ 3 h is checked live against the computed value, and met', c1.verdict === 'pass' && /endurance = 3\.214 h \(computed\)/.test(c1.message), c1.message);
  log('Usable energy ≥ 650 Wh is met by the battery', checkRequirement(k, reqU).verdict === 'pass');
  k.transact('Thirstier', (tx) => tx.setProps(power.id, { value: '250' }));
  log('A design change that breaks a requirement turns it red at once', checksOf(k).get(reqE.id)?.verdict === 'fail' && requirementStatus(k).get(reqE.id)?.failed === true);
  k.undo();
  log('A met check counts as passed verification', requirementStatus(k).get(reqE.id)?.passed === true && requirementStatus(k).get(reqE.id)?.verified === true);
  k.transact('Typo', (tx) => tx.setProps(reqE.id, { check: 'endurence >= 3 [h]' }));
  const c2 = checksOf(k).get(reqE.id);
  log('A check that names an unknown value says so, and is neither pass nor fail', c2?.verdict === 'error' && /No value for "endurence"/.test(c2.message) && !requirementStatus(k).get(reqE.id)?.failed, c2?.message);
  k.undo();
  k.transact('Limit', (tx) => { tx.create('attribute', { owner: reqE.id, name: 'minEndurance', props: { value: '200', unit: 'min' } }); tx.setProps(reqE.id, { check: 'endurance >= minEndurance' }); });
  log('A check can use the requirement\'s own values (200 min)', checksOf(k).get(reqE.id)?.verdict === 'fail');
  k.undo();

  // ---------- text ----------
  const files = printModel(k);
  const logical = /** @type {string} */ (files.find((f) => f.layer === 'l')?.text);
  log('Equations, bindings and value types read like SysML v2', logical.includes("constraint def 'Battery energy' {") && logical.includes('constraint energy : \'Battery energy\';') && logical.includes('bind range.E = propulsion.battery.usableEnergy;') && logical.includes('attribute def Energy {') && logical.includes('expr = "E = C * V * dod";'));
  const reqText = /** @type {string} */ (files.find((f) => f.layer === 'r')?.text);
  log('Requirement checks are kept in the text', reqText.includes('check = "endurance >= 3 [h]";'));
  const rebuilt = buildSnapshot(k, files.map((f) => ({ layerId: f.id, node: parseLayer(f.text) })));
  log('…and round-trip exactly', JSON.stringify(rebuilt.elements) === JSON.stringify(snapshot(k).elements));
  const L2 = /** @type {string} */ (k.layers().find((l) => l.layer === 'l')?.id);
  let err = '';
  try { applyLayerText(k, L2, logical.replace('bind range.P = cruisePower;', 'bind range.Q = cruisePower;')); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  log('Binding a parameter that does not exist is a text error', /has no parameter named Q/.test(err), err);

  // ---------- parametric diagram ----------
  const par = by('Endurance analysis', 'par');
  const keys = Object.keys(par.layout.nodes);
  log('The parametric diagram shows the equation and the three values it binds', keys.length === 4 && keys.some((x) => x.split('/').length === 3));
  const edges = parEdgesFor(k, new Set(keys));
  log('Bindings are drawn as lines labelled with the parameter', edges.length === 3 && edges.map((e) => e.label).sort().join() === 'E,P,t');
  const endKey = /** @type {string} */ (keys.find((x) => k.get(x)?.name === 'endurance'));
  const nc = parNodeContent(k, k.get(endKey), par, 'sysml', endKey);
  log('A computed value shows its number and says so', nc.tone === 'computed' && /3\.214 h\s+computed/.test(nc.compartments[0].rows[0]), nc.compartments[0]?.rows[0]);
  const pos = layoutPar(k, par, keys.map((id) => ({ id, w: 200, h: 60 })));
  const cx = pos[by('range', 'constraint').id].x, an0 = analysisOf(k, av.id);
  log('Layout: given values left of the equation, computed values right', Object.entries(pos).filter(([id]) => k.get(id.split('/').pop() || '')?.kind === 'attribute').every(([id, r]) => (an0.vars.get(id)?.source === 'given' ? r.x < cx : r.x > cx)));
  log('Dragging a value to an equation offers its parameters', parKind.linkKinds(k, endKey, by('range', 'constraint').id).length === 3);

  // ---------- running an activity ----------
  const fly = by('Fly the survey', 'action');
  const run = createActivityRun(k, fly.id);
  run.step();
  log('A run starts at the initial node with a token on its flow', run.tokens().size === 1 && run.state === 'running');
  for (let i = 0; i < 10 && run.state === 'running'; i++) run.step();
  log('Actions run in order, the fork runs three at once, the join waits for all three', run.fired().get(by('Generate lift', 'action').id) === 1 && run.fired().get(by('Join', 'controlNode').id) === 1 && run.log.some((e) => /Generate lift · Control attitude · Capture imagery|Generate lift.*Control attitude.*Capture imagery/.test(e.text)));
  log('A decision it cannot work out from values asks you', run.state === 'choose' && run.pending?.options.length === 2, run.state);
  const loopBack = /** @type {any} */ (run.pending?.options.find((f) => /else/.test(f.guard)));
  run.choose(loopBack.id);
  for (let i = 0; i < 10 && run.state === 'running'; i++) run.step();
  log('Choosing else goes round the loop again', (run.fired().get(by('Generate thrust', 'action').id) || 0) === 2 && run.state === 'choose');
  run.choose(/** @type {any} */ (run.pending?.options.find((f) => !/else/.test(f.guard))).id);
  for (let i = 0; i < 5 && run.state === 'running'; i++) run.step();
  log('…and the other way reaches the final node and ends', run.state === 'done' && run.tokens().size === 0);
  log('Guards that are expressions decide by themselves', decide([{ id: 'a', from: '', to: '', guard: 'battery > 20%', item: '', name: '' }, { id: 'b', from: '', to: '', guard: 'else', item: '', name: '' }], new Map([['battery', { v: 0.1, d: parseUnit('').d }]])).take?.id === 'b');
  const chk = checkActivity(k, fly.id);
  log('Check: the survey flight is sound', chk[0].level === 'ok' || !chk.some((f) => f.level === 'error'), chk.map((f) => f.message).join(' | '));
  // break it: a join after a decision can never complete
  const covered = by('Area covered?', 'controlNode'), join = by('Join', 'controlNode');
  k.transact('Bad join', (tx) => { const j2 = tx.create('controlNode', { owner: fly.id, name: 'Join 2', props: { nodeKind: 'join' } }); for (const f of k.byKind('flow').filter((x) => x.props.from === covered.id)) tx.setProps(f.id, { to: j2 }); tx.create('flow', { owner: fly.id, name: 'j2 → end', props: { from: j2, to: by('Final', 'controlNode').id } }); });
  const chk2 = checkActivity(k, fly.id);
  log('Check finds a join after a decision that can never complete (a deadlock)', chk2.some((f) => f.level === 'error' && /stuck at Join 2/.test(f.message)), chk2.map((f) => f.message).join(' | '));
  k.undo();
  k.transact('Orphan', (tx) => tx.create('action', { owner: fly.id, name: 'Orphan step' }));
  log('Check finds steps nothing flows into', checkActivity(k, fly.id).some((f) => /Nothing flows into Orphan step/.test(f.message)));
  k.undo();
  void join;

  // ---------- running a state machine ----------
  const m1 = createMachineRun(k, av.id);
  m1.start();
  const nameOf = (/** @type {Set<string>} */ set) => [...set].map((id) => k.get(id)?.name).sort().join();
  log('The machine starts in Idle', nameOf(m1.active()) === 'Idle' && m1.events().join() === 'armCmd');
  m1.send('armCmd');
  log('An event moves it, running entry actions', nameOf(m1.active()) === 'Armed' && m1.log.at(-1)?.text.includes('entry / spin up motors') === true, m1.log.at(-1)?.text);
  m1.send('takeoffCmd');
  log('Entering a composite state enters its initial state too', nameOf(m1.active()) === 'Climb,Flying', nameOf(m1.active()));
  m1.send('altitudeReached'); m1.send('batteryLow');
  log('A transition\'s effect runs between exit and entry', nameOf(m1.active()) === 'Flying,Return' && /exit|do warn operator.*enter Return/.test(/** @type {string} */ (m1.log.at(-1)?.text)), m1.log.at(-1)?.text);
  m1.send('touchdown');
  log('Leaving a composite state leaves what is inside it', nameOf(m1.active()) === 'Landed');
  m1.send('powerOff');
  log('Reaching the top final state finishes the machine', m1.state === 'done');
  const m2 = createMachineRun(k, av.id);
  m2.start();
  m2.switches.set('preflight ok', false);
  m2.send('armCmd');
  log('A guard that does not hold stops the transition', nameOf(m2.active()) === 'Idle');
  const sc = checkMachine(k, av.id);
  log('Check: every state of the air vehicle can be reached and left', sc[0].level === 'ok', sc.map((f) => f.message).join(' | '));
  k.transact('Dead end', (tx) => { tx.create('state', { owner: av.id, name: 'Lost' }); tx.create('state', { owner: av.id, name: 'Stuck' }); const s = k.children(av.id).find((c) => c.name === 'Idle'); const st = k.children(av.id).find((c) => c.name === 'Stuck'); tx.create('transition', { owner: av.id, name: 'x', props: { from: /** @type {any} */ (s).id, to: /** @type {any} */ (st).id, trigger: 'fault' } }); });
  const sc2 = checkMachine(k, av.id);
  log('Check finds unreachable states and dead ends', sc2.some((f) => /Lost can never be reached/.test(f.message)) && sc2.some((f) => /Once in Stuck, nothing can happen/.test(f.message)), sc2.map((f) => f.message).join(' | '));
  k.undo();

  // ---------- playing a scenario ----------
  const sortie = by('Survey sortie', 'interaction');
  const sq = createSequenceRun(k, sortie.id);
  sq.step(); sq.step(); sq.step();
  log('Messages play in order', k.get(/** @type {string} */ (sq.current()))?.name === 'throttle(takeoff)');
  sq.step();
  log('A loop asks whether to go round', sq.state === 'choose' && sq.pending?.kind === 'loop');
  sq.answer(/** @type {any} */ (sq.pending?.options[0].value));
  sq.step(); sq.step(); sq.step();
  log('Inside the loop, its messages play', k.get(/** @type {string} */ (sq.current()))?.name === 'imageStored');
  sq.step();
  log('At the end of the loop it asks again', sq.state === 'choose' && sq.pending?.kind === 'loop');
  sq.answer('');
  sq.step();
  log('An alt asks which case', sq.state === 'choose' && sq.pending?.kind === 'alt' && sq.pending.options.length === 2);
  sq.answer(/** @type {any} */ (sq.pending?.options[1].value));
  sq.step();
  log('…and plays that case only', k.get(/** @type {string} */ (sq.current()))?.name === 'nextLeg()');
  sq.step(); sq.step();
  log('The scenario ends after the last message', sq.state === 'done' && sq.played().size === 8, `${sq.state} ${sq.played().size}`);
  const qc = checkSequence(k, sortie.id);
  log('Check: the survey sortie is consistent', qc[0].level === 'ok', qc.map((f) => f.message).join(' | '));
  k.transact('Whole vehicle', (tx) => tx.setProps(by('avionics', 'lifeline').id, { represents: av.id }));
  const qc2 = checkSequence(k, sortie.id);
  log('Check notes messages the receiver\'s state machine never accepts', qc2.some((f) => f.level === 'info' && /no transition triggered by uploadPlan/.test(f.message)) && !qc2.some((f) => f.level === 'error'), qc2.map((f) => f.message).join(' | '));
  k.undo();
  const stored = by('imageStored', 'message');
  k.transact('Bad reply', (tx) => tx.setProps(stored.id, { from: by('avionics', 'lifeline').id, to: by('payload', 'lifeline').id }));
  log('Check finds a reply with no call before it', checkSequence(k, sortie.id).some((f) => /is a reply, but/.test(f.message)));
  k.undo();
}
