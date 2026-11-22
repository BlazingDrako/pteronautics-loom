// Pictures for the SysML library: how each element, relationship and diagram looks on a
// diagram, and a drawing for each concept article (RFLP, the Systems V, allocation…). Drawn
// as SVG strings on a 560-wide canvas in the theme's colors, so they follow light and dark.
// Text is fitted to its box (cut with an ellipsis) so it never spills out.
import { RELATIONSHIPS } from '../model/metamodel.js';

/** @typedef {{ svg: SVGSVGElement, caption: string }} Figure */

const W = 560;
const R = 'var(--layer-r)', F = 'var(--layer-f)', L = 'var(--layer-l)', P = 'var(--layer-p)', A = 'var(--accent)';
let uid = 0;
/** Marker id prefix of the figure being drawn (each figure has its own markers). */
let mk = 'lf0';

/** @param {unknown} v */
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Cut text to fit a width. @param {string} str @param {number} w @param {number} size @param {boolean} [mono] */
function fit(str, w, size, mono = false) {
  const max = Math.floor(w / (size * (mono ? 0.62 : 0.56)));
  return str.length <= max ? str : str.slice(0, Math.max(1, max - 1)) + '…';
}

/**
 * Text. `w` is the room it has (it is cut to fit); size defaults to 13.
 * @param {number} x @param {number} y @param {string} str
 * @param {{ cls?: string, anchor?: 'start' | 'middle' | 'end', size?: number, w?: number, color?: string }} [o]
 */
function t(x, y, str, o = {}) {
  const size = o.size || 13, mono = !!o.cls?.includes('f-mono');
  const txt = o.w ? fit(str, o.w, size, mono) : str;
  return `<text x="${x}" y="${y}" text-anchor="${o.anchor || 'middle'}" font-size="${size}" class="f-t ${o.cls || ''}"${o.color ? ` style="fill:${o.color}"` : ''}>${esc(txt)}</text>`;
}

/**
 * A line through points. Ends: 'open' (→), 'tri' (hollow triangle), 'fill' (filled
 * triangle), 'dia' (filled diamond, at the start).
 * @param {number[][]} pts
 * @param {{ dash?: boolean | string, end?: string, start?: string, cls?: string, label?: string, lx?: number, ly?: number, hot?: boolean, curve?: boolean }} [o]
 */
function ln(pts, o = {}) {
  const hot = o.hot ? '-a' : '';
  let d;
  if (o.curve && pts.length === 4) d = `M${pts[0]} C${pts[1]} ${pts[2]} ${pts[3]}`;
  else d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const dash = o.dash === true ? ' stroke-dasharray="6 4"' : o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  let out = `<path d="${d}" class="f-line${o.hot ? ' f-hot' : ''} ${o.cls || ''}"${dash}${o.end ? ` marker-end="url(#${mk}-${o.end}${hot})"` : ''}${o.start ? ` marker-start="url(#${mk}-${o.start}${hot})"` : ''}/>`;
  if (o.label) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const lx = o.lx ?? (a[0] + b[0]) / 2, ly = o.ly ?? (a[1] + b[1]) / 2 - 7;
    out += t(lx, ly, o.label, { cls: 'f-s' + (o.hot ? ' f-hot-t' : ''), size: 11 });
  }
  return out;
}

/** The height a box needs. */
const boxH = (/** @type {BoxOpts} */ o) => 12 + (o.stereo ? 15 : 0) + (o.name ? 15 : 0) + (o.comps || []).reduce((s, [title, lines]) => s + 14 + (title ? 14 : 0) + lines.length * 15, 0);

/**
 * @typedef {{ stereo?: string, name?: string, comps?: [string, string[]][], rx?: number, tint?: string, h?: number, dashed?: boolean, hot?: boolean }} BoxOpts
 */
/** A box with a «stereotype», a name and compartments. @param {number} x @param {number} y @param {number} w @param {BoxOpts} o */
function box(x, y, w, o) {
  const h = o.h || boxH(o);
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 3}" class="f-box${o.tint ? ' f-tint' : ''}${o.hot ? ' f-hotbox' : ''}"${o.tint ? ` style="color:${o.tint}"` : ''}${o.dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
  let cy = y + 17;
  if (o.stereo) { out += t(x + w / 2, cy, `«${o.stereo}»`, { cls: 'f-s', size: 11, w: w - 12 }); cy += 15; }
  if (o.name) { out += t(x + w / 2, cy, o.name, { cls: 'f-b', w: w - 12 }); cy += 15; }
  cy -= 9;
  for (const [title, lines] of o.comps || []) {
    cy += 6;
    out += `<path d="M${x} ${cy} H${x + w}" class="f-line f-thin"/>`;
    cy += 4;
    if (title) { cy += 12; out += t(x + w / 2, cy, title, { cls: 'f-s f-i', size: 10.5, w: w - 12 }); cy += 2; }
    for (const l of lines) { cy += 15; out += t(x + 9, cy, l, { anchor: 'start', size: 11.5, cls: 'f-mono', w: w - 16 }); }
    cy += 4;
  }
  return out;
}
/** @param {number} x @param {number} y @param {number} w @param {string} name @param {string} [tint] */
const block = (x, y, w, name, tint = L, comps = /** @type {[string, string[]][]} */ ([])) => box(x, y, w, { stereo: 'block', name, comps, tint });
/** @param {number} x @param {number} y @param {number} w @param {string} name @param {string} id @param {string} text @param {boolean} [hot] */
const req = (x, y, w, name, id, text, hot) => box(x, y, w, { stereo: 'requirement', name, comps: [['', [`id = "${id}"`, `text = "${text}"`]]], tint: R, hot });
/** A function / action: a rounded box. @param {number} x @param {number} y @param {number} w @param {number} h @param {string} name @param {string} [tint] */
const act = (x, y, w, h, name, tint = F, hot = false) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(12, h / 2)}" class="f-box f-tint${hot ? ' f-hotbox' : ''}" style="color:${tint}"/>` + t(x + w / 2, y + h / 2 + 4.5, name, { w: w - 14 });
/** @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {string} name */
const uc = (cx, cy, rx, ry, name, tint = R) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="f-box f-tint" style="color:${tint}"/>` + t(cx, cy + 4.5, name, { w: rx * 1.6 });
/** A stick figure, its feet at y + 52. @param {number} x @param {number} y @param {string} name */
const actor = (x, y, name) => `<g class="f-line" style="fill:none"><circle cx="${x}" cy="${y + 8}" r="7"/><path d="M${x} ${y + 15} V${y + 34} M${x - 13} ${y + 22} H${x + 13} M${x} ${y + 34} L${x - 10} ${y + 50} M${x} ${y + 34} L${x + 10} ${y + 50}"/></g>` + t(x, y + 67, name, { size: 12, w: 110 });
/** A package (folder with a tab). @param {number} x @param {number} y @param {number} w @param {number} h @param {string} name */
const pkg = (x, y, w, h, name, tint = 'var(--text-3)', top = false) => `<path d="M${x} ${y + 14} V${y + h} H${x + w} V${y + 14} Z M${x} ${y + 14} V${y} H${x + Math.min(w * 0.45, 90)} V${y + 14}" class="f-box f-tint" style="color:${tint}"/>` + t(top ? x + w / 2 : x + w / 2, top ? y + 32 : y + 14 + (h - 14) / 2 + 4.5, name, { cls: 'f-b', w: w - 14 });
/** A state. @param {number} x @param {number} y @param {number} w @param {number} h @param {string} name @param {string[]} [lines] */
function state(x, y, w, h, name, lines = [], tint = L, hot = false) {
  let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" class="f-box f-tint${hot ? ' f-hotbox' : ''}" style="color:${tint}"/>` + t(x + w / 2, y + 19, name, { cls: 'f-b', w: w - 16 });
  if (lines.length) { o += `<path d="M${x} ${y + 27} H${x + w}" class="f-line f-thin"/>`; lines.forEach((l, i) => { o += t(x + 10, y + 44 + i * 15, l, { anchor: 'start', size: 11.5, cls: 'f-mono', w: w - 18 }); }); }
  return o;
}
/** @param {number} x @param {number} y */
const initial = (x, y) => `<circle cx="${x}" cy="${y}" r="8" class="f-solid"/>`;
/** @param {number} x @param {number} y */
const final = (x, y) => `<circle cx="${x}" cy="${y}" r="10" class="f-line f-ring"/><circle cx="${x}" cy="${y}" r="5.5" class="f-solid"/>`;
/** @param {number} x @param {number} y */
const flowFinal = (x, y) => `<circle cx="${x}" cy="${y}" r="10" class="f-line f-ring"/><path d="M${x - 7} ${y - 7} L${x + 7} ${y + 7} M${x + 7} ${y - 7} L${x - 7} ${y + 7}" class="f-line"/>`;
/** @param {number} x @param {number} y */
const diamond = (x, y, r = 13) => `<path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z" class="f-box f-tint" style="color:${F}"/>`;
/** A fork or join bar. @param {number} x @param {number} y @param {number} len @param {boolean} [vertical] */
const bar = (x, y, len, vertical = false) => vertical ? `<rect x="${x - 3}" y="${y - len / 2}" width="6" height="${len}" rx="1.5" class="f-solid"/>` : `<rect x="${x - len / 2}" y="${y - 3}" width="${len}" height="6" rx="1.5" class="f-solid"/>`;
/** A port square centered at x, y. @param {number} x @param {number} y */
const port = (x, y, tint = L) => `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" class="f-box f-tint" style="color:${tint}"/>`;
/** A lifeline: head box and dashed line. @param {number} x @param {number} y @param {string} name @param {number} len */
const life = (x, y, name, len, tint = L) => `<rect x="${x - 58}" y="${y}" width="116" height="30" rx="3" class="f-box f-tint" style="color:${tint}"/>` + t(x, y + 19.5, name, { w: 104, size: 12 }) + ln([[x, y + 30], [x, y + 30 + len]], { dash: '4 4', cls: 'f-thin' });
/** A diagram frame with its name tab. @param {number} x @param {number} y @param {number} w @param {number} h @param {string} label */
function frame(x, y, w, h, label) {
  const tw = Math.min(w - 20, label.length * 6.6 + 20);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="f-frame"/><path d="M${x} ${y + 22} H${x + tw} L${x + tw + 10} ${y + 12} V${y}" class="f-line f-thin" style="fill:var(--bg-sunk)"/>` + t(x + 7, y + 15.5, label, { anchor: 'start', size: 11, cls: 'f-mono', w: tw - 6 });
}
/** A note. @param {number} x @param {number} y @param {number} w @param {number} h @param {string[]} lines */
const note = (x, y, w, h, lines) => `<path d="M${x} ${y} H${x + w - 12} L${x + w} ${y + 12} V${y + h} H${x} Z M${x + w - 12} ${y} V${y + 12} H${x + w}" class="f-box f-note"/>` + lines.map((l, i) => t(x + 10, y + 21 + i * 16, l, { anchor: 'start', size: 12, w: w - 20 })).join('');
/** A small pill (a status chip). @param {number} x @param {number} y @param {string} text @param {string} color */
const chip = (x, y, text, color) => { const w = text.length * 6.6 + 16; return `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" class="f-chip" style="color:${color}"/>` + t(x + w / 2, y + 14, text, { size: 11, cls: 'f-b', color }); };
/** A lane header with a color bar. @param {number} x @param {number} y @param {number} w @param {string} name @param {string} color */
const laneHead = (x, y, w, name, color) => t(x + w / 2, y, name, { cls: 'f-b', size: 12.5, w }) + `<rect x="${x}" y="${y + 7}" width="${w}" height="3" rx="1.5" style="fill:${color}"/>`;

/** The SVG element for a drawing. @param {number} h @param {string} body @returns {SVGSVGElement} */
function svg(h, body) {
  const el = /** @type {SVGSVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  el.setAttribute('viewBox', `0 0 ${W} ${h}`);
  el.setAttribute('role', 'img');
  el.setAttribute('class', 'lib-svg');
  const marker = (/** @type {string} */ id, /** @type {string} */ d, /** @type {string} */ cls, refX = 11) => `<marker id="${mk}-${id}" viewBox="0 0 12 12" refX="${refX}" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="${d}" class="${cls}"/></marker>`;
  const defs = ['', '-a'].map((a) => [
    marker('open' + a, 'M1 1.5 L11 6 L1 10.5', 'f-mk' + a),
    marker('tri' + a, 'M1 1 L11 6 L1 11 Z', 'f-mk f-mk-hollow' + a),
    marker('fill' + a, 'M1 1.5 L11 6 L1 10.5 Z', 'f-mk f-mk-fill' + a),
    marker('dia' + a, 'M1 6 L6 2 L11 6 L6 10 Z', 'f-mk f-mk-fill' + a, 1),
  ].join('')).join('');
  el.innerHTML = `<defs>${defs}</defs>${body}`;
  return el;
}

// ---------- relationships ----------

/** The «keyword» each relationship shows on its line. */
const KEYWORD = /** @type {Record<string, string>} */ ({ satisfy: 'satisfy', verify: 'verify', derive: 'deriveReqt', refine: 'refine', allocate: 'allocate', copy: 'copy', include: 'include', extend: 'extend', import: 'import', trace: 'trace' });

/** A sample of each kind, for the two ends of a relationship. @param {string} kind @param {number} x @param {number} y @param {number} w @param {boolean} [b] */
function sample(kind, x, y, w, b = false) {
  switch (kind) {
    case 'requirement': return b ? req(x, y, w, 'Flight time', 'REQ-003', 'Fly 45 min') : req(x, y, w, 'Battery capacity', 'REQ-014', '≥ 350 Wh');
    case 'testCase': return box(x, y, w, { stereo: 'testCase', name: 'Endurance flight', comps: [['', ['result = Pass']]], tint: R });
    case 'partDef': return b ? block(x, y, w, 'Flight Computer', P) : block(x, y, w, 'Battery Pack');
    case 'action': return act(x, y + 18, w, 44, 'Capture images');
    case 'useCase': return uc(x + w / 2, y + 40, w / 2, 28, b ? 'Fly survey' : 'Return home');
    case 'actor': return actor(x + w / 2, y + 4, 'Operator');
    case 'package': return pkg(x, y + 4, w, 70, b ? 'Units' : 'Propulsion');
    default: return box(x, y, w, { name: kind, tint: L });
  }
}

/** @param {string} k */
function relFigure(k) {
  const r = RELATIONSHIPS[k];
  if (k === 'generalize') {
    return { h: 230, caption: 'A hollow triangle points to the general type. The specific type inherits everything the general one has.', body:
      block(200, 14, 160, 'Power Source', L, [['values', ['voltage : V']]])
      + block(60, 140, 170, 'Battery Pack', L, [['values', ['capacity : Ah']]]) + block(330, 140, 170, 'Solar Panel', L, [['values', ['area : m²']]])
      + ln([[145, 140], [145, 115], [280, 115], [280, 96]], { end: 'tri' }) + ln([[415, 140], [415, 115], [280, 115]]) };
  }
  if (k === 'participate') {
    return { h: 150, caption: 'A plain line joins an actor to a use case it takes part in.', body:
      actor(110, 20, 'Operator') + uc(400, 60, 110, 34, 'Fly survey') + ln([[135, 55], [290, 60]]) };
  }
  const src = r.sources === '*' ? 'partDef' : r.sources[0], tgt = r.targets === '*' ? 'requirement' : r.targets[0];
  const lift = (/** @type {string} */ kind) => (kind === 'action' ? 22 : kind === 'useCase' ? 18 : kind === 'actor' ? 6 : 0);
  const h = 150;
  const body = sample(src, 20, 30, 190) + sample(tgt, 350, 30, 190, true)
    + ln([[212, 68 + lift(src) * 0], [348, 68]], { dash: true, end: 'open', label: `«${KEYWORD[k] || k}»`, ly: 58 });
  return { h, caption: `${r.help} The dashed arrow points from the ${k === 'derive' ? 'derived requirement to its source' : 'element that ' + r.verb.sysml.replace(/ (to|from|in)$/, '') + ' to the one it relates to'}.`, body };
}

// ---------- element kinds ----------

/** @type {Record<string, () => { h: number, caption: string, body: string }>} */
const KINDS = {
  package: () => ({ h: 170, caption: 'A package is a folder: everything inside it is owned by it. The tab carries its name.', body:
    `<path d="M140 30 V150 H420 V30 Z M140 30 V12 H250 V30" class="f-box f-tint" style="color:var(--text-3)"/>` + t(195, 25.5, 'Propulsion', { cls: 'f-b', size: 12, w: 100 })
    + block(160, 50, 115, 'Motor') + block(290, 50, 115, 'Propeller') }),
  requirement: () => ({ h: 140, caption: 'A requirement box: its ID and the "shall" statement it makes, under «requirement».', body:
    req(130, 18, 300, 'Flight time', 'REQ-003', 'The drone shall fly 45 min.') }),
  testCase: () => ({ h: 150, caption: 'A test case verifies requirements and records its result.', body:
    box(30, 30, 200, { stereo: 'testCase', name: 'Endurance flight', comps: [['', ['method = Test', 'result = Pass']]], tint: R })
    + req(330, 30, 200, 'Flight time', 'REQ-003', 'Fly ≥ 45 min') + ln([[232, 70], [328, 70]], { dash: true, end: 'open', label: '«verify»' }) }),
  action: () => ({ h: 160, caption: 'A function (activity) and the sub-functions it breaks into.', body:
    act(170, 14, 220, 40, 'Survey an area', F, true)
    + act(20, 106, 160, 38, 'Plan route') + act(200, 106, 160, 38, 'Fly route') + act(380, 106, 160, 38, 'Capture images')
    + ln([[280, 54], [280, 80], [100, 80], [100, 104]]) + ln([[280, 80], [280, 104]]) + ln([[280, 80], [460, 80], [460, 104]]) }),
  partDef: () => ({ h: 215, caption: 'A block: a type of thing. Compartments list its parts, values and ports.', body:
    box(160, 12, 240, { stereo: 'block', name: 'Battery Pack', tint: L, comps: [['parts', ['cells : Cell [6]', 'bms : Battery Monitor']], ['values', ['capacity : Ah = 16', 'voltage : V = 22.2']], ['ports', ['out power : DCPower']]] }) }),
  interfaceDef: () => ({ h: 150, caption: 'An interface block says what can cross a port: here, DC power.', body:
    box(30, 20, 210, { stereo: 'interfaceBlock', name: 'DCPower', tint: L, comps: [['flow properties', ['out current : A', 'out voltage : V']]] })
    + block(340, 34, 170, 'Battery Pack') + port(510, 70) + t(505, 98, 'power : DCPower', { anchor: 'end', size: 11.5, cls: 'f-mono' })
    + ln([[242, 70], [336, 70]], { dash: '3 3', end: 'open', label: 'types the port' }) }),
  part: () => ({ h: 170, caption: 'A part property: a usage of a block inside another, with a multiplicity.', body:
    frame(110, 10, 340, 150, 'ibd [block] Drone')
    + box(140, 52, 130, { name: 'bat : Battery', tint: L, h: 44 }) + box(290, 52, 130, { name: 'm : Motor [4]', tint: L, h: 44 })
    + t(280, 138, 'name : Type [multiplicity]', { size: 11.5, cls: 'f-mono f-s' }) }),
  port: () => ({ h: 150, caption: 'Ports are squares on a block\'s edge. Each says what crosses it and in which direction.', body:
    box(190, 25, 180, { stereo: 'block', name: 'Motor Controller', tint: L, h: 90 }) + port(190, 70) + port(370, 55) + port(370, 90)
    + ln([[100, 70], [182, 70]], { end: 'open' }) + t(100, 62, 'in power', { anchor: 'start', size: 11.5, cls: 'f-mono' })
    + ln([[378, 55], [460, 55]], { end: 'open' }) + t(390, 47, 'out phase : ~AC', { anchor: 'start', size: 11.5, cls: 'f-mono' })
    + ln([[378, 90], [460, 90]], { end: 'open', start: 'open' }) + t(390, 112, 'inout can : CAN', { anchor: 'start', size: 11.5, cls: 'f-mono' }) }),
  connector: () => ({ h: 150, caption: 'A connector joins two ports inside a block. An item flow (arrow) says what moves along it.', body:
    frame(30, 10, 500, 130, 'ibd [block] Drone')
    + box(70, 55, 150, { name: 'bat : Battery', tint: L, h: 44 }) + port(220, 77) + box(340, 55, 150, { name: 'esc : Controller', tint: L, h: 44 }) + port(340, 77)
    + ln([[226, 77], [334, 77]]) + `<path d="M272 70 L286 77 L272 84 Z" class="f-solid"/>` + t(280, 64, 'DC power', { size: 11, cls: 'f-s' }) }),
  attribute: () => ({ h: 150, caption: 'A value property: a quantity with a type and a unit. Leave it empty and the solver works it out.', body:
    box(160, 14, 240, { stereo: 'block', name: 'Battery Pack', tint: L, comps: [['values', ['capacity : Charge = 16 [Ah]', 'voltage : Voltage = 22.2 [V]', 'energy : Energy = (solved)']]] }) }),
  valueType: () => ({ h: 140, caption: 'A value type names a kind of quantity and its unit.', body:
    box(150, 20, 260, { stereo: 'valueType', name: 'Energy', tint: L, comps: [['', ['quantityKind = Energy', 'unit = Wh']]] }) }),
  constraintDef: () => ({ h: 180, caption: 'A constraint block: an equation and the parameters it relates.', body:
    box(150, 14, 260, { stereo: 'constraint', name: 'Flight Time', tint: L, comps: [['constraints', ['{ t = E / P }']], ['parameters', ['E : Energy', 'P : Power', 't : Time']]] }) }),
  constraint: () => ({ h: 170, caption: 'On a parametric diagram, a constraint property is a rounded box with its parameters on the edge.', body:
    frame(40, 10, 480, 150, 'par [block] Drone') + parConstraint(200, 50) }),
  binding: () => ({ h: 170, caption: 'A binding connector says a value and a parameter are equal.', body:
    frame(40, 10, 480, 150, 'par [block] Drone') + parConstraint(250, 50, true) }),
  controlNode: () => ({ h: 130, caption: 'Control nodes: where a flow starts, chooses, splits, joins and ends.', body:
    [['Initial', initial(50, 48)], ['Decision', diamond(140, 48)], ['Merge', diamond(220, 48)], ['Fork', bar(300, 48, 40, true)], ['Join', bar(370, 48, 40, true)], ['Final', final(440, 48)], ['Flow final', flowFinal(515, 48)]]
      .map(([n, s], i) => s + t([50, 140, 220, 300, 370, 440, 515][i], 100, n, { size: 11.5, cls: 'f-s' })).join('') }),
  flow: () => ({ h: 130, caption: 'Control flow says what happens next; object flow carries an item. A guard in brackets says when a path is taken.', body:
    act(30, 40, 130, 40, 'Check battery') + diamond(225, 60) + act(380, 10, 150, 40, 'Take off') + act(380, 74, 150, 40, 'Charge')
    + ln([[160, 60], [210, 60]], { end: 'open' }) + ln([[238, 60], [280, 60], [280, 30], [378, 30]], { end: 'open' }) + ln([[280, 60], [280, 94], [378, 94]], { end: 'open' })
    + t(330, 23, '[charge > 20%]', { size: 11, cls: 'f-s' }) + t(330, 87, '[else]', { size: 11, cls: 'f-s' }) }),
  state: () => ({ h: 140, caption: 'A state: what a block is doing for a while, with actions on entry, while in it (do) and on exit.', body:
    state(170, 16, 220, 100, 'Flying', ['entry / arm motors', 'do / hold altitude', 'exit / log flight'], L, true) }),
  region: () => ({ h: 180, caption: 'Regions split a state into parts that are active at the same time.', body:
    `<rect x="80" y="14" width="400" height="156" rx="14" class="f-box f-tint" style="color:${L}"/>` + t(280, 34, 'Operating', { cls: 'f-b' }) + `<path d="M80 42 H480" class="f-line f-thin"/><path d="M80 106 H480" class="f-line" stroke-dasharray="6 4"/>`
    + initial(110, 74) + state(140, 56, 120, 36, 'Hovering') + state(320, 56, 120, 36, 'Cruising') + ln([[118, 74], [138, 74]], { end: 'open' }) + ln([[262, 74], [318, 74]], { end: 'open' })
    + initial(110, 138) + state(140, 120, 120, 36, 'Recording') + state(320, 120, 120, 36, 'Paused') + ln([[118, 138], [138, 138]], { end: 'open' }) + ln([[262, 138], [318, 138]], { end: 'open' }) }),
  transition: () => ({ h: 120, caption: 'A transition: trigger [guard] / effect. When the trigger happens and the guard holds, the effect runs.', body:
    state(40, 40, 150, 44, 'Idle') + state(370, 40, 150, 44, 'Armed') + ln([[192, 62], [368, 62]], { end: 'open', hot: true }) + t(280, 52, 'arm [checks ok] / spin up', { size: 11.5, cls: 'f-mono' }) }),
  interaction: () => ({ h: 200, caption: 'An interaction is one scenario, drawn as a sequence diagram.', body: seq() }),
  lifeline: () => ({ h: 195, caption: 'A lifeline: one participant. Time runs downward; the bar shows when it is busy.', body:
    life(280, 14, 'fc : Autopilot', 140) + `<rect x="274" y="70" width="12" height="70" class="f-box f-tint" style="color:${L}"/>` }),
  message: () => ({ h: 200, caption: 'Messages: a call (filled arrow), a signal (open arrow) and a reply (dashed).', body: seq() }),
  fragment: () => ({ h: 218, caption: 'A combined fragment groups messages: alt picks one operand, opt may happen, loop repeats, par runs in parallel.', body: frag() }),
  operand: () => ({ h: 218, caption: 'Operands are the parts of a fragment, each with a guard; dashed lines separate them.', body: frag() }),
  actor: () => ({ h: 110, caption: 'An actor: someone or something outside the system that uses it.', body: actor(280, 14, 'Operator') }),
  useCase: () => ({ h: 180, caption: 'Use cases are goals inside the subject\'s boundary; actors outside take part in them.', body: ucd() }),
  profile: () => ({ h: 180, caption: 'A profile is a package of stereotypes: your own kinds of element.', body:
    `<path d="M120 30 V170 H440 V30 Z M120 30 V12 H260 V30" class="f-box f-tint" style="color:var(--text-3)"/>` + t(190, 25.5, '«profile» Avionics', { cls: 'f-b', size: 11.5, w: 136 })
    + box(150, 50, 260, { stereo: 'stereotype', name: 'Flight critical', tint: A, comps: [['tags', ['dal : String = "B"', 'owner : String']]] }) }),
  stereotype: () => ({ h: 160, caption: 'A stereotype applied to a block shows in guillemets, with its tagged values.', body:
    box(30, 20, 200, { stereo: 'stereotype', name: 'Flight critical', tint: A, comps: [['tags', ['dal : String']]] })
    + box(330, 20, 200, { stereo: 'block, Flight critical', name: 'Autopilot', tint: L, comps: [['tags', ['dal = "B"']]] })
    + ln([[328, 62], [232, 62]], { dash: true, end: 'open', label: 'applied' }) }),
  comment: () => ({ h: 130, caption: 'A comment is a note anchored to an element by a dashed line.', body:
    note(40, 20, 220, 70, ['Sized for 45 min at', '20% reserve.']) + block(360, 30, 160, 'Battery Pack') + ln([[262, 55], [358, 55]], { dash: '3 4' }) }),
};

/** A constraint property with its parameters, and values bound to them. @param {number} x @param {number} y @param {boolean} [hot] */
function parConstraint(x, y, hot = false) {
  return `<rect x="${x}" y="${y}" width="160" height="90" rx="14" class="f-box f-tint" style="color:${L}"/>` + t(x + 80, y + 40, 'ft : Flight Time', { cls: 'f-b', w: 140 }) + t(x + 80, y + 60, '{ t = E / P }', { size: 11.5, cls: 'f-mono' })
    + port(x, y + 30) + port(x, y + 66) + port(x + 160, y + 48)
    + box(x - 150, y + 14, 100, { name: 'energy', tint: P, h: 30 }) + box(x - 150, y + 52, 100, { name: 'power', tint: P, h: 30 }) + box(x + 210, y + 33, 100, { name: 'endurance', tint: P, h: 30 })
    + ln([[x - 50, y + 29], [x - 6, y + 30]], { hot }) + ln([[x - 50, y + 67], [x - 6, y + 66]], { hot }) + ln([[x + 166, y + 48], [x + 210, y + 48]], { hot })
    + t(x - 9, y + 22, 'E', { size: 10.5, cls: 'f-s', anchor: 'end' }) + t(x - 9, y + 85, 'P', { size: 10.5, cls: 'f-s', anchor: 'end' }) + t(x + 172, y + 40, 't', { size: 10.5, cls: 'f-s', anchor: 'start' });
}
/** A small sequence diagram. */
function seq() {
  return frame(30, 8, 500, 186, 'sd Start survey')
    + life(130, 40, 'op : Operator', 120, R) + life(280, 40, 'gs : Station', 120) + life(430, 40, 'fc : Autopilot', 120)
    + ln([[130, 96], [278, 96]], { end: 'open', label: 'start()', ly: 90 }) + ln([[280, 122], [428, 122]], { end: 'fill', label: 'upload(route)', ly: 116 })
    + ln([[430, 150], [282, 150]], { dash: true, end: 'open', label: 'ack', ly: 144 });
}
/** A fragment with two operands. */
function frag() {
  return life(150, 10, 'fc : Autopilot', 172) + life(410, 10, 'bat : Battery', 172)
    + `<rect x="60" y="62" width="440" height="130" class="f-frame"/><path d="M60 80 H96 L104 72 V62" class="f-line f-thin" style="fill:var(--bg-sunk)"/>` + t(68, 76, 'alt', { anchor: 'start', size: 11.5, cls: 'f-b' })
    + t(112, 98, '[charge > 20%]', { anchor: 'start', size: 11, cls: 'f-mono' }) + ln([[150, 112], [408, 112]], { end: 'fill', label: 'continue()', ly: 106 })
    + `<path d="M60 130 H500" class="f-line" stroke-dasharray="6 4"/>`
    + t(112, 150, '[else]', { anchor: 'start', size: 11, cls: 'f-mono' }) + ln([[150, 170], [408, 170]], { end: 'fill', label: 'returnHome()', ly: 164 });
}
/** A small use case diagram. */
function ucd() {
  return `<rect x="200" y="12" width="320" height="160" rx="2" class="f-frame"/>` + t(360, 32, 'Survey Drone', { cls: 'f-b', size: 12.5 })
    + uc(360, 72, 100, 24, 'Fly survey') + uc(360, 140, 100, 24, 'Return home')
    + actor(90, 50, 'Operator') + ln([[115, 80], [258, 74]])
    + ln([[360, 116], [360, 98]], { dash: true, end: 'open', label: '«extend»', lx: 400, ly: 111 });
}

// ---------- diagram kinds ----------

/** @type {Record<string, () => { h: number, caption: string, body: string }>} */
const DIAGRAMS = {
  bdd: () => ({ h: 230, caption: 'A block definition diagram shows block types and how they relate: a filled diamond is "made of", a triangle is "a kind of".', body:
    frame(20, 8, 520, 214, 'bdd [package] Structure') + block(215, 38, 130, 'Drone')
    + block(50, 148, 130, 'Airframe') + block(215, 148, 130, 'Battery Pack') + block(380, 148, 130, 'Motor')
    + ln([[280, 82], [280, 148]], { start: 'dia' }) + ln([[262, 82], [262, 110], [115, 110], [115, 148]], { start: 'dia' }) + ln([[298, 82], [298, 110], [445, 110], [445, 148]], { start: 'dia' })
    + t(452, 140, '4', { size: 11, cls: 'f-mono', anchor: 'start' }) }),
  ibd: () => ({ h: 190, caption: 'An internal block diagram shows the parts inside one block and how their ports connect.', body:
    frame(20, 8, 520, 174, 'ibd [block] Drone') + box(50, 70, 130, { name: 'bat : Battery', tint: L, h: 44 }) + box(215, 70, 130, { name: 'esc : Controller', tint: L, h: 44 }) + box(380, 70, 130, { name: 'm : Motor [4]', tint: L, h: 44 })
    + port(180, 92) + port(215, 92) + port(345, 92) + port(380, 92) + ln([[186, 92], [209, 92]]) + ln([[351, 92], [374, 92]])
    + t(197, 140, 'DC', { size: 11, cls: 'f-s' }) + t(362, 140, 'AC', { size: 11, cls: 'f-s' }) }),
  req: () => ({ h: 250, caption: 'A requirement diagram: requirements, how they derive from each other, and what satisfies and verifies them.', body:
    frame(10, 8, 540, 234, 'req [package] Requirements') + req(180, 34, 200, 'Endurance need', 'N-001', 'Cover a field')
    + req(30, 150, 170, 'Flight time', 'REQ-003', 'Fly ≥ 45 min') + block(250, 160, 120, 'Battery Pack') + box(400, 160, 130, { stereo: 'testCase', name: 'Endurance test', tint: R })
    + ln([[115, 150], [115, 128], [240, 128], [240, 120]], { dash: true, end: 'open', label: '«deriveReqt»', lx: 170, ly: 122 })
    + ln([[250, 190], [202, 190]], { dash: true, end: 'open', label: '«satisfy»', ly: 182 }) + ln([[465, 160], [465, 142], [150, 142], [150, 150]], { dash: true, end: 'open', label: '«verify»', lx: 380, ly: 136 }) }),
  table: () => ({ h: 160, caption: 'A requirements table: one row per requirement, with the columns you choose.', body: grid(['ID', 'Name', 'Text', 'Satisfied by'], [['REQ-001', 'Payload', 'Carry 2 kg', 'Airframe'], ['REQ-002', 'Range', 'Fly 10 km', 'Battery Pack'], ['REQ-003', 'Flight time', 'Fly 45 min', '—']]) }),
  gtable: () => ({ h: 160, caption: 'A generic table: any kinds of element as rows, with the columns you choose (properties, members, related elements, tagged values).', body: grid(['Name', 'Parts', 'Ports', 'Satisfies'], [['Propulsion', 'battery, esc, motor', 'throttle', 'REQ-004'], ['Avionics', 'fc, gps', 'escCmd', 'REQ-007'], ['Airframe', 'wing, tail', '—', 'REQ-002']]) }),
  matrix: () => ({ h: 195, caption: 'A dependency matrix: a mark wherever a relationship joins a row and a column. Click a cell to add or remove one.', body: matrix() }),
  act: () => ({ h: 210, caption: 'An activity diagram: a function\'s steps, flows, decisions and swimlanes (which block does each step).', body:
    frame(10, 8, 540, 194, 'act Survey an area') + `<path d="M10 52 H550 M280 30 V202" class="f-line f-thin"/>` + t(145, 45, 'Flight Computer', { cls: 'f-b', size: 12 }) + t(415, 45, 'Camera', { cls: 'f-b', size: 12 })
    + initial(60, 80) + act(90, 64, 150, 34, 'Fly to waypoint') + diamond(165, 140) + act(330, 64, 150, 34, 'Capture image') + final(70, 140)
    + ln([[68, 80], [88, 80]], { end: 'open' }) + ln([[240, 81], [328, 81]], { end: 'open' }) + ln([[405, 98], [405, 140], [180, 140]], { end: 'open' })
    + ln([[165, 127], [165, 100]], { end: 'open', label: '[more]', lx: 195, ly: 118 }) + ln([[150, 140], [82, 140]], { end: 'open', label: '[done]', ly: 132 }) }),
  stm: () => ({ h: 170, caption: 'A state machine diagram: the states a block can be in and the events that move it between them.', body:
    frame(10, 8, 540, 154, 'stm Drone') + initial(40, 80) + state(70, 60, 110, 40, 'Idle') + state(230, 60, 110, 40, 'Armed') + state(400, 60, 120, 40, 'Flying')
    + ln([[48, 80], [68, 80]], { end: 'open' }) + ln([[180, 80], [228, 80]], { end: 'open', label: 'arm' }) + ln([[340, 80], [398, 80]], { end: 'open', label: 'take off' })
    + ln([[460, 100], [460, 135], [125, 135], [125, 102]], { end: 'open', label: 'land', lx: 290, ly: 128 }) }),
  sd: () => ({ h: 200, caption: 'A sequence diagram: who sends which message to whom, top to bottom in time.', body: seq() }),
  uc: () => ({ h: 180, caption: 'A use case diagram: the system\'s goals, the actors involved, and include and extend between use cases.', body: ucd() }),
  pkg: () => ({ h: 160, caption: 'A package diagram: how the model is organized into packages, and which packages import others.', body:
    frame(10, 8, 540, 144, 'pkg Model') + pkg(40, 50, 140, 80, 'Requirements', R) + pkg(210, 50, 140, 80, 'Logical', L) + pkg(380, 50, 140, 80, 'Units')
    + ln([[350, 94], [378, 94]], { dash: true, end: 'open', label: '«import»', ly: 86 }) }),
  par: () => ({ h: 170, caption: 'A parametric diagram: equations (constraint properties) bound to the values they relate.', body: frame(40, 10, 480, 150, 'par [block] Drone') + parConstraint(200, 50, true) }),
};

/** A small table. @param {string[]} head @param {string[][]} rows */
function grid(head, rows) {
  const xs = [20, 110, 230, 390, 540], rh = 30;
  let o = `<rect x="20" y="14" width="520" height="${rh * (rows.length + 1)}" rx="4" class="f-box"/><rect x="20" y="14" width="520" height="${rh}" class="f-head"/>`;
  head.forEach((c, i) => { o += t(xs[i] + 10, 14 + 20, c, { anchor: 'start', size: 11.5, cls: 'f-b', w: xs[i + 1] - xs[i] - 16 }); });
  rows.forEach((r, j) => {
    const y = 14 + rh * (j + 1);
    o += `<path d="M20 ${y} H540" class="f-line f-thin"/>`;
    r.forEach((c, i) => { o += t(xs[i] + 10, y + 20, c, { anchor: 'start', size: 11.5, cls: i === 0 ? 'f-mono' : c === '—' ? 'f-warn' : '', w: xs[i + 1] - xs[i] - 16 }); });
  });
  xs.slice(1, -1).forEach((x) => { o += `<path d="M${x} 14 V${14 + rh * (rows.length + 1)}" class="f-line f-thin"/>`; });
  return o;
}
function matrix() {
  const cols = ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'], rows = ['Airframe', 'Battery Pack', 'Motor', 'Camera'];
  const hits = [[1, 0, 0, 0], [0, 1, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0]];
  const x0 = 130, y0 = 44, cw = 80, rh = 30;
  let o = '';
  cols.forEach((c, i) => { o += t(x0 + cw * i + cw / 2, y0 - 12, c, { size: 11, cls: 'f-mono', w: cw - 6 }); });
  rows.forEach((r, j) => {
    o += t(x0 - 10, y0 + rh * j + 20, r, { anchor: 'end', size: 12, w: 120 });
    cols.forEach((_, i) => {
      o += `<rect x="${x0 + cw * i}" y="${y0 + rh * j}" width="${cw}" height="${rh}" class="f-cell"/>`;
      if (hits[j][i]) o += `<path d="M${x0 + cw * i + cw / 2 - 7} ${y0 + rh * j + 15} h14 M${x0 + cw * i + cw / 2 + 2} ${y0 + rh * j + 10} l5 5 l-5 5" class="f-line f-hot"/>`;
    });
  });
  o += t(x0 + cw * 2, y0 + rh * 4 + 22, '→ satisfy', { size: 11, cls: 'f-s' });
  o += `<rect x="${x0}" y="${y0 + rh * 3}" width="${cw * 4}" height="${rh}" class="f-gaprow"/>` + t(x0 + cw * 4 + 8, y0 + rh * 3 + 20, 'satisfies nothing', { anchor: 'start', size: 11, cls: 'f-warn' });
  return o;
}

// ---------- concept articles ----------

/** @type {Record<string, () => { h: number, caption: string, body: string }>} */
const CONCEPTS = {
  mbse: () => {
    const views = [['Diagrams', 70, 40], ['Tables', 70, 170], ['Matrices', 490, 40], ['Documents', 490, 170]];
    return { h: 230, caption: 'One model, many views. Change it once and every diagram, table and document that shows it changes too.', body:
      `<circle cx="280" cy="115" r="70" class="f-box f-tint" style="color:${A}"/>` + t(280, 106, 'The model', { cls: 'f-b', size: 15 }) + t(280, 126, 'elements +', { size: 11.5, cls: 'f-s' }) + t(280, 141, 'relationships', { size: 11.5, cls: 'f-s' })
      + views.map(([n, x, y]) => box(/** @type {number} */ (x) - 60, /** @type {number} */ (y), 120, { name: /** @type {string} */ (n), h: 36 }) + ln([[/** @type {number} */ (x) < 280 ? /** @type {number} */ (x) + 60 : /** @type {number} */ (x) - 60, /** @type {number} */ (y) + 18], [/** @type {number} */ (x) < 280 ? 216 : 344, /** @type {number} */ (y) < 100 ? 85 : 145]], { dash: '4 4' })).join('') };
  },
  sysml: () => ({ h: 170, caption: 'The same battery in SysML v1 (a «block» on a diagram) and SysML v2 (a part def, as text or drawn).', body:
    t(140, 20, 'SysML v1', { cls: 'f-b', size: 12 }) + t(420, 20, 'SysML v2', { cls: 'f-b', size: 12 })
    + box(50, 34, 180, { stereo: 'block', name: 'Battery', tint: L, comps: [['values', ['capacity : Ah']]] })
    + `<rect x="310" y="34" width="220" height="90" rx="6" class="f-code"/>` + ['part def Battery {', '  attribute capacity', '    : ElectricCharge;', '}'].map((l, i) => t(324, 58 + i * 17, l, { anchor: 'start', size: 12, cls: 'f-mono', w: 200 })).join('')
    + `<path d="M280 40 V150" class="f-line f-thin" stroke-dasharray="3 4"/>` }),
  notations: () => ({ h: 150, caption: 'One element, three vocabularies. Switching the notation never changes the model.', body:
    [['SysML', 'block', 'Battery'], ['SysML v2', 'part def', 'Battery'], ['Guided', 'Part type', 'Battery']].map(([n, s, name], i) =>
      t(100 + i * 180, 24, n, { cls: 'f-b', size: 12 }) + box(30 + i * 180, 38, 140, { stereo: s, name, tint: L })).join('')
    + t(280, 130, 'same element underneath', { size: 11.5, cls: 'f-s' }) }),
  rflp: () => {
    const cols = [['Requirements', R, 'What is needed'], ['Functional', F, 'What it must do'], ['Logical', L, 'How it is organized'], ['Physical', P, 'What gets built']];
    const cw = 122, gap = 16, x0 = 10;
    let o = cols.map(([n, c, note], i) => laneHead(x0 + i * (cw + gap), 20, cw, n, c) + t(x0 + i * (cw + gap) + cw / 2, 46, note, { size: 11, cls: 'f-s', w: cw })).join('');
    o += box(x0, 62, cw, { stereo: 'requirement', name: 'Flight time', tint: R, h: 50 })
      + act(x0 + (cw + gap), 70, cw, 36, 'Provide power')
      + box(x0 + 2 * (cw + gap), 62, cw, { stereo: 'block', name: 'Power System', tint: L, h: 50 })
      + box(x0 + 3 * (cw + gap), 62, cw, { stereo: 'block', name: '6S Li-ion Pack', tint: P, h: 50 });
    o += ln([[x0 + cw + gap, 88], [x0 + cw + 2, 88]], { dash: true, end: 'open', label: '«refine»', ly: 140, lx: x0 + cw + gap / 2 })
      + ln([[x0 + 2 * cw + gap, 88], [x0 + 2 * (cw + gap) - 2, 88]], { dash: true, end: 'open' })
      + ln([[x0 + 3 * cw + 2 * gap, 88], [x0 + 3 * (cw + gap) - 2, 88]], { dash: true, end: 'open' });
    o += t(x0 + 2 * cw + 1.5 * gap, 140, '«allocate»', { size: 11, cls: 'f-s' }) + t(x0 + 3 * cw + 2.5 * gap, 140, '«allocate»', { size: 11, cls: 'f-s' });
    o += ln([[x0 + 3 * (cw + gap) + cw / 2, 112], [x0 + 3 * (cw + gap) + cw / 2, 170], [x0 + cw / 2, 170], [x0 + cw / 2, 114]], { dash: true, end: 'open', label: '«satisfy»', lx: 280, ly: 164, hot: true });
    return { h: 190, caption: 'Each layer answers a different question, and trace relationships tie them together end to end.', body: o };
  },
  'systems-v': () => {
    const L1 = [['Stakeholder needs', 82, 30], ['System requirements', 117, 80], ['Architecture', 152, 130], ['Component design', 187, 180]];
    const R1 = [['Validation', 478, 30], ['System verification', 443, 80], ['Integration testing', 408, 130], ['Component testing', 373, 180]];
    let o = `<path d="M82 44 L280 228 L478 44" class="f-vpath"/>`;
    o += [...L1, ...R1].map(([n, x, y], i) => `<rect x="${/** @type {number} */ (x) - 74}" y="${y}" width="148" height="28" rx="6" class="f-box f-tint" style="color:${i < 4 ? R : P}"/>` + t(/** @type {number} */ (x), /** @type {number} */ (y) + 18.5, /** @type {string} */ (n), { size: 11, w: 140 })).join('');
    o += L1.map((l, i) => ln([[/** @type {number} */ (l[1]) + 76, /** @type {number} */ (l[2]) + 14], [/** @type {number} */ (R1[i][1]) - 76, /** @type {number} */ (R1[i][2]) + 14]], { dash: '3 5', cls: 'f-thin' })).join('');
    o += `<rect x="222" y="222" width="116" height="28" rx="6" class="f-box f-tint" style="color:${L}"/>` + t(280, 240.5, 'Implementation', { size: 11, w: 110 });
    o += t(36, 166, 'decompose', { size: 11, cls: 'f-s f-i' }) + t(524, 166, 'integrate', { size: 11, cls: 'f-s f-i' });
    return { h: 260, caption: 'Each stage on the left is checked by its partner on the right (dotted lines).', body: o };
  },
  'views-vs-model': () => ({ h: 220, caption: 'Two diagrams show the same Battery. Removing it from one diagram leaves it in the model; deleting it removes it everywhere.', body:
    frame(20, 10, 240, 100, 'bdd Power') + block(80, 42, 120, 'Battery', L) + frame(300, 10, 240, 100, 'ibd Drone') + box(360, 50, 120, { name: 'bat : Battery', tint: L, h: 40 })
    + `<rect x="150" y="150" width="260" height="56" rx="10" class="f-box f-tint" style="color:${A}"/>` + t(280, 173, 'Model', { cls: 'f-b' }) + t(280, 192, 'Battery (one element)', { size: 11.5, cls: 'f-s' })
    + ln([[140, 110], [230, 150]], { dash: '4 4', end: 'open' }) + ln([[420, 110], [330, 150]], { dash: '4 4', end: 'open' }) }),
  'definition-usage': () => ({ h: 200, caption: 'A definition (block, part def) is a type; usages (parts) are its uses in context, each with a name.', body:
    t(140, 20, 'Definition', { cls: 'f-b', size: 12 }) + t(420, 20, 'Usages', { cls: 'f-b', size: 12 })
    + box(60, 34, 160, { stereo: 'block', name: 'Motor', tint: L, comps: [['values', ['kv : rpm/V']]] })
    + box(330, 34, 180, { name: 'front : Motor', tint: L, h: 40 }) + box(330, 94, 180, { name: 'rear : Motor', tint: L, h: 40 })
    + ln([[328, 54], [222, 66]], { dash: '3 3', end: 'open' }) + ln([[328, 114], [222, 80]], { dash: '3 3', end: 'open', label: 'typed by', lx: 275, ly: 122 }) }),
  traceability: () => ({ h: 230, caption: 'Following the thread: a need, the requirement derived from it, the block that satisfies it and the test that verifies it.', body:
    box(20, 20, 150, { stereo: 'requirement', name: 'Survey a field', tint: R, h: 50 }) + box(205, 20, 150, { stereo: 'requirement', name: 'Flight time', tint: R, h: 50, hot: true })
    + box(390, 20, 150, { stereo: 'testCase', name: 'Endurance test', tint: R, h: 50 }) + box(205, 150, 150, { stereo: 'block', name: 'Battery Pack', tint: L, h: 50 })
    + ln([[203, 45], [172, 45]], { dash: true, end: 'open', label: '«deriveReqt»', ly: 38, hot: true }) + ln([[388, 45], [357, 45]], { dash: true, end: 'open', label: '«verify»', ly: 38, hot: true })
    + ln([[280, 148], [280, 72]], { dash: true, end: 'open', label: '«satisfy»', lx: 318, ly: 115, hot: true }) }),
  coverage: () => {
    const rows = [['Requirements satisfied', 82, R], ['Requirements verified', 64, R], ['Functions allocated', 100, F], ['Logical realized physically', 45, L]];
    return { h: 170, caption: 'Coverage: the share of each layer that is linked to the next. Gaps are what is missing a link.', body: rows.map(([n, p, c], i) =>
      t(20, 30 + i * 38, /** @type {string} */ (n), { anchor: 'start', size: 12.5, w: 200 }) + `<rect x="230" y="${19 + i * 38}" width="250" height="10" rx="5" class="f-track"/><rect x="230" y="${19 + i * 38}" width="${2.5 * /** @type {number} */ (p)}" height="10" rx="5" style="fill:${c}"/>` + t(495, 30 + i * 38, `${p}%`, { anchor: 'start', size: 12.5, cls: 'f-b' })).join('') };
  },
  'writing-requirements': () => ({ h: 150, caption: 'A good requirement names who, says "shall", states one measurable thing and the conditions it holds under.', body:
    `<rect x="20" y="20" width="520" height="44" rx="8" class="f-code"/>`
    + [['The drone', 40, R], ['shall', 118, A], ['fly for at least 45 min', 165, L], ['in winds up to 10 m/s.', 340, P]].map(([s, x, c]) => `<text x="${x}" y="48" font-size="14" class="f-t f-b" style="fill:${c}">${esc(s)}</text>`).join('')
    + [['subject', 68], ['"shall"', 133], ['one measurable thing', 245], ['condition', 415]].map(([s, x]) => `<path d="M${x} 70 V86" class="f-line f-thin"/>` + t(/** @type {number} */ (x), 102, /** @type {string} */ (s), { size: 11.5, cls: 'f-s' })).join('')
    + t(280, 136, 'Avoid: fast, adequate, user-friendly, TBD, "and" joining two needs', { size: 11.5, cls: 'f-warn' }) }),
  verification: () => ({ h: 160, caption: 'Verification asks "did we build it right?" (tests against requirements). Validation asks "did we build the right thing?" (against stakeholder needs).', body:
    box(20, 30, 150, { stereo: 'requirement', name: 'Survey a field', tint: R, h: 50 }) + box(205, 30, 150, { stereo: 'requirement', name: 'Flight time', tint: R, h: 50 }) + box(390, 30, 150, { stereo: 'testCase', name: 'Endurance test', tint: R, h: 50 })
    + ln([[388, 55], [357, 55]], { dash: true, end: 'open', label: '«verify»', ly: 48 }) + chip(430, 92, 'Pass', 'var(--good)')
    + t(95, 112, 'validated with users', { size: 11.5, cls: 'f-s' }) + t(280, 112, 'verified by test', { size: 11.5, cls: 'f-s' }) }),
  'live-checks': () => ({ h: 140, caption: 'A live check is an expression on a requirement, evaluated against the model\'s values as you edit.', body:
    box(30, 20, 260, { stereo: 'requirement', name: 'Flight time', tint: R, comps: [['', ['check = endurance >= 45 [min]']]] }) + box(380, 30, 150, { name: 'endurance', tint: P, comps: [['', ['= 52 [min]']]] })
    + ln([[378, 62], [292, 62]], { dash: '4 4', end: 'open' }) + chip(110, 105, '✓ 52 min ≥ 45 min', 'var(--good)') }),
  parametrics: () => ({ h: 170, caption: 'Values are bound to an equation\'s parameters; the solver fills in the value that is left empty.', body: frame(40, 10, 480, 150, 'par [block] Drone') + parConstraint(200, 50, true) }),
  units: () => ({ h: 120, caption: 'Values carry units. Equations convert between them and refuse to mix kinds of quantity.', body:
    [['16 Ah', 30], ['×', 140], ['22.2 V', 170], ['=', 290], ['355 Wh', 320]].map(([s, x]) => /** @type {string} */ (s).length > 1 ? `<rect x="${x}" y="30" width="${/** @type {string} */ (s).length > 5 ? 110 : 100}" height="40" rx="8" class="f-box f-tint" style="color:${P}"/>` + t(/** @type {number} */ (x) + (/** @type {string} */ (s).length > 5 ? 55 : 50), 56, /** @type {string} */ (s), { cls: 'f-b f-mono', size: 14 }) : t(/** @type {number} */ (x) + 10, 56, /** @type {string} */ (s), { size: 18, cls: 'f-s' })).join('')
    + chip(445, 40, '1.28 MJ', 'var(--accent)') + t(280, 102, '16 Ah + 22.2 V  →  error: different kinds of quantity', { size: 11.5, cls: 'f-warn' }) }),
  allocation: () => ({ h: 200, caption: 'Swimlanes are allocation: each action is allocated to the block whose lane it sits in.', body:
    frame(20, 8, 520, 184, 'act Capture survey') + `<path d="M20 52 H540 M193 30 V192 M367 30 V192" class="f-line f-thin"/>`
    + t(106, 45, '«block» Navigation', { size: 11.5, cls: 'f-b', w: 160 }) + t(280, 45, '«block» Autopilot', { size: 11.5, cls: 'f-b', w: 160 }) + t(453, 45, '«block» Camera', { size: 11.5, cls: 'f-b', w: 160 })
    + act(40, 80, 133, 36, 'Plan route') + act(213, 80, 133, 36, 'Fly route') + act(387, 80, 133, 36, 'Capture images', F, true) + act(387, 140, 133, 36, 'Store images')
    + ln([[173, 98], [211, 98]], { end: 'open' }) + ln([[346, 98], [385, 98]], { end: 'open' }) + ln([[453, 116], [453, 138]], { end: 'open' }) }),
  'ports-interfaces': () => ({ h: 170, caption: 'Ports mark where things cross a block\'s boundary; interfaces say what. An item flow shows what moves, and which way.', body:
    block(30, 40, 160, 'Battery Pack') + port(190, 76) + block(370, 40, 160, 'Motor Controller') + port(370, 76)
    + ln([[196, 76], [364, 76]]) + `<path d="M272 69 L286 76 L272 83 Z" class="f-solid"/>` + t(280, 64, 'current : DC', { size: 11.5, cls: 'f-mono' })
    + t(190, 108, 'out : DCPower', { size: 11, cls: 'f-mono f-s' }) + t(370, 108, 'in : ~DCPower', { size: 11, cls: 'f-mono f-s' })
    + box(205, 120, 150, { stereo: 'interfaceBlock', name: 'DCPower', tint: L, h: 42 }) }),
  'state-machines': () => DIAGRAMS.stm(),
  activities: () => ({ h: 190, caption: 'Tokens flow from the initial node. A fork splits into parallel paths, a join waits for all of them.', body:
    initial(30, 90) + act(55, 72, 110, 36, 'Arm') + bar(195, 90, 70, true) + act(225, 30, 120, 36, 'Climb') + act(225, 114, 120, 36, 'Start camera') + bar(375, 90, 70, true) + act(400, 72, 110, 36, 'Survey') + final(535, 90)
    + ln([[38, 90], [53, 90]], { end: 'open' }) + ln([[165, 90], [190, 90]], { end: 'open' }) + ln([[198, 70], [223, 48]], { end: 'open' }) + ln([[198, 110], [223, 132]], { end: 'open' })
    + ln([[345, 48], [372, 70]], { end: 'open' }) + ln([[345, 132], [372, 110]], { end: 'open' }) + ln([[378, 90], [398, 90]], { end: 'open' }) + ln([[510, 90], [523, 90]], { end: 'open' })
    + t(195, 175, 'fork', { size: 11, cls: 'f-s' }) + t(375, 175, 'join', { size: 11, cls: 'f-s' }) }),
  sequences: () => ({ h: 200, caption: 'Read top to bottom: each message is sent after the one above it.', body: seq() }),
  validation: () => ({ h: 160, caption: 'Rules check the model as you work. Problems show on the element, in the inspector and in the problems panel.', body:
    box(40, 30, 200, { stereo: 'block', name: 'Drone', tint: L, comps: [['parts', ['bat : Battery', 'cam']]] }) + `<circle cx="240" cy="30" r="10" style="fill:var(--warn)"/>` + t(240, 34.5, '!', { cls: 'f-b', size: 12, color: 'var(--bg-elev)' })
    + `<rect x="300" y="30" width="230" height="78" rx="8" class="f-box"/>` + t(314, 54, '⚠ Part "cam" has no type', { anchor: 'start', size: 12, cls: 'f-warn', w: 206 }) + t(314, 76, '⚠ Nothing satisfies REQ-003', { anchor: 'start', size: 12, cls: 'f-warn', w: 206 }) + t(314, 98, 'ⓘ "Drone" has no description', { anchor: 'start', size: 12, cls: 'f-s', w: 206 })
    + ln([[298, 54], [252, 34]], { dash: '3 3' }) }),
  profiles: () => KINDS.stereotype(),
  'text-notation': () => ({ h: 160, caption: 'Every diagram element is also text. Edit either; the other follows.', body:
    box(30, 30, 190, { stereo: 'block', name: 'Battery', tint: L, comps: [['parts', ['cells : Cell [6]']]] })
    + `<rect x="300" y="24" width="230" height="110" rx="6" class="f-code"/>` + ['part def Battery {', '  part cells : Cell [6];', '}', '', 'part def Cell;'].map((l, i) => t(314, 48 + i * 18, l, { anchor: 'start', size: 12, cls: 'f-mono', w: 210 })).join('')
    + ln([[224, 70], [296, 70]], { end: 'open', start: 'open' }) }),
  exchange: () => {
    const out = [['ReqIF', 70, 40], ['Excel · CSV', 70, 120], ['Cameo XMI', 280, 170], ['SysML v2 API', 490, 40], ['Documents', 490, 120]];
    return { h: 220, caption: 'Loom reads and writes the formats other tools use.', body:
      `<rect x="220" y="60" width="120" height="56" rx="12" class="f-box f-tint" style="color:${A}"/>` + t(280, 93, 'Loom', { cls: 'f-b', size: 15 })
      + out.map(([n, x, y]) => box(/** @type {number} */ (x) - 60, /** @type {number} */ (y), 120, { name: /** @type {string} */ (n), h: 34 })
        + ln([[/** @type {number} */ (x) === 280 ? 280 : /** @type {number} */ (x) < 280 ? /** @type {number} */ (x) + 60 : /** @type {number} */ (x) - 60, /** @type {number} */ (y) + 17], [/** @type {number} */ (x) === 280 ? 280 : /** @type {number} */ (x) < 280 ? 218 : 342, /** @type {number} */ (x) === 280 ? 118 : 88]], { end: 'open', start: 'open' })).join('') };
  },
};

/**
 * The figure for a library entry, or null when it has none.
 * @param {{ id: string, kind?: string }} entry @returns {Figure | null}
 */
export function figureFor(entry) {
  const id = entry.id;
  /** @type {(() => { h: number, caption: string, body: string }) | undefined} */
  let make;
  if (id.startsWith('rel-') && entry.kind && entry.kind in RELATIONSHIPS) { const k = entry.kind; make = () => relFigure(k); }
  else if (id.startsWith('kind-') && entry.kind) make = KINDS[entry.kind] || DIAGRAMS[entry.kind];
  else make = CONCEPTS[id];
  if (!make) return null;
  mk = `lf${++uid}`;
  const f = make();
  return { svg: svg(f.h, f.body), caption: f.caption };
}

/** Ids of every entry that has a figure, for tests. */
export const FIGURE_KEYS = { kinds: Object.keys(KINDS), diagrams: Object.keys(DIAGRAMS), concepts: Object.keys(CONCEPTS) };
