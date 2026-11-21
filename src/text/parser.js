// A recursive-descent parser for Loom's SysML v2 text. It produces a plain tree (no model
// ids, no resolved references); build.js turns that into model elements.
//
// The subset (see docs in README):
//   package Name { … }
//   requirement <'REQ-001'> Name { doc /* text */ … }          a requirement (text is its doc)
//   verification def Name { verify Req; }                      a test case
//   action def Name { … }                                      a function
//   part def Name :> General { … }                             a block
//   port def Name { … }                                        an interface block
//   part name : Type [mult];                                   a part property
//   in|out port name : ~Type;                                  a port (~ = conjugated)
//   attribute name = 16 [Ah];                                  a value property (attribute name : Type = 16 [Ah];)
//   attribute def Energy { @Loom { unit = "Wh"; } }           a value type
//   constraint def Endurance { attribute t [h]; … @Loom { expr = "t = E / P"; } }
//   constraint range : Endurance;  bind range.E = battery.usableEnergy;   a constraint property and a binding
//   connection Name connect a.p to b.q;   connect a.p to b.q;  a connector
//   view Name { @Loom { kind = "bdd"; } }                      a diagram, table or matrix
//   comment Name /* text */                                    a note
//   doc /* text */                                             the owner's description
//   @Loom { key = "value"; flag = true; }                      Loom properties
//   library package Name { metadata def S { attribute tag; } } a profile and its stereotypes
//   @S;   @S { tag = "value"; }                                a stereotype applied, with tagged values
//   satisfy R;  verify R;  refine R;  derive R;  copy R;  allocate to X;  dependency to X;
//   include U;  extend U;  participate in U;  import P::*;
// Behavior:
//   start S;  done F;  terminate T;  decide D;  merge M;  fork F;  join J;   control nodes
//   succession first A then B;   flow from A to B;                         control / object flows
//   state S { … }   region R { … }
//   transition first A accept "trigger" if "guard" do "effect" then B;
//   interaction I { lifeline a : Part; message 'call()' from a to b; fragment F { operand O { … } } }
//   actor A;   use case U { include V; }
import { lex, TextError, docText } from './lexer.js';

/** @typedef {import('./lexer.js').Token} Token */
/** @typedef {{ parts: string[], line: number, col: number }} Ref */
/** @typedef {{ segs: string[], line: number, col: number }} EndPath */
/**
 * @typedef {{
 *   kind: string, name: string, short?: string, line: number, col: number, endLine: number,
 *   type?: Ref & { conj: boolean }, mult?: string, spec: Ref[],
 *   direction?: string, value?: string, unit?: string,
 *   end1?: EndPath, end2?: EndPath,
 *   refs?: Record<string, Ref>,          // references by property: from, to, represents
 *   fields?: Record<string, string>,     // values written in the declaration: nodeKind, flowKind, trigger…
 *   doc?: string, meta: { key: string, value: string | boolean, line: number, col: number }[],
 *   applied?: { ref: Ref, tags: { key: string, value: string, line: number, col: number }[] }[],  metadata usages: @Critical { dal = "B"; }
 *   children: Node[], rels: { kind: string, ref: Ref, line: number }[],
 * }} Node
 */

export { TextError };

/**
 * Parse text into top-level nodes. Throws TextError (with line and column) on the first problem.
 * @param {string} src @returns {Node[]}
 */
export function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const next = () => toks[p++];
  /** @param {Token} t @param {string} msg */
  const fail = (t, msg) => { throw new TextError(msg, t.line, t.col); };
  const isSym = (/** @type {string} */ v, k = 0) => peek(k).t === 'sym' && peek(k).v === v;
  const isWord = (/** @type {string} */ v, k = 0) => peek(k).t === 'name' && peek(k).v === v;
  /** @param {string} v */
  const sym = (v) => { if (!isSym(v)) fail(peek(), `Expected "${v}" but found ${desc(peek())}`); return next(); };
  /** @param {string} v */
  const word = (v) => { if (!isWord(v)) fail(peek(), `Expected "${v}" but found ${desc(peek())}`); return next(); };
  const isNameTok = (k = 0) => peek(k).t === 'name' || peek(k).t === 'qname';
  /** @param {string} what */
  const name = (what) => { if (!isNameTok()) fail(peek(), `Expected ${what} but found ${desc(peek())}`); return next().v; };

  /** @returns {Ref} */
  function ref() {
    const t = peek();
    const parts = [name('a name')];
    while (isSym('::') && !isSym('*', 1)) { next(); parts.push(name('a name after ::')); }
    return { parts, line: t.line, col: t.col };
  }
  /** @returns {EndPath} */
  function endPath() {
    const t = peek();
    const segs = [name('a part or port name')];
    while (isSym('.')) { next(); segs.push(name('a part or port name after "."')); }
    return { segs, line: t.line, col: t.col };
  }

  /** @param {string} kind @param {Token} start @returns {Node} */
  const node = (kind, start) => ({ kind, name: '', line: start.line, col: start.col, endLine: start.line, spec: [], meta: [], children: [], rels: [] });

  /** Body or ";". @param {Node} n */
  function bodyOrEnd(n) {
    if (isSym(';')) { n.endLine = next().line; return; }
    if (!isSym('{')) fail(peek(), `Expected "{" or ";" but found ${desc(peek())}`);
    next();
    items(n);
    n.endLine = sym('}').line;
  }

  /** Optional ":> A, B". @param {Node} n */
  function specs(n) {
    if (!isSym(':>')) return;
    next();
    n.spec.push(ref());
    while (isSym(',')) { next(); n.spec.push(ref()); }
  }

  /** Read items into `parent` until "}" or the end. @param {Node | null} parent @param {Node[]} [top] */
  function items(parent, top) {
    for (;;) {
      const t = peek();
      if (t.t === 'eof' || isSym('}')) return;
      if (isSym(';')) { next(); continue; }
      const n = item(parent);
      if (n) (parent ? parent.children : /** @type {Node[]} */ (top)).push(n);
    }
  }

  /** @param {Node | null} parent @returns {Node | null} */
  function item(parent) {
    const t = peek();
    const needParent = (/** @type {string} */ what) => { if (!parent) fail(t, `${what} must be inside an element`); return /** @type {Node} */ (parent); };
    if (isSym('@')) {
      const owner = needParent('Metadata');
      next();
      const mt = peek();
      const r = ref();
      if (r.parts.length !== 1 || r.parts[0] !== 'Loom' || mt.t === 'qname') {
        // a stereotype applied to the owner, maybe with tagged values
        /** @type {{ key: string, value: string, line: number, col: number }[]} */
        const tags = [];
        if (isSym('{')) {
          next();
          while (!isSym('}')) {
            const kt = peek();
            const key = name('a tag name');
            sym('=');
            const vt = next();
            if (vt.t !== 'string' && vt.t !== 'number' && !(vt.t === 'name' && (vt.v === 'true' || vt.v === 'false'))) fail(vt, `Expected a value ("text" or a number) for ${key}`);
            tags.push({ key, value: vt.v, line: kt.line, col: kt.col });
            sym(';');
          }
          next();
        } else sym(';');
        (owner.applied || (owner.applied = [])).push({ ref: r, tags });
        return null;
      }
      sym('{');
      while (!isSym('}')) {
        const kt = peek();
        const key = name('a property name');
        sym('=');
        const vt = next();
        /** @type {string | boolean} */
        let value;
        if (vt.t === 'string' || vt.t === 'number') value = vt.v;
        else if (vt.t === 'name' && (vt.v === 'true' || vt.v === 'false')) value = vt.v === 'true';
        else fail(vt, `Expected a value ("text", a number, true or false) for ${key}`);
        owner.meta.push({ key, value: /** @type {any} */ (value), line: kt.line, col: kt.col });
        sym(';');
      }
      next();
      return null;
    }
    if (t.t !== 'name') fail(t, `Expected an element or a statement but found ${desc(t)}`);
    switch (t.v) {
      case 'doc': {
        const owner = needParent('doc');
        next();
        if (peek().t !== 'block') fail(peek(), 'Expected /* text */ after doc');
        owner.doc = docText(next().v);
        return null;
      }
      case 'satisfy': case 'verify': case 'refine': case 'derive': case 'copy': {
        const owner = needParent(t.v);
        next();
        owner.rels.push({ kind: t.v, ref: ref(), line: t.line });
        sym(';');
        return null;
      }
      case 'include': case 'extend': {
        const owner = needParent(t.v);
        next();
        owner.rels.push({ kind: t.v, ref: ref(), line: t.line });
        sym(';');
        return null;
      }
      case 'participate': {
        const owner = needParent(t.v);
        next(); word('in');
        owner.rels.push({ kind: 'participate', ref: ref(), line: t.line });
        sym(';');
        return null;
      }
      case 'import': {
        const owner = needParent(t.v);
        next();
        const r = ref();
        // "::*" (every member) is how imports are written; Loom imports whole packages
        if (isSym('::')) { next(); sym('*'); }
        else if (isSym('*')) next();
        owner.rels.push({ kind: 'import', ref: r, line: t.line });
        sym(';');
        return null;
      }
      case 'start': case 'done': case 'terminate': case 'decide': case 'merge': case 'fork': case 'join': {
        next();
        const n = node('controlNode', t);
        n.fields = { nodeKind: /** @type {Record<string, string>} */ ({ start: 'initial', done: 'final', terminate: 'flowFinal', decide: 'decision', merge: 'merge', fork: 'fork', join: 'join' })[t.v] };
        if (isNameTok()) n.name = next().v;
        bodyOrEnd(n);
        return n;
      }
      case 'succession': case 'flow': {
        next();
        const n = node('flow', t);
        const first = t.v === 'succession' ? 'first' : 'from', then = t.v === 'succession' ? 'then' : 'to';
        if (!isWord(first)) n.name = name('a name');
        word(first);
        const from = ref();
        word(then);
        n.refs = { from, to: ref() };
        n.fields = { flowKind: t.v === 'succession' ? 'control' : 'object' };
        bodyOrEnd(n);
        return n;
      }
      case 'transition': {
        next();
        const n = node('transition', t);
        if (!isWord('first')) n.name = name('a name');
        word('first');
        const from = ref();
        /** @type {Record<string, string>} */
        const f = {};
        for (const [kw, key] of [['accept', 'trigger'], ['if', 'guard'], ['do', 'effect']]) {
          if (!isWord(kw)) continue;
          next();
          const v = next();
          if (v.t !== 'string') fail(v, `Expected "text" after ${kw}`);
          f[key] = v.v;
        }
        word('then');
        n.refs = { from, to: ref() };
        n.fields = f;
        bodyOrEnd(n);
        return n;
      }
      case 'state': case 'region': case 'interaction': case 'fragment': case 'operand': case 'actor': {
        next();
        const n = node(t.v === 'actor' ? 'actor' : t.v, t);
        n.name = name(`a ${t.v} name`);
        bodyOrEnd(n);
        return n;
      }
      case 'use': {
        next(); word('case');
        const n = node('useCase', t);
        n.name = name('a use case name');
        bodyOrEnd(n);
        return n;
      }
      case 'lifeline': {
        next();
        const n = node('lifeline', t);
        n.name = name('a lifeline name');
        if (isSym(':')) { next(); n.refs = { represents: ref() }; }
        bodyOrEnd(n);
        return n;
      }
      case 'message': {
        next();
        const n = node('message', t);
        n.name = name('a message name');
        word('from');
        const from = ref();
        word('to');
        n.refs = { from, to: ref() };
        bodyOrEnd(n);
        return n;
      }
      case 'allocate': case 'dependency': {
        const owner = needParent(t.v);
        next();
        if (isWord('self')) next();
        word('to');
        owner.rels.push({ kind: t.v === 'allocate' ? 'allocate' : 'trace', ref: ref(), line: t.line });
        sym(';');
        return null;
      }
      case 'package': {
        next();
        const n = node('package', t);
        n.name = name('a package name');
        bodyOrEnd(n);
        return n;
      }
      case 'library': {
        next(); word('package');
        const n = node('profile', t);
        n.name = name('a profile name');
        bodyOrEnd(n);
        return n;
      }
      case 'metadata': {
        next(); word('def');
        const n = node('stereotype', t);
        n.name = name('a stereotype name');
        specs(n);
        bodyOrEnd(n);
        return n;
      }
      case 'requirement': {
        next();
        const n = node('requirement', t);
        if (peek().t === 'short') n.short = next().v;
        if (isNameTok()) n.name = next().v;
        specs(n);
        bodyOrEnd(n);
        return n;
      }
      case 'verification': case 'action': {
        next(); word('def');
        const n = node(t.v === 'action' ? 'action' : 'testCase', t);
        n.name = name('a name');
        specs(n);
        bodyOrEnd(n);
        return n;
      }
      case 'part': {
        next();
        if (isWord('def')) {
          next();
          const n = node('partDef', t);
          n.name = name('a block name');
          specs(n);
          bodyOrEnd(n);
          return n;
        }
        const n = node('part', t);
        n.name = name('a part name');
        if (isSym(':')) { next(); n.type = { ...ref(), conj: false }; }
        if (peek().t === 'bracket') n.mult = next().v.trim();
        bodyOrEnd(n);
        return n;
      }
      case 'in': case 'out': case 'inout': case 'port': {
        let direction = 'inout';
        if (t.v !== 'port') { direction = next().v; if (!isWord('port')) fail(peek(), `Expected "port" after ${direction}`); }
        next();
        if (isWord('def')) {
          if (direction !== 'inout' || t.v !== 'port') fail(t, 'A port def has no direction');
          next();
          const n = node('interfaceDef', t);
          n.name = name('an interface name');
          specs(n);
          bodyOrEnd(n);
          return n;
        }
        const n = node('port', t);
        n.direction = direction;
        n.name = name('a port name');
        if (isSym(':')) {
          next();
          const conj = isSym('~');
          if (conj) next();
          n.type = { ...ref(), conj };
        }
        bodyOrEnd(n);
        return n;
      }
      case 'attribute': {
        next();
        if (isWord('def')) {
          next();
          const n = node('valueType', t);
          n.name = name('a value type name');
          specs(n);
          bodyOrEnd(n);
          return n;
        }
        const n = node('attribute', t);
        n.name = name('an attribute name');
        if (isSym(':')) { next(); n.type = { ...ref(), conj: false }; }
        if (isSym('=')) {
          next();
          const vt = next();
          if (vt.t !== 'number' && vt.t !== 'string') fail(vt, 'Expected a number or "text" after =');
          n.value = vt.v;
        }
        if (peek().t === 'bracket') n.unit = next().v.trim();
        bodyOrEnd(n);
        return n;
      }
      case 'constraint': {
        next();
        if (isWord('def')) {
          next();
          const n = node('constraintDef', t);
          n.name = name('a constraint block name');
          specs(n);
          bodyOrEnd(n);
          return n;
        }
        const n = node('constraint', t);
        n.name = name('a constraint name');
        if (isSym(':')) { next(); n.type = { ...ref(), conj: false }; }
        bodyOrEnd(n);
        return n;
      }
      case 'bind': {
        next();
        const n = node('binding', t);
        n.end1 = endPath();
        if (n.end1.segs.length !== 2) fail(t, 'Write a binding as: bind constraint.parameter = part.value;');
        sym('=');
        n.end2 = endPath();
        bodyOrEnd(n);
        return n;
      }
      case 'connection': case 'connect': {
        next();
        const n = node('connector', t);
        if (t.v === 'connection') {
          if (!isWord('connect')) n.name = name('a connection name');
          word('connect');
        }
        n.end1 = endPath();
        word('to');
        n.end2 = endPath();
        bodyOrEnd(n);
        return n;
      }
      case 'view': {
        next();
        const n = node('view', t);
        n.name = name('a view name');
        bodyOrEnd(n);
        return n;
      }
      case 'comment': {
        next();
        const n = node('comment', t);
        if (isNameTok()) n.name = next().v;
        if (peek().t !== 'block') fail(peek(), 'Expected /* text */ for the comment');
        n.doc = docText(next().v);
        if (isSym(';')) next();
        return n;
      }
      default:
        return fail(t, `Unknown element or statement "${t.v}"`);
    }
  }

  /** @type {Node[]} */
  const top = [];
  items(null, top);
  if (isSym('}')) fail(peek(), 'There is a "}" without a matching "{"');
  return top;
}

/** @param {Token} t */
function desc(t) {
  if (t.t === 'eof') return 'the end of the text';
  if (t.t === 'block') return 'a /* … */ comment';
  if (t.t === 'string') return 'a string';
  return `"${t.v}"`;
}
