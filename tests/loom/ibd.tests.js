import { createModel, ModelError } from '../../src/model/model.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { buildKestrel } from '../../src/model/sample.js';
import { isLayoutKey, parseKey, keyIds, ownerKey, FRAME } from '../../src/model/paths.js';
import { canConnect, orderEnds, matchingPort, effectiveDirection } from '../../src/canvas/connect.js';
import { ibdScene, packIbd, routeConnectors, sideOf, snapToBorder, containerAt } from '../../src/canvas/ibd.js';
import { childKinds } from '../../src/model/metamodel.js';

/** @param {() => void} fn */
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof ModelError; } };
/** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** @param {import('../run.js').Log} log */
export function ibdTests(log) {
  // ---------- layout keys ----------
  log('Layout keys: frame, parts, nested parts and ports are valid', ['@frame', 'abc', 'abc/def', 'abc/def#p1', '#p1'].every(isLayoutKey));
  log('Layout keys: malformed keys are refused', !['', 'a//b', 'a#b#c', '../x', 'a b'].some(isLayoutKey));
  log('parseKey splits a path and a port', JSON.stringify(parseKey('a/b#p')) === '{"frame":false,"path":["a","b"],"port":"p"}');
  log('keyIds lists every element a key names', keyIds('a/b#p').join() === 'a,b,p' && keyIds(FRAME).length === 0);
  log('ownerKey finds the box a port sits on', ownerKey('a/b#p') === 'a/b' && ownerKey('#p') === FRAME);

  // ---------- model: connectors ----------
  const m = createModel();
  const L = m.layers()[2].id;
  const ids = m.transact('Setup', (tx) => {
    const sys = tx.create('partDef', { owner: L, name: 'System' });
    const pw = tx.create('interfaceDef', { owner: L, name: 'Power' });
    const dt = tx.create('interfaceDef', { owner: L, name: 'Data' });
    const src = tx.create('partDef', { owner: L, name: 'Source' });
    const out = tx.create('port', { owner: src, name: 'out', props: { type: pw, direction: 'out' } });
    const dOut = tx.create('port', { owner: src, name: 'dataOut', props: { type: dt, direction: 'out' } });
    const snk = tx.create('partDef', { owner: L, name: 'Sink' });
    const inp = tx.create('port', { owner: snk, name: 'in', props: { type: pw, direction: 'in' } });
    const in2 = tx.create('port', { owner: snk, name: 'in2', props: { type: pw, direction: 'in' } });
    const a = tx.create('part', { owner: sys, name: 'a', props: { type: src } });
    const b = tx.create('part', { owner: sys, name: 'b', props: { type: snk } });
    const ext = tx.create('port', { owner: sys, name: 'ext', props: { type: pw, direction: 'in' } });
    return { sys, pw, dt, src, out, dOut, snk, inp, in2, a, b, ext };
  });
  log('Connectors and ports are not offered in "Add" menus for blocks, ports are', !childKinds('partDef').includes('connector') && childKinds('partDef').includes('port'));
  const c1 = m.transact('Connect', (tx) => tx.create('connector', { owner: ids.sys, props: { end1: { path: [ids.a], port: ids.out }, end2: { path: [ids.b], port: ids.inp } } }));
  log('A connector between two parts\' ports is accepted', m.get(c1)?.kind === 'connector');
  log('A port that is not on the part\'s type is refused', throws(() => m.transact('Bad', (tx) => tx.create('connector', { owner: ids.sys, props: { end1: { path: [ids.a], port: ids.inp }, end2: { path: [ids.b], port: ids.in2 } } }))));
  log('A part that is not inside the owning block is refused', throws(() => m.transact('Bad', (tx) => tx.create('connector', { owner: ids.src, props: { end1: { path: [ids.a], port: ids.out }, end2: { path: [], port: ids.out } } }))));
  log('connectorsTouching finds connectors through a part or to a port', m.connectorsTouching(ids.a).length === 1 && m.connectorsTouching(ids.inp).length === 1);
  m.transact('Delete port', (tx) => tx.remove(ids.inp));
  log('Deleting a port deletes its connectors', !m.get(c1));
  m.undo();
  log('…and undo brings both back', !!m.get(c1) && !!m.get(ids.inp));

  // ---------- files ----------
  const back = restore(JSON.parse(JSON.stringify(snapshot(m))));
  log('Connectors survive saving and loading', JSON.stringify(back.get(c1)?.props.end2) === JSON.stringify({ path: [ids.b], port: ids.inp }));
  const bad = JSON.parse(JSON.stringify(snapshot(m)));
  bad.elements.find((/** @type {any} */ e) => e.id === c1).props.end2.port = 'deadbeef00';
  log('A connector to a missing port is dropped on load', !restore(bad).get(c1));

  // ---------- connection rules ----------
  const end = (/** @type {string} */ key, /** @type {string} */ port, onFrame = false) => ({ key, port: /** @type {any} */ (m.get(port)), onFrame });
  log('out → in with the same interface connects', canConnect(m, end('a#o', ids.out), end('b#i', ids.inp)).ok);
  log('Different interfaces do not connect, and say why', /Different interfaces/.test(canConnect(m, end('a#d', ids.dOut), end('b#i', ids.inp)).reason));
  log('in → in does not connect between parts', !canConnect(m, end('b#i', ids.inp), end('b#i2', ids.in2)).ok);
  log('A block\'s own in port delegates to a part\'s in port', canConnect(m, end('#ext', ids.ext, true), end('b#i', ids.inp)).ok);
  log('…but not to a part\'s out port', !canConnect(m, end('#ext', ids.ext, true), end('a#o', ids.out)).ok);
  log('A port cannot connect to itself', !canConnect(m, end('a#o', ids.out), end('a#o', ids.out)).ok);
  log('Ports already joined are not joined twice', !canConnect(m, end('a#o', ids.out), end('b#i', ids.inp), { connected: () => true }).ok);
  m.transact('Conj', (tx) => tx.setProps(ids.in2, { conjugated: true }));
  log('Conjugating a port flips its direction', effectiveDirection(end('b#i2', ids.in2)) === 'out');
  m.undo();
  const [from] = orderEnds(end('b#i', ids.inp), end('a#o', ids.out));
  log('The sender becomes the connector\'s "From" end', from.key === 'a#o');
  const mp = matchingPort(end('a#o', ids.out));
  log('A matching port has the same interface and the opposite direction', mp.type === ids.pw && mp.direction === 'in');

  // ---------- the sample's internal block diagrams ----------
  const k = buildKestrel(createModel());
  const ibds = k.byKind('ibd');
  log('The Kestrel sample has two internal block diagrams', ibds.length === 2, ibds.map((d) => d.name).join());
  const prop = /** @type {any} */ (ibds.find((d) => d.name === 'Propulsion internals'));
  const sc = ibdScene(k, prop);
  log('The propulsion diagram shows battery, esc and motor', !!sc && sc.parts.map((p) => p.part.name).sort().join() === 'battery,esc,motor', sc?.parts.map((p) => p.part.name).join());
  log('…with their ports and the block\'s throttle port on the frame', !!sc && sc.ports.some((p) => p.onFrame && p.port.name === 'throttle') && sc.ports.length >= 6);
  log('…and three connectors with item flows', !!sc && sc.conns.length === 3 && sc.conns.every((c) => c.item), sc?.conns.map((c) => c.item).join());
  log('Every part sits inside the frame', !!sc && sc.parts.every((p) => within(p.rect, sc.frame)));
  log('Ports sit on the edge of their box', !!sc && sc.ports.every((p) => {
    const o = p.owner === FRAME ? sc.frame : /** @type {any} */ (sc.byKey.get(p.owner)).rect;
    const c = { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 };
    return Math.min(Math.abs(c.x - o.x), Math.abs(c.x - o.x - o.w), Math.abs(c.y - o.y), Math.abs(c.y - o.y - o.h)) <= 1;
  }));
  log('In ports go on the left, out ports on the right', !!sc && sc.ports.filter((p) => !p.onFrame).every((p) => (p.port.props.direction === 'in' ? p.side === 'l' : p.port.props.direction === 'out' ? p.side === 'r' : true)));
  const routes = routeConnectors(/** @type {any} */ (sc));
  log('Every connector is routed with right angles', [...routes.values()].every((pts) => pts.length >= 2 && pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y)));
  const av = /** @type {any} */ (ibds.find((d) => d.name === 'Air vehicle internals'));
  const avs = ibdScene(k, av);
  log('Nested parts are shown inside their container', !!avs && avs.parts.some((p) => p.depth === 2 && within(p.rect, /** @type {any} */ (avs.byKey.get(p.path[0])).rect)));
  log('Connectors from inside a part\'s type show at that usage', !!avs && avs.conns.some((c) => c.prefix.length === 1));
  log('The avionics → propulsion connector is shown', !!avs && avs.conns.some((c) => c.item === 'throttle : PWM'));

  // ---------- collapse and broken entries ----------
  const pk = /** @type {any} */ (avs).parts.find((/** @type {any} */ p) => p.part.name === 'propulsion').key;
  k.transact('Collapse', (tx) => tx.place(av.id, { [pk]: { ...av.layout.nodes[pk], c: 1 } }));
  const col = ibdScene(k, /** @type {any} */ (k.get(av.id)));
  log('Collapsing a part hides what is inside it', !!col && !col.parts.some((p) => p.key.startsWith(pk + '/')) && !!col.byKey.get(pk));
  k.undo();
  k.transact('Change type', (tx) => tx.setProps(/** @type {any} */ (avs).byKey.get(pk).part.id, { type: null }));
  const broken = ibdScene(k, /** @type {any} */ (k.get(av.id)));
  log('Parts whose type changed underneath are skipped, not drawn wrong', !!broken && !broken.parts.some((p) => p.key.startsWith(pk + '/')));
  k.undo();

  // ---------- geometry helpers ----------
  const box = { x: 0, y: 0, w: 100, h: 60 };
  log('sideOf finds the nearest side', sideOf(box, { x: 2, y: 30 }) === 'l' && sideOf(box, { x: 50, y: 59 }) === 'b');
  const sn = snapToBorder(box, { x: 130, y: 20 });
  log('snapToBorder puts a point on the edge', sn.x === 100 && sn.y === 20 && sn.side === 'r');
  log('containerAt finds the deepest box under a point', !!avs && containerAt(avs, { x: avs.frame.x + 5, y: avs.frame.y + 5 }) === FRAME);
  const packed = packIbd(k, /** @type {string} */ (prop.owner));
  log('packIbd lays out the frame, every part and every port', !!packed[FRAME] && Object.keys(packed).filter((x) => x.includes('#')).length >= 6);
}
