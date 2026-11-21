// Block definition diagrams: which elements they show, what a block's box contains, how big
// it must be, and which lines join the boxes. Pure functions of the model, so they can be
// tested without a screen.
import { ELEMENTS, kindName, LAYERS } from '../model/metamodel.js';
import { FONTS, textWidth, wrapLines } from './measure.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/**
 * @typedef {{
 *   title: string, rows: string[],
 *   wrap?: boolean,    // rows wrap onto several lines (requirement text) instead of being cut
 *   joined?: boolean,  // no separator line above (continues the compartment before it)
 * }} Compartment
 */
/**
 * @typedef {{
 *   stereo: string, name: string, compartments: Compartment[], layerColor: string | null,
 *   shape?: string,                  // box (default), round, folder, ellipse, actor, circle, bullseye, circlex, history, diamond, bar, lane, boundary, region
 *   fixed?: { w: number, h: number }, // small shapes keep this size
 *   under?: boolean, depth?: number,  // a container drawn behind lines and boxes
 *   label?: string, glyph?: string, linkable?: boolean,
 *   tone?: string,                    // a color role for the stylesheet (action, state, initial, decision…)
 *   tint?: string,                    // a CSS color the box is tinted with (a lane's or package's layer)
 * }} NodeContent
 */
/**
 * @typedef {{
 *   id: string,                       // stable key: the part id or the relationship id
 *   kind: 'composition' | 'generalization' | 'containment' | 'dependency' | 'flow' | 'assoc',
 *   dashed?: boolean,                 // a dashed line (include, extend, import)
 *   cls?: string,                     // extra classes for the stylesheet (object flows, bindings…)
 *   from: string, to: string,         // composition: whole → part type; generalization: specific → general;
 *                                     // containment: container → contained; dependency: client → supplier
 *   label?: string,                   // role name and multiplicity at the part end; «stereotype» on dependencies
 *   element: string,                  // the model element the line stands for
 * }} Edge
 */

/** Element kinds a bdd can show. */
export const BDD_KINDS = ['partDef', 'interfaceDef'];

/** Sizes (px). */
export const BOX = { header: 48, titleH: 20, rowH: 17, compPad: 8, padX: 12, minW: 140, minH: 48, wrapW: 240, wrapLines: 6 };

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

/** Height of a compartment's title band (none when it has no title). @param {Compartment} comp */
export const titleH = (comp) => (comp.title ? BOX.titleH : (comp.joined ? 0 : 6));

/** The lines a compartment's rows take at an inner width. @param {Compartment} comp @param {number} inner @returns {string[]} */
export function compartmentLines(comp, inner) {
  if (!comp.wrap) return comp.rows;
  return comp.rows.flatMap((r) => wrapLines(r, inner, FONTS.row, BOX.wrapLines));
}

/** Height of the content when the box is `w` wide. @param {NodeContent} c @param {number} w */
export function heightAt(c, w) {
  if (c.fixed) return c.fixed.h;
  if (c.shape === 'ellipse' || c.shape === 'actor' || c.shape === 'lane' || c.shape === 'boundary' || c.shape === 'region') return BOX.minH;
  let h = BOX.header + (c.shape === 'folder' ? 14 : 0);
  for (const comp of c.compartments) h += titleH(comp) + compartmentLines(comp, w - BOX.padX * 2).length * BOX.rowH + BOX.compPad;
  return Math.ceil(Math.max(BOX.minH, h));
}

/** The smallest box that shows everything without cutting text. Wrapped text is wrapped at a comfortable width. @param {NodeContent} c */
export function naturalSize(c) {
  if (c.fixed) return { ...c.fixed };
  if (c.shape === 'ellipse') return { w: Math.ceil(Math.min(260, Math.max(150, textWidth(c.name, FONTS.name) / 0.78 + 30))), h: 70 };
  if (c.shape === 'actor') return { w: Math.ceil(Math.max(90, Math.min(180, textWidth(c.name, FONTS.name) + 12))), h: 100 };
  if (c.shape === 'lane' || c.shape === 'boundary' || c.shape === 'region') return { w: Math.ceil(Math.max(200, textWidth(c.name, FONTS.name) + 40)), h: 200 };
  let w = Math.max(textWidth(c.name, FONTS.name), textWidth(c.stereo, FONTS.stereo));
  for (const comp of c.compartments) {
    w = Math.max(w, textWidth(comp.title.toUpperCase(), FONTS.title), ...comp.rows.map((r) => comp.wrap ? Math.min(BOX.wrapW, textWidth(r, FONTS.row)) : textWidth(r, FONTS.row)));
  }
  const width = Math.ceil(Math.max(BOX.minW, w + BOX.padX * 2));
  return { w: width, h: heightAt(c, width) };
}

/** Whether a box's height depends on its width. @param {NodeContent} c */
export const wraps = (c) => c.compartments.some((x) => x.wrap);

/** Height needed for the content at its natural width. @param {NodeContent} c */
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

/** Types of parts below, generalizations either way. @param {Model} m @param {string} id */
export function relatedOf(m, id) {
  /** @type {string[]} */
  const below = [], above = [];
  for (const k of m.children(id)) if (k.kind === 'part' && k.props.type && canShow(m.get(k.props.type))) below.push(k.props.type);
  for (const rel of m.relsFrom(id)) if (rel.kind === 'generalize' && rel.target) above.push(rel.target);
  for (const rel of m.relsTo(id)) if (rel.kind === 'generalize' && rel.source) below.push(rel.source);
  return { above, below };
}

/** The bdd as a diagram kind for the canvas. */
export const bddKind = {
  kind: 'bdd',
  canShow,
  nodeContent,
  edgesFor,
  related: relatedOf,
  /** Relationships a drag from one box to another can make. @param {Model} m @param {string} a @param {string} b */
  linkKinds: (m, a, b) => ['generalize'].filter((k) => m.canLink(k, a, b)),
  add: /** @type {{ kind: string, label: string, title: string }[]} */ ([
    { kind: 'partDef', label: 'Block', title: 'Add a new block to the model and this diagram' },
    { kind: 'interfaceDef', label: 'Interface', title: 'Add a new interface block' },
  ]),
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('l'),
  flags: /** @type {[string, string][]} */ ([['showParts', 'Parts compartment'], ['showValues', 'Values compartment'], ['showPorts', 'Ports compartment'], ['showRoles', 'Role names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Drag blocks here from the model browser, or add one with the Block button.',
  noun: 'blocks',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A block definition diagram shows blocks and interface blocks. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};

/** @typedef {typeof bddKind} DiagramKind */

export { ELEMENTS };
