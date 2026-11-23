// Exporting a Loom model as SysML 1.6 XMI (XMI 2.5.1, UML 2.5.1), for Cameo Systems Modeler,
// MagicDraw and other SysML 1.x tools.
//
// Semantics, as the importer reads them: the sets become top-level packages; requirements
// (with ID and text), test cases, blocks, interface blocks, value types (with units),
// constraint blocks (with their equation), parts, ports, values with defaults, constraint
// properties, connectors and binding connectors, generalizations, satisfy, verify, derive,
// refine, trace, copy and allocate, activities (actions, control nodes, control and object
// flows), state machines, interactions (lifelines, messages, combined fragments), use cases,
// actors, include, extend, participation, package imports and comments.
//
// Diagrams are left out: Cameo keeps diagram layouts in a format of its own. Anything SysML 1.x
// has no standard place for (a requirement's priority and status, a port's direction, item
// flows, Loom's own stereotypes) is counted in the report, so nothing is dropped silently.
import { esc } from './xml.js';
import { kindName, isDiagram } from '../model/metamodel.js';
import { plural } from './xmi.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/**
 * @typedef {{
 *   text: string,                        // the XMI document
 *   counts: Record<string, number>,      // Loom kind → how many were written
 *   skipped: Record<string, number>,     // what was left out → how many
 * }} XmiExport
 */

const NS = {
  xmi: 'http://www.omg.org/spec/XMI/20131001',
  uml: 'http://www.omg.org/spec/UML/20161101',
  sysml: 'http://www.omg.org/spec/SysML/20181001/SysML',
  StandardProfile: 'http://www.omg.org/spec/UML/20161101/StandardProfile',
};
const PRIMITIVES = 'http://www.omg.org/spec/UML/20161101/PrimitiveTypes.xmi';
const REL_STEREO = /** @type {Record<string, string>} */ ({ satisfy: 'sysml:Satisfy', verify: 'sysml:Verify', derive: 'sysml:DeriveReqt', refine: 'sysml:Refine', copy: 'sysml:Copy', allocate: 'sysml:Allocate', trace: 'StandardProfile:Trace' });
const NODE = /** @type {Record<string, string>} */ ({ initial: 'uml:InitialNode', final: 'uml:ActivityFinalNode', flowFinal: 'uml:FlowFinalNode', decision: 'uml:DecisionNode', merge: 'uml:MergeNode', fork: 'uml:ForkNode', join: 'uml:JoinNode' });
const SORT = /** @type {Record<string, string>} */ ({ sync: 'synchCall', async: 'asynchCall', reply: 'reply', create: 'createMessage' });
const PSEUDO = /** @type {Record<string, string>} */ ({ initial: 'initial', choice: 'choice', history: 'shallowHistory' });

/** An attribute value: escaped, with line breaks kept. @param {unknown} v */
const av = (v) => esc(v).replace(/\r?\n/g, '&#10;').replace(/\t/g, '&#9;');
/** An XMI id for a Loom id (xsd:ID may not start with a digit). @param {string} id */
export const xid = (id) => `_${id}`;

/**
 * Write a Loom model as SysML 1.6 XMI.
 * @param {Model} m @returns {XmiExport}
 */
export function exportXmi(m) {
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, number>} */
  const skipped = {};
  const count = (/** @type {string} */ kind) => { counts[kind] = (counts[kind] || 0) + 1; };
  const skip = (/** @type {string} */ what, n = 1) => { skipped[what] = (skipped[what] || 0) + n; };
  /** Elements written, so relationships can tell whether both ends exist. @type {Set<string>} */
  const written = new Set();
  /** Stereotype applications, written after the model. @type {string[]} */
  const apps = [];
  /** Signals and signal events for state machine triggers, by package: Loom package id → name → event id. @type {Map<string, Map<string, string>>} */
  const events = new Map();
  /** Relationships, by the package they are written in. @type {Map<string, Element[]>} */
  const relsIn = new Map();
  const units = new Map(); // unit symbol → XMI id of its instance specification
  let seq = 0;
  const fresh = (/** @type {string} */ base) => `${base}_${(++seq).toString(36)}`;
  const children = (/** @type {string} */ id) => m.children(id);
  const name = (/** @type {Element} */ e) => (e.name ? ` name="${av(e.name)}"` : '');
  const apply = (/** @type {string} */ stereo, /** @type {string} */ base, /** @type {string} */ id, extra = '') => apps.push(`  <${stereo} xmi:id="${xid(id)}_st" ${base}="${xid(id)}"${extra}/>`);
  /** The nearest package holding an element. @param {string} id */
  const packageOf = (id) => { let e = m.get(id); while (e && e.kind !== 'package') e = e.owner ? m.get(e.owner) : undefined; return e && e.owner ? e.id : null; };

  // relationships go in the package of their source
  for (const r of m.all()) {
    if (!r.source || !r.target || !(r.kind in REL_STEREO || ['generalize', 'include', 'extend', 'participate', 'import'].includes(r.kind))) continue;
    const p = packageOf(r.source);
    if (!p) { skip(`${kindName(r.kind, 'sysml').toLowerCase()} relationships outside any package`); continue; }
    const list = relsIn.get(p) || relsIn.set(p, []).get(p);
    list?.push(r);
  }

  /** Comments: an element's description, and the comment elements it owns. @param {Element} e @param {string} pad */
  const comments = (e, pad) => {
    const out = [];
    if (e.kind !== 'comment' && e.props.doc) out.push(`${pad}<ownedComment xmi:type="uml:Comment" xmi:id="${xid(e.id)}_doc" body="${av(e.props.doc)}"><annotatedElement xmi:idref="${xid(e.id)}"/></ownedComment>`);
    for (const c of children(e.id).filter((x) => x.kind === 'comment')) {
      out.push(`${pad}<ownedComment xmi:type="uml:Comment" xmi:id="${xid(c.id)}" body="${av(c.props.doc || c.name)}"><annotatedElement xmi:idref="${xid(e.id)}"/></ownedComment>`);
      written.add(c.id); count('comment');
    }
    return out;
  };
  /** Report what an element's kind has no place for in SysML 1.x. @param {Element} e */
  const unplaced = (e) => {
    if (Array.isArray(e.props.applied) && e.props.applied.length) skip('stereotype applications from Loom profiles', e.props.applied.length);
    if (e.kind === 'requirement') {
      const p = e.props;
      if ((p.level && p.level !== 'Auto') || (p.priority && p.priority !== '—') || (p.status && p.status !== 'Draft') || (p.method && p.method !== '—') || p.check) skip('requirements with a level, priority, status, verification method or live check (SysML 1.x has only ID and text; ReqIF export carries them)');
    }
    if (e.kind === 'testCase' && ((e.props.method && e.props.method !== 'Test') || (e.props.result && e.props.result !== 'Not run'))) skip('test case methods and results');
    if (e.kind === 'port' && e.props.direction && e.props.direction !== 'inout') skip('port directions (in SysML 1.x a direction belongs on the flow properties of the interface block)');
    if (e.kind === 'connector' && (e.props.item || (e.props.flow && e.props.flow !== 'None'))) skip('item flows on connectors (a SysML item flow needs a conveyed type)');
    if (e.kind === 'attribute' && e.props.unit && e.props.type && m.get(e.props.type)?.props.unit && m.get(e.props.type)?.props.unit !== e.props.unit) skip('values whose unit differs from their value type\'s (the value type\'s unit is kept)');
  };

  // ---------- packages and what they hold ----------
  /** @param {Element} e @param {string} pad @param {string} tag @returns {string[]} */
  function classifier(e, pad, tag) {
    const out = [];
    const open = (/** @type {string} */ type, extra = '') => `${pad}<${tag} xmi:type="${type}" xmi:id="${xid(e.id)}"${name(e)}${extra}>`;
    const close = `${pad}</${tag}>`;
    const inner = pad + '  ';
    written.add(e.id); unplaced(e);
    switch (e.kind) {
      case 'package': {
        count('package');
        out.push(open('uml:Package'), ...comments(e, inner));
        for (const c of children(e.id)) out.push(...member(c, inner));
        for (const r of relsIn.get(e.id) || []) if (r.kind === 'import') { out.push(`${inner}<packageImport xmi:type="uml:PackageImport" xmi:id="${xid(r.id)}" importedPackage="${xid(/** @type {string} */ (r.target))}"/>`); written.add(r.id); count('import'); }
        out.push('@@rels:' + e.id + '|' + inner, close);
        return out;
      }
      case 'requirement': {
        count('requirement');
        out.push(open('uml:Class'), ...comments(e, inner));
        for (const c of children(e.id)) {
          if (c.kind === 'requirement') out.push(...classifier(c, inner, 'nestedClassifier'));
          else if (c.kind === 'attribute') out.push(...property(c, inner));
          else if (c.kind !== 'comment') other(c);
        }
        out.push(...generals(e, inner), close);
        apply('sysml:Requirement', 'base_Class', e.id, ` Id="${av(e.props.reqId || '')}" Text="${av(e.props.text || '')}"`);
        return out;
      }
      case 'testCase': {
        count('testCase');
        out.push(open('uml:Activity'), ...comments(e, inner), close);
        apply('sysml:TestCase', 'base_Behavior', e.id);
        return out;
      }
      case 'partDef': case 'interfaceDef': case 'constraintDef': {
        count(e.kind);
        out.push(open('uml:Class'), ...comments(e, inner));
        out.push(...structure(e, inner));
        if (e.kind === 'constraintDef' && e.props.expr) out.push(`${inner}<ownedRule xmi:type="uml:Constraint" xmi:id="${xid(e.id)}_rule"><constrainedElement xmi:idref="${xid(e.id)}"/><specification xmi:type="uml:OpaqueExpression" xmi:id="${xid(e.id)}_expr"><body>${esc(e.props.expr)}</body></specification></ownedRule>`);
        out.push(...generals(e, inner), close);
        apply(({ partDef: 'sysml:Block', interfaceDef: 'sysml:InterfaceBlock', constraintDef: 'sysml:ConstraintBlock' })[e.kind], 'base_Class', e.id);
        return out;
      }
      case 'valueType': {
        count('valueType');
        out.push(open('uml:DataType'), ...comments(e, inner), close);
        const u = e.props.unit ? unitId(e.props.unit) : '';
        apply('sysml:ValueType', 'base_DataType', e.id, u ? ` unit="${u}"` : '');
        return out;
      }
      case 'action': {
        count('action');
        out.push(...activity(e, pad, tag));
        return out;
      }
      case 'interaction': {
        count('interaction');
        out.push(...interaction(e, pad, tag));
        return out;
      }
      case 'actor': {
        count('actor');
        out.push(open('uml:Actor'), ...comments(e, inner), close);
        return out;
      }
      case 'useCase': {
        count('useCase');
        const owner = e.owner ? m.get(e.owner) : undefined;
        out.push(open('uml:UseCase', owner?.kind === 'partDef' ? ` subject="${xid(owner.id)}"` : ''), ...comments(e, inner));
        for (const r of m.relsFrom(e.id)) {
          if (r.kind === 'include') { out.push(`${inner}<include xmi:type="uml:Include" xmi:id="${xid(r.id)}" addition="${xid(/** @type {string} */ (r.target))}"/>`); written.add(r.id); count('include'); }
          if (r.kind === 'extend') { out.push(`${inner}<extend xmi:type="uml:Extend" xmi:id="${xid(r.id)}" extendedCase="${xid(/** @type {string} */ (r.target))}"/>`); written.add(r.id); count('extend'); }
        }
        out.push(close);
        return out;
      }
      default:
        written.delete(e.id);
        other(e);
        return out;
    }
  }
  /** Something that cannot be written where it is. @param {Element} e */
  function other(e) {
    if (isDiagram(e.kind)) { skip('diagrams, tables and matrices (Cameo keeps layouts in its own format: show the elements on new Cameo diagrams)'); return; }
    if (e.kind === 'profile' || e.kind === 'stereotype') { skip('profiles and stereotypes of your own'); return; }
    if (e.kind === 'attribute' && m.get(/** @type {string} */ (e.owner))?.kind === 'part') { skip('values set on parts (redefinitions)'); return; }
    if (e.kind === 'attribute' && m.get(/** @type {string} */ (e.owner))?.kind === 'stereotype') return;
    skip(`${kindName(e.kind, 'sysml').toLowerCase()} elements in places SysML 1.x does not allow`);
  }
  /** A package's member. @param {Element} c @param {string} pad */
  function member(c, pad) {
    if (c.kind === 'comment') return [];
    if (isDiagram(c.kind) || c.kind === 'profile') { other(c); return []; }
    return classifier(c, pad, 'packagedElement');
  }
  /** Generalizations, inside the specific classifier. @param {Element} e @param {string} pad */
  function generals(e, pad) {
    return m.relsFrom(e.id).filter((r) => r.kind === 'generalize').map((r) => { written.add(r.id); count('generalize'); return `${pad}<generalization xmi:type="uml:Generalization" xmi:id="${xid(r.id)}" general="${xid(/** @type {string} */ (r.target))}"/>`; });
  }

  // ---------- blocks: features, connectors, behaviors ----------
  /** @param {Element} e @param {string} pad */
  function structure(e, pad) {
    const out = [];
    const states = [];
    for (const c of children(e.id)) {
      switch (c.kind) {
        case 'part': case 'constraint': case 'attribute': out.push(...property(c, pad)); break;
        case 'port': out.push(port(c, pad)); break;
        case 'connector': out.push(...connector(c, pad)); break;
        case 'binding': out.push(...binding(c, pad)); break;
        case 'state': case 'transition': states.push(c); break;
        case 'interaction': count('interaction'); out.push(...interaction(c, pad, 'ownedBehavior')); break;
        case 'useCase': out.push(...classifier(c, pad, 'ownedUseCase')); break;
        case 'comment': break;
        default: other(c);
      }
    }
    if (states.length) out.push(...stateMachine(e, states, pad));
    return out;
  }
  /** A part, constraint or value property. @param {Element} c @param {string} pad */
  function property(c, pad) {
    written.add(c.id); unplaced(c); count(c.kind);
    const t = c.props.type;
    const inner = pad + '  ';
    const body = [...comments(c, inner)];
    let head = `${pad}<ownedAttribute xmi:type="uml:Property" xmi:id="${xid(c.id)}"${name(c)}`;
    if (c.kind === 'part' || c.kind === 'constraint') {
      head += `${t ? ` type="${xid(t)}"` : ''} aggregation="composite"`;
      if (c.kind === 'part') body.push(...bounds(c.id, c.props.multiplicity || '1', inner));
    } else {
      const v = String(c.props.value ?? '').trim();
      // SysML 1.x keeps units on value types: a value with a unit and no type gets one for its unit
      if (t) head += ` type="${xid(t)}"`;
      else if (c.props.unit) head += ` type="${unitType(c.props.unit)}"`;
      else body.push(`${inner}<type href="${PRIMITIVES}#${/^(true|false)$/i.test(v) ? 'Boolean' : v && isFinite(Number(v)) ? 'Real' : 'String'}"/>`);
      if (v) body.push(`${inner}<defaultValue xmi:type="${literal(v)}" xmi:id="${xid(c.id)}_dv" value="${av(/^(true|false)$/i.test(v) ? v.toLowerCase() : v)}"/>`);
    }
    return body.length ? [`${head}>`, ...body, `${pad}</ownedAttribute>`] : [`${head}/>`];
  }
  /** @param {string} v */
  function literal(v) {
    if (/^(true|false)$/i.test(v)) return 'uml:LiteralBoolean';
    if (/^-?\d+$/.test(v)) return 'uml:LiteralInteger';
    if (v && isFinite(Number(v))) return 'uml:LiteralReal';
    return 'uml:LiteralString';
  }
  /** Lower and upper values from "1", "0..1", "*", "2..4". @param {string} id @param {string} mult @param {string} pad */
  function bounds(id, mult, pad) {
    const s = String(mult).trim() || '1';
    let lo = s, up = s;
    if (s.includes('..')) [lo, up] = s.split('..').map((x) => x.trim());
    else if (s === '*') { lo = '0'; up = '*'; }
    if (lo === '1' && up === '1') return [];
    return [`${pad}<lowerValue xmi:type="uml:LiteralInteger" xmi:id="${xid(id)}_lo" value="${av(lo === '*' ? '0' : lo)}"/>`, `${pad}<upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="${xid(id)}_up" value="${av(up)}"/>`];
  }
  /** @param {Element} c @param {string} pad */
  function port(c, pad) {
    written.add(c.id); unplaced(c); count('port');
    apply(c.props.portKind === 'full' ? 'sysml:FullPort' : 'sysml:ProxyPort', 'base_Port', c.id);
    const doc = comments(c, pad + '  ');
    const head = `${pad}<ownedAttribute xmi:type="uml:Port" xmi:id="${xid(c.id)}"${name(c)}${c.props.type ? ` type="${xid(c.props.type)}"` : ''} aggregation="composite"${c.props.conjugated ? ' isConjugated="true"' : ''}`;
    return doc.length ? [`${head}>`, ...doc, `${pad}</ownedAttribute>`].join('\n') : `${head}/>`;
  }
  /**
   * A connector end: the role (a port, or the last part), the part it is reached through, and,
   * when it goes through more than one part, SysML's property path.
   * @param {string} id @param {{ path: string[], port: string | null }} end @param {string} pad
   */
  function end(id, end, pad) {
    const role = end.port || end.path[end.path.length - 1];
    const via = end.port ? end.path[end.path.length - 1] : undefined;
    const pathIds = end.port ? end.path : end.path.slice(0, -1);
    if (pathIds.length > (end.port ? 1 : 0)) apply('sysml:NestedConnectorEnd', 'base_ConnectorEnd', id, ` propertyPath="${pathIds.map(xid).join(' ')}"`);
    return `${pad}<end xmi:type="uml:ConnectorEnd" xmi:id="${xid(id)}" role="${xid(role)}"${via ? ` partWithPort="${xid(via)}"` : ''}/>`;
  }
  /** @param {Element} c @param {string} pad */
  function connector(c, pad) {
    written.add(c.id); unplaced(c); count('connector');
    const e1 = c.props.end1, e2 = c.props.end2;
    if (!e1 || !e2) { skip('connectors without two ends'); return []; }
    const inner = pad + '  ';
    return [`${pad}<ownedConnector xmi:type="uml:Connector" xmi:id="${xid(c.id)}"${name(c)}>`, end(`${c.id}_e1`, e1, inner), end(`${c.id}_e2`, e2, inner), ...comments(c, inner), `${pad}</ownedConnector>`];
  }
  /** A binding: the constraint's parameter equals a value. @param {Element} c @param {string} pad */
  function binding(c, pad) {
    const { constraint, param, value } = c.props;
    if (!constraint || !param || !value) { skip('binding connectors without both ends'); return []; }
    written.add(c.id); count('binding');
    apply('sysml:BindingConnector', 'base_Connector', c.id);
    const inner = pad + '  ';
    return [`${pad}<ownedConnector xmi:type="uml:Connector" xmi:id="${xid(c.id)}"${name(c)}>`,
      end(`${c.id}_e1`, { path: [constraint], port: param }, inner),
      end(`${c.id}_e2`, value, inner), `${pad}</ownedConnector>`];
  }

  // ---------- state machines ----------
  /** @param {Element} block @param {Element[]} top @param {string} pad */
  function stateMachine(block, top, pad) {
    const inner = pad + '  ';
    const smId = `${block.id}_sm`;
    return [`${pad}<ownedBehavior xmi:type="uml:StateMachine" xmi:id="${xid(smId)}" name="${av(`${block.name} states`)}">`,
      ...region(`${block.id}_rg`, '', top, inner, block),
      `${pad}</ownedBehavior>`];
  }
  /** @param {string} id @param {string} rname @param {Element[]} items @param {string} pad @param {Element} block */
  function region(id, rname, items, pad, block) {
    const inner = pad + '  ';
    const out = [`${pad}<region xmi:type="uml:Region" xmi:id="${xid(id)}"${rname ? ` name="${av(rname)}"` : ''}>`];
    for (const s of items.filter((x) => x.kind === 'state')) out.push(...state(s, inner, block));
    for (const t of items.filter((x) => x.kind === 'transition')) out.push(...transition(t, inner, block));
    out.push(`${pad}</region>`);
    return out;
  }
  /** @param {Element} s @param {string} pad @param {Element} block */
  function state(s, pad, block) {
    written.add(s.id); unplaced(s); count('state');
    const k = s.props.stateKind || 'state';
    const inner = pad + '  ';
    if (k === 'final') return [`${pad}<subvertex xmi:type="uml:FinalState" xmi:id="${xid(s.id)}"${name(s)}/>`];
    if (PSEUDO[k]) return [`${pad}<subvertex xmi:type="uml:Pseudostate" xmi:id="${xid(s.id)}"${name(s)} kind="${PSEUDO[k]}"/>`];
    const out = [`${pad}<subvertex xmi:type="uml:State" xmi:id="${xid(s.id)}"${name(s)}>`, ...comments(s, inner)];
    for (const [prop, tag] of [['entry', 'entry'], ['do', 'doActivity'], ['exit', 'exit']]) {
      const v = String(s.props[prop] || '').trim();
      if (v) out.push(`${inner}<${tag} xmi:type="uml:OpaqueBehavior" xmi:id="${xid(s.id)}_${prop}" name="${av(v)}"><body>${esc(v)}</body></${tag}>`);
    }
    const kids = children(s.id);
    const regions = kids.filter((x) => x.kind === 'region');
    const loose = kids.filter((x) => x.kind === 'state' || x.kind === 'transition');
    if (regions.length) {
      for (const r of regions) { written.add(r.id); count('region'); out.push(...region(r.id, r.name, children(r.id), inner, block)); }
      if (loose.length) out.push(...region(`${s.id}_rg`, '', loose, inner, block));
    } else if (loose.length) out.push(...region(`${s.id}_rg`, '', loose, inner, block));
    out.push(`${pad}</subvertex>`);
    return out;
  }
  /** @param {Element} t @param {string} pad @param {Element} block */
  function transition(t, pad, block) {
    written.add(t.id); unplaced(t); count('transition');
    const p = t.props, inner = pad + '  ';
    const out = [`${pad}<transition xmi:type="uml:Transition" xmi:id="${xid(t.id)}"${name(t)} source="${xid(p.from)}" target="${xid(p.to)}">`];
    const trig = String(p.trigger || '').trim();
    if (trig) out.push(`${inner}<trigger xmi:type="uml:Trigger" xmi:id="${xid(t.id)}_tr" name="${av(trig)}" event="${eventId(block, trig)}"/>`);
    const guard = String(p.guard || '').trim();
    if (guard) out.push(`${inner}<guard xmi:type="uml:Constraint" xmi:id="${xid(t.id)}_g"><specification xmi:type="uml:OpaqueExpression" xmi:id="${xid(t.id)}_ge"><body>${esc(guard)}</body></specification></guard>`);
    const eff = String(p.effect || '').trim();
    if (eff) out.push(`${inner}<effect xmi:type="uml:OpaqueBehavior" xmi:id="${xid(t.id)}_ef" name="${av(eff)}"><body>${esc(eff)}</body></effect>`);
    out.push(...comments(t, inner), `${pad}</transition>`);
    return out;
  }
  /** A signal event for a trigger, in the block's package (made on first use). @param {Element} block @param {string} trig */
  function eventId(block, trig) {
    const pkg = /** @type {string} */ (packageOf(block.id));
    const list = events.get(pkg) || events.set(pkg, new Map()).get(pkg);
    let id = list?.get(trig);
    if (!id) { id = fresh(`${xid(pkg)}_ev`); list?.set(trig, id); }
    return id;
  }

  // ---------- activities ----------
  /** @param {Element} e @param {string} pad @param {string} tag @param {boolean} [called] a sub-function's own activity, called by its action @returns {string[]} */
  function activity(e, pad, tag, called = false) {
    const inner = pad + '  ';
    const out = [`${pad}<${tag} xmi:type="uml:Activity" xmi:id="${xid(called ? `${e.id}_act` : e.id)}"${name(e)}>`, ...(called ? [] : comments(e, inner))];
    const kids = children(e.id);
    const flows = kids.filter((x) => x.kind === 'flow');
    /** pins for object flows: "flow id|out" → pin id */
    const pins = new Map();
    const sub = [];
    for (const c of kids) {
      if (c.kind === 'controlNode') {
        written.add(c.id); unplaced(c); count('controlNode');
        out.push(`${inner}<node xmi:type="${NODE[c.props.nodeKind] || 'uml:DecisionNode'}" xmi:id="${xid(c.id)}"${name(c)}/>`);
      } else if (c.kind === 'action') {
        written.add(c.id); unplaced(c); count('action');
        const outs = flows.filter((f) => f.props.flowKind === 'object' && f.props.from === c.id);
        const ins = flows.filter((f) => f.props.flowKind === 'object' && f.props.to === c.id);
        const nested = children(c.id).some((x) => x.kind !== 'comment');
        const pinXml = [
          ...outs.map((f) => { const id = `${xid(f.id)}_out`; pins.set(`${f.id}|out`, id); return `${inner}  <output xmi:type="uml:OutputPin" xmi:id="${id}"${f.props.item ? ` name="${av(f.props.item)}"` : ''}/>`; }),
          ...ins.map((f) => { const id = `${xid(f.id)}_in`; pins.set(`${f.id}|in`, id); return `${inner}  <input xmi:type="uml:InputPin" xmi:id="${id}"${f.props.item ? ` name="${av(f.props.item)}"` : ''}/>`; }),
        ];
        const type = nested ? 'uml:CallBehaviorAction' : 'uml:OpaqueAction';
        const head = `${inner}<node xmi:type="${type}" xmi:id="${xid(c.id)}"${name(c)}${nested ? ` behavior="${xid(c.id)}_act"` : ''}`;
        out.push(...(pinXml.length ? [`${head}>`, ...pinXml, `${inner}</node>`] : [`${head}/>`]));
        if (nested) sub.push(c);
      } else if (c.kind === 'flow') {
        // after the nodes
      } else if (c.kind !== 'comment') other(c);
    }
    for (const f of flows) {
      written.add(f.id); unplaced(f); count('flow');
      const obj = f.props.flowKind === 'object';
      const src = pins.get(`${f.id}|out`) || xid(f.props.from), tgt = pins.get(`${f.id}|in`) || xid(f.props.to);
      const g = String(f.props.guard || '').trim();
      const head = `${inner}<edge xmi:type="uml:${obj ? 'ObjectFlow' : 'ControlFlow'}" xmi:id="${xid(f.id)}"${name(f)} source="${src}" target="${tgt}"`;
      out.push(g ? `${head}><guard xmi:type="uml:LiteralString" xmi:id="${xid(f.id)}_g" value="${av(g)}"/></edge>` : `${head}/>`);
    }
    // a sub-function with steps of its own is an activity of its own, called by its action
    for (const c of sub) out.push(...activity(c, inner, 'ownedBehavior', true));
    out.push(`${pad}</${tag}>`);
    return out;
  }

  // ---------- interactions ----------
  /** @param {Element} e @param {string} pad @param {string} tag */
  function interaction(e, pad, tag) {
    written.add(e.id); unplaced(e);
    const inner = pad + '  ';
    const out = [`${pad}<${tag} xmi:type="uml:Interaction" xmi:id="${xid(e.id)}"${name(e)}>`, ...comments(e, inner)];
    const lifelines = children(e.id).filter((x) => x.kind === 'lifeline');
    // a lifeline represents a property: a part stands for itself; a block or an actor gets one here
    for (const l of lifelines) {
      const rep = l.props.represents ? m.get(l.props.represents) : undefined;
      if (rep && rep.kind !== 'part') out.push(`${inner}<ownedAttribute xmi:type="uml:Property" xmi:id="${xid(l.id)}_rep" name="${av(l.name)}" type="${xid(rep.id)}"/>`);
    }
    for (const l of lifelines) {
      written.add(l.id); unplaced(l); count('lifeline');
      const rep = l.props.represents ? m.get(l.props.represents) : undefined;
      const r = rep ? (rep.kind === 'part' ? xid(rep.id) : `${xid(l.id)}_rep`) : '';
      out.push(`${inner}<lifeline xmi:type="uml:Lifeline" xmi:id="${xid(l.id)}"${name(l)}${r ? ` represents="${r}"` : ''}/>`);
    }
    /** @type {string[]} */
    const messages = [];
    const all = lifelines.map((l) => xid(l.id)).join(' ');
    /** Fragments in order: occurrences for each message, combined fragments with their operands. @param {string} owner @param {string} p */
    const fragments = (owner, p) => {
      const lines = [];
      for (const c of children(owner)) {
        if (c.kind === 'message') {
          written.add(c.id); unplaced(c); count('message');
          const s = `${xid(c.id)}_send`, r = `${xid(c.id)}_recv`;
          lines.push(`${p}<fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="${s}" covered="${xid(c.props.from)}" message="${xid(c.id)}"/>`);
          lines.push(`${p}<fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="${r}" covered="${xid(c.props.to)}" message="${xid(c.id)}"/>`);
          messages.push(`${inner}<message xmi:type="uml:Message" xmi:id="${xid(c.id)}"${name(c)} messageSort="${SORT[c.props.msgKind] || 'synchCall'}" sendEvent="${s}" receiveEvent="${r}"/>`);
        } else if (c.kind === 'fragment') {
          written.add(c.id); unplaced(c); count('fragment');
          lines.push(`${p}<fragment xmi:type="uml:CombinedFragment" xmi:id="${xid(c.id)}"${name(c)} interactionOperator="${av(c.props.operator || 'opt')}"${all ? ` covered="${all}"` : ''}>`);
          for (const o of children(c.id).filter((x) => x.kind === 'operand')) {
            written.add(o.id); unplaced(o); count('operand');
            lines.push(`${p}  <operand xmi:type="uml:InteractionOperand" xmi:id="${xid(o.id)}"${name(o)}>`);
            const g = String(o.props.guard || '').trim();
            if (g) lines.push(`${p}    <guard xmi:type="uml:InteractionConstraint" xmi:id="${xid(o.id)}_g"><specification xmi:type="uml:OpaqueExpression" xmi:id="${xid(o.id)}_ge"><body>${esc(g)}</body></specification></guard>`);
            lines.push(...fragments(o.id, p + '    '), `${p}  </operand>`);
          }
          lines.push(`${p}</fragment>`);
        } else if (owner !== e.id && c.kind !== 'comment') other(c);
      }
      return lines;
    };
    out.push(...fragments(e.id, inner), ...messages);
    for (const c of children(e.id)) if (!['lifeline', 'message', 'fragment', 'comment'].includes(c.kind)) other(c);
    out.push(`${pad}</${tag}>`);
    return out;
  }

  // ---------- units ----------
  /** The instance specification for a unit. @param {string} sym */
  function unitId(sym) {
    let id = units.get(sym);
    if (!id) { id = `_unit_${units.size + 1}`; units.set(sym, id); }
    return id;
  }
  /** A value type for a unit ("Real[Ah]"), for values with a unit and no type. @type {Map<string, string>} */
  const unitTypes = new Map();
  /** @param {string} sym */
  function unitType(sym) {
    let id = unitTypes.get(sym);
    if (!id) { id = `_vt_${unitTypes.size + 1}`; unitTypes.set(sym, id); apply('sysml:ValueType', 'base_DataType', id.slice(1), ` unit="${unitId(sym)}"`); }
    return id;
  }

  // ---------- the document ----------
  const root = m.root();
  const body = [];
  for (const s of m.sets()) body.push(...classifier(s, '    ', 'packagedElement'));
  for (const c of children(root.id)) if (c.kind !== 'package') other(c);
  // relationships, in their packages (now that every element has been written)
  const relLines = (/** @type {string} */ pkg, /** @type {string} */ pad) => {
    const out = [];
    for (const r of relsIn.get(pkg) || []) {
      if (['generalize', 'include', 'extend', 'import'].includes(r.kind)) { if (!written.has(r.id)) skip(`${kindName(r.kind, 'sysml').toLowerCase()} relationships SysML 1.x cannot place`); continue; }
      const a = /** @type {string} */ (r.source), b = /** @type {string} */ (r.target);
      if (!written.has(a) || !written.has(b)) { skip(`${kindName(r.kind, 'sysml').toLowerCase()} relationships to elements that were not exported`); continue; }
      written.add(r.id); count(r.kind);
      if (r.kind === 'participate') {
        out.push(`${pad}<packagedElement xmi:type="uml:Association" xmi:id="${xid(r.id)}" memberEnd="${xid(r.id)}_a ${xid(r.id)}_b">`,
          `${pad}  <ownedEnd xmi:type="uml:Property" xmi:id="${xid(r.id)}_a" type="${xid(a)}" association="${xid(r.id)}"/>`,
          `${pad}  <ownedEnd xmi:type="uml:Property" xmi:id="${xid(r.id)}_b" type="${xid(b)}" association="${xid(r.id)}"/>`,
          `${pad}</packagedElement>`);
        continue;
      }
      out.push(`${pad}<packagedElement xmi:type="uml:Abstraction" xmi:id="${xid(r.id)}" client="${xid(a)}" supplier="${xid(b)}"/>`);
      const st = REL_STEREO[r.kind];
      if (st) apply(st, 'base_Abstraction', r.id);
    }
    const ev = events.get(pkg);
    if (ev) for (const [trig, id] of ev) {
      out.push(`${pad}<packagedElement xmi:type="uml:Signal" xmi:id="${id}_sig" name="${av(trig)}"/>`);
      out.push(`${pad}<packagedElement xmi:type="uml:SignalEvent" xmi:id="${id}" name="${av(trig)}" signal="${id}_sig"/>`);
    }
    return out;
  };
  const lines = body.flatMap((l) => {
    if (!l.startsWith('@@rels:')) return [l];
    const [pkg, pad] = l.slice(7).split('|');
    return relLines(pkg, pad);
  });
  // units: QUDV-style instance specifications, named by their symbol, in a package of their own
  if (units.size) {
    lines.push(`    <packagedElement xmi:type="uml:Package" xmi:id="_units" name="Units">`);
    for (const [sym, id] of unitTypes) lines.push(`      <packagedElement xmi:type="uml:DataType" xmi:id="${id}" name="${av(`Real[${sym}]`)}"/>`);
    for (const [sym, id] of units) lines.push(`      <packagedElement xmi:type="uml:InstanceSpecification" xmi:id="${id}" name="${av(sym)}"/>`);
    lines.push('    </packagedElement>');
  }

  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xmi:XMI xmlns:xmi="${NS.xmi}" xmlns:uml="${NS.uml}" xmlns:sysml="${NS.sysml}" xmlns:StandardProfile="${NS.StandardProfile}">`,
    `  <xmi:Documentation exporter="Pteronautics Loom" exporterVersion="SysML 1.6 XMI"/>`,
    `  <uml:Model xmi:type="uml:Model" xmi:id="${xid(root.id)}" name="${av(root.name)}">`,
    ...(root.props.doc ? [`    <ownedComment xmi:type="uml:Comment" xmi:id="${xid(root.id)}_doc" body="${av(root.props.doc)}"><annotatedElement xmi:idref="${xid(root.id)}"/></ownedComment>`] : []),
    '    <profileApplication xmi:type="uml:ProfileApplication" xmi:id="_sysml_app">',
    `      <appliedProfile href="${NS.sysml}.xmi#SysML"/>`,
    '    </profileApplication>',
    ...lines,
    '  </uml:Model>',
    ...apps,
    '</xmi:XMI>',
    '',
  ].join('\n');
  return { text, counts, skipped };
}

/** A short report of an export, for a dialog. @param {XmiExport} r */
export function exportLines(r) {
  const REL = ['satisfy', 'verify', 'derive', 'refine', 'trace', 'copy', 'allocate', 'generalize', 'include', 'extend', 'participate', 'import'];
  const rels = REL.reduce((n, k) => n + (r.counts[k] || 0), 0);
  const made = Object.entries(r.counts).filter(([k, n]) => n && !REL.includes(k)).map(([k, n]) => plural(n, kindName(k, 'sysml').toLowerCase()));
  if (rels) made.push(plural(rels, 'relationship'));
  const left = Object.entries(r.skipped).map(([what, n]) => `${n} ${what}`);
  return { made, left };
}
