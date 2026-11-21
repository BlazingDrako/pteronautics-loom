// Requirements and traceability: ID schemes, requirement levels, coverage, and the RFLP
// "thread" through an element. Pure functions of the model, used by the requirements table,
// the dependency matrix, the RFLP trace view, the Systems V and the inspector.
import { checksOf } from '../analysis/verify.js';

/** @typedef {import('./model.js').Model} Model */
/** @typedef {import('./model.js').Element} Element */
/** @typedef {'Need' | 'System' | 'Subsystem' | 'Component'} Level */

export const LEVELS = /** @type {const} */ (['Need', 'System', 'Subsystem', 'Component']);
export const DEFAULT_PREFIX = 'REQ-';

// ---------- IDs ----------

/** The ID prefix for requirements created in `ownerId`: the nearest package that sets one. @param {Model} m @param {string} ownerId */
export function idPrefixFor(m, ownerId) {
  let e = m.get(ownerId);
  while (e) {
    if (e.kind === 'package' && e.props.idPrefix) return String(e.props.idPrefix);
    e = e.owner ? m.get(e.owner) : undefined;
  }
  return DEFAULT_PREFIX;
}

/** @param {string} s */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The next free ID with a prefix: one more than the highest number in use, zero-padded to 3. @param {Model} m @param {string} prefix */
export function nextIdWith(m, prefix) {
  const re = new RegExp(`^${escRe(prefix)}(\\d+)$`);
  let max = 0, width = 3;
  for (const r of m.byKind('requirement')) {
    const hit = re.exec(String(r.props.reqId || ''));
    if (hit) { max = Math.max(max, Number(hit[1])); width = Math.max(width, hit[1].length); }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

/** The ID a new requirement in `ownerId` gets. @param {Model} m @param {string} ownerId */
export const nextReqId = (m, ownerId) => nextIdWith(m, idPrefixFor(m, ownerId));

/** Requirements inside an element, in model-browser order (depth first). @param {Model} m @param {string} rootId */
export function requirementsIn(m, rootId) {
  /** @type {{ el: Element, depth: number }[]} */
  const out = [];
  /** @param {string} id @param {number} depth */
  const walk = (id, depth) => {
    for (const c of m.children(id)) {
      if (c.kind === 'requirement') { out.push({ el: c, depth }); walk(c.id, depth + 1); }
      else if (c.kind === 'package') walk(c.id, depth);
    }
  };
  walk(rootId, 0);
  return out;
}

/**
 * Renumber every requirement inside a package, in browser order, each with the prefix of its
 * own package. Call inside a transaction. Returns how many IDs changed.
 * @param {Model} m @param {any} tx @param {string} rootId
 */
export function renumber(m, tx, rootId) {
  /** @type {Map<string, number>} */
  const counters = new Map();
  let changed = 0;
  for (const { el } of requirementsIn(m, rootId)) {
    const prefix = idPrefixFor(m, /** @type {string} */ (el.owner));
    const n = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, n);
    const id = prefix + String(n).padStart(3, '0');
    if (el.props.reqId !== id) { tx.setProps(el.id, { reqId: id }); changed++; }
  }
  return changed;
}

/** IDs used by more than one requirement. @param {Model} m @returns {Set<string>} */
export function duplicateIds(m) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const r of m.byKind('requirement')) { const id = String(r.props.reqId || '').trim(); if (id) seen.set(id, (seen.get(id) || 0) + 1); }
  return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
}

// ---------- relationships, as lookups ----------

/** Sources of relationships of `kind` into `id`. @param {Model} m @param {string} id @param {string} kind */
export const sourcesOf = (m, id, kind) => m.relsTo(id).filter((r) => r.kind === kind).map((r) => /** @type {Element} */ (m.get(/** @type {string} */ (r.source))));
/** Targets of relationships of `kind` out of `id`. @param {Model} m @param {string} id @param {string} kind */
export const targetsOf = (m, id, kind) => m.relsFrom(id).filter((r) => r.kind === kind).map((r) => /** @type {Element} */ (m.get(/** @type {string} */ (r.target))));

/** Requirements that break `id` down: contained sub-requirements and requirements derived from it. @param {Model} m @param {string} id */
export function subRequirements(m, id) {
  const subs = m.children(id).filter((c) => c.kind === 'requirement');
  for (const d of sourcesOf(m, id, 'derive')) if (!subs.includes(d)) subs.push(d);
  return subs;
}

// ---------- levels ----------

/**
 * A requirement's level. An explicit level wins. Otherwise:
 *   - derived from other requirements: one level below the deepest of them
 *   - contained in a requirement: the same level as its container (containment groups)
 *   - otherwise a stakeholder need when it sits in a "needs" or "stakeholder" package, or
 *     other requirements are derived from it; else a system requirement
 * @param {Model} m @param {string} id @param {Set<string>} [seen] @param {boolean} [auto] ignore an explicit level on this requirement (not on its parents)
 * @returns {Level}
 */
export function levelOf(m, id, seen = new Set(), auto = false) {
  const r = m.get(id);
  if (!r || r.kind !== 'requirement') return 'System';
  if (!auto && r.props.level && r.props.level !== 'Auto') return /** @type {Level} */ (r.props.level);
  return autoLevel(m, r, seen, new Map());
}

/**
 * Every requirement's level at once, sharing work along derivation chains.
 * @param {Model} m @returns {Map<string, Level>}
 */
export function levelsOf(m) {
  /** @type {Map<string, Level>} */
  const memo = new Map();
  for (const r of m.byKind('requirement')) levelFor(m, r, new Set(), memo);
  return memo;
}

/** @param {Model} m @param {Element} r @param {Set<string>} seen @param {Map<string, Level>} memo @returns {Level} */
function levelFor(m, r, seen, memo) {
  const hit = memo.get(r.id);
  if (hit) return hit;
  const v = r.props.level && r.props.level !== 'Auto' ? /** @type {Level} */ (r.props.level) : autoLevel(m, r, seen, memo);
  memo.set(r.id, v);
  return v;
}

/** @param {Model} m @param {Element} r @param {Set<string>} seen @param {Map<string, Level>} memo @returns {Level} */
function autoLevel(m, r, seen, memo) {
  if (seen.has(r.id)) return 'System';
  seen.add(r.id);
  try {
    const parents = targetsOf(m, r.id, 'derive');
    if (parents.length) {
      let deepest = 0;
      for (const p of parents) deepest = Math.max(deepest, LEVELS.indexOf(levelFor(m, p, seen, memo)));
      return LEVELS[Math.min(LEVELS.length - 1, Math.max(1, deepest + 1))];
    }
    const owner = r.owner ? m.get(r.owner) : undefined;
    if (owner?.kind === 'requirement') return levelFor(m, owner, seen, memo);
    if (m.path(r.id).some((p) => p.kind === 'package' && /\b(stakeholder|needs?)\b/i.test(p.name))) return 'Need';
    return sourcesOf(m, r.id, 'derive').length ? 'Need' : 'System';
  } finally {
    seen.delete(r.id);
  }
}

// ---------- coverage ----------

/**
 * @typedef {{
 *   satisfied: boolean, verified: boolean, passed: boolean, failed: boolean,
 *   direct: { satisfy: Element[], verify: Element[], refine: Element[] },
 *   check?: import('../analysis/verify.js').CheckResult,   its live check, if it has one
 * }} ReqStatus
 */

/**
 * Status for every requirement. A requirement is satisfied when something satisfies it, or
 * when it is broken down into sub-requirements that are all satisfied. The same goes for
 * verified (a test case verifies it, or it has a live check) and passed (every test case
 * verifying it has passed, and its check is met).
 * @param {Model} m @returns {Map<string, ReqStatus>}
 */
export function requirementStatus(m) {
  const checks = checksOf(m);
  /** @type {Map<string, ReqStatus>} */
  const out = new Map();
  /** @type {Set<string>} */
  const busy = new Set();
  /** @param {Element} r @returns {ReqStatus} */
  const of = (r) => {
    const hit = out.get(r.id);
    if (hit) return hit;
    const direct = { satisfy: sourcesOf(m, r.id, 'satisfy'), verify: sourcesOf(m, r.id, 'verify'), refine: sourcesOf(m, r.id, 'refine') };
    if (busy.has(r.id)) return { satisfied: direct.satisfy.length > 0, verified: direct.verify.length > 0, passed: false, failed: false, direct };
    busy.add(r.id);
    const subs = subRequirements(m, r.id).map(of);
    const all = (/** @type {(s: ReqStatus) => boolean} */ f) => subs.length > 0 && subs.every(f);
    const results = direct.verify.map((t) => t.props.result);
    const check = checks.get(r.id);
    // a live check is evidence like a test: met is a pass, not met a fail (a broken check is neither)
    if (check && check.verdict !== 'error') results.push(check.verdict === 'pass' ? 'Pass' : 'Fail');
    else if (check) results.push('Not run');
    const failed = results.includes('Fail') || subs.some((s) => s.failed);
    const st = {
      satisfied: direct.satisfy.length > 0 || all((s) => s.satisfied),
      verified: direct.verify.length > 0 || !!check || all((s) => s.verified),
      passed: !failed && ((results.length > 0 && results.every((x) => x === 'Pass')) || (!results.length && all((s) => s.passed))),
      failed,
      direct,
      ...(check ? { check } : {}),
    };
    busy.delete(r.id);
    out.set(r.id, st);
    return st;
  };
  for (const r of m.byKind('requirement')) of(r);
  return out;
}

/** Elements of a kind inside an RFLP layer. @param {Model} m @param {string} kind @param {string} layer */
export const inLayer = (m, kind, layer) => m.byKind(kind).filter((e) => m.layerOf(e.id) === layer);

/**
 * The functions (activities and their steps). A function is a function wherever it is kept:
 * models imported from other tools often keep activities beside the logical blocks, so every
 * activity outside the requirements layer counts, not only those in the functional layer.
 * @param {Model} m
 */
export const functionsOf = (m) => m.byKind('action').filter((e) => m.layerOf(e.id) !== 'r');

/** The block a part belongs to; other elements stand for themselves. @param {Model} m @param {Element} e */
export const cardOf = (m, e) => (e.kind === 'part' && e.owner ? /** @type {Element} */ (m.get(e.owner)) : e);

/**
 * @typedef {{ total: number, done: number, gaps: Element[] }} Metric
 * @typedef {{
 *   requirements: Element[], status: Map<string, ReqStatus>,
 *   satisfied: Metric, verified: Metric, passed: Metric & { failed: Element[] },
 *   functions: Metric, logical: Metric, physical: Metric,
 *   byLevel: Record<Level, Element[]>,
 * }} Coverage
 */

/**
 * Coverage across the RFLP layers.
 *   satisfied / verified / passed: requirements (retired ones are left out)
 *   functions: functions allocated to structure (directly, or all their sub-functions are)
 *   logical: logical blocks realized by something physical (allocated to it)
 *   physical: physical blocks that something logical is allocated to
 * @param {Model} m @returns {Coverage}
 */
export function coverage(m) {
  const status = requirementStatus(m);
  const requirements = m.byKind('requirement').filter((r) => r.props.status !== 'Retired');
  /** @param {Element[]} list @param {(e: Element) => boolean} ok @returns {Metric} */
  const metric = (list, ok) => { const gaps = list.filter((e) => !ok(e)); return { total: list.length, done: list.length - gaps.length, gaps }; };
  const st = (/** @type {Element} */ r) => /** @type {ReqStatus} */ (status.get(r.id));

  const fns = functionsOf(m);
  /** @type {Map<string, boolean>} */
  const fnDone = new Map();
  /** @param {Element} f @returns {boolean} */
  const allocated = (f) => {
    const hit = fnDone.get(f.id);
    if (hit !== undefined) return hit;
    fnDone.set(f.id, false); // cycle guard
    const subs = m.children(f.id).filter((c) => c.kind === 'action');
    const v = targetsOf(m, f.id, 'allocate').length > 0 || (subs.length > 0 && subs.every(allocated));
    fnDone.set(f.id, v);
    return v;
  };
  const isP = (/** @type {Element} */ e) => m.layerOf(cardOf(m, e).id) === 'p';
  const isL = (/** @type {Element} */ e) => m.layerOf(cardOf(m, e).id) === 'l';
  const logical = inLayer(m, 'partDef', 'l');
  const physical = inLayer(m, 'partDef', 'p');
  /** @type {Record<Level, Element[]>} */
  const byLevel = { Need: [], System: [], Subsystem: [], Component: [] };
  const levels = levelsOf(m);
  for (const r of requirements) byLevel[/** @type {Level} */ (levels.get(r.id))].push(r);
  /** Parts by the block that types them. @type {Map<string, Element[]>} */
  const usages = new Map();
  for (const p of m.byKind('part')) if (p.props.type) (usages.get(p.props.type) || usages.set(p.props.type, []).get(p.props.type))?.push(p);
  const passed = metric(requirements, (r) => st(r).passed);
  return {
    requirements, status, byLevel,
    satisfied: metric(requirements, (r) => st(r).satisfied),
    verified: metric(requirements, (r) => st(r).verified),
    passed: { ...passed, failed: requirements.filter((r) => st(r).failed) },
    functions: metric(fns, allocated),
    logical: metric(logical, (b) => [...targetsOf(m, b.id, 'allocate'), ...m.children(b.id).filter((c) => c.kind === 'part').flatMap((p) => targetsOf(m, p.id, 'allocate'))].some(isP)),
    physical: metric(physical, (b) => sourcesOf(m, b.id, 'allocate').some(isL) || (usages.get(b.id) || []).some((p) => sourcesOf(m, p.id, 'allocate').some(isL))),
  };
}

/** @param {{ total: number, done: number }} x */
export const pct = (x) => (x.total ? Math.round((x.done / x.total) * 100) : 0);

// ---------- the thread through an element ----------

/** Trace relationships that make up the RFLP thread. */
export const TRACE_KINDS = ['satisfy', 'verify', 'derive', 'refine', 'allocate', 'trace', 'copy'];

/**
 * One step "down" the RFLP chain from an element (toward what realizes it) or "up" (toward
 * what it realizes). Requirements are realized by what satisfies, refines, verifies or is
 * derived from them; functions and blocks are realized by what they are allocated to.
 * @param {Model} m @param {string} id @param {'down' | 'up'} dir @returns {string[]}
 */
export function step(m, id, dir) {
  /** @type {string[]} */
  const out = [];
  for (const r of m.relsTo(id)) {
    if (!TRACE_KINDS.includes(r.kind)) continue;
    const realizes = r.kind !== 'allocate'; // everything but allocate points from realizer to realized
    if ((dir === 'down') === realizes) out.push(/** @type {string} */ (r.source));
  }
  for (const r of m.relsFrom(id)) {
    if (!TRACE_KINDS.includes(r.kind)) continue;
    const realizes = r.kind !== 'allocate';
    if ((dir === 'up') === realizes) out.push(/** @type {string} */ (r.target));
  }
  return out;
}

/**
 * Everything on the thread through `id`: what it realizes (up, to the needs) and what
 * realizes it (down, to the physical parts), following each direction transitively. A part
 * stands in for its block, and a block's parts carry its thread.
 * @param {Model} m @param {string} id @returns {Set<string>}
 */
export function threadOf(m, id) {
  const start = m.get(id);
  if (!start) return new Set();
  const seeds = [start.id, ...m.children(start.id).filter((c) => c.kind === 'part').map((p) => p.id)];
  const result = new Set([cardOf(m, start).id]);
  for (const dir of /** @type {const} */ (['up', 'down'])) {
    const seen = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const x = /** @type {string} */ (queue.shift());
      for (const y of step(m, x, dir)) {
        if (seen.has(y)) continue;
        seen.add(y);
        const e = m.get(y);
        if (!e) continue;
        result.add(cardOf(m, e).id);
        queue.push(y);
        for (const p of m.children(y)) if (p.kind === 'part' && !seen.has(p.id)) { seen.add(p.id); queue.push(p.id); }
      }
    }
  }
  return result;
}
