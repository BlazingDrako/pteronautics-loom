// The requirements table: every requirement inside the table's package, one per row.
// Cells edit in place (Enter or double-click; typing starts editing), headers sort, columns
// can be chosen, reordered by the Columns menu and resized by dragging, and the table exports
// to CSV. Rows are virtualized, so tens of thousands of requirements scroll smoothly.
import { h, icon, toast, formatKeys } from '../ui/dom.js';
import { popupMenu } from '../ui/menu.js';
import { confirm } from '../ui/dialog.js';
import { download } from '../ui/home.js';
import { ELEMENTS, RELATIONSHIPS, kindName, LAYERS } from '../model/metamodel.js';
import { requirementsIn, requirementStatus, levelOf, duplicateIds, sourcesOf, targetsOf, renumber } from '../model/trace.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/trace.js').ReqStatus} ReqStatus */
/**
 * @typedef {{
 *   label: string, w: number,
 *   prop?: string,                         // an editable property
 *   edit?: 'name' | 'text' | 'longtext' | 'enum',
 *   rel?: string, dir?: 'in' | 'out',      // a relationship column: elements related this way
 *   mono?: boolean,
 *   help: string,
 * }} Column
 * @typedef {{ key: string, w: number }} ColUse
 * @typedef {{ el: Element, depth: number }} Row
 */

/** Every column a requirements table can show. */
export const COLUMNS = /** @type {Record<string, Column>} */ ({
  id: { label: 'ID', w: 120, prop: 'reqId', edit: 'text', mono: true, help: 'The requirement\'s identifier' },
  name: { label: 'Name', w: 200, edit: 'name', help: 'A short name' },
  text: { label: 'Text', w: 380, prop: 'text', edit: 'longtext', help: 'What is required ("The system shall…")' },
  level: { label: 'Level', w: 110, prop: 'level', edit: 'enum', help: 'Need, system, subsystem or component; Auto follows derivation' },
  priority: { label: 'Priority', w: 92, prop: 'priority', edit: 'enum', help: 'Must, should or could' },
  status: { label: 'Status', w: 104, prop: 'status', edit: 'enum', help: 'Draft, in review, approved or retired' },
  method: { label: 'Method', w: 124, prop: 'method', edit: 'enum', help: 'How it will be verified' },
  satisfiedBy: { label: 'Satisfied by', w: 200, rel: 'satisfy', dir: 'in', help: 'Design elements that satisfy it' },
  verifiedBy: { label: 'Verified by', w: 180, rel: 'verify', dir: 'in', help: 'Test cases that verify it' },
  refinedBy: { label: 'Refined by', w: 170, rel: 'refine', dir: 'in', help: 'Elements that make it precise' },
  derivedFrom: { label: 'Derived from', w: 170, rel: 'derive', dir: 'out', help: 'Requirements it comes from' },
  derivedInto: { label: 'Derived into', w: 170, rel: 'derive', dir: 'in', help: 'Requirements that come from it' },
  verification: { label: 'Verification', w: 132, help: 'Passed, failed, planned or not verified (through sub-requirements too)' },
  owner: { label: 'Package', w: 160, help: 'Where it lives in the model' },
  rationale: { label: 'Rationale', w: 240, prop: 'doc', edit: 'longtext', help: 'Why it is needed' },
});

export const DEFAULT_COLUMNS = 'id:120,name:200,text:380,priority:92,satisfiedBy:200,verifiedBy:180,verification:132';
export const ROW_H = 52;

/** Parse a table's column setting ("id:120,name:200"); unknown keys are dropped. @param {string} spec @returns {ColUse[]} */
export function parseColumns(spec) {
  const out = /** @type {ColUse[]} */ ([]);
  for (const part of String(spec || DEFAULT_COLUMNS).split(',')) {
    const [key, w] = part.split(':');
    if (!(key in COLUMNS) || out.some((c) => c.key === key)) continue;
    const n = Number(w);
    out.push({ key, w: Number.isFinite(n) && n >= 60 && n <= 1200 ? Math.round(n) : COLUMNS[key].w });
  }
  return out.length ? out : parseColumns(DEFAULT_COLUMNS);
}
/** @param {ColUse[]} cols */
export const formatColumns = (cols) => cols.map((c) => `${c.key}:${c.w}`).join(',');

/** Related elements for a relationship column. @param {Model} m @param {Element} r @param {Column} col */
export function relatedFor(m, r, col) {
  if (!col.rel) return [];
  return col.dir === 'out' ? targetsOf(m, r.id, col.rel) : sourcesOf(m, r.id, col.rel);
}

/** The verification summary for a requirement. @param {ReqStatus | undefined} st */
export function verificationText(st) {
  if (!st) return '';
  return st.failed ? 'Failed' : st.passed ? 'Passed' : st.verified ? 'Planned' : 'Not verified';
}

/** A cell as plain text (for sorting, filtering and CSV). @param {Model} m @param {Element} r @param {string} key @param {Map<string, ReqStatus>} status */
export function cellText(m, r, key, status) {
  const col = COLUMNS[key];
  if (key === 'name') return r.name;
  if (key === 'level') return r.props.level === 'Auto' ? levelOf(m, r.id) : r.props.level;
  if (key === 'verification') return verificationText(status.get(r.id));
  if (key === 'owner') return m.get(/** @type {string} */ (r.owner))?.name || '';
  if (col.rel) return relatedFor(m, r, col).map((e) => (e.kind === 'requirement' && e.props.reqId ? e.props.reqId : e.name)).join(', ');
  return String(r.props[/** @type {string} */ (col.prop)] ?? '');
}

/** Natural order for IDs: REQ-2 before REQ-10. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The rows a table shows.
 * @param {Model} m @param {Element} table
 * @param {{ filter?: string, gapsOnly?: boolean, sort?: string, status?: Map<string, ReqStatus> }} [o]
 *   sort: a column key, "-key" for descending, or empty for model order
 * @returns {Row[]}
 */
export function tableRows(m, table, o = {}) {
  const status = o.status || requirementStatus(m);
  let rows = requirementsIn(m, /** @type {string} */ (table.owner));
  const q = (o.filter || '').trim().toLowerCase();
  if (q) rows = rows.filter(({ el }) => `${el.props.reqId} ${el.name} ${el.props.text}`.toLowerCase().includes(q));
  if (o.gapsOnly) rows = rows.filter(({ el }) => { const st = status.get(el.id); return el.props.status !== 'Retired' && (!st?.satisfied || !st?.verified || st?.failed); });
  const sort = o.sort || '';
  if (sort && COLUMNS[sort.replace(/^-/, '')]) {
    const key = sort.replace(/^-/, ''), dir = sort.startsWith('-') ? -1 : 1;
    const text = new Map(rows.map((r) => [r.el.id, cellText(m, r.el, key, status)]));
    rows = [...rows].sort((a, b) => {
      const x = /** @type {string} */ (text.get(a.el.id)), y = /** @type {string} */ (text.get(b.el.id));
      if (!x !== !y) return x ? -1 : 1; // empty cells last either way
      return dir * collator.compare(x, y);
    });
  }
  return rows;
}

/** @param {string} v */
const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows as CSV, with a header row. @param {Model} m @param {Row[]} rows @param {ColUse[]} cols @param {Map<string, ReqStatus>} status */
export function toCsv(m, rows, cols, status) {
  const lines = [cols.map((c) => csvCell(COLUMNS[c.key].label)).join(',')];
  for (const { el } of rows) lines.push(cols.map((c) => csvCell(cellText(m, el, c.key, status))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Sort and filter state per table, kept while the project is open (not in the model). @type {Map<string, { sort: string, filter: string, gapsOnly: boolean }>} */
const viewState = new Map();

/**
 * @param {{
 *   model: Model, diagramId: string,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 *   newProps?: (kind: string, owner: string) => Record<string, any> | undefined,
 * }} ctx
 */
export function createTableView(ctx) {
  const { model, diagramId } = ctx;
  const table = () => /** @type {Element} */ (model.get(diagramId));
  const state = viewState.get(diagramId) || { sort: '', filter: '', gapsOnly: false };
  viewState.set(diagramId, state);
  /** @type {Row[]} */
  let rows = [];
  /** @type {Map<string, ReqStatus>} */
  let status = new Map();
  /** @type {Set<string>} */
  let dupes = new Set();
  let cols = parseColumns(table().props.columns);
  /** The active cell. @type {{ id: string, col: string } | null} */
  let active = null;
  /** @type {{ id: string, col: string, close: (commit: boolean) => void } | null} */
  let editing = null;
  let dirty = true;
  let raf = 0;

  // ---------- DOM ----------
  const search = h('input', { class: 'field tsearch', type: 'search', placeholder: 'Filter by ID, name or text', 'aria-label': 'Filter requirements', value: state.filter });
  search.addEventListener('input', () => { state.filter = search.value; dirty = true; invalidate(); });
  const gapsBtn = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': String(state.gapsOnly), title: 'Show only requirements that are not yet satisfied or verified, or that failed', onclick: () => { state.gapsOnly = !state.gapsOnly; gapsBtn.setAttribute('aria-pressed', String(state.gapsOnly)); dirty = true; invalidate(); } }, icon('filter'), 'Gaps only');
  const count = h('span', { class: 'tcount muted small' });
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Table tools' },
    h('button', { class: 'btn sm', type: 'button', title: 'Add a requirement below the active row', onclick: () => addRow() }, icon('plus'), 'Requirement'),
    h('span', { class: 'dtool-sep' }),
    search, gapsBtn,
    h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu', onclick: (/** @type {Event} */ e) => columnsMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('columns'), 'Columns'),
    h('button', { class: 'btn sm', type: 'button', title: 'Give every requirement here a fresh ID, in order', onclick: () => renumberAll() }, icon('hash'), 'Renumber'),
    h('button', { class: 'btn sm', type: 'button', title: 'Download the rows shown as a CSV file (opens in Excel)', onclick: () => exportCsv() }, icon('download'), 'CSV'),
    h('span', { style: { flex: '1' } }),
    count);
  const head = h('div', { class: 'thead', role: 'row' });
  const body = h('div', { class: 'tbody', role: 'rowgroup' });
  const emptyMsg = h('div', { class: 'tempty', hidden: true });
  const scroller = h('div', { class: 'tscroll', tabindex: '0', role: 'grid', 'aria-label': 'Requirements' }, head, body, emptyMsg);
  const el = h('div', { class: 'dview tview' }, toolbar, scroller);

  const template = () => cols.map((c) => `${c.w}px`).join(' ');
  const applyTemplate = () => { scroller.style.setProperty('--tcols', template()); scroller.style.setProperty('--tw', `${cols.reduce((a, c) => a + c.w, 0)}px`); };

  // ---------- data ----------
  function refresh() {
    status = requirementStatus(model);
    dupes = duplicateIds(model);
    cols = parseColumns(table().props.columns);
    rows = tableRows(model, table(), { ...state, status });
    dirty = false;
  }

  // ---------- rendering ----------
  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  let lastWindow = '';
  function render() {
    if (!model.get(diagramId)) return;
    if (dirty) { refresh(); lastWindow = ''; paintHead(); }
    applyTemplate();
    const total = requirementsIn(model, /** @type {string} */ (table().owner)).length;
    count.textContent = rows.length === total ? `${total} requirement${total === 1 ? '' : 's'}` : `${rows.length} of ${total} shown`;
    body.style.height = `${rows.length * ROW_H}px`;
    emptyMsg.hidden = rows.length > 0;
    if (!rows.length) {
      const pkg = model.get(/** @type {string} */ (table().owner))?.name || 'this package';
      emptyMsg.replaceChildren(h('b', {}, total ? 'Nothing matches' : 'No requirements yet'), h('p', {}, total ? 'Clear the filter or turn off "Gaps only".' : `Requirements inside ${pkg} appear here. Add one with the Requirement button.`));
    }
    const top = Math.max(0, scroller.scrollTop - head.offsetHeight);
    const first = Math.max(0, Math.floor(top / ROW_H) - 6);
    const last = Math.min(rows.length, first + Math.ceil((scroller.clientHeight || 800) / ROW_H) + 12);
    // never rebuild rows under an open editor: moving it in the DOM would blur it mid-typing
    if (editing) return;
    const key = `${first}:${last}:${active?.id}:${active?.col}:${model.version()}:${rows.length}`;
    if (key === lastWindow) return;
    lastWindow = key;
    const out = [];
    for (let i = first; i < last; i++) out.push(rowEl(rows[i], i));
    body.replaceChildren(...out);
  }

  function paintHead() {
    head.replaceChildren(...cols.map((c, i) => {
      const col = COLUMNS[c.key];
      const sorted = state.sort.replace(/^-/, '') === c.key ? (state.sort.startsWith('-') ? 'descending' : 'ascending') : 'none';
      const grip = h('span', { class: 'tgrip', 'aria-hidden': 'true' });
      grip.addEventListener('pointerdown', (ev) => startResize(ev, i));
      return h('div', { class: 'th', role: 'columnheader', 'aria-sort': sorted, title: col.help },
        h('button', { class: 'th-btn', type: 'button', onclick: () => cycleSort(c.key) },
          h('span', { class: 'th-label' }, col.label),
          sorted !== 'none' ? h('span', { class: 'th-sort' }, sorted === 'ascending' ? '▲' : '▼') : null),
        grip);
    }));
  }

  /** @param {Row} r @param {number} i */
  function rowEl(r, i) {
    const e = r.el;
    const sel = ctx.selected() === e.id;
    const row = h('div', { class: 'trow' + (sel ? ' sel' : '') + (e.props.status === 'Retired' ? ' retired' : ''), role: 'row', 'aria-rowindex': String(i + 2), 'data-id': e.id, style: { top: `${i * ROW_H}px` } },
      cols.map((c) => cellEl(r, c.key)));
    return row;
  }

  /** @param {Row} r @param {string} key */
  function cellEl(r, key) {
    const e = r.el, col = COLUMNS[key];
    const on = active?.id === e.id && active.col === key;
    const cls = ['tcell', col.mono ? 'mono' : '', on ? 'active' : '', col.edit ? 'editable' : ''];
    /** @type {any[]} */
    let kids = [];
    if (key === 'id') {
      const id = String(e.props.reqId || '');
      if (id && dupes.has(id)) cls.push('dupe');
      kids = [id ? h('span', { class: 'tclip' }, id) : h('span', { class: 'tnone' }, 'no ID')];
    } else if (key === 'name') {
      const layer = model.layerOf(e.id);
      kids = [h('span', { class: 'tname', style: { paddingLeft: `${Math.min(r.depth, 8) * 14}px` } },
        r.depth ? h('span', { class: 'tindent', 'aria-hidden': 'true' }, '↳') : null,
        h('span', { class: 'tclip' }, e.name)),
      layer && layer !== 'r' ? h('span', { class: 'pill', style: { color: LAYERS.find((l) => l.id === layer)?.color } }, layer.toUpperCase()) : null];
    } else if (key === 'text' || key === 'rationale') {
      const t = String(e.props[/** @type {string} */ (col.prop)] || '');
      kids = [t ? h('span', { class: 'tclamp' }, t) : h('span', { class: 'tnone' }, key === 'text' ? 'No text yet' : '—')];
    } else if (col.rel) {
      const list = relatedFor(model, e, col);
      const n = ctx.notation();
      kids = [h('span', { class: 'tchips' },
        list.map((x) => h('span', { class: 'tchip', title: `${x.name} · ${kindName(x.kind, n)}` },
          h('button', { class: 'tchip-name', type: 'button', tabindex: '-1', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); ctx.select(x.id); } }, x.kind === 'requirement' && x.props.reqId ? x.props.reqId : x.name),
          h('button', { class: 'tchip-x', type: 'button', tabindex: '-1', 'aria-label': `Remove ${x.name}`, title: 'Remove this relationship', onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); unlink(e, x, col); } }, '×'))),
        list.length ? null : emptyRel(e, key)),
        h('button', { class: 'tadd', type: 'button', tabindex: '-1', 'aria-label': `Add ${col.label.toLowerCase()}`, title: `Add ${col.label.toLowerCase()}…`, onclick: (/** @type {Event} */ ev) => { ev.stopPropagation(); linkMenu(/** @type {HTMLElement} */ (ev.currentTarget), e, col); } }, '+')];
    } else if (key === 'verification') {
      const v = verificationText(status.get(e.id));
      kids = [h('span', { class: 'tverif ' + v.toLowerCase().replace(' ', '-') }, v === 'Passed' ? '✓ ' : v === 'Failed' ? '✕ ' : '', v)];
    } else if (key === 'level') {
      const auto = e.props.level === 'Auto';
      kids = [h('span', { class: 'tclip' }, cellText(model, e, key, status)), auto ? h('span', { class: 'tauto' }, 'auto') : null];
    } else {
      const v = cellText(model, e, key, status);
      kids = [v && v !== '—' ? h('span', { class: 'tclip' }, v) : h('span', { class: 'tnone' }, '—')];
    }
    const cell = h('div', { class: cls.filter(Boolean).join(' '), role: 'gridcell', 'data-col': key, title: key === 'text' ? String(e.props.text || '') : undefined }, kids);
    if (key === 'id' && dupes.has(String(e.props.reqId || ''))) cell.title = 'Another requirement has this ID';
    return cell;
  }

  /** What an empty relationship cell says: covered through sub-requirements, a gap, or nothing. @param {Element} e @param {string} key */
  function emptyRel(e, key) {
    const st = status.get(e.id);
    const covered = key === 'satisfiedBy' ? st?.satisfied : key === 'verifiedBy' ? st?.verified : undefined;
    if (covered) return h('span', { class: 'tvia' }, 'via sub-requirements');
    if (covered === false && e.props.status !== 'Retired') return h('span', { class: 'tgap', title: key === 'satisfiedBy' ? 'Nothing satisfies this yet' : 'Nothing verifies this yet' }, 'gap');
    return h('span', { class: 'tnone' }, '—');
  }

  // ---------- editing ----------
  /** @param {string} id @param {string} key @param {string} [initial] text typed to start editing */
  function startEdit(id, key, initial) {
    const col = COLUMNS[key], e = model.get(id);
    if (!col.edit || !e) return;
    editing?.close(true);
    scrollToRow(id); render();
    const cell = /** @type {HTMLElement | null} */ (body.querySelector(`.trow[data-id="${CSS.escape(id)}"] [data-col="${key}"]`));
    if (!cell) return;
    const value = col.edit === 'name' ? e.name : String(e.props[/** @type {string} */ (col.prop)] ?? '');
    /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */
    let input;
    if (col.edit === 'enum') {
      const spec = /** @type {any} */ (ELEMENTS.requirement.props[/** @type {string} */ (col.prop)]);
      input = h('select', { class: 'tinput' }, spec.options.map((/** @type {string} */ o) => h('option', { value: o, selected: o === value ? true : undefined }, o)));
    } else if (col.edit === 'longtext') {
      input = h('textarea', { class: 'tinput', rows: 4, maxlength: 20000 }, initial ?? value);
    } else {
      input = h('input', { class: 'tinput' + (col.mono ? ' mono' : ''), type: 'text', value: initial ?? value, maxlength: 500 });
    }
    cell.classList.add('editing');
    cell.replaceChildren(input);
    let closed = false;
    const close = (/** @type {boolean} */ commit) => {
      if (closed) return; closed = true; editing = null;
      const v = input.value;
      if (commit && v !== value) {
        if (col.edit === 'name') { if (v.trim()) ctx.edit('Rename', (tx) => tx.rename(id, v)); }
        else ctx.edit(`Change ${col.label.toLowerCase()}`, (tx) => tx.setProps(id, { [/** @type {string} */ (col.prop)]: v }));
      }
      lastWindow = ''; dirty = true; render();
      scroller.focus({ preventScroll: true });
    };
    editing = { id, col: key, close };
    input.addEventListener('keydown', (ev) => {
      const k = /** @type {KeyboardEvent} */ (ev);
      k.stopPropagation();
      if (k.key === 'Escape') { k.preventDefault(); close(false); }
      else if (k.key === 'Enter' && (col.edit !== 'longtext' || k.metaKey || k.ctrlKey || !k.shiftKey)) {
        if (col.edit === 'longtext' && k.shiftKey) return; // Shift+Enter: a new line
        k.preventDefault(); close(true); move(1, 0);
      } else if (k.key === 'Tab') { k.preventDefault(); close(true); move(0, k.shiftKey ? -1 : 1); }
    });
    input.addEventListener('blur', () => close(true));
    if (col.edit === 'enum') input.addEventListener('change', () => close(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    input.focus();
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      if (initial !== undefined) input.setSelectionRange(input.value.length, input.value.length); else input.select();
    }
  }

  /** @param {Element} req @param {Element} other @param {Column} col */
  function unlink(req, other, col) {
    const [src, tgt] = col.dir === 'out' ? [req.id, other.id] : [other.id, req.id];
    const r = model.relsFrom(src).find((x) => x.kind === col.rel && x.target === tgt);
    if (r) ctx.edit('Remove relationship', (tx) => tx.remove(r.id));
  }

  /** Add a relationship from a cell. @param {HTMLElement} anchor @param {Element} req @param {Column} col */
  function linkMenu(anchor, req, col) {
    const kind = /** @type {string} */ (col.rel);
    const cands = model.all().filter((t) => t.owner && (col.dir === 'out' ? model.canLink(kind, req.id, t.id) : model.canLink(kind, t.id, req.id)))
      .sort((a, b) => collator.compare(a.props.reqId || a.name, b.props.reqId || b.name));
    if (!cands.length) { toast(`Nothing in the model can be linked to ${req.name} this way yet`); return; }
    const shown = cands.slice(0, 40);
    popupMenu(anchor, [
      ...shown.map((t) => ({
        label: t.kind === 'requirement' && t.props.reqId ? `${t.props.reqId} ${t.name}` : t.name,
        hint: ELEMENTS[t.kind].abbr,
        run: () => ctx.edit(`Add ${RELATIONSHIPS[kind].names.sysml.toLowerCase()}`, (tx) => (col.dir === 'out' ? tx.link(kind, req.id, t.id) : tx.link(kind, t.id, req.id))),
      })),
      ...(cands.length > shown.length ? /** @type {const} */ (['sep', { label: `${cands.length - shown.length} more: use the inspector or a matrix`, disabled: true, run: () => {} }]) : []),
    ], { title: `${col.label}…` });
  }

  /** Add a requirement after the active row (or at the end of the table's package) and name it. */
  function addRow() {
    const after = active ? model.get(active.id) : null;
    const owner = after?.owner && model.canCreate(after.owner, 'requirement') ? after.owner : /** @type {string} */ (table().owner);
    if (!model.canCreate(owner, 'requirement')) { toast('Requirements can only be added to packages', true); return; }
    const sibs = model.children(owner).map((c) => c.id);
    const index = after && after.owner === owner ? sibs.indexOf(after.id) + 1 : Infinity;
    let id = '';
    if (!ctx.edit('New requirement', (tx) => { id = tx.create('requirement', { owner, index, props: ctx.newProps?.('requirement', owner) }); })) return;
    if (state.filter || state.gapsOnly) { state.filter = ''; search.value = ''; }
    active = { id, col: 'name' };
    ctx.select(id);
    dirty = true; render();
    startEdit(id, 'name');
  }

  async function renumberAll() {
    const pkg = model.get(/** @type {string} */ (table().owner));
    const n = requirementsIn(model, /** @type {string} */ (table().owner)).length;
    if (!pkg || !n) { toast('No requirements to renumber'); return; }
    const ok = await confirm({ title: 'Renumber requirements?', body: `Every requirement in ${pkg.name} (${n}) gets a new ID in model order, using its package's ID prefix (set on the package in the inspector; REQ- when none is set). Undo puts the old IDs back.`, ok: 'Renumber' });
    if (!ok) return;
    let changed = 0;
    if (ctx.edit('Renumber requirements', (tx) => { changed = renumber(model, tx, pkg.id); })) toast(changed ? `Renumbered ${changed} requirement${changed === 1 ? '' : 's'}. ${formatKeys('Mod+Z')} to undo.` : 'The IDs were already in order');
  }

  function exportCsv() {
    const name = `${table().name.replace(/[^\w\- ]+/g, '').trim() || 'requirements'}.csv`;
    download(name, '﻿' + toCsv(model, rows, cols, status), 'text/csv');
    toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to ${name}`);
  }

  /** @param {string} key */
  function cycleSort(key) {
    state.sort = state.sort === key ? `-${key}` : state.sort === `-${key}` ? '' : key;
    dirty = true; invalidate();
  }

  /** @param {HTMLElement} anchor */
  function columnsMenu(anchor) {
    const shown = new Set(cols.map((c) => c.key));
    popupMenu(anchor, [
      ...Object.entries(COLUMNS).map(([key, c]) => ({
        label: `${shown.has(key) ? '✓ ' : ' '}${c.label}`, hint: c.rel ? 'link' : '',
        disabled: key === 'name' && shown.has(key),
        run: () => {
          const next = shown.has(key) ? cols.filter((x) => x.key !== key) : [...cols, { key, w: c.w }];
          setColumns(next, `${shown.has(key) ? 'Hide' : 'Show'} ${c.label.toLowerCase()} column`);
        },
      })),
      'sep',
      { label: 'Reset to the default columns', run: () => setColumns(parseColumns(DEFAULT_COLUMNS), 'Reset table columns') },
    ], { title: 'Columns' });
  }
  /** @param {ColUse[]} next @param {string} label */
  function setColumns(next, label) {
    ctx.edit(label, (tx) => tx.setProps(diagramId, { columns: formatColumns(next) }));
  }

  /** @param {PointerEvent} ev @param {number} i */
  function startResize(ev, i) {
    ev.preventDefault(); ev.stopPropagation();
    const x0 = ev.clientX, w0 = cols[i].w;
    const grip = /** @type {HTMLElement} */ (ev.currentTarget);
    grip.setPointerCapture(ev.pointerId);
    const onMove = (/** @type {PointerEvent} */ e) => { cols[i].w = Math.max(60, Math.min(1200, Math.round(w0 + e.clientX - x0))); applyTemplate(); };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove); grip.removeEventListener('pointerup', onUp);
      if (cols[i].w !== w0) setColumns(cols, `Resize ${COLUMNS[cols[i].key].label.toLowerCase()} column`);
    };
    grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', onUp);
  }

  // ---------- navigation ----------
  /** @param {string} id */
  function scrollToRow(id) {
    const i = rows.findIndex((r) => r.el.id === id);
    if (i < 0) return;
    const top = head.offsetHeight + i * ROW_H, bottom = top + ROW_H;
    if (top < scroller.scrollTop + head.offsetHeight) scroller.scrollTop = top - head.offsetHeight;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight;
  }
  /** @param {number} dr @param {number} dc */
  function move(dr, dc) {
    if (!rows.length) return;
    let ri = active ? rows.findIndex((r) => r.el.id === active?.id) : -1;
    let ci = active ? cols.findIndex((c) => c.key === active?.col) : 0;
    if (ri < 0) { ri = 0; ci = Math.max(0, ci); }
    else { ri = Math.max(0, Math.min(rows.length - 1, ri + dr)); ci = Math.max(0, Math.min(cols.length - 1, ci + dc)); }
    active = { id: rows[ri].el.id, col: cols[ci].key };
    if (dr) ctx.select(active.id);
    scrollToRow(active.id);
    lastWindow = ''; render();
  }

  scroller.addEventListener('scroll', () => invalidate(), { passive: true });
  scroller.addEventListener('pointerdown', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.closest('.tinput, .th, button')) return;
    const cell = /** @type {HTMLElement | null} */ (t.closest('.tcell'));
    const row = /** @type {HTMLElement | null} */ (t.closest('.trow'));
    if (!cell || !row) return;
    active = { id: /** @type {string} */ (row.dataset.id), col: /** @type {string} */ (cell.dataset.col) };
    ctx.select(active.id);
    lastWindow = ''; render();
    // the clicked cell was just rebuilt, so the browser would focus nothing: keep keys coming here
    ev.preventDefault();
    scroller.focus({ preventScroll: true });
  });
  scroller.addEventListener('dblclick', (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const cell = /** @type {HTMLElement | null} */ (t.closest('.tcell'));
    const row = /** @type {HTMLElement | null} */ (t.closest('.trow'));
    if (cell && row && !t.closest('button, .tinput')) startEdit(/** @type {string} */ (row.dataset.id), /** @type {string} */ (cell.dataset.col));
  });
  scroller.addEventListener('keydown', (ev) => {
    if (ev.target !== scroller) return;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    const nav = /** @type {Record<string, [number, number]>} */ ({ ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, ev.shiftKey ? -1 : 1] });
    if (nav[ev.key] && !(ev.metaKey || ev.ctrlKey)) { stop(); move(...nav[ev.key]); return; }
    if (ev.key === 'PageDown' || ev.key === 'PageUp') { stop(); move((ev.key === 'PageDown' ? 1 : -1) * Math.max(1, Math.floor(scroller.clientHeight / ROW_H) - 1), 0); return; }
    if ((ev.key === 'Enter' || ev.key === 'F2') && active) { stop(); startEdit(active.id, active.col); return; }
    if (active && ev.key.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey && ['text', 'name', 'longtext'].includes(COLUMNS[active.col].edit || '')) { stop(); startEdit(active.id, active.col, ev.key); }
  });

  const unsub = model.subscribe(() => { dirty = true; invalidate(); });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { lastWindow = ''; invalidate(); }) : null;
  ro?.observe(scroller);
  invalidate();

  return {
    el, render, invalidate: () => { dirty = true; invalidate(); },
    /** @param {string | null} id */
    syncSelection(id) {
      if (id && rows.some((r) => r.el.id === id)) { if (active?.id !== id) active = { id, col: active?.col || 'name' }; scrollToRow(id); }
      lastWindow = ''; invalidate();
    },
    focus: () => scroller.focus({ preventScroll: true }),
    /** For tests and the benchmark page. */
    rows: () => rows,
    dispose() { cancelAnimationFrame(raf); unsub(); ro?.disconnect(); editing?.close(false); },
  };
}
