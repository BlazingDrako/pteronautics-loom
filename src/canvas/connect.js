// Connection rules for internal block diagrams: which ports may be linked, and why not.
//
// Direction is read from the point of view of the connector. A port on a part keeps its
// direction (out sends, in receives). A port on the diagram frame is the block's own boundary
// seen from inside, so it is flipped: the block's "in" port *sends* into the block's parts
// (that is a delegation). A conjugated port (~) is flipped too.

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/**
 * @typedef {{
 *   key: string,              // layout key of the port ("p1/p2#port", "#port")
 *   port: Element,
 *   onFrame: boolean,         // a port of the diagram's own block
 * }} PortEnd
 * @typedef {{ ok: boolean, reason: string, warn?: string }} Verdict
 */

/** @param {string} d */
const flip = (d) => (d === 'in' ? 'out' : d === 'out' ? 'in' : d);

/** The direction a port acts in, from the connector's point of view. @param {PortEnd} e */
export function effectiveDirection(e) {
  let d = e.port.props.direction || 'inout';
  if (e.port.props.conjugated) d = flip(d);
  if (e.onFrame) d = flip(d);
  return d;
}

/**
 * May these two ports be connected?
 * @param {Model} m @param {PortEnd} a @param {PortEnd} b
 * @param {{ connected?: (a: string, b: string) => boolean }} [o]
 * @returns {Verdict}
 */
export function canConnect(m, a, b, o = {}) {
  if (a.key === b.key) return { ok: false, reason: 'A port cannot connect to itself' };
  if (o.connected?.(a.key, b.key)) return { ok: false, reason: 'These ports are already connected' };
  if (a.onFrame && b.onFrame) return { ok: false, reason: 'Both ports are on the diagram\'s own block' };
  const ta = a.port.props.type ? m.get(a.port.props.type) : null, tb = b.port.props.type ? m.get(b.port.props.type) : null;
  if (ta && tb && ta.id !== tb.id) return { ok: false, reason: `Different interfaces: ${ta.name} and ${tb.name}` };
  const da = effectiveDirection(a), db = effectiveDirection(b);
  if (da === 'out' && db === 'out') return { ok: false, reason: a.onFrame || b.onFrame ? 'Directions do not match: a delegation joins ports of the same direction' : 'Both ports send (out → out)' };
  if (da === 'in' && db === 'in') return { ok: false, reason: a.onFrame || b.onFrame ? 'Directions do not match: a delegation joins ports of the same direction' : 'Both ports receive (in → in)' };
  const warn = !ta && !tb ? 'Neither port has a type' : !ta || !tb ? 'One port has no type' : undefined;
  return { ok: true, reason: ta ? `Compatible: ${ta.name}` : 'Compatible', warn };
}

/**
 * Which end should be "From" (the sender), so item flows point the natural way.
 * @param {PortEnd} a @param {PortEnd} b @returns {[PortEnd, PortEnd]}
 */
export function orderEnds(a, b) {
  const da = effectiveDirection(a), db = effectiveDirection(b);
  if (da === 'in' || db === 'out') return [b, a];
  return [a, b];
}

/**
 * The port to create on a part when a connection is dropped on the part itself: same
 * interface, the opposite direction, so it connects.
 * @param {PortEnd} from
 * @returns {{ type: string | null, direction: string, name: string }}
 */
export function matchingPort(from) {
  const d = effectiveDirection(from);
  const direction = d === 'out' ? 'in' : d === 'in' ? 'out' : 'inout';
  const base = from.port.name.replace(/(In|Out|_in|_out)$/i, '') || 'port';
  return { type: from.port.props.type || null, direction, name: `${base}${direction === 'in' ? 'In' : direction === 'out' ? 'Out' : ''}` };
}
