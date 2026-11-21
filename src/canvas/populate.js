// Put elements on a new diagram and lay them out. Used when a diagram is created and by
// the Kestrel sample.
import { nodeContent, naturalSize, heightAt, edgesFor, canShow } from './bdd.js';
import { reqNodeContent, reqRelatedOf, canShowReq, layoutRequirements } from './req.js';
import { requirementsIn } from '../model/trace.js';
import { layered } from './layout.js';

/**
 * Inside a transaction: show `ids` on the diagram, laid out automatically.
 * @param {import('../model/model.js').Model} m
 * @param {any} tx the transaction's editing API
 * @param {string} diagramId
 * @param {string[]} ids
 * @param {import('../model/metamodel.js').Notation} [notation]
 */
export function populate(m, tx, diagramId, ids, notation = 'sysml') {
  const d = m.get(diagramId);
  if (!d) return;
  const show = ids.filter((id) => canShow(m.get(id)));
  const nodes = show.map((id) => {
    const nat = naturalSize(nodeContent(m, /** @type {any} */ (m.get(id)), d, notation));
    return { id, w: Math.max(180, Math.ceil(nat.w / 10) * 10 + 10), h: nat.h };
  });
  const edges = edgesFor(m, new Set(show)).map((e) => ({ from: e.from, to: e.to, kind: e.kind }));
  const pos = layered(nodes, edges);
  /** @type {Record<string, import('../model/model.js').Rect>} */
  const patch = {};
  for (const n of nodes) { const p = pos.get(n.id); if (p) patch[n.id] = { x: p.x, y: p.y, w: n.w, h: n.h }; }
  tx.place(diagramId, patch);
}

/** Blocks a new diagram in `ownerId` should start with: those directly inside it. @param {import('../model/model.js').Model} m @param {string} ownerId */
export function startingBlocks(m, ownerId) {
  return m.children(ownerId).filter((c) => canShow(c)).map((c) => c.id);
}

/**
 * Inside a transaction: fill a new requirement diagram with the requirements in its package
 * (or `ids`) and what satisfies, refines and verifies them, laid out top-down.
 * @param {import('../model/model.js').Model} m
 * @param {any} tx
 * @param {string} diagramId
 * @param {import('../model/metamodel.js').Notation} [notation]
 * @param {string[]} [ids]
 */
export function populateReq(m, tx, diagramId, notation = 'sysml', ids) {
  const d = m.get(diagramId);
  if (!d || !d.owner) return;
  const reqs = (ids || requirementsIn(m, d.owner).map((r) => r.el.id)).slice(0, 40);
  const show = new Set(reqs.filter((id) => canShowReq(m.get(id))));
  for (const id of [...show]) {
    const { below } = reqRelatedOf(m, id);
    for (const x of below) if (show.size < 60 && canShowReq(m.get(x))) show.add(x);
  }
  const nodes = [...show].map((id) => {
    const c = reqNodeContent(m, /** @type {any} */ (m.get(id)), d, notation);
    const w = Math.max(m.get(id)?.kind === 'requirement' ? 250 : 180, Math.ceil(naturalSize(c).w / 10) * 10);
    return { id, w, h: heightAt(c, w) };
  });
  tx.place(diagramId, layoutRequirements(m, nodes));
}
