// Test runner for tests/index.html (same pattern as Pteronautics Works). ?only=<suite-id> runs one suite.
import { settingsTests } from './loom/settings.tests.js';
import { commandsTests } from './loom/commands.tests.js';
import { fuzzyTests } from './loom/fuzzy.tests.js';
import { modelTests } from './loom/model.tests.js';
import { filesTests } from './loom/files.tests.js';
import { diagramTests } from './loom/diagram.tests.js';
import { ibdTests } from './loom/ibd.tests.js';
import { traceTests } from './loom/trace.tests.js';
import { textTests } from './loom/text.tests.js';
import { behaviorTests } from './loom/behavior.tests.js';
import { analysisTests } from './loom/analysis.tests.js';
import { customTests } from './loom/custom.tests.js';
import { interopTests } from './loom/interop.tests.js';

/** @typedef {{ name: string, pass: boolean, detail: string, group?: string }} Result */
/** @typedef {(name: string, pass: unknown, detail?: unknown) => void} Log */

/** @type {Result[]} */
const results = [];
/** @type {Log} */
const log = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail ?? '') });

/** @type {[string, string, (log: Log) => void | Promise<void>][]} */
const SUITES = [
  ['loom', 'Settings', settingsTests],
  ['loom', 'Commands & shortcuts', commandsTests],
  ['loom', 'Fuzzy search', fuzzyTests],
  ['loom', 'Model core', modelTests],
  ['loom', 'Files, import, export & projects', filesTests],
  ['loom', 'Diagrams: placing, boxes, lines, layout', diagramTests],
  ['loom', 'Internal block diagrams: connectors, rules, layout', ibdTests],
  ['loom', 'Requirements & traceability: IDs, levels, coverage, views', traceTests],
  ['loom', 'SysML v2 text, folders and zip', textTests],
  ['loom', 'Behavior: activities, states, sequences, use cases, packages', behaviorTests],
  ['loom', 'Analysis and simulation: units, solver, live checks, running diagrams', analysisTests],
  ['loom', 'Validation and customization: rules, problems, stereotypes, presets, shortcuts', customTests],
  ['loom', 'Interop and documents: ReqIF, Excel, CSV, Cameo XMI, SysML v2 API, documents, library', interopTests],
];

/** @param {HTMLElement} out @param {HTMLElement} summary */
export async function runAll(out, summary) {
  const only = new URLSearchParams(location.search).get('only');
  const steps = SUITES.filter(([id]) => !only || id === only);
  for (const [, group, fn] of steps) {
    const before = results.length;
    try { await fn(log); } catch (e) { log(`${group} threw`, false, e instanceof Error ? e.stack : String(e)); }
    for (let i = before; i < results.length; i++) results[i].group = group;
    render(out, summary, false);
    await new Promise((r) => setTimeout(r, 0));
  }
  render(out, summary, true);
  /** @type {any} */ (window).__results = results;
  return results;
}

/** @param {HTMLElement} out @param {HTMLElement} summary @param {boolean} done */
function render(out, summary, done) {
  const fail = results.filter((r) => !r.pass).length;
  summary.textContent = `${done ? '' : 'Running… '}${results.length - fail} passed, ${fail} failed, ${results.length} checks`;
  summary.className = done ? (fail ? 'bad' : 'ok') : '';
  /** @param {string} t */
  const esc = (t) => t.replace(/[&<>]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const groups = [...new Set(results.map((r) => r.group))];
  out.innerHTML = groups.map((g) => {
    const rs = results.filter((r) => r.group === g), f = rs.filter((r) => !r.pass).length;
    return `<details${f ? ' open' : ''}><summary><b>${esc(g || '…')}</b> <span class="${f ? 'bad' : 'okc'}">${rs.length - f}/${rs.length}</span></summary>` +
      rs.map((r) => `<div class="r ${r.pass ? 'ok' : 'bad'}"><b>${r.pass ? 'PASS' : 'FAIL'}</b> ${esc(r.name)}<div class="d">${esc(r.detail)}</div></div>`).join('') + '</details>';
  }).join('');
}
