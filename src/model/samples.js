// The sample projects offered on the Home page. Kestrel is the full tour; the two small ones
// each show one side of MBSE well: a CubeSat's power system (structure, interfaces and an
// energy budget checked live) and an aircraft's landing gear (behavior: an activity with a
// fallback path, a state machine and a scenario). Values are illustrative.
import { buildKestrel } from './sample.js';
import { populate, populateReq } from '../canvas/populate.js';
import { packIbd } from '../canvas/ibd.js';
import { populateAct } from '../canvas/act.js';
import { populateStm } from '../canvas/stm.js';
import { populatePar } from '../canvas/par.js';

/** @typedef {import('./model.js').Model} Model */
/** @typedef {{ id: string, name: string, title: string, blurb: string, build: (m: Model) => Model }} Sample */

/** @type {Sample[]} */
export const SAMPLES = [
  { id: 'kestrel', name: 'Kestrel UAS', title: 'Kestrel UAS', blurb: 'A survey drone, end to end: requirements, functions, blocks, ports, behavior, analysis and traces.', build: buildKestrel },
  { id: 'cubesat', name: 'CubeSat power system', title: 'CubeSat power system', blurb: 'A 3U CubeSat’s electrical power: interfaces, connections and an energy budget checked live.', build: buildCubeSat },
  { id: 'gear', name: 'Landing gear', title: 'Landing gear', blurb: 'Retracting and extending a landing gear: an activity with a free-fall fallback, states and a scenario.', build: buildGear },
];

/** @param {string} id */
export const sampleById = (id) => SAMPLES.find((s) => s.id === id);

/** Shared helpers for building a sample inside one transaction. @param {Model} m @param {any} tx */
function helpers(m, tx) {
  const valueOf = (/** @type {string} */ block, /** @type {string} */ name) => /** @type {string} */ (m.children(block).find((c) => c.kind === 'attribute' && c.name === name)?.id);
  const attr = (/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ value, /** @type {string} */ unit, /** @type {Record<string, any>} */ more = {}) => tx.create('attribute', { owner, name, props: { value, unit, ...more } });
  const port = (/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ type, /** @type {'in' | 'out' | 'inout'} */ direction) => tx.create('port', { owner, name, props: { type, direction } });
  const part = (/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ type) => tx.create('part', { owner, name, props: { type } });
  /** Connect two ports, each on a part of `owner` (or on `owner` itself when the part is null). */
  const connect = (/** @type {string} */ owner, /** @type {string | null} */ p1, /** @type {string} */ port1, /** @type {string | null} */ p2, /** @type {string} */ port2, /** @type {string} */ item) => {
    const nm = (/** @type {string | null} */ p, /** @type {string} */ q) => `${p ? `${m.get(p)?.name}.` : ''}${m.get(q)?.name}`;
    return tx.create('connector', { owner, name: `${nm(p1, port1)} → ${nm(p2, port2)}`, props: { end1: { path: p1 ? [p1] : [], port: port1 }, end2: { path: p2 ? [p2] : [], port: port2 }, item, flow: 'From → To' } });
  };
  /** An equation with its parameters. @param {string} owner @param {string} name @param {string} expr @param {[string, string][]} params */
  const eqn = (owner, name, expr, params) => {
    const d = tx.create('constraintDef', { owner, name, props: { expr } });
    for (const [p, unit] of params) tx.create('attribute', { owner: d, name: p, props: { unit } });
    return d;
  };
  /** Bind an equation's parameter to a value of the block that uses it. */
  const bind = (/** @type {string} */ block, /** @type {string} */ use, /** @type {string} */ def, /** @type {string} */ p, /** @type {string} */ value) => {
    const param = /** @type {string} */ (m.children(def).find((c) => c.name === p)?.id);
    tx.create('binding', { owner: block, name: `${m.get(use)?.name}.${p} = ${value}`, props: { constraint: use, param, value: { path: [], port: valueOf(block, value) } } });
  };
  /** A state machine's transition, owned with its source state. */
  const tr = (/** @type {string} */ a, /** @type {string} */ b, /** @type {Record<string, any>} */ props = {}) => tx.create('transition', { owner: /** @type {string} */ (m.get(a)?.owner), name: `${m.get(a)?.name} → ${m.get(b)?.name}`, props: { from: a, to: b, ...props } });
  return { attr, port, part, connect, eqn, bind, tr };
}

/** A 3U CubeSat's electrical power system. @param {Model} m */
export function buildCubeSat(m) {
  const [R, F, L, P] = m.layers().map((l) => l.id);
  m.transact('Create the CubeSat sample', (tx) => {
    const { attr, port, part, connect, eqn, bind, tr } = helpers(m, tx);
    tx.rename(m.root().id, 'CubeSat power system');

    // ---- requirements ----
    const mission = tx.create('package', { owner: R, name: 'Mission needs', props: { idPrefix: 'MN-' } });
    const mn1 = tx.create('requirement', { owner: mission, name: 'Operate the payload every orbit', props: { reqId: 'MN-01', text: 'The spacecraft shall be able to run the imaging payload once per orbit.', priority: 'Must' } });
    const reqs = tx.create('package', { owner: R, name: 'Power requirements', props: { idPrefix: 'EPS-' } });
    const orbitPower = tx.create('requirement', { owner: reqs, name: 'Orbit-average power', props: { reqId: 'EPS-001', text: 'The solar array shall supply at least 7 W averaged over one orbit at end of life.', priority: 'Must', method: 'Analysis', check: 'orbitAveragePower >= 7 [W]' } });
    const storage = tx.create('requirement', { owner: reqs, name: 'Eclipse energy', props: { reqId: 'EPS-002', text: 'The battery shall store at least 20 Wh to carry the spacecraft through a 36 min eclipse.', priority: 'Must', method: 'Analysis', check: 'capacity >= 20 [Wh]' } });
    const bus = tx.create('requirement', { owner: reqs, name: 'Regulated bus', props: { reqId: 'EPS-003', text: 'The power unit shall supply regulated 3.3 V and 5 V buses to every subsystem.', priority: 'Must', method: 'Test' } });
    const telemetry = tx.create('requirement', { owner: reqs, name: 'Power telemetry', props: { reqId: 'EPS-004', text: 'The power unit shall report battery voltage, current and temperature to the flight computer every 10 s.', priority: 'Should', method: 'Test' } });
    const ver = tx.create('package', { owner: R, name: 'Verification' });
    const tBudget = tx.create('testCase', { owner: ver, name: 'Power budget analysis', props: { method: 'Analysis', result: 'Pass' } });
    const tCycle = tx.create('testCase', { owner: ver, name: 'Battery capacity test', props: { method: 'Test', result: 'Pass' } });
    const tBus = tx.create('testCase', { owner: ver, name: 'Bus regulation test', props: { method: 'Test', result: 'Not run' } });
    const tTlm = tx.create('testCase', { owner: ver, name: 'Housekeeping telemetry test', props: { method: 'Test', result: 'Not run' } });

    // ---- functions ----
    const power = tx.create('action', { owner: F, name: 'Provide power' });
    const harvest = tx.create('action', { owner: power, name: 'Harvest solar energy' });
    const store = tx.create('action', { owner: power, name: 'Store energy' });
    const regulate = tx.create('action', { owner: power, name: 'Regulate the buses' });
    const report = tx.create('action', { owner: power, name: 'Report power status' });
    const node = (/** @type {string} */ name, /** @type {string} */ kind) => tx.create('controlNode', { owner: power, name, props: { nodeKind: kind } });
    const flow = (/** @type {string} */ a, /** @type {string} */ b, /** @type {Record<string, any>} */ props = {}) => tx.create('flow', { owner: power, name: `${m.get(a)?.name} → ${m.get(b)?.name}`, props: { from: a, to: b, ...props } });
    const start = node('Initial', 'initial'), fork = node('Fork', 'fork'), join = node('Join', 'join'), done = node('Final', 'final');
    flow(start, harvest);
    flow(harvest, fork, { flowKind: 'object', item: 'raw DC' });
    flow(fork, store); flow(fork, regulate);
    flow(store, join); flow(regulate, join);
    flow(join, report);
    flow(report, done);

    // ---- logical architecture ----
    const raw = tx.create('interfaceDef', { owner: L, name: 'Unregulated DC' });
    attr(raw, 'voltage', '8.4', 'V');
    const reg = tx.create('interfaceDef', { owner: L, name: 'Regulated DC' });
    attr(reg, 'voltage', '5', 'V');
    const i2c = tx.create('interfaceDef', { owner: L, name: 'I2C housekeeping' });

    const array = tx.create('partDef', { owner: L, name: 'Solar Array' });
    attr(array, 'area', '0.03', 'm^2');
    attr(array, 'cellEfficiency', '0.29', '');
    attr(array, 'irradiance', '1361', 'W/m^2');
    attr(array, 'sunFraction', '0.62', '');
    attr(array, 'arrayPower', '', 'W');
    attr(array, 'orbitAveragePower', '', 'W');
    const arrayOut = port(array, 'dcOut', raw, 'out');

    const batt = tx.create('partDef', { owner: L, name: 'Battery' });
    attr(batt, 'capacity', '38', 'Wh');
    attr(batt, 'mass', '0.31', 'kg');
    const battIn = port(batt, 'charge', raw, 'inout');

    const pcdu = tx.create('partDef', { owner: L, name: 'Power Unit' });
    attr(pcdu, 'efficiency', '0.9', '');
    const pcduIn = port(pcdu, 'arrayIn', raw, 'in');
    const pcduBatt = port(pcdu, 'battery', raw, 'inout');
    const pcduOut = port(pcdu, 'busOut', reg, 'out');
    const pcduTlm = port(pcdu, 'housekeeping', i2c, 'out');

    const eps = tx.create('partDef', { owner: L, name: 'Electrical Power System' });
    const pArray = part(eps, 'array', array), pBatt = part(eps, 'battery', batt), pPcdu = part(eps, 'powerUnit', pcdu);
    const epsOut = port(eps, 'busOut', reg, 'out');
    const epsTlm = port(eps, 'housekeeping', i2c, 'out');
    connect(eps, pArray, arrayOut, pPcdu, pcduIn, 'raw DC');
    connect(eps, pPcdu, pcduBatt, pBatt, battIn, 'charge');
    connect(eps, pPcdu, pcduOut, null, epsOut, '5 V');
    connect(eps, pPcdu, pcduTlm, null, epsTlm, 'telemetry');

    const obc = tx.create('partDef', { owner: L, name: 'Flight Computer' });
    const obcPwr = port(obc, 'power', reg, 'in');
    const obcTlm = port(obc, 'housekeeping', i2c, 'in');
    const cam = tx.create('partDef', { owner: L, name: 'Imaging Payload' });
    const camPwr = port(cam, 'power', reg, 'in');
    const sat = tx.create('partDef', { owner: L, name: 'CubeSat' });
    const pEps = part(sat, 'eps', eps), pObc = part(sat, 'flightComputer', obc), pCam = part(sat, 'payload', cam);
    connect(sat, pEps, epsOut, pObc, obcPwr, '5 V');
    connect(sat, pEps, epsOut, pCam, camPwr, '5 V');
    connect(sat, pEps, epsTlm, pObc, obcTlm, 'telemetry');

    // the energy budget, checked against EPS-001
    const an = tx.create('package', { owner: L, name: 'Analysis' });
    const cbArray = eqn(an, 'Array power', 'P = A * eta * S', [['P', 'W'], ['A', 'm^2'], ['eta', ''], ['S', 'W/m^2']]);
    const cbAvg = eqn(an, 'Orbit average', 'Pavg = P * f', [['Pavg', 'W'], ['P', 'W'], ['f', '']]);
    const useArray = tx.create('constraint', { owner: array, name: 'arrayPower', props: { type: cbArray } });
    bind(array, useArray, cbArray, 'P', 'arrayPower'); bind(array, useArray, cbArray, 'A', 'area');
    bind(array, useArray, cbArray, 'eta', 'cellEfficiency'); bind(array, useArray, cbArray, 'S', 'irradiance');
    const useAvg = tx.create('constraint', { owner: array, name: 'orbitAverage', props: { type: cbAvg } });
    bind(array, useAvg, cbAvg, 'Pavg', 'orbitAveragePower'); bind(array, useAvg, cbAvg, 'P', 'arrayPower'); bind(array, useAvg, cbAvg, 'f', 'sunFraction');

    // power modes
    const st = (/** @type {string} */ name, /** @type {Record<string, any>} */ props = {}) => tx.create('state', { owner: eps, name, props });
    const s0 = st('Initial', { stateKind: 'initial' });
    const safe = st('Safe', { entry: 'shed payload load' });
    const sun = st('Sunlit', { do: 'charge battery' });
    const ecl = st('Eclipse', { do: 'discharge battery' });
    tr(s0, safe);
    tr(safe, sun, { trigger: 'batteryRecovered', guard: 'voltage > 7.4 V' });
    tr(sun, ecl, { trigger: 'enterEclipse' });
    tr(ecl, sun, { trigger: 'exitEclipse' });
    tr(ecl, safe, { trigger: 'lowBattery', effect: 'notify flight computer' });

    // ---- physical ----
    const pPanels = tx.create('partDef', { owner: P, name: 'Triple-junction GaAs panels (6 × 2U)' });
    const pCells = tx.create('partDef', { owner: P, name: 'Li-ion 2S2P 18650 pack' });
    const pBoard = tx.create('partDef', { owner: P, name: 'PC/104 power board' });

    // ---- traces ----
    tx.link('derive', orbitPower, mn1); tx.link('derive', storage, mn1); tx.link('derive', bus, mn1);
    tx.link('satisfy', array, orbitPower); tx.link('satisfy', batt, storage); tx.link('satisfy', pcdu, bus); tx.link('satisfy', pcdu, telemetry);
    tx.link('verify', tBudget, orbitPower); tx.link('verify', tCycle, storage); tx.link('verify', tBus, bus); tx.link('verify', tTlm, telemetry);
    tx.link('refine', harvest, orbitPower);
    tx.link('allocate', harvest, array); tx.link('allocate', store, batt); tx.link('allocate', regulate, pcdu); tx.link('allocate', report, pcdu);
    tx.link('allocate', array, pPanels); tx.link('allocate', batt, pCells); tx.link('allocate', pcdu, pBoard);

    // ---- diagrams ----
    populate(m, tx, tx.create('bdd', { owner: L, name: 'Power system structure' }), [sat, eps, obc, cam, array, batt, pcdu, raw, reg, i2c]);
    tx.place(tx.create('ibd', { owner: eps, name: 'Power system internals' }), packIbd(m, eps));
    tx.place(tx.create('ibd', { owner: sat, name: 'Spacecraft power distribution' }), packIbd(m, sat));
    populateReq(m, tx, tx.create('req', { owner: R, name: 'Power requirements' }), 'sysml', [mn1, orbitPower, storage, bus, telemetry, array, batt, pcdu, tBudget, tCycle, tBus, tTlm]);
    populateAct(m, tx, tx.create('act', { owner: power, name: 'Power flow' }));
    populateStm(m, tx, tx.create('stm', { owner: eps, name: 'Power modes' }));
    populatePar(m, tx, tx.create('par', { owner: array, name: 'Energy budget' }));
    tx.create('table', { owner: R, name: 'All requirements' });
    tx.create('matrix', { owner: F, name: 'Function allocation', props: { rel: 'allocate', rows: 'action', cols: 'partDef@l' } });
  });
  m.clear();
  return m;
}

/** An aircraft's landing gear: extension, retraction and the free-fall fallback. @param {Model} m */
export function buildGear(m) {
  const [R, F, L, P] = m.layers().map((l) => l.id);
  m.transact('Create the landing gear sample', (tx) => {
    const { attr, port, part, connect, tr } = helpers(m, tx);
    tx.rename(m.root().id, 'Landing gear');

    // ---- requirements ----
    const reqs = tx.create('package', { owner: R, name: 'Landing gear requirements', props: { idPrefix: 'LG-' } });
    const extend = tx.create('requirement', { owner: reqs, name: 'Extension time', props: { reqId: 'LG-001', text: 'The landing gear shall extend and lock within 10 s of the pilot selecting gear down.', priority: 'Must', method: 'Test', check: 'extensionTime <= 10 [s]' } });
    const retract = tx.create('requirement', { owner: reqs, name: 'Retraction time', props: { reqId: 'LG-002', text: 'The landing gear shall retract and lock within 8 s of the pilot selecting gear up.', priority: 'Must', method: 'Test', check: 'retractionTime <= 8 [s]' } });
    const freefall = tx.create('requirement', { owner: reqs, name: 'Free-fall extension', props: { reqId: 'LG-003', text: 'The landing gear shall extend by gravity and lock down when hydraulic pressure is lost.', priority: 'Must', method: 'Test' } });
    const ground = tx.create('requirement', { owner: reqs, name: 'No retraction on the ground', props: { reqId: 'LG-004', text: 'The landing gear shall not retract while weight is on the wheels.', priority: 'Must', method: 'Test' } });
    const indicate = tx.create('requirement', { owner: reqs, name: 'Down-and-locked indication', props: { reqId: 'LG-005', text: 'The cockpit display shall show three green lights when every gear leg is down and locked.', priority: 'Must', method: 'Inspection' } });
    const ver = tx.create('package', { owner: R, name: 'Verification' });
    const tCycle = tx.create('testCase', { owner: ver, name: 'Gear swing test', props: { method: 'Test', result: 'Pass' } });
    const tFree = tx.create('testCase', { owner: ver, name: 'Free-fall drop test', props: { method: 'Test', result: 'Pass' } });
    const tWow = tx.create('testCase', { owner: ver, name: 'Ground interlock test', props: { method: 'Test', result: 'Not run' } });
    const tLights = tx.create('testCase', { owner: ver, name: 'Indication inspection', props: { method: 'Inspection', result: 'Pass' } });

    // ---- functions: extending the gear, with a fallback when hydraulics are lost ----
    const ext = tx.create('action', { owner: F, name: 'Extend the gear' });
    const a = (/** @type {string} */ name) => tx.create('action', { owner: ext, name });
    const doors = a('Open the gear doors'), unlock = a('Release the uplocks'), drive = a('Drive the gear down'), fall = a('Let the gear fall free'), lock = a('Lock the gear down'), lights = a('Show three greens');
    const node = (/** @type {string} */ name, /** @type {string} */ kind) => tx.create('controlNode', { owner: ext, name, props: { nodeKind: kind } });
    const flow = (/** @type {string} */ x, /** @type {string} */ y, /** @type {Record<string, any>} */ props = {}) => tx.create('flow', { owner: ext, name: `${m.get(x)?.name} → ${m.get(y)?.name}`, props: { from: x, to: y, ...props } });
    const start = node('Initial', 'initial'), hyd = node('Hydraulics?', 'decision'), merge = node('Merge', 'merge'), done = node('Final', 'final');
    flow(start, hyd);
    flow(hyd, doors, { guard: 'pressure ok' });
    flow(hyd, unlock, { guard: 'else' });
    flow(doors, drive);
    flow(unlock, fall);
    flow(drive, merge); flow(fall, merge);
    flow(merge, lock);
    flow(lock, lights);
    flow(lights, done);
    const ret = tx.create('action', { owner: F, name: 'Retract the gear' });

    // ---- logical architecture ----
    const hydraulic = tx.create('interfaceDef', { owner: L, name: 'Hydraulic supply' });
    attr(hydraulic, 'pressure', '3000', 'psi');
    const discrete = tx.create('interfaceDef', { owner: L, name: 'Discrete signal' });
    const gcu = tx.create('partDef', { owner: L, name: 'Gear Control Unit' });
    const gcuCmd = port(gcu, 'actuatorCmd', discrete, 'out');
    const gcuWow = port(gcu, 'wowIn', discrete, 'in');
    const gcuLights = port(gcu, 'indication', discrete, 'out');
    const gcuLever = port(gcu, 'leverIn', discrete, 'in');
    const act = tx.create('partDef', { owner: L, name: 'Retraction Actuator' });
    attr(act, 'stroke', '0.42', 'm');
    const actHyd = port(act, 'supply', hydraulic, 'in');
    const actCmd = port(act, 'cmdIn', discrete, 'in');
    const wow = tx.create('partDef', { owner: L, name: 'Weight-on-Wheels Sensor' });
    const wowOut = port(wow, 'signal', discrete, 'out');
    const sys = tx.create('partDef', { owner: L, name: 'Landing Gear System' });
    attr(sys, 'extensionTime', '7.5', 's');
    attr(sys, 'retractionTime', '6.8', 's');
    const pGcu = part(sys, 'controlUnit', gcu), pAct = part(sys, 'actuator', act), pWow = part(sys, 'wowSensor', wow);
    const sysHyd = port(sys, 'hydraulics', hydraulic, 'in');
    const sysLever = port(sys, 'gearLever', discrete, 'in');
    const sysLights = port(sys, 'cockpitLights', discrete, 'out');
    connect(sys, null, sysHyd, pAct, actHyd, 'hydraulic fluid');
    connect(sys, pGcu, gcuCmd, pAct, actCmd, 'extend / retract');
    connect(sys, pWow, wowOut, pGcu, gcuWow, 'weight on wheels');
    connect(sys, null, sysLever, pGcu, gcuLever, 'gear up / down');
    connect(sys, pGcu, gcuLights, null, sysLights, 'three greens');

    // ---- the gear's states ----
    const st = (/** @type {string} */ name, /** @type {Record<string, any>} */ props = {}) => tx.create('state', { owner: sys, name, props });
    const s0 = st('Initial', { stateKind: 'initial' });
    const down = st('Down and locked', { entry: 'show three greens' });
    const retracting = st('Retracting', { do: 'drive actuator up' });
    const up = st('Up and locked', { entry: 'close doors' });
    const extending = st('Extending', { do: 'drive actuator down' });
    const falling = st('Free fall', { do: 'release uplocks' });
    tr(s0, down);
    tr(down, retracting, { trigger: 'gearUp', guard: 'not weight on wheels' });
    tr(retracting, up, { trigger: 'upLocked' });
    tr(up, extending, { trigger: 'gearDown' });
    tr(extending, down, { trigger: 'downLocked' });
    tr(up, falling, { trigger: 'hydraulicFailure' });
    tr(extending, falling, { trigger: 'hydraulicFailure' });
    tr(falling, down, { trigger: 'downLocked' });

    // ---- a scenario: gear down on approach ----
    const sc = tx.create('interaction', { owner: sys, name: 'Gear down on approach' });
    const life = (/** @type {string} */ name, /** @type {string | null} */ rep) => tx.create('lifeline', { owner: sc, name, props: { represents: rep } });
    const lPilot = life('pilot', null), lGcu = life('controlUnit', pGcu), lAct = life('actuator', pAct);
    const msg = (/** @type {string} */ name, /** @type {string} */ x, /** @type {string} */ y, kind = 'sync') => tx.create('message', { owner: sc, name, props: { from: x, to: y, msgKind: kind } });
    msg('selectGearDown()', lPilot, lGcu, 'async');
    msg('extend()', lGcu, lAct, 'async');
    msg('downLocked', lAct, lGcu, 'async');
    msg('threeGreens', lGcu, lPilot, 'async');
    tx.create('sd', { owner: sc, name: 'Gear down on approach' });

    // ---- physical ----
    const pCyl = tx.create('partDef', { owner: P, name: 'Main gear retraction cylinder' });
    const pProx = tx.create('partDef', { owner: P, name: 'Inductive proximity sensor' });
    const pBox = tx.create('partDef', { owner: P, name: 'Dual-channel gear controller' });

    // ---- traces ----
    tx.link('satisfy', sys, extend); tx.link('satisfy', sys, retract); tx.link('satisfy', act, freefall); tx.link('satisfy', gcu, ground); tx.link('satisfy', gcu, indicate);
    tx.link('verify', tCycle, extend); tx.link('verify', tCycle, retract); tx.link('verify', tFree, freefall); tx.link('verify', tWow, ground); tx.link('verify', tLights, indicate);
    tx.link('refine', ext, extend); tx.link('refine', fall, freefall); tx.link('refine', ret, retract);
    tx.link('allocate', drive, act); tx.link('allocate', fall, act); tx.link('allocate', unlock, act); tx.link('allocate', doors, act); tx.link('allocate', lock, act); tx.link('allocate', lights, gcu); tx.link('allocate', ret, sys);
    tx.link('allocate', act, pCyl); tx.link('allocate', wow, pProx); tx.link('allocate', gcu, pBox);

    // ---- diagrams ----
    populate(m, tx, tx.create('bdd', { owner: L, name: 'Landing gear structure' }), [sys, gcu, act, wow, hydraulic, discrete]);
    tx.place(tx.create('ibd', { owner: sys, name: 'Landing gear internals' }), packIbd(m, sys));
    populateReq(m, tx, tx.create('req', { owner: R, name: 'Landing gear requirements' }), 'sysml', [extend, retract, freefall, ground, indicate, sys, act, gcu, tCycle, tFree, tWow, tLights]);
    populateAct(m, tx, tx.create('act', { owner: ext, name: 'Gear extension' }));
    populateStm(m, tx, tx.create('stm', { owner: sys, name: 'Gear states' }));
    tx.create('table', { owner: R, name: 'All requirements' });
    tx.create('matrix', { owner: F, name: 'Function allocation', props: { rel: 'allocate', rows: 'action', cols: 'partDef@l' } });
  });
  m.clear();
  return m;
}
