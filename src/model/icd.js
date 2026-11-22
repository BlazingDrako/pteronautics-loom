// Interfaces of a block, as an interface control document (ICD) and an N² chart.
//
// The ICD lists every connector inside a block (and, going deeper, inside its parts' blocks):
// which part and port each end is, what interface block types the ports, which way each port
// acts, what flows along the connector (the item flow), and what the interface carries (its
// value properties: 48 V, 20 A…). The N² chart puts the block's parts on the diagonal and,
// in the cell for row A and column B, what flows from A to B; ports on the block's own
// boundary are the outside world ("External").
import { kindName } from './metamodel.js';

/** @typedef {import('./model.js').Model} Model */
/** @typedef {import('./model.js').Element} Element */
/** @typedef {{ path: string[], port: string | null }} End */

/**
 * @typedef {{
 *   id: string, connector: string, owner: string, via: string,
 *   from: string, fromPart: string, fromPort: string, fromDir: string,
 *   to: string, toPart: string, toPort: string, toDir: string,
 *   iface: string, ifaceId: string | null, item: string, flow: string,
 *   carries: string, doc: string, top: [string, string],
 * }} IcdRow
 * from/to: the full end ("propulsion.esc.pwrIn"); fromPart/toPart: the part path; top: the
 * block's own part each end is in ('' for its boundary), for the N² chart.
 */

/** Directions as they are written in ICDs. */
const DIR = /** @type {Record<string, string>} */ ({ in: 'in', out: 'out', inout: 'in/out' });

/** @param {Element} port */
function portDirection(port) {
  let d = String(port.props.direction || 'inout');
  if (port.props.conjugated) d = d === 'in' ? 'out' : d === 'out' ? 'in' : d;
  return DIR[d] || d;
}

/** What an interface block carries: its value properties ("voltage = 48 V"), and its own ports' interfaces. @param {Model} m @param {string | null | undefined} id */
export function carriesOf(m, id) {
  if (!id) return '';
  return m.children(id).filter((c) => c.kind === 'attribute' || c.kind === 'port').map((c) => {
    if (c.kind === 'port') { const t = c.props.type ? m.get(c.props.type) : undefined; return `${c.name}${t ? ` : ${t.name}` : ''}`; }
    const v = String(c.props.value || '').trim(), u = String(c.props.unit || '').trim();
    return v ? `${c.name} = ${v}${u ? ' ' + u : ''}` : `${c.name}${u ? ` [${u}]` : ''}`;
  }).join('; ');
}

/**
 * Every interface (connector) inside a block, as ICD rows.
 * @param {Model} m @param {string} blockId
 * @param {{ deep?: boolean, notation?: import('./metamodel.js').Notation }} [o] deep: also the connectors inside its parts' blocks, as seen from this block
 * @returns {IcdRow[]}
 */
export function icdRows(m, blockId, o = {}) {
  /** @type {IcdRow[]} */
  const rows = [];
  const seen = new Set();
  /** @param {string} block @param {string[]} prefix part ids from the top block down to this block's instance @param {string[]} prefixNames @param {string} via */
  const walk = (block, prefix, prefixNames, via) => {
    if (seen.has(`${block}|${prefix.join('/')}`) || prefix.length > 12) return;
    seen.add(`${block}|${prefix.join('/')}`);
    for (const c of m.children(block)) {
      if (c.kind !== 'connector') continue;
      const ends = /** @type {[End | undefined, End | undefined]} */ ([c.props.end1, c.props.end2]);
      if (!ends[0] || !ends[1]) continue;
      const desc = ends.map((e) => describe(m, /** @type {End} */ (e), prefixNames));
      const flow = String(c.props.flow || 'None');
      // the interface: the ports' type (either end; they should match)
      const ifaceId = desc[0].ifaceId || desc[1].ifaceId;
      const iface = ifaceId ? m.get(ifaceId)?.name || '' : '';
      rows.push({
        id: '', connector: c.id, owner: block, via,
        from: desc[0].full, fromPart: desc[0].part, fromPort: desc[0].port, fromDir: desc[0].dir,
        to: desc[1].full, toPart: desc[1].part, toPort: desc[1].port, toDir: desc[1].dir,
        iface, ifaceId, item: String(c.props.item || ''), flow,
        carries: carriesOf(m, ifaceId), doc: String(c.props.doc || ''),
        top: /** @type {[string, string]} */ (ends.map((e) => /** @type {End} */ (e).path.length ? prefix[0] || /** @type {End} */ (e).path[0] : prefix[0] || '')),
      });
    }
    if (!o.deep) return;
    for (const p of m.children(block)) {
      if (p.kind !== 'part' || !p.props.type) continue;
      walk(p.props.type, [...prefix, p.id], [...prefixNames, p.name], via ? `${via}.${p.name}` : p.name);
    }
  };
  walk(blockId, [], [], '');
  rows.forEach((r, i) => { r.id = `IF-${String(i + 1).padStart(rows.length >= 100 ? 3 : 2, '0')}`; });
  return rows;
}

/** One end, in words. @param {Model} m @param {End} e @param {string[]} prefixNames */
function describe(m, e, prefixNames) {
  const parts = [...prefixNames, ...e.path.map((id) => m.get(id)?.name || '?')];
  const port = e.port ? m.get(e.port) : undefined;
  const part = parts.join('.');
  return {
    part: part || '(boundary)',
    port: port?.name || '',
    full: [part, port?.name].filter(Boolean).join('.') || '(boundary)',
    dir: port ? portDirection(port) : '',
    ifaceId: port?.props.type ? String(port.props.type) : null,
  };
}

/** The ICD as spreadsheet rows (a header row first). @param {Model} m @param {IcdRow[]} rows */
export function icdSheet(m, rows) {
  return [
    ['Interface ID', 'From', 'From port direction', 'To', 'To port direction', 'Interface', 'Item flow', 'Flow', 'Interface carries', 'Inside', 'Description'],
    ...rows.map((r) => [r.id, r.from, r.fromDir, r.to, r.toDir, r.iface, r.item, flowWords(r.flow), r.carries, r.via || m.get(r.owner)?.name || '', r.doc]),
  ];
}

/** @param {string} f */
export const flowWords = (f) => (f === 'From → To' ? 'from → to' : f === 'To → From' ? 'to → from' : f === 'Both ways' ? 'both ways' : '—');

/**
 * The N² chart of a block: its parts on the diagonal, and what flows between them.
 * Connectors deeper inside a part count as that part's (with deep); ends on the block's
 * boundary are "External". Without a flow direction, an interface shows in both cells.
 * @param {Model} m @param {string} blockId @param {{ deep?: boolean }} [o]
 * @returns {{ items: { id: string, name: string, type: string }[], cells: Map<string, IcdRow[]> }}
 *   cells by `${rowIndex},${colIndex}`
 */
export function n2Chart(m, blockId, o = {}) {
  const parts = m.children(blockId).filter((c) => c.kind === 'part');
  const rows = icdRows(m, blockId, o);
  /** @type {{ id: string, name: string, type: string }[]} */
  const items = parts.map((p) => ({ id: p.id, name: p.name, type: p.props.type ? m.get(p.props.type)?.name || '' : '' }));
  if (rows.some((r) => r.top.includes(''))) items.push({ id: '', name: 'External', type: 'outside the block' });
  const at = new Map(items.map((it, i) => [it.id, i]));
  /** @type {Map<string, IcdRow[]>} */
  const cells = new Map();
  const put = (/** @type {number | undefined} */ a, /** @type {number | undefined} */ b, /** @type {IcdRow} */ r) => {
    if (a === undefined || b === undefined || a === b) return;
    const k = `${a},${b}`;
    const list = cells.get(k) || [];
    if (!list.includes(r)) list.push(r);
    cells.set(k, list);
  };
  for (const r of rows) {
    const a = at.get(r.top[0]), b = at.get(r.top[1]);
    if (r.flow === 'From → To') put(a, b, r);
    else if (r.flow === 'To → From') put(b, a, r);
    else { put(a, b, r); put(b, a, r); }
  }
  return { items, cells };
}

/** The N² chart as spreadsheet rows. @param {ReturnType<typeof n2Chart>} n2 */
export function n2Sheet(n2) {
  const label = (/** @type {import('./icd.js').IcdRow} */ r) => r.item || r.iface || r.id;
  return [
    ['', ...n2.items.map((it) => it.name)],
    ...n2.items.map((it, i) => [it.name, ...n2.items.map((_, j) => (i === j ? it.name : (n2.cells.get(`${i},${j}`) || []).map(label).join('; ')))]),
  ];
}

/** Blocks worth an ICD: those with connectors inside, the most connected first. @param {Model} m */
export function blocksWithInterfaces(m) {
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const c of m.byKind('connector')) if (c.owner) count.set(c.owner, (count.get(c.owner) || 0) + 1);
  return [...count.entries()].map(([id, n]) => ({ el: /** @type {Element} */ (m.get(id)), n })).filter((x) => x.el && x.el.kind === 'partDef').sort((a, b) => b.n - a.n || a.el.name.localeCompare(b.el.name));
}

/** "Block", "part def"… for headings. @param {import('./metamodel.js').Notation} n */
export const blockWord = (n) => kindName('partDef', n);
