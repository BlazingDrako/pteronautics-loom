// The inspector: everything about the selected element, editable in place.
// With nothing selected it shows the project, display and integration settings.
import { h, icon } from './dom.js';
import { ELEMENTS, RELATIONSHIPS, LAYERS, kindName, canRelate, isRel, isDiagram } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/**
 * @typedef {{
 *   model: Model,
 *   settings: import('../settings.js').SettingsStore,
 *   commands: import('../commands.js').CommandRegistry,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 *   meta: () => { created: string, modified: string },
 *   open: (id: string) => void,
 * }} InspectorCtx
 */

const LAYER = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** @param {InspectorCtx} ctx */
export function createInspector(ctx) {
  const el = h('aside', { class: 'inspector', 'aria-label': 'Inspector' });

  /** A text or long-text field that commits on blur or Enter. @param {string} label @param {string} value @param {(v: string) => void} commit @param {{ long?: boolean, placeholder?: string, mono?: boolean }} [o] */
  function textField(label, value, commit, o = {}) {
    const input = o.long
      ? h('textarea', { class: 'field', rows: 3, placeholder: o.placeholder || '' }, value)
      : h('input', { class: 'field' + (o.mono ? ' mono' : ''), type: 'text', value, placeholder: o.placeholder || '' });
    const save = () => { if (input.value !== value) commit(input.value); };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (ev) => {
      const e = /** @type {KeyboardEvent} */ (ev);
      if (e.key === 'Enter' && (!o.long || e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); /** @type {HTMLElement} */ (input).blur(); }
      if (e.key === 'Escape') { input.value = value; /** @type {HTMLElement} */ (input).blur(); }
    });
    if (o.long) {
      const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(240, input.scrollHeight + 2)}px`; };
      input.addEventListener('input', grow); requestAnimationFrame(grow);
    }
    return h('label', { class: 'field-label' }, label, input);
  }

  /** @param {Element} e */
  function propFields(e) {
    const n = ctx.settings.get().notation;
    return Object.entries(ELEMENTS[e.kind].props).map(([key, p]) => {
      const value = e.props[key];
      const set = (/** @type {any} */ v) => ctx.edit(`Change ${p.label.toLowerCase()}`, (tx) => tx.setProps(e.id, { [key]: v }));
      if (p.type === 'text') return textField(p.label, value ?? '', set, { placeholder: p.placeholder, mono: key === 'reqId' || key === 'value' || key === 'unit' || key === 'multiplicity' });
      if (p.type === 'longtext') return textField(p.label, value ?? '', set, { long: true, placeholder: p.placeholder });
      if (p.type === 'bool') {
        const cb = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!value), 'aria-label': p.label, onclick: () => set(!value) });
        return h('div', { class: 'opt' }, h('span', {}, p.label), cb);
      }
      if (p.type === 'enum') {
        const sel = h('select', { class: 'field' }, p.options.map((o) => h('option', { value: o, selected: o === value ? true : undefined }, o)));
        sel.addEventListener('change', () => set(sel.value));
        return h('label', { class: 'field-label' }, p.label, sel);
      }
      // ref: pick an element of an allowed kind
      const options = p.kinds.flatMap((k) => ctx.model.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
      const sel = h('select', { class: 'field' },
        h('option', { value: '' }, options.length ? '— none —' : `— no ${p.kinds.map((k) => kindName(k, n)).join(' / ')} yet —`),
        options.map((o) => h('option', { value: o.id, selected: o.id === value ? true : undefined }, o.name)));
      sel.addEventListener('change', () => set(sel.value || null));
      const target = value ? ctx.model.get(value) : null;
      return h('div', {}, h('label', { class: 'field-label' }, p.label, sel),
        target ? h('button', { class: 'linkish', type: 'button', onclick: () => ctx.select(target.id) }, `Go to ${target.name}`) : null);
    });
  }

  /** @param {Element} e */
  function relationships(e) {
    const m = ctx.model, n = ctx.settings.get().notation;
    const out = m.relsFrom(e.id).map((r) => ({ r, other: /** @type {Element} */ (m.get(/** @type {string} */ (r.target))), verb: RELATIONSHIPS[r.kind].verb[n] }));
    const inc = m.relsTo(e.id).map((r) => ({ r, other: /** @type {Element} */ (m.get(/** @type {string} */ (r.source))), verb: RELATIONSHIPS[r.kind].inverse[n] }));
    const rows = [...out, ...inc].map(({ r, other, verb }) => {
      const l = m.layerOf(other.id);
      return h('div', { class: 'rel' },
        h('span', { class: 'rel-dot', style: { background: l ? LAYER[l].color : 'var(--text-3)' } }),
        h('span', { class: 'rel-verb mono' }, verb),
        h('button', { class: 'rel-name', type: 'button', title: other.name, onclick: () => ctx.select(other.id) }, other.name),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${verb} ${other.name}`, title: 'Remove this relationship', onclick: () => ctx.edit('Remove relationship', (tx) => tx.remove(r.id)) }, icon('x')));
    });

    // add a relationship from this element
    const kinds = Object.keys(RELATIONSHIPS).filter((k) => m.all().some((t) => !isRel(t.kind) && t.id !== e.id && canRelate(k, e.kind, t.kind)));
    let adder = null;
    if (kinds.length) {
      const kindSel = h('select', { class: 'field', 'aria-label': 'Relationship' }, kinds.map((k) => h('option', { value: k }, RELATIONSHIPS[k].verb[n])));
      const targetSel = h('select', { class: 'field', 'aria-label': 'Target element' });
      const fill = () => {
        const cands = m.all().filter((t) => !isRel(t.kind) && m.canLink(kindSel.value, e.id, t.id) && t.owner).sort((a, b) => a.name.localeCompare(b.name));
        targetSel.replaceChildren(h('option', { value: '' }, cands.length ? 'Choose an element…' : 'Nothing to link to'), ...cands.map((t) => h('option', { value: t.id }, `${t.name} · ${kindName(t.kind, n)}`)));
      };
      kindSel.addEventListener('change', fill); fill();
      const add = h('button', { class: 'btn sm', type: 'button', onclick: () => { if (targetSel.value) ctx.edit('Add relationship', (tx) => tx.link(kindSel.value, e.id, targetSel.value)); } }, icon('plus'), 'Add');
      adder = h('div', { class: 'rel-add' }, kindSel, targetSel, add);
    }
    return [
      h('div', { class: 'sec' }, `Relationships · ${rows.length}`),
      rows.length ? h('div', { class: 'rels' }, rows) : h('p', { class: 'muted small' }, 'None yet.'),
      adder,
    ];
  }

  /** @param {Element} e */
  function elementView(e) {
    const m = ctx.model, n = ctx.settings.get().notation;
    const layer = m.layerOf(e.id);
    const kids = m.children(e.id);
    const path = m.path(e.id).filter((p) => p.owner); // skip the project root
    const name = e.layer
      ? h('h2', { class: 'insp-title' }, e.name)
      : textField('Name', e.name, (v) => ctx.edit('Rename', (tx) => tx.rename(e.id, v)));
    return [
      h('div', { class: 'insp-pills' },
        h('span', { class: 'pill', style: layer ? { color: LAYER[layer].color } : {} }, e.layer ? 'RFLP layer' : kindName(e.kind, n)),
        layer ? h('span', { class: 'pill' }, LAYER[layer].name) : null),
      path.length ? h('nav', { class: 'insp-path', 'aria-label': 'Location' }, path.map((p, i) => [i ? h('span', { class: 'sep' }, '›') : null, h('button', { type: 'button', class: 'linkish', onclick: () => ctx.select(p.id) }, p.name)])) : null,
      name,
      e.layer ? h('p', { class: 'muted small' }, `${LAYER[e.layer].note}. Add packages and elements with the + button in the browser.`) : null,
      e.layer ? null : h('p', { class: 'help' }, ELEMENTS[e.kind].help),
      isDiagram(e.kind) ? h('button', { class: 'btn primary sm insp-open', type: 'button', onclick: () => ctx.open(e.id) }, icon('diagram'), 'Open diagram') : null,
      isDiagram(e.kind) ? h('div', { class: 'kv' }, h('span', {}, 'Shows'), h('span', { class: 'mono' }, `${Object.keys(e.layout?.nodes || {}).length} elements`)) : null,
      e.layer ? null : propFields(e),
      kids.length ? [h('div', { class: 'sec' }, `Contains · ${kids.length}`), h('div', { class: 'chips' }, kids.map((k) => h('button', { class: 'chip', type: 'button', title: k.name, onclick: () => ctx.select(k.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[k.kind].abbr), h('span', { class: 'chip-name' }, k.name))))] : null,
      e.layer || isDiagram(e.kind) ? null : relationships(e),
      (() => {
        const ds = m.diagramsShowing(e.id);
        return ds.length ? [h('div', { class: 'sec' }, `On diagrams · ${ds.length}`), h('div', { class: 'chips' }, ds.map((d) => h('button', { class: 'chip', type: 'button', title: `Open ${d.name}`, onclick: () => ctx.open(d.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[d.kind].abbr), h('span', { class: 'chip-name' }, d.name))))] : null;
      })(),
      e.layer ? null : h('div', { class: 'insp-actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('element.rename') }, 'Rename'),
        h('button', { class: 'btn sm danger-outline', type: 'button', onclick: () => ctx.commands.run('element.delete') }, 'Delete')),
      h('div', { class: 'insp-id mono', title: 'Element id' }, e.id),
    ];
  }

  function projectView() {
    const m = ctx.model, st = ctx.settings.get();
    const meta = ctx.meta();
    /** @param {import('../settings.js').Settings['notation']} v @param {string} label */
    const notBtn = (v, label) => h('button', { type: 'button', 'aria-pressed': String(st.notation === v), onclick: () => ctx.commands.run(`notation.${v}`) }, label);
    const notes = { sysml: 'SysML v1 vocabulary (Block, Part property…)', v2: 'SysML v2 keywords (part def, part…)', guided: 'Plain words, for newcomers' };
    return [
      h('div', { class: 'insp-title' }, 'Nothing selected'),
      h('div', { class: 'insp-sub' }, 'Select an element in the browser to see and edit it here.'),
      h('div', { class: 'sec' }, 'Project'),
      textField('Name', m.root().name, (v) => ctx.edit('Rename project', (tx) => tx.rename(m.root().id, v))),
      h('div', { class: 'kv' }, h('span', {}, 'Elements'), h('span', { class: 'mono' }, String(m.elementCount() - 5))),
      h('div', { class: 'kv' }, h('span', {}, 'Relationships'), h('span', { class: 'mono' }, String(m.count() - m.elementCount()))),
      h('div', { class: 'kv' }, h('span', {}, 'Created'), h('span', {}, new Date(meta.created).toLocaleDateString())),
      h('div', { class: 'sec' }, 'Display'),
      h('div', { class: 'field-label' }, 'Notation',
        h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Notation' }, notBtn('sysml', 'SysML'), notBtn('v2', 'SysML v2'), notBtn('guided', 'Guided')),
        h('small', {}, notes[st.notation])),
      h('div', { class: 'sec' }, 'Integrations'),
      h('div', { class: 'opt' },
        h('span', {}, 'Pteronautics Works', h('small', {}, st.integrations.works ? 'On · values and analyses from Works' : 'Off · Loom runs on its own')),
        h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.integrations.works), 'aria-label': 'Link Pteronautics Works', onclick: () => ctx.commands.run('integrations.works') })),
    ];
  }

  function render() {
    const id = ctx.selected();
    const e = id ? ctx.model.get(id) : undefined;
    const scroll = el.scrollTop;
    const active = document.activeElement;
    const keep = active && el.contains(active) && active instanceof HTMLElement ? active.closest('label')?.textContent : null;
    el.replaceChildren(...[e ? elementView(e) : projectView()].flat(3).filter((x) => x));
    el.scrollTop = scroll;
    if (keep) [...el.querySelectorAll('label')].find((l) => l.textContent === keep)?.querySelector('input,textarea,select')?.focus?.();
  }

  render();
  return { el, render };
}
