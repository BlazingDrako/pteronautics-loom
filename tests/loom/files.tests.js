import { createModel, ModelError } from '../../src/model/model.js';
import { snapshot, restore, toFile, fromFile, fileNameFor, MODEL_FORMAT } from '../../src/model/serialize.js';
import { buildKestrel } from '../../src/model/sample.js';
import { createProjectStore, memoryBackend } from '../../src/storage/projects.js';

/** @param {() => unknown} fn */
const err = (fn) => { try { fn(); return ''; } catch (e) { return e instanceof ModelError ? e.message : `not a ModelError: ${e}`; } };

/** @param {import('../run.js').Log} log */
export async function filesTests(log) {
  // ---------- snapshots ----------
  const k = buildKestrel(createModel());
  const snap = snapshot(k);
  const back = restore(JSON.parse(JSON.stringify(snap)));
  log('A snapshot round-trips to an identical snapshot', JSON.stringify(snapshot(back)) === JSON.stringify(snap));
  log('Round-tripping keeps every element and relationship', back.count() === k.count(), `${back.count()} vs ${k.count()}`);
  log('Owners come before their children in a snapshot', snap.elements.every((e, i) => !e.owner || snap.elements.slice(0, i).some((o) => o.id === e.owner)));
  log('A restored model has no undo history', !back.canUndo());
  back.transact('Edit', (tx) => tx.rename(back.root().id, 'Renamed'));
  log('A restored model is editable', back.root().name === 'Renamed');

  // ---------- refusing bad data ----------
  log('Something that is not a model is refused', /not a Loom model/.test(err(() => restore({ hello: 1 }))));
  log('A model from a newer Loom is refused', /newer version/.test(err(() => restore({ ...snap, version: 99 }))));
  const dupe = JSON.parse(JSON.stringify(snap)); dupe.elements.push({ ...dupe.elements[3] });
  log('Duplicate ids are refused', /share the id/.test(err(() => restore(dupe))));
  const orphan = JSON.parse(JSON.stringify(snap)); orphan.elements.push({ id: 'abc123', kind: 'partDef', name: 'Lost', owner: 'nowhere', props: {} });
  log('An element whose owner is missing is refused', /owner/.test(err(() => restore(orphan))));
  const illegal = JSON.parse(JSON.stringify(snap)); illegal.elements.push({ id: 'abc124', kind: 'part', name: 'p', owner: snap.elements[0].id, props: {} });
  log('An element in an illegal owner is refused', /cannot contain/.test(err(() => restore(illegal))));
  const unknown = JSON.parse(JSON.stringify(snap)); unknown.elements[2].kind = 'widget';
  log('Unknown element kinds are refused', /Unknown element kind/.test(err(() => restore(unknown))));
  const dangling = JSON.parse(JSON.stringify(snap));
  const part = dangling.elements.find((/** @type {any} */ e) => e.kind === 'part');
  part.props.type = 'deadbeef';
  log('A dangling reference is cleared, not fatal', err(() => restore(dangling)) === '' && restore(dangling).get(part.id)?.props.type === null);
  const strayRel = JSON.parse(JSON.stringify(snap)); strayRel.relationships.push({ id: 'rel999', kind: 'trace', source: 'gone', target: snap.elements[5].id });
  log('A relationship to a missing element is dropped', restore(strayRel).count() === k.count());
  const bigText = JSON.parse(JSON.stringify(snap)); bigText.elements[1].props.doc = 'x'.repeat(50000);
  log('Over-long text is trimmed', restore(bigText).get(bigText.elements[1].id)?.props.doc.length === 20000);
  const badEnum = JSON.parse(JSON.stringify(snap));
  const req = badEnum.elements.find((/** @type {any} */ e) => e.kind === 'requirement');
  req.props.priority = 'URGENT!!';
  log('An unknown enum value falls back to the default', restore(badEnum).get(req.id)?.props.priority === '—');

  // ---------- project files ----------
  const text = toFile({ name: 'Kestrel UAS' }, k);
  const f = fromFile(text);
  log('A project file round-trips', f.name === 'Kestrel UAS' && f.model.count() === k.count());
  log('Invalid JSON is refused politely', /not valid JSON/.test(err(() => fromFile('{oops'))));
  log('A bare model snapshot is not a project file', /not a Loom project file/.test(err(() => fromFile(JSON.stringify(snap)))));
  log('File names are made safe', fileNameFor('My: Project/../x') === 'My-Projectx.loom.json' && fileNameFor('***') === 'project.loom.json', fileNameFor('My: Project/../x'));
  log('Snapshots carry the format tag', snap.format === MODEL_FORMAT && snap.version === 1);

  // ---------- the project store ----------
  const store = createProjectStore(memoryBackend());
  const a = await store.create({ name: 'Alpha' });
  const b = await store.create({ name: 'Alpha', template: 'kestrel' });
  log('Creating a project with a taken name numbers it', b.name === 'Alpha (2)', b.name);
  log('A blank project has no elements in its layers', a.stats.elements === 0);
  log('The Kestrel template fills all four layers', Object.values(b.stats.layers).every((n) => n > 0), JSON.stringify(b.stats.layers));
  const opened = await store.open(b.id);
  log('Opening a project gives a live model', opened.model.root().name === 'Alpha (2)' && opened.model.count() === k.count());
  opened.model.transact('Add', (tx) => tx.create('package', { owner: opened.model.layers()[0].id, name: 'More' }));
  await store.save(b.id, opened.model);
  log('Saving updates the stats', (await store.open(b.id)).meta.stats.elements === b.stats.elements + 1);
  await store.rename(a.id, '  Beta  ');
  log('Renaming a project renames its root too', (await store.open(a.id)).model.root().name === 'Beta');
  const copy = await store.duplicate(b.id);
  log('Duplicating makes an independent copy', copy.id !== b.id && copy.name === 'Alpha (2) copy' && copy.stats.elements === b.stats.elements + 1);
  const exp = await store.exportFile(b.id);
  log('Export names the file after the project', exp.filename === 'Alpha-2.loom.json', exp.filename);
  const imp = await store.importFile(exp.text);
  log('Importing an exported file gives the same model', imp.name === 'Alpha (3)' && imp.stats.elements === b.stats.elements + 1, imp.name);
  let refused = false;
  try { await store.importFile('{"format":"something-else"}'); } catch { refused = true; }
  log('Importing a wrong file is refused', refused);
  await store.remove(copy.id);
  log('Removing a project deletes it', (await store.list()).every((p) => p.id !== copy.id));
  log('list() returns the remaining projects', (await store.list()).length === 3);
  let gone = false;
  try { await store.open(copy.id); } catch { gone = true; }
  log('Opening a removed project fails cleanly', gone);
}
