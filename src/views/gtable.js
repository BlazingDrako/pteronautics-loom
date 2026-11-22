// A generic table: any kinds of element as rows, with the columns you choose (see
// model/gtable.js). Click a row to select its element; double-click a cell (or press Enter on
// it) to edit it in place; click a header to sort; right-click a header to move or hide its
// column. Rows, scope and columns are saved with the table.
import { h, icon, toast } from '../ui/dom.js';
import { popupMenu } from '../ui/menu.js';
import { modal } from '../ui/dialog.js';
import { download } from '../ui/home.js';
import { bulkEditDialog } from '../ui/bulk.js';
import { writeXlsx, toCsv } from '../interop/sheet.js';
import { ELEMENTS, kindName } from '../model/metamodel.js';
import { setTag, appliedList } from '../custom/stereo.js';
import { ROW_KINDS, rowKindsOf, columnIdsOf, defaultColumns, availableColumns, gtableRows, shapeRows, cellOf, gtableSheet } from '../model/gtable.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/gtable.js').Column} Column */

/** The filter typed into each table (not saved with the model). @type {Map<string, string>} */
const filters = new Map();

/**
 * @param {{ model: Model, diagramId: string, notation: () => import('../model/metamodel.js').Notation, selected: () => string | null, select: (id: string | null) => void, edit: (label: string, fn: (tx: any) => void) => boolean, newProps?: (kind: string, owner: string) => Record<string, any> | undefined }} ctx
 */
export function createGenericTableView(ctx) {
  const { model, diagramId } = ctx;
  const t = () => /** @type {Element} */ (model.get(diagramId));
  let dirty = true, raf = 0, stamp = -1;
  /** @type {Element[]} */
  let rows = [];
  /** @type {Column[]} */
  let cols = [];
  /** The cell being edited. @type {null | { id: string, col: string }} */
  let editing = null;

  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Table tools' });
  const body = h('div', { class: 'icd-scroll gt-scroll', tabindex: '0' });
  const el = h('div', { class: 'dview icd-view gt-view' }, toolbar, body);
  const n = () => ctx.notation();
  const setProps = (/** @type {Record<string, any>} */ p, /** @type {string} */ label) => ctx.edit(label, (tx) => tx.setProps(diagramId, p));
  /** The column ids shown (the saved ones, or the defaults for the kinds). */
  const shownIds = () => { const c = columnIdsOf(t()); return c.length ? c : defaultColumns(rowKindsOf(t())); };

  function compute() {
    const all = availableColumns(model, rowKindsOf(t()), n());
    const byId = new Map(all.map((c) => [c.id, c]));
    cols = shownIds().map((id) => byId.get(id)).filter((c) => !!c);
    rows = shapeRows(model, gtableRows(model, t()), cols.map((c) => c.id), { filter: filters.get(diagramId) || '', sort: String(t().props.sort || '') }, n());
  }

  // ---------- toolbar ----------
  function paintToolbar() {
    const kinds = rowKindsOf(t());
    const scope = h('select', { class: 'field sm', 'aria-label': 'Where' },
      h('option', { value: 'package', selected: t().props.scope !== 'model' ? true : undefined }, `In ${model.get(/** @type {string} */ (t().owner))?.name || 'this package'}`),
      h('option', { value: 'model', selected: t().props.scope === 'model' ? true : undefined }, 'In the whole model'));
    scope.addEventListener('change', () => setProps({ scope: scope.value }, scope.value === 'model' ? 'Table: the whole model' : 'Table: this package'));
    const search = h('input', { class: 'field sm icd-filter', type: 'search', placeholder: 'Filter rows', value: filters.get(diagramId) || '', 'aria-label': 'Filter rows' });
    search.addEventListener('input', () => { filters.set(diagramId, search.value); dirty = true; invalidate(); });
    toolbar.replaceChildren(
      h('span', { class: 'mlabel' }, 'Rows'),
      h('button', { class: 'btn sm', type: 'button', title: 'Which kinds of element are rows', onclick: () => pickKinds() }, kinds.map((k) => plural(kindName(k, n()))).join(', ') || 'Choose…'),
      scope,
      h('button', { class: 'btn sm', type: 'button', title: 'Choose and order the columns', onclick: () => pickColumns() }, icon('columns'), 'Columns'),
      search,
      h('span', { style: { flex: '1' } }),
      h('span', { class: 'tcount muted small gt-count' }),
      h('button', { class: 'btn sm', type: 'button', title: 'Add a new element as a row', onclick: () => addRow() }, icon('plus'), 'Row'),
      h('button', { class: 'btn sm', type: 'button', title: 'Set a property on every row shown (filter first to choose which)', onclick: () => { if (!rows.length) { toast('No rows shown'); return; } bulkEditDialog(model, ctx.edit, rows.map((r) => r.id), { notation: n(), what: filters.get(diagramId) ? `The ${rows.length} rows shown (filtered)` : `All ${rows.length} rows` }); } }, icon('sliders'), 'Set…'),
      h('button', { class: 'btn sm', type: 'button', title: 'Download the rows shown as an Excel workbook', onclick: () => exportXlsx() }, icon('download'), 'Excel'),
      h('button', { class: 'btn sm', type: 'button', title: 'Download the rows shown as a CSV file', onclick: () => { const name = `${fileBase()}.csv`; download(name, toCsv(gtableSheet(model, rows, cols, n())), 'text/csv'); toast(`Exported ${name}`); } }, icon('download'), 'CSV'));
  }
  const fileBase = () => t().name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'table';
  async function exportXlsx() {
    const name = `${fileBase()}.xlsx`;
    const bytes = await writeXlsx([{ name: t().name, rows: gtableSheet(model, rows, cols, n()), widths: cols.map((c) => (c.id === 'name' ? 28 : c.edit === 'longtext' || c.id === 'doc' ? 44 : 22)) }]);
    download(name, /** @type {any} */ (bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(`Exported ${name}`);
  }

  /** Choose the kinds of element the rows are. */
  async function pickKinds() {
    const cur = new Set(rowKindsOf(t()));
    const r = await modal({
      title: 'Rows: which kinds of element', ok: 'Show',
      build: () => {
        const box = h('div', { class: 'kind-picks', role: 'group', 'aria-label': 'Kinds' });
        const paint = () => box.replaceChildren(...ROW_KINDS.filter((k) => !ELEMENTS[k].noMenu || ['part', 'port', 'attribute', 'connector', 'constraint'].includes(k)).map((k) => h('button', { class: 'kind-pick' + (cur.has(k) ? ' on' : ''), type: 'button', 'aria-pressed': String(cur.has(k)), onclick: () => { if (cur.has(k)) cur.delete(k); else cur.add(k); paint(); } }, kindName(k, n()))));
        paint();
        return { body: h('div', {}, h('p', { class: 'muted small' }, 'Every element of these kinds becomes a row. Mixing kinds works; columns only fill in where a kind has them.'), box), value: () => (cur.size ? [...cur] : null) };
      },
    });
    if (!r) return;
    // a column the new kinds cannot fill is kept only if any of them has it
    const avail = new Set(availableColumns(model, r, n()).map((c) => c.id));
    const keep = columnIdsOf(t()).filter((c) => avail.has(c));
    setProps({ rowKinds: r.join(','), columns: keep.length ? JSON.stringify(keep) : '' }, 'Table: rows');
  }
  /** Choose and order the columns. */
  async function pickColumns() {
    const all = availableColumns(model, rowKindsOf(t()), n());
    /** @type {string[]} */
    let chosen = [...shownIds()];
    const r = await modal({
      title: 'Columns', ok: 'Show', wide: true,
      build: () => {
        const order = h('div', { class: 'gt-order' });
        const groups = h('div', {});
        const paint = () => {
          order.replaceChildren(...(chosen.length ? chosen.map((id, i) => {
            const c = all.find((x) => x.id === id);
            return h('span', { class: 'gt-chip' },
              h('button', { class: 'gt-chip-move', type: 'button', disabled: i ? undefined : true, 'aria-label': `Move ${c?.label} left`, onclick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; paint(); } }, '‹'),
              h('span', {}, c?.label || id),
              h('button', { class: 'gt-chip-move', type: 'button', disabled: i < chosen.length - 1 ? undefined : true, 'aria-label': `Move ${c?.label} right`, onclick: () => { [chosen[i + 1], chosen[i]] = [chosen[i], chosen[i + 1]]; paint(); } }, '›'),
              h('button', { class: 'gt-chip-move', type: 'button', 'aria-label': `Remove ${c?.label}`, onclick: () => { chosen = chosen.filter((x) => x !== id); paint(); } }, '×'));
          }) : [h('span', { class: 'muted small' }, 'No columns: pick some below')]));
          const byGroup = new Map();
          for (const c of all) byGroup.set(c.group, [...(byGroup.get(c.group) || []), c]);
          groups.replaceChildren(...[...byGroup.entries()].map(([g, list]) => h('div', { class: 'field-label' }, g,
            h('div', { class: 'kind-picks' }, list.map((/** @type {Column} */ c) => h('button', { class: 'kind-pick' + (chosen.includes(c.id) ? ' on' : ''), type: 'button', 'aria-pressed': String(chosen.includes(c.id)), onclick: () => { chosen = chosen.includes(c.id) ? chosen.filter((x) => x !== c.id) : [...chosen, c.id]; paint(); } }, c.label))))));
        };
        paint();
        return { body: h('div', {}, h('div', { class: 'field-label' }, 'Shown, in order', order), groups), value: () => (chosen.length ? chosen : null) };
      },
    });
    if (r) setProps({ columns: JSON.stringify(r) }, 'Table: columns');
  }
  /** A new element of the first row kind, in the table's package (or where it can go). */
  function addRow() {
    const kind = rowKindsOf(t())[0];
    const owner = /** @type {string} */ (t().owner);
    if (!kind || !model.canCreate(owner, kind)) { toast(`A ${kindName(kind || 'partDef', n()).toLowerCase()} cannot go in ${model.get(owner)?.name}: add it in the model browser, inside what owns it`, true); return; }
    let id = '';
    if (!ctx.edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => { id = tx.create(kind, { owner, props: ctx.newProps?.(kind, owner) }); })) return;
    ctx.select(id);
    compute(); paintBody();
    startEdit(id, 'name');
  }

  // ---------- the grid ----------
  function paintBody() {
    const count = toolbar.querySelector('.gt-count');
    const total = gtableRows(model, t()).length;
    if (count) count.textContent = rows.length === total ? `${total} row${total === 1 ? '' : 's'}` : `${rows.length} of ${total}`;
    if (!cols.length) { body.replaceChildren(h('div', { class: 'dempty' }, h('b', {}, 'No columns'), h('p', {}, 'Choose columns with the Columns button.'))); return; }
    if (!total) { body.replaceChildren(h('div', { class: 'dempty' }, h('b', {}, 'No rows'), h('p', {}, `There are no ${rowKindsOf(t()).map((k) => plural(kindName(k, n())).toLowerCase()).join(' or ')} ${t().props.scope === 'model' ? 'in the model' : `in ${model.get(/** @type {string} */ (t().owner))?.name}`} yet. Choose other rows, the whole model, or add one with + Row.`))); return; }
    const [sc, dir] = String(t().props.sort || '').split(':');
    const sel = ctx.selected();
    body.replaceChildren(h('table', { class: 'icd gtable' },
      h('thead', {}, h('tr', {}, cols.map((c) => {
        const th = h('th', { scope: 'col', class: 'gt-th', title: `${c.label}: click to sort, right-click for more`, 'aria-sort': sc === c.id ? (dir === 'desc' ? 'descending' : 'ascending') : undefined },
          c.label, sc === c.id ? h('span', { class: 'gt-sort' }, dir === 'desc' ? ' ↓' : ' ↑') : null);
        th.addEventListener('click', () => setProps({ sort: sc !== c.id ? `${c.id}:asc` : dir === 'asc' ? `${c.id}:desc` : '' }, 'Sort the table'));
        th.addEventListener('contextmenu', (ev) => { ev.preventDefault(); headerMenu(th, c); });
        return th;
      }))),
      h('tbody', {}, rows.map((e) => {
        const tr = h('tr', { class: e.id === sel ? 'on' : '', 'data-id': e.id },
          cols.map((c) => {
            const v = cellOf(model, e, c.id, n());
            const editable = canEdit(e, c);
            const td = h('td', { class: (c.id === 'name' ? 'gt-name ' : '') + (editable ? 'gt-edit' : ''), 'data-col': c.id, tabindex: editable ? '0' : undefined, title: editable ? 'Double-click (or Enter) to edit' : undefined },
              v.ids && v.ids.length && c.id !== 'name'
                ? v.ids.map((id, i) => h('button', { class: 'gt-chip-link', type: 'button', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); ctx.select(id); } }, (v.text.split(', ')[i] ?? model.get(id)?.name) || '?'))
                : c.edit === 'bool' && editable ? h('input', { type: 'checkbox', checked: v.raw ? true : undefined, 'aria-label': c.label, onclick: (/** @type {Event} */ ev) => ev.stopPropagation(), onchange: (/** @type {Event} */ ev) => commitCell(e.id, c, /** @type {HTMLInputElement} */ (ev.target).checked) })
                : v.text || (editable ? h('span', { class: 'muted' }, '—') : ''));
            if (editable && c.edit !== 'bool') {
              // selecting re-renders the table, so a double-click is read from the second click's count
              td.addEventListener('click', (/** @type {MouseEvent} */ ev) => { if (ev.detail === 2) { ev.stopPropagation(); startEdit(e.id, c.id); } });
              td.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); startEdit(e.id, c.id); } });
            }
            return td;
          }));
        tr.addEventListener('click', () => ctx.select(e.id));
        return tr;
      }))));
    if (editing) { const ed = editing; editing = null; startEdit(ed.id, ed.col); }
  }
  /** @param {Element} e @param {Column} c */
  function canEdit(e, c) {
    if (!c.edit) return false;
    if (c.id === 'name') return !!e.owner;
    if (c.id.startsWith('p:')) return !!ELEMENTS[e.kind]?.props?.[c.id.slice(2)];
    if (c.edit === 'tag') return appliedList(e).some((a) => a.s === c.id.split(':')[1]);
    return true;
  }
  /** @param {HTMLElement} th @param {Column} c */
  function headerMenu(th, c) {
    const ids = shownIds();
    const i = ids.indexOf(c.id);
    const put = (/** @type {string[]} */ next, /** @type {string} */ label) => setProps({ columns: JSON.stringify(next) }, label);
    popupMenu(th, [
      { label: 'Sort A → Z', run: () => setProps({ sort: `${c.id}:asc` }, 'Sort the table') },
      { label: 'Sort Z → A', run: () => setProps({ sort: `${c.id}:desc` }, 'Sort the table') },
      'sep',
      { label: 'Move left', disabled: i <= 0, run: () => { const x = [...ids]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; put(x, 'Move a column'); } },
      { label: 'Move right', disabled: i >= ids.length - 1, run: () => { const x = [...ids]; [x[i + 1], x[i]] = [x[i], x[i + 1]]; put(x, 'Move a column'); } },
      { label: 'Hide this column', disabled: ids.length <= 1, run: () => put(ids.filter((x) => x !== c.id), 'Hide a column') },
      { label: 'Columns…', run: () => pickColumns() },
    ], { title: c.label });
  }
  /** Edit a cell in place. @param {string} id @param {string} colId */
  function startEdit(id, colId) {
    const e = model.get(id), c = cols.find((x) => x.id === colId);
    const td = /** @type {HTMLElement | null} */ (body.querySelector(`tr[data-id="${id}"] td[data-col="${CSS.escape(colId)}"]`));
    if (!e || !c || !td || !canEdit(e, c)) return;
    const v = cellOf(model, e, colId, n());
    /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */
    let input;
    if (c.edit === 'enum') input = h('select', { class: 'gt-input' }, (c.options || []).map((o) => h('option', { value: o, selected: String(v.raw) === o ? true : undefined }, o)));
    else if (c.edit === 'longtext') input = h('textarea', { class: 'gt-input', rows: 3 });
    else input = h('input', { class: 'gt-input', type: 'text' });
    if (c.edit !== 'enum') input.value = v.raw === undefined || v.raw === null ? '' : String(v.raw);
    let done = false;
    const finish = (/** @type {boolean} */ ok) => {
      if (done) return; done = true;
      if (ok) commitCell(id, c, input.value);
      dirty = true; invalidate();
      setTimeout(() => /** @type {HTMLElement | null} */ (body.querySelector(`tr[data-id="${id}"] td[data-col="${CSS.escape(colId)}"]`))?.focus(), 0);
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      else if (ev.key === 'Enter' && (c.edit !== 'longtext' || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); finish(true); }
    });
    input.addEventListener('blur', () => finish(true));
    if (c.edit === 'enum') input.addEventListener('change', () => finish(true));
    input.addEventListener('click', (ev) => ev.stopPropagation());
    td.replaceChildren(input);
    input.focus();
    if (input instanceof HTMLInputElement) input.select();
  }
  /** Write a cell. @param {string} id @param {Column} c @param {any} value */
  function commitCell(id, c, value) {
    const e = model.get(id);
    if (!e) return;
    if (c.id === 'name') { const v = String(value).trim(); if (v && v !== e.name) ctx.edit('Rename', (tx) => tx.rename(id, v)); return; }
    if (c.id === 'doc') { if (String(value) !== String(e.props.doc || '')) ctx.edit('Edit description', (tx) => tx.setProps(id, { doc: String(value) })); return; }
    if (c.id.startsWith('p:')) {
      const key = c.id.slice(2);
      if (String(e.props[key] ?? '') === String(value)) return;
      ctx.edit(`Set ${c.label.toLowerCase()}`, (tx) => tx.setProps(id, { [key]: value }));
      return;
    }
    if (c.id.startsWith('tag:')) {
      const [, st, tag] = c.id.split(':');
      ctx.edit(`Set ${c.label}`, (tx) => setTag(model, tx, id, st, tag, String(value)));
    }
  }

  function render() {
    if (dirty || stamp !== model.version()) {
      // an edit underway survives a redraw caused by something else
      const keep = body.querySelector('.gt-input') ? editingCell() : null;
      stamp = model.version(); dirty = false;
      compute(); paintToolbar();
      editing = keep;
      paintBody();
    }
  }
  /** The cell being edited now, if any. */
  function editingCell() {
    const td = /** @type {HTMLElement | null} */ (body.querySelector('.gt-input')?.closest('td'));
    const tr = /** @type {HTMLElement | null} */ (td?.closest('tr'));
    return td && tr ? { id: /** @type {string} */ (tr.dataset.id), col: /** @type {string} */ (td.dataset.col) } : null;
  }
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  const unsub = model.subscribe(() => { dirty = true; invalidate(); });

  return {
    el, render, invalidate,
    syncSelection: () => { dirty = true; invalidate(); },
    focus: () => body.focus({ preventScroll: true }),
    /** For tests: the rows and columns shown. */
    shown: () => ({ rows: rows.map((r) => r.id), cols: cols.map((c) => c.id) }),
    startEdit,
    dispose() { cancelAnimationFrame(raf); unsub(); },
  };
}

/** @param {string} s */
function plural(s) { return /(s|x|ch|sh)$/i.test(s) ? `${s}es` : /[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`; }
