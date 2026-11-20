// The Kestrel UAS sample: a small but complete RFLP model, used for "Start from a sample"
// and as a test fixture. Values are illustrative.

/** @param {import('./model.js').Model} m */
export function buildKestrel(m) {
  const [R, F, L, P] = m.layers().map((l) => l.id);
  m.transact('Create the Kestrel sample', (tx) => {
    tx.rename(m.root().id, 'Kestrel UAS');

    // Requirements
    const needs = tx.create('package', { owner: R, name: 'Stakeholder needs' });
    const sn1 = tx.create('requirement', { owner: needs, name: 'Survey a large site per sortie', props: { reqId: 'SN-01', text: 'The operator shall be able to survey 40 km² in one sortie.', priority: 'Must' } });
    const sys = tx.create('package', { owner: R, name: 'System requirements' });
    const endur = tx.create('requirement', { owner: sys, name: 'Endurance', props: { reqId: 'REQ-PRF-001', text: 'The air vehicle shall fly for at least 3.0 h at survey speed.', priority: 'Must', method: 'Analysis' } });
    const cruise = tx.create('requirement', { owner: sys, name: 'Cruise speed', props: { reqId: 'REQ-PRF-004', text: 'The air vehicle shall cruise at 22 m/s or faster.', priority: 'Should', method: 'Analysis' } });
    const energy = tx.create('requirement', { owner: sys, name: 'Usable energy', props: { reqId: 'REQ-PWR-003', text: 'The battery shall provide at least 650 Wh of usable energy.', priority: 'Must', method: 'Analysis' } });
    const payload = tx.create('requirement', { owner: sys, name: 'Payload capacity', props: { reqId: 'REQ-PLD-002', text: 'The air vehicle shall carry a 2.5 kg camera payload.', priority: 'Must', method: 'Inspection' } });
    const tests = tx.create('package', { owner: R, name: 'Verification' });
    const tEndur = tx.create('testCase', { owner: tests, name: 'Endurance analysis', props: { method: 'Analysis' } });

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
    tx.create('port', { owner: batt, name: 'pwrOut', props: { type: power, direction: 'out' } });
    const motor = tx.create('partDef', { owner: L, name: 'Motor' });
    tx.create('port', { owner: motor, name: 'pwrIn', props: { type: power, direction: 'in' } });
    tx.create('part', { owner: prop, name: 'battery', props: { type: batt } });
    tx.create('part', { owner: prop, name: 'motor', props: { type: motor } });

    // Physical
    const pBatt = tx.create('partDef', { owner: P, name: 'LiPo 12S 16 Ah pack' });
    const pMotor = tx.create('partDef', { owner: P, name: 'BLDC outrunner, 170 Kv' });
    const pCam = tx.create('partDef', { owner: P, name: '61 MP mapping camera' });

    // Relationships
    tx.link('derive', energy, endur);
    tx.link('derive', endur, sn1);
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
  });
  m.clear();
  return m;
}
