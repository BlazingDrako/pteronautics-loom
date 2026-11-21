// Bringing requirements in from other tools (ReqIF, CSV, Excel). Every importer turns its file
// into the same plain records; this merges them into a package as one undoable edit.
//
// Records are matched to requirements already there, so importing a supplier's updated file
// again updates what changed instead of adding duplicates: first by Loom's own id (a ReqIF file
// Loom wrote), then by requirement ID (REQ-001), then by name under the same parent.
import { ELEMENTS, RELATIONSHIPS } from '../model/metamodel.js';
import { requirementsIn } from '../model/trace.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/**
 * @typedef {{
 *   ref: string,                // the record's identity in its file (a ReqIF identifier, a row number)
 *   elementId?: string,         // a Loom element id, when the file came from Loom
 *   heading?: boolean,          // a heading (chapter) rather than a requirement: becomes a package
 *   reqId?: string, name?: string, text?: string,
 *   priority?: string, status?: string, method?: string, level?: string, rationale?: string,
 *   parentRef?: string,         // the record it sits under (by ref)
 * }} ReqRecord
 * @typedef {{ kind: string, from: string, to: string }} RelRecord  a relationship between two records (by ref), or to a requirement ID
 * @typedef {{ created: number, updated: number, unchanged: number, packages: number, linked: number, warnings: string[] }} MergeStats
 */

/** Enum properties of a requirement that records can set, with the names other tools use for their values. */
const ENUMS = /** @type {Record<string, Record<string, string>>} */ ({
  priority: { must: 'Must', high: 'Must', mandatory: 'Must', essential: 'Must', shall: 'Must', '1': 'Must', should: 'Should', medium: 'Should', desirable: 'Should', '2': 'Should', could: 'Could', low: 'Could', optional: 'Could', '3': 'Could', '': '—', none: '—', '—': '—', '-': '—' },
  status: { draft: 'Draft', new: 'Draft', proposed: 'Draft', open: 'Draft', 'in review': 'In review', review: 'In review', 'under review': 'In review', approved: 'Approved', accepted: 'Approved', baselined: 'Approved', released: 'Approved', agreed: 'Approved', retired: 'Retired', deleted: 'Retired', obsolete: 'Retired', rejected: 'Retired' },
  method: { analysis: 'Analysis', a: 'Analysis', test: 'Test', t: 'Test', inspection: 'Inspection', i: 'Inspection', review: 'Inspection', demonstration: 'Demonstration', demo: 'Demonstration', d: 'Demonstration', '': '—', none: '—', '—': '—', '-': '—' },
  level: { auto: 'Auto', '': 'Auto', need: 'Need', 'stakeholder need': 'Need', stakeholder: 'Need', system: 'System', subsystem: 'Subsystem', component: 'Component' },
});

/**
 * An enum value from another tool, as the option Loom uses, or null when it means nothing here.
 * @param {string} prop @param {string} v
 */
export function enumValue(prop, v) {
  const spec = /** @type {any} */ (ELEMENTS.requirement.props[prop]);
  const t = String(v ?? '').trim();
  const exact = spec.options.find((/** @type {string} */ o) => o.toLowerCase() === t.toLowerCase());
  return exact || ENUMS[prop]?.[t.toLowerCase()] || null;
}

/** A name for a record that has none: its ID, else the start of its text. @param {ReqRecord} r */
function nameFor(r) {
  if (r.name?.trim()) return r.name.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (r.reqId?.trim()) return r.reqId.trim();
  const t = (r.text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Imported requirement';
  const words = t.split(' ').slice(0, 8).join(' ');
  return words.length < t.length ? `${words.replace(/[.,;:]$/, '')}…` : words;
}

/**
 * Merge records into a package. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {string} ownerId a package @param {ReqRecord[]} records @param {RelRecord[]} [rels]
 * @returns {MergeStats}
 */
export function mergeRequirements(m, tx, ownerId, records, rels = []) {
  /** @type {MergeStats} */
  const st = { created: 0, updated: 0, unchanged: 0, packages: 0, linked: 0, warnings: [] };
  const warn = (/** @type {string} */ w) => { if (st.warnings.length < 50) st.warnings.push(w); else if (st.warnings.length === 50) st.warnings.push('…and more'); };
  const existing = requirementsIn(m, ownerId).map((r) => r.el);
  /** @type {Map<string, Element>} */
  const byReqId = new Map();
  for (const e of existing) { const k = String(e.props.reqId || '').trim(); if (k && !byReqId.has(k)) byReqId.set(k, e); }
  /** record ref → element id */
  const placed = new Map();
  const byRef = new Map(records.map((r) => [r.ref, r]));
  // parents before children, whatever order the file lists them in
  /** @type {ReqRecord[]} */
  const order = [];
  const seen = new Set();
  const visit = (/** @type {ReqRecord} */ r, depth = 0) => {
    if (seen.has(r.ref) || depth > 64) return;
    seen.add(r.ref);
    const p = r.parentRef ? byRef.get(r.parentRef) : undefined;
    if (p) visit(p, depth + 1);
    order.push(r);
  };
  records.forEach((r) => visit(r));

  for (const r of order) {
    const parent = (r.parentRef && placed.get(r.parentRef)) || ownerId;
    const parentEl = /** @type {Element} */ (m.get(parent));
    if (r.heading) {
      // a chapter heading: a package (or, under a requirement, a requirement that groups others)
      if (m.canCreate(parent, 'package')) {
        const name = nameFor(r);
        const have = (r.elementId && m.get(r.elementId)?.kind === 'package' ? m.get(r.elementId) : undefined) || m.children(parent).find((c) => c.kind === 'package' && c.name === name);
        if (have) placed.set(r.ref, have.id);
        else { placed.set(r.ref, tx.create('package', { owner: parent, name })); st.packages++; }
        continue;
      }
    }
    /** @type {Record<string, any>} */
    const props = {};
    if (r.reqId !== undefined) props.reqId = r.reqId.trim();
    if (r.text !== undefined) props.text = r.text;
    if (r.rationale !== undefined) props.doc = r.rationale;
    for (const k of ['priority', 'status', 'method', 'level']) {
      const v = /** @type {any} */ (r)[k];
      if (v === undefined) continue;
      const opt = enumValue(k, v);
      if (opt) props[k] = opt; else if (String(v).trim()) warn(`${nameFor(r)}: "${v}" is not a ${ELEMENTS.requirement.props[k].label.toLowerCase()} Loom knows; left as it was`);
    }
    let el = r.elementId ? m.get(r.elementId) : undefined;
    if (el && el.kind !== 'requirement') el = undefined;
    if (!el && props.reqId) el = byReqId.get(props.reqId);
    if (!el && !props.reqId) el = m.children(parent).find((c) => c.kind === 'requirement' && c.name === nameFor(r));
    if (el) {
      const before = JSON.stringify([el.name, el.props, el.owner]);
      if (r.name?.trim() && r.name.trim() !== el.name) tx.rename(el.id, nameFor(r));
      tx.setProps(el.id, props);
      if (el.owner !== parent && m.canMove(el.id, parent)) tx.move(el.id, parent);
      const now = /** @type {Element} */ (m.get(el.id));
      if (JSON.stringify([now.name, now.props, now.owner]) === before) st.unchanged++; else st.updated++;
      placed.set(r.ref, el.id);
      continue;
    }
    const owner = m.canCreate(parent, 'requirement') ? parent : ownerId;
    if (owner !== parent) warn(`${nameFor(r)} could not go inside ${parentEl?.name}; it is in ${m.get(ownerId)?.name}`);
    const id = tx.create('requirement', { owner, name: nameFor(r), props });
    if (props.reqId) byReqId.set(props.reqId, /** @type {Element} */ (m.get(id)));
    placed.set(r.ref, id);
    st.created++;
  }

  // relationships between records (or to requirement IDs already in the model)
  const allReqs = new Map(m.byKind('requirement').filter((e) => e.props.reqId).map((e) => [String(e.props.reqId).trim(), e.id]));
  const find = (/** @type {string} */ ref) => placed.get(ref) || allReqs.get(ref.trim());
  for (const rel of rels) {
    if (!(rel.kind in RELATIONSHIPS)) continue;
    const a = find(rel.from), b = find(rel.to);
    if (!a || !b) { warn(`A ${rel.kind} relationship points at something not in the file (${a ? rel.to : rel.from})`); continue; }
    if (m.relsFrom(a).some((x) => x.kind === rel.kind && x.target === b)) continue;
    if (!m.canLink(rel.kind, a, b)) { warn(`${m.get(a)?.name} cannot have a ${rel.kind} relationship to ${m.get(b)?.name}`); continue; }
    tx.link(rel.kind, a, b);
    st.linked++;
  }
  return st;
}

/** A one-line summary of a merge, for a message. @param {MergeStats} s */
export function mergeSummary(s) {
  const parts = [];
  if (s.created) parts.push(`${s.created} added`);
  if (s.updated) parts.push(`${s.updated} updated`);
  if (s.unchanged) parts.push(`${s.unchanged} unchanged`);
  if (s.packages) parts.push(`${s.packages} heading${s.packages === 1 ? '' : 's'} as packages`);
  if (s.linked) parts.push(`${s.linked} relationship${s.linked === 1 ? '' : 's'}`);
  return (parts.join(', ') || 'Nothing to import') + (s.warnings.length ? `. ${s.warnings.length} note${s.warnings.length === 1 ? '' : 's'}: ${s.warnings[0]}` : '');
}
