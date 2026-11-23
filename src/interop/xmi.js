// Importing SysML 1.x models from Cameo Systems Modeler / MagicDraw (and other UML tools that
// write XMI 2.x): .xmi and .xml exports, and .mdzip project files.
//
// Semantics first, as the plan says: packages, requirements (with ID and text), blocks,
// interface blocks, value types, constraint blocks, parts, ports, values with defaults,
// connectors, generalizations, satisfy, verify, derive, refine, trace, copy and allocate,
// activities (actions, control nodes, flows, swimlanes as allocation), state machines,
// use cases and actors, sequence diagrams (lifelines and messages), comments. Diagram layouts
// are Cameo's own format and are not read; everything skipped is counted in the report.
//
// Cameo puts everything in one package tree; Loom has four RFLP layers. Packages are kept
// whole: a package goes to the layer its name says ("Functional Architecture", "Physical",
// "Requirements"…), or else the one most of its contents belong to, and everything in it goes
// along. Only a package with no clear layer (a mix, like a model's top package) is split, each
// element going to the layer of its kind inside a copy of the package path it had.
import { parseXml, kids, kid, all, attr, local, InteropError } from './xml.js';
import { createModel, ModelError } from '../model/model.js';
import { unzip, isZip } from '../storage/zip.js';
import { isUnit } from '../analysis/units.js';
import { kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */

/**
 * The RFLP layer a package's name points to, or null. Checked in this order so that
 * "Functional Requirements" is requirements and "Physical Architecture" is physical.
 * @param {string} name
 */
export function layerFromName(name) {
  const n = name.toLowerCase();
  if (/\b(requirements?|reqs?|needs|specifications?|verification|validation|tests?|test cases|v&v)\b/.test(n)) return 'r';
  if (/\b(physical|hardware|products?|implementation|components?|bom|parts list|cots)\b/.test(n)) return 'p';
  if (/\b(functional|functions?|behaviou?rs?|activit(y|ies)|operations?|operational|scenarios?|use cases?|missions?|conops)\b/.test(n)) return 'f';
  if (/\b(logical|architecture|structure|structural|subsystems?|interfaces?|blocks?)\b/.test(n)) return 'l';
  return null;
}
/**
 * @typedef {{
 *   model: Model, name: string,
 *   counts: Record<string, number>,      // Loom kind → how many were made
 *   skipped: Record<string, number>,     // what was left out → how many
 *   notes: string[],
 * }} XmiReport
 */

/** The XMI document inside an .mdzip (or the file itself). @param {Uint8Array} bytes */
export async function xmiText(bytes) {
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  const files = await unzip(bytes);
  const names = Object.keys(files);
  const pick = names.find((n) => /uml_model\.model$/.test(n)) || names.find((n) => /\.(xmi|uml)$/i.test(n))
    || names.find((n) => { const t = new TextDecoder().decode(files[n].subarray(0, 4000)); return /xmi:XMI|<uml:Model/.test(t); });
  if (!pick) throw new InteropError('This archive has no XMI model in it (expected a Cameo .mdzip or a zip of an .xmi file)');
  return new TextDecoder().decode(files[pick]);
}

/** Stereotype names, as Cameo and other tools spell them (by local element name). */
const REL_STEREO = /** @type {Record<string, string>} */ ({ Satisfy: 'satisfy', Verify: 'verify', DeriveReqt: 'derive', Refine: 'refine', Trace: 'trace', Copy: 'copy', Allocate: 'allocate' });
const BASE = /^base_/;
/** QUDV unit names to symbols. */
const UNIT_NAMES = /** @type {Record<string, string>} */ ({ kilogram: 'kg', gram: 'g', metre: 'm', meter: 'm', kilometre: 'km', kilometer: 'km', millimetre: 'mm', millimeter: 'mm', second: 's', minute: 'min', hour: 'h', watt: 'W', kilowatt: 'kW', volt: 'V', ampere: 'A', 'ampere hour': 'Ah', newton: 'N', joule: 'J', 'watt hour': 'Wh', 'kilowatt hour': 'kWh', pascal: 'Pa', kelvin: 'K', hertz: 'Hz', 'metre per second': 'm/s', 'meter per second': 'm/s', degree: 'deg', radian: 'rad', percent: '%' });

/**
 * Build a Loom model from XMI text.
 * @param {string} text @returns {XmiReport}
 */
export function importXmi(text) {
  const doc = parseXml(text, 'XMI file');
  // ---------- index ----------
  /** @type {Map<string, Element>} */
  const byId = new Map();
  for (const el of doc.getElementsByTagName('*')) { const id = attr(el, 'id'); if (id) byId.set(id, el); }
  const umlModel = [...doc.getElementsByTagName('*')].find((el) => local(el) === 'Model' || attr(el, 'type') === 'uml:Model');
  if (!umlModel) throw new InteropError('This XMI file has no UML model in it (no uml:Model)');
  /** stereotypes applied, by the id of the element they apply to: local names ("Block", "Requirement") and the application element */
  /** @type {Map<string, { name: string, el: Element }[]>} */
  const stereo = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    for (const a of el.attributes) {
      if (!BASE.test(a.localName)) continue;
      const list = stereo.get(a.value) || [];
      list.push({ name: local(el), el });
      stereo.set(a.value, list);
    }
  }
  const has = (/** @type {string | null} */ id, /** @type {RegExp} */ re) => !!id && (stereo.get(id) || []).some((s) => re.test(s.name));
  /** The XMI type ("uml:Port"); not the plain type="…" attribute, which is a UML property's type. @param {Element} el */
  const typeOf = (el) => { for (const a of el.attributes) if (a.localName === 'type' && (a.prefix === 'xmi' || /XMI/i.test(a.namespaceURI || ''))) return a.value; return ''; };
  /** An id-valued property: an attribute (type="id"), or a child (<type xmi:idref="id"/>). @param {Element} el @param {string} name */
  const ref = (el, name) => { const a = el.getAttribute(name); if (a && byId.has(a.split(' ')[0])) return a.split(' ')[0]; const c = kid(el, name); return c ? (attr(c, 'idref') || null) : null; };
  /** Several ids (client="a b", or <client xmi:idref=…/> children). @param {Element} el @param {string} name */
  const refs = (el, name) => { const a = el.getAttribute(name); const out = a ? a.split(/\s+/).filter(Boolean) : []; for (const c of kids(el, name)) { const r = attr(c, 'idref'); if (r) out.push(r); } return out; };

  // ---------- what each element becomes ----------
  /** @param {Element} el @returns {string | null} a Loom kind, or null to skip */
  function kindOf(el) {
    const t = typeOf(el), id = attr(el, 'id');
    if (t === 'uml:Package' || t === 'uml:Model') return 'package';
    if (t === 'uml:Profile') return null;
    if (has(id, /Requirement$/)) return 'requirement';
    if (has(id, /^TestCase$/)) return 'testCase';
    if (t === 'uml:Class' || t === 'uml:Component') {
      if (has(id, /^InterfaceBlock$/)) return 'interfaceDef';
      if (has(id, /^ConstraintBlock$/)) return 'constraintDef';
      return 'partDef';
    }
    if (t === 'uml:InterfaceBlock') return 'interfaceDef';
    if (t === 'uml:Interface') return 'interfaceDef';
    if (t === 'uml:DataType' || t === 'uml:Enumeration' || t === 'uml:PrimitiveType') return 'valueType';
    if (t === 'uml:Activity') return 'action';
    if (t === 'uml:Actor') return 'actor';
    if (t === 'uml:UseCase') return 'useCase';
    if (t === 'uml:Interaction') return 'interaction';
    return null;
  }
  const LAYER_OF = /** @type {Record<string, string>} */ ({ requirement: 'r', testCase: 'r', actor: 'r', useCase: 'r', action: 'f', interaction: 'f' });

  const m = createModel({ name: attr(umlModel, 'name') || 'Imported model' });
  const layerId = Object.fromEntries(m.layers().map((l) => [/** @type {string} */ (l.layer), l.id]));
  /** The sets by name, lower case → layer. */
  const setByName = new Map(m.layers().map((l) => [l.name.toLowerCase(), /** @type {string} */ (l.layer)]));
  /** @type {Map<string, string>} xmi id → Loom id */
  const made = new Map();
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, number>} */
  const skipped = {};
  /** @type {string[]} */
  const notes = [];
  const skip = (/** @type {string} */ what, n = 1) => { skipped[what] = (skipped[what] || 0) + n; };
  /** Package copies per layer: "layer|xmi package id" → Loom package id. */
  const pkgCopy = new Map();
  /** Every XMI element's XMI owner (for package paths). */
  const ownerOf = (/** @type {Element} */ el) => { let p = el.parentElement; while (p && !attr(p, 'id')) p = p.parentElement; return p; };

  // ---------- which layer each package belongs to ----------
  const classifierTags = ['packagedElement', 'nestedClassifier', 'ownedBehavior', 'ownedUseCase'];
  /** An activity owned by an activity and called by one of its actions: read into that action, not on its own. @param {Element} el */
  const calledSub = (el) => typeOf(el) === 'uml:Activity' && local(el) === 'ownedBehavior' && !!el.parentElement && typeOf(el.parentElement) === 'uml:Activity'
    && kids(el.parentElement, 'node').some((n) => ref(n, 'behavior') === attr(el, 'id'));
  const allClassifiers = [...umlModel.getElementsByTagName('*')].filter((el) => classifierTags.includes(local(el)) && kindOf(el) && kindOf(el) !== 'package' && !calledSub(el));
  /** Per package: how many elements inside it (at any depth) each layer would take. @type {Map<Element, Record<string, number>>} */
  const tally = new Map();
  for (const el of allClassifiers) {
    const layer = LAYER_OF[/** @type {string} */ (kindOf(el))] || 'l';
    for (let p = ownerOf(el); p && p !== umlModel; p = ownerOf(p)) {
      if (kindOf(p) !== 'package') continue;
      const t = tally.get(p) || tally.set(p, { r: 0, f: 0, l: 0, p: 0 }).get(p);
      if (t) t[layer]++;
    }
  }
  /** @type {Map<Element, { layer: string | null, why: string }>} */
  const decided = new Map();
  /** The layer a package belongs to, or null when it is a mix to split. @param {Element} xp @returns {string | null} */
  const packageLayer = (xp) => {
    const known = decided.get(xp);
    if (known) return known.layer;
    const named = layerFromName(attr(xp, 'name') || '');
    const parent = ownerOf(xp);
    const up = parent && parent !== umlModel && kindOf(parent) === 'package' ? packageLayer(parent) : null;
    // a top-level package named exactly like a set ("Requirements", "Logical", as Loom writes
    // them) is that set, and everything in it stays there whatever its own name says
    const exact = parent === umlModel ? setByName.get((attr(xp, 'name') || '').trim().toLowerCase()) : undefined;
    if (exact) { const d = { layer: exact, why: 'its set' }; decided.set(xp, d); return exact; }
    if (up && parent && /set$/.test(decided.get(parent)?.why || '')) { const d = { layer: up, why: 'in its set' }; decided.set(xp, d); return up; }
    const t = tally.get(xp);
    const total = t ? t.r + t.f + t.l + t.p : 0;
    const top = t ? /** @type {string} */ (Object.entries(t).sort((a, b) => b[1] - a[1])[0][0]) : null;
    /** @type {{ layer: string | null, why: string }} */
    const d = named ? { layer: named, why: 'its name' }
      : up ? { layer: up, why: 'its package' }
        : t && top && total && t[top] / total >= 0.6 ? { layer: top, why: 'what it holds' }
          : { layer: null, why: '' };
    decided.set(xp, d);
    return d.layer;
  };

  m.transact('Import XMI', (tx) => {
    /** Make an element, counting it, or note why it could not be made. @param {string} kind @param {string} owner @param {Record<string, any>} o @param {string} [xid] */
    const make = (kind, owner, o, xid) => {
      try {
        const id = tx.create(kind, { owner, ...o });
        counts[kind] = (counts[kind] || 0) + 1;
        if (xid) made.set(xid, id);
        return id;
      } catch (e) {
        if (!(e instanceof ModelError)) throw e;
        skip(`${kindName(kind, 'sysml')} that Loom cannot place (${e.message})`);
        return null;
      }
    };
    /** The Loom package for an XMI package, in a layer (made on first use). @param {Element | null} xp @param {string} layer @returns {string} */
    const pkgIn = (xp, layer) => {
      if (!xp || xp === umlModel || !umlModel.contains(xp)) return layerId[layer];
      if (kindOf(xp) !== 'package') return pkgIn(ownerOf(xp), layer);
      const key = `${layer}|${attr(xp, 'id')}`;
      let id = pkgCopy.get(key);
      // a top-level package named like the layer it goes to (as Loom's own exports are) is that layer
      if (!id && ownerOf(xp) === umlModel && (attr(xp, 'name') || '').trim().toLowerCase() === (m.get(layerId[layer])?.name || '').toLowerCase()) {
        id = layerId[layer];
        pkgCopy.set(key, id);
      }
      if (!id) {
        const parent = pkgIn(ownerOf(xp), layer);
        id = /** @type {string} */ (make('package', parent, { name: attr(xp, 'name') || 'Package' }));
        pkgCopy.set(key, id);
      }
      return id;
    };
    /** The nearest XMI package holding an element. @param {Element} el */
    const packageOf = (el) => { let p = ownerOf(el); while (p && p !== umlModel && kindOf(p) !== 'package') p = ownerOf(p); return p; };
    const nameOf = (/** @type {Element} */ el, /** @type {string} */ fallback) => (attr(el, 'name') || '').trim() || fallback;
    const docOf = (/** @type {Element} */ el) => kids(el, 'ownedComment').map((c) => (c.getAttribute('body') ?? kid(c, 'body')?.textContent ?? '').trim()).filter(Boolean).join('\n\n');

    // ---------- 1. classifiers: requirements, blocks, value types, activities, use cases… ----------
    const classifiers = allClassifiers;
    // a requirement inside a requirement keeps that nesting; everything else goes to its package
    const ordered = classifiers.sort((a, b) => depth(a) - depth(b));
    function depth(/** @type {Element} */ el) { let d = 0; for (let p = el.parentElement; p; p = p.parentElement) d++; return d; }
    for (const el of ordered) {
      const kind = /** @type {string} */ (kindOf(el)), xid = /** @type {string} */ (attr(el, 'id'));
      const xo = ownerOf(el);
      const xpkg = packageOf(el);
      let owner = pkgIn(xpkg, (xpkg && xpkg !== umlModel && packageLayer(xpkg)) || LAYER_OF[kind] || 'l');
      if (kind === 'requirement' && xo && made.has(attr(xo, 'id') || '') && m.get(/** @type {string} */ (made.get(/** @type {string} */ (attr(xo, 'id')))))?.kind === 'requirement') owner = /** @type {string} */ (made.get(/** @type {string} */ (attr(xo, 'id'))));
      if ((kind === 'interaction' || kind === 'useCase') && xo && made.get(attr(xo, 'id') || '') && m.get(/** @type {string} */ (made.get(/** @type {string} */ (attr(xo, 'id')))))?.kind === 'partDef') owner = /** @type {string} */ (made.get(/** @type {string} */ (attr(xo, 'id'))));
      /** @type {Record<string, any>} */
      const props = {};
      const d = docOf(el);
      if (kind === 'requirement') {
        const app = (stereo.get(xid) || []).find((s) => /Requirement$/.test(s.name))?.el;
        const field = (/** @type {string} */ n) => (app ? (app.getAttribute(n) ?? kid(app, n)?.textContent ?? '') : '').trim();
        props.reqId = field('Id') || field('id');
        props.text = field('Text') || field('text') || d;
        if (d && props.text !== d) props.doc = d;
      } else if (d) props.doc = d;
      if (kind === 'valueType') {
        const app = (stereo.get(xid) || []).find((s) => s.name === 'ValueType')?.el;
        const unitRef = app ? ref(app, 'unit') : null;
        const unitEl = unitRef ? byId.get(unitRef) : null;
        const sym = unitEl ? symbolOf(unitEl) : '';
        if (sym) props.unit = sym;
        if (typeOf(el) === 'uml:Enumeration') {
          const lits = kids(el, 'ownedLiteral').map((l) => attr(l, 'name')).filter(Boolean);
          if (lits.length) props.doc = [d, `Values: ${lits.join(', ')}`].filter(Boolean).join('\n\n');
        }
      }
      if (kind === 'constraintDef') {
        const spec = kids(el, 'ownedRule').map((r) => kid(r, 'specification')).find(Boolean);
        const body = spec ? (spec.getAttribute('body') ?? kid(spec, 'body')?.textContent ?? '') : '';
        if (body.trim()) props.expr = body.trim().replace(/==/g, '=');
      }
      make(kind, owner, { name: nameOf(el, kindName(kind, 'sysml')), props }, xid);
    }
    for (const el of [...umlModel.getElementsByTagName('*')].filter((x) => local(x) === 'packagedElement' && ['uml:Signal', 'uml:InstanceSpecification', 'uml:Collaboration', 'uml:Stereotype', 'uml:Enumeration'].includes(typeOf(x)) && !made.has(attr(x, 'id') || ''))) skip(`${typeOf(el).replace('uml:', '')} elements`);
    // empty packages still matter (a structure people expect to see): keep them in Logical
    for (const el of [...umlModel.getElementsByTagName('*')].filter((x) => local(x) === 'packagedElement' && typeOf(x) === 'uml:Package')) {
      const any = [...pkgCopy.keys()].some((k) => k.endsWith(`|${attr(el, 'id')}`));
      if (!any && !el.querySelector('*')) pkgIn(el, packageLayer(el) || 'l');
    }

    // ---------- 2. features: parts, values, ports, constraint properties ----------
    for (const [xid, lid] of [...made]) {
      const el = /** @type {Element} */ (byId.get(xid)), le = m.get(lid);
      if (!le || !['partDef', 'interfaceDef', 'constraintDef', 'requirement'].includes(le.kind)) continue;
      for (const p of kids(el, 'ownedAttribute')) {
        const pid = /** @type {string} */ (attr(p, 'id'));
        const tid = ref(p, 'type');
        const target = tid ? made.get(tid) : undefined;
        const tk = target ? m.get(target)?.kind : undefined;
        const name = nameOf(p, '');
        if (typeOf(p) === 'uml:Port') {
          if (le.kind !== 'partDef' && le.kind !== 'interfaceDef') { skip('ports on other elements'); continue; }
          make('port', lid, { name: name || 'port', props: { type: tk === 'interfaceDef' ? target : null, conjugated: p.getAttribute('isConjugated') === 'true', portKind: has(pid, /^FullPort$/) ? 'full' : 'proxy' } }, pid);
          if (tid && tk !== 'interfaceDef') skip('port types that are not interface blocks');
          continue;
        }
        if (p.getAttribute('association') && !name) { skip('unnamed association ends'); continue; }
        if (tk === 'partDef' && le.kind === 'partDef') {
          const up = p.getAttribute('upperValue') || kid(p, 'upperValue')?.getAttribute('value');
          const lo = p.getAttribute('lowerValue') || kid(p, 'lowerValue')?.getAttribute('value');
          const mult = multiplicity(lo, up);
          make('part', lid, { name: name || 'part', props: { type: target, multiplicity: mult } }, pid);
          if (p.getAttribute('aggregation') !== 'composite') skip('reference properties (imported as parts)');
          continue;
        }
        if (tk === 'constraintDef' && le.kind === 'partDef') { make('constraint', lid, { name: name || 'constraint', props: { type: target } }, pid); continue; }
        if (tk === 'interfaceDef' || tk === 'requirement' || tk === 'action') { skip('properties typed by something that is not a block or value type'); continue; }
        // a value property: typed by a value type, a primitive, or nothing
        const dv = kid(p, 'defaultValue');
        let value = dv ? (dv.getAttribute('value') ?? kid(dv, 'value')?.textContent ?? '') : '';
        if (dv && typeOf(dv) === 'uml:LiteralBoolean' && !value) value = 'false';
        /** @type {Record<string, any>} */
        const props = { value: String(value).trim() };
        if (tk === 'valueType') props.type = target;
        make('attribute', lid, { name: name || 'value', props }, pid);
      }
    }

    // ---------- 3. generalizations and relationships ----------
    let rels = 0;
    const link = (/** @type {string} */ kind, /** @type {string | undefined} */ a, /** @type {string | undefined} */ b, /** @type {string} */ what) => {
      if (!a || !b) { skip(`${what} to elements that were not imported`); return; }
      if (!m.canLink(kind, a, b)) { if (!m.relsFrom(a).some((r) => r.kind === kind && r.target === b)) skip(`${what} between kinds Loom does not relate that way`); return; }
      tx.link(kind, a, b); rels++;
    };
    for (const g of [...umlModel.getElementsByTagName('*')].filter((x) => local(x) === 'generalization')) {
      const spec = ownerOf(g);
      link('generalize', made.get(attr(/** @type {Element} */ (spec), 'id') || ''), made.get(ref(g, 'general') || ''), 'Generalizations');
    }
    // ---------- 4. connectors ----------
    for (const [xid, lid] of [...made]) {
      if (m.get(lid)?.kind !== 'partDef') continue;
      const el = /** @type {Element} */ (byId.get(xid));
      for (const c of kids(el, 'ownedConnector')) {
        const ends = kids(c, 'end');
        if (ends.length !== 2) { skip('connectors without two ends'); continue; }
        if (has(attr(c, 'id'), /^BindingConnector$/)) { skip('binding connectors (bind parameters on a parametric diagram)'); continue; }
        const endOf = (/** @type {Element} */ e) => {
          const role = made.get(ref(e, 'role') || ''), pw = made.get(ref(e, 'partWithPort') || '');
          const re = role ? m.get(role) : undefined;
          if (!re) return null;
          if (re.kind === 'port') return { path: pw ? [pw] : [], port: role };
          if (re.kind === 'part') return { path: [role], port: null };
          return null;
        };
        const e1 = endOf(ends[0]), e2 = endOf(ends[1]);
        if (!e1 || !e2) { skip('connectors to elements that were not imported'); continue; }
        if (has(attr(ends[0], 'id'), /NestedConnectorEnd/) || has(attr(ends[1], 'id'), /NestedConnectorEnd/)) { skip('nested connector ends (through more than one part)'); continue; }
        make('connector', lid, { name: nameOf(c, ''), props: { end1: e1, end2: e2 } }, attr(c, 'id') || undefined);
      }
    }
    // a connector with no name gets the default one
    for (const c of m.byKind('connector')) if (!c.name) tx.rename(c.id, `${endName(m, c.props.end1)} → ${endName(m, c.props.end2)}`);

    // ---------- 5. activities ----------
    for (const [xid, lid] of [...made]) {
      if (m.get(lid)?.kind !== 'action' || typeOf(/** @type {Element} */ (byId.get(xid))) !== 'uml:Activity') continue;
      readActivity(/** @type {Element} */ (byId.get(xid)), lid);
    }
    /** An activity's nodes, flows and swimlanes, into a Loom action. @param {Element} act @param {string} lid */
    function readActivity(act, lid) {
      /** pins → the action they belong to */
      const pinOwner = new Map();
      const NODE = /** @type {Record<string, string>} */ ({ 'uml:InitialNode': 'initial', 'uml:ActivityFinalNode': 'final', 'uml:FlowFinalNode': 'flowFinal', 'uml:DecisionNode': 'decision', 'uml:MergeNode': 'merge', 'uml:ForkNode': 'fork', 'uml:JoinNode': 'join' });
      for (const n of kids(act, 'node')) {
        const t = typeOf(n), nid = /** @type {string} */ (attr(n, 'id'));
        if (NODE[t]) { make('controlNode', lid, { name: nameOf(n, ({ initial: 'Initial', final: 'Final', flowFinal: 'Flow final', decision: 'Decision', merge: 'Merge', fork: 'Fork', join: 'Join' })[NODE[t]] || 'Node'), props: { nodeKind: NODE[t] } }, nid); continue; }
        if (/Action$/.test(t)) {
          const beh = ref(n, 'behavior');
          const fallback = beh ? attr(/** @type {Element} */ (byId.get(beh)), 'name') || 'Action' : 'Action';
          const aid = make('action', lid, { name: nameOf(n, fallback) }, nid);
          const called = beh ? byId.get(beh) : undefined;
          if (aid && called && calledSub(called)) readActivity(called, aid);
          for (const pin of n.children) if (/Pin$/.test(typeOf(pin))) pinOwner.set(attr(pin, 'id'), nid);
          continue;
        }
        if (/Pin$|ParameterNode|CentralBuffer|DataStore/.test(t)) { skip('object nodes and parameter nodes'); continue; }
        skip(`${t.replace('uml:', '')} nodes`);
      }
      for (const e of kids(act, 'edge')) {
        const src = made.get(pinOwner.get(ref(e, 'source')) || ref(e, 'source') || ''), tgt = made.get(pinOwner.get(ref(e, 'target')) || ref(e, 'target') || '');
        if (!src || !tgt) { skip('flows to nodes that were not imported'); continue; }
        const guard = kid(e, 'guard');
        const g = guard ? (guard.getAttribute('value') ?? guard.getAttribute('body') ?? kid(guard, 'body')?.textContent ?? '') : '';
        const sn = m.get(src)?.name, tn = m.get(tgt)?.name;
        make('flow', lid, { name: nameOf(e, `${sn} → ${tn}`), props: { from: src, to: tgt, flowKind: typeOf(e) === 'uml:ObjectFlow' ? 'object' : 'control', guard: g === 'true' ? '' : String(g).trim() } }, attr(e, 'id') || undefined);
      }
      // swimlanes: each partition represents a block or part; its actions are allocated to it
      for (const g of [...kids(act, 'group'), ...kids(act, 'partition')].filter((x) => typeOf(x) === 'uml:ActivityPartition')) {
        const rep = made.get(ref(g, 'represents') || '');
        for (const nid of refs(g, 'node')) { const a = made.get(nid); if (a && m.get(a)?.kind === 'action' && rep) link('allocate', a, rep, 'Swimlane allocations'); }
      }
    }

    // ---------- 6. state machines (owned by blocks) ----------
    for (const [xid, lid] of [...made]) {
      if (m.get(lid)?.kind !== 'partDef') continue;
      for (const sm of kids(/** @type {Element} */ (byId.get(xid)), 'ownedBehavior').filter((b) => typeOf(b) === 'uml:StateMachine')) {
        const regions = kids(sm, 'region');
        if (regions.length > 1) notes.push(`${m.get(lid)?.name}: its state machine has ${regions.length} top-level regions; their states are imported side by side`);
        /** @type {Element[]} */
        const transitions = [];
        const PSEUDO = /** @type {Record<string, string>} */ ({ initial: 'initial', choice: 'choice', junction: 'choice', deepHistory: 'history', shallowHistory: 'history' });
        const vertices = (/** @type {Element} */ region, /** @type {string} */ owner) => {
          for (const v of kids(region, 'subvertex')) {
            const t = typeOf(v), vid = /** @type {string} */ (attr(v, 'id'));
            let stateKind = 'state';
            if (t === 'uml:FinalState') stateKind = 'final';
            else if (t === 'uml:Pseudostate') { const k = PSEUDO[v.getAttribute('kind') || 'initial']; if (!k) { skip(`${v.getAttribute('kind')} pseudo-states`); continue; } stateKind = k; }
            const beh = (/** @type {string} */ n) => { const b = kid(v, n); return b ? (attr(b, 'name') || b.getAttribute('body') || kid(b, 'body')?.textContent || '').trim() : ''; };
            const sid = make('state', owner, { name: nameOf(v, stateKind === 'state' ? 'State' : stateKind[0].toUpperCase() + stateKind.slice(1)), props: { stateKind, entry: beh('entry'), do: beh('doActivity'), exit: beh('exit') } }, vid);
            if (!sid) continue;
            const inner = kids(v, 'region');
            if (inner.length === 1) vertices(inner[0], sid);
            else for (const r of inner) { const rid = make('region', sid, { name: nameOf(r, 'Region') }, attr(r, 'id') || undefined); if (rid) vertices(r, rid); }
            transitions.push(...inner.flatMap((r) => kids(r, 'transition')));
          }
        };
        for (const r of regions) { vertices(r, lid); transitions.push(...kids(r, 'transition')); }
        for (const t of transitions) {
          const from = made.get(ref(t, 'source') || ''), to = made.get(ref(t, 'target') || '');
          if (!from || !to) { skip('transitions to states that were not imported'); continue; }
          const trig = kid(t, 'trigger');
          const ev = trig ? (attr(trig, 'name') || attr(/** @type {Element} */ (byId.get(ref(trig, 'event') || '') || trig), 'name') || '') : '';
          const gs = kid(kid(t, 'guard') || t, 'specification');
          const guard = gs ? (gs.getAttribute('body') ?? kid(gs, 'body')?.textContent ?? gs.getAttribute('value') ?? '') : '';
          const eff = kid(t, 'effect');
          // a transition lives where its source state lives
          const owner = /** @type {string} */ (m.get(from)?.owner);
          make('transition', owner, { name: nameOf(t, `${m.get(from)?.name} → ${m.get(to)?.name}`), props: { from, to, trigger: ev.trim(), guard: String(guard).trim(), effect: eff ? (attr(eff, 'name') || '').trim() : '' } }, attr(t, 'id') || undefined);
        }
      }
    }

    // ---------- 7. interactions: lifelines and messages, in order ----------
    for (const [xid, lid] of [...made]) {
      if (m.get(lid)?.kind !== 'interaction') continue;
      const it = /** @type {Element} */ (byId.get(xid));
      for (const l of kids(it, 'lifeline')) {
        // a lifeline represents a property: a part Loom made, or one typed by a block or an actor
        const rid = ref(l, 'represents') || '';
        const prop = byId.get(rid);
        const rep = made.get(rid) || (prop ? made.get(ref(prop, 'type') || '') : undefined);
        const rk = rep ? m.get(rep)?.kind : undefined;
        make('lifeline', lid, { name: nameOf(l, 'lifeline'), props: { represents: rk === 'part' || rk === 'partDef' || rk === 'actor' ? rep : null } }, attr(l, 'id') || undefined);
      }
      /** occurrence → lifeline */
      const covered = new Map(kids(it, 'fragment').map((f) => [attr(f, 'id'), ref(f, 'covered')]));
      if (kids(it, 'fragment').some((f) => typeOf(f) === 'uml:CombinedFragment')) skip('combined fragments in sequence diagrams (messages inside are imported in order)');
      const allFrags = all(it, 'fragment');
      for (const f of allFrags) if (!covered.has(attr(f, 'id'))) covered.set(attr(f, 'id'), ref(f, 'covered'));
      const SORT = /** @type {Record<string, string>} */ ({ synchCall: 'sync', asynchCall: 'async', asynchSignal: 'async', reply: 'reply', createMessage: 'create', deleteMessage: 'async' });
      for (const msg of kids(it, 'message')) {
        const from = made.get(covered.get(ref(msg, 'sendEvent')) || ''), to = made.get(covered.get(ref(msg, 'receiveEvent')) || '');
        if (!from || !to) { skip('messages without both lifelines (gates, lost and found messages)'); continue; }
        make('message', lid, { name: nameOf(msg, 'message'), props: { from, to, msgKind: SORT[msg.getAttribute('messageSort') || 'synchCall'] || 'sync' } }, attr(msg, 'id') || undefined);
      }
    }
    // dependencies (satisfy, verify, derive, refine, trace, copy, allocate), now that actions,
    // states and messages exist too
    for (const d of [...doc.getElementsByTagName('*')].filter((x) => ['uml:Abstraction', 'uml:Dependency', 'uml:Realization', 'uml:Usage'].includes(typeOf(x)))) {
      const did = /** @type {string} */ (attr(d, 'id'));
      const st = (stereo.get(did) || []).map((s) => REL_STEREO[s.name]).find(Boolean) || 'trace';
      const clients = refs(d, 'client'), suppliers = refs(d, 'supplier');
      for (const c of clients) for (const s of suppliers) {
        const a = made.get(c), b = made.get(s);
        if (st === 'allocate') link('allocate', a, b, 'Allocations');
        else link(st, a, b, `«${st}» relationships`);
      }
    }
    // use case relationships
    for (const uc of [...made].filter(([, l]) => m.get(l)?.kind === 'useCase')) {
      const el = /** @type {Element} */ (byId.get(uc[0]));
      for (const inc of kids(el, 'include')) link('include', uc[1], made.get(ref(inc, 'addition') || ''), 'Includes');
      for (const ex of kids(el, 'extend')) link('extend', uc[1], made.get(ref(ex, 'extendedCase') || ''), 'Extends');
    }
    for (const as of [...doc.getElementsByTagName('*')].filter((x) => typeOf(x) === 'uml:Association')) {
      const ends = refs(as, 'memberEnd').map((id) => byId.get(id)).filter(Boolean).map((e) => made.get(ref(/** @type {Element} */ (e), 'type') || '')).filter(Boolean);
      const actor = ends.find((x) => m.get(/** @type {string} */ (x))?.kind === 'actor'), useCase = ends.find((x) => m.get(/** @type {string} */ (x))?.kind === 'useCase');
      if (actor && useCase) link('participate', actor, useCase, 'Actor associations');
    }
    counts.relationships = rels;

    // ---------- what was not read ----------
    const diagrams = [...doc.getElementsByTagName('*')].filter((x) => typeOf(x) === 'uml:Diagram' || local(x) === 'ownedDiagram').length;
    if (diagrams) skip('diagram layouts (Cameo\'s own format: open the elements on new Loom diagrams)', diagrams);
  });
  m.clear();
  const LAYER_NAMES = /** @type {Record<string, string>} */ ({ r: 'Requirements', f: 'Functional', l: 'Logical', p: 'Physical' });
  for (const [xp, d] of decided) {
    if (d.why === 'its name' || d.why === 'what it holds') notes.unshift(`Package “${attr(xp, 'name') || 'Package'}” went to ${LAYER_NAMES[/** @type {string} */ (d.layer)]}, by ${d.why}`);
  }
  return { model: m, name: m.root().name, counts, skipped, notes };

  /** @param {Element} u a QUDV unit (an instance specification) */
  function symbolOf(u) {
    for (const slot of all(u, 'slot')) {
      const f = byId.get(ref(slot, 'definingFeature') || '');
      if (f && /symbol/i.test(attr(f, 'name') || '')) { const v = kid(slot, 'value'); const s = v ? (v.getAttribute('value') ?? '') : ''; if (s && isUnit(s)) return s; }
    }
    const n = (attr(u, 'name') || '').trim();
    if (isUnit(n)) return n;
    return UNIT_NAMES[n.toLowerCase()] || '';
  }
}

/** "1", "0..1", "*", "2..4" from UML bounds. @param {string | null | undefined} lo @param {string | null | undefined} up */
function multiplicity(lo, up) {
  const l = lo ?? '1', u = up ?? (lo ?? '1');
  const U = u === '-1' ? '*' : u;
  if (l === U) return l;
  if (l === '0' && U === '*') return '*';
  return `${l}..${U}`;
}
/** @param {Model} m @param {any} end */
const endName = (m, end) => [...end.path, ...(end.port ? [end.port] : [])].map((id) => m.get(id)?.name).join('.');

/** "1 activity", "3 activities", "2 value properties", "4 blocks". @param {number} n @param {string} word */
export function plural(n, word) {
  if (n === 1) return `${n} ${word}`;
  if (/[^aeiou]y$/.test(word)) return `${n} ${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(word)) return `${n} ${word}es`;
  return `${n} ${word}s`;
}
/** A short report of an import, for a dialog. @param {XmiReport} r */
export function reportLines(r) {
  const made = Object.entries(r.counts).filter(([, n]) => n).map(([k, n]) => (k === 'relationships' ? plural(n, 'relationship') : plural(n, kindName(k, 'sysml').toLowerCase())));
  const left = Object.entries(r.skipped).map(([what, n]) => `${n} ${what}`);
  return { made, left, notes: r.notes };
}
