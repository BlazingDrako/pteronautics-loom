// Find and replace across the model: names, requirement text, descriptions and the other text
// properties. Pure functions: `findMatches` lists every place a search hits (with the text
// before and after), `applyReplace` writes the chosen ones in a transaction (one undo step).
import { ELEMENTS, isRel } from './metamodel.js';

/** @typedef {import('./model.js').Model} Model */

/** Where to look. */
export const SCOPES = /** @type {const} */ ([
  { id: 'name', label: 'Names' },
  { id: 'text', label: 'Requirement text' },
  { id: 'doc', label: 'Descriptions and rationale' },
  { id: 'other', label: 'Other text (IDs, values, item flows, checks)' },
]);
/** @typedef {typeof SCOPES[number]['id']} Scope */

/**
 * @typedef {{ id: string, field: string, scope: Scope, before: string, after: string, count: number }} Match
 * field: 'name' or a property's key
 */

/** Escape text for use in a regular expression. @param {string} s */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The regular expression for a search, or an error message.
 * @param {string} find @param {{ matchCase?: boolean, wholeWord?: boolean, regex?: boolean }} o
 * @returns {RegExp | string}
 */
export function searchRegex(find, o = {}) {
  if (!find) return 'Type what to find';
  let src = o.regex ? find : escRe(find);
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    const re = new RegExp(src, `gu${o.matchCase ? '' : 'i'}`);
    if (re.test('')) return 'That pattern matches nothing at all; make it match at least one character';
    return re;
  } catch (e) { return `Not a valid pattern: ${e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : e}`; }
}

/** Which scope a property belongs to. @param {string} key @param {string} kind */
function scopeOf(key, kind) {
  if (key === 'text' && kind === 'requirement') return 'text';
  if (key === 'doc') return 'doc';
  return 'other';
}

/**
 * Every place the search hits.
 * @param {Model} m @param {string} find @param {string} replace
 * @param {{ matchCase?: boolean, wholeWord?: boolean, regex?: boolean, scopes?: Scope[], within?: string | null }} [o]
 *   within: only inside this element (a package, say)
 * @returns {{ matches: Match[], error?: string }}
 */
export function findMatches(m, find, replace, o = {}) {
  const re = searchRegex(find, o);
  if (typeof re === 'string') return { matches: [], error: re };
  const scopes = new Set(o.scopes || SCOPES.map((s) => s.id));
  /** @type {Match[]} */
  const matches = [];
  const inside = (/** @type {string} */ id) => { if (!o.within) return true; for (let e = m.get(id); e; e = e.owner ? m.get(e.owner) : undefined) if (e.id === o.within) return true; return false; };
  const sub = (/** @type {string} */ text) => {
    re.lastIndex = 0;
    let count = 0;
    // with a pattern, $1 and $& work in the replacement; plain text is taken as it is
    const after = text.replace(re, (...args) => { count++; return o.regex ? expand(replace, args) : o.matchCase ? replace : keepCase(args[0], replace); });
    return { after, count };
  };
  for (const e of m.all()) {
    if (!e.owner || isRel(e.kind) || !inside(e.id)) continue;
    if (scopes.has('name') && e.name) {
      const r = sub(e.name);
      if (r.count) matches.push({ id: e.id, field: 'name', scope: 'name', before: e.name, after: r.after, count: r.count });
    }
    const spec = ELEMENTS[e.kind]?.props || {};
    for (const [k, p] of Object.entries(spec)) {
      if ((p.type !== 'text' && p.type !== 'longtext') || /** @type {any} */ (p).hidden) continue;
      const sc = scopeOf(k, e.kind);
      if (!scopes.has(sc)) continue;
      const v = e.props[k];
      if (typeof v !== 'string' || !v) continue;
      const r = sub(v);
      if (r.count) matches.push({ id: e.id, field: k, scope: sc, before: v, after: r.after, count: r.count });
    }
  }
  return { matches };
}

/**
 * When case is ignored, the replacement takes the case of what it replaces: Battery → Power cell,
 * BATTERY → POWER CELL, battery → power cell (a replacement with capitals of its own, like UAS,
 * is kept as typed when the match is lower case).
 * @param {string} hit @param {string} rep
 */
export function keepCase(hit, rep) {
  const letters = hit.replace(/[^\p{L}]/gu, '');
  if (!letters) return rep;
  if (letters.length > 1 && letters === letters.toUpperCase()) return rep.toUpperCase();
  if (letters[0] === letters[0].toUpperCase() && letters.slice(1) === letters.slice(1).toLowerCase()) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
}

/** $1, $2, $& and $$ in a replacement, from String.replace's callback arguments. @param {string} rep @param {any[]} args */
function expand(rep, args) {
  const groupsAt = args.findIndex((a) => typeof a === 'number');
  const groups = args.slice(1, groupsAt);
  return rep.replace(/\$(\$|&|\d{1,2})/g, (_, g) => (g === '$' ? '$' : g === '&' ? args[0] : groups[Number(g) - 1] ?? ''));
}

/**
 * Write the matches (all, or those whose index is in `only`). Names that would end up empty
 * are skipped. Returns how many places changed.
 * @param {any} tx @param {Match[]} matches @param {Set<number>} [only]
 */
export function applyReplace(tx, matches, only) {
  let n = 0;
  matches.forEach((mt, i) => {
    if (only && !only.has(i)) return;
    if (mt.field === 'name') { if (!mt.after.trim()) return; tx.rename(mt.id, mt.after); }
    else tx.setProps(mt.id, { [mt.field]: mt.after });
    n += mt.count;
  });
  return n;
}
