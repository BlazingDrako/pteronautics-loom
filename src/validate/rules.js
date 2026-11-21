// The built-in validation rules, and the rule sets that turn them on.
//
// A rule either checks one element at a time (`kinds` + `check`), or the whole model at once
// (`all`). Checks are pure functions of the model, so the same rules run in tests, in the app
// and (later) in a worker. Each finding names the element it is about, says what is wrong in
// plain words and, where Loom can do it for you, offers a fix.
import { ELEMENTS, kindName, isRel, LAYERS } from '../model/metamodel.js';
import { requirementStatus, duplicateIds, nextReqId } from '../model/trace.js';
import { keyIds } from '../model/paths.js';
import { isUnit } from '../analysis/units.js';
import { parseExpr } from '../analysis/expr.js';
import { analysisOf, hasEquations } from '../analysis/solver.js';
import { checkActivity } from '../sim/activity.js';
import { checkMachine } from '../sim/statemachine.js';
import { checkSequence } from '../sim/sequence.js';
import { canConnect } from '../canvas/connect.js';
import { appliedList, stereoApplies, appliesText } from '../custom/stereo.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {'error' | 'warning' | 'info'} Severity */
/**
 * A quick fix: an edit Loom can make for you (`run`, inside a transaction), or something the
 * app does (`ui`: 'rename' starts renaming the element).
 * @typedef {{ label: string, run?: (m: Model, tx: any) => void, ui?: 'rename' }} Fix
 * @typedef {{ message: string, fix?: Fix, severity?: Severity, ids?: string[] }} Out  what a check returns (or just the message)
 * @typedef {{ id: string, message: string, fix?: Fix, severity?: Severity, ids?: string[] }} Found  what a model-wide rule returns
 */
/**
 * @typedef {{
 *   id: string, title: string, category: string, severity: Severity, help: string,
 *   sets: string[],                       // the rule sets it is on in ('strict' has every rule)
 *   kinds?: string[], check?: (m: Model, e: Element, cx: Context) => string | Out | (string | Out)[] | null | undefined | false,
 *   all?: (m: Model, cx: Context) => Found[],
 * }} Rule
 */

/** What every rule run shares, worked out once per run. */
export class Context {
  /** @param {Model} m */
  constructor(m) {
    this.m = m;
    /** @type {Map<string, import('../model/trace.js').ReqStatus> | null} */ this._status = null;
    /** @type {Set<string> | null} */ this._dups = null;
    /** @type {Set<string> | null} */ this._shown = null;
    /** @type {Set<string> | null} */ this._used = null;
  }
  /** Each requirement's traceability. */
  get status() { return this._status || (this._status = requirementStatus(this.m)); }
  /** Requirement IDs used more than once. */
  get dups() { return this._dups || (this._dups = duplicateIds(this.m)); }
  /** Everything shown on some diagram. */
  get shown() {
    if (this._shown) return this._shown;
    const s = new Set();
    for (const e of this.m.all()) if (e.layout) for (const key of Object.keys(e.layout.nodes)) for (const id of keyIds(key)) s.add(id);
    return (this._shown = s);
  }
  /** Blocks something refers to: a part's type, a generalization, a lifeline, a relationship. */
  get used() {
    if (this._used) return this._used;
    const s = new Set();
    for (const e of this.m.all()) {
      if (isRel(e.kind)) { if (e.source) s.add(e.source); if (e.target) s.add(e.target); continue; }
      for (const [k, p] of Object.entries(ELEMENTS[e.kind].props)) if (p.type === 'ref' && e.props[k]) s.add(e.props[k]);
    }
    return (this._used = s);
  }
}

const S = (/** @type {string} */ k) => kindName(k, 'sysml');
/** Default element names: "Block 3", "Requirement 12". */
const DEFAULT_NAME = new RegExp(`^(${Object.keys(ELEMENTS).map((k) => S(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) \\d+$`);
/** Words that make a requirement impossible to verify (after INCOSE's guide to writing requirements). */
const VAGUE = ['user-friendly', 'user friendly', 'easy', 'easily', 'simple', 'fast', 'quick', 'quickly', 'adequate', 'appropriate', 'as appropriate', 'sufficient', 'sufficiently', 'robust', 'flexible', 'efficient', 'reasonable', 'normal', 'typical', 'approximately', 'about', 'nearly', 'minimize', 'maximize', 'optimize', 'as soon as possible', 'state of the art', 'state-of-the-art', 'best', 'good', 'reliable', 'seamless', 'intuitive', 'etc', 'and so on', 'if possible', 'where possible', 'as required', 'as necessary', 'some', 'several', 'many', 'few', 'large', 'small', 'high', 'low'];
const VAGUE_RE = new RegExp(`(^|[^\\p{L}-])(${VAGUE.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?=$|[^\\p{L}-])`, 'iu');
const TBD_RE = /\b(TBD|TBC|TBR|TBA)\b|\?\?|xx+\b/i;
const MULT_RE = /^(\*|\d+|\d+\.\.(\d+|\*))$/;
/** The layer a kind's elements normally live in, for messages. */
const LAYER_NAME = Object.fromEntries(LAYERS.map((l) => [l.id, l.name]));

/** @param {Element} r */
const reqText = (r) => String(r.props.text || '').trim();
/** Retired requirements are left out of every requirement rule. @param {Element} r */
const live = (r) => r.props.status !== 'Retired';

/** @type {Rule[]} */
export const RULES = [
  // ---------- structure ----------
  {
    id: 'part-untyped', title: 'Parts have a type', category: 'Structure', severity: 'warning', sets: ['recommended'],
    help: 'A part property says which block it is. Without a type it has no ports, parts or values, so it cannot be connected or analysed.',
    kinds: ['part'], check: (m, e) => !e.props.type && `${e.name} has no type: choose the block it is`,
  },
  {
    id: 'port-untyped', title: 'Ports have an interface', category: 'Interfaces', severity: 'warning', sets: ['recommended'],
    help: 'A port typed by an interface block says what crosses it (power, data, force), so Loom can tell which ports may be connected.',
    kinds: ['port'], check: (m, e) => !e.props.type && `${e.name} has no interface: choose what crosses it`,
  },
  {
    id: 'connector-mismatch', title: 'Connected ports are compatible', category: 'Interfaces', severity: 'error', sets: ['recommended'],
    help: 'Both ends of a connector carry the same interface, and one sends while the other receives (or either way).',
    kinds: ['connector'], check: (m, e) => {
      const a = e.props.end1, b = e.props.end2;
      if (!a?.port || !b?.port) return null;
      const pa = m.get(a.port), pb = m.get(b.port);
      if (!pa || !pb) return null;
      const v = canConnect(m, { key: 'a', port: pa, onFrame: !a.path.length }, { key: 'b', port: pb, onFrame: !b.path.length });
      return v.ok ? null : `${e.name}: ${v.reason}`;
    },
  },
  {
    id: 'multiplicity', title: 'Multiplicities are well formed', category: 'Structure', severity: 'error', sets: ['recommended'],
    help: 'A multiplicity is a number (2), a range (0..1, 1..4) or a star for many (*, 1..*).',
    kinds: ['part'], check: (m, e) => {
      const v = String(e.props.multiplicity || '1').trim();
      if (!MULT_RE.test(v)) return `${e.name}: "${v}" is not a multiplicity (use 1, 0..1, 2..4 or 1..*)`;
      const [lo, hi] = v.split('..');
      return hi && hi !== '*' && Number(hi) < Number(lo) ? `${e.name}: the range ${v} goes backwards` : null;
    },
  },
  {
    id: 'composition-cycle', title: 'No block contains itself', category: 'Structure', severity: 'error', sets: ['recommended'],
    help: 'A block cannot have itself as a part, directly or through other blocks: it would be infinitely deep.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      const parts = (/** @type {string} */ b) => m.supersOf(b).flatMap((x) => m.children(x)).filter((c) => c.kind === 'part' && c.props.type);
      for (const b of m.byKind('partDef')) {
        // depth-first from b: does any chain of part types lead back to b?
        const stack = [b.id], seen = new Set();
        let via = '';
        while (stack.length) {
          const x = /** @type {string} */ (stack.pop());
          for (const p of parts(x)) {
            if (p.props.type === b.id) { via = p.name; stack.length = 0; break; }
            if (!seen.has(p.props.type)) { seen.add(p.props.type); stack.push(p.props.type); }
          }
        }
        if (via) out.push({ id: b.id, message: `${b.name} contains itself (through ${via})` });
      }
      return out;
    },
  },
  {
    id: 'generalization-cycle', title: 'No type specializes itself', category: 'Structure', severity: 'error', sets: ['recommended'],
    help: 'Generalization goes one way: a Battery Pack is a kind of Power Source, so a Power Source cannot also be a kind of Battery Pack.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      for (const kind of ['partDef', 'interfaceDef', 'requirement']) for (const e of m.byKind(kind)) {
        const up = (/** @type {string} */ id) => m.relsFrom(id).filter((r) => r.kind === 'generalize').map((r) => /** @type {string} */ (r.target));
        const stack = up(e.id), seen = new Set();
        while (stack.length) {
          const x = /** @type {string} */ (stack.pop());
          if (x === e.id) { out.push({ id: e.id, message: `${e.name} is, through its generalizations, a kind of itself` }); break; }
          if (!seen.has(x)) { seen.add(x); stack.push(...up(x)); }
        }
      }
      return out;
    },
  },
  {
    id: 'block-unused', title: 'Blocks are used', category: 'Structure', severity: 'info', sets: ['recommended'],
    help: 'A block that is not a part of anything, not specialized, not on a diagram and not linked to anything may be left over.',
    kinds: ['partDef', 'interfaceDef'], check: (m, e, cx) => !cx.used.has(e.id) && !cx.shown.has(e.id) && `${e.name} is not used anywhere: no part, port, diagram or relationship refers to it`,
  },
  // ---------- values and analysis ----------
  {
    id: 'unit-unknown', title: 'Units are known', category: 'Analysis', severity: 'warning', sets: ['recommended'],
    help: 'Loom checks units and converts between them. A unit it does not know cannot be used in equations or checks.',
    kinds: ['attribute', 'valueType'], check: (m, e) => {
      const u = String(e.props.unit || '').trim();
      return u && !isUnit(u) ? `${e.name}: Loom does not know the unit "${u}"` : null;
    },
  },
  {
    id: 'value-number', title: 'Values with units are numbers', category: 'Analysis', severity: 'warning', sets: ['recommended'],
    help: 'A value with a unit (16 Ah) must be a number, so equations and checks can use it. Put the unit in the Unit field.',
    kinds: ['attribute'], check: (m, e) => {
      const v = String(e.props.value || '').trim(), u = e.props.unit || (e.props.type ? m.get(e.props.type)?.props.unit : '');
      return v && u && !/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) ? `${e.name}: the value "${v}" is not a number` : null;
    },
  },
  {
    id: 'equation', title: 'Equations can be read', category: 'Analysis', severity: 'error', sets: ['recommended'],
    help: 'A constraint block\'s equation is written like t = E / P, with the names of its parameters.',
    kinds: ['constraintDef'], check: (m, e) => {
      if (!String(e.props.expr || '').trim()) return { message: `${e.name} has no equation yet`, severity: 'warning' };
      try { parseExpr(e.props.expr); return null; } catch (err) { return `${e.name}: ${err instanceof Error ? err.message : err}`; }
    },
  },
  {
    id: 'analysis', title: 'Equations are solved without conflicts', category: 'Analysis', severity: 'error', sets: ['recommended'],
    help: 'The parametric solver\'s findings: a value that breaks an equation, units that do not match, a binding to the wrong kind of quantity.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      const seen = new Set();
      for (const b of m.byKind('partDef')) {
        if (!hasEquations(m, b.id)) continue;
        for (const p of analysisOf(m, b.id).problems) {
          // reported by their own rules: unknown units and equations that cannot be read
          if (/is not a unit Loom knows/.test(p.message) || (p.id && m.get(p.id)?.kind === 'constraintDef')) continue;
          const id = p.id && m.get(p.id) ? p.id : b.id;
          const k = `${id}|${p.message}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ id, message: p.message, severity: p.level === 'error' ? 'error' : 'warning' });
        }
      }
      return out;
    },
  },
  // ---------- requirements ----------
  {
    id: 'req-id', title: 'Requirements have an ID', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'An ID (REQ-001) is how people refer to a requirement in reviews, tests and contracts.',
    kinds: ['requirement'], check: (m, e) => live(e) && !String(e.props.reqId || '').trim() && {
      message: `${e.name} has no ID`,
      fix: { label: 'Give it the next ID', run: (mm, tx) => tx.setProps(e.id, { reqId: nextReqId(mm, /** @type {string} */ (e.owner)) }) },
    },
  },
  {
    id: 'req-duplicate-id', title: 'Requirement IDs are unique', category: 'Requirements', severity: 'error', sets: ['recommended', 'requirements', 'draft'],
    help: 'Two requirements with the same ID make every reference to that ID ambiguous.',
    kinds: ['requirement'], check: (m, e, cx) => {
      const id = String(e.props.reqId || '').trim();
      return id && cx.dups.has(id) && {
        message: `${e.name}: the ID ${id} is used by another requirement too`,
        fix: { label: 'Give it a new ID', run: (mm, tx) => tx.setProps(e.id, { reqId: nextReqId(mm, /** @type {string} */ (e.owner)) }) },
      };
    },
  },
  {
    id: 'req-text', title: 'Requirements have text', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'The text is the requirement: what the system shall do or be. A name alone is not enough to verify against.',
    kinds: ['requirement'], check: (m, e) => live(e) && !reqText(e) && !m.children(e.id).some((c) => c.kind === 'requirement') && `${e.name} has no text`,
  },
  {
    id: 'req-satisfied', title: 'Requirements are satisfied', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'Something in the design (a block or a part) satisfies each requirement, directly or through its sub-requirements.',
    kinds: ['requirement'], check: (m, e, cx) => live(e) && !cx.status.get(e.id)?.satisfied && `${e.name} is not satisfied by anything in the design`,
  },
  {
    id: 'req-verified', title: 'Requirements are verified', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'A test case or a live check verifies each requirement, directly or through its sub-requirements.',
    kinds: ['requirement'], check: (m, e, cx) => live(e) && !cx.status.get(e.id)?.verified && `${e.name} is not verified by any test case or check`,
  },
  {
    id: 'req-failed', title: 'Verification has not failed', category: 'Requirements', severity: 'error', sets: ['recommended', 'requirements', 'draft'],
    help: 'A test case verifying the requirement failed, or its live check is not met by the design.',
    kinds: ['requirement'], check: (m, e, cx) => {
      const st = cx.status.get(e.id);
      if (!st || !live(e) || !st.failed) return null;
      if (st.check?.verdict === 'fail') return `${e.name}: its check is not met (${st.check.message.replace(/^Not met:? ?/, '')})`;
      const failed = st.direct.verify.filter((t) => t.props.result === 'Fail').map((t) => t.name);
      return failed.length ? `${e.name}: ${failed.join(', ')} failed` : `${e.name}: a sub-requirement failed verification`;
    },
  },
  {
    id: 'req-check', title: 'Live checks can run', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'A check such as endurance >= 3 [h] needs the names it uses to be values of what satisfies the requirement.',
    kinds: ['requirement'], check: (m, e, cx) => { const c = cx.status.get(e.id)?.check; return c && c.verdict === 'error' && `${e.name}: the check cannot run (${c.message})`; },
  },
  {
    id: 'req-method', title: 'Approved requirements say how they are verified', category: 'Requirements', severity: 'info', sets: ['recommended', 'requirements'],
    help: 'Once a requirement is approved, its verification method (analysis, test, inspection or demonstration) should be agreed.',
    kinds: ['requirement'], check: (m, e) => e.props.status === 'Approved' && e.props.method === '—' && `${e.name} is approved but has no verification method`,
  },
  {
    id: 'test-verifies', title: 'Test cases verify something', category: 'Requirements', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'A test case that verifies no requirement does not count as evidence for anything.',
    kinds: ['testCase'], check: (m, e) => !m.relsFrom(e.id).some((r) => r.kind === 'verify') && `${e.name} does not verify any requirement`,
  },
  {
    id: 'test-run', title: 'Test cases have been run', category: 'Requirements', severity: 'info', sets: ['requirements'],
    help: 'A test case that has not run yet leaves the requirements it verifies open.',
    kinds: ['testCase'], check: (m, e) => e.props.result === 'Not run' && m.relsFrom(e.id).some((r) => r.kind === 'verify') && `${e.name} has not been run yet`,
  },
  // ---------- requirement wording ----------
  {
    id: 'req-shall', title: 'Requirements use "shall"', category: 'Wording', severity: 'info', sets: ['recommended', 'requirements'],
    help: 'By convention a requirement says the system "shall" do something; "will", "should" or "may" read as intentions or options.',
    kinds: ['requirement'], check: (m, e) => { const t = reqText(e); return live(e) && t && !/\bshall\b/i.test(t) && `${e.name}: the text does not say "shall"`; },
  },
  {
    id: 'req-vague', title: 'Requirements avoid vague words', category: 'Wording', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'Words like fast, easy, adequate or user-friendly cannot be verified. Say how fast, with a number and a unit.',
    kinds: ['requirement'], check: (m, e) => { const hit = live(e) && reqText(e).match(VAGUE_RE); return hit && `${e.name}: "${hit[2]}" is vague; say exactly what is needed`; },
  },
  {
    id: 'req-tbd', title: 'Requirements have no TBDs', category: 'Wording', severity: 'warning', sets: ['recommended', 'requirements'],
    help: 'TBD, TBC and TBR mark something not decided yet. Track them down before the requirement is approved.',
    kinds: ['requirement'], check: (m, e) => { const hit = live(e) && reqText(e).match(TBD_RE); return hit && `${e.name}: "${hit[0]}" is still to be decided`; },
  },
  {
    id: 'req-single', title: 'One requirement says one thing', category: 'Wording', severity: 'info', sets: ['recommended', 'requirements'],
    help: 'Two "shall"s, or "and/or", in one requirement make it hard to verify and trace. Split it into requirements of their own.',
    kinds: ['requirement'], check: (m, e) => { const t = reqText(e); return live(e) && ((t.match(/\bshall\b/gi) || []).length > 1 || /\band\/or\b/i.test(t)) && `${e.name} says more than one thing; consider splitting it`; },
  },
  {
    id: 'req-long', title: 'Requirements are short', category: 'Wording', severity: 'info', sets: ['requirements'],
    help: 'A requirement of more than about 50 words is usually several requirements, or explanation that belongs in the rationale.',
    kinds: ['requirement'], check: (m, e) => { const n = reqText(e).split(/\s+/).filter(Boolean).length; return live(e) && n > 50 && `${e.name} is ${n} words long; move explanation to the rationale or split it`; },
  },
  // ---------- functions and behavior ----------
  {
    id: 'function-allocated', title: 'Functions are allocated', category: 'Behavior', severity: 'warning', sets: ['recommended'],
    help: 'Each function with no sub-functions is allocated to a block or part that performs it (swimlanes on an activity diagram do this).',
    kinds: ['action'], check: (m, e) => {
      if (m.layerOf(e.id) !== 'f' || m.children(e.id).some((c) => c.kind === 'action')) return null;
      const up = [e, ...m.path(e.id)];
      return !up.some((x) => m.relsFrom(x.id).some((r) => r.kind === 'allocate')) && `${e.name} is not allocated to any block or part`;
    },
  },
  {
    id: 'activity', title: 'Activities can run to the end', category: 'Behavior', severity: 'warning', sets: ['recommended'],
    help: 'What Check finds on an activity diagram: no initial node, deadlocks, steps that never run, decisions without guards, tokens that are lost.',
    all: (m, cx) => behavior(m, cx, 'activity', m.byKind('action').filter((a) => m.children(a.id).some((c) => c.kind === 'flow' || c.kind === 'controlNode')), checkActivity),
  },
  {
    id: 'machine', title: 'State machines are well formed', category: 'Behavior', severity: 'warning', sets: ['recommended'],
    help: 'What Check finds on a state machine: no initial state, unreachable or dead-end states, ambiguous transitions.',
    all: (m, cx) => behavior(m, cx, 'machine', m.byKind('partDef').filter((b) => m.children(b.id).some((c) => c.kind === 'state')), checkMachine),
  },
  {
    id: 'sequence', title: 'Scenarios are consistent', category: 'Behavior', severity: 'warning', sets: ['recommended'],
    help: 'What Check finds on a sequence diagram: replies with no call, empty fragments, messages a state machine never accepts.',
    all: (m, cx) => behavior(m, cx, 'sequence', m.byKind('interaction').filter((i) => m.children(i.id).some((c) => c.kind === 'message' || c.kind === 'fragment')), checkSequence),
  },
  // ---------- naming and documentation ----------
  {
    id: 'name-duplicate', title: 'Names are unique where they live', category: 'Naming', severity: 'warning', sets: ['recommended'],
    help: 'Two elements of the same kind with the same name in one place cannot be told apart in the SysML text or in references.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      /** @type {Map<string, Element[]>} */
      const by = new Map();
      for (const e of m.all()) {
        if (isRel(e.kind) || !e.owner || ['connector', 'flow', 'transition', 'binding', 'message', 'comment', 'controlNode'].includes(e.kind)) continue;
        const k = `${e.owner}|${e.kind}|${e.name}`;
        (by.get(k) || by.set(k, []).get(k))?.push(e);
      }
      for (const list of by.values()) if (list.length > 1) for (const e of list.slice(1)) out.push({ id: e.id, message: `${e.name}: another ${S(e.kind).toLowerCase()} in ${m.get(/** @type {string} */ (e.owner))?.name} has the same name`, fix: { label: 'Rename…', ui: 'rename' } });
      return out;
    },
  },
  {
    id: 'name-default', title: 'Elements have real names', category: 'Naming', severity: 'info', sets: ['recommended'],
    help: 'Names like "Block 3" are placeholders. A real name tells the reader what the element is.',
    kinds: Object.keys(ELEMENTS).filter((k) => !['controlNode', 'flow', 'transition', 'connector', 'binding', 'region', 'operand', 'comment'].includes(k) && !ELEMENTS[k].diagram),
    check: (m, e) => !e.layer && DEFAULT_NAME.test(e.name) && { message: `${e.name} still has its default name`, fix: { label: 'Rename…', ui: 'rename' } },
  },
  {
    id: 'name-case', title: 'Types start with a capital letter', category: 'Naming', severity: 'info', sets: [],
    help: 'A common convention: types (blocks, interface blocks, value types) start with a capital letter, usages (parts, ports, values) with a small one.',
    kinds: ['partDef', 'interfaceDef', 'valueType', 'constraintDef', 'part', 'port', 'attribute'],
    check: (m, e) => {
      const def = ['partDef', 'interfaceDef', 'valueType', 'constraintDef'].includes(e.kind), c = e.name.charAt(0);
      if (c.toLowerCase() === c.toUpperCase()) return null;
      if (def && c !== c.toUpperCase()) return `${e.name}: a ${S(e.kind).toLowerCase()} name should start with a capital letter`;
      if (!def && m.get(/** @type {string} */ (e.owner))?.kind !== 'stereotype' && c !== c.toLowerCase()) return `${e.name}: a ${S(e.kind).toLowerCase()} name should start with a small letter`;
      return null;
    },
  },
  {
    id: 'doc-missing', title: 'Blocks and functions are described', category: 'Naming', severity: 'info', sets: [],
    help: 'A sentence of description saves the next reader from guessing what an element is for.',
    kinds: ['partDef', 'interfaceDef', 'action', 'testCase', 'constraintDef', 'stereotype'],
    check: (m, e) => !String(e.props.doc || '').trim() && `${e.name} has no description`,
  },
  // ---------- diagrams ----------
  {
    id: 'diagram-empty', title: 'Diagrams show something', category: 'Diagrams', severity: 'info', sets: ['recommended'],
    help: 'An empty diagram may be left over. Tables, matrices and sequence diagrams are drawn from the model, so they are never empty.',
    kinds: ['bdd', 'req', 'act', 'stm', 'uc', 'pkg', 'par'],
    check: (m, e) => !Object.keys(e.layout?.nodes || {}).length && `${e.name} is empty`,
  },
  // ---------- profiles ----------
  {
    id: 'stereotype-kind', title: 'Stereotypes fit what they are applied to', category: 'Profiles', severity: 'error', sets: ['recommended', 'draft'],
    help: 'When a stereotype is changed to apply to fewer kinds, elements of other kinds that already had it are flagged.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      for (const st of m.byKind('stereotype')) for (const e of m.appliedTo(st.id)) {
        if (!stereoApplies(st, e.kind)) out.push({ id: e.id, message: `${e.name}: «${st.name}» applies to ${appliesText(st)}, not to a ${S(e.kind).toLowerCase()}`, fix: { label: `Remove «${st.name}»`, run: (mm, tx) => { const left = appliedList(mm.get(e.id)).filter((a) => a.s !== st.id); tx.setProps(e.id, { applied: left.length ? left : null }); } } });
      }
      return out;
    },
  },
  {
    id: 'stereotype-tags', title: 'Tagged values are filled in', category: 'Profiles', severity: 'info', sets: ['recommended'],
    help: 'A tag without a default (an empty value in the stereotype) needs a value on each element the stereotype is applied to.',
    all: (m) => {
      /** @type {Found[]} */
      const out = [];
      for (const st of m.byKind('stereotype')) {
        const need = m.children(st.id).filter((c) => c.kind === 'attribute' && !String(c.props.value || '').trim());
        if (!need.length) continue;
        for (const e of m.appliedTo(st.id)) {
          const a = appliedList(e).find((x) => x.s === st.id);
          const missing = need.filter((t) => !String(a?.tags?.[t.id] ?? '').trim()).map((t) => t.name);
          if (missing.length) out.push({ id: e.id, message: `${e.name}: «${st.name}» needs ${missing.join(', ')}` });
        }
      }
      return out;
    },
  },
];

/** Behavior checks are slow (they explore every run), so each owner's result is kept until something inside it changes. */
/** @type {WeakMap<Model, Map<string, { sig: string, found: Found[] }>>} */
const behaviorMemo = new WeakMap();
/**
 * @param {Model} m @param {Context} cx @param {string} tag @param {Element[]} owners
 * @param {(m: Model, id: string) => { level: string, message: string, ids: string[] }[]} fn  'ok' findings (the all-clear summary) are not problems
 */
function behavior(m, cx, tag, owners, fn) {
  let memo = behaviorMemo.get(m);
  if (!memo) behaviorMemo.set(m, memo = new Map());
  /** @type {Found[]} */
  const out = [];
  for (const o of owners) {
    // what the check depends on: everything inside the owner (and, for scenarios, the model version)
    const sig = tag === 'sequence' ? String(m.version()) : subtreeSig(m, o.id);
    const key = `${tag}|${o.id}`;
    let hit = memo.get(key);
    if (!hit || hit.sig !== sig) {
      const found = fn(m, o.id).filter((f) => f.level !== 'ok' && (f.level !== 'info' || !/empty|has no (states|messages)/.test(f.message))).map((f) => ({
        id: f.ids.find((x) => m.get(x) && !isRel(/** @type {Element} */ (m.get(x)).kind)) || o.id,
        message: f.ids.length ? f.message : `${o.name}: ${f.message.charAt(0).toLowerCase()}${f.message.slice(1)}`,
        severity: /** @type {Severity} */ (f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : 'warning'),
        ids: f.ids,
      }));
      hit = { sig, found };
      memo.set(key, hit);
    }
    out.push(...hit.found);
  }
  return out;
}
/** A cheap fingerprint of an element's contents. @param {Model} m @param {string} id */
function subtreeSig(m, id) {
  const parts = [];
  const walk = (/** @type {string} */ x) => { for (const c of m.children(x)) { parts.push(c.id, c.name, JSON.stringify(c.props)); for (const r of m.relsFrom(c.id)) parts.push(r.kind, r.target); walk(c.id); } };
  walk(id);
  return parts.join('|');
}

/** Rule sets: which rules are on, before a project's own changes. */
export const RULE_SETS = [
  { id: 'recommended', name: 'Recommended', note: 'What is broken, and the usual gaps. A good default.' },
  { id: 'strict', name: 'Strict', note: 'Every rule, including naming conventions and descriptions.' },
  { id: 'requirements', name: 'Requirements quality', note: 'Only requirements: IDs, wording, traceability and verification.' },
  { id: 'draft', name: 'Early draft', note: 'Only what is broken (errors), not what is still missing.' },
];
/** Rule categories, in the order the rules dialog lists them. */
export const CATEGORIES = ['Structure', 'Interfaces', 'Analysis', 'Requirements', 'Wording', 'Behavior', 'Naming', 'Diagrams', 'Profiles'];

/** Is a rule on in a set (before overrides)? @param {Rule} r @param {string} set */
export function inSet(r, set) {
  if (set === 'strict') return true;
  if (set === 'draft') return r.severity === 'error';
  return r.sets.includes(set);
}

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
