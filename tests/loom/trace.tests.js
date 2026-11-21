import { createModel } from '../../src/model/model.js';
import { snapshot, restore } from '../../src/model/serialize.js';
import { buildKestrel } from '../../src/model/sample.js';
import { ELEMENTS, RELATIONSHIPS, childKinds, isDiagram } from '../../src/model/metamodel.js';
import { idPrefixFor, nextReqId, renumber, duplicateIds, levelOf, requirementStatus, coverage, threadOf, step, requirementsIn, pct } from '../../src/model/trace.js';
import { reqNodeContent, reqEdgesFor, reqLinkKinds, canShowReq } from '../../src/canvas/req.js';
import { naturalSize, heightAt } from '../../src/canvas/bdd.js';
import { wrapLines, textWidth, FONTS } from '../../src/canvas/measure.js';
import { parseColumns, formatColumns, tableRows, toCsv, cellText, DEFAULT_COLUMNS } from '../../src/views/table.js';
import { matrixData, matrixCsv, setMembers } from '../../src/views/matrix.js';
import { laneCards, laneLinks, isGap } from '../../src/views/trace.js';
import { vStages } from '../../src/views/vhome.js';

/** @param {import('../run.js').Log} log */
export function traceTests(log) {
  // ---------- metamodel ----------
  log('Requirement diagrams, tables and matrices are views that live in packages', ['req', 'table', 'matrix'].every((k) => isDiagram(k) && childKinds('package').includes(k)));
  log('Copy goes from requirement to requirement', RELATIONSHIPS.copy.sources.includes('requirement') && RELATIONSHIPS.copy.targets.includes('requirement'));
  log('Requirements have level, status, priority and method; test cases have a result', ['level', 'status', 'priority', 'method'].every((p) => p in ELEMENTS.requirement.props) && 'result' in ELEMENTS.testCase.props);
  log('View settings kept by a view are hidden from the inspector', ELEMENTS.table.props.columns.hidden === true && ELEMENTS.matrix.props.rel.hidden === true);

  // ---------- IDs ----------
  const m = createModel();
  const R = m.layers()[0].id;
  const { pkg, sub, a, b } = m.transact('Setup', (tx) => {
    const pkg = tx.create('package', { owner: R, name: 'Performance', props: { idPrefix: 'PRF-' } });
    const sub = tx.create('package', { owner: pkg, name: 'Range' });
    const a = tx.create('requirement', { owner: pkg, name: 'A', props: { reqId: 'PRF-007' } });
    const b = tx.create('requirement', { owner: sub, name: 'B', props: { reqId: 'PRF-0010' } });
    return { pkg, sub, a, b };
  });
  log('An ID prefix applies to packages inside, too', idPrefixFor(m, sub) === 'PRF-' && idPrefixFor(m, R) === 'REQ-');
  log('The next ID is one more than the highest, keeping the widest padding', nextReqId(m, sub) === 'PRF-0011', nextReqId(m, sub));
  log('A prefix nobody uses yet starts at 001', nextReqId(m, R) === 'REQ-001');
  m.transact('Dup', (tx) => tx.setProps(b, { reqId: 'PRF-007' }));
  log('Duplicate IDs are found', duplicateIds(m).has('PRF-007'));
  let changed = 0;
  m.transact('Renumber', (tx) => { changed = renumber(m, tx, pkg); });
  // the Range package comes before A in Performance, so B is first
  log('Renumbering numbers requirements in browser order', m.get(b)?.props.reqId === 'PRF-001' && m.get(a)?.props.reqId === 'PRF-002' && changed === 2, `${m.get(a)?.props.reqId} ${m.get(b)?.props.reqId}`);
  m.undo();
  log('…and undo puts the old IDs back', m.get(a)?.props.reqId === 'PRF-007');
  log('requirementsIn walks packages and nested requirements in order', requirementsIn(m, R).map((x) => x.el.name).join() === 'B,A');

  // ---------- levels ----------
  const lv = createModel();
  const LR = lv.layers()[0].id;
  const r = lv.transact('Levels', (tx) => {
    const needs = tx.create('package', { owner: LR, name: 'Stakeholder needs' });
    const n1 = tx.create('requirement', { owner: needs, name: 'N1' });
    const s1 = tx.create('requirement', { owner: LR, name: 'S1' });
    const s1a = tx.create('requirement', { owner: s1, name: 'S1a' });
    const sub1 = tx.create('requirement', { owner: LR, name: 'Sub1' });
    const lonely = tx.create('requirement', { owner: LR, name: 'Lonely' });
    const fixed = tx.create('requirement', { owner: LR, name: 'Fixed', props: { level: 'Component' } });
    tx.link('derive', s1, n1); tx.link('derive', sub1, s1);
    return { n1, s1, s1a, sub1, lonely, fixed };
  });
  log('A requirement in a stakeholder needs package is a need', levelOf(lv, r.n1) === 'Need');
  log('Derived from a need: system; derived from that: subsystem', levelOf(lv, r.s1) === 'System' && levelOf(lv, r.sub1) === 'Subsystem');
  log('Contained requirements keep their container\'s level', levelOf(lv, r.s1a) === 'System');
  log('A requirement on its own is a system requirement', levelOf(lv, r.lonely) === 'System');
  log('An explicit level wins (and auto can still be asked for)', levelOf(lv, r.fixed) === 'Component' && levelOf(lv, r.fixed, new Set(), true) === 'System');
  lv.transact('Cycle', (tx) => tx.link('derive', r.n1, r.sub1));
  log('Derivation cycles do not hang', ['Need', 'System', 'Subsystem', 'Component'].includes(levelOf(lv, r.s1)));
  lv.undo();

  // ---------- status ----------
  const sm = createModel();
  const [SR, , SL] = sm.layers().map((l) => l.id);
  const st = sm.transact('Status', (tx) => {
    const parent = tx.create('requirement', { owner: SR, name: 'Parent' });
    const c1 = tx.create('requirement', { owner: parent, name: 'C1' });
    const c2 = tx.create('requirement', { owner: parent, name: 'C2' });
    const blk = tx.create('partDef', { owner: SL, name: 'Blk' });
    const t1 = tx.create('testCase', { owner: SR, name: 'T1', props: { result: 'Pass' } });
    const t2 = tx.create('testCase', { owner: SR, name: 'T2', props: { result: 'Not run' } });
    tx.link('satisfy', blk, c1); tx.link('verify', t1, c1); tx.link('verify', t2, c2);
    return { parent, c1, c2, blk, t1, t2 };
  });
  let S = requirementStatus(sm);
  log('Satisfied directly', !!S.get(st.c1)?.satisfied && !S.get(st.c2)?.satisfied);
  log('A parent is not satisfied until every sub-requirement is', !S.get(st.parent)?.satisfied);
  sm.transact('Sat', (tx) => tx.link('satisfy', st.blk, st.c2));
  S = requirementStatus(sm);
  log('…and is once they all are', !!S.get(st.parent)?.satisfied && S.get(st.parent)?.direct.satisfy.length === 0);
  log('Verified through sub-requirements; passed only when every test passed', !!S.get(st.parent)?.verified && !S.get(st.parent)?.passed && !!S.get(st.c1)?.passed);
  sm.transact('Fail', (tx) => tx.setProps(st.t2, { result: 'Fail' }));
  S = requirementStatus(sm);
  log('A failed test fails the requirement and its parent', !!S.get(st.c2)?.failed && !!S.get(st.parent)?.failed);
  sm.transact('Retire', (tx) => tx.setProps(st.c2, { status: 'Retired' }));
  log('Retired requirements are left out of coverage', coverage(sm).requirements.length === 2);

  // ---------- the sample ----------
  const k = buildKestrel(createModel());
  const by = (/** @type {string} */ name) => /** @type {import('../../src/model/model.js').Element} */ (k.all().find((e) => e.name === name));
  const cov = coverage(k);
  log('Sample coverage: requirements, functions and blocks are counted', cov.requirements.length === 6 && cov.functions.total === 6 && cov.logical.total > 5 && cov.physical.total === 3, `${cov.requirements.length} ${cov.functions.total} ${cov.logical.total} ${cov.physical.total}`);
  log('Sample: every physical block traces to a logical one', cov.physical.done === 3);
  log('Sample: the cruise test failed', cov.passed.failed.some((x) => x.name === 'Cruise speed'));
  log('pct() rounds and handles zero', pct({ total: 3, done: 2 }) === 67 && pct({ total: 0, done: 0 }) === 0);
  log('Sample levels: needs, then system requirements', levelOf(k, by('Survey a large site per sortie').id) === 'Need' && levelOf(k, by('Endurance').id) === 'System' && levelOf(k, by('Usable energy').id) === 'Subsystem');
  const th = threadOf(k, by('Battery Pack').id);
  log('The thread through Battery Pack reaches its requirement, the need above it, its function and its physical part',
    ['Usable energy', 'Endurance', 'Survey a large site per sortie', 'Store energy', 'LiPo 12S 16 Ah pack'].every((n) => th.has(by(n).id)), [...th].map((id) => k.get(id)?.name).join(', '));
  log('…and not unrelated things', !th.has(by('Payload capacity').id) && !th.has(by('Survey Payload').id));
  log('step() goes down from a requirement to what satisfies it', step(k, by('Usable energy').id, 'down').includes(by('Battery Pack').id));
  log('step() goes up from a function to the requirement it refines', step(k, by('Generate thrust').id, 'up').includes(by('Cruise speed').id));

  // ---------- requirement diagrams ----------
  const rd = /** @type {any} */ (k.byKind('req')[0]);
  const endur = by('Endurance');
  const c = reqNodeContent(k, endur, rd, 'sysml');
  log('A requirement box shows «requirement», its id and its text', c.stereo === '«requirement»' && c.compartments[0].rows[0] === 'id = "REQ-PRF-001"' && c.compartments[1].wrap === true && c.compartments[1].rows[0].includes('3.0 h'));
  log('Guided notation says ID and Level in words', reqNodeContent(k, endur, rd, 'guided').compartments[0].rows.join('|') === 'ID: REQ-PRF-001|Level: System');
  log('View options hide id and text', reqNodeContent(k, endur, { ...rd, props: { ...rd.props, showId: false, showText: false } }, 'sysml').compartments.length === 0);
  log('Wrapped text makes a narrow box taller', heightAt(c, 160) > heightAt(c, 400) && naturalSize(c).w <= 240 + 24 + 1, `${heightAt(c, 160)} ${heightAt(c, 400)} ${naturalSize(c).w}`);
  const lines = wrapLines('The air vehicle shall fly for at least 3.0 h at survey speed with a supercalifragilisticexpialidociously long word', 120, FONTS.row);
  log('Wrapped lines never exceed the width', lines.length > 3 && lines.every((l) => textWidth(l, FONTS.row) <= 120), lines.join(' | '));
  const cut = wrapLines('one two three four five six seven eight nine ten eleven twelve', 60, FONTS.row, 2);
  log('A line limit ends the last line in an ellipsis', cut.length === 2 && cut[1].endsWith('…') && textWidth(cut[1], FONTS.row) <= 60, cut.join(' | '));
  const shown = new Set(Object.keys(rd.layout.nodes));
  const edges = reqEdgesFor(k, shown);
  log('Requirement diagrams draw derive, satisfy and verify as «stereotyped» dependencies', ['«deriveReqt»', '«satisfy»', '«verify»'].every((l) => edges.some((e) => e.kind === 'dependency' && e.label === l)), edges.map((e) => e.label).join());
  log('Blocks, test cases and requirements can be shown; packages cannot', canShowReq(endur) && canShowReq(by('Battery Pack')) && canShowReq(by('Endurance analysis')) && !canShowReq(by('System requirements')));
  log('Dragging a block onto a requirement offers satisfy; a test case offers verify', reqLinkKinds(k, by('Avionics Suite').id, endur.id).includes('satisfy') && reqLinkKinds(k, by('Payload fit check').id, endur.id)[0] === 'verify');
  const rects = rd.layout.nodes;
  log('The sample requirement diagram puts requirements above what satisfies them', rects[by('Usable energy').id].y < rects[by('Battery Pack').id].y && rects[by('Endurance').id].y < rects[by('Usable energy').id].y);
  const nest = createModel();
  const nr = nest.transact('Nest', (tx) => { const p = tx.create('requirement', { owner: nest.layers()[0].id, name: 'P' }); const q = tx.create('requirement', { owner: p, name: 'Q' }); return { p, q }; });
  log('A requirement inside a requirement is drawn as containment', reqEdgesFor(nest, new Set([nr.p, nr.q])).some((e) => e.kind === 'containment' && e.from === nr.p && e.to === nr.q));

  // ---------- requirements table ----------
  log('Columns parse, skipping unknown and repeated ones and clamping widths', formatColumns(parseColumns('id:100,bogus:50,id:200,name:5,text:9999')) === 'id:100,name:200,text:380');
  log('An empty column setting gives the defaults', formatColumns(parseColumns('')) === DEFAULT_COLUMNS);
  const tbl = /** @type {any} */ (k.byKind('table')[0]);
  const rows = tableRows(k, tbl);
  log('The table lists every requirement in its package, in browser order', rows.length === 6 && rows[0].el.name === 'Survey a large site per sortie', rows.map((x) => x.el.name).join());
  log('Filtering matches IDs, names and text', tableRows(k, tbl, { filter: '650 wh' }).map((x) => x.el.name).join() === 'Usable energy');
  log('Gaps only leaves out requirements that are satisfied, verified and not failed', !tableRows(k, tbl, { gapsOnly: true }).some((x) => x.el.name === 'Usable energy') && tableRows(k, tbl, { gapsOnly: true }).some((x) => x.el.name === 'Cruise speed'));
  const sorted = tableRows(k, tbl, { sort: 'id' }).map((x) => x.el.props.reqId);
  log('Sorting by ID is natural (2 before 10) and reversible', sorted[0] === 'REQ-PLD-002' && tableRows(k, tbl, { sort: '-id' })[0].el.props.reqId === 'SN-02', sorted.join());
  const status = requirementStatus(k);
  log('Relationship cells list related elements by name or requirement ID', cellText(k, by('Usable energy'), 'satisfiedBy', status) === 'Battery Pack' && cellText(k, by('Endurance'), 'derivedFrom', status) === 'SN-01');
  log('The verification column summarizes results', cellText(k, by('Usable energy'), 'verification', status) === 'Passed' && cellText(k, by('Cruise speed'), 'verification', status) === 'Failed' && cellText(k, by('Payload capacity'), 'verification', status) === 'Planned');
  const csv = toCsv(k, rows.slice(0, 2), parseColumns('id,name,text'), status);
  log('CSV has a header and quotes cells with commas or quotes', csv.split('\r\n')[0] === 'ID,Name,Text' && csv.includes('"The operator shall be able to survey 40 km² in one sortie."') === false && csv.split('\r\n').length === 4, csv);
  log('CSV escapes quotes by doubling them', toCsv(nest, [{ el: { ...nest.get(nr.p), name: 'Say "hi", ok' }, depth: 0 }], parseColumns('name'), new Map()).includes('"Say ""hi"", ok"'));

  // ---------- dependency matrix ----------
  const sat = matrixData(k, { rel: 'satisfy', rows: 'partDef', cols: 'requirement' });
  log('The satisfy matrix finds every satisfy relationship', sat.links.size === k.byKind('satisfy').length && sat.cols.length === 6);
  log('Rows and columns count their marks', sat.rowN.get(by('Battery Pack').id) === 1 && !sat.colN.has(by('Endurance').id));
  const hid = matrixData(k, { rel: 'satisfy', rows: 'partDef', cols: 'requirement', hideEmpty: true });
  log('Hide empty keeps only rows and columns with marks', hid.rows.length === 3 && hid.cols.length === 3);
  log('Sets can be limited to an RFLP layer', setMembers(k, 'partDef@p').length === 3 && setMembers(k, 'partDef@l').every((e) => k.layerOf(e.id) === 'l'));
  const alloc = matrixData(k, { rel: 'allocate', rows: 'action', cols: 'partDef@l' });
  log('The allocation matrix shows functions allocated to logical blocks', alloc.links.size === 3);
  log('Matrix CSV marks related cells with x', matrixCsv(hid).split('\r\n')[1].includes('x'));

  // ---------- RFLP trace ----------
  const lanes = laneCards(k);
  log('Lanes hold requirements, functions, logical and physical blocks', lanes.r.length === 6 && lanes.f.length === 6 && lanes.p.length === 3 && lanes.l.every((x) => x.el.kind === 'partDef'));
  log('Sub-functions are nested one level in', lanes.f.find((x) => x.el.name === 'Generate thrust')?.depth === 1);
  const ids = new Set(Object.values(lanes).flat().map((x) => x.el.id));
  const ll = laneLinks(k, ids);
  log('Lane lines join different lanes only, earlier lane first', ll.length > 5 && ll.every((l) => k.layerOf(l.a) !== k.layerOf(l.b)) && ll.some((l) => l.a === by('Usable energy').id && l.b === by('Battery Pack').id));
  log('Gaps: an unallocated function and an unsatisfied requirement', isGap(cov, by('Generate lift')) && isGap(cov, by('Endurance'), 'satisfied') === false && isGap(cov, by('Payload capacity'), 'passed'));

  // ---------- Systems V ----------
  const stages = vStages(k, cov);
  log('The V has nine stages, four paired across', stages.length === 9 && stages.filter((x) => x.pair).every((x) => stages.find((y) => y.id === x.pair)?.pair === x.id));
  const sysver = /** @type {any} */ (stages.find((x) => x.id === 'sysver'));
  log('System verification counts verified, passed and failed system requirements', sysver.total === 3 && sysver.done === 3 && sysver.failed === 1 && sysver.passed === 1, `${sysver.done}/${sysver.total} passed ${sysver.passed} failed ${sysver.failed}`);
  log('Every stage item names a model element', stages.every((x) => x.items.every((i) => !!k.get(i.el.id))));
  log('An empty project gives empty stages, not errors', vStages(createModel()).every((x) => x.total === 0));

  // ---------- files ----------
  const back = restore(JSON.parse(JSON.stringify(snapshot(k))));
  log('Levels, results, prefixes, matrices and tables survive saving', back.byKind('matrix').length === 2 && back.byKind('table').length === 1 && back.get(by('Cruise flight test').id)?.props.result === 'Fail' && back.get(by('Stakeholder needs').id)?.props.idPrefix === 'SN-');
  const old = JSON.parse(JSON.stringify(snapshot(k)));
  for (const e of old.elements) if (e.kind === 'requirement') { delete e.props.level; delete e.props.status; }
  const oldBack = restore(old);
  log('Files from before M4 load with default levels and statuses', oldBack.byKind('requirement').every((x) => x.props.level === 'Auto' && x.props.status === 'Draft'));
}
