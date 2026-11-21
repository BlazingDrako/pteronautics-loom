// The parametric solver. A block's value properties (through its parts, as deep as they go)
// are variables; its constraint properties are equations whose parameters are bound to those
// variables. Values with a number are given; the rest are computed:
//
//   1. any equation with one unknown left is solved for it (Newton's method), again and again;
//   2. what is left (equations that share unknowns) is solved together (Newton–Raphson);
//   3. equations whose values are all known are checked, so a value that breaks one is flagged.
//
// Everything is computed in SI and shown in each value's own unit. Units are checked first:
// an equation that adds hours to kilograms, or a binding that joins a charge to an energy,
// is reported instead of giving a wrong answer.
import { parseUnit, toSI, fromSI, sameDim, dimName, NONE, formatNumber, isUnit } from './units.js';
import { parseExpr, evaluate, namesIn, isEquation, isTest, ExprError } from './expr.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('./units.js').Dim} Dim */
/**
 * @typedef {{
 *   key: string, path: string[], attr: string, name: string, unit: string, dim: Dim,
 *   si: number | undefined, value: number | undefined,
 *   source: 'given' | 'computed' | 'unknown', by: number | null, local: boolean,
 * }} Var
 *   key: part ids then the value property's id, joined by "/" (a parametric diagram's layout key)
 *   local: an unbound parameter of one equation, not a value of the block
 * @typedef {{
 *   key: string, constraint: string, def: string | null, path: string[], name: string, expr: string,
 *   params: Map<string, string>, kind: 'equation' | 'test' | 'none',
 *   status: 'ok' | 'conflict' | 'violated' | 'unsolved' | 'error' | 'empty', message: string,
 * }} Equation
 *   params: parameter name → variable key
 * @typedef {{ level: 'error' | 'warn', message: string, id: string | null }} Problem
 * @typedef {{ context: string, vars: Map<string, Var>, byName: Map<string, Var>, equations: Equation[], problems: Problem[], ms: number }} Analysis
 */

const MAX_DEPTH = 12;
const TOL = 1e-9;

/** The unit of a value property: its own, else its value type's. @param {Model} m @param {Element} a */
export function unitOf(m, a) {
  if (a.props.unit) return a.props.unit;
  const t = a.props.type ? m.get(a.props.type) : null;
  return t?.props.unit || '';
}

/** A value property's number in its unit, if it has one. @param {Element} a @returns {number | undefined} */
export function givenValue(a) {
  const v = String(a.props.value ?? '').trim();
  if (!v || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return undefined;
  return Number(v);
}

/** Value properties of a block, own and inherited, nearest first (a redefinition hides a general one). @param {Model} m @param {string} blockId */
export function valuesOf(m, blockId) {
  /** @type {Map<string, Element>} */
  const out = new Map();
  for (const b of m.supersOf(blockId)) for (const c of m.children(b)) if (c.kind === 'attribute' && !out.has(c.name)) out.set(c.name, c);
  return [...out.values()];
}

/**
 * Analyze a block: every value through its parts, every equation, solved.
 * @param {Model} m @param {string} blockId @returns {Analysis}
 */
export function analyze(m, blockId) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  /** @type {Map<string, Var>} */
  const vars = new Map();
  /** @type {Equation[]} */
  const equations = [];
  /** @type {Problem[]} */
  const problems = [];
  /** @type {{ eq: Equation, ast: any }[]} */
  const parsed = [];

  /** @param {string[]} path @param {Element} a @param {string} prefix @param {boolean} local */
  const addVar = (path, a, prefix, local = false) => {
    const key = [...path, a.id].join('/');
    const unit = unitOf(m, a);
    let dim = NONE, ok = true;
    try { dim = parseUnit(unit).d; } catch { ok = false; problems.push({ level: 'error', message: `${prefix}${a.name}: "${unit}" is not a unit Loom knows`, id: a.id }); }
    const value = ok ? givenValue(a) : undefined;
    /** @type {Var} */
    const v = { key, path, attr: a.id, name: prefix + a.name, unit, dim, si: value === undefined ? undefined : toSI(value, unit), value, source: value === undefined ? 'unknown' : 'given', by: null, local };
    vars.set(key, v);
    return v;
  };

  /** Walk a block in a context. @param {string} block @param {string[]} path part ids @param {string} prefix "propulsion.battery." @param {Element | null} part the part we came through @param {Set<string>} stack */
  function walk(block, path, prefix, part, stack) {
    if (path.length > MAX_DEPTH || stack.has(block)) return;
    stack.add(block);
    const supers = m.supersOf(block);
    for (const a of valuesOf(m, block)) addVar(path, a, prefix);
    // a part's own value properties redefine its type's (a value given on the part wins)
    if (part) for (const a of m.children(part.id)) {
      if (a.kind !== 'attribute') continue;
      const same = [...vars.values()].find((v) => v.path.length === path.length && v.path.every((x, i) => x === path[i]) && v.name === prefix + a.name);
      if (same) {
        const g = givenValue(a);
        if (g !== undefined) { same.value = g; same.si = toSI(g, same.unit); same.source = 'given'; }
      } else addVar(path, a, prefix);
    }
    // equations used here
    for (const b of supers) for (const c of m.children(b)) {
      if (c.kind !== 'constraint') continue;
      const def = c.props.type ? m.get(c.props.type) : null;
      /** @type {Equation} */
      const eq = { key: [...path, c.id].join('/'), constraint: c.id, def: def?.id || null, path, name: prefix + c.name, expr: def?.props.expr || '', params: new Map(), kind: 'none', status: 'ok', message: '' };
      equations.push(eq);
      if (!def) { eq.status = 'empty'; eq.message = 'No constraint block: choose one in the inspector'; problems.push({ level: 'warn', message: `${eq.name} has no constraint block`, id: c.id }); continue; }
      if (!eq.expr.trim()) { eq.status = 'empty'; eq.message = `${def.name} has no equation yet`; problems.push({ level: 'warn', message: `${def.name} has no equation yet`, id: def.id }); continue; }
      let ast;
      try { ast = parseExpr(eq.expr); }
      catch (e) { eq.status = 'error'; eq.message = e instanceof ExprError ? e.message : String(e); problems.push({ level: 'error', message: `${def.name}: ${eq.message}`, id: def.id }); continue; }
      eq.kind = isEquation(ast) ? 'equation' : isTest(ast) ? 'test' : 'none';
      if (eq.kind === 'none') { eq.status = 'error'; eq.message = 'An equation needs "=" (or a comparison such as <=)'; problems.push({ level: 'error', message: `${def.name}: ${eq.message}`, id: def.id }); continue; }
      const params = m.children(def.id).filter((x) => x.kind === 'attribute');
      const bindings = supers.flatMap((bb) => m.children(bb)).filter((x) => x.kind === 'binding' && x.props.constraint === c.id);
      for (const p of params) {
        const bnd = bindings.find((x) => x.props.param === p.id);
        if (bnd && bnd.props.value?.port) {
          const key = [...path, ...bnd.props.value.path, bnd.props.value.port].join('/');
          const v = vars.get(key) || (() => {
            // a value of a deeper part that the walk has not reached yet: add it now
            const a = m.get(bnd.props.value.port);
            const names = bnd.props.value.path.map((/** @type {string} */ id) => m.get(id)?.name || '?');
            return a ? addVar([...path, ...bnd.props.value.path], a, prefix + names.map((/** @type {string} */ n) => n + '.').join('')) : null;
          })();
          if (!v) continue;
          const pu = unitOf(m, p);
          if (pu && isUnit(pu) && !sameDim(parseUnit(pu).d, v.dim)) {
            problems.push({ level: 'error', message: `${eq.name}: ${p.name} is ${dimName(parseUnit(pu).d)} but is bound to ${v.name}, which is ${dimName(v.dim)}`, id: bnd.id });
            eq.status = 'error'; eq.message = `${p.name} and ${v.name} measure different things`;
          }
          eq.params.set(p.name, key);
        } else {
          // an unbound parameter: its own value if it has one, else an unknown of this equation
          const v = addVar([...path, c.id], p, `${prefix}${c.name}.`, true);
          eq.params.set(p.name, v.key);
        }
      }
      if (eq.status === 'error') continue;
      const missing = [...namesIn(ast)].filter((n) => !eq.params.has(n));
      if (missing.length) {
        eq.status = 'error';
        eq.message = `Uses ${missing.join(', ')}, which ${missing.length > 1 ? 'are not parameters' : 'is not a parameter'} of ${def.name}`;
        problems.push({ level: 'error', message: `${def.name}: ${eq.message}`, id: def.id });
        continue;
      }
      parsed.push({ eq, ast });
    }
    // deeper
    for (const b of supers) for (const p of m.children(b)) {
      if (p.kind !== 'part' || !p.props.type) continue;
      walk(p.props.type, [...path, p.id], `${prefix}${p.name}.`, p, stack);
    }
    stack.delete(block);
  }
  walk(blockId, [], '', null, new Set());

  // ---------- units ----------
  /** @param {{ eq: Equation, ast: any }} x @param {(k: string) => number | undefined} val */
  const sides = (x, val) => {
    const look = (/** @type {string} */ n) => { const k = /** @type {string} */ (x.eq.params.get(n)); const v = /** @type {Var} */ (vars.get(k)); const si = val(k); return si === undefined ? undefined : { v: si, d: v.dim }; };
    return { a: evaluate(x.ast.a, look), b: evaluate(x.ast.b, look) };
  };
  const live = parsed.filter((x) => {
    if (x.eq.kind !== 'equation') return true;
    try {
      const s = sides(x, () => 1.2345);
      if (typeof s.a === 'boolean' || typeof s.b === 'boolean') throw new ExprError('Both sides of an equation must be numbers');
      if (!sameDim(s.a.d, s.b.d)) throw new ExprError(`The left side is ${dimName(s.a.d)} but the right side is ${dimName(s.b.d)}`);
      return true;
    } catch (e) {
      x.eq.status = 'error'; x.eq.message = e instanceof ExprError ? e.message : String(e);
      problems.push({ level: 'error', message: `${x.eq.name}: ${x.eq.message}`, id: x.eq.def || x.eq.constraint });
      return false;
    }
  });

  // ---------- solve ----------
  const eqs = live.filter((x) => x.eq.kind === 'equation');
  /** @param {{ eq: Equation, ast: any }} x */
  const unknownsOf = (x) => [...new Set(x.eq.params.values())].filter((k) => /** @type {Var} */ (vars.get(k)).si === undefined);
  /** residual of an equation for trial values @param {{ eq: Equation, ast: any }} x @param {Map<string, number>} trial */
  const resid = (x, trial) => {
    const s = sides(x, (k) => (trial.has(k) ? trial.get(k) : vars.get(k)?.si));
    const a = /** @type {any} */ (s.a).v, b = /** @type {any} */ (s.b).v;
    return { f: a - b, scale: Math.max(Math.abs(a), Math.abs(b)) };
  };
  let pending = [...eqs];
  /** The value an equation defines: "E = C * V" defines E. @param {{ eq: Equation, ast: any }} x */
  const defines = (x) => (x.ast.a.t === 'name' ? x.eq.params.get(x.ast.a.name) : undefined);
  for (let pass = 0; pass < 400; pass++) {
    let progress = false;
    // equations written as definitions go first, so a value you typed that breaks one is the
    // one reported (not some other value the solver worked back to)
    const ready = pending.filter((x) => { const u = unknownsOf(x); return u.length === 1 && u[0] === defines(x); });
    const list = ready.length ? ready : [...pending];
    for (const x of list) {
      const u = unknownsOf(x);
      if (u.length === 0) { pending = pending.filter((y) => y !== x); continue; }
      if (u.length !== 1) continue;
      if (ready.length && u[0] !== defines(x)) continue;
      const k = u[0];
      const root = solve1(x, k, resid);
      pending = pending.filter((y) => y !== x);
      if (root === null) { x.eq.status = 'unsolved'; x.eq.message = `No value of ${/** @type {Var} */ (vars.get(k)).name} satisfies it`; problems.push({ level: 'error', message: `${x.eq.name}: ${x.eq.message}`, id: x.eq.constraint }); continue; }
      const v = /** @type {Var} */ (vars.get(k));
      v.si = root; v.value = fromSI(root, v.unit); v.source = 'computed'; v.by = equations.indexOf(x.eq);
      progress = true;
    }
    if (!progress && !ready.length) break;
  }
  // coupled equations, solved together
  if (pending.length) {
    for (const group of components(pending, unknownsOf)) {
      const unknown = [...new Set(group.flatMap(unknownsOf))];
      if (group.length === unknown.length) {
        const sol = newton(group, unknown, resid);
        if (sol) {
          unknown.forEach((k, i) => { const v = /** @type {Var} */ (vars.get(k)); v.si = sol[i]; v.value = fromSI(sol[i], v.unit); v.source = 'computed'; v.by = equations.indexOf(group[0].eq); });
          continue;
        }
        for (const x of group) { x.eq.status = 'unsolved'; x.eq.message = 'These equations have no solution from here'; }
        problems.push({ level: 'error', message: `Could not solve ${group.map((x) => x.eq.name).join(', ')} together`, id: group[0].eq.constraint });
      } else {
        const more = unknown.length - group.length;
        for (const x of group) { x.eq.status = 'unsolved'; x.eq.message = more > 0 ? `Needs ${more} more given value${more > 1 ? 's' : ''}: ${unknown.map((k) => vars.get(k)?.name).join(', ')} are all unknown` : 'More equations than unknowns'; }
        problems.push({ level: 'warn', message: `${group.map((x) => x.eq.name).join(', ')}: ${group[0].eq.message}`, id: group[0].eq.constraint });
      }
    }
  }
  // check equations whose values are all known, and inequalities
  for (const x of live) {
    if (x.eq.status !== 'ok') continue;
    const look = (/** @type {string} */ n) => { const k = /** @type {string} */ (x.eq.params.get(n)); const v = /** @type {Var} */ (vars.get(k)); return v.si === undefined ? undefined : { v: v.si, d: v.dim }; };
    if (x.eq.kind === 'test') {
      try {
        const ok = evaluate(x.ast, look, { tol: 1e-9 });
        if (ok === false) { x.eq.status = 'violated'; x.eq.message = 'Not met by the current values'; problems.push({ level: 'error', message: `${x.eq.name}: ${x.eq.expr} is not met`, id: x.eq.constraint }); }
      } catch (e) {
        x.eq.status = 'unsolved'; x.eq.message = e instanceof ExprError ? e.message.replace(/^Unknown name/, 'No value yet for') : String(e);
      }
      continue;
    }
    if (unknownsOf(x).length) continue;
    const r = resid(x, new Map());
    if (Math.abs(r.f) > 1e-6 * Math.max(r.scale, 1e-12)) {
      const s = sides(x, (k) => vars.get(k)?.si);
      const lhsName = x.ast.a.t === 'name' ? x.ast.a.name : 'the left side';
      const lv = x.ast.a.t === 'name' ? vars.get(/** @type {string} */ (x.eq.params.get(x.ast.a.name))) : null;
      const shown = (/** @type {any} */ q, /** @type {Var | null | undefined} */ v) => (v ? `${formatNumber(fromSI(q.v, v.unit))}${v.unit ? ' ' + v.unit : ''}` : formatNumber(q.v));
      x.eq.status = 'conflict';
      x.eq.message = `${lhsName} should be ${shown(s.b, lv)} but is ${shown(s.a, lv)}`;
      problems.push({ level: 'error', message: `${x.eq.name}: ${x.eq.message}`, id: x.eq.constraint });
    }
  }
  /** @type {Map<string, Var>} */
  const byName = new Map();
  for (const v of vars.values()) if (!v.local && !byName.has(v.name)) byName.set(v.name, v);
  return { context: blockId, vars, byName, equations, problems, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
}

/**
 * Solve one equation for one unknown.
 * @param {any} x @param {string} k @param {(x: any, trial: Map<string, number>) => { f: number, scale: number }} resid
 * @returns {number | null}
 */
function solve1(x, k, resid) {
  const f = (/** @type {number} */ v) => { try { return resid(x, new Map([[k, v]])); } catch { return { f: NaN, scale: 1 }; } };
  for (const start of [1, 10, 0.1, 1000, 1e-3, 1e6, -1, -1000, 1e-6, 1e9]) {
    let v = start;
    for (let i = 0; i < 80; i++) {
      const r = f(v);
      if (!Number.isFinite(r.f)) break;
      if (Math.abs(r.f) <= TOL * Math.max(r.scale, 1e-300)) return v;
      const hh = 1e-7 * Math.max(Math.abs(v), 1e-9);
      const d = (f(v + hh).f - r.f) / hh;
      if (!Number.isFinite(d) || d === 0) break;
      let step = r.f / d, next = v - step;
      // damp: never take a step that makes things worse
      for (let j = 0; j < 30 && Math.abs(f(next).f) > Math.abs(r.f) && Number.isFinite(f(next).f); j++) { step /= 2; next = v - step; }
      if (next === v) break;
      v = next;
    }
    const r = f(v);
    if (Number.isFinite(r.f) && Math.abs(r.f) <= 1e-7 * Math.max(r.scale, 1e-300)) return v;
  }
  return null;
}

/**
 * Solve n equations in n unknowns together.
 * @param {any[]} group @param {string[]} unknown @param {(x: any, trial: Map<string, number>) => { f: number, scale: number }} resid
 * @returns {number[] | null}
 */
function newton(group, unknown, resid) {
  const n = unknown.length;
  const F = (/** @type {number[]} */ xs) => { const t = new Map(unknown.map((k, i) => [k, xs[i]])); try { return group.map((g) => resid(g, t)); } catch { return null; } };
  const norm = (/** @type {{ f: number, scale: number }[] | null} */ r) => (r ? Math.hypot(...r.map((q) => q.f / Math.max(q.scale, 1e-300))) : Infinity);
  for (const start of [1, 10, 0.1, 100, 1000]) {
    let xs = unknown.map(() => start);
    for (let it = 0; it < 100; it++) {
      const r = F(xs);
      if (!r || r.some((q) => !Number.isFinite(q.f))) break;
      if (r.every((q) => Math.abs(q.f) <= TOL * Math.max(q.scale, 1e-300))) return xs;
      // numeric Jacobian
      const J = r.map(() => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        const hh = 1e-7 * Math.max(Math.abs(xs[j]), 1e-9);
        const xp = xs.slice(); xp[j] += hh;
        const rp = F(xp);
        if (!rp) return null;
        for (let i = 0; i < n; i++) J[i][j] = (rp[i].f - r[i].f) / hh;
      }
      const dx = gauss(J, r.map((q) => -q.f));
      if (!dx) break;
      let lam = 1, next = xs.map((x, i) => x + dx[i]);
      const base = norm(r);
      for (let j = 0; j < 30 && norm(F(next)) > base; j++) { lam /= 2; next = xs.map((x, i) => x + lam * dx[i]); }
      xs = next;
    }
    const r = F(xs);
    if (r && r.every((q) => Number.isFinite(q.f) && Math.abs(q.f) <= 1e-7 * Math.max(q.scale, 1e-300))) return xs;
  }
  return null;
}

/** Solve A x = b by elimination with partial pivoting. @param {number[][]} A @param {number[]} b @returns {number[] | null} */
function gauss(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Groups of equations that share unknowns. @param {any[]} eqs @param {(x: any) => string[]} unknownsOf */
function components(eqs, unknownsOf) {
  /** @type {any[][]} */
  const out = [];
  const left = [...eqs];
  while (left.length) {
    const group = [/** @type {any} */ (left.shift())];
    const keys = new Set(unknownsOf(group[0]));
    for (let grew = true; grew;) {
      grew = false;
      for (const x of [...left]) if (unknownsOf(x).some((k) => keys.has(k))) { group.push(x); left.splice(left.indexOf(x), 1); unknownsOf(x).forEach((k) => keys.add(k)); grew = true; }
    }
    out.push(group);
  }
  return out;
}

/** @type {WeakMap<Model, { version: number, byBlock: Map<string, Analysis> }>} */
const memo = new WeakMap();
/** The analysis of a block, recomputed only after the model changes. @param {Model} m @param {string} blockId */
export function analysisOf(m, blockId) {
  let c = memo.get(m);
  if (!c || c.version !== m.version()) { c = { version: m.version(), byBlock: new Map() }; memo.set(m, c); }
  let a = c.byBlock.get(blockId);
  if (!a) { a = analyze(m, blockId); c.byBlock.set(blockId, a); }
  return a;
}

/** Does a block (or anything inside it) use equations? @param {Model} m @param {string} blockId */
export function hasEquations(m, blockId) {
  const seen = new Set();
  const go = (/** @type {string} */ b) => {
    if (seen.has(b)) return false;
    seen.add(b);
    return m.supersOf(b).some((x) => m.children(x).some((c) => c.kind === 'constraint' || (c.kind === 'part' && c.props.type && go(c.props.type))));
  };
  return go(blockId);
}

/** A value as people read it: "675 Wh". @param {Var} v */
export const showVar = (v) => (v.value === undefined ? '?' : `${formatNumber(v.value)}${v.unit ? ` ${v.unit}` : ''}`);

/**
 * Create the parameters an equation uses that its constraint block does not have yet.
 * Call inside a transaction. @param {Model} m @param {any} tx @param {string} defId @returns {string[]} the names added
 */
export function addMissingParams(m, tx, defId) {
  const def = m.get(defId);
  if (!def || def.kind !== 'constraintDef') return [];
  let names;
  try { names = [...namesIn(parseExpr(def.props.expr || ''))]; } catch { return []; }
  const have = new Set(m.children(defId).filter((c) => c.kind === 'attribute').map((c) => c.name));
  const add = names.filter((n) => !have.has(n) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  for (const n of add) tx.create('attribute', { owner: defId, name: n });
  return add;
}
