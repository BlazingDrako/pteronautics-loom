// Generic tables (Cameo's Generic Table): any kinds of element as rows, inside the table's
// package or across the whole model, with the columns you choose: the name, kind and owner,
// any property the kinds have, members (parts, ports, values…), related elements through any
// relationship either way, and stereotypes' tagged values. Pure data; the view draws and edits.
import { ELEMENTS, RELATIONSHIPS, kindName, isRel, isDiagram, childKinds } from './metamodel.js';
import { appliedOf, applicableStereotypes } from '../custom/stereo.js';

/** @typedef {import('./model.js').Model} Model */
/** @typedef {import('./model.js').Element} Element */
/** @typedef {import('./metamodel.js').Notation} Notation */

/**
 * A column. edit: how a cell is edited in place ('name', a property's type, 'tag'), if it can be.
 * @typedef {{ id: string, label: string, group: string, edit?: 'name' | 'text' | 'longtext' | 'enum' | 'bool' | 'tag', options?: string[] }} Column
 */

/** Kinds a generic table can list: elements (not relationships, not views). */
export const ROW_KINDS = Object.keys(ELEMENTS).filter((k) => !isDiagram(k) && !isRel(k));

/** The kinds a table lists. @param {Element} t */
export const rowKindsOf = (t) => String(t.props.rowKinds || 'partDef').split(',').map((s) => s.trim()).filter((k) => ROW_KINDS.includes(k));

/** Its columns, in order (empty: the defaults for its kinds). @param {Element} t */
export function columnIdsOf(t) {
  try { const v = JSON.parse(String(t.props.columns || '[]')); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

/** Columns a kind starts with. @param {string[]} kinds */
export function defaultColumns(kinds) {
  const k = kinds[0];
  if (kinds.length === 1 && k === 'requirement') return ['p:reqId', 'name', 'p:text', 'p:priority', 'p:status', 'rel:satisfy:in', 'rel:verify:in'];
  if (kinds.length === 1 && k === 'partDef') return ['name', 'owner', 'kids:part', 'kids:port', 'kids:attribute', 'rel:satisfy:out', 'doc'];
  if (kinds.length === 1 && k === 'testCase') return ['name', 'p:method', 'p:result', 'rel:verify:out', 'doc'];
  if (kinds.length === 1 && k === 'action') return ['name', 'owner', 'rel:allocate:out', 'doc'];
  if (kinds.length === 1 && k === 'part') return ['name', 'p:type', 'p:multiplicity', 'owner', 'doc'];
  if (kinds.length === 1 && k === 'port') return ['name', 'p:type', 'p:direction', 'owner', 'doc'];
  if (kinds.length === 1 && k === 'attribute') return ['name', 'p:value', 'p:unit', 'owner', 'doc'];
  return ['name', 'kind', 'owner', 'doc'];
}

/**
 * Every column that makes sense for these kinds.
 * @param {Model} m @param {string[]} kinds @param {Notation} n @returns {Column[]}
 */
export function availableColumns(m, kinds, n) {
  /** @type {Column[]} */
  const out = [
    { id: 'name', label: 'Name', group: 'Element', edit: 'name' },
    { id: 'kind', label: 'Kind', group: 'Element' },
    { id: 'owner', label: 'Owner', group: 'Element' },
    { id: 'path', label: 'Where (path)', group: 'Element' },
    { id: 'stereo', label: 'Stereotypes', group: 'Element' },
    { id: 'doc', label: 'Description', group: 'Element', edit: 'longtext' },
  ];
  const seen = new Set();
  for (const k of kinds) {
    for (const [key, spec] of Object.entries(ELEMENTS[k]?.props || {})) {
      if (key === 'doc' || seen.has(key) || /** @type {any} */ (spec).hidden || spec.type === 'stereo' || spec.type === 'end') continue;
      seen.add(key);
      const edit = spec.type === 'text' || spec.type === 'longtext' || spec.type === 'enum' || spec.type === 'bool' ? spec.type : undefined;
      out.push({ id: `p:${key}`, label: spec.label, group: 'Properties', edit, options: /** @type {any} */ (spec).options });
    }
  }
  const kidKinds = [...new Set(kinds.flatMap((k) => childKinds(k)))].filter((c) => !isDiagram(c));
  for (const c of kidKinds) out.push({ id: `kids:${c}`, label: plural(kindName(c, n)), group: 'Members' });
  for (const [rk, r] of Object.entries(RELATIONSHIPS)) {
    if (kinds.some((k) => r.sources.includes(k))) out.push({ id: `rel:${rk}:out`, label: cap(r.verb[n]), group: 'Relationships' });
    if (kinds.some((k) => r.targets.includes(k))) out.push({ id: `rel:${rk}:in`, label: cap(r.inverse?.[n] || `${r.names[n]} (to it)`), group: 'Relationships' });
  }
  const sts = new Map();
  for (const k of kinds) for (const st of applicableStereotypes(m, k)) sts.set(st.id, st);
  for (const st of sts.values()) for (const tag of m.children(st.id).filter((c) => c.kind === 'attribute')) out.push({ id: `tag:${st.id}:${tag.id}`, label: `${tag.name} «${st.name}»`, group: 'Tagged values', edit: 'tag' });
  return out;
}

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);
/** @param {string} s */
function plural(s) { return /(s|x|ch|sh)$/i.test(s) ? `${s}es` : /[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`; }

/**
 * The rows: elements of the table's kinds inside its package (any depth), or in the whole
 * model, in model-browser order.
 * @param {Model} m @param {Element} t
 */
export function gtableRows(m, t) {
  const kinds = new Set(rowKindsOf(t));
  const root = t.props.scope === 'model' ? m.root().id : /** @type {string} */ (t.owner);
  /** @type {Element[]} */
  const out = [];
  const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (kinds.has(c.kind)) out.push(c); if (!isRel(c.kind)) walk(c.id); } };
  walk(root);
  return out;
}

/** A name for a row in a list ("REQ-001 Endurance" for requirements). @param {Element | undefined} e */
export const labelOf = (e) => (!e ? '' : e.kind === 'requirement' && e.props.reqId ? `${e.props.reqId} ${e.name}` : e.name);

/**
 * What a cell shows: its text, and the elements it lists (to click).
 * @param {Model} m @param {Element} e @param {string} col @param {Notation} n
 * @returns {{ text: string, ids?: string[], raw?: any }}
 */
export function cellOf(m, e, col, n) {
  if (col === 'name') return { text: e.name, raw: e.name };
  if (col === 'kind') return { text: kindName(e.kind, n) };
  if (col === 'owner') { const o = e.owner ? m.get(e.owner) : undefined; return { text: o?.name || '', ids: o ? [o.id] : [] }; }
  if (col === 'path') return { text: m.path(e.id).filter((a) => a.owner).map((a) => a.name).join(' › ') };
  if (col === 'stereo') return { text: appliedOf(m, e.id).map((a) => a.st.name).join(', ') };
  if (col === 'doc') return { text: String(e.props.doc || ''), raw: String(e.props.doc || '') };
  if (col.startsWith('p:')) {
    const key = col.slice(2);
    const spec = ELEMENTS[e.kind]?.props?.[key];
    if (!spec) return { text: '' };
    const v = e.props[key];
    if (spec.type === 'ref') { const r = v ? m.get(v) : undefined; return { text: r?.name || '', ids: r ? [r.id] : [] }; }
    if (spec.type === 'bool') return { text: v ? 'Yes' : 'No', raw: !!v };
    return { text: v === undefined || v === null ? '' : String(v), raw: v };
  }
  if (col.startsWith('kids:')) {
    const k = col.slice(5);
    const kids = m.children(e.id).filter((c) => c.kind === k);
    const word = (/** @type {Element} */ c) => {
      // a value shows its value ("capacity = 16 Ah"); parts and ports their type
      if (c.kind === 'attribute' && String(c.props.value || '').trim()) return `${c.name} = ${c.props.value}${c.props.unit ? ' ' + c.props.unit : ''}`;
      return c.props.type && m.get(c.props.type) ? `${c.name} : ${m.get(c.props.type)?.name}` : c.name;
    };
    return { text: kids.map(word).join(', '), ids: kids.map((c) => c.id) };
  }
  if (col.startsWith('rel:')) {
    const [, rk, dir] = col.split(':');
    const rels = dir === 'in' ? m.relsTo(e.id).filter((r) => r.kind === rk).map((r) => r.source) : m.relsFrom(e.id).filter((r) => r.kind === rk).map((r) => r.target);
    const els = rels.map((id) => (id ? m.get(id) : undefined)).filter((x) => !!x);
    return { text: els.map(labelOf).join(', '), ids: els.map((x) => /** @type {Element} */ (x).id) };
  }
  if (col.startsWith('tag:')) {
    const [, st, tag] = col.split(':');
    const a = appliedOf(m, e.id).find((x) => x.st.id === st);
    if (!a) return { text: '' };
    const t = a.tags.find((x) => x.tag.id === tag);
    return { text: t ? t.value : '', raw: t ? t.value : '' };
  }
  return { text: '' };
}

/**
 * Filter and sort rows. Sort is "column:asc" or "column:desc".
 * @param {Model} m @param {Element[]} rows @param {string[]} cols @param {{ filter?: string, sort?: string }} o @param {Notation} n
 */
export function shapeRows(m, rows, cols, o, n) {
  let out = rows;
  const q = (o.filter || '').trim().toLowerCase();
  if (q) out = out.filter((e) => cols.some((c) => cellOf(m, e, c, n).text.toLowerCase().includes(q)));
  const [sc, dir] = String(o.sort || '').split(':');
  if (sc && cols.includes(sc)) {
    const key = new Map(out.map((e) => [e.id, cellOf(m, e, sc, n).text]));
    const num = (/** @type {string} */ s) => (/^-?\d+(\.\d+)?/.test(s) ? parseFloat(s) : NaN);
    out = [...out].sort((a, b) => {
      const x = /** @type {string} */ (key.get(a.id)), y = /** @type {string} */ (key.get(b.id));
      const nx = num(x), ny = num(y);
      const c = !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'desc' ? -c : c;
    });
  }
  return out;
}

/** The table as spreadsheet rows (a header row first). @param {Model} m @param {Element[]} rows @param {Column[]} cols @param {Notation} n */
export const gtableSheet = (m, rows, cols, n) => [cols.map((c) => c.label), ...rows.map((e) => cols.map((c) => cellOf(m, e, c.id, n).text))];
