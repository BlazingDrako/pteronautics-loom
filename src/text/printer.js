// The canonical printer: a model (one RFLP layer at a time) as SysML v2 text. The output is
// stable: printing the same model always gives the same text, and parse → build → print gives
// it back unchanged, so files diff and merge cleanly in git.
import { ELEMENTS, RELATIONSHIPS, LAYERS, defaultProps, isDiagram } from '../model/metamodel.js';
import { quoteName, quoteString, docBody } from './lexer.js';
import { treeOf, refText, targetKinds, TYPE_KINDS } from './names.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */

const INDENT = '    ';
/** Relationship statements, in the order they are printed. */
export const REL_WORDS = /** @type {Record<string, (ref: string) => string>} */ ({
  satisfy: (r) => `satisfy ${r};`,
  verify: (r) => `verify ${r};`,
  refine: (r) => `refine ${r};`,
  derive: (r) => `derive ${r};`,
  copy: (r) => `copy ${r};`,
  allocate: (r) => `allocate to ${r};`,
  trace: (r) => `dependency to ${r};`,
  include: (r) => `include ${r};`,
  extend: (r) => `extend ${r};`,
  participate: (r) => `participate in ${r};`,
  import: (r) => `import ${r}::*;`,
});
/** Control node keywords. */
export const CONTROL_WORDS = /** @type {Record<string, string>} */ ({ initial: 'start', final: 'done', flowFinal: 'terminate', decision: 'decide', merge: 'merge', fork: 'fork', join: 'join' });
/** Properties written in the declaration or as doc, not in @Loom. */
const IN_DECL = /** @type {Record<string, string[]>} */ ({
  requirement: ['reqId', 'text'],
  part: ['type', 'multiplicity'],
  port: ['type', 'direction'],
  attribute: ['value', 'unit'],
  connector: ['end1', 'end2'],
  comment: ['doc'],
  controlNode: ['nodeKind'],
  flow: ['from', 'to', 'flowKind'],
  transition: ['from', 'to', 'trigger', 'guard', 'effect'],
  message: ['from', 'to'],
  lifeline: ['represents'],
});
/** The file each layer is saved in. */
export const LAYER_FILES = /** @type {Record<string, string>} */ ({ r: 'requirements.sysml', f: 'functional.sysml', l: 'logical.sysml', p: 'physical.sysml' });

/** @param {string} v */
const isNumber = (v) => /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v);
/** @param {string} s */
const shortName = (s) => (/^[A-Za-z0-9_]+$/.test(s) ? s : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

/**
 * Print one RFLP layer (or any package) as text.
 * @param {Model} m @param {string} pkgId
 * @returns {{ text: string, ranges: Map<string, [number, number]> }} ranges: element id → first and last line (1-based)
 */
export function printPackage(m, pkgId) {
  const t = treeOf(m);
  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string, [number, number]>} */
  const ranges = new Map();

  /** A connector end as text, relative to its block. @param {any} end */
  const endText = (end) => [...end.path, ...(end.port ? [end.port] : [])].map((id) => quoteName(m.get(id)?.name || '?')).join('.');

  /** A reference to the target of a ref property. @param {string} id @param {Element} e @param {string} [prop] */
  const ref = (id, e, prop = '') => refText(t, id, e.id, /** @type {any} */ (ELEMENTS[e.kind].props[prop])?.kinds || null);

  /** @param {Element} e */
  function decl(e) {
    const q = quoteName(e.name);
    const specs = m.relsFrom(e.id).filter((r) => r.kind === 'generalize').map((r) => refText(t, /** @type {string} */ (r.target), e.id, targetKinds('generalize')));
    const sp = specs.length ? ` :> ${specs.join(', ')}` : '';
    const p = e.props;
    switch (e.kind) {
      case 'package': return `package ${q}`;
      case 'requirement': return `requirement${p.reqId ? ` <${shortName(p.reqId)}>` : ''} ${q}${sp}`;
      case 'testCase': return `verification def ${q}${sp}`;
      case 'action': return `action def ${q}${sp}`;
      case 'partDef': return `part def ${q}${sp}`;
      case 'interfaceDef': return `port def ${q}${sp}`;
      case 'part': return `part ${q}${p.type ? ` : ${refText(t, p.type, e.id, TYPE_KINDS.part)}` : ''}${p.multiplicity !== '1' ? ` [${p.multiplicity}]` : ''}`;
      case 'port': return `${p.direction !== 'inout' ? `${p.direction} ` : ''}port ${q}${p.type ? ` : ${p.conjugated ? '~' : ''}${refText(t, p.type, e.id, TYPE_KINDS.port)}` : ''}`;
      case 'attribute': return `attribute ${q}${p.value ? ` = ${isNumber(p.value) ? p.value : quoteString(p.value)}` : ''}${p.unit ? ` [${p.unit}]` : ''}`;
      case 'connector': {
        const a = endText(p.end1), b = endText(p.end2);
        // the default name (a.b → c.d, as the text builder gives it) is not written
        const plain = `${[...p.end1.path, ...(p.end1.port ? [p.end1.port] : [])].map((id) => m.get(id)?.name).join('.')} → ${[...p.end2.path, ...(p.end2.port ? [p.end2.port] : [])].map((id) => m.get(id)?.name).join('.')}`;
        return `${e.name && e.name !== plain ? `connection ${q} ` : ''}connect ${a} to ${b}`;
      }
      case 'comment': return `comment ${q} ${docBody(p.doc || '')}`;
      case 'controlNode': return `${CONTROL_WORDS[p.nodeKind] || 'decide'} ${q}`;
      case 'flow': {
        const a = ref(p.from, e, 'from'), b = ref(p.to, e, 'to');
        const named = e.name && e.name !== `${m.get(p.from)?.name} → ${m.get(p.to)?.name}` ? `${q} ` : '';
        return p.flowKind === 'object' ? `flow ${named}from ${a} to ${b}` : `succession ${named}first ${a} then ${b}`;
      }
      case 'transition': {
        const named = e.name && e.name !== `${m.get(p.from)?.name} → ${m.get(p.to)?.name}` ? `${q} ` : '';
        const opt = [p.trigger ? ` accept ${quoteString(p.trigger)}` : '', p.guard ? ` if ${quoteString(p.guard)}` : '', p.effect ? ` do ${quoteString(p.effect)}` : ''].join('');
        return `transition ${named}first ${ref(p.from, e, 'from')}${opt} then ${ref(p.to, e, 'to')}`;
      }
      case 'state': case 'region': case 'interaction': case 'fragment': case 'operand': case 'actor': return `${e.kind} ${q}`;
      case 'useCase': return `use case ${q}`;
      case 'lifeline': return `lifeline ${q}${p.represents ? ` : ${ref(p.represents, e, 'represents')}` : ''}`;
      case 'message': return `message ${q} from ${ref(p.from, e, 'from')} to ${ref(p.to, e, 'to')}`;
      default: if (isDiagram(e.kind)) return `view ${q}`;
    }
    return `// ${e.kind} ${q} cannot be written as text yet`;
  }

  /** Loom properties that differ from the defaults. @param {Element} e @returns {[string, string | boolean][]} */
  function meta(e) {
    /** @type {[string, string | boolean][]} */
    const out = [];
    if (e.layer) out.push(['layer', e.layer]);
    if (isDiagram(e.kind)) out.push(['kind', e.kind]);
    const defs = defaultProps(e.kind), skip = IN_DECL[e.kind] || [];
    for (const [k, spec] of Object.entries(ELEMENTS[e.kind].props)) {
      if (skip.includes(k) || spec.type === 'ref' || spec.type === 'end') continue;
      if (k === 'doc' && e.kind !== 'requirement') continue;
      if (e.kind === 'port' && k === 'conjugated' && e.props.type) continue;
      const v = e.props[k];
      if (JSON.stringify(v) === JSON.stringify(defs[k])) continue;
      out.push([e.kind === 'requirement' && k === 'doc' ? 'rationale' : k, v]);
    }
    return out;
  }

  /** Will this element take more than one line? (The same test emit() uses.) @param {Element} e */
  function multiLine(e) {
    if (e.kind === 'comment') return false;
    if (e.kind === 'requirement' ? e.props.text : e.props.doc) return true;
    return meta(e).length > 0 || m.children(e.id).length > 0 || m.relsFrom(e.id).some((r) => r.kind !== 'generalize' && REL_WORDS[r.kind]);
  }

  /** @param {Element} e @param {number} depth */
  function emit(e, depth) {
    const pad = INDENT.repeat(depth);
    const start = lines.length + 1;
    const d = decl(e);
    if (e.kind === 'comment') { lines.push(pad + d); ranges.set(e.id, [start, start]); return; }
    /** @type {string[]} */
    const body = [];
    const inner = pad + INDENT;
    const doc = e.kind === 'requirement' ? e.props.text : e.props.doc;
    if (doc) body.push(...`doc ${docBody(doc)}`.split('\n').map((l, i) => (i ? `${inner}${l}` : inner + l)));
    const mt = meta(e);
    if (mt.length) {
      const one = `@Loom { ${mt.map(([k, v]) => `${k} = ${typeof v === 'boolean' ? v : quoteString(String(v))};`).join(' ')} }`;
      if (one.length + inner.length <= 100) body.push(inner + one);
      else body.push(`${inner}@Loom {`, ...mt.map(([k, v]) => `${inner}${INDENT}${k} = ${typeof v === 'boolean' ? v : quoteString(String(v))};`), `${inner}}`);
    }
    const kids = m.children(e.id);
    const rels = m.relsFrom(e.id).filter((r) => r.kind !== 'generalize' && REL_WORDS[r.kind])
      .map((r) => ({ kind: r.kind, text: REL_WORDS[r.kind](refText(t, /** @type {string} */ (r.target), e.id, targetKinds(r.kind))) }))
      .sort((a, b) => Object.keys(REL_WORDS).indexOf(a.kind) - Object.keys(REL_WORDS).indexOf(b.kind) || a.text.localeCompare(b.text));
    if (!body.length && !kids.length && !rels.length) { lines.push(`${pad}${d};`); ranges.set(e.id, [start, start]); return; }
    lines.push(`${pad}${d} {`, ...body);
    // a blank line around anything that takes more than one line
    let prevMulti = body.length > 0;
    kids.forEach((k, i) => {
      const multi = multiLine(k);
      if ((multi || prevMulti) && (i > 0 || body.length)) lines.push('');
      emit(k, depth + 1);
      prevMulti = multi;
    });
    if (rels.length && (kids.length || body.length)) lines.push('');
    for (const r of rels) lines.push(inner + r.text);
    lines.push(`${pad}}`);
    ranges.set(e.id, [start, lines.length]);
  }

  const pkg = m.get(pkgId);
  if (pkg) emit(pkg, 0);
  return { text: lines.join('\n') + '\n', ranges };
}

/**
 * The whole model as one file per RFLP layer.
 * @param {Model} m @returns {{ layer: string, id: string, path: string, text: string }[]}
 */
export function printModel(m) {
  return m.layers().map((l) => ({ layer: /** @type {string} */ (l.layer), id: l.id, path: LAYER_FILES[/** @type {string} */ (l.layer)], text: printPackage(m, l.id).text }));
}

export { LAYERS, RELATIONSHIPS };
