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
  problems.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message));
  /** @type {Map<string, Problem[]>} */
  const byId = new Map();
  for (const p of problems) for (const id of new Set([p.id, ...(p.ids || [])])) if (m.get(id) && !isRel(/** @type {any} */ (m.get(id)).kind)) (byId.get(id) || byId.set(id, []).get(id))?.push(p);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity]++;
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { problems, byId, counts, ignored: nIgnored, ms, version: m.version() };
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
 * @param {Model} m @param {{ delay?: number }} [o]
 */
export function createValidator(m, o = {}) {
  const delay = o.delay ?? 250;
  /** @type {Report} */
  let report = validate(m);
  /** @type {Set<(r: Report) => void>} */
  const subs = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let stamp = 0;
  const run = () => { timer = undefined; report = validate(m); stamp++; subs.forEach((f) => f(report)); };
  const unsub = m.subscribe(() => { clearTimeout(timer); timer = setTimeout(run, delay); });
  return {
    report: () => report,
    /** Increases every time problems are recomputed. */
    stamp: () => stamp,
    /** Run now (after changing the settings, say). */
    now() { clearTimeout(timer); run(); },
    /** @param {string} id */
    problemsFor: (id) => report.byId.get(id) || [],
    /** @param {(r: Report) => void} fn @returns {() => void} */
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    dispose() { clearTimeout(timer); unsub(); subs.clear(); },
  };
}

/** @typedef {ReturnType<typeof createValidator>} Validator */
