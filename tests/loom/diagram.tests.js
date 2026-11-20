import { createModel, ModelError } from '../../src/model/model.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { buildKestrel } from '../../src/model/sample.js';
import { nodeContent, naturalSize, edgesFor, canShow } from '../../src/canvas/bdd.js';
import { routeAll, chooseSides, simplify, pathData } from '../../src/canvas/route.js';
import { layered } from '../../src/canvas/layout.js';
import { ellipsize, textWidth, FONTS } from '../../src/canvas/measure.js';

/** @param {() => void} fn */
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof ModelError; } };
/** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** @param {import('../run.js').Log} log */
export function diagramTests(log) {
  // ---------- placing elements ----------
  const m = createModel();
  const L = m.layers()[2].id;
  const [a, b, d, req] = m.transact('Setup', (tx) => [
    tx.create('partDef', { owner: L, name: 'Whole' }),
    tx.create('partDef', { owner: L, name: 'Part' }),
    tx.create('bdd', { owner: L, name: 'Structure' }),
    tx.create('requirement', { owner: m.layers()[0].id, name: 'R' }),
  ]);
  log('A new diagram starts empty', Object.keys(m.get(d)?.layout?.nodes || {}).length === 0);
  m.transact('Place', (tx) => tx.place(d, { [a]: { x: 10.4, y: 20.6, w: 180, h: 60 }, [b]: { x: 10, y: 200, w: 180, h: 60 } }));
  log('place() stores whole-pixel rectangles', JSON.stringify(m.get(d)?.layout?.nodes[a]) === '{"x":10,"y":21,"w":180,"h":60}');
  log('diagramsShowing() finds the diagram', m.diagramsShowing(a).map((x) => x.id).join() === d);
  m.transact('Move', (tx) => tx.place(d, { [a]: { x: 300, y: 20, w: 180, h: 60 } }));
  m.undo();
  log('Moving on a diagram undoes', m.get(d)?.layout?.nodes[a].x === 10);
  m.transact('Hide', (tx) => tx.place(d, { [a]: null }));
  log('A null rect takes an element off the diagram but not out of the model', !(a in (m.get(d)?.layout?.nodes || {})) && !!m.get(a));
  m.undo();
  log('…and undo puts it back', a in (m.get(d)?.layout?.nodes || {}));
  log('A diagram cannot show itself', throws(() => m.transact('X', (tx) => tx.place(d, { [d]: { x: 0, y: 0, w: 100, h: 50 } }))));
  log('Positions must be numbers', throws(() => m.transact('X', (tx) => tx.place(d, { [b]: { x: NaN, y: 0, w: 100, h: 50 } }))));
  log('Tiny sizes are raised to the minimum', (m.transact('S', (tx) => tx.place(d, { [b]: { x: 0, y: 0, w: 5, h: 5 } })), m.get(d)?.layout?.nodes[b].w === 40));
  m.transact('Delete', (tx) => tx.remove(b));
  log('Deleting an element takes it off every diagram', !(b in (m.get(d)?.layout?.nodes || {})));
  m.undo();
  log('…and undo restores its place', b in (m.get(d)?.layout?.nodes || {}));
  log('Diagrams cannot take part in relationships', !m.canLink('trace', d, req) && !m.canLink('trace', req, d));
  log('Only blocks and interface blocks can be shown on a bdd', canShow(m.get(a)) && !canShow(m.get(req)));

  // ---------- files keep diagrams ----------
  const snap = snapshot(m);
  const back = restore(JSON.parse(JSON.stringify(snap)));
  log('Diagram layouts survive saving and loading', JSON.stringify(back.get(d)?.layout) === JSON.stringify(m.get(d)?.layout));
  const bad = JSON.parse(JSON.stringify(snap));
  const dg = bad.elements.find((/** @type {any} */ e) => e.id === d);
  dg.layout.nodes.ghost99 = { x: 0, y: 0, w: 100, h: 50 };
  dg.layout.nodes[a] = { x: 'left', y: 0, w: 100, h: 50 };
  dg.layout.nodes[b].w = 99999;
  const fixed = restore(bad).get(d)?.layout?.nodes || {};
  log('Loading drops entries for missing elements and bad rectangles, and clamps sizes', !('ghost99' in fixed) && !(a in fixed) && fixed[b].w === 4000);

  // ---------- what boxes show ----------
  const k = buildKestrel(createModel());
  const kd = /** @type {any} */ (k.byKind('bdd')[0]);
  const prop = /** @type {any} */ (k.all().find((e) => e.name === 'Propulsion System'));
  const batt = /** @type {any} */ (k.all().find((e) => e.name === 'Battery Pack'));
  const c = nodeContent(k, prop, kd, 'sysml');
  log('A block shows «block» and its name', c.stereo === '«block»' && c.name === 'Propulsion System');
  log('Parts are listed as name : Type', c.compartments[0]?.title === 'parts' && c.compartments[0].rows.includes('battery : Battery Pack'), JSON.stringify(c.compartments));
  const cb = nodeContent(k, batt, kd, 'sysml');
  log('Values show value and unit; ports show direction and type', cb.compartments.some((x) => x.rows.includes('capacity = 16 Ah')) && cb.compartments.some((x) => x.rows.includes('out pwrOut : DC Power 48 V')), JSON.stringify(cb.compartments));
  log('Guided notation uses plain words', nodeContent(k, prop, kd, 'guided').compartments[0].rows.includes('battery is a Battery Pack') && nodeContent(k, prop, kd, 'guided').stereo === 'Part type');
  log('SysML v2 notation uses v2 keywords', nodeContent(k, prop, kd, 'v2').stereo === '«part def»' && nodeContent(k, batt, kd, 'v2').compartments.some((x) => x.title === 'attributes'));
  const hidden = { ...kd, props: { ...kd.props, showParts: false, showValues: false, showPorts: false } };
  log('View options hide compartments', nodeContent(k, batt, hidden, 'sysml').compartments.length === 0);
  const nat = naturalSize(cb);
  log('Natural size fits the longest row', nat.w >= textWidth('out pwrOut : DC Power 48 V', FONTS.row) + 24 && nat.h > 100, JSON.stringify(nat));

  // ---------- lines ----------
  const shown = new Set(Object.keys(kd.layout.nodes));
  const edges = edgesFor(k, shown);
  log('Composition lines come from typed parts', edges.filter((e) => e.kind === 'composition').length === 5, edges.map((e) => e.label).join(','));
  log('Generalization lines come from relationships', edges.some((e) => e.kind === 'generalization' && e.from === batt.id));
  shown.delete(batt.id);
  log('Lines to hidden blocks are not drawn', !edgesFor(k, shown).some((e) => e.to === batt.id || e.from === batt.id));

  // ---------- the sample diagram's layout ----------
  const rects = Object.values(kd.layout.nodes);
  log('The sample diagram has no overlapping boxes', rects.every((r, i) => rects.every((q, j) => i === j || !overlap(/** @type {any} */ (r), /** @type {any} */ (q)))));
  const whole = kd.layout.nodes[/** @type {any} */ (k.all().find((e) => e.name === 'Kestrel Air Vehicle')).id];
  log('Wholes are laid out above their parts', whole.y < kd.layout.nodes[prop.id].y && kd.layout.nodes[prop.id].y < kd.layout.nodes[batt.id].y);

  // ---------- routing ----------
  log('Boxes one above the other connect bottom to top', chooseSides({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }).join('') === 'bt');
  log('Boxes side by side connect right to left', chooseSides({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }).join('') === 'rl');
  log('simplify() drops repeated and in-line points', simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 }, { x: 5, y: 10 }]).length === 3);
  const rmap = new Map(Object.entries({ A: { x: 0, y: 0, w: 120, h: 60 }, B: { x: 300, y: 200, w: 120, h: 60 }, C: { x: 150, y: 90, w: 100, h: 60 } }));
  const [r1] = routeAll(rmap, [{ id: 'e', kind: 'composition', from: 'A', to: 'B', element: 'e' }]);
  log('Routes are orthogonal', r1.points.every((p, i) => i === 0 || p.x === r1.points[i - 1].x || p.y === r1.points[i - 1].y), JSON.stringify(r1.points));
  log('Routes avoid other boxes when they can', r1.crossings === 0, JSON.stringify(r1.points));
  log('Routes start and end on the box edges', r1.points[0].y === 60 && r1.points[r1.points.length - 1].y === 200);
  const many = new Map(Object.entries({ W: { x: 200, y: 0, w: 200, h: 60 }, P1: { x: 0, y: 200, w: 100, h: 60 }, P2: { x: 250, y: 200, w: 100, h: 60 }, P3: { x: 500, y: 200, w: 100, h: 60 } }));
  const rs = routeAll(many, ['P1', 'P2', 'P3'].map((p) => ({ id: p, kind: /** @type {const} */ ('composition'), from: 'W', to: p, element: p })));
  const starts = rs.map((r) => r.points[0].x);
  log('Lines on one side are spread out, in order', starts[0] < starts[1] && starts[1] < starts[2] && new Set(starts).size === 3, starts.join());
  const gens = routeAll(many, ['P1', 'P2', 'P3'].map((p) => ({ id: p, kind: /** @type {const} */ ('generalization'), from: p, to: 'W', element: p })));
  log('Generalization lines into one block share a point', new Set(gens.map((r) => `${r.points.at(-1)?.x},${r.points.at(-1)?.y}`)).size === 1);
  log('pathData() draws a path with rounded corners', /^M0 0 L0 \d+ Q0 10 /.test(pathData([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 10 }])), pathData([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 10 }]));

  // ---------- layout ----------
  const nodes = [{ id: 'top', w: 200, h: 80 }, { id: 'l', w: 120, h: 60 }, { id: 'r', w: 120, h: 60 }, { id: 'gen', w: 150, h: 60 }, { id: 'lonely', w: 100, h: 50 }];
  const lp = layered(nodes, [{ from: 'top', to: 'l', kind: 'composition' }, { from: 'top', to: 'r', kind: 'composition' }, { from: 'top', to: 'gen', kind: 'generalization' }]);
  const at = (/** @type {string} */ id) => /** @type {{ x: number, y: number }} */ (lp.get(id));
  log('Layout puts the general block above, then the whole, then its parts', at('gen').y < at('top').y && at('top').y < at('l').y && at('l').y === at('r').y);
  log('Layout keeps boxes apart', nodes.every((n, i) => nodes.every((q, j) => i === j || !overlap({ ...at(n.id), w: n.w, h: n.h }, { ...at(q.id), w: q.w, h: q.h }))));
  log('Unconnected blocks go below the rest', at('lonely').y > at('l').y);
  const cyc = layered([{ id: 'x', w: 100, h: 50 }, { id: 'y', w: 100, h: 50 }], [{ from: 'x', to: 'y', kind: 'composition' }, { from: 'y', to: 'x', kind: 'composition' }]);
  log('Layout survives cycles', cyc.size === 2);

  // ---------- text never overflows ----------
  const cut = ellipsize('A very long block name that will not fit in a small box', 120, FONTS.name);
  log('Long names are cut with an ellipsis to fit', cut.endsWith('…') && textWidth(cut, FONTS.name) <= 120, cut);
  log('Short names are left alone', ellipsize('Motor', 120, FONTS.name) === 'Motor');
}
