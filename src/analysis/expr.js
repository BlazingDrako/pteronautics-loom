// Expressions: the small language of constraint equations, requirement checks and guards.
//
//   E = C * V * dod                       an equation (constraint)
//   endurance >= 3 [h]                    a check: numbers can carry a unit in brackets
//   battery > 20% and not armed           guards: and, or, not, true, false
//   sqrt(2 * W / (rho * S * CL))          functions: sqrt abs min max exp ln log10 sin cos tan…
//   propulsion.battery.capacity           names can be paths through parts
//
// Values are quantities: a number in SI and a dimension, so units convert by themselves and
// mixing kinds of quantity ("adds a time to a mass") is an error, not a wrong answer.
import { parseUnit, NONE, sameDim, isNone, dimName, UnitError } from './units.js';

/** @typedef {import('./units.js').Dim} Dim */
/** @typedef {{ v: number, d: Dim }} Q */
/** @typedef {Q | boolean} Val */
/**
 * @typedef {{ t: 'num', v: number, d: Dim, src: string }
 *   | { t: 'name', name: string, pos: number }
 *   | { t: 'call', f: string, args: Ast[], pos: number }
 *   | { t: 'neg', a: Ast }
 *   | { t: 'not', a: Ast }
 *   | { t: 'bin', op: string, a: Ast, b: Ast, pos: number }
 *   | { t: 'bool', v: boolean }} Ast
 */

export class ExprError extends Error {
  /** @param {string} msg @param {number} [pos] */
  constructor(msg, pos = -1) { super(msg); this.pos = pos; }
}

const CONST = /** @type {Record<string, Q>} */ ({ pi: { v: Math.PI, d: NONE }, π: { v: Math.PI, d: NONE }, e: { v: Math.E, d: NONE } });
const FN1 = /** @type {Record<string, (x: number) => number>} */ ({
  exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
});
/** Functions that keep their argument's unit. */
const KEEP = /** @type {Record<string, (x: number) => number>} */ ({ abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round });
export const FUNCTIONS = ['sqrt', 'cbrt', 'pow', 'min', 'max', 'atan2', 'hypot', ...Object.keys(KEEP), ...Object.keys(FN1)];

const OPS = ['<=', '>=', '==', '!=', '≤', '≥', '≠', '<', '>', '=', '+', '-', '−', '*', '×', '·', '/', '÷', '^', '(', ')', ','];

/**
 * @param {string} src
 * @returns {{ t: 'num' | 'name' | 'op' | 'unit' | 'end', v: string, pos: number }[]}
 */
function tokens(src) {
  /** @type {{ t: 'num' | 'name' | 'op' | 'unit' | 'end', v: string, pos: number }[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: num[0], pos: i }); i += num[0].length; continue; }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new ExprError('A unit in [ … ] is not closed', i);
      out.push({ t: 'unit', v: src.slice(i + 1, j).trim(), pos: i }); i = j + 1; continue;
    }
    if (c === '%') { out.push({ t: 'unit', v: '%', pos: i }); i++; continue; }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new ExprError('A quoted name is not closed', i);
      out.push({ t: 'name', v: src.slice(i + 1, j), pos: i }); i = j + 1; continue;
    }
    const w = /^[A-Za-z_π][A-Za-z0-9_]*/.exec(src.slice(i));
    if (w) { out.push({ t: 'name', v: w[0], pos: i }); i += w[0].length; continue; }
    if (c === '.') { out.push({ t: 'op', v: '.', pos: i }); i++; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, pos: i }); i += op.length; continue; }
    throw new ExprError(`"${c}" is not allowed here`, i);
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

/** Normalize symbol spellings. @param {string} v */
const norm = (v) => ({ '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '×': '*', '·': '*', '÷': '/' })[/** @type {'≤'} */ (v)] || v;

/** @type {Map<string, Ast>} */
const cache = new Map();

/**
 * Parse an expression. Throws ExprError with a position.
 * @param {string} src @returns {Ast}
 */
export function parseExpr(src) {
  const key = String(src ?? '');
  const hit = cache.get(key);
  if (hit) return hit;
  const toks = tokens(key);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (/** @type {string} */ v) => peek().t === 'op' && norm(peek().v) === v;
  const isWord = (/** @type {string} */ v) => peek().t === 'name' && peek().v === v;
  const expect = (/** @type {string} */ v) => { if (!isOp(v)) throw new ExprError(`Expected "${v}"${peek().t === 'end' ? ' before the end' : ` at "${peek().v}"`}`, peek().pos); p++; };

  /** @returns {Ast} */
  const or = () => { let a = and(); while (isWord('or')) { const pos = toks[p++].pos; a = { t: 'bin', op: 'or', a, b: and(), pos }; } return a; };
  /** @returns {Ast} */
  const and = () => { let a = not(); while (isWord('and')) { const pos = toks[p++].pos; a = { t: 'bin', op: 'and', a, b: not(), pos }; } return a; };
  /** @returns {Ast} */
  const not = () => { if (isWord('not')) { p++; return { t: 'not', a: not() }; } return cmp(); };
  /** @returns {Ast} */
  function cmp() {
    const a = sum();
    if (peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!=', '='].includes(norm(peek().v))) {
      const t = toks[p++];
      return { t: 'bin', op: norm(t.v) === '==' ? '=' : norm(t.v), a, b: sum(), pos: t.pos };
    }
    return a;
  }
  /** @returns {Ast} */
  function sum() {
    let a = prod();
    while (isOp('+') || isOp('-')) { const t = toks[p++]; a = { t: 'bin', op: norm(t.v), a, b: prod(), pos: t.pos }; }
    return a;
  }
  /** @returns {Ast} */
  function prod() {
    let a = unary();
    while (isOp('*') || isOp('/')) { const t = toks[p++]; a = { t: 'bin', op: norm(t.v), a, b: unary(), pos: t.pos }; }
    return a;
  }
  /** @returns {Ast} */
  function unary() {
    if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  /** @returns {Ast} */
  function power() {
    const a = atom();
    if (isOp('^')) { const t = toks[p++]; return { t: 'bin', op: '^', a, b: unary(), pos: t.pos }; }
    return a;
  }
  /** @returns {Ast} */
  function atom() {
    const t = peek();
    if (t.t === 'num') {
      p++;
      let v = Number(t.v), d = NONE, src = t.v;
      if (peek().t === 'unit') {
        const u = toks[p++];
        try { const pu = parseUnit(u.v); v = v * pu.f + (pu.off || 0); d = pu.d; } catch (e) { throw new ExprError(e instanceof UnitError ? e.message : String(e), u.pos); }
        src += u.v === '%' ? '%' : ` [${u.v}]`;
      }
      return { t: 'num', v, d, src };
    }
    if (t.t === 'name') {
      p++;
      if (t.v === 'true' || t.v === 'false') return { t: 'bool', v: t.v === 'true' };
      if (isOp('(')) {
        p++;
        /** @type {Ast[]} */
        const args = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
        expect(')');
        if (!FUNCTIONS.includes(t.v)) throw new ExprError(`There is no function "${t.v}"`, t.pos);
        return { t: 'call', f: t.v, args, pos: t.pos };
      }
      let name = t.v;
      while (isOp('.') && toks[p + 1]?.t === 'name') { p++; name += '.' + toks[p++].v; }
      return { t: 'name', name, pos: t.pos };
    }
    if (isOp('(')) {
      p++;
      const a = or();
      expect(')');
      if (peek().t === 'unit') throw new ExprError('A unit goes right after a number, as 3 [h]', peek().pos);
      return a;
    }
    if (t.t === 'end') throw new ExprError('The expression ends too soon', t.pos);
    throw new ExprError(`Unexpected "${t.v}"`, t.pos);
  }

  const ast = or();
  if (peek().t !== 'end') throw new ExprError(`Unexpected "${peek().v}"`, peek().pos);
  if (cache.size > 5000) cache.clear();
  cache.set(key, ast);
  return ast;
}

/** Every name an expression uses (paths kept whole). @param {Ast} a @param {Set<string>} [out] */
export function namesIn(a, out = new Set()) {
  if (a.t === 'name') { if (!(a.name in CONST)) out.add(a.name); }
  else if (a.t === 'call') a.args.forEach((x) => namesIn(x, out));
  else if (a.t === 'neg' || a.t === 'not') namesIn(a.a, out);
  else if (a.t === 'bin') { namesIn(a.a, out); namesIn(a.b, out); }
  return out;
}

/** Is this an equation (a = b)? @param {Ast} a @returns {a is { t: 'bin', op: string, a: Ast, b: Ast, pos: number }} */
export const isEquation = (a) => a.t === 'bin' && a.op === '=';
/** Is this a comparison or logic (true or false)? @param {Ast} a */
export const isTest = (a) => a.t === 'bool' || a.t === 'not' || (a.t === 'bin' && ['<', '<=', '>', '>=', '=', '!=', 'and', 'or'].includes(a.op));

/** @param {Val} v @param {Ast} at */
const num = (v, at) => { if (typeof v === 'boolean') throw new ExprError('Expected a number here, not true or false', 'pos' in at ? /** @type {any} */ (at).pos : -1); return v; };
/** @param {Val} v @param {Ast} at */
const bool = (v, at) => { if (typeof v !== 'boolean') throw new ExprError('Expected true or false here (a comparison)', 'pos' in at ? /** @type {any} */ (at).pos : -1); return v; };
/** @param {Dim} a @param {Dim} b @param {number} k */
const dimMul = (a, b, k = 1) => /** @type {Dim} */ (a.map((x, i) => x + k * b[i]));
/** @param {Dim} a @param {number} k */
const dimPow = (a, k) => /** @type {Dim} */ (a.map((x) => x * k));
/** A literal zero may be compared with or added to anything. @param {Ast} a */
const isZero = (a) => a.t === 'num' && a.v === 0;

/**
 * Evaluate. `lookup` gives a name's value (in SI) or undefined when it is unknown.
 * @param {Ast} a @param {(name: string) => Val | undefined} lookup @param {{ tol?: number }} [o]
 * @returns {Val}
 */
export function evaluate(a, lookup, o = {}) {
  /** @param {Ast} a @returns {Val} */
  const ev = (a) => {
    switch (a.t) {
      case 'num': return { v: a.v, d: a.d };
      case 'bool': return a.v;
      case 'name': {
        if (a.name in CONST) return CONST[a.name];
        const v = lookup(a.name);
        if (v === undefined) throw new ExprError(`Unknown name "${a.name}"`, a.pos);
        return v;
      }
      case 'neg': { const x = num(ev(a.a), a.a); return { v: -x.v, d: x.d }; }
      case 'not': return !bool(ev(a.a), a.a);
      case 'call': return call(a);
      case 'bin': {
        if (a.op === 'and') return bool(ev(a.a), a.a) && bool(ev(a.b), a.b);
        if (a.op === 'or') return bool(ev(a.a), a.a) || bool(ev(a.b), a.b);
        const xv = ev(a.a), yv = ev(a.b);
        if ((a.op === '=' || a.op === '!=') && typeof xv === 'boolean' && typeof yv === 'boolean') return a.op === '=' ? xv === yv : xv !== yv;
        const x = num(xv, a.a), y = num(yv, a.b);
        switch (a.op) {
          case '+': case '-': case '<': case '<=': case '>': case '>=': case '=': case '!=': {
            if (!sameDim(x.d, y.d) && !isZero(a.a) && !isZero(a.b)) throw new ExprError(`${a.op === '+' ? 'Adds' : a.op === '-' ? 'Subtracts' : 'Compares'} ${dimWords(x.d)} ${a.op === '+' ? 'and' : a.op === '-' ? 'and' : 'with'} ${dimWords(y.d)}${isNone(x.d) || isNone(y.d) ? ': add a unit to the number, as 3 [h]' : ''}`, a.pos);
            const d = isZero(a.a) ? y.d : x.d;
            if (a.op === '+') return { v: x.v + y.v, d };
            if (a.op === '-') return { v: x.v - y.v, d };
            const tol = (o.tol ?? 1e-9) * Math.max(1e-300, Math.abs(x.v), Math.abs(y.v));
            if (a.op === '<') return x.v < y.v - tol;
            if (a.op === '<=') return x.v <= y.v + tol;
            if (a.op === '>') return x.v > y.v + tol;
            if (a.op === '>=') return x.v >= y.v - tol;
            if (a.op === '=') return Math.abs(x.v - y.v) <= tol;
            return Math.abs(x.v - y.v) > tol;
          }
          case '*': return { v: x.v * y.v, d: dimMul(x.d, y.d, 1) };
          case '/': return { v: x.v / y.v, d: dimMul(x.d, y.d, -1) };
          case '^': {
            if (!isNone(y.d)) throw new ExprError(`A power must be a plain number, not ${dimWords(y.d)}`, a.pos);
            if (!isNone(x.d) && a.b.t !== 'num' && a.b.t !== 'neg') throw new ExprError('Raising a quantity with a unit to a power needs a fixed number as the power', a.pos);
            return { v: x.v ** y.v, d: dimPow(x.d, y.v) };
          }
        }
        throw new ExprError(`Unknown operator ${a.op}`, a.pos);
      }
    }
  };
  /** @param {{ t: 'call', f: string, args: Ast[], pos: number }} a @returns {Val} */
  const call = (a) => {
    const args = a.args.map((x) => num(ev(x), x));
    const need = (/** @type {number} */ n) => { if (args.length !== n) throw new ExprError(`${a.f}() takes ${n} value${n > 1 ? 's' : ''}`, a.pos); };
    const plain = (/** @type {Q} */ q) => { if (!isNone(q.d)) throw new ExprError(`${a.f}() needs a plain number, not ${dimWords(q.d)}`, a.pos); return q.v; };
    const f1 = FN1[a.f];
    if (f1) { need(1); return { v: f1(plain(args[0])), d: NONE }; }
    const k = KEEP[a.f];
    if (k) { need(1); return { v: k(args[0].v), d: args[0].d }; }
    switch (a.f) {
      case 'sqrt': need(1); return { v: Math.sqrt(args[0].v), d: dimPow(args[0].d, 0.5) };
      case 'cbrt': need(1); return { v: Math.cbrt(args[0].v), d: dimPow(args[0].d, 1 / 3) };
      case 'pow': {
        need(2);
        const n = plain(args[1]);
        return { v: args[0].v ** n, d: dimPow(args[0].d, n) };
      }
      case 'min': case 'max': case 'hypot': {
        if (!args.length) throw new ExprError(`${a.f}() needs at least one value`, a.pos);
        for (const q of args) if (!sameDim(q.d, args[0].d)) throw new ExprError(`${a.f}() mixes ${dimWords(args[0].d)} and ${dimWords(q.d)}`, a.pos);
        const vs = args.map((q) => q.v);
        return { v: a.f === 'min' ? Math.min(...vs) : a.f === 'max' ? Math.max(...vs) : Math.hypot(...vs), d: args[0].d };
      }
      case 'atan2': need(2); if (!sameDim(args[0].d, args[1].d)) throw new ExprError('atan2() needs two values of the same kind', a.pos); return { v: Math.atan2(args[0].v, args[1].v), d: NONE };
    }
    throw new ExprError(`There is no function "${a.f}"`, a.pos);
  };
  return ev(a);
}

/** @param {Dim} d */
const dimWords = (d) => { const n = dimName(d); return n === 'no unit' ? 'a plain number' : /^[a-z]/.test(n) ? `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}` : `a quantity in ${n}`; };

/** Print an expression back (used for messages). @param {Ast} a @returns {string} */
export function show(a) {
  switch (a.t) {
    case 'num': return a.src;
    case 'bool': return String(a.v);
    case 'name': return a.name;
    case 'neg': return `-${show(a.a)}`;
    case 'not': return `not ${show(a.a)}`;
    case 'call': return `${a.f}(${a.args.map(show).join(', ')})`;
    case 'bin': return `${show(a.a)} ${a.op} ${show(a.b)}`;
  }
}
