// The validation engine: which rules are on (a rule set plus the project's own changes),
// running them, custom rules written in the rules dialog, ignored problems, and a validator
// that re-runs after each edit without getting in the way of typing.
//
// A project's validation settings are kept on the model's root package (props.validation, as
// JSON), so changing them is an ordinary undoable edit and they travel with the project: in
// .loom.json, in project folders (.loom/project.json) and in zips.
import { ELEMENTS, kindName, isRel } from '../model/metamodel.js';
import { RULES, RULE_BY_ID, RULE_SETS, Context, inSet } from './rules.js';
import { stereoNames } from '../custom/stereo.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('./rules.js').Severity} Severity */
/** @typedef {import('./rules.js').Fix} Fix */
/**
 * @typedef {{
 *   id: string, name: string, kind: string,
 *   prop: string,              // 'name', a property of the kind, or 'stereotypes'
 *   test: 'set' | 'match' | 'noMatch' | 'is' | 'isNot' | 'has' | 'hasNot',
 *   value: string, severity: Severity, message?: string,
 * }} CustomRule  a rule a user writes: "every Requirement's Priority must be set"
 * @typedef {{
 *   set: string,
 *   rules: Record<string, Severity | 'off' | 'on'>,   // changes to the set, by rule id
 *   custom: CustomRule[],
 *   ignored: string[],                                 // "rule|elementId" problems hidden by hand
 * }} Config
 * @typedef {{
 *   key: string, rule: string, severity: Severity, id: string, message: string,
 *   fix?: Fix, ids?: string[], custom?: boolean,
 * }} Problem
 * @typedef {{ problems: Problem[], byId: Map<string, Problem[]>, counts: Record<Severity, number>, ignored: number, ms: number, version: number }} Report
 */

export const SEVERITIES = /** @type {Severity[]} */ (['error', 'warning', 'info']);
const RANK = { error: 0, warning: 1, info: 2 };
/** The tests a custom rule can make, with how they read. */
export const TESTS = /** @type {const} */ ([
  ['set', 'must be set'], ['match', 'must match'], ['noMatch', 'must not match'],
  ['is', 'must be'], ['isNot', 'must not be'], ['has', 'must contain'], ['hasNot', 'must not contain'],
]);
const TEST_IDS = TESTS.map((t) => t[0]);

/** @returns {Config} */
export const defaultConfig = () => ({ set: 'recommended', rules: {}, custom: [], ignored: [] });

/**
 * Read a project's validation settings, keeping only what is well formed.
 * @param {unknown} text the root package's props.validation (JSON), or an object
 * @returns {Config}
 */
export function parseConfig(text) {
  const c = defaultConfig();
  let raw = text;
  if (typeof text === 'string') { if (!text.trim()) return c; try { raw = JSON.parse(text); } catch { return c; } }
  if (!raw || typeof raw !== 'object') return c;
  const r = /** @type {Record<string, any>} */ (raw);
  if (RULE_SETS.some((s) => s.id === r.set)) c.set = r.set;
  if (r.rules && typeof r.rules === 'object') for (const [id, v] of Object.entries(r.rules)) if (RULE_BY_ID.has(id) && ['off', 'on', ...SEVERITIES].includes(/** @type {string} */ (v))) c.rules[id] = v;
  if (Array.isArray(r.custom)) for (const x of r.custom.slice(0, 200)) {
    if (!x || typeof x !== 'object' || !(x.kind in ELEMENTS) || !TEST_IDS.includes(x.test) || !SEVERITIES.includes(x.severity)) continue;
    const prop = String(x.prop || 'name');
    if (prop !== 'name' && prop !== 'stereotypes' && !(prop in ELEMENTS[x.kind].props)) continue;
    c.custom.push({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : `c${c.custom.length + 1}`,
      name: String(x.name || '').slice(0, 120), kind: x.kind, prop, test: x.test,
      value: String(x.value ?? '').slice(0, 500), severity: x.severity,
      ...(x.message ? { message: String(x.message).slice(0, 300) } : {}),
    });
  }
  if (Array.isArray(r.ignored)) c.ignored = r.ignored.filter((k) => typeof k === 'string' && k.length < 200).slice(0, 5000);
  return c;
}

/** Settings as stored: empty when they are the defaults, so files stay clean. @param {Config} c */
export function configText(c) {
  const d = defaultConfig();
  if (c.set === d.set && !Object.keys(c.rules).length && !c.custom.length && !c.ignored.length) return '';
  /** @type {Record<string, any>} */
  const out = { set: c.set };
  if (Object.keys(c.rules).length) out.rules = Object.fromEntries(Object.entries(c.rules).sort(([a], [b]) => a.localeCompare(b)));
  if (c.custom.length) out.custom = c.custom;
  if (c.ignored.length) out.ignored = [...c.ignored].sort();
  return JSON.stringify(out);
}

/** A model's validation settings. @param {Model} m */
export const configOf = (m) => parseConfig(m.root()?.props.validation || '');

/** Change a model's validation settings as one undoable edit. @param {Model} m @param {string} label @param {(c: Config) => void} fn */
export function updateConfig(m, label, fn) {
  const c = configOf(m);
  fn(c);
  const text = configText(parseConfig(c));
  m.transact(label, (tx) => tx.setProps(m.root().id, { validation: text }));
}

/**
 * How severe each rule is with these settings, or 'off'.
 * @param {Config} c @returns {Map<string, Severity | 'off'>}
 */
export function effective(c) {
  /** @type {Map<string, Severity | 'off'>} */
  const out = new Map();
  for (const r of RULES) {
    const o = c.rules[r.id];
    out.set(r.id, o === 'off' ? 'off' : o === 'on' ? r.severity : o ? o : inSet(r, c.set) ? r.severity : 'off');
  }
  return out;
}

/** Is this rule changed from what its set says? @param {Config} c @param {string} id */
export const isChanged = (c, id) => id in c.rules;

/** The value a custom rule tests, as text. @param {Model} m @param {import('../model/model.js').Element} e @param {string} prop */
function valueFor(m, e, prop) {
  if (prop === 'name') return e.name;
  if (prop === 'stereotypes') return stereoNames(m, e.id).join(', ');
  const spec = ELEMENTS[e.kind].props[prop];
  const v = e.props[prop];
  if (!spec) return '';
  if (spec.type === 'ref') return v ? m.get(v)?.name || '' : '';
  if (spec.type === 'bool') return v ? 'true' : 'false';
  if (spec.type === 'enum') return v === '—' || v === 'none' ? '' : String(v ?? '');
  return String(v ?? '');
}

/** What a custom rule says, as a sentence. @param {CustomRule} r */
export function customText(r) {
  const label = r.prop === 'name' ? 'Name' : r.prop === 'stereotypes' ? 'Stereotypes' : ELEMENTS[r.kind]?.props[r.prop]?.label || r.prop;
  const test = TESTS.find((t) => t[0] === r.test)?.[1] || r.test;
  return `Every ${kindName(r.kind, 'sysml')}'s ${label.toLowerCase()} ${test}${r.test === 'set' ? '' : ` ${r.test === 'match' || r.test === 'noMatch' ? `/${r.value}/` : `"${r.value}"`}`}`;
}

/** Is a custom rule's pattern usable? Returns what is wrong, or null. @param {CustomRule} r */
export function customError(r) {
  if (r.test !== 'match' && r.test !== 'noMatch') return null;
  try { new RegExp(r.value, 'u'); return null; } catch (e) { return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Not a pattern'; }
}

/**
 * Run every rule that is on.
 * @param {Model} m @param {Config} [c] @returns {Report}
 */
export function validate(m, c = configOf(m)) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const eff = effective(c);
  const cx = new Context(m);
  const ignored = new Set(c.ignored);
  /** @type {Problem[]} */
  const problems = [];
  let nIgnored = 0;
  /** A severity set in the settings wins; otherwise the finding's own, else the rule's. @param {import('./rules.js').Rule} r @param {any} o @returns {Severity} */
  const sevFor = (r, o) => { const set = c.rules[r.id]; return set && set !== 'on' && set !== 'off' ? set : (typeof o === 'object' && o.severity) || r.severity; };
  /** @param {string} rule @param {Severity} sev @param {string} id @param {any} o */
  const push = (rule, sev, id, o) => {
    const key = `${rule}|${id}`;
    if (ignored.has(key)) { nIgnored++; return; }
    const msg = typeof o === 'string' ? o : o.message;
    problems.push({ key, rule, severity: sev, id, message: msg, ...(o.fix ? { fix: o.fix } : {}), ...(o.ids ? { ids: o.ids } : {}) });
  };
  // element rules, grouped by kind so each element only meets the rules for its kind
  /** @type {Map<string, import('./rules.js').Rule[]>} */
  const byKind = new Map();
  for (const r of RULES) if (r.check && r.kinds && eff.get(r.id) !== 'off') for (const k of r.kinds) (byKind.get(k) || byKind.set(k, []).get(k))?.push(r);
  for (const [kind, rules] of byKind) for (const e of m.byKind(kind)) {
    if (!e.owner) continue;
    for (const r of rules) {
      const res = /** @type {any} */ (r.check)(m, e, cx);
      if (!res) continue;
      for (const o of Array.isArray(res) ? res : [res]) if (o) push(r.id, sevFor(r, o), e.id, o);
    }
  }
  for (const r of RULES) {
    if (!r.all || eff.get(r.id) === 'off') continue;
    for (const f of r.all(m, cx)) push(r.id, sevFor(r, f), f.id, f);
  }
  // custom rules
  for (const r of c.custom) {
    if (customError(r)) continue;
    const re = r.test === 'match' || r.test === 'noMatch' ? new RegExp(r.value, 'u') : null;
    const want = r.value.toLowerCase();
    for (const e of m.byKind(r.kind)) {
      if (!e.owner || e.layer) continue;
      const v = valueFor(m, e, r.prop), lv = v.toLowerCase();
      const ok = r.test === 'set' ? v.trim() !== ''
        : r.test === 'match' ? /** @type {RegExp} */ (re).test(v) : r.test === 'noMatch' ? !(/** @type {RegExp} */ (re).test(v))
          : r.test === 'is' ? lv === want : r.test === 'isNot' ? lv !== want
            : r.test === 'has' ? lv.includes(want) : !lv.includes(want);
      if (!ok) push(`custom:${r.id}`, r.severity, e.id, { message: `${e.name}: ${r.message || customText(r).replace(/^Every [^']+'s /, '')}` });
    }
  }
  problems.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : COLLATE(a.message, b.message)));
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return reportOf(m, problems, nIgnored, ms, m.version());
}

const COLLATE = new Intl.Collator('en', { numeric: true }).compare;

/**
 * A report from a sorted list of problems: indexed by element, and counted.
 * @param {Model} m @param {Problem[]} problems @param {number} ignored @param {number} ms @param {number} version @returns {Report}
 */
function reportOf(m, problems, ignored, ms, version) {
  /** @type {Map<string, Problem[]>} */
  const byId = new Map();
  for (const p of problems) {
    for (const id of p.ids ? new Set([p.id, ...p.ids]) : [p.id]) {
      const e = m.get(id);
      if (e && !isRel(e.kind)) { const list = byId.get(id); if (list) list.push(p); else byId.set(id, [p]); }
    }
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity]++;
  return { problems, byId, counts, ignored, ms, version };
}

/**
 * Problems as they cross to or from a worker: a fix keeps its label and what the app does,
 * and loses the edit itself (a function), which `fixRun` finds again when the fix is used.
 * @param {Problem[]} problems
 */
export const portable = (problems) => problems.map((p) => (p.fix?.run ? { ...p, fix: { label: p.fix.label, ...(p.fix.ui ? { ui: p.fix.ui } : {}) } } : p));

/**
 * The edit a problem's fix makes, worked out again on this model (problems from the worker
 * carry only the fix's label).
 * @param {Model} m @param {Problem} p @returns {Fix['run'] | undefined}
 */
export function fixRun(m, p) {
  if (p.fix?.run) return p.fix.run;
  const r = RULE_BY_ID.get(p.rule);
  if (!r || !p.fix) return undefined;
  const cx = new Context(m);
  /** @type {any[]} */
  let found = [];
  if (r.check) { const e = m.get(p.id); const res = e ? r.check(m, e, cx) : null; found = res ? (Array.isArray(res) ? res : [res]) : []; }
  else if (r.all) found = r.all(m, cx).filter((f) => f.id === p.id);
  const hit = found.find((o) => o && typeof o === 'object' && o.message === p.message && o.fix?.label === p.fix?.label) || found.find((o) => o && typeof o === 'object' && o.fix?.label === p.fix?.label);
  return hit?.fix?.run;
}

/** The title of a rule or custom rule, by its id in a problem. @param {Config} c @param {string} rule */
export function ruleTitle(c, rule) {
  if (rule.startsWith('custom:')) { const r = c.custom.find((x) => `custom:${x.id}` === rule); return r ? (r.name || customText(r)) : 'Custom rule'; }
  return RULE_BY_ID.get(rule)?.title || rule;
}

/** The worst severity in a list of problems. @param {Problem[] | undefined} list @returns {Severity | null} */
export const worst = (list) => (list && list.length ? list.reduce((w, p) => (RANK[p.severity] < RANK[w] ? p.severity : w), /** @type {Severity} */ ('info')) : null);

/**
 * A validator for a live model: runs once now, then again shortly after every change, and
 * tells its subscribers. Running is skipped while the model keeps changing (typing, dragging),
 * so it never slows an edit down.
 *
 * With `worker`, the rules run in a background worker that keeps its own copy of the model,
 * updated with only the elements each edit touched, so even a 50,000-element project is
 * checked without taking any time from the page. Without workers (or if one fails to start)
 * the same rules run here.
 * @param {Model} m @param {{ delay?: number, worker?: boolean }} [o]
 */
export function createValidator(m, o = {}) {
  const delay = o.delay ?? 250;
  /** @type {Set<(r: Report) => void>} */
  const subs = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let stamp = 0;
  /** @type {Report} */
  let report;
  /** @type {Worker | null} */
  let worker = null;
  /** Ids changed since the worker last heard. */
  let dirty = new Set();
  let seq = 0;
  /** @type {Map<number, (r: Report) => void>} */
  const waiting = new Map();

  const publish = (/** @type {Report} */ r) => { report = r; stamp++; subs.forEach((f) => f(r)); };
  const runHere = () => { publish(validate(m)); return Promise.resolve(report); };

  if (o.worker && typeof Worker === 'function') {
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'Loom validation' });
      worker.onmessage = (ev) => {
        const d = ev.data;
        if (d.t !== 'report') return;
        const r = reportOf(m, d.problems, d.ignored, d.ms, d.version);
        const done = waiting.get(d.seq); waiting.delete(d.seq);
        // a report on an older model is still shown (it is nearly right); a newer run is already queued
        publish(r);
        done?.(r);
      };
      worker.onerror = (ev) => { ev.preventDefault?.(); fallBack(); };
      worker.postMessage({ t: 'load', elements: treeOrder(m), version: m.version() });
    } catch { worker = null; }
  }
  function fallBack() {
    if (!worker) return;
    worker.terminate(); worker = null;
    const pending = [...waiting.values()]; waiting.clear();
    runHere(); pending.forEach((f) => f(report));
  }
  /** Send what changed and ask for a run. @returns {Promise<Report>} */
  function runWorker() {
    const w = /** @type {Worker} */ (worker);
    if (dirty.size) { w.postMessage({ t: 'patch', changes: changesFor(m, dirty) }); dirty = new Set(); }
    const id = ++seq;
    w.postMessage({ t: 'run', seq: id, version: m.version() });
    return new Promise((res) => waiting.set(id, res));
  }
  const run = () => { timer = undefined; return worker ? runWorker() : runHere(); };

  // the first report: right away here, or an empty one until the worker answers
  if (worker) { report = reportOf(m, [], 0, 0, -1); run(); }
  else report = validate(m);

  const unsub = m.subscribe((e) => {
    if (worker) for (const id of e.ids) dirty.add(id);
    clearTimeout(timer); timer = setTimeout(run, delay);
  });
  return {
    report: () => report,
    /** Increases every time problems are recomputed. */
    stamp: () => stamp,
    /** Is the work done in a background worker? */
    inWorker: () => !!worker,
    /** Run now (after changing the settings, say). @returns {Promise<Report>} */
    now() { clearTimeout(timer); return run(); },
    /** @param {string} id */
    problemsFor: (id) => report.byId.get(id) || [],
    /** @param {(r: Report) => void} fn @returns {() => void} */
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    dispose() { clearTimeout(timer); unsub(); subs.clear(); worker?.terminate(); worker = null; },
  };
}

/** Every element, owners before children, then relationships: the order a model loads in. @param {Model} m */
function treeOrder(m) {
  /** @type {import('../model/model.js').Element[]} */
  const out = [];
  const walk = (/** @type {import('../model/model.js').Element} */ e) => { out.push(e); for (const c of m.children(e.id)) walk(c); };
  const root = m.root();
  if (root) walk(root);
  for (const e of m.all()) if (isRel(e.kind)) out.push(e);
  return out;
}

/** What the worker needs to follow these changed ids. @param {Model} m @param {Set<string>} ids */
function changesFor(m, ids) {
  return [...ids].map((id) => {
    const el = m.get(id);
    if (!el) return { id, el: null };
    let d = 0;
    for (let x = el.owner; x; x = m.get(x)?.owner ?? null) d++;
    const i = el.owner && !isRel(el.kind) ? m.children(el.owner).findIndex((c) => c.id === id) : 0;
    return { id, el, d: isRel(el.kind) ? 1e6 : d, i };
  });
}

/** @typedef {ReturnType<typeof createValidator>} Validator */
