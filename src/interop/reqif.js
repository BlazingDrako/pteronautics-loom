// ReqIF 1.2 (OMG Requirements Interchange Format): how requirements travel between DOORS,
// Polarion, Jama, Codebeamer, Cameo and suppliers. Loom writes a package's requirements (with
// sub-packages as headings, and derive, copy and trace links between them) and reads ReqIF and
// .reqifz files from other tools, recognising the attribute names they commonly use.
import { parseXml, kids, kid, path, attr, all, esc, plainText, InteropError } from './xml.js';
import { requirementStatus } from '../model/trace.js';
import { verificationText } from '../views/table.js';
import { VERSION } from '../version.js';
import { ELEMENTS } from '../model/metamodel.js';
import { unzip, isZip } from '../storage/zip.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('./reqs.js').ReqRecord} ReqRecord */
/** @typedef {import('./reqs.js').RelRecord} RelRecord */

const NS = 'http://www.omg.org/spec/ReqIF/20110401/reqif.xsd';
const XHTML = 'http://www.w3.org/1999/xhtml';
/** Relationships written as spec relations: only those that join two requirements. */
const REL_KINDS = ['derive', 'copy', 'trace'];
/** Enumerated attributes, by requirement property. */
const ENUM_ATTRS = /** @type {const} */ ([['priority', 'Priority'], ['status', 'Status'], ['method', 'Verification method'], ['level', 'Level']]);

/** A ReqIF identifier for a Loom id (identifiers must not start with a digit). @param {string} id */
const rid = (id) => `_${id}`;

/**
 * Write the requirements inside a package as ReqIF.
 * @param {Model} m @param {string} rootId a package (a layer, or any package in it)
 * @param {{ now?: string, title?: string }} [o]
 */
export function exportReqif(m, rootId, o = {}) {
  const now = o.now || new Date().toISOString();
  const root = /** @type {Element} */ (m.get(rootId));
  const status = requirementStatus(m);
  /** @type {Element[]} */
  const objects = [];
  /** Hierarchy: package and requirement nesting. @param {string} id @returns {string} */
  const tree = (id) => m.children(id).filter((c) => c.kind === 'requirement' || (c.kind === 'package' && hasReqs(c.id))).map((c) => {
    objects.push(c);
    const inner = tree(c.id);
    return `<SPEC-HIERARCHY IDENTIFIER="${rid(`h${c.id}`)}" LAST-CHANGE="${now}"><OBJECT><SPEC-OBJECT-REF>${rid(c.id)}</SPEC-OBJECT-REF></OBJECT>${inner ? `<CHILDREN>${inner}</CHILDREN>` : ''}</SPEC-HIERARCHY>`;
  }).join('');
  /** @param {string} id @returns {boolean} */
  const hasReqs = (id) => m.children(id).some((c) => c.kind === 'requirement' || (c.kind === 'package' && hasReqs(c.id)));
  const hierarchy = tree(rootId);
  const reqIds = new Set(objects.filter((e) => e.kind === 'requirement').map((e) => e.id));

  const str = (/** @type {string} */ def, /** @type {string} */ v) => `<ATTRIBUTE-VALUE-STRING THE-VALUE="${esc(v)}"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>${def}</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>`;
  const xhtml = (/** @type {string} */ def, /** @type {string} */ v) => `<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>${def}</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>${String(v).split('\n').map((l) => `<xhtml:p>${esc(l)}</xhtml:p>`).join('')}</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>`;
  const enumv = (/** @type {string} */ prop, /** @type {string} */ v) => `<ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>${rid(`ad-${prop}`)}</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>${rid(`ev-${prop}-${optIndex(prop, v)}`)}</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION>`;
  const names = (/** @type {Element[]} */ list) => list.map((x) => (x.kind === 'requirement' && x.props.reqId ? x.props.reqId : x.name)).join(', ');
  const rel = (/** @type {string} */ k, /** @type {string} */ id) => m.relsTo(id).filter((r) => r.kind === k).map((r) => /** @type {Element} */ (m.get(/** @type {string} */ (r.source))));

  const specObjects = objects.map((e) => {
    if (e.kind === 'package') {
      return `<SPEC-OBJECT IDENTIFIER="${rid(e.id)}" LAST-CHANGE="${now}" LONG-NAME="${esc(e.name)}"><TYPE><SPEC-OBJECT-TYPE-REF>${rid('type-heading')}</SPEC-OBJECT-TYPE-REF></TYPE><VALUES>${str(rid('ad-chapter'), e.name)}</VALUES></SPEC-OBJECT>`;
    }
    const p = e.props, st = status.get(e.id);
    const vals = [
      str(rid('ad-id'), p.reqId || ''), str(rid('ad-name'), e.name), xhtml(rid('ad-text'), p.text || ''),
      ...ENUM_ATTRS.map(([k]) => enumv(k, p[k])),
      str(rid('ad-rationale'), p.doc || ''),
      str(rid('ad-satisfied'), names(rel('satisfy', e.id))), str(rid('ad-verified'), names(rel('verify', e.id))), str(rid('ad-result'), verificationText(st)),
    ];
    return `<SPEC-OBJECT IDENTIFIER="${rid(e.id)}" LAST-CHANGE="${now}" LONG-NAME="${esc(e.name)}"><TYPE><SPEC-OBJECT-TYPE-REF>${rid('type-req')}</SPEC-OBJECT-TYPE-REF></TYPE><VALUES>${vals.join('')}</VALUES></SPEC-OBJECT>`;
  }).join('\n');

  const relations = m.all().filter((r) => REL_KINDS.includes(r.kind) && reqIds.has(/** @type {string} */ (r.source)) && reqIds.has(/** @type {string} */ (r.target)))
    .map((r) => `<SPEC-RELATION IDENTIFIER="${rid(r.id)}" LAST-CHANGE="${now}"><TYPE><SPEC-RELATION-TYPE-REF>${rid(`rt-${r.kind}`)}</SPEC-RELATION-TYPE-REF></TYPE><SOURCE><SPEC-OBJECT-REF>${rid(/** @type {string} */ (r.source))}</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>${rid(/** @type {string} */ (r.target))}</SPEC-OBJECT-REF></TARGET></SPEC-RELATION>`).join('\n');

  const enumTypes = ENUM_ATTRS.map(([k, label]) => `<DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="${rid(`dt-${k}`)}" LAST-CHANGE="${now}" LONG-NAME="${label}"><SPECIFIED-VALUES>${/** @type {any} */ (ELEMENTS.requirement.props[k]).options.map((/** @type {string} */ v, /** @type {number} */ i) => `<ENUM-VALUE IDENTIFIER="${rid(`ev-${k}-${i}`)}" LAST-CHANGE="${now}" LONG-NAME="${esc(v)}"><PROPERTIES><EMBEDDED-VALUE KEY="${i}" OTHER-CONTENT="${esc(v)}"/></PROPERTIES></ENUM-VALUE>`).join('')}</SPECIFIED-VALUES></DATATYPE-DEFINITION-ENUMERATION>`).join('');
  const sdef = (/** @type {string} */ id, /** @type {string} */ name) => `<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="${rid(id)}" LAST-CHANGE="${now}" LONG-NAME="${name}"><TYPE><DATATYPE-DEFINITION-STRING-REF>${rid('dt-string')}</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>`;
  const edef = (/** @type {string} */ k, /** @type {string} */ name) => `<ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="${rid(`ad-${k}`)}" LAST-CHANGE="${now}" LONG-NAME="${name}" MULTI-VALUED="false"><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>${rid(`dt-${k}`)}</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="${NS}" xmlns:xhtml="${XHTML}">
<THE-HEADER><REQ-IF-HEADER IDENTIFIER="${rid(`header-${root.id}`)}"><CREATION-TIME>${now}</CREATION-TIME><REQ-IF-TOOL-ID>Pteronautics Loom ${VERSION}</REQ-IF-TOOL-ID><REQ-IF-VERSION>1.0</REQ-IF-VERSION><SOURCE-TOOL-ID>Pteronautics Loom ${VERSION}</SOURCE-TOOL-ID><TITLE>${esc(o.title || `${m.root().name}: ${root.name}`)}</TITLE></REQ-IF-HEADER></THE-HEADER>
<CORE-CONTENT><REQ-IF-CONTENT>
<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="${rid('dt-string')}" LAST-CHANGE="${now}" LONG-NAME="String" MAX-LENGTH="32000"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="${rid('dt-xhtml')}" LAST-CHANGE="${now}" LONG-NAME="Formatted text"/>${enumTypes}</DATATYPES>
<SPEC-TYPES>
<SPEC-OBJECT-TYPE IDENTIFIER="${rid('type-req')}" LAST-CHANGE="${now}" LONG-NAME="Requirement"><SPEC-ATTRIBUTES>${sdef('ad-id', 'ReqIF.ForeignID')}${sdef('ad-name', 'ReqIF.Name')}<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="${rid('ad-text')}" LAST-CHANGE="${now}" LONG-NAME="ReqIF.Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>${rid('dt-xhtml')}</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>${ENUM_ATTRS.map(([k, l]) => edef(k, l)).join('')}${sdef('ad-rationale', 'Rationale')}${sdef('ad-satisfied', 'Satisfied by')}${sdef('ad-verified', 'Verified by')}${sdef('ad-result', 'Verification result')}</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>
<SPEC-OBJECT-TYPE IDENTIFIER="${rid('type-heading')}" LAST-CHANGE="${now}" LONG-NAME="Heading"><SPEC-ATTRIBUTES>${sdef('ad-chapter', 'ReqIF.ChapterName')}</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE>
${REL_KINDS.map((k) => `<SPEC-RELATION-TYPE IDENTIFIER="${rid(`rt-${k}`)}" LAST-CHANGE="${now}" LONG-NAME="${k === 'derive' ? 'deriveReqt' : k}"/>`).join('')}
<SPECIFICATION-TYPE IDENTIFIER="${rid('type-spec')}" LAST-CHANGE="${now}" LONG-NAME="Specification"/>
</SPEC-TYPES>
<SPEC-OBJECTS>
${specObjects}
</SPEC-OBJECTS>
<SPEC-RELATIONS>
${relations}
</SPEC-RELATIONS>
<SPECIFICATIONS><SPECIFICATION IDENTIFIER="${rid(`spec-${root.id}`)}" LAST-CHANGE="${now}" LONG-NAME="${esc(root.name)}"><TYPE><SPECIFICATION-TYPE-REF>${rid('type-spec')}</SPECIFICATION-TYPE-REF></TYPE><CHILDREN>${hierarchy}</CHILDREN></SPECIFICATION></SPECIFICATIONS>
</REQ-IF-CONTENT></CORE-CONTENT>
</REQ-IF>
`;
}

/** @param {string} prop @param {string} v */
const optIndex = (prop, v) => Math.max(0, /** @type {any} */ (ELEMENTS.requirement.props[prop]).options.indexOf(v));

// ---------- reading ----------

/** Attribute names other tools use, by what Loom does with them (lower case, compared loosely). */
const NAMES = /** @type {Record<string, string[]>} */ ({
  reqId: ['reqif.foreignid', 'id', 'identifier', 'req id', 'requirement id', 'object identifier', 'absolute number', 'external id', 'key', 'number', 'reqid'],
  name: ['reqif.name', 'name', 'title', 'summary', 'short name', 'object short text'],
  chapter: ['reqif.chaptername', 'heading', 'object heading', 'chapter name', 'section'],
  text: ['reqif.text', 'text', 'object text', 'description', 'requirement text', 'statement', 'content'],
  priority: ['priority', 'importance', 'criticality'],
  status: ['status', 'state', 'lifecycle state', 'review status'],
  method: ['verification method', 'verification', 'method', 'v&v method'],
  level: ['level', 'requirement level'],
  rationale: ['rationale', 'justification', 'reason'],
});
const norm = (/** @type {string} */ s) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ');
/** What Loom does with an attribute, from its name. @param {string} longName @returns {string | null} */
export function roleOf(longName) {
  const n = norm(longName);
  for (const [role, list] of Object.entries(NAMES)) if (list.includes(n)) return role;
  return null;
}

/** Relationship kinds from relation type names. @param {string} n */
function relKindOf(n) {
  const s = norm(n);
  if (/deriv/.test(s)) return 'derive';
  if (/copy/.test(s)) return 'copy';
  return 'trace';
}

/**
 * Read ReqIF text into records for mergeRequirements.
 * @param {string} text
 * @param {{ isLoomId?: (id: string) => boolean }} [o] recognise identifiers Loom wrote (so they update the same requirements)
 * @returns {{ title: string, records: ReqRecord[], rels: RelRecord[], skipped: string[] }}
 */
export function readReqif(text, o = {}) {
  const doc = parseXml(text, 'ReqIF file');
  const top = doc.documentElement;
  if (top.localName !== 'REQ-IF') throw new InteropError('This is not a ReqIF file (its top element is not REQ-IF)');
  const content = path(top, 'CORE-CONTENT', 'REQ-IF-CONTENT');
  if (!content) throw new InteropError('This ReqIF file has no content');
  const title = path(top, 'THE-HEADER', 'REQ-IF-HEADER', 'TITLE')?.textContent?.trim() || '';
  /** @type {string[]} */
  const skipped = [];
  // attribute definitions and enum values, by identifier
  /** @type {Map<string, string>} */
  const defRole = new Map();
  /** @type {Map<string, string>} */
  const enumName = new Map();
  for (const ev of all(content, 'ENUM-VALUE')) enumName.set(attr(ev, 'IDENTIFIER') || '', attr(ev, 'LONG-NAME') || path(ev, 'PROPERTIES', 'EMBEDDED-VALUE')?.getAttribute('OTHER-CONTENT') || '');
  for (const t of ['STRING', 'XHTML', 'ENUMERATION', 'INTEGER', 'REAL', 'BOOLEAN', 'DATE']) {
    for (const d of all(content, `ATTRIBUTE-DEFINITION-${t}`)) {
      const role = roleOf(attr(d, 'LONG-NAME') || '');
      if (role) defRole.set(attr(d, 'IDENTIFIER') || '', role);
    }
  }
  /** @type {Map<string, ReqRecord>} */
  const recs = new Map();
  for (const so of all(content, 'SPEC-OBJECT')) {
    const id = attr(so, 'IDENTIFIER') || '';
    /** @type {Record<string, string>} */
    const v = {};
    for (const val of kids(kid(so, 'VALUES') || so, undefined)) {
      const t = val.localName.replace('ATTRIBUTE-VALUE-', '');
      const ref = kid(kid(val, 'DEFINITION') || val, `ATTRIBUTE-DEFINITION-${t}-REF`)?.textContent?.trim() || '';
      const role = defRole.get(ref);
      if (!role) continue;
      if (t === 'XHTML') { const tv = kid(val, 'THE-VALUE'); v[role] = tv ? plainText(tv) : ''; }
      else if (t === 'ENUMERATION') v[role] = kids(kid(val, 'VALUES') || val, 'ENUM-VALUE-REF').map((x) => enumName.get(x.textContent?.trim() || '') || '').filter(Boolean).join(', ');
      else v[role] = attr(val, 'THE-VALUE') ?? '';
    }
    const name = v.name || attr(so, 'LONG-NAME') || '';
    const heading = !!v.chapter && !v.text;
    /** @type {ReqRecord} */
    const r = { ref: id, heading, name: heading ? v.chapter : name || undefined, reqId: v.reqId, text: v.text ?? undefined, priority: v.priority, status: v.status, method: v.method, level: v.level, rationale: v.rationale };
    if (id.startsWith('_') && o.isLoomId?.(id.slice(1))) r.elementId = id.slice(1);
    recs.set(id, r);
  }
  // nesting, from the specifications' hierarchies (objects in no specification stay at the top)
  /** @type {ReqRecord[]} */
  const ordered = [];
  const walk = (/** @type {Element} */ el, /** @type {string | undefined} */ parent) => {
    for (const hh of kids(el, 'SPEC-HIERARCHY')) {
      const ref = path(hh, 'OBJECT', 'SPEC-OBJECT-REF')?.textContent?.trim() || '';
      const r = recs.get(ref);
      if (r && !ordered.includes(r)) { if (parent) r.parentRef = parent; ordered.push(r); }
      const ch = kid(hh, 'CHILDREN');
      if (ch) walk(ch, r ? ref : parent);
    }
  };
  for (const spec of all(content, 'SPECIFICATION')) { const ch = kid(spec, 'CHILDREN'); if (ch) walk(ch, undefined); }
  for (const r of recs.values()) if (!ordered.includes(r)) ordered.push(r);
  // relations
  /** @type {Map<string, string>} */
  const relType = new Map(all(content, 'SPEC-RELATION-TYPE').map((t) => [attr(t, 'IDENTIFIER') || '', attr(t, 'LONG-NAME') || '']));
  /** @type {RelRecord[]} */
  const rels = [];
  for (const sr of all(content, 'SPEC-RELATION')) {
    const from = path(sr, 'SOURCE', 'SPEC-OBJECT-REF')?.textContent?.trim(), to = path(sr, 'TARGET', 'SPEC-OBJECT-REF')?.textContent?.trim();
    if (!from || !to || !recs.has(from) || !recs.has(to)) { skipped.push('a relation to an object that is not in the file'); continue; }
    const kind = relKindOf(relType.get(path(sr, 'TYPE', 'SPEC-RELATION-TYPE-REF')?.textContent?.trim() || '') || '');
    // "derive" in SysML goes from the derived requirement to the one it comes from; DOORS links usually do too
    rels.push({ kind, from, to });
  }
  if (!recs.size) throw new InteropError('This ReqIF file has no requirements (no SPEC-OBJECTs)');
  return { title, records: ordered, rels, skipped };
}

/** ReqIF text from a .reqif file or a .reqifz archive. @param {Uint8Array} bytes */
export async function reqifText(bytes) {
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  const files = await unzip(bytes);
  const name = Object.keys(files).find((f) => /\.reqif$/i.test(f));
  if (!name) throw new InteropError('This .reqifz archive has no .reqif file in it');
  return new TextDecoder().decode(files[name]);
}
