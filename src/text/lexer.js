// Tokens for Loom's SysML v2 text.
//
//   names        Battery, 'Battery Pack' (quoted names escape \' and \\)
//   short names  <'REQ-001'> or <REQ1>
//   strings      "text" (escapes \" \\ \n \t)
//   numbers      16, 3.74, -2e3
//   brackets     [Ah], [0..*]  (kept as raw text)
//   doc bodies   /* … */  (kept as text; Loom writes *\/ for a literal */)
//   symbols      { } ; : :> :: ~ = . , @ #
// Line notes (// …) are skipped.

/** @typedef {'name' | 'qname' | 'short' | 'string' | 'number' | 'bracket' | 'block' | 'sym' | 'eof'} TokType */
/** @typedef {{ t: TokType, v: string, line: number, col: number }} Token */

export class TextError extends Error {
  /** @param {string} message @param {number} line @param {number} col */
  constructor(message, line, col) { super(message); this.line = line; this.col = col; }
}

/** Words that must be quoted when used as names. */
export const KEYWORDS = new Set(['package', 'part', 'def', 'port', 'requirement', 'verification', 'action', 'attribute', 'connection', 'connect', 'to', 'view', 'doc', 'comment', 'satisfy', 'verify', 'refine', 'derive', 'copy', 'allocate', 'dependency', 'in', 'out', 'inout', 'true', 'false', 'self', 'about', 'import', 'private', 'public', 'abstract', 'ref', 'item', 'flow', 'of', 'from', 'by', 'specializes', 'subsets', 'metadata']);

const BASIC = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A name as written: bare when it can be, quoted otherwise. @param {string} name */
export function quoteName(name) {
  return BASIC.test(name) && !KEYWORDS.has(name) ? name : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
/** @param {string} s */
export const quoteString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')}"`;

/** @param {string} src @returns {Token[]} */
export function lex(src) {
  /** @type {Token[]} */
  const out = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const adv = (/** @type {number} */ k) => { for (let j = 0; j < k; j++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  /** Read a quoted run ending at `q`, handling backslash escapes. @param {string} q @param {Record<string, string>} esc */
  const quoted = (q, esc) => {
    const l0 = line, c0 = col;
    adv(1);
    let v = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\' && i + 1 < n) { v += esc[src[i + 1]] ?? src[i + 1]; adv(2); continue; }
      if (src[i] === '\n' && q !== '/') throw new TextError(`This ${q === '"' ? 'string' : 'name'} is not closed before the end of the line`, l0, c0);
      v += src[i]; adv(1);
    }
    if (i >= n) throw new TextError(`This ${q === '"' ? 'string' : 'name'} is never closed`, l0, c0);
    adv(1);
    return v;
  };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(1); continue; }
    const l0 = line, c0 = col;
    const push = (/** @type {TokType} */ t, /** @type {string} */ v) => out.push({ t, v, line: l0, col: c0 });
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(1); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new TextError('This /* … */ text is never closed', l0, c0);
      const body = src.slice(i + 2, end);
      adv(end + 2 - i);
      push('block', body);
      continue;
    }
    if (c === "'") { push('qname', quoted("'", { "'": "'", '\\': '\\' })); continue; }
    if (c === '"') { push('string', quoted('"', { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' })); continue; }
    if (c === '<') {
      adv(1);
      let v;
      if (src[i] === "'") v = quoted("'", { "'": "'", '\\': '\\' });
      else { const m = /^[A-Za-z0-9_.\-]+/.exec(src.slice(i, i + 200)); if (!m) throw new TextError('Expected a short name after <', l0, c0); v = m[0]; adv(v.length); }
      if (src[i] !== '>') throw new TextError('Expected > to close the short name', line, col);
      adv(1);
      push('short', v);
      continue;
    }
    if (c === '[') {
      const end = src.indexOf(']', i);
      const nl = src.indexOf('\n', i);
      if (end < 0 || (nl >= 0 && nl < end)) throw new TextError('This [ … ] is not closed on the same line', l0, c0);
      push('bracket', src.slice(i + 1, end));
      adv(end + 1 - i);
      continue;
    }
    const num = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i, i + 64));
    if (num && (/\d/.test(c) || (c === '-' && /[\d.]/.test(src[i + 1] || '')))) { push('number', num[0]); adv(num[0].length); continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (word) { push('name', word[0]); adv(word[0].length); continue; }
    const two = src.slice(i, i + 2);
    if (two === ':>' || two === '::') { push('sym', two); adv(2); continue; }
    if ('{};:~=.,@#'.includes(c)) { push('sym', c); adv(1); continue; }
    throw new TextError(`Unexpected character "${c}"`, l0, c0);
  }
  out.push({ t: 'eof', v: '', line, col });
  return out;
}

/**
 * Doc text as written in a /* … *\/ body, and back. One line stays on one line; several
 * lines get a leading " * " each.
 * @param {string} text
 */
export function docBody(text) {
  const safe = text.replace(/\*\//g, '*\\/');
  if (!safe.includes('\n')) return `/* ${safe} */`;
  return `/*\n${safe.split('\n').map((l) => ` * ${l}`).join('\n')}\n */`;
}
/** @param {string} body the text between /* and *\/ */
export function docText(body) {
  let t;
  if (body.startsWith('\n')) {
    const lines = body.slice(1).split('\n');
    if (lines.length && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
    t = lines.map((l) => l.replace(/^\s*\* ?/, '')).join('\n');
  } else {
    t = body.replace(/^ /, '').replace(/ $/, '');
  }
  return t.replace(/\*\\\//g, '*/');
}
