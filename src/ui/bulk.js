// Bulk edit: set one property on many elements at once (priority, status, verification method,
// multiplicity, a description…), as one undoable step. The elements are the boxes selected on
// a diagram, the rows a table shows, or everything of one kind inside a package.
import { h, toast } from './dom.js';
import { modal } from './dialog.js';
import { ELEMENTS, kindName, isRel } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */

/** Properties bulk edit can set: plain values (not references, ends or stereotypes). */
const EDITABLE = new Set(['text', 'longtext', 'enum', 'bool']);

/**
 * The properties every one of these elements has, with the values they have now.
 * @param {Model} m @param {string[]} ids
 * @returns {{ key: string, label: string, type: string, options?: string[], values: Map<string, number> }[]}
 */
export function commonProps(m, ids) {
  const els = ids.map((id) => m.get(id)).filter((e) => !!e && !isRel(e.kind));
  if (!els.length) return [];
  const first = ELEMENTS[/** @type {Element} */ (els[0]).kind]?.props || {};
  /** @type {ReturnType<typeof commonProps>} */
  const out = [];
  for (const [key, spec] of Object.entries(first)) {
    // IDs are each element's own: one value for all of them would only make duplicates
    if (!EDITABLE.has(spec.type) || /** @type {any} */ (spec).hidden || key === 'reqId') continue;
    // the same property (same type and choices) on every element
    const same = els.every((e) => { const p = ELEMENTS[/** @type {Element} */ (e).kind]?.props?.[key]; return p && p.type === spec.type && JSON.stringify(/** @type {any} */ (p).options) === JSON.stringify(/** @type {any} */ (spec).options); });
    if (!same) continue;
    const values = new Map();
    for (const e of els) { const v = String(/** @type {Element} */ (e).props[key] ?? /** @type {any} */ (spec).default ?? ''); values.set(v, (values.get(v) || 0) + 1); }
    out.push({ key, label: spec.label, type: spec.type, options: /** @type {any} */ (spec).options, values });
  }
  // choices (priority, status, method) first: what people set on many at once
  return out.sort((a, b) => (a.type === 'enum' ? 0 : a.type === 'bool' ? 1 : 2) - (b.type === 'enum' ? 0 : b.type === 'bool' ? 1 : 2));
}

/** Everything of a kind inside an element (any depth). @param {Model} m @param {string} root @param {string} kind */
export function kindWithin(m, root, kind) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (c.kind === kind) out.push(c.id); walk(c.id); } };
  walk(root);
  return out;
}

/**
 * @param {Model} m @param {(label: string, fn: (tx: any) => void) => boolean} edit @param {string[]} ids
 * @param {{ notation: import('../model/metamodel.js').Notation, what?: string }} o what: how to name the set ("the 12 rows shown")
 */
export async function bulkEditDialog(m, edit, ids, o) {
  const props = commonProps(m, ids);
  const kinds = [...new Set(ids.map((id) => m.get(id)?.kind).filter(Boolean))];
  const kindWords = kinds.map((k) => kindName(/** @type {string} */ (k), o.notation).toLowerCase()).join(', ');
  if (!props.length) { toast(ids.length ? `These ${kindWords || 'elements'} have no property in common to set` : 'Nothing to edit', true); return; }
  const r = await modal({
    title: `Set a property on ${ids.length} ${ids.length === 1 ? 'element' : 'elements'}`, ok: `Set on ${ids.length}`,
    build: () => {
      let cur = props[0];
      const pick = h('select', { class: 'field', 'aria-label': 'Property' }, props.map((p) => h('option', { value: p.key }, p.label)));
      const valueBox = h('div', {});
      const now = h('small', {});
      /** @type {() => any} */
      let read = () => '';
      const paint = () => {
        cur = /** @type {typeof cur} */ (props.find((p) => p.key === pick.value));
        if (cur.type === 'enum') {
          const s = h('select', { class: 'field', 'aria-label': 'Value' }, (cur.options || []).map((v) => h('option', { value: v }, v)));
          // start at the value most of them do not have yet
          const top = [...cur.values.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          s.value = (cur.options || []).find((v) => v !== top) || '';
          read = () => s.value; valueBox.replaceChildren(s);
        } else if (cur.type === 'bool') {
          const c = h('input', { type: 'checkbox' });
          read = () => c.checked; valueBox.replaceChildren(h('label', { class: 'check-row' }, c, h('span', {}, 'On')));
        } else {
          const t = cur.type === 'longtext' ? h('textarea', { class: 'field', rows: 3, 'aria-label': 'Value' }) : h('input', { class: 'field', type: 'text', 'aria-label': 'Value' });
          read = () => /** @type {HTMLInputElement} */ (t).value; valueBox.replaceChildren(t);
        }
        const vals = [...cur.values.entries()].sort((a, b) => b[1] - a[1]);
        now.textContent = `Now: ${vals.slice(0, 4).map(([v, n]) => `${v === '' ? '(empty)' : v} × ${n}`).join(', ')}${vals.length > 4 ? ', …' : ''}`;
      };
      pick.addEventListener('change', paint);
      paint();
      return {
        body: h('div', {},
          h('p', { class: 'muted small' }, `${o.what || `${ids.length} selected`}: ${kindWords}.`),
          h('label', { class: 'field-label' }, 'Property', pick, now),
          h('div', { class: 'field-label' }, 'New value', valueBox)),
        focus: pick,
        value: () => ({ key: cur.key, label: cur.label, value: read() }),
      };
    },
  });
  if (!r) return;
  let n = 0;
  if (edit(`Set ${r.label.toLowerCase()} on ${ids.length}`, (tx) => {
    for (const id of ids) { const e = m.get(id); if (!e) continue; if (String(e.props[r.key]) !== String(r.value)) { tx.setProps(id, { [r.key]: r.value }); n++; } }
  })) toast(n ? `Set ${r.label.toLowerCase()} on ${n} element${n === 1 ? '' : 's'}${n < ids.length ? ` (${ids.length - n} already had it)` : ''}` : 'They all had that value already');
}
