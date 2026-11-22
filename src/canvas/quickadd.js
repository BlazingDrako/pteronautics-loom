// Quick-add: type what to add, right on the diagram. Start typing on a diagram (or double-click
// empty space) and a small field opens where you are:
//
//   Battery Pack                    a new element of the diagram's main kind (a block, a step…)
//   interface DC Power              the kind first, by its name: interface, test, actor, state…
//   fork                            a variant by its name alone (fork, decision, initial, final…)
//   battery : Battery Pack [2]      block diagrams: a part of the selected block, typed (the
//                                   type is found by name, or made), with a multiplicity
//   Li-ion Pack :> Battery Pack     block diagrams: a block that specializes another
//   Endurance: The UAS shall…       requirement diagrams: a name, then the requirement's text
//   A; B; C                         several at once, separated by ; or new lines
//
// This module only reads the text; the canvas does the adding.
import { ELEMENTS, kindName } from '../model/metamodel.js';

/**
 * What can be added: the diagram's own tools (kind and fixed props, with their labels).
 * @typedef {{ kind: string, label: string, props?: Record<string, any> }} Choice
 * @typedef {{ kind: string, name: string, props?: Record<string, any>, part?: { type: string, multiplicity: string }, parent?: string }} QuickItem
 */

const norm = (/** @type {string} */ s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Words that name a choice: its label, its kind's names in every notation, and its abbreviation. @param {Choice} c */
function wordsFor(c) {
  const e = ELEMENTS[c.kind];
  const w = new Set([norm(c.label)]);
  if (!c.props && e) { for (const n of /** @type {const} */ (['sysml', 'v2', 'guided'])) w.add(norm(kindName(c.kind, n))); if (e.abbr) w.add(e.abbr); }
  // short forms people type
  if (c.kind === 'interfaceDef' && !c.props) { w.add('interface'); w.add('if'); }
  if (c.kind === 'testCase') { w.add('test'); }
  if (c.kind === 'useCase') { w.add('uc'); }
  if (c.kind === 'action' && !c.props) { w.add('step'); w.add('action'); }
  return w;
}

/**
 * Read quick-add text.
 * @param {string} text @param {{ diagram: string, choices: Choice[] }} o
 * @returns {{ items: QuickItem[], error?: string }}
 */
export function parseQuick(text, o) {
  const lines = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { items: [], error: 'Type a name' };
  const plain = o.choices.filter((c) => !c.props);
  const main = plain[0] || o.choices[0];
  if (!main) return { items: [], error: 'Nothing can be added to this diagram by typing' };
  /** @type {QuickItem[]} */
  const items = [];
  for (const line of lines) {
    // a variant by its name alone: "fork", "initial", "decision"
    const variant = o.choices.find((c) => c.props && norm(c.label) === norm(line));
    if (variant) { items.push({ kind: variant.kind, name: variant.label, props: variant.props }); continue; }
    // a kind first: "interface DC Power", "test Endurance flight", "actor Pilot"
    let kind = main.kind, props = /** @type {Record<string, any> | undefined} */ (main.props), rest = line;
    let named = false;
    // (the main kind needs no word, so a name that starts with one, like "Step counter", stays whole)
    for (const c of o.choices) {
      if (c === main || c.props) continue;
      for (const w of wordsFor(c)) {
        if (norm(line).startsWith(w + ' ') && line.length > w.length + 1) {
          kind = c.kind; props = c.props; rest = line.slice(w.length).trim(); named = true; break;
        }
      }
      if (named) break;
    }
    if (o.diagram === 'bdd' && !named) {
      // a part: "battery : Battery Pack [2]" (the multiplicity is optional)
      const part = rest.match(/^([^:]+?)\s*:(?!>)\s*([^[\]]+?)\s*(?:\[\s*([^\]]+?)\s*\])?$/);
      if (part) { items.push({ kind: 'part', name: part[1].trim(), part: { type: part[2].trim(), multiplicity: part[3] || '1' } }); continue; }
      // a block that specializes another: "Li-ion Pack :> Battery Pack"
      const gen = rest.match(/^(.+?)\s*:>\s*(.+)$/);
      if (gen) { items.push({ kind, name: gen[1].trim(), props, parent: gen[2].trim() }); continue; }
    }
    if (o.diagram === 'req' && kind === 'requirement') {
      // "Endurance: The UAS shall fly for 3 h"
      const m = rest.match(/^([^:]{1,80}):\s*(.+)$/);
      if (m) { items.push({ kind, name: m[1].trim(), props: { ...props, text: m[2].trim() } }); continue; }
    }
    if (!rest) return { items: [], error: `Give the new ${kindName(kind, 'sysml').toLowerCase()} a name` };
    items.push({ kind, name: rest, props });
  }
  return { items };
}

/** The syntax to show under the field, for a kind of diagram. @param {string} diagram @param {Choice[]} choices */
export function quickHelp(diagram, choices) {
  const kinds = choices.filter((c) => !c.props).slice(1).map((c) => norm(c.label));
  const variants = choices.filter((c) => c.props).slice(0, 4).map((c) => norm(c.label));
  const tips = [];
  if (diagram === 'bdd') tips.push('battery : Battery Pack [2] adds a part to the selected block', 'Li-ion :> Battery specializes');
  if (diagram === 'req') tips.push('Name: text sets the requirement\'s text');
  if (kinds.length) tips.push(`start with ${kinds.join(', ')} for that kind`);
  if (variants.length) tips.push(`or type ${variants.join(', ')}…`);
  tips.push('; adds several');
  return tips.join(' · ');
}

/**
 * @typedef {{ part?: { name: string | null, type: string, multiplicity: string }, port?: { name: string, type: string | null, direction: 'in' | 'out' | 'inout' } }} IbdQuickItem
 * part.name null: named after its type (battery for Battery Pack)
 */

/**
 * Read quick-add text on an internal block diagram:
 *
 *   Battery Pack                  a part typed by that block (found by name, or made)
 *   battery : Battery Pack [2]    a part with its name, type and multiplicity
 *   out pwrOut : DC Power         a port (in, out or inout first; the interface is found or made)
 *   port cmd                      a port, both ways, with no interface yet
 *   A; B                          several at once
 *
 * @param {string} text @returns {{ items: IbdQuickItem[], error?: string }}
 */
export function parseIbdQuick(text) {
  const lines = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { items: [], error: 'Type a block\'s name, or name : Block' };
  /** @type {IbdQuickItem[]} */
  const items = [];
  for (const line of lines) {
    const pm = line.match(/^(?:port\s+)?(in|out|inout)\s+(.+)$/i) || line.match(/^port\s+()(.+)$/i);
    if (pm) {
      const dir = /** @type {'in' | 'out' | 'inout'} */ ((pm[1] || 'inout').toLowerCase());
      const m = pm[2].match(/^([^:]+?)\s*(?::\s*(.+))?$/);
      const name = m?.[1].trim() || '';
      if (!name) return { items: [], error: 'Give the port a name' };
      items.push({ port: { name, type: m?.[2]?.trim() || null, direction: dir } });
      continue;
    }
    const part = line.match(/^([^:]+?)\s*:\s*([^[\]]+?)\s*(?:\[\s*([^\]]+?)\s*\])?$/);
    if (part) { items.push({ part: { name: part[1].trim(), type: part[2].trim(), multiplicity: part[3] || '1' } }); continue; }
    const typed = line.match(/^([^[\]]+?)\s*(?:\[\s*([^\]]+?)\s*\])?$/);
    if (!typed) return { items: [], error: `Not sure what “${line}” is: try name : Block, or out name : Interface` };
    items.push({ part: { name: null, type: typed[1].trim(), multiplicity: typed[2] || '1' } });
  }
  return { items };
}

/** The syntax hint for internal block diagrams. */
export const IBD_HELP = 'Battery Pack adds a part typed by it · battery : Battery Pack [2] names it · out pwrOut : DC Power adds a port (in, out, inout) · ; adds several';
