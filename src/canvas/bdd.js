// Block definition diagrams: which elements they show, what a block's box contains, how big
// it must be, and which lines join the boxes. Pure functions of the model, so they can be
// tested without a screen.
import { ELEMENTS, kindName, LAYERS } from '../model/metamodel.js';
import { FONTS, textWidth } from './measure.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {{ title: string, rows: string[] }} Compartment */
/** @typedef {{ stereo: string, name: string, compartments: Compartment[], layerColor: string | null }} NodeContent */
/**
 * @typedef {{
 *   id: string,                       // stable key: the part id or the relationship id
 *   kind: 'composition' | 'generalization',
 *   from: string, to: string,         // composition: whole → part type; generalization: specific → general
 *   label?: string,                   // role name and multiplicity at the part end
 *   element: string,                  // the model element the line stands for
 * }} Edge
 */

/** Element kinds a bdd can show. */
export const BDD_KINDS = ['partDef', 'interfaceDef'];

/** Sizes (px). */
export const BOX = { header: 48, titleH: 20, rowH: 17, compPad: 8, padX: 12, minW: 140, minH: 48 };

/** @param {Element} d the diagram @param {string} key */
const flag = (d, key) => d.props[key] !== false;

/**
 * What a block's box shows.
 * @param {Model} m @param {Element} el @param {Element} diagram @param {Notation} n
 * @returns {NodeContent}
 */
export function nodeContent(m, el, diagram, n) {
  const guided = n === 'guided';
  const stereo = guided ? kindName(el.kind, 'guided') : n === 'v2' ? `«${kindName(el.kind, 'v2')}»` : `«${el.kind === 'interfaceDef' ? 'interfaceBlock' : 'block'}»`;
  const kids = m.children(el.id);
  /** @param {Element} k */
  const typeName = (k) => { const t = k.props.type ? m.get(k.props.type) : null; return t ? t.name : ''; };
  /** @type {Compartment[]} */
  const compartments = [];
  if (flag(diagram, 'showParts')) {
    const rows = kids.filter((k) => k.kind === 'part').map((k) => {
      const t = typeName(k), mult = k.props.multiplicity && k.props.multiplicity !== '1' ? ` [${k.props.multiplicity}]` : '';
      return guided ? `${k.name}${t ? ` is a ${t}` : ''}${mult}` : `${k.name}${t ? ` : ${t}` : ''}${mult}`;
    });
    if (rows.length) compartments.push({ title: guided ? 'Parts' : 'parts', rows });
  }
  if (flag(diagram, 'showValues')) {
    const rows = kids.filter((k) => k.kind === 'attribute').map((k) => {
      const v = k.props.value ? ` = ${k.props.value}${k.props.unit ? ` ${k.props.unit}` : ''}` : (k.props.unit ? ` [${k.props.unit}]` : '');
      return `${k.name}${v}`;
    });
    if (rows.length) compartments.push({ title: guided ? 'Properties' : n === 'v2' ? 'attributes' : 'values', rows });
  }
  if (flag(diagram, 'showPorts')) {
    const rows = kids.filter((k) => k.kind === 'port').map((k) => {
      const t = typeName(k), dir = k.props.direction && k.props.direction !== 'inout' ? `${k.props.direction} ` : '';
      const full = k.props.portKind === 'full' ? '«full» ' : '';
      return guided ? `${k.name}${t ? ` (${t})` : ''}` : `${full}${dir}${k.name}${t ? ` : ${k.props.conjugated ? '~' : ''}${t}` : ''}`;
    });
    if (rows.length) compartments.push({ title: guided ? 'Connection points' : 'ports', rows });
  }
  const layer = m.layerOf(el.id);
  return { stereo, name: el.name, compartments, layerColor: layer ? (LAYERS.find((l) => l.id === layer)?.color || null) : null };
}

/** The smallest box that shows everything without cutting text. @param {NodeContent} c */
export function naturalSize(c) {
  let w = Math.max(textWidth(c.name, FONTS.name), textWidth(c.stereo, FONTS.stereo));
  let h = BOX.header;
  for (const comp of c.compartments) {
    w = Math.max(w, textWidth(comp.title.toUpperCase(), FONTS.title), ...comp.rows.map((r) => textWidth(r, FONTS.row)));
    h += BOX.titleH + comp.rows.length * BOX.rowH + BOX.compPad;
  }
  return { w: Math.ceil(Math.max(BOX.minW, w + BOX.padX * 2)), h: Math.ceil(Math.max(BOX.minH, h)) };
}

/** Height needed for the content at any width (text is cut, never wrapped, on diagrams). @param {NodeContent} c */
export const minHeight = (c) => naturalSize(c).h;

/**
 * The lines between shown blocks.
 * @param {Model} m @param {Set<string>} shown
 * @returns {Edge[]}
 */
export function edgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const id of shown) {
    const el = m.get(id);
    if (!el) continue;
    for (const k of m.children(id)) {
      if (k.kind !== 'part' || !k.props.type || !shown.has(k.props.type)) continue;
      const mult = k.props.multiplicity && k.props.multiplicity !== '1' ? ` [${k.props.multiplicity}]` : '';
      out.push({ id: k.id, kind: 'composition', from: id, to: k.props.type, label: `${k.name}${mult}`, element: k.id });
    }
    for (const r of m.relsFrom(id)) {
      if (r.kind === 'generalize' && r.target && shown.has(r.target)) out.push({ id: r.id, kind: 'generalization', from: id, to: r.target, element: r.id });
    }
  }
  return out;
}

/** Can `el` be shown on a bdd? @param {Element | undefined} el */
export const canShow = (el) => !!el && BDD_KINDS.includes(el.kind);

export { ELEMENTS };
