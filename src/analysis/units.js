// Units of measure. Every unit is a factor to SI and a dimension (powers of the seven SI base
// quantities), so values convert exactly and the solver can check that equations make sense
// ("adds hours to kilograms" is caught before anything is computed).
//
// Unit text is what engineers write: "Ah", "km/h", "m/s^2", "kg·m²", "W/kg", "°C", "%".
// Prefixes work on SI units (mAh, kW, µs, GHz). Temperatures with an offset (°C, °F) convert
// on their own but cannot be multiplied with other units.

/** Powers of length, mass, time, current, temperature, amount, luminous intensity. */
/** @typedef {[number, number, number, number, number, number, number]} Dim */
/** @typedef {{ f: number, d: Dim, off?: number }} Unit  value_SI = value * f + off */

export class UnitError extends Error {}

/** @type {Dim} */
export const NONE = [0, 0, 0, 0, 0, 0, 0];
const D = (/** @type {number[]} */ ...p) => /** @type {Dim} */ ([0, 1, 2, 3, 4, 5, 6].map((i) => p[i] || 0));

const PI = Math.PI;
/** Units that take SI prefixes. @type {Record<string, Unit>} */
const PREFIXABLE = {
  m: { f: 1, d: D(1) }, g: { f: 1e-3, d: D(0, 1) }, s: { f: 1, d: D(0, 0, 1) }, A: { f: 1, d: D(0, 0, 0, 1) },
  K: { f: 1, d: D(0, 0, 0, 0, 1) }, mol: { f: 1, d: D(0, 0, 0, 0, 0, 1) }, cd: { f: 1, d: D(0, 0, 0, 0, 0, 0, 1) },
  N: { f: 1, d: D(1, 1, -2) }, J: { f: 1, d: D(2, 1, -2) }, W: { f: 1, d: D(2, 1, -3) }, Pa: { f: 1, d: D(-1, 1, -2) },
  Hz: { f: 1, d: D(0, 0, -1) }, C: { f: 1, d: D(0, 0, 1, 1) }, V: { f: 1, d: D(2, 1, -3, -1) }, Ω: { f: 1, d: D(2, 1, -3, -2) },
  ohm: { f: 1, d: D(2, 1, -3, -2) }, F: { f: 1, d: D(-2, -1, 4, 2) }, H: { f: 1, d: D(2, 1, -2, -2) }, Wb: { f: 1, d: D(2, 1, -2, -1) },
  T: { f: 1, d: D(0, 1, -2, -1) }, S: { f: 1, d: D(-2, -1, 3, 2) }, L: { f: 1e-3, d: D(3) }, l: { f: 1e-3, d: D(3) },
  Wh: { f: 3600, d: D(2, 1, -3 + 1) }, Ah: { f: 3600, d: D(0, 0, 1, 1) }, VA: { f: 1, d: D(2, 1, -3) }, eV: { f: 1.602176634e-19, d: D(2, 1, -2) },
  bar: { f: 1e5, d: D(-1, 1, -2) }, rad: { f: 1, d: NONE }, sr: { f: 1, d: NONE }, t: { f: 1000, d: D(0, 1) },
  B: { f: 8, d: NONE }, bit: { f: 1, d: NONE },
};
/** Units without prefixes. @type {Record<string, Unit>} */
const PLAIN = {
  min: { f: 60, d: D(0, 0, 1) }, h: { f: 3600, d: D(0, 0, 1) }, hr: { f: 3600, d: D(0, 0, 1) }, d: { f: 86400, d: D(0, 0, 1) },
  day: { f: 86400, d: D(0, 0, 1) }, yr: { f: 31557600, d: D(0, 0, 1) },
  deg: { f: PI / 180, d: NONE }, '°': { f: PI / 180, d: NONE }, rev: { f: 2 * PI, d: NONE }, rpm: { f: 2 * PI / 60, d: D(0, 0, -1) },
  '%': { f: 0.01, d: NONE }, ppm: { f: 1e-6, d: NONE }, one: { f: 1, d: NONE }, '1': { f: 1, d: NONE },
  ft: { f: 0.3048, d: D(1) }, in: { f: 0.0254, d: D(1) }, yd: { f: 0.9144, d: D(1) }, mi: { f: 1609.344, d: D(1) },
  nmi: { f: 1852, d: D(1) }, NM: { f: 1852, d: D(1) }, kn: { f: 1852 / 3600, d: D(1, 0, -1) }, kt: { f: 1852 / 3600, d: D(1, 0, -1) },
  mph: { f: 0.44704, d: D(1, 0, -1) }, lb: { f: 0.45359237, d: D(0, 1) }, lbm: { f: 0.45359237, d: D(0, 1) }, oz: { f: 0.028349523125, d: D(0, 1) },
  slug: { f: 14.593903, d: D(0, 1) }, lbf: { f: 4.4482216152605, d: D(1, 1, -2) }, psi: { f: 6894.757293168, d: D(-1, 1, -2) },
  atm: { f: 101325, d: D(-1, 1, -2) }, hp: { f: 745.69987158227, d: D(2, 1, -3) }, cal: { f: 4.184, d: D(2, 1, -2) },
  kcal: { f: 4184, d: D(2, 1, -2) }, BTU: { f: 1055.05585262, d: D(2, 1, -2) }, gal: { f: 3.785411784e-3, d: D(3) },
  g0: { f: 9.80665, d: D(1, 0, -2) }, gn: { f: 9.80665, d: D(1, 0, -2) },
  '°C': { f: 1, d: D(0, 0, 0, 0, 1), off: 273.15 }, degC: { f: 1, d: D(0, 0, 0, 0, 1), off: 273.15 },
  '°F': { f: 5 / 9, d: D(0, 0, 0, 0, 1), off: 273.15 - 32 * 5 / 9 }, degF: { f: 5 / 9, d: D(0, 0, 0, 0, 1), off: 273.15 - 32 * 5 / 9 },
  '°R': { f: 5 / 9, d: D(0, 0, 0, 0, 1) },
};
const PREFIX = /** @type {Record<string, number>} */ ({ Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 10, d: 0.1, c: 0.01, m: 1e-3, µ: 1e-6, μ: 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 });
const SUPER = /** @type {Record<string, string>} */ ({ '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' });

/** One unit symbol, with or without a prefix. @param {string} sym @returns {Unit | null} */
function atom(sym) {
  if (PLAIN[sym]) return PLAIN[sym];
  if (PREFIXABLE[sym]) return PREFIXABLE[sym];
  for (const p of ['da', ...Object.keys(PREFIX)]) {
    if (sym.length > p.length && sym.startsWith(p)) {
      const base = PREFIXABLE[sym.slice(p.length)];
      if (base) return { f: base.f * PREFIX[p], d: base.d };
    }
  }
  return null;
}

/** @type {Map<string, Unit>} */
const cache = new Map();

/**
 * Parse unit text. An empty unit is dimensionless.
 * @param {string} text @returns {Unit}
 */
export function parseUnit(text) {
  const src = String(text ?? '').trim();
  const hit = cache.get(src);
  if (hit) return hit;
  const u = parseUncached(src);
  if (cache.size > 2000) cache.clear();
  cache.set(src, u);
  return u;
}

/** @param {string} src @returns {Unit} */
function parseUncached(src) {
  if (!src) return { f: 1, d: NONE };
  const whole = atom(src);
  if (whole) return whole;
  // tokens: names (with ° µ Ω %), numbers, operators, superscripts
  const s = src.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^' + [...m].map((c) => SUPER[c]).join('')).replace(/\*\*/g, '^');
  const toks = s.match(/[A-Za-z°µμΩ%][A-Za-z°µμΩ%0-9]*|\d+(\.\d+)?|\^-?\d+(\.\d+)?|[*/·.()]|\s+|./g) || [];
  let f = 1, off = 0;
  /** @type {number[]} */
  let d = [...NONE];
  let sign = 1, used = 0;
  // a/b/c divides by b and c; parentheses are kept simple: "/(m·s)" divides by both
  let paren = 0, parenSign = 1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\s+$/.test(t) || t === '*' || t === '·' || t === '.') continue;
    if (t === '/') { sign = -1; continue; }
    if (t === '(') { paren++; parenSign = sign; continue; }
    if (t === ')') { paren = Math.max(0, paren - 1); sign = 1; continue; }
    let u;
    if (/^\d/.test(t)) { if (t !== '1') throw new UnitError(`"${src}" is not a unit I know`); u = { f: 1, d: NONE }; }
    else u = atom(t);
    let pow = 1;
    // "m2", "km2": a trailing number is a power
    const tail = !u ? t.match(/^(.*?[^0-9])(\d)$/) : null;
    if (tail && atom(tail[1])) { u = atom(tail[1]); pow = Number(tail[2]); }
    if (!u) throw new UnitError(`"${t}" is not a unit I know`);
    if (toks[i + 1]?.startsWith('^')) { pow *= Number(toks[++i].slice(1)); }
    if (u.off && toks.length > 1) throw new UnitError(`${t} has an offset, so it cannot be combined with other units (use K)`);
    const sg = paren ? parenSign : sign;
    f *= u.f ** (pow * sg);
    for (let k = 0; k < 7; k++) d[k] += u.d[k] * pow * sg;
    if (u.off) off = u.off;
    used++;
    if (!paren) sign = 1;
  }
  if (!used) throw new UnitError(`"${src}" is not a unit I know`);
  return { f, d: /** @type {Dim} */ (d.map((x) => Math.round(x * 1e6) / 1e6)), ...(off ? { off } : {}) };
}

/** Is this text a unit Loom understands? @param {string} text */
export function isUnit(text) { try { parseUnit(text); return true; } catch { return false; } }

/** @param {Dim} a @param {Dim} b */
export const sameDim = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
/** @param {Dim} a */
export const isNone = (a) => sameDim(a, NONE);

/** A value in a unit, in SI. @param {number} v @param {string} unit */
export function toSI(v, unit) { const u = parseUnit(unit); return v * u.f + (u.off || 0); }
/** An SI value in a unit. @param {number} v @param {string} unit */
export function fromSI(v, unit) { const u = parseUnit(unit); return (v - (u.off || 0)) / u.f; }

/**
 * Convert between units of the same kind. Throws if they measure different things.
 * @param {number} v @param {string} from @param {string} to
 */
export function convert(v, from, to) {
  const a = parseUnit(from), b = parseUnit(to);
  if (!sameDim(a.d, b.d)) throw new UnitError(`Cannot convert ${from || 'a plain number'} (${dimName(a.d)}) to ${to || 'a plain number'} (${dimName(b.d)})`);
  return fromSI(toSI(v, from), to);
}

/** Names for common dimensions. */
const NAMED = /** @type {[Dim, string][]} */ ([
  [D(1), 'length'], [D(0, 1), 'mass'], [D(0, 0, 1), 'time'], [D(0, 0, 0, 1), 'current'], [D(0, 0, 0, 0, 1), 'temperature'],
  [D(2), 'area'], [D(3), 'volume'], [D(1, 0, -1), 'speed'], [D(1, 0, -2), 'acceleration'], [D(1, 1, -2), 'force'],
  [D(2, 1, -2), 'energy'], [D(2, 1, -3), 'power'], [D(-1, 1, -2), 'pressure'], [D(0, 0, -1), 'frequency'],
  [D(0, 0, 1, 1), 'charge'], [D(2, 1, -3, -1), 'voltage'], [D(2, 1, -3, -2), 'resistance'], [D(-3, 1), 'density'],
  [D(2, 0, -3), 'specific power'], [D(2, 0, -2), 'specific energy'], [D(0, 1, -1), 'mass flow'], [D(1, 1, -1), 'momentum'],
  [D(2, 1, -1), 'angular momentum'], [D(0, 0, 0, 0, 0, 1), 'amount'], [D(0, 0, 0, 0, 0, 0, 1), 'luminous intensity'],
]);
const BASE = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'];
/** A readable name for a dimension: "energy", or "kg·m²/s³" when it has no name. @param {Dim} d */
export function dimName(d) {
  if (isNone(d)) return 'no unit';
  const n = NAMED.find(([x]) => sameDim(x, d));
  if (n) return n[1];
  return siText(d);
}
/** The SI unit text for a dimension. @param {Dim} d */
export function siText(d) {
  const sup = (/** @type {number} */ p) => (p === 1 ? '' : String(p).replace(/[-0-9]/g, (c) => ({ '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' })[/** @type {'0'} */ (c)] || c));
  const order = [1, 0, 2, 3, 4, 5, 6];
  const num = order.filter((i) => d[i] > 0).map((i) => BASE[i] + sup(d[i]));
  const den = order.filter((i) => d[i] < 0).map((i) => BASE[i] + sup(-d[i]));
  return (num.join('·') || '1') + (den.length ? '/' + den.join('·') : '');
}

/**
 * A number for people: up to `sig` significant figures, no trailing zeros, no exponent for
 * everyday sizes.
 * @param {number} v @param {number} [sig]
 */
export function formatNumber(v, sig = 4) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '—' : v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(sig - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return String(Number(v.toFixed(Math.min(12, digits))));
}

/**
 * Read "16", "3.5 h", "48 V", "1.2e3 W" into a number and a unit.
 * @param {string} text @returns {{ value: number, unit: string } | null}
 */
export function parseQuantity(text) {
  const m = String(text ?? '').trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:\[(.*)\]|(.*))$/);
  if (!m) return null;
  const unit = (m[2] ?? m[3] ?? '').trim();
  if (unit && !isUnit(unit)) return null;
  return { value: Number(m[1]), unit };
}
