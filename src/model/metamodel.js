// The Loom metamodel: which kinds of element exist, what may own what, which relationships
// may join which elements, and what each kind is called in each notation.
//
// Loom follows SysML v2 semantics. The "sysml" notation uses the SysML v1 vocabulary most
// engineers know from Cameo (Block, Part property, Proxy port…); "v2" uses the SysML v2
// keywords; "guided" uses plain words for newcomers. Notation never changes the model.

/** @typedef {'sysml' | 'v2' | 'guided'} Notation */
/** @typedef {'r' | 'f' | 'l' | 'p'} Layer */
/**
 * @typedef {{ type: 'text' | 'longtext' | 'bool', label: string, default?: any, placeholder?: string }
 *   | { type: 'enum', label: string, options: string[], default: string }
 *   | { type: 'ref', label: string, kinds: string[], default?: null }} PropSpec
 */
/**
 * @typedef {{
 *   names: Record<Notation, string>,
 *   abbr: string,
 *   rel?: false,
 *   owners: string[],
 *   props: Record<string, PropSpec>,
 *   defaultLayer?: Layer,
 *   help: string,
 * }} ElementKind
 * @typedef {{
 *   names: Record<Notation, string>,
 *   verb: Record<Notation, string>,
 *   inverse: Record<Notation, string>,
 *   rel: true,
 *   sources: string[] | '*',
 *   targets: string[] | '*',
 *   help: string,
 * }} RelKind
 */

const DOC = /** @type {PropSpec} */ ({ type: 'longtext', label: 'Description', default: '', placeholder: 'What is this, and why is it here?' });

/** Structural element kinds. Order here is the order of "New …" menus. */
/** @type {Record<string, ElementKind>} */
export const ELEMENTS = {
  package: {
    names: { sysml: 'Package', v2: 'package', guided: 'Folder' }, abbr: 'pkg',
    owners: ['package'], props: { doc: DOC },
    help: 'Groups model elements. Every element lives in exactly one package or element.',
  },
  requirement: {
    names: { sysml: 'Requirement', v2: 'requirement', guided: 'Requirement' }, abbr: 'req', defaultLayer: 'r',
    owners: ['package', 'requirement'],
    props: {
      reqId: { type: 'text', label: 'ID', default: '', placeholder: 'REQ-001' },
      text: { type: 'longtext', label: 'Text', default: '', placeholder: 'The system shall…' },
      priority: { type: 'enum', label: 'Priority', options: ['—', 'Must', 'Should', 'Could'], default: '—' },
      method: { type: 'enum', label: 'Verification method', options: ['—', 'Analysis', 'Test', 'Inspection', 'Demonstration'], default: '—' },
      doc: { ...DOC, label: 'Rationale', placeholder: 'Why is this needed?' },
    },
    help: 'Something the system must do or be. Can contain sub-requirements.',
  },
  testCase: {
    names: { sysml: 'Test case', v2: 'verification def', guided: 'Test' }, abbr: 'test', defaultLayer: 'r',
    owners: ['package'],
    props: { method: { type: 'enum', label: 'Method', options: ['Analysis', 'Test', 'Inspection', 'Demonstration'], default: 'Test' }, doc: DOC },
    help: 'A test, analysis, inspection or demonstration that verifies requirements.',
  },
  action: {
    names: { sysml: 'Activity', v2: 'action def', guided: 'Function' }, abbr: 'fn', defaultLayer: 'f',
    owners: ['package', 'action'], props: { doc: DOC },
    help: 'Something the system does. Functions can be broken down into sub-functions.',
  },
  partDef: {
    names: { sysml: 'Block', v2: 'part def', guided: 'Part type' }, abbr: 'blk', defaultLayer: 'l',
    owners: ['package'], props: { doc: DOC },
    help: 'A type of thing: a subsystem, a component, a piece of software. Has parts, ports and values.',
  },
  interfaceDef: {
    names: { sysml: 'Interface block', v2: 'port def', guided: 'Interface' }, abbr: 'if', defaultLayer: 'l',
    owners: ['package'], props: { doc: DOC },
    help: 'What can pass through a port: power, data, force. Used to type ports.',
  },
  part: {
    names: { sysml: 'Part property', v2: 'part', guided: 'Part' }, abbr: 'part',
    owners: ['partDef'],
    props: {
      type: { type: 'ref', label: 'Type', kinds: ['partDef'] },
      multiplicity: { type: 'text', label: 'Multiplicity', default: '1', placeholder: '1' },
      doc: DOC,
    },
    help: 'A block used inside another block, in a named role (battery : Battery Pack).',
  },
  port: {
    names: { sysml: 'Proxy port', v2: 'port', guided: 'Connection point' }, abbr: 'port',
    owners: ['partDef', 'interfaceDef'],
    props: {
      type: { type: 'ref', label: 'Type', kinds: ['interfaceDef'] },
      direction: { type: 'enum', label: 'Direction', options: ['inout', 'in', 'out'], default: 'inout' },
      conjugated: { type: 'bool', label: 'Conjugated (~)', default: false },
      doc: DOC,
    },
    help: 'A point on a block\'s boundary where things cross: power, data, force.',
  },
  attribute: {
    names: { sysml: 'Value property', v2: 'attribute', guided: 'Property' }, abbr: 'val',
    owners: ['partDef', 'interfaceDef', 'requirement', 'part'],
    props: {
      value: { type: 'text', label: 'Value', default: '', placeholder: '16' },
      unit: { type: 'text', label: 'Unit', default: '', placeholder: 'Ah' },
      doc: DOC,
    },
    help: 'A quantity with a unit, such as capacity = 16 Ah.',
  },
  comment: {
    names: { sysml: 'Comment', v2: 'comment', guided: 'Note' }, abbr: 'note',
    owners: ['package', 'requirement', 'testCase', 'action', 'partDef', 'interfaceDef'],
    props: { doc: { ...DOC, label: 'Text', placeholder: 'Write a note' } },
    help: 'A note attached to an element.',
  },
};

/** Relationship kinds. Sources and targets are element kinds ('*' = any). */
/** @type {Record<string, RelKind>} */
export const RELATIONSHIPS = {
  satisfy: {
    names: { sysml: 'Satisfy', v2: 'satisfy', guided: 'Meets' }, verb: { sysml: 'satisfies', v2: 'satisfies', guided: 'meets' }, inverse: { sysml: 'satisfied by', v2: 'satisfied by', guided: 'met by' }, rel: true,
    sources: ['partDef', 'part', 'interfaceDef'], targets: ['requirement'],
    help: 'A design element satisfies a requirement.',
  },
  verify: {
    names: { sysml: 'Verify', v2: 'verify', guided: 'Checks' }, verb: { sysml: 'verifies', v2: 'verifies', guided: 'checks' }, inverse: { sysml: 'verified by', v2: 'verified by', guided: 'checked by' }, rel: true,
    sources: ['testCase'], targets: ['requirement'],
    help: 'A test case verifies a requirement.',
  },
  derive: {
    names: { sysml: 'Derive', v2: 'derivation', guided: 'Comes from' }, verb: { sysml: 'derives from', v2: 'derives from', guided: 'comes from' }, inverse: { sysml: 'derived into', v2: 'derived into', guided: 'leads to' }, rel: true,
    sources: ['requirement'], targets: ['requirement'],
    help: 'A requirement derived from another.',
  },
  refine: {
    names: { sysml: 'Refine', v2: 'refinement', guided: 'Details' }, verb: { sysml: 'refines', v2: 'refines', guided: 'details' }, inverse: { sysml: 'refined by', v2: 'refined by', guided: 'detailed by' }, rel: true,
    sources: ['action', 'partDef', 'testCase'], targets: ['requirement'],
    help: 'A model element that makes a requirement precise.',
  },
  allocate: {
    names: { sysml: 'Allocate', v2: 'allocation', guided: 'Done by' }, verb: { sysml: 'allocated to', v2: 'allocated to', guided: 'done by' }, inverse: { sysml: 'allocated from', v2: 'allocated from', guided: 'does' }, rel: true,
    sources: ['action', 'partDef', 'part'], targets: ['partDef', 'part'],
    help: 'Assigns a function, or a logical element, to the structure that realizes it.',
  },
  generalize: {
    names: { sysml: 'Generalization', v2: 'specializes', guided: 'Kind of' }, verb: { sysml: 'specializes', v2: 'specializes', guided: 'is a kind of' }, inverse: { sysml: 'specialized by', v2: 'specialized by', guided: 'has kind' }, rel: true,
    sources: ['partDef', 'interfaceDef', 'requirement'], targets: ['partDef', 'interfaceDef', 'requirement'],
    help: 'One type is a more specific kind of another.',
  },
  trace: {
    names: { sysml: 'Trace', v2: 'dependency', guided: 'Related to' }, verb: { sysml: 'traces to', v2: 'depends on', guided: 'is related to' }, inverse: { sysml: 'traced from', v2: 'depended on by', guided: 'is related to' }, rel: true,
    sources: '*', targets: '*',
    help: 'A general link when nothing more specific fits.',
  },
};

/** The four RFLP layer packages every new project starts with. */
export const LAYERS = /** @type {const} */ ([
  { id: 'r', name: 'Requirements', note: 'What is needed', color: 'var(--layer-r)' },
  { id: 'f', name: 'Functional', note: 'What it must do', color: 'var(--layer-f)' },
  { id: 'l', name: 'Logical', note: 'How it is organized', color: 'var(--layer-l)' },
  { id: 'p', name: 'Physical', note: 'What gets built', color: 'var(--layer-p)' },
]);

/** @param {string} kind */
export const isRel = (kind) => kind in RELATIONSHIPS;
/** @param {string} kind */
export const isKind = (kind) => kind in ELEMENTS || kind in RELATIONSHIPS;

/** Display name of a kind in a notation. @param {string} kind @param {Notation} n */
export function kindName(kind, n) {
  const k = ELEMENTS[kind] || RELATIONSHIPS[kind];
  return k ? k.names[n] : kind;
}

/** May an element of kind `child` be owned by an element of kind `owner`? @param {string} owner @param {string} child */
export function canOwnKind(owner, child) {
  const k = ELEMENTS[child];
  return !!k && k.owners.includes(owner);
}

/** Element kinds an element of kind `owner` may contain, in menu order. @param {string} owner */
export function childKinds(owner) {
  return Object.keys(ELEMENTS).filter((k) => canOwnKind(owner, k));
}

/** May a relationship of `kind` go from an element of `src` kind to one of `tgt` kind? @param {string} kind @param {string} src @param {string} tgt */
export function canRelate(kind, src, tgt) {
  const r = RELATIONSHIPS[kind];
  if (!r) return false;
  const ok = (/** @type {string[] | '*'} */ list, /** @type {string} */ k) => list === '*' ? (k in ELEMENTS && k !== 'comment') : list.includes(k);
  return ok(r.sources, src) && ok(r.targets, tgt);
}

/** Default property values for a kind. @param {string} kind @returns {Record<string, any>} */
export function defaultProps(kind) {
  const spec = ELEMENTS[kind]?.props || {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, p] of Object.entries(spec)) out[k] = p.type === 'ref' ? null : ('default' in p ? p.default : '');
  return out;
}
