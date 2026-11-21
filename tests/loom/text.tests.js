import { createModel } from '../../src/model/model.js';
import { snapshot } from '../../src/model/serialize.js';
import { buildKestrel } from '../../src/model/sample.js';
import { lex, quoteName, docBody, docText, TextError } from '../../src/text/lexer.js';
import { parse } from '../../src/text/parser.js';
import { printPackage, printModel } from '../../src/text/printer.js';
import { parseLayer, buildSnapshot, applySnapshot, applyLayerText } from '../../src/text/build.js';
import { resolve, treeOf, keysOf } from '../../src/text/names.js';
import { projectFiles, modelFromFiles, snapshotFromFiles, stableJson, signature, FileError } from '../../src/storage/folder.js';
import { zip, unzip, textFiles, crc32, isZip } from '../../src/storage/zip.js';
import { memoryFolder, writeFolder, readFolder } from '../../src/storage/folderfs.js';
import { createProjectStore, memoryBackend } from '../../src/storage/projects.js';
import { sanitize, createSettings } from '../../src/settings.js';
import { createCommands } from '../../src/commands.js';
import { mountWorkspace } from '../../src/ui/workspace.js';

/** A snapshot in a canonical form: layouts with sorted keys, relationships by id. @param {any} s */
const canon = (s) => JSON.stringify({
  elements: s.elements.map((/** @type {any} */ e) => (e.layout ? { ...e, layout: { nodes: Object.fromEntries(Object.entries(e.layout.nodes).sort(([a], [b]) => a.localeCompare(b))) } } : e)),
  relationships: [...s.relationships].sort((/** @type {any} */ a, /** @type {any} */ b) => a.id.localeCompare(b.id)),
});
/** @param {() => any} fn */
const textError = (fn) => { try { fn(); return null; } catch (e) { return e instanceof TextError ? e : null; } };
/** @param {() => any} fn */
const anyError = (fn) => { try { fn(); return null; } catch (e) { return /** @type {Error} */ (e); } };

/** @param {import('../run.js').Log} log */
export async function textTests(log) {
  // ---------- lexer ----------
  log('Plain names stay bare; spaces, keywords and quotes are quoted', quoteName('Motor') === 'Motor' && quoteName('Battery Pack') === "'Battery Pack'" && quoteName('part') === "'part'" && quoteName("It's") === "'It\\'s'");
  log('Quoted names read back with their escapes', lex("'It\\'s ok'")[0].v === "It's ok");
  const docs = ['One line', 'Two\nlines', '* starts with a star\n  indented', 'Has */ inside', ' padded ', '\nblank first line'];
  log('Doc text survives writing and reading, whatever it holds', docs.every((d) => docText(lex(docBody(d))[0].v) === d), docs.map((d) => JSON.stringify(docText(lex(docBody(d))[0].v))).join(' '));
  const toks = lex("part x : T [0..*]; // note\n<'REQ-1'> 3.74 \"a\\\"b\"");
  log('Tokens: names, brackets, short names, numbers, strings; line notes skipped', toks.map((t) => t.t).join() === 'name,name,sym,name,bracket,sym,short,number,string,eof' && toks[4].v === '0..*' && toks[8].v === 'a"b');
  const le = textError(() => lex('part x "unclosed'));
  log('A string left open is an error with its line and column', !!le && le.line === 1 && le.col === 8, le?.message);

  // ---------- parser ----------
  const [pkg] = parse(`package P {
    part def 'Battery Pack' :> Storage { attribute capacity = 16 [Ah]; out port pwrOut : ~Power; }
    part def Car { part wheels : Wheel [4]; connect wheels.hub to wheels.hub; connection Drive connect a to b.c { @Loom { item = "torque"; } } }
    requirement <'REQ-001'> Speed { doc /* Fast. */ @Loom { priority = "Must"; } derive Need; }
    verification def Test1 { verify Speed; }
    view Structure { @Loom { kind = "bdd"; showRoles = false; } }
    comment Note /* hello */
  }`);
  const bp = pkg.children[0], car = pkg.children[1], req = pkg.children[2];
  log('Blocks with specializations, values with units, directed conjugated ports', bp.kind === 'partDef' && bp.spec[0].parts[0] === 'Storage' && bp.children[0].value === '16' && bp.children[0].unit === 'Ah' && bp.children[1].direction === 'out' && bp.children[1].type?.conj === true);
  log('Parts with multiplicity; connectors named and unnamed', car.children[0].mult === '4' && car.children[1].kind === 'connector' && !car.children[1].name && car.children[2].name === 'Drive' && car.children[2].end2?.segs.join('.') === 'b.c');
  log('Requirements: short name, doc, @Loom and relationship statements', req.short === 'REQ-001' && req.doc === 'Fast.' && req.meta[0].key === 'priority' && req.rels[0].kind === 'derive');
  log('Views and comments', pkg.children[4].kind === 'view' && pkg.children[4].meta[1].value === false && pkg.children[5].kind === 'comment' && pkg.children[5].doc === 'hello');
  const errs = [
    ['package P { part def A { } ', 'Expected'],
    ['package P { gizmo X; }', 'Unknown element'],
    ['package P { part x : ; }', 'Expected a name'],
    ['package P { @Other { a 1; } }', 'Expected "="'],
    ['package P { } }', 'without a matching'],
  ];
  const got = errs.map(([src, want]) => { const e = textError(() => parse(src)); return !!e && e.message.includes(want) && e.line === 1; });
  log('Syntax errors say what was expected, with a position', got.every(Boolean), got.join());

  // ---------- printing and the round trip ----------
  const k = buildKestrel(createModel());
  const files = printModel(k);
  log('One text per RFLP layer, each a single package', files.length === 4 && files.every((f) => parse(f.text).length === 1), files.map((f) => f.path).join());
  const inputs = files.map((f) => ({ layerId: f.id, node: parseLayer(f.text) }));
  const rebuilt = buildSnapshot(k, inputs);
  log('Kestrel round-trips: print → parse → build gives the same model, ids and all', canon(rebuilt) === canon(snapshot(k)));
  log('Printing is canonical: the same model always prints the same text', printModel(k).every((f, i) => f.text === files[i].text));
  const logical = /** @type {string} */ (files.find((f) => f.layer === 'l')?.text);
  log('The text reads like SysML v2', logical.includes("part def 'Battery Pack' :> 'Energy Storage' {") && logical.includes('attribute capacity : Charge = 16 [Ah];') && logical.includes("out port pwrOut : 'DC Power 48 V';") && logical.includes("satisfy 'Usable energy';") && logical.includes('connect battery.pwrOut to esc.pwrIn {'));
  const v0 = k.version();
  const st0 = applySnapshot(k, rebuilt, 'Nothing');
  log('Applying unchanged text changes nothing and adds no undo step', st0.created + st0.removed + st0.changed === 0 && k.version() === v0 && !k.canUndo());

  // ---------- editing as text ----------
  const L = k.layers()[2].id;
  const motor = /** @type {any} */ (k.all().find((e) => e.name === 'Motor'));
  const bdd = /** @type {any} */ (k.byKind('bdd')[0]);
  applyLayerText(k, L, logical.replace('part def Motor {', 'part def Motor2 {').replace('part motor : Motor;', 'part motor : Motor2;'));
  log('Renaming in text keeps the element (and its place on diagrams)', k.get(motor.id)?.name === 'Motor2' && !!k.get(bdd.id)?.layout?.nodes[motor.id]);
  log('…and everything that refers to it follows', k.all().some((e) => e.kind === 'part' && e.props.type === motor.id) && k.relsTo(motor.id).length > 0);
  k.undo();
  log('One undo puts it back', k.get(motor.id)?.name === 'Motor');
  const withNew = logical.replace("part def 'Energy Storage' {", "part def Charger {\n        satisfy 'Usable energy';\n    }\n    part def 'Energy Storage' {");
  applyLayerText(k, L, withNew);
  const charger = k.all().find((e) => e.name === 'Charger');
  log('New elements in text are created, with relationships to other layers', !!charger && k.relsFrom(charger.id).some((r) => r.kind === 'satisfy' && k.get(/** @type {string} */ (r.target))?.name === 'Usable energy'));
  applyLayerText(k, L, logical);
  log('Taking it out of the text deletes it, with its relationships', !k.all().some((e) => e.name === 'Charger') && k.byKind('satisfy').length === 4);
  // move a block into a new package: same element
  const esc = /** @type {any} */ (k.all().find((e) => e.name === 'ESC'));
  const moved = logical.replace(/    part def ESC \{[\s\S]*?\n    \}\n/, (blk) => `    package Drives {\n${blk.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n')}    }\n`);
  applyLayerText(k, L, moved);
  log('Moving a block into a package in text keeps it (it is moved, not recreated)', k.get(esc.id)?.owner !== L && k.get(/** @type {string} */ (k.get(esc.id)?.owner))?.name === 'Drives');
  k.undo();
  log('…and undo moves it back', k.get(esc.id)?.owner === L);

  // ---------- errors that need the model ----------
  const R = k.layers()[0].id;
  const reqText = /** @type {string} */ (files.find((f) => f.layer === 'r')?.text);
  /** @param {string} t */
  const buildErr = (t, layer = R) => textError(() => buildSnapshot(k, [{ layerId: layer, node: parseLayer(t) }]));
  const e1 = buildErr(reqText.replace("derive Endurance;", "derive Endurace;"));
  log('An unknown name is an error on its line', !!e1 && /Nothing named Endurace/.test(e1.message) && reqText.split('\n')[e1.line - 1].includes('Endurace'.slice(0, 3)), e1?.message);
  log('A relationship the rules forbid is refused, saying what it joins', /cannot verify here: verify goes from a test case/.test(buildErr(reqText.replace("derive Endurance;", "verify Endurance;"))?.message || ''), buildErr(reqText.replace("derive Endurance;", "verify Endurance;"))?.message);
  log('A part directly in a package is refused', /cannot contain a part/.test(buildErr(reqText.replace('package Verification {', 'part stray : Motor;\n    package Verification {'))?.message || ''));
  log('Unknown Loom properties and enum values are refused', /no Loom property "colour"/.test(buildErr(reqText.replace('priority = "Must";', 'colour = "red";'))?.message || '') && /must be one of/.test(buildErr(reqText.replace('priority = "Should";', 'priority = "Maybe";'))?.message || ''));
  log('A layer\'s text cannot be pasted into another layer', /not R|not F/.test(buildErr(reqText, k.layers()[1].id)?.message || ''));
  log('Text must be exactly one package', !!textError(() => parseLayer('package A {} package B {}')) && !!textError(() => parseLayer('')));
  // ambiguous names, settled by qualifying
  const amb = createModel();
  const [, AF, AL] = amb.layers().map((l) => l.id);
  amb.transact('Amb', (tx) => { const p1 = tx.create('package', { owner: AL, name: 'Old' }); const p2 = tx.create('package', { owner: AL, name: 'New' }); tx.create('partDef', { owner: p1, name: 'Pump' }); tx.create('partDef', { owner: p2, name: 'Pump' }); tx.create('action', { owner: AF, name: 'Move water' }); });
  const fn = (/** @type {string} */ target) => `package Functional {\n    action def 'Move water' {\n        allocate to ${target};\n    }\n}\n`;
  log('A name two elements share is reported as ambiguous', /ambiguous/.test(textError(() => buildSnapshot(amb, [{ layerId: AF, node: parseLayer(fn('Pump')) }]))?.message || ''));
  applyLayerText(amb, AF, fn('New::Pump'));
  const pumpNew = amb.all().find((e) => e.name === 'Pump' && amb.get(/** @type {string} */ (e.owner))?.name === 'New');
  log('…and a qualified name settles it', !!pumpNew && amb.relsTo(pumpNew.id).length === 1);
  log('The printer qualifies names only where it must', printPackage(amb, AF).text.includes('allocate to New::Pump;'));
  log('resolve() prefers the nearest scope', (() => { const r = resolve(treeOf(amb), ['Pump'], /** @type {string} */ (pumpNew?.id), ['partDef']); return 'id' in r; })());

  // ---------- awkward text survives ----------
  const odd = createModel();
  const [OR, , OL] = odd.layers().map((l) => l.id);
  odd.transact('Odd', (tx) => {
    const b = tx.create('partDef', { owner: OL, name: 'It\'s "fine" — ok', props: { doc: 'Line 1\n * not a bullet */ end\n\n  indented' } });
    tx.create('attribute', { owner: b, name: 'label', props: { value: 'TBD, see note', unit: 'm/s²' } });
    tx.create('requirement', { owner: OR, name: 'part', props: { reqId: "A'1", text: 'Uses a "quote"', level: 'Component', status: 'Approved' } });
  });
  const oddBack = buildSnapshot(odd, odd.layers().map((l) => ({ layerId: l.id, node: parseLayer(printPackage(odd, l.id).text) })));
  log('Quotes, keywords as names, symbols, units and multi-line docs all round-trip', canon(oddBack) === canon(snapshot(odd)));
  log('Element keys are qualified names with the kind', [...keysOf(k).values()].includes("partDef:Logical::Battery Pack"));

  // ---------- folders ----------
  const meta = { name: 'Kestrel UAS', description: 'A drone' };
  const pf = projectFiles(k, meta);
  log('A project folder: four .sysml files and .loom/project, ids and layout', Object.keys(pf).sort().join() === '.loom/ids.json,.loom/layout.json,.loom/project.json,functional.sysml,logical.sysml,physical.sysml,requirements.sysml');
  const loaded = modelFromFiles(pf);
  log('Opening the folder gives the same model, with the same ids and layouts', canon(snapshot(loaded.model)) === canon(snapshot(k)) && loaded.name === 'Kestrel UAS' && loaded.description === 'A drone');
  log('Saving it again writes exactly the same files', Object.entries(projectFiles(loaded.model, meta)).every(([p, t]) => pf[p] === t));
  log('Layout files list one box per line, x y w h in order', /\n {4}"[0-9a-f]+": \{ "x": -?\d+, "y": -?\d+, "w": \d+, "h": \d+ \}/.test(pf['.loom/layout.json']));
  log('stableJson sorts keys so the order of edits never shows in diffs', stableJson({ b: { z: 1, a: [1] }, a: 1 }) === '{\n  "a": 1,\n  "b": {\n    "a": [1],\n    "z": 1\n  }\n}');
  const noIds = modelFromFiles(Object.fromEntries(Object.entries(pf).filter(([p]) => !p.startsWith('.loom/'))));
  log('Without .loom/ the text alone still opens (new ids, no layouts)', noIds.model.elementCount() === k.elementCount() && noIds.model.byKind('bdd').every((d) => Object.keys(d.layout?.nodes || {}).length === 0));
  const broken = { ...pf, 'logical.sysml': pf['logical.sysml'].replace("satisfy 'Usable energy';", "satisfy 'Useable energy';") };
  const fe = anyError(() => modelFromFiles(broken));
  log('A problem names its file and line', fe instanceof FileError && fe.file === 'logical.sysml' && !!fe.line && /logical\.sysml, line \d+/.test(fe.message), fe?.message);
  log('A file of the wrong layer, or none, is explained', /which RFLP layer/.test(anyError(() => modelFromFiles({ 'notes.sysml': 'package Notes { }' }))?.message || ''));
  // changes made outside Loom (git pull) come in by name, keeping ids and layouts
  const edited = { ...pf, 'logical.sysml': pf['logical.sysml'].replace('part def Motor {', 'part def Motor {\n        attribute kv = 170;') };
  const kv0 = k.version();
  const ext = applySnapshot(k, snapshotFromFiles(k, edited), 'Load from folder');
  log('Loading a changed folder into the open model changes only what changed', ext.created === 1 && ext.removed === 0 && k.version() > kv0 && k.children(motor.id).some((c) => c.name === 'kv'));
  k.undo();
  log('Folder signatures notice any change', signature(pf) === signature({ ...pf }) && signature(pf) !== signature(edited));

  // ---------- zip ----------
  log('CRC-32 matches the standard check value', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  const big = { 'Kestrel/requirements.sysml': pf['requirements.sysml'], 'Kestrel/.loom/ids.json': pf['.loom/ids.json'], 'Kestrel/ünïcode ✓.sysml': 'package Ü { }\n', 'Kestrel/tiny.txt': 'x' };
  const z = await zip(big);
  log('A zip is a zip', isZip(z) && !isZip(new TextEncoder().encode('{"format":1}')));
  const back = textFiles(await unzip(z));
  log('Zip round-trips text, unicode names and the folder (top folder taken off)', back['requirements.sysml'] === big['Kestrel/requirements.sysml'] && back['.loom/ids.json'] === big['Kestrel/.loom/ids.json'] && back['ünïcode ✓.sysml'] === 'package Ü { }\n' && back['tiny.txt'] === 'x', Object.keys(back).join());
  log('A damaged zip is refused', !!(await unzip(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).then(() => null, (e) => e)));

  // ---------- folders on disk ----------
  const dir = memoryFolder({ 'README.md': '# mine', 'notes.sysml': 'package Mine { }' });
  log('Writing a folder writes every project file', (await writeFolder(dir, pf)) === 7);
  log('…writes nothing when nothing changed', (await writeFolder(dir, pf)) === 0);
  log('…and leaves the user\'s other files alone', dir.files.get('README.md') === '# mine' && dir.files.get('notes.sysml') === 'package Mine { }');
  const rd = await readFolder(dir);
  log('Reading a folder gets the project files back', Object.keys(pf).every((p) => rd[p] === pf[p]));

  // ---------- the project store ----------
  const store = createProjectStore(memoryBackend());
  const p1 = await store.create({ name: 'Kestrel', template: 'kestrel' });
  const zipped = await store.exportZip(p1.id);
  log('Export .zip names the file after the project', zipped.filename === 'Kestrel.zip' && isZip(zipped.bytes));
  const p2 = await store.importBytes(zipped.bytes);
  const [o1, o2] = await Promise.all([store.open(p1.id), store.open(p2.id)]);
  const s1 = snapshot(o1.model), s2 = snapshot(o2.model);
  s2.elements[0].name = s1.elements[0].name; // the copy is renamed "Kestrel (2)"
  log('Importing the .zip gives the same model', canon(s1) === canon(s2) && p2.name === 'Kestrel (2)');
  log('Importing still takes .loom.json files', !!(await store.importBytes(new TextEncoder().encode((await store.exportFile(p1.id)).text))).id);
  const fdir = memoryFolder((await store.files(p1.id)).files, 'kestrel-repo');
  const p3 = await store.importFolder(await readFolder(fdir), fdir, 'kestrel-repo');
  log('Opening a folder links the project to it', p3.folder?.name === 'kestrel-repo' && (await store.folderHandle(p3.id)) === fdir);
  await store.unlink(p3.id);
  log('Unlinking forgets the folder (its files stay)', !(await store.folderHandle(p3.id)) && !(await store.list()).find((x) => x.id === p3.id)?.folder && fdir.files.size === 7);

  // ---------- a live workspace: autosave to a folder, the text pane ----------
  const wstore = createProjectStore(memoryBackend());
  const wp = await wstore.create({ name: 'Linked', template: 'kestrel' });
  const wdir = memoryFolder({}, 'linked-repo');
  const first = await wstore.files(wp.id);
  await writeFolder(wdir, first.files);
  await wstore.link(wp.id, wdir, 'linked-repo', signature(first.files));
  const settings = createSettings(null);
  settings.update((st) => { st.textPane = true; });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-5000px;top:0;width:1400px;height:900px';
  document.body.append(host);
  const opened = await wstore.open(wp.id);
  const ws = mountWorkspace(host, { meta: opened.meta, model: opened.model, settings, commands: createCommands(), projects: wstore, save: (mm) => wstore.save(wp.id, mm) });
  await new Promise((r) => setTimeout(r, 50));
  const pane = /** @type {any} */ (ws.textPane());
  log('The text pane opens with the Requirements layer', !!pane && pane.text().startsWith('package Requirements {'));
  const wm = opened.model;
  log('Typing a new requirement in the text pane adds it to the model', pane.setText(pane.text().replace('    package Verification {', "    requirement <'REQ-ENV-001'> 'Rain operation';\n\n    package Verification {")) === true && wm.all().some((e) => e.name === 'Rain operation'));
  log('Bad text is not applied, and the error is kept for the pane to show', pane.setText(pane.text().replace("derive Endurance;", "derive Nowhere;")) === false && /Nowhere/.test(pane.error()?.message || '') && wm.relsFrom(/** @type {any} */ (wm.all().find((e) => e.name === 'Usable energy')).id).some((r) => r.kind === 'derive'));
  await ws.flush();
  log('Autosave writes the change to the linked folder as SysML text', (wdir.files.get('requirements.sysml') || '').includes("requirement <'REQ-ENV-001'> 'Rain operation';"));
  log('…and records that the folder is in step', (await wstore.list()).find((x) => x.id === wp.id)?.folder?.sig === signature(Object.fromEntries([...wdir.files].filter(([pth]) => pth.endsWith('.sysml') || pth.startsWith('.loom/')))));
  ws.dispose(); host.remove();

  // ---------- settings ----------
  log('The text pane is off by default; its width is kept within limits', sanitize({}).textPane === false && sanitize({ textWidth: 99999 }).textWidth === 1200 && sanitize({ textWidth: 10 }).textWidth === 280);
}
