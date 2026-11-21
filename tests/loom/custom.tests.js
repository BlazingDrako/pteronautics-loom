// M8: validation (rules, rule sets, custom rules, ignoring, fixes), profiles and stereotypes
// (model, text, folders), view presets, settings and shortcut remapping.
import { createModel, ModelError } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { validate, configOf, parseConfig, configText, updateConfig, effective, createValidator, customError, customText } from '../../src/validate/engine.js';
import { RULES, RULE_SETS, inSet } from '../../src/validate/rules.js';
import { appliedOf, applyStereo, unapplyStereo, setTag, stereoFill, decorate, stereoLine, applicableStereotypes } from '../../src/custom/stereo.js';
import { presetsFor, presetProps, matches, currentOptions, viewFlags } from '../../src/custom/presets.js';
import { printModel } from '../../src/text/printer.js';
import { parseLayer, buildSnapshot, applyLayerText } from '../../src/text/build.js';
import { projectFiles, modelFromFiles, snapshotFromFiles } from '../../src/storage/folder.js';
import { sanitize, defaults, isCombo } from '../../src/settings.js';
import { createCommands, comboFromEvent, normalizeCombo, matchKeys } from '../../src/commands.js';
import { nodeContent } from '../../src/canvas/bdd.js';

/** @param {() => unknown} fn */
const err = (fn) => { try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
/** @param {import('../../src/model/model.js').Model} m @param {string} rule */
const of = (m, rule) => validate(m).problems.filter((p) => p.rule === rule);

/** @param {import('../run.js').Log} log */
export function customTests(log) {
  // ---------- rules on a small model ----------
  const m = createModel({ name: 'Rules' });
  const [R, F, L] = m.layers().map((l) => l.id);
  /** @type {Record<string, string>} */
  const x = {};
  m.transact('Build', (tx) => {
    x.a = tx.create('partDef', { owner: L, name: 'A' });
    x.b = tx.create('partDef', { owner: L, name: 'B' });
    x.pa = tx.create('part', { owner: x.a, name: 'b', props: { type: x.b } });
    x.pb = tx.create('part', { owner: x.b, name: 'a', props: { type: x.a } });
    x.loose = tx.create('part', { owner: x.a, name: 'loose', props: { multiplicity: '3..1' } });
    x.val = tx.create('attribute', { owner: x.a, name: 'mass', props: { value: 'heavy', unit: 'furlongs' } });
    x.r1 = tx.create('requirement', { owner: R, name: 'Speed', props: { reqId: 'R-1', text: 'The system should be fast and/or cheap. TBD' } });
    x.r2 = tx.create('requirement', { owner: R, name: 'Copy', props: { reqId: 'R-1', text: 'The system shall weigh 2 kg.' } });
    x.r3 = tx.create('requirement', { owner: R, name: 'Requirement 3' });
    x.t = tx.create('testCase', { owner: R, name: 'Orphan test' });
    x.fn = tx.create('action', { owner: F, name: 'Do the thing' });
    x.d = tx.create('bdd', { owner: L, name: 'Empty diagram' });
    tx.link('generalize', x.a, x.b); tx.link('generalize', x.b, x.a);
  });
  log('A part without a type is flagged', of(m, 'part-untyped').some((p) => p.id === x.loose));
  log('A bad multiplicity (a range that goes backwards) is an error', of(m, 'multiplicity').some((p) => p.id === x.loose && p.severity === 'error'));
  log('Blocks that contain each other are found', of(m, 'composition-cycle').length === 2);
  log('A generalization cycle is found', of(m, 'generalization-cycle').length >= 1);
  log('Unknown units and values that are not numbers are flagged', of(m, 'unit-unknown').some((p) => p.id === x.val) && of(m, 'value-number').some((p) => p.id === x.val));
  log('Duplicate requirement IDs are errors on both requirements', of(m, 'req-duplicate-id').length === 2 && of(m, 'req-duplicate-id').every((p) => p.severity === 'error'));
  log('A requirement with no ID gets a fix that numbers it', !!of(m, 'req-id').find((p) => p.id === x.r3)?.fix?.run);
  log('Wording: vague words, TBDs, "shall" and compound requirements', of(m, 'req-vague').some((p) => p.id === x.r1 && /fast/.test(p.message)) && of(m, 'req-tbd').some((p) => p.id === x.r1) && of(m, 'req-shall').some((p) => p.id === x.r1) && of(m, 'req-single').some((p) => p.id === x.r1));
  log('"shall" in the text is not flagged', !of(m, 'req-shall').some((p) => p.id === x.r2));
  log('Requirements not satisfied and not verified are flagged', of(m, 'req-satisfied').some((p) => p.id === x.r2) && of(m, 'req-verified').some((p) => p.id === x.r2));
  log('A test case that verifies nothing is flagged', of(m, 'test-verifies').some((p) => p.id === x.t));
  log('A leaf function in the Functional layer that is not allocated is flagged', of(m, 'function-allocated').some((p) => p.id === x.fn));
  log('Default names and empty diagrams are notes', of(m, 'name-default').some((p) => p.id === x.r3 && p.severity === 'info' && p.fix?.ui === 'rename') && of(m, 'diagram-empty').some((p) => p.id === x.d));
  const fix = /** @type {any} */ (of(m, 'req-id').find((p) => p.id === x.r3)?.fix);
  m.transact(fix.label, (tx) => fix.run(m, tx));
  log('Running a fix changes the model (one undoable step) and the problem goes', !!m.get(x.r3)?.props.reqId && !of(m, 'req-id').some((p) => p.id === x.r3) && m.undoLabel() === fix.label);
  m.undo();

  // ---------- rule sets and settings ----------
  const strict = RULES.filter((r) => inSet(r, 'strict')).length, draft = RULES.filter((r) => inSet(r, 'draft'));
  log('Strict turns every rule on; Early draft only errors', strict === RULES.length && draft.every((r) => r.severity === 'error') && draft.length > 3);
  log('Requirements quality only has requirement rules', RULES.filter((r) => inSet(r, 'requirements')).every((r) => ['Requirements', 'Wording'].includes(r.category)));
  log('Naming conventions are off in Recommended, on in Strict', !RULES.find((r) => r.id === 'name-case')?.sets.includes('recommended') && effective({ ...parseConfig(''), set: 'strict' }).get('name-case') === 'info');
  updateConfig(m, 'Early draft', (c) => { c.set = 'draft'; });
  const dr = validate(m);
  log('With Early draft, only errors are reported', dr.problems.length > 0 && dr.problems.every((p) => p.severity === 'error'));
  log('Changing the settings is an undoable edit on the project', m.undoLabel() === 'Early draft' && configOf(m).set === 'draft');
  m.undo();
  log('Undo brings the old rule set back', configOf(m).set === 'recommended');
  updateConfig(m, 'Tune', (c) => { c.rules['req-shall'] = 'off'; c.rules['part-untyped'] = 'error'; c.rules['doc-missing'] = 'on'; });
  const tuned = validate(m);
  log('A rule can be turned off, made more severe, or turned on outside its set', !tuned.problems.some((p) => p.rule === 'req-shall') && tuned.problems.find((p) => p.rule === 'part-untyped')?.severity === 'error' && tuned.problems.some((p) => p.rule === 'doc-missing' && p.severity === 'info'));
  updateConfig(m, 'Ignore', (c) => { c.ignored.push(`multiplicity|${x.loose}`); });
  const ig = validate(m);
  log('An ignored problem is hidden and counted', !ig.problems.some((p) => p.rule === 'multiplicity') && ig.ignored === 1);
  log('Settings text is stable and empty for the defaults', configText(parseConfig('')) === '' && configText(parseConfig(configText(configOf(m)))) === configText(configOf(m)));
  log('Damaged settings fall back safely', parseConfig('{nope').set === 'recommended' && parseConfig({ set: 'bogus', rules: { 'no-such': 'error', 'req-id': 'loud' }, custom: [{ kind: 'zzz' }] }).custom.length === 0 && !Object.keys(parseConfig({ rules: { 'req-id': 'loud' } }).rules).length);

  // ---------- custom rules ----------
  updateConfig(m, 'Custom', (c) => {
    c.custom.push({ id: 'c1', name: '', kind: 'requirement', prop: 'priority', test: 'set', value: '', severity: 'warning' });
    c.custom.push({ id: 'c2', name: '', kind: 'partDef', prop: 'name', test: 'match', value: '^[A-Z][a-z]', severity: 'info' });
  });
  const cr = validate(m);
  log('A custom rule: every requirement\'s priority must be set', cr.problems.filter((p) => p.rule === 'custom:c1').length === 3);
  log('A custom rule with a pattern: block names must match ^[A-Z][a-z]', cr.problems.filter((p) => p.rule === 'custom:c2').length === 2, cr.problems.filter((p) => p.rule === 'custom:c2').map((p) => p.message).join('; '));
  log('Custom rules read as sentences, and bad patterns are caught', /Requirement's priority must be set/.test(customText(configOf(m).custom[0])) && !!customError({ id: 'z', name: '', kind: 'partDef', prop: 'name', test: 'match', value: '([', severity: 'info' }));

  // ---------- behavior and analysis feed in ----------
  const k = buildKestrel(createModel());
  const kr = validate(k);
  log('The Kestrel sample validates with no errors except its failed test', kr.problems.filter((p) => p.severity === 'error').every((p) => p.rule === 'req-failed'), kr.problems.filter((p) => p.severity === 'error').map((p) => `${p.rule}: ${p.message}`).join('; '));
  log('The failed cruise test is reported on its requirement', kr.problems.some((p) => p.rule === 'req-failed' && /Cruise flight test failed/.test(p.message)));
  log('Every problem names an element that exists', kr.problems.every((p) => !!k.get(p.id)));
  log('A behavior check\'s all-clear ("every run reaches the end") is not a problem', !kr.problems.some((p) => /reaches the end|can be reached and left|is consistent\./.test(p.message)));
  log('Problems are grouped by element for badges', [...kr.byId.values()].every((list) => list.length > 0) && kr.byId.size > 0);
  const act = k.byKind('action').find((a) => k.children(a.id).some((c) => c.kind === 'controlNode'));
  if (act) {
    const flow = k.children(act.id).find((c) => c.kind === 'flow');
    k.transact('Break the activity', (tx) => tx.remove(/** @type {any} */ (flow).id));
    log('Breaking an activity shows up as a behavior problem', of(k, 'activity').length > 0);
    k.undo();
  }

  // ---------- the live validator ----------
  const lm = createModel();
  const v = createValidator(lm, { delay: 0 });
  let calls = 0;
  v.subscribe(() => { calls++; });
  lm.transact('Add', (tx) => tx.create('partDef', { owner: /** @type {string} */ (lm.layers()[2].id), name: 'Lonely' }));
  v.now();
  log('The validator re-runs and tells its subscribers', calls >= 1 && v.report().problems.some((p) => p.rule === 'block-unused'));
  v.dispose();

  // ---------- speed ----------
  const big = createModel();
  const BL = /** @type {string} */ (big.layers()[2].id), BR = /** @type {string} */ (big.layers()[0].id);
  big.transact('Big', (tx) => {
    for (let i = 0; i < 1500; i++) {
      const b = tx.create('partDef', { owner: BL, name: `Block ${i}` });
      for (let j = 0; j < 4; j++) tx.create('part', { owner: b, name: `p${j}` });
      tx.create('attribute', { owner: b, name: 'mass', props: { value: '2', unit: 'kg' } });
      tx.create('port', { owner: b, name: 'pwr' });
    }
    for (let i = 0; i < 3000; i++) tx.create('requirement', { owner: BR, name: `Req ${i}`, props: { reqId: `R-${i}`, text: 'The system shall be quick and cheap.' } });
  });
  validate(big);
  const t0 = performance.now(); const br = validate(big); const ms = performance.now() - t0;
  log(`Validating ${big.count()} elements takes under 500 ms (took ${Math.round(ms)} ms)`, ms < 500, `${br.problems.length} problems`);

  // ---------- profiles and stereotypes ----------
  const s = createModel({ name: 'Stereo' });
  const [, , SL] = s.layers().map((l) => l.id);
  /** @type {Record<string, string>} */
  const y = {};
  s.transact('Profile', (tx) => {
    y.prof = tx.create('profile', { owner: SL, name: 'Safety' });
    y.crit = tx.create('stereotype', { owner: y.prof, name: 'Critical', props: { extends: 'partDef,part', color: 'coral', icon: '◆' } });
    y.dal = tx.create('attribute', { owner: y.crit, name: 'dal', props: { value: 'C' } });
    y.owner = tx.create('attribute', { owner: y.crit, name: 'owner' });
    y.sw = tx.create('stereotype', { owner: y.prof, name: 'Software' });
    y.blk = tx.create('partDef', { owner: SL, name: 'Flight Computer' });
    y.req = tx.create('requirement', { owner: /** @type {string} */ (s.layers()[0].id), name: 'Safe', props: { text: 'The system shall be safe.' } });
  });
  s.transact('Apply', (tx) => { applyStereo(s, tx, y.blk, y.crit); setTag(s, tx, y.blk, y.crit, y.dal, 'A'); });
  const info = appliedOf(s, y.blk);
  log('A stereotype is applied, with a tagged value and a default', info.length === 1 && info[0].tags.find((t) => t.tag.id === y.dal)?.value === 'A' && info[0].tags.find((t) => t.tag.id === y.owner)?.value === '');
  log('Applying a stereotype to a kind it does not extend is refused', /cannot be applied to a requirement/.test(err(() => s.transact('Bad', (tx) => applyStereo(s, tx, y.req, y.crit)))));
  log('Applying the same stereotype twice is refused', /already applied/.test(err(() => s.transact('Twice', (tx) => tx.setProps(y.blk, { applied: [{ s: y.crit }, { s: y.crit }] })))));
  log('A tag of another stereotype is refused', /no such tag/.test(err(() => s.transact('Tag', (tx) => tx.setProps(y.blk, { applied: [{ s: y.sw, tags: { [y.dal]: 'x' } }] })))));
  log('Which stereotypes can apply: by kind, and "any" when none is picked', applicableStereotypes(s, 'partDef').length === 2 && applicableStereotypes(s, 'requirement').map((x2) => x2.name).join() === 'Software');
  log('Setting a tag back to its default clears it', (() => { s.transact('Default', (tx) => setTag(s, tx, y.blk, y.crit, y.dal, 'C')); const ok = !s.get(y.blk)?.props.applied[0].tags; s.undo(); return ok; })());
  log('The stereotype color fills the box', stereoFill(s, y.blk) === 'coral');
  const dg = s.transact('Diagram', (tx) => tx.create('bdd', { owner: SL, name: 'D' }));
  const c0 = nodeContent(s, /** @type {any} */ (s.get(y.blk)), /** @type {any} */ (s.get(dg)), 'sysml');
  const c1 = decorate(s, /** @type {any} */ (s.get(y.blk)), s.get(dg), 'sysml', c0);
  log('On a diagram: «block, Critical», the icon, the color and a tags compartment', c1.stereo === '«block, Critical»' && c1.name.startsWith('◆ ') && c1.stereoFill === 'coral' && c1.compartments.some((cp) => cp.title === 'tags' && cp.rows.includes('dal = A')));
  log('Guided notation lists the stereotypes in words', stereoLine('Part type', ['Critical'], 'guided') === 'Part type · Critical' && stereoLine('', ['A', 'B'], 'sysml') === '«A, B»');
  s.transact('Hide tags', (tx) => tx.setProps(dg, { showTags: false }));
  log('A diagram can hide tagged values', !decorate(s, /** @type {any} */ (s.get(y.blk)), s.get(dg), 'sysml', c0).compartments.some((cp) => cp.title === 'tags'));

  // text round trip
  const files = printModel(s);
  const logical = files.find((f) => f.layer === 'l')?.text || '';
  log('Profiles print as library packages, stereotypes as metadata defs', /library package Safety \{/.test(logical) && /metadata def Critical \{/.test(logical));
  log('An applied stereotype prints as a metadata usage with its tags', /@Critical \{ dal = "A"; \}/.test(logical), logical.split('\n').filter((l) => l.includes('@')).join(' | '));
  const back = createModel({ name: 'Back' });
  const snap = buildSnapshot(back, back.layers().map((l, i) => ({ layerId: l.id, node: parseLayer(files[i].text) })));
  const rb = restore(snap);
  const blk2 = rb.byKind('partDef').find((b) => b.name === 'Flight Computer');
  const back1 = blk2 ? appliedOf(rb, blk2.id) : [];
  log('Text → model keeps stereotypes and tagged values', back1.length === 1 && back1[0].st.name === 'Critical' && back1[0].tags.find((t) => t.tag.name === 'dal')?.value === 'A');
  log('Printing the parsed model gives the same text', printModel(rb).map((f) => f.text).join() === files.map((f) => f.text).join());
  const lid = /** @type {string} */ (s.layers()[2].id);
  log('A stereotype that does not apply is a text error', /cannot be applied to a block: it applies to requirement/.test(err(() => applyLayerText(s, lid, logical.replace('extends = "partDef,part"', 'extends = "requirement"')))), err(() => applyLayerText(s, lid, logical.replace('extends = "partDef,part"', 'extends = "requirement"'))));
  log('An unknown tag in text is explained', /has no tag named colour/.test(err(() => applyLayerText(s, lid, logical.replace('dal = "A";', 'colour = "red";')))));
  log('An unknown stereotype in text is explained', /Nothing named Crit/.test(err(() => applyLayerText(s, lid, logical.replace('@Critical', '@Crit')))));

  // deleting
  s.transact('Delete tag', (tx) => tx.remove(y.dal));
  log('Deleting a tag removes its values', !s.get(y.blk)?.props.applied?.[0]?.tags);
  s.undo();
  s.transact('Delete stereotype', (tx) => tx.remove(y.crit));
  log('Deleting a stereotype takes it off every element', !s.get(y.blk)?.props.applied);
  s.undo();
  log('Undo puts the stereotype and its tagged values back', appliedOf(s, y.blk)[0]?.tags.find((t) => t.tag.id === y.dal)?.value === 'A');
  s.transact('Narrow', (tx) => tx.setProps(y.crit, { extends: 'part' }));
  log('Narrowing what a stereotype applies to flags elements that no longer fit, with a fix', of(s, 'stereotype-kind').some((p) => p.id === y.blk && !!p.fix?.run));
  s.undo();
  log('A tag with no default and no value is a note', of(s, 'stereotype-tags').some((p) => p.id === y.blk && /owner/.test(p.message)));

  // saved files
  const snap2 = JSON.parse(JSON.stringify(snapshot(s)));
  snap2.elements.find((e) => e.id === y.blk).props.applied.push({ s: 'nothere1', tags: { zz: 1 } });
  const r2 = restore(snap2);
  log('A saved model drops stereotypes that are missing', appliedOf(r2, y.blk).length === 1 && r2.get(y.blk)?.props.applied.length === 1);
  log('The Kestrel sample has a profile and stereotyped blocks', k.byKind('stereotype').length === 3 && k.byKind('partDef').filter((b) => appliedOf(k, b.id).length).length === 3);

  // folders keep validation settings and stereotypes
  updateConfig(k, 'Strict', (c) => { c.set = 'strict'; c.rules['req-shall'] = 'off'; });
  const meta = { name: 'Kestrel UAS', description: '' };
  const pf = projectFiles(k, meta);
  const fromDisk = modelFromFiles(pf);
  log('A project folder keeps the validation settings (in .loom/project.json)', /"validation"/.test(pf['.loom/project.json']) && configOf(fromDisk.model).set === 'strict' && configOf(fromDisk.model).rules['req-shall'] === 'off');
  log('A project folder keeps stereotypes and tagged values', fromDisk.model.byKind('partDef').filter((b) => appliedOf(fromDisk.model, b.id).length).length === 3);
  log('Saving the loaded folder again writes the same files', Object.entries(projectFiles(fromDisk.model, meta)).every(([p, t]) => pf[p] === t));
  const live = snapshotFromFiles(k, pf);
  log('Loading the folder into the open model changes nothing', JSON.stringify(live.elements[0].props) === JSON.stringify(k.root().props));

  // ---------- presets ----------
  const pm = createModel();
  const pd = pm.transact('D', (tx) => tx.create('bdd', { owner: /** @type {string} */ (pm.layers()[2].id), name: 'D' }));
  const list = presetsFor('bdd', [{ id: 'mine', name: 'Mine', kind: 'bdd', props: { showParts: false } }, { id: 'other', name: 'Other', kind: 'req', props: {} }]);
  log('Presets: Everything, Loom\'s own, then yours for that kind only', list[0].name === 'Everything' && list.some((p) => p.id === 'bdd-names') && list.at(-1)?.id === 'mine' && !list.some((p) => p.id === 'other'));
  log('View options do not include snapping (that is how you edit, not what you see)', !viewFlags('bdd').some(([k2]) => k2 === 'snap') && viewFlags('bdd').some(([k2]) => k2 === 'showTags'));
  const names = /** @type {any} */ (list.find((p) => p.id === 'bdd-names'));
  pm.transact('Apply', (tx) => tx.setProps(pd, presetProps('bdd', names)));
  log('Applying a preset sets the diagram\'s options, and it then matches', pm.get(pd)?.props.showParts === false && matches(/** @type {any} */ (pm.get(pd)), names) && !matches(/** @type {any} */ (pm.get(pd)), list[0]));
  log('The current options can be saved as a preset', JSON.stringify(currentOptions(/** @type {any} */ (pm.get(pd)))) === JSON.stringify(presetProps('bdd', names)));

  // ---------- settings ----------
  const st = sanitize({ accent: 'violet', contrast: 'high', grid: false, problems: true, problemsH: 5000, keys: { 'palette.open': 'Mod+P', bad: 'Mod+Shift+Alt+Mod+X', 'x.y': '' }, presets: [{ id: 'p1', name: 'P', kind: 'bdd', props: { showParts: false, evil: 'x' } }, { id: '<script>' }], defaultPresets: { bdd: 'p1' } });
  log('Appearance settings are kept when valid', st.accent === 'violet' && st.contrast === 'high' && st.grid === false && st.problems === true && st.problemsH === 800);
  log('Shortcut changes are kept only when they are real combos', st.keys['palette.open'] === 'Mod+P' && !('bad' in st.keys) && st.keys['x.y'] === '');
  log('Presets are cleaned: only on/off options, valid ids', st.presets.length === 1 && st.presets[0].props.showParts === false && !('evil' in st.presets[0].props) && st.defaultPresets.bdd === 'p1');
  log('Unknown accents and contrasts fall back to the defaults', sanitize({ accent: 'neon', contrast: 'max' }).accent === defaults().accent && sanitize({ contrast: 'max' }).contrast === 'normal');
  log('Combos: Mod+Shift+K, F8, ? and Space are combos; Mod alone is not', isCombo('Mod+Shift+K') && isCombo('F8') && isCombo('?') && isCombo('Space') && !isCombo('Mod') && !isCombo('Mod+'));

  // ---------- shortcut remapping ----------
  const cmds = createCommands();
  let ran = '';
  cmds.add({ id: 'a', title: 'A', group: 'G', keys: 'Mod+K', run: () => { ran = 'a'; } });
  cmds.add({ id: 'b', title: 'B', group: 'G', run: () => { ran = 'b'; } });
  cmds.setOverrides({ b: 'Mod+K', a: '' });
  const ev = (/** @type {any} */ o) => ({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o });
  log('A remapped shortcut runs the new command; the old one loses it', cmds.forEvent(ev({ metaKey: true }), true)?.id === 'b' && !cmds.get('a')?.keys && cmds.get('a')?.defaultKeys === 'Mod+K');
  log('Who already uses a combo, ignoring the command being changed', cmds.usersOf('Mod+K').map((c) => c.id).join() === 'b' && !cmds.usersOf('Mod+K', 'b').length);
  cmds.setOverrides({});
  log('Clearing the changes brings the defaults back', cmds.forEvent(ev({ metaKey: true }), true)?.id === 'a' && !cmds.get('b')?.keys);
  log('Recording: a key press becomes a combo (Mod on the platform\'s key)', comboFromEvent(ev({ metaKey: true, shiftKey: true, key: 'K' }), true) === 'Mod+Shift+K' && comboFromEvent(ev({ ctrlKey: true, key: 'p' }), false) === 'Mod+P' && comboFromEvent(ev({ key: 'Shift' }), true) === null && comboFromEvent(ev({ key: '?', shiftKey: true }), true) === '?');
  log('⌥ shortcuts are matched by the physical key (macOS types ˚ for ⌥K)', comboFromEvent(ev({ altKey: true, key: '˚', code: 'KeyK' }), true) === 'Alt+K' && matchKeys('Alt+K', /** @type {any} */ (ev({ altKey: true, key: '˚', code: 'KeyK' })), true));
  log('Combos compare in any order', normalizeCombo('Shift+Mod+k') === 'Mod+Shift+K');
  log('Every rule set has a name and a note', RULE_SETS.every((r) => r.name && r.note));
  log('Every rule explains itself', RULES.every((r) => r.title && r.help && r.category && (r.check || r.all)));
  log('Rule ids are unique', new Set(RULES.map((r) => r.id)).size === RULES.length);
  log('ModelError is what refused edits throw', err(() => m.transact('x', (tx) => tx.setProps(x.blk || x.a, { applied: [{ s: 'missing' }] }))) === 'That is not a stereotype' && ModelError !== undefined);
}
