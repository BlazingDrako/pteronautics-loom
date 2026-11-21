// View presets: a diagram's view options (which compartments, labels and lines it shows),
// saved under a name and reused on other diagrams of the same kind. Loom comes with a few;
// your own are kept in your settings, so they are there in every project. One preset per kind
// can be the default that new diagrams start with.
import { ELEMENTS, kindName } from '../model/metamodel.js';

/** @typedef {import('../settings.js').Preset} Preset */

/** The view options of a kind of diagram: its on/off properties (not snapping, which is how you edit). @param {string} kind */
export function viewFlags(kind) {
  const props = ELEMENTS[kind]?.props || {};
  return Object.entries(props).filter(([k, p]) => p.type === 'bool' && !p.hidden && k !== 'snap' && k !== 'hideEmpty').map(([k, p]) => /** @type {[string, string]} */ ([k, p.label]));
}

/** Every option on, or every option off. @param {string} kind @param {boolean} on */
const all = (kind, on) => Object.fromEntries(viewFlags(kind).map(([k]) => [k, on]));

/** Presets Loom comes with, per kind. @type {Record<string, { id: string, name: string, props: Record<string, boolean> }[]>} */
const BUILT_IN = {
  bdd: [
    { id: 'bdd-names', name: 'Names only', props: { ...all('bdd', false), showRoles: true } },
    { id: 'bdd-structure', name: 'Parts and ports', props: { showParts: true, showValues: false, showPorts: true, showTags: false, showRoles: true } },
    { id: 'bdd-values', name: 'Values for analysis', props: { showParts: false, showValues: true, showPorts: false, showTags: true, showRoles: false } },
  ],
  req: [
    { id: 'req-ids', name: 'IDs and names', props: { showId: true, showText: false, showTags: false, showRoles: true } },
    { id: 'req-review', name: 'Review (full text)', props: { showId: true, showText: true, showTags: true, showRoles: true } },
  ],
  ibd: [
    { id: 'ibd-plain', name: 'Parts and lines only', props: { showTypes: false, showPortNames: false, showFlows: false } },
    { id: 'ibd-flows', name: 'Item flows', props: { showTypes: false, showPortNames: true, showFlows: true } },
  ],
  act: [{ id: 'act-plain', name: 'Plain flow (no lanes)', props: { showLanes: false, showGuards: true } }],
  stm: [{ id: 'stm-names', name: 'State names only', props: { showActions: false, showLabels: true } }],
  par: [{ id: 'par-eq', name: 'Equations only', props: { showExpr: true, showValues: false, showRoles: true } }],
};

/**
 * Presets for a kind of diagram: "Everything", Loom's own, then yours.
 * @param {string} kind @param {Preset[]} mine
 * @returns {(Preset & { builtIn: boolean })[]}
 */
export function presetsFor(kind, mine) {
  if (!viewFlags(kind).length) return [];
  return [
    { id: `${kind}-all`, name: 'Everything', kind, props: all(kind, true), builtIn: true },
    ...(BUILT_IN[kind] || []).map((p) => ({ ...p, kind, builtIn: true })),
    ...mine.filter((p) => p.kind === kind).map((p) => ({ ...p, builtIn: false })),
  ];
}

/** A preset by id. @param {string} kind @param {Preset[]} mine @param {string} id */
export const presetById = (kind, mine, id) => presetsFor(kind, mine).find((p) => p.id === id);

/** The view options a diagram has now, as preset props. @param {import('../model/model.js').Element} d */
export function currentOptions(d) {
  return Object.fromEntries(viewFlags(d.kind).map(([k]) => [k, d.props[k] !== false]));
}

/** Does a diagram show exactly what a preset says? @param {import('../model/model.js').Element} d @param {Preset} p */
export const matches = (d, p) => viewFlags(d.kind).every(([k]) => (d.props[k] !== false) === (p.props[k] !== false));

/** The props to set to apply a preset (only the options the kind has). @param {string} kind @param {Preset} p */
export function presetProps(kind, p) {
  return Object.fromEntries(viewFlags(kind).map(([k]) => [k, p.props[k] !== false]));
}

/** A new preset id. */
export const newPresetId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Kinds that have view options, for the preferences dialog. */
export const PRESET_KINDS = Object.keys(ELEMENTS).filter((k) => ELEMENTS[k].diagram && viewFlags(k).length);

/** @param {string} kind */
export const kindLabel = (kind) => kindName(kind, 'sysml');
