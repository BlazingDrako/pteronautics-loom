// The Loom metamodel: which kinds of element exist, what may own what, which relationships
// may join which elements, and what each kind is called in each notation.
//
// Loom follows SysML v2 semantics. The "sysml" notation uses the SysML v1 vocabulary most
// engineers know from Cameo (Block, Part property, Proxy port…); "v2" uses the SysML v2
// keywords; "guided" uses plain words for newcomers. Notation never changes the model.

/** @typedef {'sysml' | 'v2' | 'guided'} Notation */
/** @typedef {'r' | 'f' | 'l' | 'p'} Layer */
/**
 * @typedef {({ type: 'text' | 'longtext' | 'bool', label: string, default?: any, placeholder?: string }
 *   | { type: 'enum', label: string, options: string[], default: string }
 *   | { type: 'ref', label: string, kinds: string[], default?: null, required?: true }  required: deleting the target deletes this element
 *   | { type: 'end', label: string, default?: null }) & { hidden?: true }} PropSpec  an end: a connector's, or a binding's value (its "port" is then a value property)  hidden: kept by a view's own controls, not shown in the inspector
 * @typedef {{ path: string[], port: string | null }} End  a connector end: parts from the owning block, then an optional port
 */
/**
 * @typedef {{
 *   names: Record<Notation, string>,
 *   abbr: string,
 *   rel?: false,
 *   owners: string[],
 *   props: Record<string, PropSpec>,
 *   defaultLayer?: Layer,
 *   diagram?: boolean,     // a view: it shows other elements and keeps their layout
 *   noMenu?: boolean,      // created by drawing, not from "Add" menus
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
    owners: ['package'],
    props: {
      idPrefix: { type: 'text', label: 'Requirement ID prefix', default: '', placeholder: 'REQ-' },
      doc: DOC,
    },
    help: 'Groups model elements. Every element lives in exactly one package or element. A requirement ID prefix here numbers the requirements created inside it.',
  },
  requirement: {
    names: { sysml: 'Requirement', v2: 'requirement', guided: 'Requirement' }, abbr: 'req', defaultLayer: 'r',
    owners: ['package', 'requirement'],
    props: {
      reqId: { type: 'text', label: 'ID', default: '', placeholder: 'REQ-001' },
      text: { type: 'longtext', label: 'Text', default: '', placeholder: 'The system shall…' },
      level: { type: 'enum', label: 'Level', options: ['Auto', 'Need', 'System', 'Subsystem', 'Component'], default: 'Auto' },
      priority: { type: 'enum', label: 'Priority', options: ['—', 'Must', 'Should', 'Could'], default: '—' },
      status: { type: 'enum', label: 'Status', options: ['Draft', 'In review', 'Approved', 'Retired'], default: 'Draft' },
      method: { type: 'enum', label: 'Verification method', options: ['—', 'Analysis', 'Test', 'Inspection', 'Demonstration'], default: '—' },
      check: { type: 'text', label: 'Check (live)', default: '', placeholder: 'endurance >= 3 [h]' },
      doc: { ...DOC, label: 'Rationale', placeholder: 'Why is this needed?' },
    },
    help: 'Something the system must do or be. Can contain sub-requirements.',
  },
  testCase: {
    names: { sysml: 'Test case', v2: 'verification def', guided: 'Test' }, abbr: 'test', defaultLayer: 'r',
    owners: ['package'],
    props: {
      method: { type: 'enum', label: 'Method', options: ['Analysis', 'Test', 'Inspection', 'Demonstration'], default: 'Test' },
      result: { type: 'enum', label: 'Result', options: ['Not run', 'Pass', 'Fail'], default: 'Not run' },
      doc: DOC,
    },
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
      portKind: { type: 'enum', label: 'Kind', options: ['proxy', 'full'], default: 'proxy' },
      direction: { type: 'enum', label: 'Direction', options: ['inout', 'in', 'out'], default: 'inout' },
      conjugated: { type: 'bool', label: 'Conjugated (~)', default: false },
      doc: DOC,
    },
    help: 'A point on a block\'s boundary where things cross: power, data, force.',
  },
  connector: {
    names: { sysml: 'Connector', v2: 'connection', guided: 'Link' }, abbr: 'conn', noMenu: true,
    owners: ['partDef'],
    props: {
      end1: { type: 'end', label: 'From' },
      end2: { type: 'end', label: 'To' },
      item: { type: 'text', label: 'Item flow', default: '', placeholder: '48 V DC' },
      flow: { type: 'enum', label: 'Flow direction', options: ['None', 'From → To', 'To → From', 'Both ways'], default: 'None' },
      doc: DOC,
    },
    help: 'Links two ports (or parts) inside a block. An item flow says what moves along it.',
  },
  attribute: {
    names: { sysml: 'Value property', v2: 'attribute', guided: 'Property' }, abbr: 'val',
    owners: ['partDef', 'interfaceDef', 'requirement', 'part', 'constraintDef'],
    props: {
      type: { type: 'ref', label: 'Value type', kinds: ['valueType'] },
      value: { type: 'text', label: 'Value', default: '', placeholder: '16' },
      unit: { type: 'text', label: 'Unit', default: '', placeholder: 'Ah' },
      doc: DOC,
    },
    help: 'A quantity with a unit, such as capacity = 16 Ah. Leave the value empty to have a parametric diagram compute it. In a constraint block, it is a parameter of the equation.',
  },
  valueType: {
    names: { sysml: 'Value type', v2: 'attribute def', guided: 'Kind of quantity' }, abbr: 'vt', defaultLayer: 'l',
    owners: ['package'],
    props: { unit: { type: 'text', label: 'Unit', default: '', placeholder: 'Wh' }, doc: DOC },
    help: 'A kind of quantity with its unit (Energy in Wh, Speed in m/s). Value properties typed by it use its unit unless they give their own.',
  },
  constraintDef: {
    names: { sysml: 'Constraint block', v2: 'constraint def', guided: 'Equation' }, abbr: 'cb', defaultLayer: 'l',
    owners: ['package'],
    props: {
      expr: { type: 'text', label: 'Equation', default: '', placeholder: 't = E / P' },
      doc: DOC,
    },
    help: 'A reusable equation, such as t = E / P. Its value properties are its parameters, each with a unit. Use it in a block (a constraint property) and bind its parameters on a parametric diagram.',
  },
  constraint: {
    names: { sysml: 'Constraint property', v2: 'constraint', guided: 'Equation used' }, abbr: 'cp',
    owners: ['partDef'],
    props: { type: { type: 'ref', label: 'Constraint block', kinds: ['constraintDef'] }, doc: DOC },
    help: 'A constraint block used inside a block. Bind its parameters to the block\'s values on a parametric diagram.',
  },
  binding: {
    names: { sysml: 'Binding connector', v2: 'binding', guided: 'Equals' }, abbr: 'bind', noMenu: true,
    owners: ['partDef'],
    props: {
      constraint: { type: 'ref', label: 'Constraint', kinds: ['constraint'], required: true },
      param: { type: 'ref', label: 'Parameter', kinds: ['attribute'], required: true },
      value: { type: 'end', label: 'Value' },
      doc: DOC,
    },
    help: 'Says a parameter of an equation equals a value property of the block (or of one of its parts).',
  },
  bdd: {
    names: { sysml: 'Block definition diagram', v2: 'general view', guided: 'Structure diagram' }, abbr: 'bdd', defaultLayer: 'l', diagram: true,
    owners: ['package'],
    props: {
      showParts: { type: 'bool', label: 'Parts compartment', default: true },
      showValues: { type: 'bool', label: 'Values compartment', default: true },
      showPorts: { type: 'bool', label: 'Ports compartment', default: true },
      showRoles: { type: 'bool', label: 'Role names on lines', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows blocks, what they are made of (composition) and what they are kinds of (generalization). A view: removing a block from it never deletes the block.',
  },
  ibd: {
    names: { sysml: 'Internal block diagram', v2: 'interconnection view', guided: 'Connection diagram' }, abbr: 'ibd', diagram: true,
    owners: ['partDef'],
    props: {
      showTypes: { type: 'bool', label: 'Types on parts and ports', default: true },
      showPortNames: { type: 'bool', label: 'Port names', default: true },
      showFlows: { type: 'bool', label: 'Item flows', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows the inside of one block: its parts (nested as deep as you like), their ports, and the connectors and item flows between them.',
  },
  req: {
    names: { sysml: 'Requirement diagram', v2: 'requirement view', guided: 'Requirements diagram' }, abbr: 'req', defaultLayer: 'r', diagram: true,
    owners: ['package'],
    props: {
      showId: { type: 'bool', label: 'Requirement IDs', default: true },
      showText: { type: 'bool', label: 'Requirement text', default: true },
      showRoles: { type: 'bool', label: 'Relationship names on lines', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows requirements, how they break down (containment and derive), and what satisfies, refines and verifies them. Drag from a box\'s link handle to another box to relate them.',
  },
  table: {
    names: { sysml: 'Requirements table', v2: 'requirements grid view', guided: 'Requirements list' }, abbr: 'tbl', defaultLayer: 'r', diagram: true,
    owners: ['package'],
    props: {
      columns: { type: 'text', label: 'Columns', default: '', hidden: true },
      sort: { type: 'text', label: 'Sort', default: '', hidden: true },
      doc: DOC,
    },
    help: 'Every requirement inside this table\'s package, one per row, with what satisfies and verifies it. Edit cells in place, sort, filter, choose columns and export to CSV.',
  },
  matrix: {
    names: { sysml: 'Dependency matrix', v2: 'dependency grid view', guided: 'Link grid' }, abbr: 'mtx', defaultLayer: 'r', diagram: true,
    owners: ['package'],
    props: {
      rel: { type: 'text', label: 'Relationship', default: 'satisfy', hidden: true },
      rows: { type: 'text', label: 'Rows', default: 'partDef', hidden: true },
      cols: { type: 'text', label: 'Columns', default: 'requirement', hidden: true },
      hideEmpty: { type: 'bool', label: 'Hide empty rows and columns', default: false },
      doc: DOC,
    },
    help: 'A grid of two sets of elements with a mark wherever a relationship joins them. Click a cell to add or remove the relationship.',
  },
  // ---------- behavior (M6) ----------
  controlNode: {
    names: { sysml: 'Control node', v2: 'control node', guided: 'Flow point' }, abbr: 'ctl',
    owners: ['action'],
    props: {
      nodeKind: { type: 'enum', label: 'Kind', options: ['initial', 'final', 'flowFinal', 'decision', 'merge', 'fork', 'join'], default: 'decision' },
      doc: DOC,
    },
    help: 'Where an activity starts (initial), ends (final, flow final), chooses (decision), comes together (merge), splits into parallel paths (fork) or waits for them (join).',
  },
  flow: {
    names: { sysml: 'Activity edge', v2: 'succession', guided: 'Then' }, abbr: 'flow', noMenu: true,
    owners: ['action'],
    props: {
      from: { type: 'ref', label: 'From', kinds: ['action', 'controlNode'], required: true },
      to: { type: 'ref', label: 'To', kinds: ['action', 'controlNode'], required: true },
      flowKind: { type: 'enum', label: 'Kind', options: ['control', 'object'], default: 'control' },
      guard: { type: 'text', label: 'Guard', default: '', placeholder: 'battery > 20%' },
      item: { type: 'text', label: 'Object (item)', default: '', placeholder: 'Image' },
      doc: DOC,
    },
    help: 'What happens next in an activity. A control flow passes control; an object flow carries an item. A guard says when this path is taken.',
  },
  state: {
    names: { sysml: 'State', v2: 'state', guided: 'State' }, abbr: 'st',
    owners: ['partDef', 'state', 'region'],
    props: {
      stateKind: { type: 'enum', label: 'Kind', options: ['state', 'initial', 'final', 'choice', 'history'], default: 'state' },
      entry: { type: 'text', label: 'Entry', default: '', placeholder: 'arm motors' },
      do: { type: 'text', label: 'Do', default: '', placeholder: 'hold altitude' },
      exit: { type: 'text', label: 'Exit', default: '', placeholder: 'log event' },
      doc: DOC,
    },
    help: 'A condition the system is in, with what it does on entry, while in it, and on exit. States can contain states, and regions that run at the same time.',
  },
  region: {
    names: { sysml: 'Region', v2: 'region', guided: 'Parallel part' }, abbr: 'rgn',
    owners: ['state'], props: { doc: DOC },
    help: 'An orthogonal region: states in different regions of one state are active at the same time.',
  },
  transition: {
    names: { sysml: 'Transition', v2: 'transition', guided: 'Change' }, abbr: 'tr', noMenu: true,
    owners: ['partDef', 'state', 'region'],
    props: {
      from: { type: 'ref', label: 'From', kinds: ['state'], required: true },
      to: { type: 'ref', label: 'To', kinds: ['state'], required: true },
      trigger: { type: 'text', label: 'Trigger', default: '', placeholder: 'takeoffCmd' },
      guard: { type: 'text', label: 'Guard', default: '', placeholder: 'battery > 30%' },
      effect: { type: 'text', label: 'Effect', default: '', placeholder: 'start logging' },
      doc: DOC,
    },
    help: 'A change from one state to another: when the trigger happens and the guard holds, the effect runs.',
  },
  interaction: {
    names: { sysml: 'Interaction', v2: 'interaction', guided: 'Scenario' }, abbr: 'int', defaultLayer: 'f',
    owners: ['package', 'partDef'], props: { doc: DOC },
    help: 'A scenario: who exchanges which messages, in what order. Shown on a sequence diagram.',
  },
  lifeline: {
    names: { sysml: 'Lifeline', v2: 'lifeline', guided: 'Participant' }, abbr: 'life',
    owners: ['interaction'],
    props: { represents: { type: 'ref', label: 'Represents', kinds: ['part', 'partDef', 'actor'] }, doc: DOC },
    help: 'One participant in a scenario: a part, a block or an actor.',
  },
  message: {
    names: { sysml: 'Message', v2: 'message', guided: 'Message' }, abbr: 'msg', noMenu: true,
    owners: ['interaction', 'operand'],
    props: {
      from: { type: 'ref', label: 'From', kinds: ['lifeline'], required: true },
      to: { type: 'ref', label: 'To', kinds: ['lifeline'], required: true },
      msgKind: { type: 'enum', label: 'Kind', options: ['sync', 'async', 'reply', 'create'], default: 'sync' },
      doc: DOC,
    },
    help: 'A call, signal or reply from one participant to another. Messages read top to bottom in order.',
  },
  fragment: {
    names: { sysml: 'Combined fragment', v2: 'fragment', guided: 'Block of steps' }, abbr: 'frag', noMenu: true,
    owners: ['interaction', 'operand'],
    props: { operator: { type: 'enum', label: 'Operator', options: ['alt', 'opt', 'loop', 'par', 'break', 'critical'], default: 'opt' }, doc: DOC },
    help: 'Messages that happen under a condition (opt), one of several ways (alt), repeatedly (loop) or in parallel (par).',
  },
  operand: {
    names: { sysml: 'Operand', v2: 'operand', guided: 'Case' }, abbr: 'case',
    owners: ['fragment'],
    props: { guard: { type: 'text', label: 'Guard', default: '', placeholder: 'battery low' }, doc: DOC },
    help: 'One part of a combined fragment, with the condition under which it happens.',
  },
  actor: {
    names: { sysml: 'Actor', v2: 'actor', guided: 'Person or system' }, abbr: 'act', defaultLayer: 'r',
    owners: ['package'], props: { doc: DOC },
    help: 'Someone or something outside the system that uses it: an operator, a ground station, another system.',
  },
  useCase: {
    names: { sysml: 'Use case', v2: 'use case', guided: 'Use' }, abbr: 'uc', defaultLayer: 'r',
    owners: ['package', 'partDef'], props: { doc: DOC },
    help: 'A goal an actor reaches with the system. Put it inside a block to make that block its subject.',
  },
  act: {
    names: { sysml: 'Activity diagram', v2: 'action flow view', guided: 'Flow diagram' }, abbr: 'act', defaultLayer: 'f', diagram: true,
    owners: ['action'],
    props: {
      showLanes: { type: 'bool', label: 'Swimlanes (allocation)', default: true },
      showGuards: { type: 'bool', label: 'Guards and items on flows', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows what a function does, step by step: its actions, decisions, parallel paths and flows. Swimlanes show (and set) which block each action is allocated to.',
  },
  stm: {
    names: { sysml: 'State machine diagram', v2: 'state transition view', guided: 'States diagram' }, abbr: 'stm', defaultLayer: 'l', diagram: true,
    owners: ['partDef'],
    props: {
      showActions: { type: 'bool', label: 'Entry, do and exit', default: true },
      showLabels: { type: 'bool', label: 'Transition labels', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows the states of a block and the transitions between them. Drag a state into another to nest it.',
  },
  sd: {
    names: { sysml: 'Sequence diagram', v2: 'sequence view', guided: 'Scenario diagram' }, abbr: 'sd', defaultLayer: 'f', diagram: true,
    owners: ['interaction'],
    props: { doc: DOC },
    help: 'Shows a scenario: participants across the top, messages in order down the page, and fragments for options, choices and loops.',
  },
  uc: {
    names: { sysml: 'Use case diagram', v2: 'use case view', guided: 'Uses diagram' }, abbr: 'ucd', defaultLayer: 'r', diagram: true,
    owners: ['package', 'partDef'],
    props: { showRoles: { type: 'bool', label: 'Relationship names on lines', default: true }, snap: { type: 'bool', label: 'Snap to grid and guides', default: true }, doc: DOC },
    help: 'Shows actors, the use cases they take part in, and the system boundary (a block as the subject). Drag a use case into or out of the boundary to change its subject.',
  },
  pkg: {
    names: { sysml: 'Package diagram', v2: 'package view', guided: 'Folders diagram' }, abbr: 'pkgd', diagram: true,
    owners: ['package'],
    props: { showMembers: { type: 'bool', label: 'Members', default: true }, showRoles: { type: 'bool', label: 'Relationship names on lines', default: true }, snap: { type: 'bool', label: 'Snap to grid and guides', default: true }, doc: DOC },
    help: 'Shows how the model is organized: packages, what they contain, and which import or depend on which.',
  },
  par: {
    names: { sysml: 'Parametric diagram', v2: 'parametric view', guided: 'Equations diagram' }, abbr: 'par', defaultLayer: 'l', diagram: true,
    owners: ['partDef'],
    props: {
      showValues: { type: 'bool', label: 'Computed values', default: true },
      showExpr: { type: 'bool', label: 'Equations', default: true },
      snap: { type: 'bool', label: 'Snap to grid and guides', default: true },
      doc: DOC,
    },
    help: 'Shows a block\'s equations (constraint properties) and the values they connect. Loom solves them as you edit: values without a number are computed, and a value that breaks an equation is flagged.',
  },
  comment: {
    names: { sysml: 'Comment', v2: 'comment', guided: 'Note' }, abbr: 'note',
    owners: ['package', 'requirement', 'testCase', 'action', 'partDef', 'interfaceDef', 'state', 'interaction', 'useCase', 'constraintDef'],
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
    sources: ['action', 'partDef', 'part', 'useCase'], targets: ['partDef', 'part'],
    help: 'Assigns a function, or a logical element, to the structure that realizes it.',
  },
  generalize: {
    names: { sysml: 'Generalization', v2: 'specializes', guided: 'Kind of' }, verb: { sysml: 'specializes', v2: 'specializes', guided: 'is a kind of' }, inverse: { sysml: 'specialized by', v2: 'specialized by', guided: 'has kind' }, rel: true,
    sources: ['partDef', 'interfaceDef', 'requirement'], targets: ['partDef', 'interfaceDef', 'requirement'],
    help: 'One type is a more specific kind of another.',
  },
  copy: {
    names: { sysml: 'Copy', v2: 'copy', guided: 'Copy of' }, verb: { sysml: 'copies', v2: 'copies', guided: 'is a copy of' }, inverse: { sysml: 'copied by', v2: 'copied by', guided: 'copied to' }, rel: true,
    sources: ['requirement'], targets: ['requirement'],
    help: 'A requirement whose text is reused, unchanged, from another (for example from a supplier specification).',
  },
  include: {
    names: { sysml: 'Include', v2: 'include', guided: 'Includes' }, verb: { sysml: 'includes', v2: 'includes', guided: 'always does' }, inverse: { sysml: 'included by', v2: 'included by', guided: 'always done in' }, rel: true,
    sources: ['useCase'], targets: ['useCase'],
    help: 'A use case that always includes another (Fly survey includes Take off).',
  },
  extend: {
    names: { sysml: 'Extend', v2: 'extend', guided: 'Sometimes adds' }, verb: { sysml: 'extends', v2: 'extends', guided: 'sometimes adds to' }, inverse: { sysml: 'extended by', v2: 'extended by', guided: 'sometimes gets' }, rel: true,
    sources: ['useCase'], targets: ['useCase'],
    help: 'A use case that adds to another only in some cases (Return home extends Fly survey).',
  },
  participate: {
    names: { sysml: 'Association', v2: 'participation', guided: 'Takes part in' }, verb: { sysml: 'participates in', v2: 'participates in', guided: 'takes part in' }, inverse: { sysml: 'has participant', v2: 'has participant', guided: 'involves' }, rel: true,
    sources: ['actor'], targets: ['useCase'],
    help: 'An actor takes part in a use case.',
  },
  import: {
    names: { sysml: 'Import', v2: 'import', guided: 'Uses folder' }, verb: { sysml: 'imports', v2: 'imports', guided: 'uses' }, inverse: { sysml: 'imported by', v2: 'imported by', guided: 'used by' }, rel: true,
    sources: ['package'], targets: ['package'],
    help: 'A package that uses the names of another package\'s members.',
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

/** Kinds that are plumbing of a diagram rather than things to trace to. */
export const NOT_TRACED = ['comment', 'flow', 'transition', 'message', 'operand', 'region', 'controlNode', 'lifeline', 'fragment', 'binding'];

/** @param {string} kind */
export const isRel = (kind) => kind in RELATIONSHIPS;
/** Is this kind a diagram (a view)? @param {string} kind */
export const isDiagram = (kind) => !!ELEMENTS[kind]?.diagram;
/** Every diagram kind. */
export const DIAGRAM_KINDS = Object.keys(ELEMENTS).filter((k) => ELEMENTS[k].diagram);
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
  return Object.keys(ELEMENTS).filter((k) => canOwnKind(owner, k) && !ELEMENTS[k].noMenu);
}

/** May a relationship of `kind` go from an element of `src` kind to one of `tgt` kind? @param {string} kind @param {string} src @param {string} tgt */
export function canRelate(kind, src, tgt) {
  const r = RELATIONSHIPS[kind];
  if (!r) return false;
  const ok = (/** @type {string[] | '*'} */ list, /** @type {string} */ k) => list === '*' ? (k in ELEMENTS && !NOT_TRACED.includes(k) && !ELEMENTS[k].diagram) : list.includes(k);
  return ok(r.sources, src) && ok(r.targets, tgt);
}

/** Default property values for a kind. @param {string} kind @returns {Record<string, any>} */
export function defaultProps(kind) {
  const spec = ELEMENTS[kind]?.props || {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, p] of Object.entries(spec)) out[k] = p.type === 'ref' || p.type === 'end' ? null : ('default' in p ? p.default : '');
  return out;
}
