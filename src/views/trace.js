// The RFLP trace: four lanes (Requirements, Functional, Logical, Physical) with a card for
// each element and a line for each trace relationship between lanes. Select a card to light
// up its thread (everything it realizes and everything that realizes it); turn on "Gaps only",
// or click a coverage tile, to see just what is missing.
import { h, s, icon } from '../ui/dom.js';
import { LAYERS, RELATIONSHIPS } from '../model/metamodel.js';
import { coverage, threadOf, cardOf, pct, targetsOf, TRACE_KINDS } from '../model/trace.js';
import { roleName } from '../model/framework.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/trace.js').Coverage} Coverage */

/** What each lane shows. */
export const LANES = /** @type {const} */ ([
  { layer: 'r', kinds: ['requirement'] },
  { layer: 'f', kinds: ['action'] },
  { layer: 'l', kinds: ['partDef'] },
  { layer: 'p', kinds: ['partDef'] },
]);
/** Cards drawn per lane before "Show all". */
const LANE_CAP = 300;

/** The coverage tiles, and which gaps each one filters to. */
export const METRICS = /** @type {const} */ ([
  { key: 'satisfied', label: 'Requirements satisfied', lane: 'r' },
  { key: 'verified', label: 'Requirements verified', lane: 'r' },
  { key: 'passed', label: 'Verification passed', lane: 'r' },
  { key: 'functions', label: 'Functions allocated', lane: 'f' },
  { key: 'logical', label: 'Logical realized physically', lane: 'l' },
  { key: 'physical', label: 'Physical traced to logical', lane: 'p' },
]);

/**
 * The cards in each lane, in browser order with their nesting depth.
 * @param {Model} m @returns {Record<string, { el: Element, depth: number }[]>}
 */
export function laneCards(m) {
  /** @type {Record<string, { el: Element, depth: number }[]>} */
  const out = { r: [], f: [], l: [], p: [] };
  for (const layer of m.layers()) {
    const lane = LANES.find((l) => l.layer === layer.layer);
    if (!lane) continue;
    /** @param {string} id @param {number} depth */
    const walk = (id, depth) => {
      for (const c of m.children(id)) {
        const shows = /** @type {readonly string[]} */ (lane.kinds).includes(c.kind);
        if (shows) out[lane.layer].push({ el: c, depth });
        if (c.kind === 'package' || shows) walk(c.id, shows ? depth + 1 : depth);
      }
    };
    walk(layer.id, 0);
  }
  return out;
}

/**
 * Lines between cards in different lanes: one per trace relationship (parts stand in for
 * their blocks; duplicates are merged).
 * @param {Model} m @param {Set<string>} cards
 * @returns {{ id: string, a: string, b: string, kind: string }[]} a is in the earlier lane
 */
export function laneLinks(m, cards) {
  const order = { r: 0, f: 1, l: 2, p: 3 };
  /** @type {Map<string, { id: string, a: string, b: string, kind: string }>} */
  const out = new Map();
  for (const kind of TRACE_KINDS) {
    for (const r of m.byKind(kind)) {
      const s0 = r.source ? m.get(r.source) : undefined, t0 = r.target ? m.get(r.target) : undefined;
      if (!s0 || !t0) continue;
      const sc = cardOf(m, s0), tc = cardOf(m, t0);
      if (!cards.has(sc.id) || !cards.has(tc.id)) continue;
      const ls = /** @type {keyof typeof order} */ (m.layerOf(sc.id)), lt = /** @type {keyof typeof order} */ (m.layerOf(tc.id));
      if (ls === lt) continue;
      const [a, b] = order[ls] < order[lt] ? [sc.id, tc.id] : [tc.id, sc.id];
      const key = `${a}>${b}`;
      if (!out.has(key)) out.set(key, { id: r.id, a, b, kind });
    }
  }
  return [...out.values()];
}

/** Is a card a gap for a metric (or any metric)? @param {Coverage} cov @param {Element} e @param {string} [metric] */
export function isGap(cov, e, metric) {
  if (e.kind === 'requirement') {
    if (e.props.status === 'Retired') return false;
    const st = cov.status.get(e.id);
    if (!st) return false;
    if (metric === 'satisfied') return !st.satisfied;
    if (metric === 'verified') return !st.verified;
    if (metric === 'passed') return !st.passed;
    return metric ? false : !st.satisfied || !st.verified || st.failed;
  }
  const list = { f: cov.functions, l: cov.logical, p: cov.physical };
  for (const [lane, mt] of Object.entries(list)) {
    if (metric && METRICS.find((x) => x.key === metric)?.lane !== lane) continue;
    if (mt.gaps.includes(e)) return true;
  }
  return false;
}

/**
 * @param {{
 *   model: Model,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 * }} ctx
 */
export function createTraceView(ctx) {
  const { model } = ctx;
  /** @type {string} '' (everything), 'any' (every gap) or a metric key */
  let gaps = '';
  /** Lanes showing every card. @type {Set<string>} */
  const expanded = new Set();
  let raf = 0;

  const tiles = h('div', { class: 'cov-tiles' });
  const gapsBtn = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': 'false', title: 'Show only what is missing a link', onclick: () => { gaps = gaps ? '' : 'any'; render(); } }, icon('filter'), 'Gaps only');
  const toolbar = h('div', { class: 'dtool', role: 'toolbar', 'aria-label': 'Trace tools' },
    h('b', { class: 'dtool-title' }, 'RFLP trace'),
    h('span', { class: 'muted small' }, 'Select a card to follow its thread'),
    h('span', { style: { flex: '1' } }), gapsBtn);
  const svg = s('svg', { class: 'trace-lines', 'aria-hidden': 'true' });
  const lanesEl = h('div', { class: 'lanes' });
  const board = h('div', { class: 'trace-board' }, svg, lanesEl);
  const scroller = h('div', { class: 'trace-scroll', tabindex: '-1' }, tiles, board);
  const el = h('div', { class: 'dview traceview' }, toolbar, scroller);

  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function render() {
    const cov = coverage(model);
    const n = ctx.notation();
    gapsBtn.setAttribute('aria-pressed', String(!!gaps));
    gapsBtn.textContent = '';
    gapsBtn.append(icon('filter'), gaps && gaps !== 'any' ? `Gaps: ${METRICS.find((x) => x.key === gaps)?.label.toLowerCase()}` : 'Gaps only');

    // coverage tiles
    tiles.replaceChildren(...METRICS.map((mt) => {
      const x = /** @type {any} */ (cov)[mt.key];
      const p = pct(x);
      const lane = LAYERS.find((l) => l.id === mt.lane);
      const failed = mt.key === 'passed' ? cov.passed.failed.length : 0;
      return h('button', { class: 'cov-tile' + (gaps === mt.key ? ' on' : ''), type: 'button', 'aria-pressed': String(gaps === mt.key), title: x.total ? `${x.total - x.done} missing. Click to show only those.` : 'Nothing to measure yet', style: { '--lc': lane?.color }, onclick: () => { gaps = gaps === mt.key ? '' : mt.key; render(); } },
        h('span', { class: 'cov-label' }, mt.label),
        h('span', { class: 'cov-num' }, h('b', {}, x.total ? `${p}%` : '—'), h('span', { class: 'muted small mono' }, ` ${x.done}/${x.total}`)),
        h('span', { class: 'cov-bar' }, h('span', { style: { width: `${p}%` } })),
        failed ? h('span', { class: 'cov-fail small' }, `${failed} failed`) : null);
    }));

    // lanes
    const cards = laneCards(model);
    const sel = ctx.selected();
    const selEl = sel ? model.get(sel) : undefined;
    const thread = selEl && !selEl.source ? threadOf(model, sel || '') : null;
    const shown = new Set();
    lanesEl.replaceChildren(...LANES.map((lane) => {
      const info = { ...(/** @type {typeof LAYERS[number]} */ (LAYERS.find((l) => l.id === lane.layer))), name: roleName(model, lane.layer) };
      let list = cards[lane.layer];
      if (gaps) list = list.filter(({ el: e }) => isGap(cov, e, gaps === 'any' ? undefined : gaps));
      const capped = !expanded.has(lane.layer) && list.length > LANE_CAP;
      const vis = capped ? list.slice(0, LANE_CAP) : list;
      for (const c of vis) shown.add(c.el.id);
      return h('section', { class: 'lane', style: { '--lc': info.color }, 'aria-label': info.name },
        h('header', { class: 'lane-head' }, h('span', { class: 'lcard-dot' }), h('h3', {}, info.name), h('span', { class: 'lane-n mono' }, String(list.length))),
        vis.length ? vis.map(({ el: e, depth }) => card(e, depth, cov, thread, n)) : h('p', { class: 'lane-empty' }, gaps ? 'No gaps here' : `No ${lane.layer === 'r' ? 'requirements' : lane.layer === 'f' ? 'functions' : 'blocks'} yet`),
        capped ? h('button', { class: 'btn sm lane-more', type: 'button', onclick: () => { expanded.add(lane.layer); render(); } }, `Show all ${list.length}`) : null);
    }));

    // lines, drawn once the cards are laid out
    const links = laneLinks(model, shown);
    const bb = board.getBoundingClientRect();
    /** @type {Map<string, DOMRect>} */
    const rects = new Map();
    for (const c of /** @type {HTMLElement[]} */ ([...lanesEl.querySelectorAll('.tcard')])) rects.set(/** @type {string} */ (c.dataset.id), c.getBoundingClientRect());
    svg.setAttribute('width', String(board.scrollWidth)); svg.setAttribute('height', String(board.scrollHeight));
    const paths = [];
    for (const l of links) {
      const a = rects.get(l.a), b = rects.get(l.b);
      if (!a || !b) continue;
      const x1 = a.right - bb.left, y1 = a.top + a.height / 2 - bb.top, x2 = b.left - bb.left, y2 = b.top + b.height / 2 - bb.top;
      const dx = Math.max(30, (x2 - x1) / 2);
      const hot = thread ? thread.has(l.a) && thread.has(l.b) : false;
      paths.push(`<path class="tl ${l.kind}${hot ? ' hot' : thread ? ' dim' : ''}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"><title>${RELATIONSHIPS[l.kind].names[n]}</title></path>`);
    }
    svg.innerHTML = paths.join('');
  }

  /**
   * @param {Element} e @param {number} depth @param {Coverage} cov @param {Set<string> | null} thread
   * @param {import('../model/metamodel.js').Notation} n
   */
  function card(e, depth, cov, thread, n) {
    const sel = ctx.selected() === e.id;
    /** @type {any[]} */
    const chips = [];
    if (e.kind === 'requirement') {
      const st = cov.status.get(e.id);
      const retired = e.props.status === 'Retired';
      chips.push(h('span', { class: 'tchk ' + (retired ? 'off' : st?.satisfied ? 'ok' : 'gap'), title: st?.satisfied ? 'Satisfied' : 'Nothing satisfies it yet' }, 'S'));
      chips.push(h('span', { class: 'tchk ' + (retired ? 'off' : st?.failed ? 'bad' : st?.passed ? 'ok' : st?.verified ? 'plan' : 'gap'), title: st?.failed ? 'A verifying test failed' : st?.passed ? 'Verified and passed' : st?.verified ? 'Verification planned, not run yet' : 'Nothing verifies it yet' }, 'V'));
    } else {
      const gap = isGap(cov, e);
      const what = e.kind === 'action' ? 'Allocated' : model.layerOf(e.id) === 'l' ? 'Realized physically' : 'Traced to logical';
      const targets = e.kind === 'action' ? targetsOf(model, e.id, 'allocate').length : 0;
      chips.push(h('span', { class: 'tchk ' + (gap ? 'gap' : 'ok'), title: gap ? `Not ${what.toLowerCase()} yet` : what }, gap ? '!' : '✓'));
      if (targets > 1) chips.push(h('span', { class: 'muted small mono' }, `×${targets}`));
    }
    return h('button', {
      class: 'tcard' + (sel ? ' sel' : '') + (thread ? (thread.has(e.id) ? ' hot' : ' dim') : '') + (e.props.status === 'Retired' ? ' retired' : ''),
      type: 'button', 'data-id': e.id, title: e.kind === 'requirement' && e.props.text ? `${e.name}: ${e.props.text}` : e.name,
      style: { marginLeft: `${Math.min(depth, 5) * 12}px` },
      onclick: () => ctx.select(sel ? null : e.id),
    },
    e.kind === 'requirement' && e.props.reqId ? h('span', { class: 'tcard-id mono' }, e.props.reqId) : null,
    h('span', { class: 'tcard-name' }, e.name),
    h('span', { class: 'tcard-chips' }, chips));
  }

  const unsub = model.subscribe(() => invalidate());
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => invalidate()) : null;
  ro?.observe(board);
  invalidate();
  return {
    el, render, invalidate,
    syncSelection: () => invalidate(),
    focus: () => scroller.focus({ preventScroll: true }),
    dispose() { cancelAnimationFrame(raf); unsub(); ro?.disconnect(); },
  };
}
