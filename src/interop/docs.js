// Document generation: the model as a readable report (a system specification), one HTML file
// with everything inside it (styles, fonts, diagrams as SVG), ready to send, archive or print
// to PDF. Sections can be chosen: requirements, verification, functions, architecture,
// interfaces, behavior, analysis, diagrams and validation. Word (.docx) comes later.
import { kindName, ELEMENTS, LAYERS, DIAGRAM_KINDS, isRel } from '../model/metamodel.js';
import { requirementStatus, coverage, pct, levelsOf, targetsOf, sourcesOf } from '../model/trace.js';
import { verificationText } from '../views/table.js';
import { analysisOf, hasEquations, showVar } from '../analysis/solver.js';
import { appliedOf } from '../custom/stereo.js';
import { validate } from '../validate/engine.js';
import { transitionLabel } from '../canvas/stm.js';
import { VERSION } from '../version.js';
import { esc } from './xml.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/metamodel.js').Notation} Notation */

/** Sections a document can have, in order. */
export const SECTIONS = /** @type {const} */ ([
  ['summary', 'Summary and coverage'],
  ['requirements', 'Requirements'],
  ['verification', 'Verification'],
  ['functions', 'Functions'],
  ['architecture', 'Architecture (blocks)'],
  ['interfaces', 'Interfaces'],
  ['behavior', 'Behavior (states, scenarios, use cases)'],
  ['analysis', 'Analysis (equations and checks)'],
  ['diagrams', 'Diagrams'],
  ['validation', 'Validation problems'],
]);

/**
 * @typedef {{
 *   title?: string, subtitle?: string, author?: string,
 *   sections?: string[], notation?: Notation, date?: string,
 *   diagrams?: Map<string, { svg: string, w: number, h: number }>,  // pictures, by diagram id (see snapshot.js)
 *   fonts?: { sans?: string, mono?: string },                        // font files as base64 (woff2), embedded
 * }} DocOptions
 */

/**
 * The document as one HTML file.
 * @param {Model} m @param {DocOptions} [o]
 */
export function buildDocument(m, o = {}) {
  const n = o.notation || 'sysml';
  const want = new Set(o.sections || SECTIONS.map((s) => s[0]));
  const status = requirementStatus(m);
  const K = (/** @type {string} */ k) => kindName(k, n);
  const title = o.title || m.root().name;
  const date = o.date || new Date().toISOString().slice(0, 10);
  /** @type {{ id: string, title: string, level: number }[]} */
  const toc = [];
  let figNo = 0, tabNo = 0;
  const anchor = (/** @type {string} */ id) => `e-${id}`;
  /** A link to an element that has its own place in the document, else its name. */
  const shown = new Set();
  const ref = (/** @type {Element | undefined} */ e) => (!e ? '' : shown.has(e.id) ? `<a href="#${anchor(e.id)}">${esc(label(e))}</a>` : esc(label(e)));
  const label = (/** @type {Element} */ e) => (e.kind === 'requirement' && e.props.reqId ? `${e.props.reqId} ${e.name}` : e.name);
  const refs = (/** @type {Element[]} */ list) => list.map(ref).join(', ') || '<span class="none">—</span>';
  const h = (/** @type {number} */ level, /** @type {string} */ text, /** @type {string} */ id = `s${toc.length + 1}`) => { toc.push({ id, title: text, level }); return `<h${level} id="${id}">${esc(text)}</h${level}>`; };
  const para = (/** @type {string} */ t) => (t ? t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '');
  const stereo = (/** @type {Element} */ e) => {
    const info = appliedOf(m, e.id);
    if (!info.length) return '';
    return `<p class="stereo">${info.map((x) => `«${esc(x.st.name)}»${x.tags.filter((t) => t.value).length ? ` <span class="tags">${x.tags.filter((t) => t.value).map((t) => `${esc(t.tag.name)} = ${esc(t.value)}`).join(', ')}</span>` : ''}`).join(' ')}</p>`;
  };
  const table = (/** @type {string} */ caption, /** @type {string[]} */ head, /** @type {string[][]} */ rows, /** @type {string} */ cls = '') => rows.length
    ? `<table class="${cls}"><caption>Table ${++tabNo}. ${esc(caption)}</caption><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
  // what gets its own entry (so references can link to it)
  for (const e of m.all()) if (['requirement', 'testCase', 'partDef', 'interfaceDef', 'action', 'constraintDef'].includes(e.kind)) shown.add(e.id);
  const layer = (/** @type {string} */ l) => m.layers().find((x) => x.layer === l);
  /** Elements of kinds in a layer, by package path. @param {string} l @param {string[]} kinds */
  const inLayerByPkg = (l, kinds) => {
    const lp = layer(l);
    /** @type {{ path: string, els: Element[] }[]} */
    const groups = [];
    const walk = (/** @type {string} */ id, /** @type {string} */ path) => {
      const kids = m.children(id);
      const els = kids.filter((c) => kinds.includes(c.kind));
      if (els.length) groups.push({ path, els });
      for (const c of kids) if (c.kind === 'package') walk(c.id, path ? `${path} / ${c.name}` : c.name);
    };
    if (lp) walk(lp.id, '');
    return groups;
  };

  const body = [];
  // ---------- summary ----------
  if (want.has('summary')) {
    const cov = coverage(m);
    const tiles = /** @type {[string, { total: number, done: number }][]} */ ([['Requirements satisfied', cov.satisfied], ['Requirements verified', cov.verified], ['Verification passed', cov.passed], ['Functions allocated', cov.functions], ['Logical blocks realized', cov.logical], ['Physical blocks traced', cov.physical]]);
    // every set at the top, by its name in this project (the core sets and your own)
    const counts = m.sets().map((lp) => { let k = 0; const w = (/** @type {string} */ x) => { for (const c of m.children(x)) { k++; w(c.id); } }; w(lp.id); return `<li><b>${k}</b> in ${esc(lp.name)}</li>`; }).join('');
    body.push(h(2, 'Summary'),
      para(m.root().props.doc || ''),
      `<ul class="counts">${counts}<li><b>${m.count() - m.elementCount()}</b> relationships</li></ul>`,
      `<div class="tiles">${tiles.map(([t, x]) => `<div class="tile"><b>${pct(x)}%</b><span>${esc(t)}</span><small>${x.done} of ${x.total}</small></div>`).join('')}</div>`,
      cov.passed.failed.length ? `<p class="bad">Failed verification: ${refs(cov.passed.failed)}.</p>` : '');
  }
  // ---------- requirements ----------
  if (want.has('requirements')) {
    const levels = levelsOf(m);
    const groups = inLayerByPkg('r', ['requirement']);
    body.push(h(2, 'Requirements'));
    if (!groups.length) body.push('<p class="none">The model has no requirements yet.</p>');
    for (const g of groups) {
      if (g.path) body.push(h(3, g.path));
      /** @type {string[][]} */
      const rows = [];
      const add = (/** @type {Element} */ r, /** @type {number} */ depth) => {
        const st = status.get(r.id);
        const result = verificationText(st);
        rows.push([
          `<span id="${anchor(r.id)}" class="mono">${esc(r.props.reqId || '')}</span>`,
          `<div style="padding-left:${depth * 14}px"><b>${esc(r.name)}</b>${stereo(r)}${para(r.props.text || '')}${r.props.doc ? `<p class="rationale"><i>Rationale:</i> ${esc(r.props.doc)}</p>` : ''}${r.props.check ? `<p class="mono small">Check: ${esc(r.props.check)}${st?.check ? ` (${esc(st.check.verdict === 'pass' ? 'met' : st.check.verdict === 'fail' ? 'not met' : 'cannot run')})` : ''}</p>` : ''}</div>`,
          `${esc(r.props.level === 'Auto' ? levels.get(r.id) || '' : r.props.level)}<br><span class="small">${esc(r.props.priority === '—' ? '' : r.props.priority)} ${esc(r.props.status)}</span>`,
          refs(sourcesOf(m, r.id, 'satisfy')),
          refs(sourcesOf(m, r.id, 'verify')),
          `<span class="res ${result.toLowerCase().replace(/\s+/g, '-')}">${esc(result)}</span>`,
        ]);
        for (const c of m.children(r.id)) if (c.kind === 'requirement') add(c, depth + 1);
      };
      for (const r of g.els) add(r, 0);
      body.push(table(`Requirements${g.path ? ` in ${g.path}` : ''}`, ['ID', 'Requirement', 'Level', 'Satisfied by', 'Verified by', 'Result'], rows, 'reqs'));
    }
  }
  // ---------- verification ----------
  if (want.has('verification')) {
    const tests = m.byKind('testCase');
    body.push(h(2, 'Verification'));
    body.push(tests.length ? table('Test cases', ['Test case', 'Method', 'Result', 'Verifies'], tests.map((t) => [`<b id="${anchor(t.id)}">${esc(t.name)}</b>${stereo(t)}${para(t.props.doc || '')}`, esc(t.props.method), `<span class="res ${String(t.props.result).toLowerCase().replace(/\s+/g, '-')}">${esc(t.props.result)}</span>`, refs(targetsOf(m, t.id, 'verify'))])) : '<p class="none">No test cases yet.</p>');
  }
  // ---------- functions ----------
  if (want.has('functions')) {
    const lp = layer('f');
    body.push(h(2, 'Functions'));
    /** @type {string[][]} */
    const rows = [];
    const walk = (/** @type {string} */ id, /** @type {number} */ depth) => {
      for (const c of m.children(id)) {
        if (c.kind === 'action') {
          rows.push([`<div id="${anchor(c.id)}" style="padding-left:${depth * 14}px"><b>${esc(c.name)}</b>${stereo(c)}${para(c.props.doc || '')}</div>`, refs(targetsOf(m, c.id, 'allocate')), refs(targetsOf(m, c.id, 'refine'))]);
          walk(c.id, depth + 1);
        } else if (c.kind === 'package') walk(c.id, depth);
      }
    };
    if (lp) walk(lp.id, 0);
    body.push(rows.length ? table('Functions and what performs them', ['Function', 'Allocated to', 'Refines'], rows) : '<p class="none">No functions yet.</p>');
  }
  // ---------- architecture ----------
  const blockSection = (/** @type {Element} */ b) => {
    const kids = m.children(b.id);
    const typeName = (/** @type {Element} */ k) => (k.props.type ? m.get(k.props.type) : undefined);
    const parts = kids.filter((k) => k.kind === 'part'), ports = kids.filter((k) => k.kind === 'port'), vals = kids.filter((k) => k.kind === 'attribute');
    const an = hasEquations(m, b.id) ? analysisOf(m, b.id) : null;
    const gen = targetsOf(m, b.id, 'generalize');
    const out = [`<section class="el" id="${anchor(b.id)}"><h4>${esc(b.name)} <span class="kind">${esc(K(b.kind))}</span></h4>`, stereo(b), para(b.props.doc || '')];
    if (gen.length) out.push(`<p>Is a kind of ${refs(gen)}.</p>`);
    if (parts.length) out.push(table(`Parts of ${b.name}`, ['Part', 'Type', 'Multiplicity'], parts.map((p) => [`${esc(p.name)}${stereo(p)}`, ref(typeName(p)), esc(p.props.multiplicity)]), 'compact'));
    if (ports.length) out.push(table(`Ports of ${b.name}`, ['Port', 'Direction', 'Interface'], ports.map((p) => [esc(p.name), esc(p.props.direction), `${p.props.conjugated ? '~' : ''}${ref(typeName(p))}`]), 'compact'));
    if (vals.length) out.push(table(`Values of ${b.name}`, ['Value', 'Given', 'Computed'], vals.map((v) => { const cv = an?.vars.get(v.id); return [esc(v.name), v.props.value ? `<span class="mono">${esc(v.props.value)} ${esc(v.props.unit || '')}</span>` : '', cv?.source === 'computed' ? `<span class="mono">${esc(showVar(cv))}</span>` : '']; }), 'compact'));
    const sat = targetsOf(m, b.id, 'satisfy'), alloc = sourcesOf(m, b.id, 'allocate'), realizes = targetsOf(m, b.id, 'allocate');
    if (sat.length) out.push(`<p><b>Satisfies:</b> ${refs(sat)}</p>`);
    if (alloc.length) out.push(`<p><b>Performs (allocated):</b> ${refs(alloc)}</p>`);
    if (realizes.length) out.push(`<p><b>Allocated to:</b> ${refs(realizes)}</p>`);
    out.push('</section>');
    return out.join('');
  };
  if (want.has('architecture')) {
    body.push(h(2, 'Architecture'));
    for (const [l, name] of /** @type {const} */ ([['l', 'Logical architecture'], ['p', 'Physical architecture']])) {
      const groups = inLayerByPkg(l, ['partDef']);
      if (!groups.length) continue;
      body.push(h(3, name));
      for (const g of groups) { if (g.path) body.push(`<h4 class="pkg">${esc(g.path)}</h4>`); for (const b of g.els) body.push(blockSection(b)); }
    }
  }
  if (want.has('interfaces')) {
    const ifs = m.byKind('interfaceDef');
    body.push(h(2, 'Interfaces'));
    if (!ifs.length) body.push('<p class="none">No interface blocks yet.</p>');
    for (const b of ifs) {
      const users = m.byKind('port').filter((p) => p.props.type === b.id).map((p) => /** @type {Element} */ (m.get(/** @type {string} */ (p.owner))));
      body.push(blockSection(b).replace('</section>', `${users.length ? `<p><b>Used by ports of:</b> ${refs([...new Set(users)])}</p>` : ''}</section>`));
    }
    const conns = m.byKind('connector');
    const endText = (/** @type {any} */ e) => [...e.path, ...(e.port ? [e.port] : [])].map((x) => m.get(x)?.name).join('.');
    if (conns.length) body.push(h(3, 'Connections'), table('Connectors and what flows along them', ['In', 'From', 'To', 'Item flow'], conns.map((c) => [ref(m.get(/** @type {string} */ (c.owner))), esc(endText(c.props.end1)), esc(endText(c.props.end2)), esc(c.props.flow !== 'None' ? `${c.props.item} (${c.props.flow})` : c.props.item)])));
  }
  // ---------- behavior ----------
  if (want.has('behavior')) {
    body.push(h(2, 'Behavior'));
    const machines = m.byKind('partDef').filter((b) => m.children(b.id).some((c) => c.kind === 'state'));
    for (const b of machines) {
      const states = /** @type {Element[]} */ ([]);
      const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) if (c.kind === 'state' || c.kind === 'region') { if (c.kind === 'state') states.push(c); walk(c.id); } };
      walk(b.id);
      const trs = m.all().filter((t) => t.kind === 'transition' && m.isWithin(t.id, b.id));
      body.push(h(3, `States of ${b.name}`),
        table(`States of ${b.name}`, ['State', 'Kind', 'Entry / do / exit'], states.map((s) => [esc(s.name), esc(s.props.stateKind), esc([s.props.entry && `entry / ${s.props.entry}`, s.props.do && `do / ${s.props.do}`, s.props.exit && `exit / ${s.props.exit}`].filter(Boolean).join('; '))]), 'compact'),
        table(`Transitions of ${b.name}`, ['From', 'To', 'Trigger [guard] / effect'], trs.map((t) => [esc(m.get(t.props.from)?.name || ''), esc(m.get(t.props.to)?.name || ''), `<span class="mono">${esc(transitionLabel(t))}</span>`]), 'compact'));
    }
    for (const it of m.byKind('interaction')) {
      const msgs = /** @type {Element[]} */ ([]);
      const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (c.kind === 'message') msgs.push(c); if (c.kind === 'fragment' || c.kind === 'operand') walk(c.id); } };
      walk(it.id);
      if (!msgs.length) continue;
      body.push(h(3, `Scenario: ${it.name}`), para(it.props.doc || ''), `<ol class="msgs">${msgs.map((x) => `<li><b>${esc(m.get(x.props.from)?.name || '')}</b> → <b>${esc(m.get(x.props.to)?.name || '')}</b>: <span class="mono">${esc(x.name)}</span> <span class="small">(${esc(x.props.msgKind)})</span></li>`).join('')}</ol>`);
    }
    const ucs = m.byKind('useCase');
    if (ucs.length) body.push(h(3, 'Use cases'), table('Use cases and who takes part', ['Use case', 'Actors', 'Includes', 'Subject'], ucs.map((u) => [`<b>${esc(u.name)}</b>${para(u.props.doc || '')}`, refs(sourcesOf(m, u.id, 'participate')), refs(targetsOf(m, u.id, 'include')), m.get(/** @type {string} */ (u.owner))?.kind === 'partDef' ? ref(m.get(/** @type {string} */ (u.owner))) : '']), 'compact'));
    if (!machines.length && !m.byKind('interaction').length && !ucs.length) body.push('<p class="none">No state machines, scenarios or use cases yet.</p>');
  }
  // ---------- analysis ----------
  if (want.has('analysis')) {
    body.push(h(2, 'Analysis'));
    const defs = m.byKind('constraintDef');
    if (defs.length) body.push(table('Equations (constraint blocks)', ['Constraint block', 'Equation', 'Parameters'], defs.map((d) => [`<b id="${anchor(d.id)}">${esc(d.name)}</b>`, `<span class="mono">${esc(d.props.expr || '')}</span>`, esc(m.children(d.id).filter((c) => c.kind === 'attribute').map((p) => `${p.name}${p.props.unit ? ` [${p.props.unit}]` : ''}`).join(', '))])));
    const checks = m.byKind('requirement').filter((r) => r.props.check);
    if (checks.length) body.push(table('Live requirement checks', ['Requirement', 'Check', 'Verdict'], checks.map((r) => { const c = status.get(r.id)?.check; return [ref(r), `<span class="mono">${esc(r.props.check)}</span>`, c ? `<span class="res ${c.verdict === 'pass' ? 'passed' : c.verdict === 'fail' ? 'failed' : 'planned'}">${esc(c.verdict === 'pass' ? 'Met' : c.verdict === 'fail' ? 'Not met' : 'Cannot run')}</span> <span class="small">${esc(c.message)}</span>` : '']; })));
    if (!defs.length && !checks.length) body.push('<p class="none">No equations or checks yet.</p>');
  }
  // ---------- diagrams ----------
  if (want.has('diagrams')) {
    const ds = DIAGRAM_KINDS.filter((k) => k !== 'table' && k !== 'matrix' && k !== 'gtable').flatMap((k) => m.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
    body.push(h(2, 'Diagrams'));
    if (!ds.length) body.push('<p class="none">No diagrams yet.</p>');
    for (const d of ds) {
      const pic = o.diagrams?.get(d.id);
      if (!pic && o.diagrams) continue;
      body.push(`<figure id="${anchor(d.id)}">${pic ? pic.svg : `<div class="nopic">${esc(K(d.kind))}</div>`}<figcaption>Figure ${++figNo}. ${esc(d.name)} <span class="kind">(${esc(K(d.kind))})</span></figcaption></figure>`);
    }
  }
  // ---------- validation ----------
  if (want.has('validation')) {
    const rep = validate(m);
    body.push(h(2, 'Validation'));
    body.push(rep.problems.length
      ? `<p>${rep.counts.error} errors, ${rep.counts.warning} warnings and ${rep.counts.info} notes, from the project's validation rules.</p>${table('Problems', ['Severity', 'Problem'], rep.problems.slice(0, 1000).map((p) => [`<span class="sev ${p.severity}">${esc(p.severity === 'info' ? 'note' : p.severity)}</span>`, esc(p.message)]), 'compact')}`
      : '<p>No problems: every rule that is on passes.</p>');
  }

  const fontFace = (/** @type {string} */ fam, /** @type {string | undefined} */ b64) => (b64 ? `@font-face{font-family:"${fam}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:100 800;font-display:swap}` : '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="generator" content="Pteronautics Loom ${VERSION}">
<style>
${fontFace('Space Grotesk', o.fonts?.sans)}${fontFace('JetBrains Mono', o.fonts?.mono)}
:root{--text:#141820;--text-2:#4a5261;--text-3:#5f6878;--border:#d9dee6;--accent:#1677b3;--good:#1a7f37;--warn:#9a5b00;--bad:#cf222e}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--text);font:14px/1.55 "Space Grotesk",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 40px 80px}
.cover{border-bottom:3px solid var(--accent);padding-bottom:28px;margin-bottom:28px}
.cover .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3)}
.cover h1{font-size:34px;letter-spacing:-.02em;margin:8px 0 6px;line-height:1.15;overflow-wrap:anywhere}
.cover p{margin:2px 0;color:var(--text-2)}
h2{font-size:22px;margin:40px 0 12px;padding-top:8px;border-top:1px solid var(--border);letter-spacing:-.01em}
h3{font-size:17px;margin:26px 0 8px}
h4{font-size:15px;margin:18px 0 6px}
h4.pkg{color:var(--text-3);font-weight:500;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
nav.toc ol{columns:2;column-gap:32px;padding-left:20px;margin:8px 0}
nav.toc li{margin:2px 0;break-inside:avoid}
nav.toc ul{margin:2px 0 4px;padding-left:18px;list-style:circle;font-size:13px}
a{color:var(--accent);text-decoration:none}
.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
.small{font-size:12px;color:var(--text-3)}
.none{color:var(--text-3);font-style:italic}
.kind{color:var(--text-3);font-weight:400;font-size:12px}
.stereo{margin:2px 0;color:#7c5cf0;font-size:12.5px}.stereo .tags{color:var(--text-2)}
.rationale{color:var(--text-2);font-size:12.5px}
table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:13px;table-layout:auto}
caption{text-align:left;font-size:12px;color:var(--text-3);padding:0 0 6px;caption-side:top}
th{text-align:left;font-weight:600;border-bottom:2px solid var(--border);padding:6px 8px;background:#f6f7f9;font-size:12px}
td{border-bottom:1px solid var(--border);padding:6px 8px;vertical-align:top;overflow-wrap:anywhere}
td p{margin:2px 0}
table.reqs td:first-child{white-space:nowrap}
table.compact{width:auto;min-width:50%}
.res{font-weight:600;font-size:12px;white-space:nowrap}.res.passed{color:var(--good)}.res.failed,.res.fail{color:var(--bad)}.res.planned,.res.not-run{color:var(--warn)}.res.not-verified{color:var(--text-3)}.res.pass{color:var(--good)}
.sev{font-weight:600;font-size:12px;text-transform:capitalize}.sev.error{color:var(--bad)}.sev.warning{color:var(--warn)}.sev.info{color:var(--accent)}
.bad{color:var(--bad)}
ul.counts{display:flex;flex-wrap:wrap;gap:6px 22px;list-style:none;padding:0;margin:12px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:14px 0}
.tile{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;min-width:0}
.tile b{font-size:22px}.tile span{font-size:12.5px;color:var(--text-2)}.tile small{color:var(--text-3)}
section.el{border-left:3px solid #8b5cf6;padding:2px 0 2px 14px;margin:14px 0 22px}
figure{margin:18px 0 28px;break-inside:avoid}
figure svg{max-width:100%;height:auto;display:block;border:1px solid var(--border);border-radius:10px}
figcaption{font-size:12.5px;color:var(--text-2);margin-top:6px}
.nopic{border:1px dashed var(--border);border-radius:10px;padding:40px;text-align:center;color:var(--text-3)}
ol.msgs li{margin:3px 0}
footer{margin-top:60px;color:var(--text-3);font-size:12px;border-top:1px solid var(--border);padding-top:12px}
@media print{main{max-width:none;padding:0}h2{break-before:page;border-top:0}.cover{break-after:page;border:0;padding-top:30vh}nav.toc{break-after:page}tr,figure,section.el{break-inside:avoid}a{color:inherit}}
@page{margin:18mm 16mm}
</style></head>
<body><main>
<header class="cover"><div class="eyebrow">${esc(o.subtitle || 'System model report')}</div><h1>${esc(title)}</h1>${o.author ? `<p>${esc(o.author)}</p>` : ''}<p>${esc(date)} · Generated by Pteronautics Loom ${VERSION} · ${esc(n === 'guided' ? 'Guided' : n === 'v2' ? 'SysML v2' : 'SysML')} notation</p></header>
<nav class="toc"><h2 style="border:0;margin-top:0">Contents</h2><ol>${tocHtml(toc)}</ol></nav>
${body.join('\n')}
<footer>${esc(m.root().name)} · ${esc(date)} · Pteronautics Loom ${VERSION}</footer>
</main></body></html>
`;
}

/** Contents: sections, with their sub-sections nested (so numbering counts sections only). @param {{ id: string, title: string, level: number }[]} toc */
function tocHtml(toc) {
  const out = [];
  for (let i = 0; i < toc.length; i++) {
    const t = toc[i];
    if (t.level !== 2) continue;
    const subs = [];
    for (let j = i + 1; j < toc.length && toc[j].level > 2; j++) if (toc[j].level === 3) subs.push(toc[j]);
    out.push(`<li><a href="#${t.id}">${esc(t.title)}</a>${subs.length ? `<ul>${subs.map((x) => `<li><a href="#${x.id}">${esc(x.title)}</a></li>`).join('')}</ul>` : ''}</li>`);
  }
  return out.join('');
}

/** Diagrams the document will picture, in order. @param {Model} m */
export const documentDiagrams = (m) => DIAGRAM_KINDS.filter((k) => k !== 'table' && k !== 'matrix' && k !== 'gtable').flatMap((k) => m.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));

/** A file's bytes as base64. @param {ArrayBuffer} buf */
export function toBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Loom's fonts, to embed (they are small and SIL OFL). */
export async function loadFonts() {
  const get = async (/** @type {string} */ f) => { try { const r = await fetch(new URL(`../../assets/fonts/${f}`, import.meta.url)); return r.ok ? toBase64(await r.arrayBuffer()) : undefined; } catch { return undefined; } };
  return { sans: await get('SpaceGrotesk.woff2'), mono: await get('JetBrainsMono.woff2') };
}

/** Print an HTML document (the browser's dialog offers Save as PDF). @param {string} html */
export function printHtml(html) {
  const frame = document.createElement('iframe');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(frame);
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => frame.remove(), 60000); }, 300);
  };
  frame.srcdoc = html;
}

export { ELEMENTS, isRel };
