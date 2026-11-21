// M10: the validation worker (a model copy that follows edits), the offline app (service
// worker file list, manifest), the sample models and the desktop wrappers' files.
import { createModel } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { SAMPLES, sampleById } from '../../src/model/samples.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { validate, createValidator, fixRun } from '../../src/validate/engine.js';
import { printModel } from '../../src/text/printer.js';
import { projectFiles, modelFromFiles } from '../../src/storage/folder.js';
import { isRel, ELEMENTS } from '../../src/model/metamodel.js';
import { VERSION } from '../../src/version.js';

/** Every element as sorted JSON, so two models can be compared regardless of map order. @param {import('../../src/model/model.js').Model} m */
const fingerprint = (m) => m.all().map((e) => JSON.stringify({ ...e, kids: isRel(e.kind) ? undefined : m.children(e.id).map((c) => c.id) })).sort().join('\n');
/** The problems' keys and messages. @param {{ problems: { key: string, message: string }[] }} r */
const keys = (r) => r.problems.map((p) => `${p.key} ${p.message}`).sort().join('\n');

/** @param {import('../run.js').Log} log */
export async function releaseTests(log) {
  // ---------- a model copy that follows another by changed ids ----------
  const k = createModel(); buildKestrel(k);
  const copy = createModel({ empty: true });
  const order = (/** @type {any} */ m) => { const out = /** @type {any[]} */ ([]); const walk = (/** @type {any} */ e) => { out.push(e); m.children(e.id).forEach(walk); }; walk(m.root()); return [...out, ...m.all().filter((/** @type {any} */ e) => isRel(e.kind))]; };
  copy.loadRaw(order(k));
  log('A loaded copy matches the model', fingerprint(copy) === fingerprint(k));
  /** @type {Set<string>} */
  let touched = new Set();
  k.subscribe((e) => e.ids.forEach((id) => touched.add(id)));
  const sync = () => {
    copy.patch([...touched].map((id) => {
      const el = k.get(id);
      if (!el) return { id, el: null };
      let d = 0; for (let x = el.owner; x; x = k.get(x)?.owner ?? null) d++;
      return { id, el, d: isRel(el.kind) ? 1e6 : d, i: el.owner ? k.children(el.owner).findIndex((c) => c.id === id) : 0 };
    }));
    touched = new Set();
  };
  const L = /** @type {string} */ (k.layers()[2].id);
  const batt = /** @type {any} */ (k.all().find((e) => e.name === 'Battery Pack'));
  k.transact('Rename', (tx) => tx.rename(batt.id, 'Battery'));
  sync(); log('A rename reaches the copy', copy.get(batt.id)?.name === 'Battery' && fingerprint(copy) === fingerprint(k));
  let made = '';
  k.transact('Add', (tx) => { const p = tx.create('package', { owner: L, name: 'New' }); const b = tx.create('partDef', { owner: p, name: 'Fresh' }); tx.create('attribute', { owner: b, name: 'mass', props: { value: '1', unit: 'kg' } }); tx.link('generalize', b, batt.id); made = p; });
  sync(); log('New elements, children and relationships reach the copy', fingerprint(copy) === fingerprint(k));
  k.transact('Move', (tx) => tx.move(batt.id, made, 0));
  sync(); log('A move reaches the copy, in the right place', copy.children(made)[0]?.id === batt.id && fingerprint(copy) === fingerprint(k));
  k.transact('Delete', (tx) => tx.remove(made));
  sync(); log('Deleting a package with its contents and relationships reaches the copy', fingerprint(copy) === fingerprint(k), `${copy.count()} vs ${k.count()}`);
  k.undo(); sync();
  log('Undo reaches the copy', fingerprint(copy) === fingerprint(k));
  k.undo(); k.undo(); k.redo(); sync();
  log('A run of undos and redos reaches the copy', fingerprint(copy) === fingerprint(k));
  log('The copy finds the same problems', keys(validate(copy)) === keys(validate(k)));

  // ---------- the validator in a worker ----------
  const w = createModel(); buildKestrel(w);
  const v = createValidator(w, { worker: true, delay: 0 });
  log('The validator runs in a worker', v.inWorker());
  log('Until the worker answers, the report says it is still checking', v.report().version < 0 || v.report().problems.length > 0);
  let r = await v.now();
  log('The worker finds the same problems as the page', keys(r) === keys(validate(w)), `${r.problems.length} vs ${validate(w).problems.length}`);
  log('Problems from the worker are indexed by element', r.byId.size > 0 && [...r.byId.keys()].every((id) => !!w.get(id)));
  const WL = /** @type {string} */ (w.layers()[2].id);
  let lonely = '';
  w.transact('Add', (tx) => { lonely = tx.create('partDef', { owner: WL, name: 'Lonely' }); });
  r = await v.now();
  log('An edit is checked in the worker', r.problems.some((p) => p.rule === 'block-unused' && p.id === lonely) && keys(r) === keys(validate(w)));
  w.transact('Remove', (tx) => { tx.remove(lonely); tx.create('requirement', { owner: /** @type {string} */ (w.layers()[0].id), name: 'No ID yet', props: { text: 'The system shall work.' } }); });
  r = await v.now();
  log('A deletion is checked in the worker', !r.problems.some((p) => p.id === lonely) && keys(r) === keys(validate(w)));
  const withFix = r.problems.find((p) => p.fix && !p.fix.ui);
  log('Fixes from the worker keep their label but not their code', !!withFix && typeof (/** @type {any} */ (withFix).fix.run) === 'undefined');
  const run = withFix ? fixRun(w, withFix) : undefined;
  log('The fix is found again in the page', typeof run === 'function', withFix?.rule);
  if (run && withFix) {
    w.transact('Fix', (tx) => run(w, tx));
    r = await v.now();
    log('Using it clears the problem', !r.problems.some((p) => p.key === withFix.key && p.message === withFix.message));
  }
  let pushed = 0;
  v.subscribe(() => { pushed++; });
  w.transact('Rename', (tx) => tx.rename(/** @type {any} */ (w.all().find((e) => e.kind === 'partDef')).id, 'Block 9'));
  await new Promise((res) => setTimeout(res, 300));
  log('After an edit the worker reports on its own', pushed >= 1 && v.report().problems.some((p) => p.rule === 'name-default'));
  v.dispose();

  // 50,000 elements: checking in the worker leaves the page free
  const big = createModel({ name: 'Big' });
  const BL = /** @type {string} */ (big.layers()[2].id);
  big.transact('Generate', (tx) => {
    for (let p = 0; p < 380; p++) {
      const pkg = tx.create('package', { owner: BL, name: `Package ${p}` });
      for (let b = 0; b < 33; b++) { const blk = tx.create('partDef', { owner: pkg, name: `Block ${p}.${b}` }); tx.create('attribute', { owner: blk, name: 'mass', props: { value: '1', unit: 'kg' } }); tx.create('port', { owner: blk, name: 'p' }); tx.create('part', { owner: blk, name: 'x' }); }
    }
  });
  const t0 = performance.now();
  const bv = createValidator(big, { worker: true, delay: 0 });
  const tStart = performance.now() - t0;
  await bv.now();
  // the page's share of each edit: the edit itself and handing the change to the worker (median of 5)
  const sends = [];
  let br = /** @type {any} */ (null);
  for (let i = 0; i < 5; i++) {
    const t1 = performance.now();
    big.transact('Edit', (tx) => tx.rename(/** @type {any} */ (big.byKind('partDef')[10 + i]).id, `Renamed ${i}`));
    const pending = bv.now();
    sends.push(performance.now() - t1);
    br = await pending;
  }
  const tSend = sends.sort((x, y) => x - y)[2];
  log(`Starting the worker on ${big.count().toLocaleString()} elements takes the page under 150 ms (took ${Math.round(tStart)} ms)`, tStart < 150);
  log(`Sending an edit to the worker takes the page under 2 ms (took ${tSend.toFixed(2)} ms)`, tSend < 2);
  log(`The worker checks ${big.count().toLocaleString()} elements in under 100 ms (took ${Math.round(br.ms)} ms)`, br.ms < 100);
  bv.dispose();

  // ---------- the samples ----------
  log('There are several samples, Kestrel first', SAMPLES.length >= 3 && SAMPLES[0].id === 'kestrel');
  for (const s of SAMPLES) {
    const m = createModel(); s.build(m);
    const rep = validate(m);
    const diagrams = m.all().filter((e) => ELEMENTS[e.kind]?.diagram);
    log(`${s.title}: builds, with diagrams`, m.count() > 30 && diagrams.length >= 3, `${m.count()} elements, ${diagrams.length} diagrams`);
    // Kestrel shows a failed test and gaps on purpose; the small samples are clean
    if (s.id === 'kestrel') { const bad = rep.problems.filter((p) => p.severity === 'error' && p.rule !== 'req-failed'); log(`${s.title}: no validation errors but its failed flight test`, !bad.length, bad.map((p) => p.message).join('; ')); }
    else log(`${s.title}: no validation errors or warnings`, rep.counts.error + rep.counts.warning === 0, rep.problems.filter((p) => p.severity !== 'info').map((p) => p.message).join('; '));
    log(`${s.title}: every diagram shows something`, !rep.problems.some((p) => p.rule === 'diagram-empty'), rep.problems.filter((p) => p.rule === 'diagram-empty').map((p) => p.message).join(', '));
    const unchecked = m.byKind('requirement').filter((q) => q.props.check);
    log(`${s.title}: its live requirement checks run`, unchecked.every((q) => !rep.problems.some((p) => p.id === q.id && p.rule === 'req-check')));
    const again = restore(JSON.parse(JSON.stringify(snapshot(m))));
    log(`${s.title}: saves and opens`, again.count() === m.count());
    let text = '';
    try { const files = projectFiles(m, { name: s.name, description: '', created: '2026-01-01T00:00:00Z' }); text = printModel(m).map((f) => f.text).join('\n'); const back = modelFromFiles(files); log(`${s.title}: round-trips through SysML v2 text`, back.model.count() === m.count(), `${back.model.count()} vs ${m.count()}`); }
    catch (e) { log(`${s.title}: round-trips through SysML v2 text`, false, e instanceof Error ? e.message : String(e)); }
    log(`${s.title}: prints as SysML v2 text`, text.length > 200);
    log(`${s.title}: found by id`, sampleById(s.id) === s);
  }

  // ---------- the offline app ----------
  const sw = await (await fetch('../sw.js', { cache: 'no-store' })).text();
  const listed = new Set(JSON.parse(/** @type {string} */ (sw.match(/const FILES = (\[[\s\S]*?\]);/)?.[1])));
  // every module the app needs is loaded by these tests or by app.js; check the ones the page has loaded
  const loaded = performance.getEntriesByType('resource').map((e) => new URL(e.name)).filter((u) => u.origin === location.origin && /^\/(src|css|assets)\//.test(u.pathname)).map((u) => u.pathname.slice(1));
  const missing = [...new Set(loaded)].filter((p) => !listed.has(p));
  log('The offline file list has every app file the tests loaded', loaded.length > 50 && !missing.length, missing.join(', ') || `${loaded.length} files`);
  log('The offline file list has the page, styles, fonts, icons and manifest', ['index.html', 'css/loom.css', 'src/app.js', 'src/validate/worker.js', 'assets/fonts/SpaceGrotesk.woff2', 'manifest.webmanifest', 'assets/icon-192.png', 'assets/icon-512.png'].every((f) => listed.has(f)));
  const allThere = await Promise.all([...listed].map(async (f) => (await fetch(`../${f}`, { method: 'HEAD', cache: 'no-store' })).ok || f));
  log('Every file in the offline list exists', allThere.every((x) => x === true), allThere.filter((x) => x !== true).join(', '));
  log('The offline cache is named for this version', sw.includes(`loom-${VERSION}-`));
  const man = await (await fetch('../manifest.webmanifest', { cache: 'no-store' })).json();
  log('The manifest makes an installable app', man.name === 'Pteronautics Loom' && man.display === 'standalone' && man.start_url && man.icons.some((/** @type {any} */ i) => i.sizes === '512x512') && man.icons.some((/** @type {any} */ i) => i.purpose === 'maskable'));
  log('The installed app opens SysML and Loom files', (man.file_handlers || []).some((/** @type {any} */ f) => Object.values(f.accept).flat().includes('.sysml')) && (man.file_handlers || []).some((/** @type {any} */ f) => Object.values(f.accept).flat().includes('.json')));
  const icon = await fetch('../assets/icon-512.png', { cache: 'no-store' });
  const bmp = await createImageBitmap(await icon.blob());
  log('The app icon is 512 × 512', bmp.width === 512 && bmp.height === 512, `${bmp.width}×${bmp.height}`);

  // ---------- the desktop wrappers ----------
  const conf = await fetch('../desktop/tauri/tauri.conf.json', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
  log('The Tauri configuration names Loom and its version', conf?.productName === 'Pteronautics Loom' && conf?.version === VERSION && conf?.identifier, conf ? `${conf.productName} ${conf.version}` : 'missing');
  const plist = await fetch('../Pteronautics%20Loom.app/Contents/Info.plist', { cache: 'no-store' }).then((x) => (x.ok ? x.text() : '')).catch(() => '');
  log('The macOS launcher app is there', plist.includes('<string>Pteronautics Loom</string>'));
}
