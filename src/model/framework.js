// How a project's top level is organized: its framework (RFLP by default, or Arcadia,
// MagicGrid, OOSEM, the SysML pillars) and the sets at the top of the model.
//
// The four core sets always exist (the layer packages, roles r, f, l, p): the trace, the
// Systems V, coverage and where new elements go work from their roles, whatever they are
// called. A framework names them and may add sets of its own; you can rename any set and add
// your own beside them (any package at the top of the model).
import { FRAMEWORKS, frameworkById, LAYERS } from './metamodel.js';

/** @typedef {import('./model.js').Model} Model */

/** The colors a set of your own can have (the same as boxes on diagrams). */
export const SET_HUE = /** @type {Record<string, string>} */ ({ blue: '#2f7fd0', teal: '#12a594', green: '#2f9e44', amber: '#d98a00', coral: '#e0583f', pink: '#d6336c', violet: '#7c5cf0', slate: '#64748b' });
/** A set's color: a core set's role color, or the color you gave your own. @param {Element} e */
export const setColor = (e) => (e.layer ? `var(--layer-${e.layer})` : SET_HUE[String(e.props.color)] || SET_HUE.slate);
/** @typedef {import('./model.js').Element} Element */

/** The project's framework. @param {Model} m */
export const frameworkOf = (m) => frameworkById(String(m.root()?.props.framework || 'rflp'));

/** What a core set is for, in its framework's words (or the RFLP note). @param {Model} m @param {string} role */
export function roleNote(m, role) {
  const f = frameworkOf(m);
  return f.sets[/** @type {'r' | 'f' | 'l' | 'p'} */ (role)]?.note || LAYERS.find((l) => l.id === role)?.note || '';
}

/** A core set's name in this project (it can be renamed), by role. @param {Model} m @param {string} role */
export function roleName(m, role) {
  return m.layers().find((l) => l.layer === role)?.name || LAYERS.find((l) => l.id === role)?.name || role;
}

/** Is this element a set at the top of the model (a core set or one of your own)? @param {Model} m @param {Element | undefined} e */
export const isSet = (m, e) => !!e && e.kind === 'package' && e.owner === m.root()?.id;

/**
 * Change the project's framework, as one undoable edit: the core sets take its names, its own
 * sets are added, and the previous framework's own sets go if they are still empty.
 * @param {Model} m @param {string} id
 */
export function applyFramework(m, id) {
  const next = frameworkById(id), prev = frameworkOf(m);
  m.transact(`Use the ${next.name} framework`, (tx) => {
    for (const l of m.layers()) {
      const want = next.sets[/** @type {'r' | 'f' | 'l' | 'p'} */ (l.layer)]?.name;
      if (want && l.name !== want) tx.rename(l.id, want);
    }
    const root = m.root();
    for (const x of prev.extra || []) {
      const e = m.sets().find((s) => !s.layer && s.name === x.name);
      if (e && !m.children(e.id).length && !(next.extra || []).some((y) => y.name === x.name)) tx.remove(e.id);
    }
    for (const x of next.extra || []) {
      if (!m.sets().some((s) => s.name === x.name)) tx.create('package', { owner: root.id, name: x.name, props: { color: x.color, doc: x.note } });
    }
    tx.setProps(root.id, { framework: next.id === 'rflp' ? '' : next.id });
  });
}

/** Add a set of your own at the top of the model. @param {Model} m @param {any} tx @param {string} [name] @param {string} [color] */
export function addSet(m, tx, name = 'New set', color = 'slate') {
  const taken = new Set(m.sets().map((s) => s.name));
  let n = name, i = 2;
  while (taken.has(n)) n = `${name} ${i++}`;
  return tx.create('package', { owner: m.root().id, name: n, props: { color } });
}

export { FRAMEWORKS };
