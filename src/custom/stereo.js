// Profiles and stereotypes: your own kinds of element. A stereotype lives in a profile, says
// which kinds of element it applies to, and can give them a color, an icon and tags (its value
// properties, whose values are the defaults). Applying one to an element is a property of that
// element (props.applied), so it is undoable, saved, and written in the SysML v2 text as a
// metadata usage (@Critical { dal = "B"; }).
import { ELEMENTS, kindName, canHaveStereo, NO_STEREO } from '../model/metamodel.js';
import { stereoApplies, stereoKinds, appliesText, FILLS } from '../model/model.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/metamodel.js').Applied} Applied */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {{ tag: Element, value: string, given: boolean }} TagValue  given: set on the element (else the default) */
/** @typedef {{ st: Element, tags: TagValue[] }} AppliedInfo */

export { stereoApplies, stereoKinds, appliesText };

/** The applied list of an element (never null). @param {Element | undefined} e @returns {Applied[]} */
export const appliedList = (e) => (e && Array.isArray(e.props.applied) ? e.props.applied : []);

/** What is applied to an element, with every tag's value. @param {Model} m @param {string} id @returns {AppliedInfo[]} */
export function appliedOf(m, id) {
  const out = [];
  for (const a of appliedList(m.get(id))) {
    const st = m.get(a.s);
    if (!st) continue;
    const tags = m.children(st.id).filter((c) => c.kind === 'attribute').map((tag) => {
      const own = a.tags?.[tag.id];
      return { tag, value: own !== undefined ? own : String(tag.props.value || ''), given: own !== undefined };
    });
    out.push({ st, tags });
  }
  return out;
}

/** Stereotype names on an element, in order. @param {Model} m @param {string} id */
export const stereoNames = (m, id) => appliedOf(m, id).map((x) => x.st.name);

/** The first color a stereotype gives an element, if any. @param {Model} m @param {string} id @returns {string | undefined} */
export function stereoFill(m, id) {
  for (const { st } of appliedOf(m, id)) if (FILLS.includes(st.props.color)) return st.props.color;
  return undefined;
}

/** The icon the first stereotype with one gives an element. @param {Model} m @param {string} id */
export function stereoIcon(m, id) {
  for (const { st } of appliedOf(m, id)) if (st.props.icon) return String(st.props.icon);
  return '';
}

/** Every stereotype that may be applied to an element of `kind`, by name. @param {Model} m @param {string} kind */
export function applicableStereotypes(m, kind) {
  if (!canHaveStereo(kind)) return [];
  return m.byKind('stereotype').filter((st) => stereoApplies(st, kind)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Kinds a stereotype can be set to apply to, in menu order. */
export const STEREO_TARGETS = Object.keys(ELEMENTS).filter((k) => canHaveStereo(k) && !NO_STEREO.includes(k));

/** Apply a stereotype (inside a transaction). @param {Model} m @param {any} tx @param {string} id @param {string} stId */
export function applyStereo(m, tx, id, stId) {
  const list = appliedList(m.get(id));
  if (list.some((a) => a.s === stId)) return;
  tx.setProps(id, { applied: [...list, { s: stId }] });
}

/** Take a stereotype off (inside a transaction). @param {Model} m @param {any} tx @param {string} id @param {string} stId */
export function unapplyStereo(m, tx, id, stId) {
  const list = appliedList(m.get(id)).filter((a) => a.s !== stId);
  tx.setProps(id, { applied: list.length ? list : null });
}

/**
 * Set a tagged value (inside a transaction). An empty value, or the default, clears it.
 * @param {Model} m @param {any} tx @param {string} id @param {string} stId @param {string} tagId @param {string} value
 */
export function setTag(m, tx, id, stId, tagId, value) {
  const tag = m.get(tagId);
  const list = appliedList(m.get(id)).map((a) => {
    if (a.s !== stId) return a;
    const tags = { ...(a.tags || {}) };
    if (value === '' || value === String(tag?.props.value || '')) delete tags[tagId]; else tags[tagId] = value;
    return Object.keys(tags).length ? { s: a.s, tags } : { s: a.s };
  });
  tx.setProps(id, { applied: list });
}

/**
 * The stereotype line of a box with stereotypes applied: «block, Flight critical» in SysML,
 * the kind then the names in Guided.
 * @param {string} base what the box already shows («block», «requirement», Part type, or '')
 * @param {string[]} names @param {Notation} n
 */
export function stereoLine(base, names, n) {
  if (!names.length) return base;
  if (n === 'guided') return base ? `${base} · ${names.join(', ')}` : names.join(', ');
  if (base.startsWith('«') && base.endsWith('»')) return `${base.slice(0, -1)}, ${names.join(', ')}»`;
  return base ? `${base} «${names.join(', ')}»` : `«${names.join(', ')}»`;
}

/**
 * Add what stereotypes show to a box's content: the names on the stereotype line, the icon
 * before the name, the color, and (when the diagram shows them) a compartment of tagged values.
 * @param {Model} m @param {Element} el @param {Element | undefined} diagram @param {Notation} n
 * @param {import('../canvas/bdd.js').NodeContent} c
 * @returns {import('../canvas/bdd.js').NodeContent}
 */
export function decorate(m, el, diagram, n, c) {
  const info = appliedOf(m, el.id);
  if (!info.length) return c;
  const out = { ...c };
  const show = !diagram || diagram.props.showTags !== false;
  // small shapes (control nodes, pseudo-states) keep their drawing; their label carries the names
  if (c.fixed) return out;
  out.stereo = stereoLine(c.stereo, info.map((x) => x.st.name), n);
  const ic = info.find((x) => x.st.props.icon)?.st.props.icon;
  if (ic) out.name = `${ic} ${c.name}`;
  const fill = info.map((x) => x.st.props.color).find((f) => FILLS.includes(f));
  if (fill) out.stereoFill = fill;
  const boxy = !c.shape || c.shape === 'box' || c.shape === 'round';
  if (show && boxy) {
    const rows = info.flatMap((x) => x.tags.filter((t) => t.value !== '').map((t) => `${t.tag.name} = ${t.value}${t.tag.props.unit ? ` ${t.tag.props.unit}` : ''}`));
    if (rows.length) out.compartments = [...c.compartments, { title: n === 'guided' ? 'Details' : 'tags', rows }];
  }
  return out;
}

/** A readable list of kinds: "blocks and parts". @param {string[]} kinds @param {Notation} n */
export function kindsText(kinds, n) {
  if (!kinds.length) return n === 'guided' ? 'anything' : 'any element';
  const names = kinds.map((k) => kindName(k, n));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}
