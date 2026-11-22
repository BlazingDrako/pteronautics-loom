// Interfaces: a block's interface control document (ICD) and its N² chart, made from the model.
// Pick a block; the table lists every connector inside it (and, with "Nested parts", inside
// its parts), with its ends, ports, directions, interface, item flow and what the interface
// carries. The N² chart puts the parts on the diagonal and what flows between them in the
// cells. Both export to Excel and CSV. Click a row or a cell to select the connector;
// double-click to open the internal block diagram that shows it.
import { h, icon, toast } from '../ui/dom.js';
import { download } from '../ui/home.js';
import { icdRows, icdSheet, n2Chart, n2Sheet, blocksWithInterfaces, flowWords } from '../model/icd.js';
import { writeXlsx, toCsv } from '../interop/sheet.js';
import { kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */

/** What each project remembers while it is open: the block, table or chart, how deep. */
const memory = new WeakMap();

/**
 * @param {{ model: Model, notation: () => import('../model/metamodel.js').Notation, selected: () => string | null, select: (id: string | null) => void, open?: (id: string) => void }} ctx
 */
export function createIcdView(ctx) {
  const { model } = ctx;
  /** @type {{ block: string | null, mode: 'table' | 'n2', deep: boolean, filter: string }} */
  const st = memory.get(model) || { block: null, mode: 'table', deep: true, filter: '' };
  memory.set(model, st);
  let dirty = true, raf = 0, stamp = -1;

  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Interface tools' });
  const body = h('div', { class: 'icd-scroll', tabindex: '0' });
  const el = h('div', { class: 'dview icd-view' }, toolbar, body);

  /** The block shown: the one chosen, else the selection's block, else the most connected. */
  function block() {
    if (st.block && model.get(st.block)?.kind === 'partDef') return st.block;
    const s = ctx.selected() ? model.get(/** @type {string} */ (ctx.selected())) : undefined;
    const fromSel = s?.kind === 'partDef' ? s.id : s?.kind === 'part' || s?.kind === 'connector' ? s.owner : null;
    if (fromSel && model.children(fromSel).some((c) => c.kind === 'connector')) return fromSel;
    return blocksWithInterfaces(model)[0]?.el.id || null;
  }
  const fileBase = () => `${(model.get(block() || '')?.name || 'interfaces').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}-${st.mode === 'n2' ? 'N2' : 'ICD'}`;
  /** The sheet for what is shown. */
  function sheet() {
    const b = block();
    if (!b) return [];
    return st.mode === 'n2' ? n2Sheet(n2Chart(model, b, { deep: st.deep })) : icdSheet(model, filtered(icdRows(model, b, { deep: st.deep })));
  }
  /** @param {import('../model/icd.js').IcdRow[]} rows */
  function filtered(rows) {
    const q = st.filter.trim().toLowerCase();
    return q ? rows.filter((r) => [r.id, r.from, r.to, r.iface, r.item, r.carries, r.doc].some((x) => x.toLowerCase().includes(q))) : rows;
  }
  /** Open the internal block diagram of the block a connector is in. @param {string} owner */
  function openIbd(owner) {
    const d = model.byKind('ibd').find((x) => x.owner === owner);
    if (d && ctx.open) ctx.open(d.id); else toast(`No internal block diagram shows ${model.get(owner)?.name || 'that block'} yet`);
  }

  function paintToolbar() {
    const n = ctx.notation();
    const list = blocksWithInterfaces(model);
    const b = block();
    const pick = h('select', { class: 'field sm', 'aria-label': kindName('partDef', n) },
      list.length ? list.map((x) => h('option', { value: x.el.id, selected: x.el.id === b ? true : undefined }, `${x.el.name} (${x.n})`)) : [h('option', { value: '' }, `No ${kindName('partDef', n).toLowerCase()} has connectors yet`)]);
    pick.addEventListener('change', () => { st.block = pick.value || null; dirty = true; invalidate(); });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' },
      ...(/** @type {['table' | 'n2', string, string][]} */ ([['table', 'ICD table', 'Every interface, one per row'], ['n2', 'N² chart', 'Parts on the diagonal; what flows between them in the cells']])).map(([v, l, t]) => h('button', { type: 'button', title: t, 'aria-pressed': String(st.mode === v), onclick: () => { st.mode = v; dirty = true; invalidate(); } }, l)));
    const deep = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': String(st.deep), title: 'Also list the connectors inside the parts\' own blocks, as seen from this block', onclick: () => { st.deep = !st.deep; dirty = true; invalidate(); } }, icon('layers'), 'Nested parts');
    const search = st.mode === 'table' ? h('input', { class: 'field sm icd-filter', type: 'search', placeholder: 'Filter interfaces', value: st.filter, 'aria-label': 'Filter interfaces' }) : null;
    search?.addEventListener('input', () => { st.filter = /** @type {HTMLInputElement} */ (search).value; paintBody(); });
    toolbar.replaceChildren(
      h('span', { class: 'mlabel' }, 'Interfaces of'), pick, seg, deep, ...(search ? [search] : []),
      h('span', { style: { flex: '1' } }),
      h('button', { class: 'btn sm', type: 'button', title: 'Download as an Excel workbook', disabled: b ? undefined : true, onclick: () => exportXlsx() }, icon('download'), 'Excel'),
      h('button', { class: 'btn sm', type: 'button', title: 'Download as a CSV file', disabled: b ? undefined : true, onclick: () => { const name = `${fileBase()}.csv`; download(name, toCsv(sheet()), 'text/csv'); toast(`Exported ${name}`); } }, icon('download'), 'CSV'));
  }
  async function exportXlsx() {
    const name = `${fileBase()}.xlsx`;
    const rows = sheet();
    const bytes = await writeXlsx([{ name: st.mode === 'n2' ? 'N2 chart' : 'ICD', rows, widths: st.mode === 'n2' ? rows[0].map((_, i) => (i ? 22 : 24)) : [12, 30, 12, 30, 12, 22, 22, 12, 36, 20, 40] }]);
    download(name, /** @type {any} */ (bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(`Exported ${name}`);
  }

  function paintBody() {
    const b = block();
    if (!b) {
      body.replaceChildren(h('div', { class: 'dempty' }, h('b', {}, 'No interfaces yet'),
        h('p', {}, 'Interfaces come from connectors. Open an internal block diagram, add parts with ports, and drag from one port to another to connect them; each connector becomes a row here.')));
      return;
    }
    if (st.mode === 'n2') { body.replaceChildren(n2Table(b)); return; }
    const all = icdRows(model, b, { deep: st.deep });
    const rows = filtered(all);
    const sel = ctx.selected();
    const head = ['ID', 'From', '', 'To', 'Interface', 'Item flow', 'Interface carries', 'Inside', 'Description'];
    const port = (/** @type {string} */ part, /** @type {string} */ p, /** @type {string} */ dir) => h('div', { class: 'icd-end' },
      h('span', { class: 'icd-part' }, part), p ? h('span', { class: 'icd-port mono' }, p, dir ? h('span', { class: `icd-dir d-${dir.replace('/', '')}` }, dir) : null) : null);
    const arrow = (/** @type {string} */ f) => (f === 'From → To' ? '→' : f === 'To → From' ? '←' : f === 'Both ways' ? '↔' : '—');
    body.replaceChildren(
      h('div', { class: 'icd-count muted small' }, rows.length === all.length ? `${all.length} interface${all.length === 1 ? '' : 's'}` : `${rows.length} of ${all.length} interfaces`),
      h('table', { class: 'icd' },
        h('thead', {}, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => {
          const tr = h('tr', { class: r.connector === sel ? 'on' : '', 'data-id': r.connector, title: 'Click to select; double-click to open the internal block diagram' },
            h('td', { class: 'mono icd-id' }, r.id),
            h('td', {}, port(r.fromPart, r.fromPort, r.fromDir)),
            h('td', { class: 'icd-arrow', title: flowWords(r.flow) }, arrow(r.flow)),
            h('td', {}, port(r.toPart, r.toPort, r.toDir)),
            h('td', {}, r.iface ? h('button', { class: 'linkish', type: 'button', onclick: (/** @type {Event} */ e) => { e.stopPropagation(); if (r.ifaceId) ctx.select(r.ifaceId); } }, r.iface) : h('span', { class: 'muted' }, '—')),
            h('td', {}, r.item || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'icd-carries' }, r.carries || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'muted' }, r.via || model.get(r.owner)?.name || ''),
            h('td', { class: 'icd-doc' }, r.doc));
          tr.addEventListener('click', () => ctx.select(r.connector));
          tr.addEventListener('dblclick', () => openIbd(r.owner));
          return tr;
        }))));
  }

  /** @param {string} b */
  function n2Table(b) {
    const n2 = n2Chart(model, b, { deep: st.deep });
    if (!n2.items.length) return h('div', { class: 'dempty' }, h('b', {}, 'No parts'), h('p', {}, `${model.get(b)?.name} has no parts to chart.`));
    const label = (/** @type {import('../model/icd.js').IcdRow} */ r) => r.item || r.iface || r.id;
    return h('div', { class: 'n2-wrap' },
      h('p', { class: 'muted small n2-note' }, 'Read across a row for what that part sends, down a column for what it receives. Interfaces without a flow direction show both ways.'),
      h('table', { class: 'n2', style: { '--n': String(n2.items.length) } },
        h('tbody', {}, n2.items.map((row, i) => h('tr', {}, n2.items.map((col, j) => {
          if (i === j) return h('th', { scope: 'row', class: 'n2-diag' + (row.id ? '' : ' ext'), title: row.type ? `${row.name} : ${row.type}` : row.name }, h('b', {}, row.name), row.type ? h('small', {}, row.type) : null);
          const list = n2.cells.get(`${i},${j}`) || [];
          if (!list.length) return h('td', { class: 'n2-empty', 'aria-label': `${row.name} to ${col.name}: nothing` });
          const td = h('td', { class: 'n2-cell', title: list.map((r) => `${r.id}: ${r.from} → ${r.to}${r.iface ? ` (${r.iface})` : ''}`).join('\n') },
            list.map((r) => h('button', { class: 'n2-item', type: 'button', onclick: () => ctx.select(r.connector), ondblclick: () => openIbd(r.owner) }, label(r))));
          return td;
        }))))));
  }

  function render() {
    if (dirty || stamp !== model.version()) { stamp = model.version(); dirty = false; paintToolbar(); paintBody(); }
  }
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  const unsub = model.subscribe(() => { dirty = true; invalidate(); });

  return {
    el, render, invalidate,
    syncSelection: () => { dirty = true; invalidate(); },
    focus: () => body.focus({ preventScroll: true }),
    /** Show a block's interfaces. @param {string} id */
    show(id) { st.block = id; dirty = true; invalidate(); },
    dispose() { cancelAnimationFrame(raf); unsub(); },
  };
}
