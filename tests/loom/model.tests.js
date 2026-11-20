import { createModel, ModelError } from '../../src/model/model.js';
import { ELEMENTS, RELATIONSHIPS, canOwnKind, canRelate, childKinds, kindName } from '../../src/model/metamodel.js';
import { buildKestrel } from '../../src/model/sample.js';

/** @param {() => void} fn */
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof ModelError; } };

/** @param {import('../run.js').Log} log */
export function modelTests(log) {
  // ---------- metamodel ----------
  log('Every kind has a name in all three notations', [...Object.values(ELEMENTS), ...Object.values(RELATIONSHIPS)].every((k) => k.names.sysml && k.names.v2 && k.names.guided));
  log('Every relationship has forward and inverse wording', Object.values(RELATIONSHIPS).every((r) => r.verb.sysml && r.inverse.sysml && r.inverse.guided));
  log('Packages can hold blocks; blocks cannot hold packages', canOwnKind('package', 'partDef') && !canOwnKind('partDef', 'package'));
  log('Parts live only inside blocks', JSON.stringify(ELEMENTS.part.owners) === '["partDef"]');
  log('Requirements can nest', canOwnKind('requirement', 'requirement'));
  log('Satisfy goes from a block to a requirement, not back', canRelate('satisfy', 'partDef', 'requirement') && !canRelate('satisfy', 'requirement', 'partDef'));
  log('Trace links any two elements except comments', canRelate('trace', 'action', 'port') && !canRelate('trace', 'comment', 'action'));
  log('Display names follow the notation', kindName('partDef', 'sysml') === 'Block' && kindName('partDef', 'v2') === 'part def' && kindName('partDef', 'guided') === 'Part type');
  log('A block can contain parts, ports and values', ['part', 'port', 'attribute'].every((k) => childKinds('partDef').includes(k)));

  // ---------- a new model ----------
  const m = createModel({ name: 'Test' });
  const [R, F, L, P] = m.layers();
  log('A new model has a root and the four RFLP layers in order', m.root().name === 'Test' && [R, F, L, P].map((x) => x.layer).join('') === 'rflp');
  log('A new model has no undo history', !m.canUndo());

  // ---------- create, rename, props ----------
  let events = 0;
  m.subscribe(() => { events++; });
  const blk = m.transact('Add block', (tx) => tx.create('partDef', { owner: L.id, name: 'Battery' }));
  log('create() adds an element with default properties', m.get(blk)?.kind === 'partDef' && m.get(blk)?.props.doc === '');
  log('One transaction fires one change event', events === 1, events);
  const auto = m.transact('Add', (tx) => tx.create('requirement', { owner: R.id }));
  const auto2 = m.transact('Add', (tx) => tx.create('requirement', { owner: R.id }));
  log('Default names count up among siblings', m.get(auto)?.name === 'Requirement 1' && m.get(auto2)?.name === 'Requirement 2', `${m.get(auto)?.name}, ${m.get(auto2)?.name}`);
  log('A part cannot go directly in a package', throws(() => m.transact('Bad', (tx) => tx.create('part', { owner: L.id }))));
  log('Unknown kinds are refused', throws(() => m.transact('Bad', (tx) => tx.create('widget', { owner: L.id }))));
  m.transact('Rename', (tx) => tx.rename(blk, '  Battery   Pack  '));
  log('rename() tidies whitespace', m.get(blk)?.name === 'Battery Pack');
  log('An empty name is refused', throws(() => m.transact('Bad', (tx) => tx.rename(blk, '   '))));
  log('Unknown properties are refused', throws(() => m.transact('Bad', (tx) => tx.setProps(blk, { colour: 'red' }))));
  const iface = m.transact('Add', (tx) => tx.create('interfaceDef', { owner: L.id, name: 'Power' }));
  const port = m.transact('Add port', (tx) => tx.create('port', { owner: blk, name: 'out', props: { type: iface, direction: 'out' } }));
  log('A port can be typed by an interface block', m.get(port)?.props.type === iface);
  log('A port cannot be typed by a requirement', throws(() => m.transact('Bad', (tx) => tx.setProps(port, { type: auto }))));

  // ---------- a failed transaction rolls back ----------
  const before = m.count();
  log('A transaction that throws is rolled back completely', throws(() => m.transact('Half', (tx) => { tx.create('partDef', { owner: L.id, name: 'Ghost' }); tx.create('part', { owner: R.id }); })) && m.count() === before, `${before} → ${m.count()}`);

  // ---------- relationships ----------
  const sat = m.transact('Link', (tx) => tx.link('satisfy', blk, auto));
  log('link() creates a relationship indexed both ways', m.relsFrom(blk).some((r) => r.id === sat) && m.relsTo(auto).some((r) => r.id === sat));
  log('The same relationship twice is refused', throws(() => m.transact('Dup', (tx) => tx.link('satisfy', blk, auto))));
  log('A wrong-way relationship is refused', throws(() => m.transact('Bad', (tx) => tx.link('satisfy', auto, blk))));
  log('An element cannot relate to itself', throws(() => m.transact('Bad', (tx) => tx.link('trace', blk, blk))));

  // ---------- move ----------
  const pkg = m.transact('Pkg', (tx) => tx.create('package', { owner: L.id, name: 'Power' }));
  m.transact('Move', (tx) => tx.move(blk, pkg));
  log('move() re-parents an element', m.get(blk)?.owner === pkg && m.children(pkg)[0]?.id === blk);
  log('An element cannot move inside itself', !m.canMove(pkg, pkg) && throws(() => m.transact('Cycle', (tx) => tx.move(pkg, pkg))));
  const inner = m.transact('Pkg', (tx) => tx.create('package', { owner: pkg, name: 'Inner' }));
  log('An element cannot move inside its own descendant', !m.canMove(pkg, inner));
  log('A block cannot move into a requirement', !m.canMove(blk, auto));
  log('Layer packages cannot move', !m.canMove(L.id, R.id));

  // ---------- remove cascades ----------
  const nBefore = m.count();
  m.transact('Delete', (tx) => tx.remove(pkg));
  log('Deleting a package deletes everything inside it', !m.get(blk) && !m.get(port) && !m.get(inner));
  log('…and the relationships that touched them', !m.get(sat) && m.relsTo(auto).length === 0);
  log('Layer packages and the root cannot be deleted', throws(() => m.transact('X', (tx) => tx.remove(L.id))) && throws(() => m.transact('X', (tx) => tx.remove(m.root().id))));
  const part = m.transact('Part', (tx) => { const host = tx.create('partDef', { owner: L.id, name: 'Host' }); const t = tx.create('partDef', { owner: L.id, name: 'Typ' }); return [tx.create('part', { owner: host, props: { type: t } }), t]; });
  m.transact('Delete type', (tx) => tx.remove(part[1]));
  log('Deleting a type clears references to it', m.get(part[0])?.props.type === null);

  // ---------- undo / redo ----------
  m.undo();
  log('Undo brings the type and the reference back', !!m.get(part[1]) && m.get(part[0])?.props.type === part[1]);
  m.undo(); m.undo(); // undo "Part", then the package delete
  log('Undo restores a deleted subtree with its relationships', !!m.get(blk) && !!m.get(port) && !!m.get(inner) && !!m.get(sat) && m.count() === nBefore, `${m.count()} vs ${nBefore}`);
  log('Undo restores child order', m.children(pkg).map((c) => c.id).join() === [blk, inner].join());
  m.redo();
  log('Redo deletes it again', !m.get(blk) && !m.get(sat));
  log('Undo and redo labels name the edit', m.undoLabel() === 'Delete' && m.canRedo() && m.redoLabel() === 'Part');
  m.transact('New', (tx) => tx.create('package', { owner: F.id }));
  log('A new edit clears the redo stack', !m.canRedo());
  const v = m.version();
  m.undo();
  log('version() changes on every change', m.version() === v + 1);

  // ---------- the Kestrel sample ----------
  const k = buildKestrel(createModel());
  log('The Kestrel sample builds without errors', k.root().name === 'Kestrel UAS' && k.elementCount() > 30, k.elementCount());
  log('The sample has relationships in every direction', k.byKind('satisfy').length >= 3 && k.byKind('allocate').length >= 6 && k.byKind('verify').length === 1);
  log('The sample starts with no undo history', !k.canUndo());
  log('Every sample element sits in an RFLP layer', k.all().filter((e) => e.owner && !e.layer && !RELATIONSHIPS[e.kind]).every((e) => !!k.layerOf(e.id)));
  /** @type {(id: string) => string} */
  const typeOf = (id) => k.get(k.get(id)?.props.type)?.name || '';
  const battPart = k.byKind('part').find((p) => p.name === 'battery');
  log('Sample parts are typed by blocks', !!battPart && typeOf(battPart.id) === 'Battery Pack');
}
