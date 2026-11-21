// The Kestrel UAS sample: a small but complete RFLP model, used for "Start from a sample"
// and as a test fixture. Values are illustrative.
import { populate, populateReq } from '../canvas/populate.js';
import { packIbd } from '../canvas/ibd.js';
import { populateAct } from '../canvas/act.js';
import { populateStm } from '../canvas/stm.js';
import { populateUc, populatePkg } from '../canvas/uc.js';
import { populatePar } from '../canvas/par.js';

/** @param {import('./model.js').Model} m */
export function buildKestrel(m) {
  const [R, F, L, P] = m.layers().map((l) => l.id);
  /** @type {any} */
  let avIbdArgs = null;
  m.transact('Create the Kestrel sample', (tx) => {
    tx.rename(m.root().id, 'Kestrel UAS');

    // Requirements
    const needs = tx.create('package', { owner: R, name: 'Stakeholder needs', props: { idPrefix: 'SN-' } });
    const sn1 = tx.create('requirement', { owner: needs, name: 'Survey a large site per sortie', props: { reqId: 'SN-01', text: 'The operator shall be able to survey 40 km² in one sortie.', priority: 'Must' } });
    const sn2 = tx.create('requirement', { owner: needs, name: 'Carry a mapping camera', props: { reqId: 'SN-02', text: 'The operator shall be able to fly a survey-grade mapping camera.', priority: 'Must' } });
    const sys = tx.create('package', { owner: R, name: 'System requirements', props: { idPrefix: 'REQ-' } });
    const endur = tx.create('requirement', { owner: sys, name: 'Endurance', props: { reqId: 'REQ-PRF-001', text: 'The air vehicle shall fly for at least 3.0 h at survey speed.', priority: 'Must', method: 'Analysis' } });
    const cruise = tx.create('requirement', { owner: sys, name: 'Cruise speed', props: { reqId: 'REQ-PRF-004', text: 'The air vehicle shall cruise at 22 m/s or faster.', priority: 'Should', method: 'Analysis' } });
    const energy = tx.create('requirement', { owner: sys, name: 'Usable energy', props: { reqId: 'REQ-PWR-003', text: 'The battery shall provide at least 650 Wh of usable energy.', priority: 'Must', method: 'Analysis' } });
    const payload = tx.create('requirement', { owner: sys, name: 'Payload capacity', props: { reqId: 'REQ-PLD-002', text: 'The air vehicle shall carry a 2.5 kg camera payload.', priority: 'Must', method: 'Inspection' } });
    const tests = tx.create('package', { owner: R, name: 'Verification' });
    const tEndur = tx.create('testCase', { owner: tests, name: 'Endurance analysis', props: { method: 'Analysis', result: 'Pass' } });
    const tEnergy = tx.create('testCase', { owner: tests, name: 'Battery discharge test', props: { method: 'Test', result: 'Pass' } });
    const tPayload = tx.create('testCase', { owner: tests, name: 'Payload fit check', props: { method: 'Inspection', result: 'Not run' } });
    const tCruise = tx.create('testCase', { owner: tests, name: 'Cruise flight test', props: { method: 'Test', result: 'Fail' } });

    // Functions
    const fly = tx.create('action', { owner: F, name: 'Fly the survey' });
    const thrust = tx.create('action', { owner: fly, name: 'Generate thrust' });
    tx.create('action', { owner: fly, name: 'Generate lift' });
    const store = tx.create('action', { owner: fly, name: 'Store energy' });
    tx.create('action', { owner: fly, name: 'Control attitude' });
    const image = tx.create('action', { owner: fly, name: 'Capture imagery' });

    // Logical architecture
    const power = tx.create('interfaceDef', { owner: L, name: 'DC Power 48 V' });
    tx.create('attribute', { owner: power, name: 'voltage', props: { value: '48', unit: 'V' } });
    const av = tx.create('partDef', { owner: L, name: 'Kestrel Air Vehicle' });
    const prop = tx.create('partDef', { owner: L, name: 'Propulsion System' });
    const avion = tx.create('partDef', { owner: L, name: 'Avionics Suite' });
    const pay = tx.create('partDef', { owner: L, name: 'Survey Payload' });
    tx.create('part', { owner: av, name: 'propulsion', props: { type: prop } });
    tx.create('part', { owner: av, name: 'avionics', props: { type: avion } });
    tx.create('part', { owner: av, name: 'payload', props: { type: pay } });
    const batt = tx.create('partDef', { owner: L, name: 'Battery Pack' });
    tx.create('attribute', { owner: batt, name: 'capacity', props: { value: '16', unit: 'Ah' } });
    tx.create('attribute', { owner: batt, name: 'mass', props: { value: '3.74', unit: 'kg' } });
    const battOut = tx.create('port', { owner: batt, name: 'pwrOut', props: { type: power, direction: 'out' } });
    const ac = tx.create('interfaceDef', { owner: L, name: 'Three-Phase AC' });
    const pwm = tx.create('interfaceDef', { owner: L, name: 'PWM Signal' });
    const esc = tx.create('partDef', { owner: L, name: 'ESC' });
    tx.create('attribute', { owner: esc, name: 'maxCurrent', props: { value: '80', unit: 'A' } });
    const escPwr = tx.create('port', { owner: esc, name: 'pwrIn', props: { type: power, direction: 'in' } });
    const escCmd = tx.create('port', { owner: esc, name: 'cmdIn', props: { type: pwm, direction: 'in' } });

    // A profile: the project's own kinds of element
    const prof = tx.create('profile', { owner: L, name: 'Kestrel profile', props: { doc: 'Stereotypes used across the Kestrel model.' } });
    const crit = tx.create('stereotype', { owner: prof, name: 'Flight critical', props: { extends: 'partDef,part', color: 'coral', icon: '◆', doc: 'A failure of this item can cause the loss of the air vehicle.' } });
    const dal = tx.create('attribute', { owner: crit, name: 'dal', props: { value: 'C', doc: 'Design assurance level, A (most severe) to E.' } });
    tx.create('attribute', { owner: crit, name: 'safetyOwner', props: { value: '' } });
    const cots = tx.create('stereotype', { owner: prof, name: 'COTS', props: { extends: 'partDef', color: 'slate', icon: '▣', doc: 'Bought off the shelf rather than designed here.' } });
    const supplier = tx.create('attribute', { owner: cots, name: 'supplier', props: { value: '' } });
    tx.create('stereotype', { owner: prof, name: 'Safety requirement', props: { extends: 'requirement', color: 'amber', icon: '!' } });
    tx.setProps(batt, { applied: [{ s: crit, tags: { [dal]: 'B' } }] });
    tx.setProps(avion, { applied: [{ s: crit, tags: { [dal]: 'A' } }] });
    tx.setProps(esc, { applied: [{ s: crit }, { s: cots, tags: { [supplier]: 'Supplier A' } }] });
    const escOut = tx.create('port', { owner: esc, name: 'phaseOut', props: { type: ac, direction: 'out' } });
    const motor = tx.create('partDef', { owner: L, name: 'Motor' });
    const motorIn = tx.create('port', { owner: motor, name: 'phaseIn', props: { type: ac, direction: 'in' } });
    const pBattery = tx.create('part', { owner: prop, name: 'battery', props: { type: batt } });
    const pEsc = tx.create('part', { owner: prop, name: 'esc', props: { type: esc } });
    const pMotorPart = tx.create('part', { owner: prop, name: 'motor', props: { type: motor } });
    const throttle = tx.create('port', { owner: prop, name: 'throttle', props: { type: pwm, direction: 'in' } });
    const avCmd = tx.create('port', { owner: avion, name: 'escCmd', props: { type: pwm, direction: 'out' } });
    const energyStore = tx.create('partDef', { owner: L, name: 'Energy Storage' });
    tx.create('attribute', { owner: energyStore, name: 'usableEnergy', props: { unit: 'Wh' } });
    tx.link('generalize', batt, energyStore);
    // inside the propulsion system: power and commands flow through the ESC
    tx.create('connector', { owner: prop, name: 'battery.pwrOut → esc.pwrIn', props: { end1: { path: [pBattery], port: battOut }, end2: { path: [pEsc], port: escPwr }, item: '48 V DC', flow: 'From → To' } });
    tx.create('connector', { owner: prop, name: 'esc.phaseOut → motor.phaseIn', props: { end1: { path: [pEsc], port: escOut }, end2: { path: [pMotorPart], port: motorIn }, item: '3φ AC', flow: 'From → To' } });
    tx.create('connector', { owner: prop, name: 'throttle → esc.cmdIn', props: { end1: { path: [], port: throttle }, end2: { path: [pEsc], port: escCmd }, item: 'throttle', flow: 'From → To' } });
    const dia = tx.create('bdd', { owner: L, name: 'Air vehicle structure' });
    populate(m, tx, dia, [av, prop, avion, pay, batt, esc, motor, energyStore, power]);
    tx.create('ibd', { owner: prop, name: 'Propulsion internals' });
    tx.place(m.byKind('ibd').at(-1)?.id, packIbd(m, prop));
    avIbdArgs = { av, avion, avCmd, throttle };

    // Physical
    const pBatt = tx.create('partDef', { owner: P, name: 'LiPo 12S 16 Ah pack' });
    const pMotor = tx.create('partDef', { owner: P, name: 'BLDC outrunner, 170 Kv' });
    const pCam = tx.create('partDef', { owner: P, name: '61 MP mapping camera' });

    // Relationships
    tx.link('derive', energy, endur);
    tx.link('derive', endur, sn1);
    tx.link('derive', cruise, sn1);
    tx.link('derive', payload, sn2);
    tx.link('verify', tEnergy, energy);
    tx.link('verify', tPayload, payload);
    tx.link('verify', tCruise, cruise);
    tx.link('refine', thrust, cruise);
    tx.link('satisfy', batt, energy);
    tx.link('satisfy', pay, payload);
    tx.link('satisfy', prop, cruise);
    tx.link('verify', tEndur, endur);
    tx.link('allocate', store, batt);
    tx.link('allocate', thrust, motor);
    tx.link('allocate', image, pay);
    tx.link('allocate', batt, pBatt);
    tx.link('allocate', motor, pMotor);
    tx.link('allocate', pay, pCam);

    // requirement views
    const reqDia = tx.create('req', { owner: R, name: 'Endurance and payload' });
    populateReq(m, tx, reqDia, 'sysml', [sn1, sn2, endur, cruise, energy, payload, batt, prop, pay, tEndur, tEnergy, tCruise, tPayload]);
    tx.create('table', { owner: R, name: 'All requirements' });
    tx.create('matrix', { owner: R, name: 'Satisfy matrix', props: { rel: 'satisfy', rows: 'partDef', cols: 'requirement' } });
    tx.create('matrix', { owner: F, name: 'Function allocation', props: { rel: 'allocate', rows: 'action', cols: 'partDef@l' } });
  });
  // the whole air vehicle, with propulsion opened up, and the avionics driving it
  m.transact('Air vehicle internals', (tx) => {
    const { av, avion, avCmd, throttle } = avIbdArgs;
    const pAvion = m.children(av).find((c) => c.kind === 'part' && c.props.type === avion)?.id;
    const pProp = m.children(av).find((c) => c.kind === 'part' && c.name === 'propulsion')?.id;
    tx.create('connector', { owner: av, name: 'avionics.escCmd → propulsion.throttle', props: { end1: { path: [pAvion], port: avCmd }, end2: { path: [pProp], port: throttle }, item: 'throttle : PWM', flow: 'From → To' } });
    const d = tx.create('ibd', { owner: av, name: 'Air vehicle internals' });
    tx.place(d, packIbd(m, av));
  });
  buildBehavior(m);
  buildAnalysis(m);
  m.clear();
  return m;
}

/** Activities, states, use cases, a scenario and the model's organization. @param {import('./model.js').Model} m */
function buildBehavior(m) {
  const [R, F, L, P] = m.layers().map((l) => l.id);
  const by = (/** @type {string} */ name) => /** @type {string} */ (m.all().find((e) => e.name === name)?.id);
  m.transact('Kestrel behavior', (tx) => {
    // ---- the survey flight as an activity, in lanes by allocation ----
    const fly = by('Fly the survey');
    const [thrust, lift, store, attitude, image] = ['Generate thrust', 'Generate lift', 'Store energy', 'Control attitude', 'Capture imagery'].map(by);
    const node = (/** @type {string} */ name, /** @type {string} */ kind) => tx.create('controlNode', { owner: fly, name, props: { nodeKind: kind } });
    const start = node('Initial', 'initial'), merge = node('Merge', 'merge'), fork = node('Fork', 'fork'), join = node('Join', 'join');
    const covered = node('Area covered?', 'decision'), done = node('Final', 'final');
    const flow = (/** @type {string} */ a, /** @type {string} */ b, /** @type {Record<string, any>} */ props = {}) => tx.create('flow', { owner: fly, name: `${m.get(a)?.name} → ${m.get(b)?.name}`, props: { from: a, to: b, ...props } });
    flow(start, store);
    flow(store, merge, { flowKind: 'object', item: 'DC power' });
    flow(merge, thrust);
    flow(thrust, fork);
    flow(fork, lift); flow(fork, attitude); flow(fork, image);
    flow(lift, join); flow(attitude, join); flow(image, join);
    flow(join, covered);
    flow(covered, done, { guard: 'area covered' });
    flow(covered, merge, { guard: 'else' });
    const act = tx.create('act', { owner: fly, name: 'Survey flight' });
    populateAct(m, tx, act);

    // ---- the air vehicle's states ----
    const av = by('Kestrel Air Vehicle');
    const st = (/** @type {string} */ owner, /** @type {string} */ name, /** @type {Record<string, any>} */ props = {}) => tx.create('state', { owner, name, props });
    const s0 = st(av, 'Initial', { stateKind: 'initial' });
    const idle = st(av, 'Idle');
    const armed = st(av, 'Armed', { entry: 'spin up motors' });
    const flying = st(av, 'Flying', { do: 'hold attitude' });
    const f0 = st(flying, 'Start', { stateKind: 'initial' });
    const climb = st(flying, 'Climb');
    const survey = st(flying, 'Survey', { do: 'capture imagery' });
    const ret = st(flying, 'Return', { entry: 'set home waypoint' });
    const landed = st(av, 'Landed', { entry: 'disarm' });
    const end = st(av, 'Off', { stateKind: 'final' });
    const tr = (/** @type {string} */ a, /** @type {string} */ b, /** @type {Record<string, any>} */ props = {}) => tx.create('transition', { owner: /** @type {string} */ (m.get(a)?.owner), name: `${m.get(a)?.name} → ${m.get(b)?.name}`, props: { from: a, to: b, ...props } });
    tr(s0, idle);
    tr(idle, armed, { trigger: 'armCmd', guard: 'preflight ok' });
    tr(armed, flying, { trigger: 'takeoffCmd' });
    tr(f0, climb);
    tr(climb, survey, { trigger: 'altitudeReached' });
    tr(survey, ret, { trigger: 'surveyDone' });
    tr(survey, ret, { trigger: 'batteryLow', effect: 'warn operator' });
    tr(flying, landed, { trigger: 'touchdown' });
    tr(landed, end, { trigger: 'powerOff' });
    const stm = tx.create('stm', { owner: av, name: 'Air vehicle states' });
    populateStm(m, tx, stm);

    // ---- use cases, with the air vehicle as subject ----
    const ucs = tx.create('package', { owner: R, name: 'Use cases' });
    const operator = tx.create('actor', { owner: ucs, name: 'Operator' });
    const analyst = tx.create('actor', { owner: ucs, name: 'Image analyst' });
    const flySurvey = tx.create('useCase', { owner: av, name: 'Fly a survey' });
    const takeOff = tx.create('useCase', { owner: av, name: 'Take off' });
    const goHome = tx.create('useCase', { owner: av, name: 'Return home' });
    const process = tx.create('useCase', { owner: ucs, name: 'Process imagery' });
    tx.link('participate', operator, flySurvey);
    tx.link('participate', analyst, process);
    tx.link('include', flySurvey, takeOff);
    tx.link('extend', goHome, flySurvey);
    tx.link('refine', fly, by('Endurance'));
    const ucd = tx.create('uc', { owner: ucs, name: 'Survey use cases' });
    populateUc(m, tx, ucd);

    // ---- a survey sortie, as a sequence ----
    const sortie = tx.create('interaction', { owner: av, name: 'Survey sortie' });
    const part = (/** @type {string} */ name) => m.children(av).find((c) => c.kind === 'part' && c.name === name)?.id || null;
    const life = (/** @type {string} */ name, /** @type {string | null} */ rep) => tx.create('lifeline', { owner: sortie, name, props: { represents: rep } });
    const lo = life('operator', operator), la = life('avionics', part('avionics')), lp = life('propulsion', part('propulsion')), lc = life('payload', part('payload'));
    const msg = (/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ a, /** @type {string} */ b, kind = 'sync') => tx.create('message', { owner, name, props: { from: a, to: b, msgKind: kind } });
    msg(sortie, 'uploadPlan(route)', lo, la);
    msg(sortie, 'arm()', lo, la);
    msg(sortie, 'throttle(takeoff)', la, lp, 'async');
    const loop = tx.create('fragment', { owner: sortie, name: 'Each waypoint', props: { operator: 'loop' } });
    const each = tx.create('operand', { owner: loop, name: 'Waypoints', props: { guard: 'for each waypoint' } });
    msg(each, 'setThrust(level)', la, lp, 'async');
    msg(each, 'capture()', la, lc);
    msg(each, 'imageStored', lc, la, 'reply');
    const alt = tx.create('fragment', { owner: sortie, name: 'Battery check', props: { operator: 'alt' } });
    const low = tx.create('operand', { owner: alt, name: 'Low', props: { guard: 'battery low' } });
    msg(low, 'batteryWarning', la, lo, 'async');
    const ok = tx.create('operand', { owner: alt, name: 'Otherwise' });
    msg(ok, 'nextLeg()', la, la);
    msg(sortie, 'landed', la, lo, 'async');
    tx.create('sd', { owner: sortie, name: 'Survey sortie sequence' });

    // ---- how the model is organized ----
    tx.link('import', F, R); tx.link('import', L, R); tx.link('import', L, F); tx.link('import', P, L);
    const pkgd = tx.create('pkg', { owner: L, name: 'Model organization' });
    populatePkg(m, tx, pkgd, 'sysml', [R, F, L, P]);
  });
}

/** Value types, two equations, live checks on the endurance and energy requirements. @param {import('./model.js').Model} m */
function buildAnalysis(m) {
  const L = /** @type {string} */ (m.layers().find((l) => l.layer === 'l')?.id);
  const by = (/** @type {string} */ name, /** @type {string} */ kind) => /** @type {string} */ (m.all().find((e) => e.name === name && (!kind || e.kind === kind))?.id);
  m.transact('Kestrel analysis', (tx) => {
    const av = by('Kestrel Air Vehicle', 'partDef'), batt = by('Battery Pack', 'partDef'), store = by('Energy Storage', 'partDef');
    const valueOf = (/** @type {string} */ block, /** @type {string} */ name) => /** @type {string} */ (m.children(block).find((c) => c.kind === 'attribute' && c.name === name)?.id);
    // kinds of quantity
    const vt = tx.create('package', { owner: L, name: 'Value types' });
    const type = (/** @type {string} */ name, /** @type {string} */ unit) => tx.create('valueType', { owner: vt, name, props: { unit } });
    const Energy = type('Energy', 'Wh'), Power = type('Power', 'W'), Duration = type('Duration', 'h'), Charge = type('Charge', 'Ah'), Voltage = type('Voltage', 'V'), Mass = type('Mass', 'kg');
    tx.setProps(valueOf(batt, 'capacity'), { type: Charge });
    tx.setProps(valueOf(batt, 'mass'), { type: Mass });
    tx.setProps(valueOf(store, 'usableEnergy'), { type: Energy });
    tx.create('attribute', { owner: batt, name: 'nominalVoltage', props: { type: Voltage, value: '44.4', unit: 'V' } });
    tx.create('attribute', { owner: batt, name: 'depthOfDischarge', props: { value: '95', unit: '%' } });
    tx.create('attribute', { owner: av, name: 'endurance', props: { type: Duration, unit: 'h' } });
    tx.create('attribute', { owner: av, name: 'cruisePower', props: { type: Power, value: '210', unit: 'W' } });

    // the equations
    const an = tx.create('package', { owner: L, name: 'Analysis' });
    const eqn = (/** @type {string} */ name, /** @type {string} */ expr, /** @type {[string, string][]} */ params) => {
      const d = tx.create('constraintDef', { owner: an, name, props: { expr } });
      for (const [p, unit] of params) tx.create('attribute', { owner: d, name: p, props: { unit } });
      return d;
    };
    const cbEnergy = eqn('Battery energy', 'E = C * V * dod', [['E', 'Wh'], ['C', 'Ah'], ['V', 'V'], ['dod', '']]);
    const cbRange = eqn('Endurance', 't = E / P', [['t', 'h'], ['E', 'Wh'], ['P', 'W']]);
    const param = (/** @type {string} */ def, /** @type {string} */ name) => /** @type {string} */ (m.children(def).find((c) => c.name === name)?.id);
    /** @param {string} block @param {string} use @param {string} def @param {string} p @param {string[]} path part names @param {string} value */
    const bind = (block, use, def, p, path, value) => {
      /** @type {string[]} */
      const ids = [];
      let b = block;
      for (const name of path) { const part = /** @type {any} */ (m.children(b).find((c) => c.kind === 'part' && c.name === name)); ids.push(part.id); b = part.props.type; }
      const attr = m.supersOf(b).map((x) => valueOf(x, value)).find(Boolean);
      tx.create('binding', { owner: block, name: `${m.get(use)?.name}.${p} = ${[...path, value].join('.')}`, props: { constraint: use, param: param(def, p), value: { path: ids, port: attr } } });
    };
    const energyUse = tx.create('constraint', { owner: batt, name: 'energy', props: { type: cbEnergy } });
    bind(batt, energyUse, cbEnergy, 'E', [], 'usableEnergy');
    bind(batt, energyUse, cbEnergy, 'C', [], 'capacity');
    bind(batt, energyUse, cbEnergy, 'V', [], 'nominalVoltage');
    bind(batt, energyUse, cbEnergy, 'dod', [], 'depthOfDischarge');
    const rangeUse = tx.create('constraint', { owner: av, name: 'range', props: { type: cbRange } });
    bind(av, rangeUse, cbRange, 't', [], 'endurance');
    bind(av, rangeUse, cbRange, 'E', ['propulsion', 'battery'], 'usableEnergy');
    bind(av, rangeUse, cbRange, 'P', [], 'cruisePower');

    // requirements checked live against the design
    const endur = by('Endurance', 'requirement'), energy = by('Usable energy', 'requirement');
    tx.setProps(endur, { check: 'endurance >= 3 [h]' });
    tx.setProps(energy, { check: 'usableEnergy >= 650 [Wh]' });
    tx.link('satisfy', av, endur);

    populatePar(m, tx, tx.create('par', { owner: av, name: 'Endurance analysis' }));
    populatePar(m, tx, tx.create('par', { owner: batt, name: 'Battery energy' }));
  });
}
