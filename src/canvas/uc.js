// Use case diagrams (actors, use cases, the system boundary) and package diagrams (how the
// model is organized). Both are drawn by the general diagram canvas.
import { kindName, LAYERS } from '../model/metamodel.js';
import { layered } from './layout.js';
import { naturalSize } from './bdd.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/model.js').Rect} Rect */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/** @typedef {import('./bdd.js').NodeContent} NodeContent */
/** @typedef {import('./bdd.js').Edge} Edge */

// ---------- use case diagrams ----------

/** @param {Element | undefined} el */
const canShowUc = (el) => !!el && (el.kind === 'actor' || el.kind === 'useCase' || el.kind === 'partDef');

/** @param {Model} m @param {Element} el @param {Element} _d @param {Notation} n @returns {NodeContent} */
export function ucNodeContent(m, el, _d, n) {
  if (el.kind === 'actor') return { stereo: '', name: el.name, compartments: [], layerColor: null, shape: 'actor' };
  if (el.kind === 'useCase') return { stereo: '', name: el.name, compartments: [], layerColor: null, shape: 'ellipse' };
  return { stereo: n === 'guided' ? 'The system' : n === 'v2' ? '«part def»' : '«block»', name: el.name, compartments: [], layerColor: null, shape: 'boundary', under: true, depth: 0, linkable: false };
}

/** @param {Model} m @param {Set<string>} shown @returns {Edge[]} */
export function ucEdgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const id of shown) {
    for (const r of m.relsFrom(id)) {
      if (!r.target || !shown.has(r.target)) continue;
      if (r.kind === 'participate') out.push({ id: r.id, kind: 'assoc', from: id, to: r.target, element: r.id });
      else if (r.kind === 'include' || r.kind === 'extend') out.push({ id: r.id, kind: 'dependency', from: id, to: r.target, label: `«${r.kind}»`, element: r.id });
    }
  }
  return out;
}

/** The package a use case goes back to when it leaves a boundary. @param {Model} m @param {Element} d */
const homeOf = (m, d) => (m.get(/** @type {string} */ (d.owner))?.kind === 'package' ? /** @type {string} */ (d.owner) : /** @type {string} */ (m.layers()[0]?.id));

/**
 * After use cases move: one inside a boundary gets that block as its subject (it moves into
 * the block); one taken out goes back to the diagram's package. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {Element} d @param {string[]} ids
 */
export function resubject(m, tx, d, ids) {
  const nodes = /** @type {Element} */ (m.get(d.id)).layout?.nodes || {};
  const boxes = Object.entries(nodes).filter(([id]) => m.get(id)?.kind === 'partDef');
  let n = 0;
  for (const id of ids) {
    const e = m.get(id), r = nodes[id];
    if (!e || e.kind !== 'useCase' || !r) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const hit = boxes.filter(([, b]) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h).sort(([, a], [, b]) => a.w * a.h - b.w * b.h)[0];
    const want = hit ? hit[0] : (m.get(/** @type {string} */ (e.owner))?.kind === 'partDef' && nodes[/** @type {string} */ (e.owner)] ? homeOf(m, d) : e.owner);
    if (want && want !== e.owner && m.canMove(id, want)) { tx.move(id, want); n++; }
  }
  return n;
}

/**
 * Actors on the left, each boundary with its use cases in a column, loose use cases between.
 * @param {Model} m @param {{ id: string, w: number, h: number }[]} nodes @returns {Record<string, Rect>}
 */
export function layoutUseCases(m, nodes) {
  /** @type {Record<string, Rect>} */
  const out = {};
  const by = (/** @type {string} */ k) => nodes.filter((x) => m.get(x.id)?.kind === k);
  const actors = by('actor'), cases = by('useCase'), subjects = by('partDef');
  let y = 60;
  for (const a of actors) { out[a.id] = { x: 40, y, w: a.w, h: a.h }; y += a.h + 40; }
  let x = actors.length ? 40 + Math.max(...actors.map((a) => a.w)) + 90 : 40;
  const loose = cases.filter((c) => !subjects.some((s) => m.get(c.id)?.owner === s.id));
  const column = (/** @type {typeof nodes} */ list, /** @type {number} */ x0, /** @type {number} */ y0) => {
    let cy = y0;
    const w = Math.max(0, ...list.map((c) => c.w));
    for (const c of list) { out[c.id] = { x: Math.round(x0 + (w - c.w) / 2), y: cy, w: c.w, h: c.h }; cy += c.h + 30; }
    return { w, h: cy - y0 - 30 };
  };
  if (loose.length) { const c = column(loose, x, 60); x += c.w + 70; }
  for (const s of subjects) {
    const mine = cases.filter((c) => m.get(c.id)?.owner === s.id);
    const c = column(mine, x + 40, 110);
    out[s.id] = { x, y: 50, w: Math.max(s.w, c.w + 80), h: Math.max(200, c.h + 100) };
    x += out[s.id].w + 50;
  }
  return out;
}

/**
 * A new use case diagram: the actors and use cases in its package, the blocks that are
 * subjects of those use cases, laid out. Call inside a transaction.
 * @param {Model} m @param {any} tx @param {string} diagramId @param {Notation} [notation]
 */
export function populateUc(m, tx, diagramId, notation = 'sysml') {
  const d = /** @type {Element} */ (m.get(diagramId));
  const owner = /** @type {string} */ (d.owner);
  /** @type {Set<string>} */
  const ids = new Set();
  const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (c.kind === 'actor' || c.kind === 'useCase') ids.add(c.id); if (c.kind === 'package') walk(c.id); } };
  walk(owner);
  if (m.get(owner)?.kind === 'partDef') ids.add(owner);
  // use cases the actors take part in, wherever they are, and their subjects
  for (const id of [...ids]) for (const r of m.relsFrom(id)) if (r.kind === 'participate' && r.target) ids.add(r.target);
  for (const id of [...ids]) { const e = m.get(id); if (e?.kind === 'useCase' && m.get(/** @type {string} */ (e.owner))?.kind === 'partDef') ids.add(/** @type {string} */ (e.owner)); }
  // everything in those subjects, and what the use cases include or are extended by
  for (const id of [...ids]) if (m.get(id)?.kind === 'partDef') for (const c of m.children(id)) if (c.kind === 'useCase') ids.add(c.id);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...ids]) for (const r of [...m.relsFrom(id), ...m.relsTo(id)]) {
      if (r.kind !== 'include' && r.kind !== 'extend') continue;
      for (const x of [r.source, r.target]) if (x && !ids.has(x)) { ids.add(x); changed = true; }
    }
  }
  const nodes = [...ids].map((id) => { const nat = naturalSize(ucNodeContent(m, /** @type {Element} */ (m.get(id)), d, notation)); return { id, w: nat.w, h: nat.h }; });
  tx.place(diagramId, layoutUseCases(m, nodes));
}

export const ucKind = {
  kind: 'uc',
  canShow: canShowUc,
  nodeContent: ucNodeContent,
  edgesFor: ucEdgesFor,
  /** @param {Model} m @param {string} id */
  related(m, id) {
    const e = m.get(id);
    return {
      above: m.relsTo(id).filter((r) => ['participate', 'include', 'extend'].includes(r.kind)).map((r) => /** @type {string} */ (r.source)),
      below: [...m.relsFrom(id).filter((r) => ['participate', 'include', 'extend'].includes(r.kind)).map((r) => /** @type {string} */ (r.target)), ...(e?.kind === 'partDef' ? m.children(id).filter((c) => c.kind === 'useCase').map((c) => c.id) : [])],
    };
  },
  /** @param {Model} m @param {string} a @param {string} b */
  linkKinds: (m, a, b) => ['participate', 'include', 'extend'].filter((k) => m.canLink(k, a, b)),
  add: [
    { kind: 'actor', label: 'Actor', title: 'Add an actor: a person or system that uses this one' },
    { kind: 'useCase', label: 'Use case', title: 'Add a use case (drop it in a boundary to give it that subject)' },
    {
      kind: 'partDef', label: 'Subject', title: 'Show a block as the system boundary', empty: 'There are no blocks yet. Add one in the Logical layer first.',
      /** @param {Model} m @param {Element} d */
      menu: (m, d) => m.byKind('partDef').filter((b) => !d.layout?.nodes[b.id]).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40).map((b) => ({ label: b.name, hint: (m.layerOf(b.id) || '').toUpperCase(), place: b.id })),
    },
  ],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('r'),
  /** @param {Model} m @param {Element} d @param {string} kind @param {string[]} sel */
  ownerFor(m, d, kind, sel) {
    const subject = sel.map((x) => m.get(x)).find((e) => e?.kind === 'partDef');
    if (kind === 'useCase' && subject) return subject.id;
    return homeOf(m, d);
  },
  /** @param {string} kind */
  newSize: (kind) => (kind === 'actor' ? { w: 90, h: 100 } : { w: 170, h: 70 }),
  /** @param {Model} m @param {Element} d @param {Element | undefined} e @param {(id: string) => Rect} rectOf @param {string[]} shown */
  dropSize(m, d, e, rectOf, shown) {
    if (e?.kind !== 'partDef') return null;
    const rs = shown.map(rectOf);
    const x = rs.length ? Math.max(...rs.map((r) => r.x + r.w)) + 60 : 260;
    return { x, y: 50, w: 280, h: 320 };
  },
  /** Moving a boundary moves its use cases. @param {Model} m @param {Element} d @param {string} id @param {(id: string) => Rect} _r @param {string[]} shown */
  dragsWith: (m, d, id, _r, shown) => (m.get(id)?.kind === 'partDef' ? shown.filter((x) => m.get(x)?.owner === id) : []),
  /** @param {Model} m @param {any} tx @param {Element} d @param {string[]} ids */
  afterPlace: (m, tx, d, ids) => { resubject(m, tx, d, ids); },
  /** @param {Model} m @param {Element} _d @param {{ id: string, w: number, h: number }[]} nodes */
  tidy: (m, _d, nodes) => layoutUseCases(m, nodes),
  flags: /** @type {[string, string][]} */ ([['showRoles', 'Relationship names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Add actors and use cases with the buttons above, show a block as the subject, and drag between them to connect.',
  noun: 'elements',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A use case diagram shows actors, use cases and blocks (as the subject). ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};

// ---------- package diagrams ----------

/** @param {Model} m @param {Element} el @param {Element} d @param {Notation} n @returns {NodeContent} */
export function pkgNodeContent(m, el, d, n) {
  const kids = m.children(el.id);
  const rows = kids.slice(0, 8).map((k) => k.name);
  if (kids.length > 8) rows.push(`and ${kids.length - 8} more`);
  const layer = m.layerOf(el.id);
  return {
    stereo: el.layer ? (n === 'guided' ? 'RFLP layer' : '«layer»') : n === 'guided' ? 'Folder' : n === 'v2' ? 'package' : '«package»',
    name: el.name,
    compartments: d.props.showMembers === false || !rows.length ? [] : [{ title: n === 'guided' ? 'Contains' : 'members', rows }],
    layerColor: layer ? LAYERS.find((l) => l.id === layer)?.color || null : null,
    shape: 'folder',
  };
}

/** @param {Model} m @param {Set<string>} shown @returns {Edge[]} */
export function pkgEdgesFor(m, shown) {
  /** @type {Edge[]} */
  const out = [];
  for (const id of shown) {
    const e = m.get(id);
    if (e?.owner && shown.has(e.owner)) out.push({ id: `${e.owner}~${id}`, kind: 'containment', from: e.owner, to: id, element: id });
    for (const r of m.relsFrom(id)) {
      if (!r.target || !shown.has(r.target)) continue;
      if (r.kind === 'import') out.push({ id: r.id, kind: 'dependency', from: id, to: r.target, label: '«import»', element: r.id });
      else if (r.kind === 'trace') out.push({ id: r.id, kind: 'dependency', from: id, to: r.target, label: '«dependency»', element: r.id });
    }
  }
  return out;
}

/**
 * A new package diagram: the packages inside its package (or `ids`), laid out.
 * @param {Model} m @param {any} tx @param {string} diagramId @param {Notation} [notation] @param {string[]} [ids]
 */
export function populatePkg(m, tx, diagramId, notation = 'sysml', ids) {
  const d = /** @type {Element} */ (m.get(diagramId));
  const show = ids || m.children(/** @type {string} */ (d.owner)).filter((c) => c.kind === 'package').map((c) => c.id);
  const nodes = show.map((id) => { const nat = naturalSize(pkgNodeContent(m, /** @type {Element} */ (m.get(id)), d, notation)); return { id, w: Math.max(180, Math.ceil(nat.w / 10) * 10), h: nat.h }; });
  const pos = layered(nodes, /** @type {any} */ (pkgEdgesFor(m, new Set(show)).map((e) => ({ from: e.from, to: e.to, kind: e.kind }))));
  /** @type {Record<string, Rect>} */
  const patch = {};
  for (const x of nodes) { const p = pos.get(x.id); if (p) patch[x.id] = { x: p.x, y: p.y, w: x.w, h: x.h }; }
  tx.place(diagramId, patch);
}

export const pkgKind = {
  kind: 'pkg',
  canShow: (/** @type {Element | undefined} */ el) => !!el && el.kind === 'package' && !!el.owner,
  nodeContent: pkgNodeContent,
  edgesFor: pkgEdgesFor,
  /** @param {Model} m @param {string} id */
  related(m, id) {
    const e = m.get(id);
    return {
      above: [...(e?.owner && m.get(e.owner)?.owner ? [e.owner] : []), ...m.relsFrom(id).filter((r) => r.kind === 'import' || r.kind === 'trace').map((r) => /** @type {string} */ (r.target))],
      below: [...m.children(id).filter((c) => c.kind === 'package').map((c) => c.id), ...m.relsTo(id).filter((r) => r.kind === 'import').map((r) => /** @type {string} */ (r.source))],
    };
  },
  /** @param {Model} m @param {string} a @param {string} b */
  linkKinds: (m, a, b) => ['import', 'trace'].filter((k) => m.canLink(k, a, b)),
  add: [{ kind: 'package', label: 'Package', title: 'Add a package (inside the selected one, if any)' }],
  addLayer: /** @type {import('../model/metamodel.js').Layer} */ ('l'),
  /** @param {Model} m @param {Element} d @param {string} _k @param {string[]} sel */
  ownerFor: (m, d, _k, sel) => sel.map((x) => m.get(x)).find((e) => e?.kind === 'package')?.id || d.owner,
  flags: /** @type {[string, string][]} */ ([['showMembers', 'Members'], ['showRoles', 'Relationship names on lines'], ['snap', 'Snap to grid and guides']]),
  empty: 'Drag packages here from the model browser (the RFLP layers too), or add one with the button above. Drag from one to another to add an import.',
  noun: 'packages',
  /** @param {Element | undefined} e @param {Notation} n */
  refuse: (e, n) => `A package diagram shows packages. ${e?.name || 'That'} is a ${kindName(e?.kind || '', n)}.`,
};
