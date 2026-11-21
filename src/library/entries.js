// The SysML and MBSE reference, as data. Concept articles are written here; an entry for every
// element, relationship and diagram kind is made from the metamodel (its names in each
// notation, what it may contain, what it may relate to, how it is written in SysML v2 text),
// with extra notes where they help. Text is plain: paragraphs, "- " bullets, `code`.
import { ELEMENTS, RELATIONSHIPS, kindName, childKinds, canRelate, isDiagram, NOT_TRACED } from '../model/metamodel.js';

/**
 * @typedef {{
 *   id: string, title: string, category: string, summary: string, body: string,
 *   see?: string[],          // related entry ids
 *   kind?: string,           // the element or relationship kind it describes
 *   names?: Record<string, string>,
 *   syntax?: string,         // how it is written in SysML v2 text
 * }} Entry
 */

export const CATEGORIES = ['Start here', 'Concepts', 'Requirements', 'Structure', 'Behavior', 'Analysis', 'Relationships', 'Diagrams', 'Customization', 'Exchange'];

/** @type {Entry[]} */
const ARTICLES = [
  {
    id: 'mbse', title: 'Model-based systems engineering', category: 'Start here',
    summary: 'Engineering a system around one model instead of a pile of documents.',
    body: `In document-based engineering, the requirements, the architecture and the test plan live in separate files, and keeping them consistent is a job of its own. In model-based systems engineering (MBSE) they are views of one model: change a block and every diagram, table and report that shows it changes too.

The model holds elements (requirements, functions, blocks, ports, states) and the relationships between them (satisfy, verify, allocate). Because the relationships are explicit, questions such as "what breaks if this battery changes?" or "which requirements are not yet verified?" have answers the tool can compute.

- The model is the truth; diagrams, tables and documents are views of it.
- Removing something from a diagram never deletes it from the model.
- Every requirement can be traced to what satisfies it and what verifies it.`,
    see: ['rflp', 'sysml', 'views-vs-model', 'systems-v'],
  },
  {
    id: 'sysml', title: 'SysML v1 and SysML v2', category: 'Start here',
    summary: 'The modeling language Loom uses, in its two generations.',
    body: `SysML (the Systems Modeling Language) is the standard language for MBSE, published by the OMG. SysML v1 extended UML with blocks, requirements and parametrics; it is what Cameo, Capella's SysML bridges and most current projects use. SysML v2, adopted in 2025, is a new language built on its own foundation (KerML), with a textual notation alongside the graphical one and a standard API.

Loom follows SysML v2's meaning internally and offers three notations over the same model:

- SysML: the v1 words engineers know (Block, Part property, Proxy port).
- SysML v2: the v2 keywords (part def, part, port def).
- Guided: plain words for newcomers (Part type, Part, Connection point).

Changing the notation never changes the model. Every Loom project is also SysML v2 text.`,
    see: ['notations', 'text-notation', 'definition-usage'],
  },
  {
    id: 'notations', title: 'The three notations', category: 'Start here',
    summary: 'SysML, SysML v2 and Guided: one model, three vocabularies.',
    body: `The notation switch (in the inspector with nothing selected, or Preferences) changes the words Loom uses everywhere: diagrams, the model browser, menus and the inspector.

- SysML shows «stereotypes» and the v1 vocabulary: «block», part property, proxy port, satisfy.
- SysML v2 shows v2 keywords: part def, part, port def, attribute def.
- Guided avoids jargon: Part type, Part, Connection point, Meets.

Use Guided while learning, then switch; nothing in the model changes.`,
    see: ['sysml'],
  },
  {
    id: 'rflp', title: 'RFLP: requirements, functional, logical, physical', category: 'Concepts',
    summary: 'The four layers every Loom project is organized in.',
    body: `RFLP is a common way to organize a system model in four layers, each answering a different question:

- Requirements: what is needed (stakeholder needs, system and subsystem requirements, tests).
- Functional: what the system must do (functions and their breakdown, activities).
- Logical: how it is organized, independently of technology (logical blocks, interfaces).
- Physical: what actually gets built or bought (physical components).

Relationships run between the layers: functions are allocated to logical blocks, logical blocks are allocated to physical ones, and design elements satisfy requirements. The RFLP trace view draws these threads, and its coverage tiles show where they are missing.`,
    see: ['allocation', 'traceability', 'systems-v'],
  },
  {
    id: 'systems-v', title: 'The Systems V', category: 'Concepts',
    summary: 'The life cycle Loom\'s home view follows.',
    body: `The V model pairs each stage of decomposition on its left arm with the stage that checks it on its right arm: stakeholder needs with validation, system requirements with system verification, architecture with integration testing, component design with component testing. Implementation sits at the bottom.

Loom's Systems V measures each stage from the model (how many requirements are satisfied, how many functions are allocated, how many tests passed) and opens the evidence behind each number.`,
    see: ['verification', 'rflp'],
  },
  {
    id: 'views-vs-model', title: 'Views and the model', category: 'Concepts',
    summary: 'Why removing a box from a diagram does not delete it.',
    body: `A diagram shows a selection of model elements, with positions. The elements themselves live in the model browser. "Remove from diagram" takes a box off the picture; "Delete" removes the element from the model, and from every diagram.

Tables, matrices, the text notation and generated documents are views too: editing a cell in the requirements table edits the requirement.`,
    see: ['mbse'],
  },
  {
    id: 'definition-usage', title: 'Definitions and usages', category: 'Concepts',
    summary: 'A Battery Pack (the type) versus the battery in this drone (a use of it).',
    body: `SysML separates types from their uses. A block (SysML v2: part def) defines a kind of thing once: Battery Pack, with its values and ports. A part property (part) uses it in a role inside another block: battery : Battery Pack in the Propulsion System.

The same definition can be used many times (left motor and right motor are both Motor). Changing the definition changes every use. Internal block diagrams show usages; block definition diagrams show definitions and how they compose.`,
    see: ['kind-partDef', 'kind-part', 'kind-bdd', 'kind-ibd'],
  },
  {
    id: 'traceability', title: 'Traceability', category: 'Requirements',
    summary: 'Following a requirement from need to part, and from test back to need.',
    body: `Traceability is being able to answer, for any element, where it comes from and what depends on it. In Loom it is made of relationships: derive (requirement from requirement), satisfy (design element to requirement), verify (test case to requirement), refine, allocate and trace.

Select an element in the RFLP trace and its thread lights up. The requirements table and dependency matrices show the same links as columns and cells, and the validation rules flag requirements nothing satisfies or verifies.`,
    see: ['rel-satisfy', 'rel-verify', 'rel-derive', 'coverage'],
  },
  {
    id: 'coverage', title: 'Coverage', category: 'Requirements',
    summary: 'How Loom decides a requirement is satisfied, verified or passed.',
    body: `A requirement is satisfied when something satisfies it directly, or when all of its sub-requirements (contained or derived) are satisfied. Verified works the same way with test cases and live checks. It has passed only when every test verifying it passed (and its check is met); one failure shows all the way up. Retired requirements are left out of every count.`,
    see: ['traceability', 'live-checks'],
  },
  {
    id: 'writing-requirements', title: 'Writing good requirements', category: 'Requirements',
    summary: 'Short, single, verifiable statements with "shall".',
    body: `A requirement is a contract: someone will have to show it was met. Guidance such as INCOSE's guide to writing requirements comes down to a few habits, which Loom's wording rules check:

- One requirement says one thing. Two "shall"s or "and/or" mean two requirements.
- Use "shall" for what is required; "will", "should" and "may" read as intentions.
- Avoid words nobody can test: fast, easy, adequate, user-friendly, minimize. Say how fast, with a number and a unit.
- No TBDs in an approved requirement.
- Put the explanation in the rationale, not in the requirement.
- Give each requirement an ID and a verification method.`,
    see: ['kind-requirement', 'validation'],
  },
  {
    id: 'verification', title: 'Verification and validation', category: 'Requirements',
    summary: 'Did we build it right, and did we build the right thing?',
    body: `Verification shows the system meets its requirements; validation shows it meets the stakeholders' needs. Both are planned against requirements: each gets a method (analysis, test, inspection or demonstration) and test cases that verify it.

In Loom a test case verifies requirements and records a result (not run, pass, fail). A requirement can also carry a live check, evaluated against the design's values, which counts as verification evidence.`,
    see: ['kind-testCase', 'rel-verify', 'live-checks'],
  },
  {
    id: 'live-checks', title: 'Live checks', category: 'Analysis',
    summary: 'A requirement that tests itself against the design\'s values.',
    body: `A requirement's check is a comparison such as \`endurance >= 3 [h]\`. Names in it are values of what satisfies the requirement, computed by the parametric solver where they have no number. The check runs after every edit: change the battery and the requirement turns red at once.`,
    see: ['parametrics', 'kind-requirement'],
  },
  {
    id: 'parametrics', title: 'Parametrics and the solver', category: 'Analysis',
    summary: 'Equations bound to the design\'s values, solved as you edit.',
    body: `A constraint block holds an equation, such as \`t = E / P\`, whose names are its parameters. Used inside a block (a constraint property), its parameters are bound to the block's values (or values of its parts) on a parametric diagram.

Loom solves the equations as you edit: values without a number are computed, equations that share unknowns are solved together, and everything is unit-checked. A value that breaks an equation, or an equation that adds hours to kilograms, is reported instead of giving a wrong answer.`,
    see: ['kind-constraintDef', 'kind-par', 'units'],
  },
  {
    id: 'units', title: 'Units and quantities', category: 'Analysis',
    summary: 'Values with units, checked and converted.',
    body: `A value property has a value and a unit: capacity = 16 Ah. Loom understands SI units with prefixes, compound units (km/h, m/s^2, W/kg) and common others (h, min, %, deg, rpm, ft, kn, psi, °C). A value type (Energy in Wh) gives its values a unit.

Equations convert between units and refuse to combine different kinds of quantity.`,
    see: ['kind-attribute', 'kind-valueType'],
  },
  {
    id: 'allocation', title: 'Allocation', category: 'Behavior',
    summary: 'Saying which structure performs which function.',
    body: `Allocation assigns one element to another that realizes it: a function to the block that performs it, a logical block to the physical component that implements it. On an activity diagram, swimlanes are allocation: an action in a lane is allocated to the lane's block.

The RFLP coverage tiles count functions allocated, logical blocks realized and physical blocks traced.`,
    see: ['rel-allocate', 'kind-act', 'rflp'],
  },
  {
    id: 'ports-interfaces', title: 'Ports, interfaces and item flows', category: 'Structure',
    summary: 'Where things cross a block\'s boundary, and what crosses.',
    body: `A port is a point on a block's boundary. Typed by an interface block, it says what can cross: DC power, a PWM signal, a force. A proxy port passes what crosses straight through to the inside; a full port is a part in its own right. A conjugated port (~) is the same interface from the other side.

Connectors join ports inside a block, and an item flow says what moves along the connector, in which direction. Loom's smart connect only lets compatible ports join, and says why others cannot.`,
    see: ['kind-port', 'kind-interfaceDef', 'kind-connector', 'kind-ibd'],
  },
  {
    id: 'state-machines', title: 'State machines', category: 'Behavior',
    summary: 'The modes a block can be in, and what moves it between them.',
    body: `A state machine describes a block's behavior as states (Idle, Armed, Flying) and transitions between them, labeled trigger [guard] / effect. States can run actions on entry, while active (do) and on exit; they can contain states of their own, and orthogonal regions that are active at the same time. Pseudo-states mark the initial state, choices and history.

Run a state machine in Loom to send it events and watch it move; Check explores every reachable configuration.`,
    see: ['kind-state', 'kind-transition', 'kind-stm'],
  },
  {
    id: 'activities', title: 'Activities', category: 'Behavior',
    summary: 'What a function does, step by step.',
    body: `An activity breaks a function into actions joined by flows. Control flow says what happens next; object flow carries items. Decisions choose a path by guard, forks split into parallel paths and joins wait for all of them. Activities run as tokens: an action runs when every flow into it has a token.`,
    see: ['kind-act', 'kind-controlNode', 'kind-flow', 'allocation'],
  },
  {
    id: 'sequences', title: 'Scenarios and sequence diagrams', category: 'Behavior',
    summary: 'Who says what to whom, in what order.',
    body: `An interaction describes one scenario: lifelines for the participants (parts, blocks or actors) and messages between them, read top to bottom. Combined fragments group messages that happen optionally (opt), one of several ways (alt), repeatedly (loop) or in parallel (par).`,
    see: ['kind-sd', 'kind-message', 'kind-lifeline'],
  },
  {
    id: 'validation', title: 'Validation rules', category: 'Customization',
    summary: 'Loom\'s checks of the model, and how to tune them.',
    body: `Loom checks the model a moment after every edit and lists what it finds in the problems panel (⌘⇧M), as badges on diagrams and in the inspector. Rules cover structure, interfaces, analysis, requirements and their wording, behavior, naming and profiles.

Choose a rule set (Recommended, Strict, Requirements quality, Early draft), turn rules on or off, change their severity, write your own ("every requirement's priority must be set"), and ignore single problems. The settings are saved with the project.`,
    see: ['writing-requirements', 'profiles'],
  },
  {
    id: 'profiles', title: 'Profiles, stereotypes and tagged values', category: 'Customization',
    summary: 'Your own kinds of element.',
    body: `A profile groups stereotypes: new kinds of element built on existing ones, such as «Flight critical» on blocks and parts, or «Safety requirement» on requirements. A stereotype can have a color and an icon, which diagrams show, and tags: values recorded on each element it is applied to (a design assurance level, an owner, a supplier).

In SysML v2 text a profile is a library package, a stereotype a metadata def, and applying one is a metadata usage: \`@'Flight critical' { dal = "B"; }\`.`,
    see: ['kind-profile', 'kind-stereotype'],
  },
  {
    id: 'text-notation', title: 'The SysML v2 text', category: 'Exchange',
    summary: 'Every Loom model is also text, one file per layer.',
    body: `Loom writes each RFLP layer as a SysML v2 text file and can read it back, so projects live happily in git: diffs are small and merges are readable. Open the text pane (⌘E) to see and edit it beside any diagram; edits apply when you pause.

Loom's own settings (diagram kinds, colors, layout hints) go in \`@Loom { … }\` metadata blocks.`,
    see: ['sysml', 'exchange'],
  },
  {
    id: 'exchange', title: 'Exchanging models with other tools', category: 'Exchange',
    summary: 'ReqIF, Excel, CSV, Cameo XMI, the SysML v2 API and documents.',
    body: `- ReqIF (.reqif, .reqifz): requirements to and from DOORS, Polarion, Jama, Codebeamer and suppliers. Importing again updates what changed.
- Excel (.xlsx) and CSV: requirements one per row, matched by ID when they come back.
- Cameo / MagicDraw (.mdzip, .xmi): SysML 1.x models become new projects. Diagram layouts are not read.
- SysML v2 API: read a project from a SysML v2 repository server, or send one to it.
- Documents: the model as a report (HTML, or PDF through the print dialog).`,
    see: ['text-notation'],
  },
];

/** Extra notes for some kinds, beyond the metamodel's help. */
const NOTES = /** @type {Record<string, string>} */ ({
  requirement: 'Give each requirement an ID (set an ID prefix on its package to number new ones), text that says "shall", a verification method, and a rationale. Requirements can contain sub-requirements; derive links one level to the next.',
  partDef: 'Blocks are the building blocks of structure: subsystems, components, software. Their parts compartment lists their part properties; values and ports have compartments too.',
  part: 'A part property is typed by a block and has a multiplicity (1, 0..1, 2..4, *).',
  port: 'Set the direction (in, out, inout) and the interface. A port on the diagram frame of an internal block diagram is the block\'s own port, seen from inside.',
  attribute: 'Leave the value empty to have the parametric solver compute it from equations.',
  connector: 'Drag from one port to another on an internal block diagram to make one; Loom only allows compatible ports.',
  action: 'Functions can contain sub-functions. An activity diagram of a function shows its steps and the flows between them.',
  state: 'Drag a state into another on a state machine diagram to nest it.',
  stereotype: 'Choose what it applies to, its color and icon in the inspector; add tags with Add a tag.',
  testCase: 'Record the result (not run, pass, fail) after running the test.',
  bdd: 'Drag blocks in from the model browser; Add related brings in the types of parts and their generalizations; Tidy lays the diagram out.',
  ibd: 'Drag from a port and compatible ports light up; drop on a part to give it a matching port.',
  req: 'Drag from a box\'s link handle to another box to relate them.',
  par: 'Drag from a value to a parameter of an equation to bind them.',
});

/** How each kind is written in the text notation. */
const SYNTAX = /** @type {Record<string, string>} */ ({
  package: 'package Name { … }', requirement: "requirement <'REQ-001'> Name { doc /* The system shall… */ }", testCase: 'verification def Name { verify Req; }',
  action: 'action def Name { … }', partDef: 'part def Name :> General { … }', interfaceDef: 'port def Name { … }', part: 'part name : Type [2];',
  port: 'out port name : ~Interface;', connector: 'connect a.p to b.q;', attribute: 'attribute name = 16 [Ah];', valueType: 'attribute def Energy { @Loom { unit = "Wh"; } }',
  constraintDef: 'constraint def Name { attribute t [h]; @Loom { expr = "t = E / P"; } }', constraint: 'constraint name : Equation;', binding: 'bind eq.E = battery.energy;',
  controlNode: 'start S;  decide D;  fork F;  join J;  done F;', flow: 'succession first A then B;  flow from A to B;', state: 'state Name { … }', region: 'region Name { … }',
  transition: 'transition first A accept "trigger" if "guard" do "effect" then B;', interaction: 'interaction Name { … }', lifeline: 'lifeline a : Part;', message: "message 'call()' from a to b;",
  fragment: 'fragment F { operand O { … } }', actor: 'actor Name;', useCase: 'use case Name { include Other; }', comment: 'comment Name /* text */',
  profile: 'library package Name { metadata def S { … } }', stereotype: 'metadata def Name { attribute tag = "default"; }',
  satisfy: 'satisfy Requirement;', verify: 'verify Requirement;', derive: 'derive Requirement;', refine: 'refine Requirement;', copy: 'copy Requirement;', allocate: 'allocate to Block;', trace: 'dependency to X;',
  include: 'include UseCase;', extend: 'extend UseCase;', participate: 'participate in UseCase;', import: 'import Package::*;', generalize: 'part def A :> B;',
});

/** The category an element kind's entry goes in. @param {string} k */
function categoryOf(k) {
  if (isDiagram(k)) return 'Diagrams';
  if (['requirement', 'testCase'].includes(k)) return 'Requirements';
  if (['action', 'controlNode', 'flow', 'state', 'region', 'transition', 'interaction', 'lifeline', 'message', 'fragment', 'operand', 'actor', 'useCase'].includes(k)) return 'Behavior';
  if (['valueType', 'constraintDef', 'constraint', 'binding'].includes(k)) return 'Analysis';
  if (['profile', 'stereotype'].includes(k)) return 'Customization';
  return 'Structure';
}

/** Every entry: the articles, then one per element, relationship and diagram kind. @returns {Entry[]} */
export function entries() {
  /** @type {Entry[]} */
  const out = [...ARTICLES];
  for (const [k, spec] of Object.entries(ELEMENTS)) {
    const kids = childKinds(k);
    const owners = spec.owners;
    const rels = Object.keys(RELATIONSHIPS).filter((r) => Object.keys(ELEMENTS).some((t) => canRelate(r, k, t)) && !(RELATIONSHIPS[r].sources === '*' && NOT_TRACED.includes(k)));
    const body = [
      spec.help,
      NOTES[k] || '',
      owners.length ? `Lives inside: ${owners.map((o) => kindName(o, 'sysml')).join(', ')}.` : '',
      kids.length ? `Can contain: ${kids.map((c) => kindName(c, 'sysml')).join(', ')}.` : '',
      rels.length && !spec.diagram ? `Can be the source of: ${rels.map((r) => RELATIONSHIPS[r].names.sysml.toLowerCase()).join(', ')}.` : '',
      (() => { const ps = Object.values(spec.props).filter((p) => !p.hidden && p.type !== 'stereo' && p.label !== 'Description'); return ps.length ? `Properties:\n${ps.map((p) => `- ${p.label}${p.type === 'enum' ? `: ${p.options.join(', ')}` : ''}`).join('\n')}` : ''; })(),
    ].filter(Boolean).join('\n\n');
    out.push({ id: `kind-${k}`, title: spec.names.sysml, category: categoryOf(k), summary: spec.help.split(/(?<=\.)\s/)[0], body, kind: k, names: spec.names, syntax: SYNTAX[k] || (spec.diagram ? `view Name { @Loom { kind = "${k}"; } }` : undefined), see: seeFor(k) });
  }
  for (const [k, r] of Object.entries(RELATIONSHIPS)) {
    const list = (/** @type {string[] | '*'} */ l) => (l === '*' ? 'any element' : l.map((x) => kindName(x, 'sysml')).join(', '));
    out.push({
      id: `rel-${k}`, title: r.names.sysml, category: 'Relationships', summary: r.help, kind: k, names: r.names, syntax: SYNTAX[k], see: seeFor(k),
      body: `${r.help}\n\nFrom: ${list(r.sources)}.\nTo: ${list(r.targets)}.\n\nRead it as "A ${r.verb.sysml} B"; from the other end, "B is ${r.inverse.sysml} A".`,
    });
  }
  return out;
}

/** Related entries for a kind. @param {string} k */
function seeFor(k) {
  const map = /** @type {Record<string, string[]>} */ ({
    requirement: ['writing-requirements', 'traceability', 'coverage', 'live-checks'], testCase: ['verification', 'rel-verify'], partDef: ['definition-usage', 'kind-part', 'kind-bdd'],
    part: ['definition-usage', 'kind-partDef'], port: ['ports-interfaces'], interfaceDef: ['ports-interfaces'], connector: ['ports-interfaces', 'kind-ibd'],
    attribute: ['units', 'parametrics'], valueType: ['units'], constraintDef: ['parametrics'], constraint: ['parametrics'], binding: ['parametrics'],
    action: ['activities', 'allocation'], state: ['state-machines'], transition: ['state-machines'], interaction: ['sequences'], message: ['sequences'],
    profile: ['profiles'], stereotype: ['profiles'], satisfy: ['traceability'], verify: ['verification'], derive: ['traceability'], allocate: ['allocation'],
    bdd: ['definition-usage'], ibd: ['ports-interfaces'], act: ['activities'], stm: ['state-machines'], sd: ['sequences'], par: ['parametrics'],
  });
  return map[k] || [];
}

/** The entry for an element's kind, for context help. @param {string} kind */
export const entryForKind = (kind) => (kind in RELATIONSHIPS ? `rel-${kind}` : `kind-${kind}`);
