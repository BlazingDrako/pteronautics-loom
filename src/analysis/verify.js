// Live verification. A requirement can carry a check, such as "endurance >= 3 [h]". Names in
// the check are values of what satisfies the requirement (a block, or a part in its block),
// computed by the parametric solver where they have no number, and the requirement's own
// value properties. Every edit re-runs the checks, so a requirement goes red the moment a
// design change breaks it.
import { parseExpr, evaluate, isTest, ExprError } from './expr.js';
import { analysisOf, unitOf, givenValue, showVar } from './solver.js';
import { parseUnit, toSI, formatNumber, fromSI } from './units.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/**
 * @typedef {{
 *   verdict: 'pass' | 'fail' | 'error' | 'none',
 *   message: string,
 *   subjects: { id: string, name: string, verdict: 'pass' | 'fail' | 'error', values: string[] }[],
 * }} CheckResult
 *   values: the names the check used, with their values ("endurance = 3.2 h")
 */

/** What a requirement's check is evaluated against: the blocks (and parts) that satisfy it. @param {Model} m @param {string} reqId */
export function subjectsOf(m, reqId) {
  /** @type {{ id: string, block: string, prefix: string, name: string }[]} */
  const out = [];
  for (const r of m.relsTo(reqId)) {
    if (r.kind !== 'satisfy' || !r.source) continue;
    const s = m.get(r.source);
    if (!s) continue;
    if (s.kind === 'partDef') out.push({ id: s.id, block: s.id, prefix: '', name: s.name });
    else if (s.kind === 'part' && s.owner) out.push({ id: s.id, block: s.owner, prefix: `${s.name}.`, name: `${m.get(s.owner)?.name}.${s.name}` });
  }
  return out;
}

/**
 * Evaluate one requirement's check.
 * @param {Model} m @param {Element} req @returns {CheckResult}
 */
export function checkRequirement(m, req) {
  const text = String(req.props.check || '').trim();
  if (!text) return { verdict: 'none', message: '', subjects: [] };
  let ast;
  try { ast = parseExpr(text); }
  catch (e) { return { verdict: 'error', message: e instanceof ExprError ? e.message : String(e), subjects: [] }; }
  if (!isTest(ast)) return { verdict: 'error', message: 'A check must be a comparison, such as endurance >= 3 [h]', subjects: [] };
  // the requirement's own values (limits written once, used in the check)
  /** @type {Map<string, { v: number, d: any }>} */
  const own = new Map();
  for (const a of m.children(req.id)) {
    if (a.kind !== 'attribute') continue;
    const g = givenValue(a);
    try { if (g !== undefined) own.set(a.name, { v: toSI(g, unitOf(m, a)), d: parseUnit(unitOf(m, a)).d }); } catch { /* a bad unit: the name stays unknown */ }
  }
  const subjects = subjectsOf(m, req.id);
  const run = (/** @type {(name: string) => any} */ lookup) => evaluate(ast, lookup, { tol: 1e-9 });
  if (!subjects.length) {
    try {
      const ok = run((n) => own.get(n));
      return { verdict: ok ? 'pass' : 'fail', message: ok ? 'Met' : 'Not met', subjects: [] };
    } catch (e) {
      return { verdict: 'error', message: `${e instanceof ExprError ? e.message : String(e)}. Nothing satisfies this requirement yet, so its check has no values to use`, subjects: [] };
    }
  }
  /** @type {CheckResult['subjects']} */
  const results = [];
  let firstError = '';
  for (const s of subjects) {
    const an = analysisOf(m, s.block);
    /** @type {string[]} */
    const used = [];
    const lookup = (/** @type {string} */ n) => {
      if (own.has(n)) { used.push(n); return own.get(n); }
      const v = an.byName.get(s.prefix + n) || an.byName.get(n);
      if (!v || v.si === undefined) return undefined;
      used.push(`${n} = ${showVar(v)}${v.source === 'computed' ? ' (computed)' : ''}`);
      return { v: v.si, d: v.dim };
    };
    try {
      const ok = run(lookup);
      results.push({ id: s.id, name: s.name, verdict: ok ? 'pass' : 'fail', values: used });
    } catch (e) {
      const msg = e instanceof ExprError ? e.message : String(e);
      if (!firstError) firstError = /^Unknown name/.test(msg) ? `${msg.replace(/^Unknown name/, 'No value for')} in ${s.name}` : msg;
      results.push({ id: s.id, name: s.name, verdict: 'error', values: used });
    }
  }
  const verdict = results.some((r) => r.verdict === 'error') ? 'error' : results.some((r) => r.verdict === 'fail') ? 'fail' : 'pass';
  const vals = results.flatMap((r) => r.values);
  const message = verdict === 'error' ? firstError : verdict === 'pass' ? `Met${vals.length ? `: ${[...new Set(vals)].join(', ')}` : ''}` : `Not met${vals.length ? `: ${[...new Set(vals)].join(', ')}` : ''}`;
  return { verdict, message, subjects: results };
}

/** @type {WeakMap<Model, { version: number, map: Map<string, CheckResult> }>} */
const memo = new WeakMap();
/** Every requirement's check, recomputed only after the model changes. @param {Model} m @returns {Map<string, CheckResult>} */
export function checksOf(m) {
  const c = memo.get(m);
  if (c && c.version === m.version()) return c.map;
  /** @type {Map<string, CheckResult>} */
  const map = new Map();
  for (const r of m.byKind('requirement')) if (String(r.props.check || '').trim()) map.set(r.id, checkRequirement(m, r));
  memo.set(m, { version: m.version(), map });
  return map;
}

export { formatNumber, fromSI };
